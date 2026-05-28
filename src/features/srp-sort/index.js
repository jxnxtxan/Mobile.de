import { SRP_SORT_OPTIONS } from '../../config/constants.js';
import { runtimeState } from '../../config/runtime-state.js';
import {
    getDebugConfig, getSrpSort, findSrpSortOption, hasSrpSortUserOverride,
    markSrpSortUserOverride, clearSrpSortUserOverride, clearSrpSortSessionState,
    getStoredSrpUserChoice, setStoredSrpUserChoice, clearStoredSrpUserChoice,
    getStoredSrpSortApplied, markSrpSortApplied, clearStoredSrpSortApplied,
    srpSortParamsEqual,
} from '../../config/feature-flags/index.js';

const SRP_DEBUG_LOG_MAX_ENTRIES = 100;

// 10b) Suchergebnisse: Standard-Sortierung aus Config
// ============================================================
export let srpSortUserOverrideFp = null;
export let applyingDefaultSrpSort = false;
export let lastSrpFingerprint = null;
export let lastPolledSrpSort = null;
export let srpSortMo = null;
export let srpSortPollTimerId = null;
export let srpSortOnPageshow = null;

export function isSearchResultsPage() {
    return /\/fahrzeuge\/search\.html/.test(location.pathname);
}

export function isSrpLogCardEnabled(flags) {
    const dbg = getDebugConfig(flags || runtimeState.featureFlags);
    return dbg && dbg.showSrpLogCard === true;
}

export function serializeSrpDebugPayload(payload) {
    if (payload == null) return '';
    if (typeof payload === 'string') return payload;
    try {
        return JSON.stringify(payload, null, 2);
    } catch (e) {
        return String(payload);
    }
}

export function appendSrpDebugLog(level, label, payload) {
    const ts = new Date().toLocaleTimeString('de-DE', { hour12: false });
    const line = `[${ts}] ${String(level || 'info').toUpperCase()} ${label}${payload == null ? '' : '\n' + serializeSrpDebugPayload(payload)}`;
    srpDebugLogEntries.push({ level: level || 'info', text: line });
    if (srpDebugLogEntries.length > SRP_DEBUG_LOG_MAX_ENTRIES) {
        srpDebugLogEntries = srpDebugLogEntries.slice(-SRP_DEBUG_LOG_MAX_ENTRIES);
    }
    renderSrpDebugLogCard();
}

export function clearSrpDebugLog() {
    srpDebugLogEntries = [];
    renderSrpDebugLogCard();
}

export function getSrpDebugLogText() {
    if (!srpDebugLogEntries.length) return 'Noch keine Logs vorhanden.';
    return srpDebugLogEntries.map(e => e.text).join('\n\n');
}

async function copySrpDebugLogToClipboard(sourceBtn) {
    const safeToast = (msg, kind) => {
        if (typeof showToast === 'function') showToast(msg, kind);
    };
    const setButtonFeedback = (tempLabel) => {
        if (!sourceBtn) return;
        const base = sourceBtn.dataset.defaultLabel || '⧉ Copy';
        if (sourceBtn._copyResetTimer) clearTimeout(sourceBtn._copyResetTimer);
        sourceBtn.textContent = tempLabel;
        sourceBtn.disabled = true;
        sourceBtn._copyResetTimer = setTimeout(() => {
            sourceBtn.textContent = base;
            sourceBtn.disabled = false;
            sourceBtn._copyResetTimer = null;
        }, 1100);
    };
    const text = getSrpDebugLogText();
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            setButtonFeedback('Kopiert!');
            safeToast('Debug-Logs kopiert', 'success');
            return;
        }
    } catch (e) { /* fallback below */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) {
            setButtonFeedback('Kopiert!');
            safeToast('Debug-Logs kopiert', 'success');
        }
        else safeToast('Kopieren nicht moeglich', 'warn');
    } catch (e2) {
        safeToast('Kopieren nicht moeglich', 'warn');
        setButtonFeedback('Fehler');
    }
}

export function runManualCohortLog() {
    const prof = buildVehicleProfile();
    if (!prof || !prof.id) {
        console.warn('[mobilede Preis]', 'Kein Fahrzeugprofil auf dieser Seite');
        appendSrpDebugLog('warn', 'Kohorten-Check nicht moeglich', { reason: 'Kein Fahrzeugprofil auf dieser Seite' });
        showToast('Nur auf einer Fahrzeugdetailseite mit Inserat-ID', 'warn');
        return;
    }
    const prCfg = getPriceRating(runtimeState.featureFlags);
    const cohortRes = getCohortComparables(prof, prCfg);
    const payload = {
        profileId: prof.id,
        cacheKey: cohortRes.cacheKey,
        cohortHuman: cohortHumanLabel(prof, prCfg),
        count: cohortRes.items.length,
        vipDetails: countCohortVipDetailCount(cohortRes.items),
        needsManualSearch: !!cohortRes.needsManualSearch
    };
    console.info('[mobilede Preis]', 'Manueller Kohorten-Check', payload);
    appendSrpDebugLog('info', 'Manueller Kohorten-Check', payload);
    showToast('Kohorte wurde geloggt', 'success');
}

export function runManualSrpStatusLog() {
    if (!isSearchResultsPage()) {
        console.warn('[mobilede Preis]', 'SRP-Status nur auf Suchergebnisseite verfügbar');
        appendSrpDebugLog('warn', 'SRP-Status nicht verfuegbar', { reason: 'Nicht auf Suchergebnisseite' });
        showToast('Nur auf einer Suchergebnisseite (SRP)', 'warn');
        return;
    }
    const state = getPageInitialState();
    if (!state) {
        console.warn('[mobilede Preis]', 'SRP-Status: kein __INITIAL_STATE__ vorhanden');
        appendSrpDebugLog('warn', 'SRP-Status ohne __INITIAL_STATE__', null);
        showToast('Kein __INITIAL_STATE__ auf dieser SRP', 'warn');
        return;
    }
    const rawList = findSrpListingsInState(state);
    const items = parseCohortItemsFromState(state, null);
    const prof = profileFromSearchPageUrl(location.href);
    const prCfg = getPriceRating(runtimeState.featureFlags);
    const enrichedForLog = prof
        ? items.map(it => enrichCohortItemFromSearchContext(it, prof))
        : items;
    const grouped = {};
    enrichedForLog.forEach(item => {
        if (!item || !(item.makeId || item.make) || !(item.modelId || item.model)) return;
        const key = cohortCacheKey(item, prCfg);
        grouped[key] = (grouped[key] || 0) + 1;
    });
    const topGroups = Object.entries(grouped)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key, count]) => ({ cacheKey: key, count }));
    const hasMultiModelMs = !!(prof && Array.isArray(prof.searchMsList) && prof.searchMsList.length > 1);
    const cacheKey = prof && (prof.makeId || prof.make || prof.modelId || prof.model)
        ? (hasMultiModelMs ? null : cohortCacheKey(prof, prCfg))
        : null;
    const cached = cacheKey ? readCohortCache(cacheKey) : null;
    const anchorCount = readVipCohortAnchors().length;
    const payload = {
        url: location.href,
        rawListings: rawList.length,
        parsedComparables: items.length,
        cacheKey,
        cohortHuman: prof ? cohortHumanLabel(prof, prCfg) : null,
        cachedCount: Array.isArray(cached) ? cached.length : 0,
        vipAnchors: anchorCount,
        modelGroupsDetected: topGroups,
        profileFromUrl: prof ? {
            makeId: prof.makeId || '',
            modelId: prof.modelId || '',
            modelGroupId: prof.modelGroupId || '',
            modelIdList: Array.isArray(prof.modelIdList) ? prof.modelIdList : [],
            msCount: Array.isArray(prof.searchMsList) ? prof.searchMsList.length : 0,
            mileageKm: prof.mileageKm,
            firstRegistrationYear: prof.firstRegistrationYear,
            powerKw: prof.powerKw
        } : null
    };
    console.info('[mobilede Preis]', 'Manueller SRP-Status', payload);
    appendSrpDebugLog('info', 'Manueller SRP-Status', payload);
    showToast('SRP-Status wurde geloggt', 'success');
}

export function runManualPriceRatingUiLog() {
    if (!isVehicleDetailPage()) {
        appendSrpDebugLog('warn', 'Preisbewertung-UI nicht verfuegbar', { reason: 'Nicht auf Detailseite' });
        showToast('Nur auf einer Fahrzeugdetailseite', 'warn');
        return;
    }
    const profile = buildVehicleProfile();
    const adId = profile && profile.id ? String(profile.id) : null;
    const wrap = document.querySelector('.mobilede-price-rating');
    const row = wrap ? wrap.querySelector('.mobilede-price-rating__row') : null;
    const bars = wrap ? wrap.querySelectorAll('.mobilede-price-rating__bar') : [];
    const barsOn = wrap ? wrap.querySelectorAll('.mobilede-price-rating__bar--on') : [];
    const labelEl = wrap ? wrap.querySelector('.mobilede-price-rating__label') : null;
    const tagEl = wrap ? wrap.querySelector('.mobilede-price-rating__tag') : null;
    const subEl = wrap ? wrap.querySelector('.mobilede-price-rating__sub') : null;
    const infoEl = wrap ? wrap.querySelector('.mobilede-price-rating__info') : null;
    const csInfo = infoEl ? getComputedStyle(infoEl) : null;
    const csTag = tagEl ? getComputedStyle(tagEl) : null;
    const ratingCache = adId ? (readRatingUiCache(adId) || readRatingCache(adId)) : null;
    const payload = {
        profileId: adId,
        cohortHuman: profile ? cohortHumanLabel(profile, getPriceRating(runtimeState.featureFlags)) : null,
        hasWidget: !!wrap,
        widgetClass: wrap ? wrap.className : null,
        hasRow: !!row,
        barsTotal: bars ? bars.length : 0,
        barsOn: barsOn ? barsOn.length : 0,
        labelText: labelEl ? labelEl.textContent.trim() : '',
        tagText: tagEl ? tagEl.textContent.trim() : '',
        subText: subEl ? subEl.textContent.trim() : '',
        infoButtonText: infoEl ? infoEl.textContent.trim() : '',
        infoButtonStyle: csInfo ? {
            width: csInfo.width,
            height: csInfo.height,
            lineHeight: csInfo.lineHeight,
            fontSize: csInfo.fontSize,
            fontWeight: csInfo.fontWeight,
            fontFamily: csInfo.fontFamily,
            borderRadius: csInfo.borderRadius,
            borderTop: csInfo.borderTopWidth + ' ' + csInfo.borderTopStyle + ' ' + csInfo.borderTopColor
        } : null,
        tagStyle: csTag ? {
            fontSize: csTag.fontSize,
            lineHeight: csTag.lineHeight,
            padding: csTag.padding
        } : null,
        ratingCache: ratingCache ? {
            ok: !!ratingCache.ok,
            label: ratingCache.label || null,
            level: typeof ratingCache.level === 'number' ? ratingCache.level : null,
            price: typeof ratingCache.price === 'number' ? ratingCache.price : null,
            adjustedExpected: typeof ratingCache.adjustedExpected === 'number' ? ratingCache.adjustedExpected : null,
            basePrice: typeof ratingCache.basePrice === 'number' ? ratingCache.basePrice : null,
            devEuro: typeof ratingCache.devEuro === 'number' ? ratingCache.devEuro : null,
            devPct: typeof ratingCache.devPct === 'number'
                ? Math.round(ratingCache.devPct * 10000) / 100
                : null,
            mobileLabel: ratingCache.mobileLabel || null,
            cohortCount: typeof ratingCache.cohortCount === 'number' ? ratingCache.cohortCount : null,
            cohortVipDetailCount: typeof ratingCache.cohortVipDetailCount === 'number' ? ratingCache.cohortVipDetailCount : null,
            usedMobileFallback: !!ratingCache.usedMobileFallback,
            insufficientCohort: !!ratingCache.insufficientCohort,
            cohortQuality: ratingCache.insufficientCohort
                ? 'small-cohort-fallback'
                : 'cohort-ok'
        } : null
    };
    console.info('[mobilede Preis]', 'Manuelle Preisbewertung-UI', payload);
    appendSrpDebugLog('info', 'Manuelle Preisbewertung-UI', payload);
    showToast('Preisbewertung-UI wurde geloggt', 'success');
}

async function runManualPriceDataStoreExport() {
    const store = readPriceDataStore();
    const payload = {
        version: store.version,
        updatedTs: store.updatedTs || null,
        adsCount: Object.keys(store.adsById || {}).length,
        cohortsCount: Object.keys(store.cohortsByKey || {}).length,
        export: { priceDataStore: store }
    };
    console.info('[mobilede Preis]', 'Preisdaten-Store Export', payload);
    appendSrpDebugLog('info', 'Preisdaten-Store Export', {
        adsCount: payload.adsCount,
        cohortsCount: payload.cohortsCount
    });
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(JSON.stringify(payload.export, null, 2));
            showToast('Preisdaten-Export in Zwischenablage kopiert', 'success');
            return;
        }
    } catch (e) { /* noop */ }
    showToast('Export geloggt (Clipboard nicht verfügbar)', 'warn');
}

export function runManualPriceDataStoreImportPrompt() {
    const raw = window.prompt('Preisdatenspeicher importieren: JSON mit { "priceDataStore": { ... } } einfügen');
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        const source = parsed && parsed.priceDataStore ? parsed.priceDataStore : parsed;
        const merged = mergePriceDataStoreImport(source);
        notifyCohortCacheUpdated();
        appendSrpDebugLog('info', 'Preisdaten-Store Import', merged);
        showToast('Preisdaten importiert: ' + merged.mergedAds + ' Ads, ' + merged.mergedCohorts + ' Kohorten', 'success');
    } catch (e) {
        showToast('Import-JSON ungültig: ' + e, 'error');
    }
}

export function renderDebugLogIntoCard(cardId) {
    const existing = document.getElementById(cardId);
    if (!existing) return;
    const logBox = existing.querySelector('.mobilede-srp-debug-card__log');
    const copyBtn = existing.querySelector('.mobilede-srp-debug-card__btn[data-copy-log="1"]');
    if (copyBtn) {
        const hasLogs = srpDebugLogEntries.length > 0;
        copyBtn.disabled = !hasLogs;
        copyBtn.title = hasLogs ? 'Logs in Zwischenablage kopieren' : 'Keine Logs zum Kopieren vorhanden';
    }
    if (!logBox) return;
    logBox.innerHTML = '';
    if (srpDebugLogEntries.length === 0) {
        logBox.textContent = 'Noch keine Logs vorhanden.';
        return;
    }
    srpDebugLogEntries.slice().reverse().forEach(entry => {
        const line = document.createElement('div');
        line.className = 'mobilede-srp-debug-card__log-line mobilede-srp-debug-card__log-line--' + entry.level;
        line.textContent = entry.text;
        logBox.appendChild(line);
    });
}

export function renderSrpDebugLogCard() {
    renderDebugLogIntoCard('mobilede-srp-debug-card');
    renderDebugLogIntoCard('mobilede-detail-debug-card');
    wireDebugCardCopyButtons();
}

export function wireDebugCardCopyButtons() {
    const cards = ['mobilede-srp-debug-card', 'mobilede-detail-debug-card'];
    cards.forEach(cardId => {
        const card = document.getElementById(cardId);
        if (!card) return;
        const buttons = card.querySelectorAll('.mobilede-srp-debug-card__btn');
        buttons.forEach(btn => {
            const txt = (btn.textContent || '').toLowerCase();
            if (!txt.includes('copy')) return;
            btn.onclick = () => { copySrpDebugLogToClipboard(btn); };
        });
    });
}

export function removeSrpDebugLogCard() {
    const existing = document.getElementById('mobilede-srp-debug-card');
    if (existing) existing.remove();
}

export function removeDetailDebugLogCard() {
    const existing = document.getElementById('mobilede-detail-debug-card');
    if (existing) existing.remove();
}

export function ensureSrpDebugLogCard() {
    if (!isSearchResultsPage() || !isSrpLogCardEnabled(runtimeState.featureFlags)) {
        removeSrpDebugLogCard();
        return;
    }
    injectPriceRatingStyles();
    const summarySection = document.querySelector(
        'div.leHcX article.A3G6X.vTKPY section.HaBLt.ku0Os.Ln3aV'
    );
    const summaryArticle = summarySection ? summarySection.closest('article.A3G6X.vTKPY') : null;
    const leftFilterSection = document.querySelector('section[data-testid="search-column-content-section"]');
    const topBtn = leftFilterSection && leftFilterSection.querySelector('button[data-testid="dsp-button-top"]');
    const fallbackParent = topBtn ? topBtn.parentElement : (leftFilterSection ? leftFilterSection.querySelector('[data-testid="search-column-content"]') : null);
    if (!summarySection && !fallbackParent) return;

    let card = document.getElementById('mobilede-srp-debug-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'mobilede-srp-debug-card';
        card.className = 'mobilede-srp-debug-card';

        const title = document.createElement('div');
        title.className = 'mobilede-srp-debug-card__title';
        title.textContent = 'Mobile.de Debug-Logs';
        card.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'mobilede-srp-debug-card__actions';
        const bSrp = document.createElement('button');
        bSrp.type = 'button';
        bSrp.className = 'mobilede-srp-debug-card__btn';
        bSrp.textContent = 'SRP-Status jetzt loggen';
        bSrp.addEventListener('click', runManualSrpStatusLog);
        actions.appendChild(bSrp);
        const bClear = document.createElement('button');
        bClear.type = 'button';
        bClear.className = 'mobilede-srp-debug-card__btn';
        bClear.textContent = 'Logs leeren';
        bClear.addEventListener('click', clearSrpDebugLog);
        actions.appendChild(bClear);
        const bCopy = document.createElement('button');
        bCopy.type = 'button';
        bCopy.className = 'mobilede-srp-debug-card__btn';
        bCopy.textContent = '⧉ Copy';
        bCopy.dataset.defaultLabel = bCopy.textContent;
        bCopy.dataset.copyLog = '1';
        bCopy.title = 'Logs in Zwischenablage kopieren';
        bCopy.addEventListener('click', () => { copySrpDebugLogToClipboard(bCopy); });
        actions.appendChild(bCopy);
        card.appendChild(actions);

        const logBox = document.createElement('div');
        logBox.className = 'mobilede-srp-debug-card__log';
        card.appendChild(logBox);
    }
    if (summaryArticle) {
        const shouldMove = card.parentElement !== summaryArticle.parentElement
            || card.previousElementSibling !== summaryArticle;
        if (shouldMove) summaryArticle.insertAdjacentElement('afterend', card);
    } else if (summarySection) {
        const shouldMove = card.parentElement !== summarySection.parentElement
            || card.previousElementSibling !== summarySection;
        if (shouldMove) summarySection.insertAdjacentElement('afterend', card);
    } else if (topBtn) {
        const shouldMove = card.parentElement !== topBtn.parentElement
            || card.previousElementSibling !== topBtn;
        if (shouldMove) topBtn.insertAdjacentElement('afterend', card);
    } else if (fallbackParent && !card.parentElement) {
        fallbackParent.prepend(card);
    } else if (fallbackParent) {
        if (card.parentElement !== fallbackParent) fallbackParent.appendChild(card);
    }
    renderSrpDebugLogCard();
}

export function ensureDetailDebugLogCard() {
    if (!isVehicleDetailPage() || !isSrpLogCardEnabled(runtimeState.featureFlags)) {
        removeDetailDebugLogCard();
        return;
    }
    injectPriceRatingStyles();
    const galleryArticle = document.querySelector('article[data-testid="gallery-main-focus-container"]');
    if (!galleryArticle || !galleryArticle.parentElement) return;

    let card = document.getElementById('mobilede-detail-debug-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'mobilede-detail-debug-card';
        card.className = 'mobilede-srp-debug-card mobilede-srp-debug-card--detail';

        const title = document.createElement('div');
        title.className = 'mobilede-srp-debug-card__title';
        title.textContent = 'Mobile.de Debug-Logs (Detailseite)';
        card.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'mobilede-srp-debug-card__actions';
        const bCohort = document.createElement('button');
        bCohort.type = 'button';
        bCohort.className = 'mobilede-srp-debug-card__btn';
        bCohort.textContent = 'Kohorte jetzt loggen';
        bCohort.addEventListener('click', runManualCohortLog);
        actions.appendChild(bCohort);
        const bRatingUi = document.createElement('button');
        bRatingUi.type = 'button';
        bRatingUi.className = 'mobilede-srp-debug-card__btn';
        bRatingUi.textContent = 'Preisbewertung-UI loggen';
        bRatingUi.addEventListener('click', runManualPriceRatingUiLog);
        actions.appendChild(bRatingUi);
        const bClear = document.createElement('button');
        bClear.type = 'button';
        bClear.className = 'mobilede-srp-debug-card__btn';
        bClear.textContent = 'Logs leeren';
        bClear.addEventListener('click', clearSrpDebugLog);
        actions.appendChild(bClear);
        const bCopy = document.createElement('button');
        bCopy.type = 'button';
        bCopy.className = 'mobilede-srp-debug-card__btn';
        bCopy.textContent = '⧉ Copy';
        bCopy.dataset.defaultLabel = bCopy.textContent;
        bCopy.dataset.copyLog = '1';
        bCopy.title = 'Logs in Zwischenablage kopieren';
        bCopy.addEventListener('click', () => { copySrpDebugLogToClipboard(bCopy); });
        actions.appendChild(bCopy);
        card.appendChild(actions);

        const logBox = document.createElement('div');
        logBox.className = 'mobilede-srp-debug-card__log';
        card.appendChild(logBox);
    }

    const shouldMove = card.parentElement !== galleryArticle.parentElement
        || card.previousElementSibling !== galleryArticle;
    if (shouldMove) galleryArticle.insertAdjacentElement('afterend', card);
    renderSrpDebugLogCard();
}

export function getSrpSearchFingerprint() {
    const u = new URL(location.href);
    const parts = [];
    for (const [k, v] of u.searchParams.entries()) {
        if (SRP_FINGERPRINT_EXCLUDE.has(k)) continue;
        parts.push(k + '=' + v);
    }
    parts.sort((a, b) => a.localeCompare(b));
    return u.pathname + (parts.length ? '?' + parts.join('&') : '');
}

export function getSrpConfigSort() {
    const opt = findSrpSortOption(getSrpSort(runtimeState.featureFlags).sortId);
    return { sb: opt.sb, od: opt.od };
}

export function urlSortMatchesUserChoice(fp) {
    const choice = getStoredSrpUserChoice();
    if (!choice || choice.fp !== fp) return false;
    return srpSortParamsEqual(parseSortFromUrl(), choice);
}

export function parseSortFromUrl(href) {
    const u = new URL(href || location.href);
    return { sb: u.searchParams.get('sb'), od: u.searchParams.get('od') || 'up' };
}

/** Nach Reload: gespeicherte User-Sort oder Abweichung von zuletzt gesetzter Config-Sort. */
export function detectUserSortAfterReload(fp) {
    const srp = getSrpSort(runtimeState.featureFlags);
    if (!srp.enabled) return false;

    if (urlSortMatchesUserChoice(fp)) {
        srpSortUserOverrideFp = fp;
        return true;
    }

    const current = parseSortFromUrl();
    const configSort = getSrpConfigSort();
    if (srpSortParamsEqual(current, configSort)) return false;

    const applied = getStoredSrpSortApplied();
    if (applied && applied.fp === fp && !srpSortParamsEqual(current, applied)) {
        markSrpSortUserOverride(current);
        return true;
    }
    return false;
}

export function applySrpDefaultSort(force) {
    if (!isSearchResultsPage()) return;
    const srp = getSrpSort(runtimeState.featureFlags);
    if (!srp.enabled) return;
    const fp = getSrpSearchFingerprint();
    if (!force && (hasSrpSortUserOverride(fp) || urlSortMatchesUserChoice(fp))) return;

    const configSort = getSrpConfigSort();
    const current = parseSortFromUrl();
    if (srpSortParamsEqual(current, configSort)) {
        markSrpSortApplied(fp, configSort.sb, configSort.od);
        return;
    }

    applyingDefaultSrpSort = true;
    try {
        const u = new URL(location.href);
        u.searchParams.set('sb', configSort.sb);
        u.searchParams.set('od', configSort.od);
        const newUrl = u.toString();
        markSrpSortApplied(fp, configSort.sb, configSort.od);
        lastUrl = newUrl;
        location.replace(newUrl);
    } finally {
        applyingDefaultSrpSort = false;
    }
}

export function resetSrpSortOverrideAndApply() {
    clearSrpSortSessionState();
    applySrpDefaultSort(true);
}

export function bindSrpSortDropdown() {
    if (!isSearchResultsPage()) return;
    const sel = document.getElementById('sorting-menu-dropdown');
    if (!sel || sel.dataset.mobiledeSrpBound === '1') return;
    sel.dataset.mobiledeSrpBound = '1';
    const onUserSort = () => {
        if (applyingDefaultSrpSort) return;
        markSrpSortUserOverride(parseSortFromUrl());
    };
    sel.addEventListener('change', onUserSort, true);
    sel.addEventListener('input', onUserSort, true);
    sel.addEventListener('pointerdown', () => {
        sel.dataset.mobiledeSortTouched = '1';
    }, true);
}

export function pollSrpSortFromUrl() {
    if (!isSearchResultsPage() || applyingDefaultSrpSort) return;
    const srp = getSrpSort(runtimeState.featureFlags);
    if (!srp.enabled) return;

    const fp = getSrpSearchFingerprint();
    const current = parseSortFromUrl();
    const configSort = getSrpConfigSort();
    const key = fp + '|' + (current.sb || '') + '|' + current.od;

    if (lastPolledSrpSort === key) return;
    const prev = lastPolledSrpSort;
    lastPolledSrpSort = key;

    if (prev === null) return;

    if (!srpSortParamsEqual(current, configSort)) {
        markSrpSortUserOverride(current);
    }
}

export function destroySrpSortBehavior() {
    if (srpSortMo) {
        srpSortMo.disconnect();
        srpSortMo = null;
    }
    if (srpSortPollTimerId != null) {
        clearInterval(srpSortPollTimerId);
        srpSortPollTimerId = null;
    }
    if (srpSortOnPageshow) {
        window.removeEventListener('pageshow', srpSortOnPageshow);
        srpSortOnPageshow = null;
    }
}

export function syncSrpPolledSortKey(fp) {
    const cur = parseSortFromUrl();
    lastPolledSrpSort = fp + '|' + (cur.sb || '') + '|' + cur.od;
}

export function handleSrpUrlChange() {
    if (!isSearchResultsPage()) return;
    bindSrpSortDropdown();
    const fp = getSrpSearchFingerprint();
    if (fp !== lastSrpFingerprint) {
        lastSrpFingerprint = fp;
        lastPolledSrpSort = null;
        clearSrpSortSessionState();
        applySrpDefaultSort(false);
        return;
    }

    pollSrpSortFromUrl();
}

export function ensureSrpSortBehavior() {
    if (!isSearchResultsPage()) {
        destroySrpSortBehavior();
        return;
    }
    if (srpSortPollTimerId != null) return;

    const fp = getSrpSearchFingerprint();
    lastSrpFingerprint = fp;
    lastPolledSrpSort = null;

    const choice = getStoredSrpUserChoice();
    if (choice && choice.fp === fp) srpSortUserOverrideFp = fp;

    bindSrpSortDropdown();
    if (!detectUserSortAfterReload(fp)) {
        applySrpDefaultSort(false);
    }
    syncSrpPolledSortKey(fp);

    srpSortMo = new MutationObserver(() => bindSrpSortDropdown());
    srpSortMo.observe(document.body, { childList: true, subtree: true });

    srpSortOnPageshow = () => {
        if (!isSearchResultsPage()) return;
        const fpNow = getSrpSearchFingerprint();
        if (detectUserSortAfterReload(fpNow)) syncSrpPolledSortKey(fpNow);
    };
    window.addEventListener('pageshow', srpSortOnPageshow);

    srpSortPollTimerId = setInterval(pollSrpSortFromUrl, 400);
}

export function initSrpSortBehavior() {
    destroySrpSortBehavior();
    ensureSrpSortBehavior();
}
