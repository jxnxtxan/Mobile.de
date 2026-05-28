import {
    PRICE_RATING_LEVELS, PRICE_RATING_DEFAULT, DEFAULT_PREIS_GEWICHT_BY_ANZEIGE,
    PRICE_COHORT_CACHE_PREFIX, PRICE_RATING_CACHE_PREFIX, PRICE_RATING_UI_CACHE_PREFIX,
    PRICE_VIP_EQUIP_CACHE_PREFIX, PRICE_DATA_STORE_KEY, PRICE_DATA_STORE_VERSION,
    PRICE_DATA_STORE_MAX_ADS, PRICE_DATA_STORE_MAX_COHORTS, MAKE_MODEL_CACHE_PREFIX,
    MAKE_MODEL_AD_CACHE_PREFIX, PRICE_COHORT_CACHE_TTL_MS, PRICE_RATING_UI_CACHE_TTL_MS,
    DEBUG_SCOPE_PREFIX,
} from '../../config/constants.js';
import { getUnsafeWindow } from '../../platform/page-window.js';
import { cleanText, tokenize, escapeRegex } from '../../core/text/normalize.js';
import { collectConfigMatches } from '../../core/search/config-matches.js';
import { extractSources, classifyDescription } from '../../core/dom/sources.js';
import { getDescriptionEl, getTechDataDl } from '../../core/dom/selectors.js';
import { extractRawEquipmentItems, findConfigEntryForRawLabel } from '../../core/search/automode.js';
import { runtimeState } from '../../config/runtime-state.js';
import { debugLog, getDebugConfig, isDebugEnabled, getPriceRating, isPriceRatingEnabled, getSrpSort, mergePriceRating } from '../../config/feature-flags/index.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { isSearchResultsPage, isVehicleDetailPage } from '../../core/page-context.js';
import { requestIdle } from '../../core/util/request-idle.js';

export { isVehicleDetailPage };

export function isPriceRatingDebugEnabled() {
    return isDebugEnabled('price');
}

export function priceRatingDebugLog(...args) {
    if (!isPriceRatingDebugEnabled()) return;
    debugLog('price', ...args);
}

export function isPriceRatingPerfDebugEnabled() {
    return isDebugEnabled('perf');
}

export function pricePerfMarkStart() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
}

export function pricePerfMarkEnd(label, startMs, warnMs) {
    const end = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    const duration = Math.round((end - startMs) * 10) / 10;
    if (isPriceRatingPerfDebugEnabled()) {
        const level = duration >= (warnMs || 50) ? 'warn' : 'info';
        const prefix = DEBUG_SCOPE_PREFIX.perf || '[mobilede Perf]';
        console[level](prefix, label, duration + 'ms');
    }
    return duration;
}

export function getAdIdFromUrl(href) {
    const u = new URL(href || location.href);
    const id = u.searchParams.get('id');
    if (id) return String(id);
    const m = u.pathname.match(/\/auto-inserat\/([^/]+)/);
    return m ? m[1] : null;
}

export function getPageInitialState() {
    try {
        const st = getUnsafeWindow().__INITIAL_STATE__;
        return st && typeof st === 'object' ? st : null;
    } catch (e) {
        return null;
    }
}

export function getVipAdFromState(adId) {
    const id = adId || getAdIdFromUrl();
    if (!id) return null;
    const state = getPageInitialState();
    const ad = state?.search?.vip?.ads?.[id]?.data?.ad;
    return ad || null;
}

export function parseEuroAmount(str) {
    if (str == null) return null;
    if (typeof str === 'number' && !Number.isNaN(str)) return str;
    const m = String(str).replace(/\s/g, '').replace(/\./g, '').replace(',', '.').match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
}

export function parseKm(str) {
    if (!str) return null;
    const m = String(str).replace(/\s/g, '').match(/([\d.]+)/);
    return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}

export function parseYear(str) {
    if (!str) return null;
    const m = String(str).match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : null;
}

/** mobile.de pw-Parameter = Leistung in kW (nicht PS). */
export const PS_TO_KW = 0.73549875;

export function parsePower(str) {
    if (str == null || str === '') return { kw: null, ps: null };
    const s = String(str);
    const kwM = s.match(/([\d.,]+)\s*kW/i);
    const psM = s.match(/(\d+)\s*PS/i);
    let kw = kwM ? parseInt(kwM[1].replace(/[.,]/g, ''), 10) : null;
    let ps = psM ? parseInt(psM[1], 10) : null;
    if (kw == null && ps != null) kw = Math.round(ps * PS_TO_KW);
    if (ps == null && kw != null) ps = Math.round(kw / PS_TO_KW);
    return {
        kw: Number.isFinite(kw) && kw > 0 ? kw : null,
        ps: Number.isFinite(ps) && ps > 0 ? ps : null
    };
}

export function parsePs(str) {
    return parsePower(str).ps;
}

export function attrByTag(attributes, tag) {
    if (!Array.isArray(attributes)) return null;
    const a = attributes.find(x => x && x.tag === tag);
    return a ? a.value : null;
}

export function resolveNumericId(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/** mobile.de ms-Parameter: makeId;modelId;modelGroupId; (numerische IDs, nicht Anzeigenamen). */
export function parseMsParam(ms) {
    if (!ms || typeof ms !== 'string') return null;
    const parts = ms.split(';');
    const makeId = (parts[0] || '').trim();
    if (!makeId || !/^\d+$/.test(makeId)) return null;
    const modelId = (parts[1] || '').trim();
    const modelGroupId = (parts[2] || '').trim();
    return {
        makeId,
        modelId: modelId && /^\d+$/.test(modelId) ? modelId : null,
        modelGroupId: modelGroupId && /^\d+$/.test(modelGroupId) ? modelGroupId : null
    };
}

export function formatMsParam(makeId, modelId, modelGroupId) {
    const m = resolveNumericId(makeId);
    if (!m) return null;
    const mod = resolveNumericId(modelId);
    const grp = resolveNumericId(modelGroupId);
    if (mod) return m + ';' + mod + ';' + (grp || '') + ';';
    return m + ';;;';
}

export function getMsFromPageUrl(href) {
    try {
        const u = new URL(href || location.href);
        return u.searchParams.get('ms');
    } catch (e) {
        return null;
    }
}

export function extractIdsFromAd(ad) {
    if (!ad) return {};
    const makeId = resolveNumericId(
        ad.makeId ?? ad.make?.id ?? ad.make?.key ?? ad.vehicle?.makeId
    );
    const modelId = resolveNumericId(
        ad.modelId ?? ad.model?.id ?? ad.model?.key ?? ad.vehicle?.modelId
    );
    const modelGroupId = resolveNumericId(
        ad.modelGroupId ?? ad.modelGroup?.id ?? ad.vehicle?.modelGroupId
    );
    return { makeId, modelId, modelGroupId };
}

export function normalizeMakeModelLabel(s) {
    return cleanText(s || '').replace(/\s+/g, ' ').trim();
}

export function scoreMakeModelLabelMatch(label, target) {
    const l = normalizeMakeModelLabel(label);
    const t = normalizeMakeModelLabel(target);
    if (!l || !t) return -1;
    if (l === t) return 1000;
    if (l.startsWith(t)) return 500 + t.length;
    if (t.startsWith(l)) return 100 + l.length;
    return -1;
}

export function matchSelectOptionValue(selectEl, target) {
    if (!selectEl || !target) return null;
    let best = null;
    let bestScore = -1;
    for (const opt of selectEl.options) {
        if (!opt.value) continue;
        const score = scoreMakeModelLabelMatch(opt.textContent, target);
        if (score > bestScore) {
            bestScore = score;
            best = opt.value;
        }
    }
    return bestScore >= 100 ? best : null;
}

export function readMakeModelCache(makeId) {
    try {
        const raw = sessionStorage.getItem(MAKE_MODEL_CACHE_PREFIX + makeId);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

export function writeMakeModelCache(makeId, map) {
    try {
        sessionStorage.setItem(MAKE_MODEL_CACHE_PREFIX + makeId, JSON.stringify(map));
    } catch (e) { /* noop */ }
}

export function readAdMakeModelCache(adId) {
    if (!adId) return null;
    try {
        const raw = sessionStorage.getItem(MAKE_MODEL_AD_CACHE_PREFIX + adId);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

export function writeAdMakeModelCache(adId, data) {
    if (!adId || !data) return;
    try {
        sessionStorage.setItem(MAKE_MODEL_AD_CACHE_PREFIX + adId, JSON.stringify(data));
    } catch (e) { /* noop */ }
}

export function modelIdFromCache(map, modelName) {
    if (!map || !modelName) return null;
    const target = normalizeMakeModelLabel(modelName);
    let best = null;
    let bestScore = -1;
    for (const [label, id] of Object.entries(map)) {
        const score = scoreMakeModelLabelMatch(label, target);
        if (score > bestScore) {
            bestScore = score;
            best = id;
        }
    }
    return bestScore >= 100 ? best : null;
}

/** Lädt Modell-Optionen für Marke (select[name=md]) – IDs wie auf mobile.de-Suche. */
export function loadModelOptionsForMakeId(makeId) {
    const cached = readMakeModelCache(makeId);
    if (cached && Object.keys(cached).length > 2) {
        return Promise.resolve(cached);
    }
    return new Promise(resolve => {
        const mk = document.querySelector('select[name="mk"]');
        const md = document.querySelector('select[name="md"]');
        if (!mk || !md) {
            resolve(null);
            return;
        }
        const collect = () => {
            const map = {};
            for (const opt of md.options) {
                if (!opt.value) continue;
                const label = (opt.textContent || '').trim();
                if (label) map[label] = opt.value;
            }
            if (Object.keys(map).length < 2) return null;
            writeMakeModelCache(makeId, map);
            return map;
        };
        if (mk.value === String(makeId) && md.options.length > 2) {
            resolve(collect());
            return;
        }
        mk.value = String(makeId);
        mk.dispatchEvent(new Event('change', { bubbles: true }));
        let tries = 0;
        const poll = () => {
            const map = collect();
            if (map) {
                resolve(map);
                return;
            }
            if (++tries > 40) {
                resolve(null);
                return;
            }
            setTimeout(poll, 100);
        };
        poll();
    });
}

export function applyMakeModelIdsToProfile(profile, makeId, modelId, modelGroupId) {
    if (!profile) return profile;
    if (makeId) profile.makeId = String(makeId);
    if (modelId) profile.modelId = String(modelId);
    if (modelGroupId) profile.modelGroupId = String(modelGroupId);
    profile.searchMs = formatMsParam(profile.makeId, profile.modelId, profile.modelGroupId) || profile.searchMs || '';
    return profile;
}

async function resolveMakeModelIdsForProfile(profile) {
    if (!profile) return profile;
    const adId = profile.id;
    const cachedAd = readAdMakeModelCache(adId);
    if (cachedAd && cachedAd.makeId) {
        return applyMakeModelIdsToProfile(profile, cachedAd.makeId, cachedAd.modelId, cachedAd.modelGroupId);
    }

    const pageMs = getMsFromPageUrl();
    if (pageMs) {
        const parsed = parseMsParam(pageMs);
        if (parsed) {
            applyMakeModelIdsToProfile(profile, parsed.makeId, parsed.modelId, parsed.modelGroupId);
            writeAdMakeModelCache(adId, {
                makeId: profile.makeId,
                modelId: profile.modelId,
                modelGroupId: profile.modelGroupId,
                searchMs: profile.searchMs
            });
            return profile;
        }
    }

    const fromAd = extractIdsFromAd(getVipAdFromState(adId));
    if (fromAd.makeId) {
        applyMakeModelIdsToProfile(profile, fromAd.makeId, fromAd.modelId, fromAd.modelGroupId);
        writeAdMakeModelCache(adId, {
            makeId: profile.makeId,
            modelId: profile.modelId,
            modelGroupId: profile.modelGroupId,
            searchMs: profile.searchMs
        });
        return profile;
    }

    if (profile.makeId && profile.modelId) {
        profile.searchMs = formatMsParam(profile.makeId, profile.modelId, profile.modelGroupId) || profile.searchMs;
        return profile;
    }

    let makeId = profile.makeId || matchSelectOptionValue(document.querySelector('select[name="mk"]'), profile.make);
    if (!makeId) return profile;

    let modelId = profile.modelId
        || matchSelectOptionValue(document.querySelector('select[name="md"]'), profile.model);
    if (!modelId && profile.model) {
        const map = await loadModelOptionsForMakeId(makeId);
        modelId = modelIdFromCache(map, profile.model);
    }

    applyMakeModelIdsToProfile(profile, makeId, modelId, profile.modelGroupId);
    writeAdMakeModelCache(adId, {
        makeId: profile.makeId,
        modelId: profile.modelId,
        modelGroupId: profile.modelGroupId,
        searchMs: profile.searchMs
    });
    return profile;
}

export function enrichProfileWithSearchMs(profile, adId) {
    if (!profile) return profile;
    const cachedAd = readAdMakeModelCache(adId || profile.id);
    if (cachedAd && cachedAd.makeId) {
        return applyMakeModelIdsToProfile(profile, cachedAd.makeId, cachedAd.modelId, cachedAd.modelGroupId);
    }
    const fromAd = extractIdsFromAd(getVipAdFromState(adId || profile.id));
    if (fromAd.makeId) {
        applyMakeModelIdsToProfile(profile, fromAd.makeId, fromAd.modelId, fromAd.modelGroupId);
        return profile;
    }
    const pageMs = getMsFromPageUrl();
    if (pageMs) {
        const parsed = parseMsParam(pageMs);
        if (parsed) {
            applyMakeModelIdsToProfile(profile, parsed.makeId, parsed.modelId, parsed.modelGroupId);
            return profile;
        }
    }
    const mk = document.querySelector('select[name="mk"]');
    const md = document.querySelector('select[name="md"]');
    const makeId = matchSelectOptionValue(mk, profile.make);
    const modelId = matchSelectOptionValue(md, profile.model);
    if (makeId || modelId) {
        applyMakeModelIdsToProfile(profile, makeId || profile.makeId, modelId || profile.modelId, profile.modelGroupId);
    }
    return profile;
}

export function buildVehicleProfileFromAd(ad, adId) {
    if (!ad) return null;
    const attrs = ad.attributes || [];
    const ids = extractIdsFromAd(ad);
    const power = parsePower(attrByTag(attrs, 'power'));
    return {
        id: String(adId || ad.id || getAdIdFromUrl() || ''),
        make: ad.make || '',
        model: ad.model || '',
        makeId: ids.makeId || '',
        modelId: ids.modelId || '',
        modelGroupId: ids.modelGroupId || '',
        searchMs: formatMsParam(ids.makeId, ids.modelId, ids.modelGroupId) || '',
        modelRange: attrByTag(attrs, 'modelRange') || '',
        trimLine: attrByTag(attrs, 'trimLine') || '',
        title: ad.title || '',
        subTitle: ad.subTitle || '',
        priceGross: ad.price?.grossAmount ?? parseEuroAmount(ad.price?.gross),
        mileageKm: parseKm(attrByTag(attrs, 'mileage')),
        firstRegistrationYear: parseYear(attrByTag(attrs, 'firstRegistration')),
        powerKw: power.kw,
        powerPs: power.ps,
        fuel: attrByTag(attrs, 'fuel') || '',
        transmission: attrByTag(attrs, 'transmission') || '',
        category: attrByTag(attrs, 'category') || '',
        features: Array.isArray(ad.features) ? ad.features : [],
        priceRating: ad.priceRating || null,
        attributes: attrs
    };
}

/**
 * Anker für VIP-Preisbewertung: Sidebar-Preiszeile (48.950 € / Guter Preis),
 * nicht die ausführliche Preis-Box weiter unten mit Finanzierung.
 */
export function getVipPriceRatingAnchor() {
    const aside = document.querySelector('aside.iKWwq');
    if (aside) {
        const row = aside.querySelector('.wNWsk');
        if (row) return row;
        const label = aside.querySelector('[data-testid="vip-price-label"]');
        if (label) {
            return label.closest('.wNWsk') || label.parentElement || label;
        }
    }
    return document.querySelector('[data-testid="vip-price-box"]');
}

export function buildVehicleProfileDomFallback() {
    const id = getAdIdFromUrl();
    const aside = document.querySelector('aside.iKWwq');
    const priceEl = (aside && aside.querySelector('[data-testid="vip-price-label"]'))
        || document.querySelector('[data-testid="vip-price-label"]');
    const priceGross = priceEl ? parseEuroAmount(priceEl.textContent) : null;
    const techDl = getTechDataDl();
    const attrs = {};
    if (techDl) {
        techDl.querySelectorAll('dt').forEach(dt => {
            const dd = dt.nextElementSibling;
            if (dd) attrs[dt.textContent.trim()] = dd.textContent.trim();
        });
    }
    const h = document.querySelector('h1, h2');
    const power = parsePower(attrs['Leistung']);
    return {
        id: id || '',
        make: '',
        model: '',
        modelRange: attrs['Baureihe'] || '',
        trimLine: attrs['Ausstattungslinie'] || '',
        title: h ? h.textContent.trim() : '',
        subTitle: '',
        priceGross,
        mileageKm: parseKm(attrs['Kilometerstand']),
        firstRegistrationYear: parseYear(attrs['Erstzulassung']),
        powerKw: power.kw,
        powerPs: power.ps,
        fuel: attrs['Kraftstoffart'] || '',
        transmission: attrs['Getriebe'] || '',
        category: attrs['Kategorie'] || '',
        features: getFeatureItems().map(li => li.textContent.trim()),
        priceRating: null,
        attributes: []
    };
}

export let vehicleProfileMemo = { key: '', ts: 0, profile: null };

export function getVehicleProfileMemoKey(adId) {
    const id = adId || getAdIdFromUrl() || '';
    const cfg = getPriceRating(runtimeState.featureFlags);
    const desc = isVehicleDetailPage() && getDescriptionEl()
        ? (getDescriptionEl().textContent || '').length
        : 0;
    return [
        location.pathname,
        id,
        cfg.onlyFavoriteWeights ? 1 : 0,
        cfg.kmToleranceAbs,
        cfg.yearTolerance,
        cfg.powerToleranceKw,
        desc
    ].join('|');
}

export function buildVehicleProfile(adId) {
    const memoKey = getVehicleProfileMemoKey(adId);
    const now = Date.now();
    if (vehicleProfileMemo.key === memoKey && (now - vehicleProfileMemo.ts) < 1200) {
        return vehicleProfileMemo.profile ? { ...vehicleProfileMemo.profile } : null;
    }
    const id = adId || getAdIdFromUrl();
    const ad = getVipAdFromState(id);
    let profile = null;
    if (ad) profile = buildVehicleProfileFromAd(ad, id);
    else if (isVehicleDetailPage()) profile = buildVehicleProfileDomFallback();
    const enriched = enrichProfileWithSearchMs(profile, id);
    vehicleProfileMemo = { key: memoKey, ts: now, profile: enriched ? { ...enriched } : null };
    return enriched;
}

export function getPreisGewichtForConfig(cfg, prCfg) {
    if (!cfg) return 0;
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    if (pr.onlyFavoriteWeights && cfg.favorit !== true) return 0;
    const w = cfg.preisGewicht;
    if (typeof w === 'number' && w > 0) return w;
    const key = (cfg.anzeige || '').trim().toLowerCase();
    return DEFAULT_PREIS_GEWICHT_BY_ANZEIGE[key] || 0;
}

export function matchTitleTokensToConfigs(text, configs, keys, breakdown) {
    if (!text) return;
    const parts = String(text).split(/[+/,·|]/).map(s => s.trim()).filter(Boolean);
    const blob = cleanText(text);
    configs.forEach(cfg => {
        if (!cfg.aktiv) return;
        if (cfg.nurInFeatures === true) return;
        const key = (cfg.anzeige || '').trim().toLowerCase();
        if (!key || keys.has(key)) return;
        const weight = getPreisGewichtForConfig(cfg);
        if (weight <= 0) return;
        let hit = false;
        for (const b of (cfg.begriffe || [])) {
            const bt = cleanText(b);
            if (!bt || bt.length < 2) continue;
            if (blob.includes(bt)) { hit = true; break; }
            for (const p of parts) {
                if (cleanText(p).includes(bt) || bt.includes(cleanText(p))) {
                    hit = true;
                    break;
                }
            }
            if (hit) break;
        }
        if (!hit) return;
        keys.add(key);
        breakdown.push({
            key,
            label: cfg.anzeige,
            weight,
            source: 'title'
        });
    });
}

export function equipmentFingerprintForTexts(texts, configs) {
    const keys = new Set();
    const breakdown = [];
    const sources = [];
    if (texts.titleBlob) {
        sources.push({
            id: 'title',
            confidence: 'high',
            text: texts.titleBlob,
            tokens: tokenize(texts.titleBlob)
        });
    }
    if (texts.featuresText) {
        sources.push({
            id: 'features',
            confidence: 'high',
            text: texts.featuresText,
            tokens: tokenize(texts.featuresText)
        });
    }
    if (texts.descriptionText) {
        const conf = classifyDescription(texts.descriptionText);
        sources.push({
            id: 'description',
            confidence: conf,
            text: texts.descriptionText.replace(/,/g, ' '),
            tokens: tokenize(texts.descriptionText)
        });
    }
    const hits = collectConfigMatches(sources, configs);
    hits.forEach(hit => {
        const cfg = configs.find(c => cleanText(c.anzeige) === cleanText(hit.anzeige));
        const key = (hit.anzeige || '').trim().toLowerCase();
        if (!key || keys.has(key)) return;
        const weight = getPreisGewichtForConfig(cfg);
        if (weight <= 0) return;
        keys.add(key);
        breakdown.push({
            key,
            label: hit.anzeige,
            weight,
            source: hit.source || 'match'
        });
    });
    matchTitleTokensToConfigs(texts.titleBlob || '', configs, keys, breakdown);
    const score = breakdown.reduce((s, b) => s + b.weight, 0);
    return { keys, score, breakdown };
}

export function equipmentFingerprintFromProfile(profile) {
    const configs = runtimeState.suchKonfigurationen;
    if (isVehicleDetailPage() && document.querySelector('[data-testid="vip-features-list"]')) {
        const rawItems = extractRawEquipmentItems();
        const keys = new Set();
        const breakdown = [];
        rawItems.forEach(raw => {
            const cfg = findConfigEntryForRawLabel(raw.label);
            if (!cfg || !cfg.aktiv) return;
            const key = (cfg.anzeige || '').trim().toLowerCase();
            if (!key || keys.has(key)) return;
            const weight = getPreisGewichtForConfig(cfg);
            if (weight <= 0) return;
            keys.add(key);
            breakdown.push({
                key,
                label: cfg.anzeige,
                weight,
                source: raw.source || 'features'
            });
        });
        matchTitleTokensToConfigs(
            [profile.title, profile.subTitle].filter(Boolean).join(' '),
            configs,
            keys,
            breakdown
        );
        const score = breakdown.reduce((s, b) => s + b.weight, 0);
        return { keys, score, breakdown };
    }
    const featuresText = (profile.features || []).join(' | ');
    const descEl = isVehicleDetailPage() ? getDescriptionEl() : null;
    const descriptionText = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';
    return equipmentFingerprintForTexts({
        titleBlob: [profile.title, profile.subTitle].filter(Boolean).join(' '),
        featuresText,
        descriptionText
    }, configs);
}

export function profileFromComparableAd(ad) {
    if (!ad) return null;
    const id = ad.id || ad.adId;
    return buildVehicleProfileFromAd(ad, id);
}

export function buildCohortSearchUrl(profile, prCfg) {
    const useModelRange = !prCfg || prCfg.useModelRange !== false;
    const u = new URL('https://suchen.mobile.de/fahrzeuge/search.html');
    u.searchParams.set('isSearchRequest', 'true');
    u.searchParams.set('scopeId', 'C');
    u.searchParams.set('vc', 'Car');
    u.searchParams.set('s', 'Car');
    u.searchParams.set('dam', 'false');
    const modelGroupId = useModelRange ? profile.modelGroupId : null;
    const ms = useModelRange
        ? (profile.searchMs || formatMsParam(profile.makeId, profile.modelId, modelGroupId))
        : formatMsParam(profile.makeId, profile.modelId, null);
    if (ms) {
        u.searchParams.set('ms', ms);
    } else if (profile.makeId) {
        u.searchParams.set('mk', profile.makeId);
        if (profile.modelId) u.searchParams.set('md', profile.modelId);
    } else if (profile.make && profile.model) {
        u.searchParams.set('userInput', (profile.make + ' ' + profile.model).trim());
    } else if (profile.make) {
        u.searchParams.set('userInput', profile.make.trim());
    }
    if (profile.mileageKm != null) {
        const tolKm = Math.max(0, parseInt(prCfg.kmToleranceAbs, 10) || 0);
        const min = Math.max(0, Math.floor(profile.mileageKm - tolKm));
        const max = Math.ceil(profile.mileageKm + tolKm);
        u.searchParams.set('ml', min + ':' + max);
    }
    if (profile.firstRegistrationYear != null) {
        const yTol = prCfg.yearTolerance || 1;
        const yMin = profile.firstRegistrationYear - yTol;
        const yMax = profile.firstRegistrationYear + yTol;
        u.searchParams.set('fr', yMin + ':' + yMax);
    }
    const powerKw = profile.powerKw != null
        ? profile.powerKw
        : (profile.powerPs != null ? Math.round(profile.powerPs * PS_TO_KW) : null);
    if (powerKw != null) {
        const pTolKw = Math.max(0, parseInt(prCfg.powerToleranceKw, 10) || 0);
        const pMin = Math.max(1, Math.floor(powerKw - pTolKw));
        const pMax = Math.ceil(powerKw + pTolKw);
        u.searchParams.set('pw', pMin + ':' + pMax);
    }
    return u.toString();
}

/** Gleiche Filter-Mitten wie in buildCohortSearchUrl / profileFromSearchPageUrl (Cache-Treffer VIP ↔ SRP). */
export function profileForCohortCacheKey(profile, prCfg) {
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    const useModelRange = pr.useModelRange !== false;
    const useMileage = pr.keyUseMileage !== false;
    const useYear = pr.keyUseYear !== false;
    const usePower = pr.keyUsePower !== false;
    const kmBucket = Math.max(500, parseInt(pr.keyKmBucket, 10) || 5000);
    const yearBucketRaw = Math.max(1, parseInt(pr.keyYearBucket, 10) || 1);
    const yearTol = Math.max(0, parseInt(pr.yearTolerance, 10) || 0);
    // Respect EZ tolerance in cache matching: with ±1 years, 2022 and 2023 should map together.
    const yearBucket = Math.max(yearBucketRaw, (yearTol * 2) + 1);
    const powerBucket = Math.max(1, parseInt(pr.keyPowerBucket, 10) || 10);
    const p = {
        makeId: profile.makeId || '',
        modelId: profile.modelId || '',
        make: profile.make || '',
        model: profile.model || '',
        modelRange: useModelRange ? (profile.modelRange || '') : '',
        mileageKm: useMileage ? profile.mileageKm : null,
        firstRegistrationYear: useYear ? profile.firstRegistrationYear : null,
        powerKw: usePower ? profile.powerKw : null,
        powerPs: usePower ? profile.powerPs : null
    };
    if (p.mileageKm != null) {
        const tolKm = Math.max(0, parseInt(pr.kmToleranceAbs, 10) || 0);
        const min = Math.max(0, Math.floor(p.mileageKm - tolKm));
        const max = Math.ceil(p.mileageKm + tolKm);
        const mid = Math.round((min + max) / 2);
        p.mileageKm = Math.round(mid / kmBucket) * kmBucket;
    }
    if (p.firstRegistrationYear != null) {
        p.firstRegistrationYear = Math.floor(p.firstRegistrationYear / yearBucket) * yearBucket;
    }
    if (p.powerKw == null && p.powerPs != null) {
        p.powerKw = Math.round(p.powerPs * PS_TO_KW);
    }
    if (p.powerKw != null) {
        const pTolKw = Math.max(0, parseInt(pr.powerToleranceKw, 10) || 0);
        const min = Math.max(1, Math.floor(p.powerKw - pTolKw));
        const max = Math.ceil(p.powerKw + pTolKw);
        const mid = Math.round((min + max) / 2);
        p.powerKw = Math.round(mid / powerBucket) * powerBucket;
        p.powerPs = null;
    }
    return p;
}

export function cohortCacheKey(profile, prCfg) {
    const p = profileForCohortCacheKey(profile, prCfg);
    return [
        p.makeId || p.make,
        p.modelId || p.model,
        p.modelRange,
        p.mileageKm,
        p.firstRegistrationYear,
        p.powerKw || p.powerPs
    ].join('|').toLowerCase();
}

export function cohortHumanLabel(profile, prCfg) {
    if (!profile) return null;
    const p = profileForCohortCacheKey(profile, prCfg);
    const model = [p.make || p.makeId || '', p.model || p.modelId || '']
        .filter(Boolean)
        .join(' ')
        .trim();
    const parts = [];
    if (model) parts.push(model);
    if (typeof p.firstRegistrationYear === 'number') parts.push('EZ-Bucket ' + p.firstRegistrationYear);
    if (typeof p.mileageKm === 'number') parts.push('km-Bucket ' + p.mileageKm.toLocaleString('de-DE'));
    if (typeof p.powerKw === 'number') parts.push('kW-Bucket ' + p.powerKw);
    return parts.join(' | ');
}

export function createEmptyPriceDataStore() {
    return {
        version: PRICE_DATA_STORE_VERSION,
        updatedTs: Date.now(),
        adsById: {},
        cohortsByKey: {},
        anchorsByAdId: {}
    };
}

export function readPriceDataStore() {
    try {
        const raw = localStorage.getItem(PRICE_DATA_STORE_KEY);
        if (!raw) return createEmptyPriceDataStore();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return createEmptyPriceDataStore();
        if (parsed.version !== PRICE_DATA_STORE_VERSION) return createEmptyPriceDataStore();
        parsed.adsById = parsed.adsById && typeof parsed.adsById === 'object' ? parsed.adsById : {};
        parsed.cohortsByKey = parsed.cohortsByKey && typeof parsed.cohortsByKey === 'object' ? parsed.cohortsByKey : {};
        parsed.anchorsByAdId = parsed.anchorsByAdId && typeof parsed.anchorsByAdId === 'object' ? parsed.anchorsByAdId : {};
        return parsed;
    } catch (e) {
        return createEmptyPriceDataStore();
    }
}

export function prunePriceDataStore(store, nowTs) {
    if (!store || typeof store !== 'object') return createEmptyPriceDataStore();
    const now = nowTs || Date.now();
    const maxAge = PRICE_COHORT_CACHE_TTL_MS;
    const cohorts = Object.entries(store.cohortsByKey || {})
        .filter(([, c]) => c && typeof c.ts === 'number' && (now - c.ts) <= maxAge && Array.isArray(c.adIds) && c.adIds.length > 0)
        .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    const keptCohorts = cohorts.slice(0, PRICE_DATA_STORE_MAX_COHORTS);
    store.cohortsByKey = Object.fromEntries(keptCohorts);

    const anchors = Object.entries(store.anchorsByAdId || {})
        .filter(([, a]) => a && typeof a.ts === 'number' && (now - a.ts) <= maxAge)
        .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
        .slice(0, 300);
    store.anchorsByAdId = Object.fromEntries(anchors);

    const keepAdIds = new Set();
    keptCohorts.forEach(([, c]) => {
        (c.adIds || []).forEach(id => keepAdIds.add(String(id)));
    });
    anchors.forEach(([id]) => keepAdIds.add(String(id)));
    Object.entries(store.adsById || {}).forEach(([id, ad]) => {
        if (!ad || typeof ad !== 'object') return;
        if (typeof ad.ts === 'number' && (now - ad.ts) <= maxAge) keepAdIds.add(String(id));
    });

    const ads = Object.entries(store.adsById || {})
        .filter(([id, ad]) => keepAdIds.has(String(id)) && ad && typeof ad === 'object')
        .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
        .slice(0, PRICE_DATA_STORE_MAX_ADS);
    store.adsById = Object.fromEntries(ads);
    store.updatedTs = now;
    return store;
}

export function writePriceDataStore(store) {
    try {
        const pruned = prunePriceDataStore(store, Date.now());
        localStorage.setItem(PRICE_DATA_STORE_KEY, JSON.stringify(pruned));
        return true;
    } catch (e) {
        return false;
    }
}

export function normalizeAdForPriceStore(profile, ts) {
    if (!profile || !profile.id) return null;
    const id = String(profile.id);
    const out = {
        id,
        ts: ts || Date.now(),
        make: profile.make || '',
        model: profile.model || '',
        makeId: profile.makeId || '',
        modelId: profile.modelId || '',
        modelGroupId: profile.modelGroupId || '',
        modelRange: profile.modelRange || '',
        title: profile.title || '',
        priceGross: typeof profile.priceGross === 'number' ? profile.priceGross : null,
        mileageKm: typeof profile.mileageKm === 'number' ? profile.mileageKm : null,
        firstRegistrationYear: typeof profile.firstRegistrationYear === 'number' ? profile.firstRegistrationYear : null,
        powerKw: typeof profile.powerKw === 'number' ? profile.powerKw : null,
        powerPs: typeof profile.powerPs === 'number' ? profile.powerPs : null,
        fuel: profile.fuel || '',
        transmission: profile.transmission || '',
        equipment: profile.equipment && typeof profile.equipment.score === 'number'
            ? {
                score: profile.equipment.score,
                breakdown: Array.isArray(profile.equipment.breakdown) ? profile.equipment.breakdown : []
            }
            : null,
        equipmentFromVipCache: !!profile.equipmentFromVipCache
    };
    return out;
}

export function upsertPriceDataStoreAds(items, ts) {
    if (!Array.isArray(items) || !items.length) return;
    const store = readPriceDataStore();
    const now = ts || Date.now();
    items.forEach(item => {
        const ad = normalizeAdForPriceStore(item, now);
        if (!ad) return;
        store.adsById[ad.id] = mergePriceDataStoreAdEntry(store.adsById[ad.id], ad, now);
    });
    writePriceDataStore(store);
}

/** SRP-Kohorte darf echte VIP-Ausstattung nicht mit SRP-Fingerprint überschreiben. */
export function mergePriceDataStoreAdEntry(prev, ad, ts) {
    const merged = { ...(prev || {}), ...ad, ts: ts || Date.now() };
    if (prev && prev.equipmentFromVipCache && prev.equipment) {
        merged.equipment = prev.equipment;
        merged.equipmentFromVipCache = true;
    }
    return merged;
}

export function writePriceDataStoreCohort(cacheKey, items, ts) {
    if (!cacheKey || !Array.isArray(items) || !items.length) return;
    const now = ts || Date.now();
    const store = readPriceDataStore();
    const adIds = [];
    items.forEach(item => {
        const ad = normalizeAdForPriceStore(item, now);
        if (!ad) return;
        store.adsById[ad.id] = mergePriceDataStoreAdEntry(store.adsById[ad.id], ad, now);
        adIds.push(ad.id);
    });
    if (!adIds.length) return;
    const uniqueAdIds = [...new Set(adIds)];
    store.cohortsByKey[cacheKey] = {
        ts: now,
        adIds: uniqueAdIds,
        count: uniqueAdIds.length,
        vipDetails: items.filter(c => c && c.equipmentFromVipCache).length
    };
    writePriceDataStore(store);
}

export function readPriceDataStoreCohort(cacheKey) {
    if (!cacheKey) return null;
    const store = readPriceDataStore();
    const cohort = store.cohortsByKey[cacheKey];
    if (!cohort || typeof cohort.ts !== 'number') return null;
    if (Date.now() - cohort.ts > PRICE_COHORT_CACHE_TTL_MS) return null;
    const out = [];
    (cohort.adIds || []).forEach(id => {
        const ad = store.adsById[String(id)];
        if (!ad || typeof ad !== 'object') return;
        const item = { ...ad };
        if (item.equipment && typeof item.equipment.score === 'number') {
            item.equipmentFromVipCache = !!item.equipmentFromVipCache;
        }
        out.push(item);
    });
    return out.length ? out : null;
}

export function mergePriceDataStoreImport(rawStore) {
    if (!rawStore || typeof rawStore !== 'object') return { mergedAds: 0, mergedCohorts: 0, mergedAnchors: 0 };
    const incomingAds = rawStore.adsById && typeof rawStore.adsById === 'object' ? rawStore.adsById : {};
    const incomingCohorts = rawStore.cohortsByKey && typeof rawStore.cohortsByKey === 'object' ? rawStore.cohortsByKey : {};
    const incomingAnchors = rawStore.anchorsByAdId && typeof rawStore.anchorsByAdId === 'object' ? rawStore.anchorsByAdId : {};
    const store = readPriceDataStore();
    let mergedAds = 0;
    let mergedCohorts = 0;
    let mergedAnchors = 0;

    Object.entries(incomingAds).forEach(([id, ad]) => {
        if (!ad || typeof ad !== 'object') return;
        const key = String(id);
        const prev = store.adsById[key];
        const inTs = typeof ad.ts === 'number' ? ad.ts : 0;
        const prevTs = prev && typeof prev.ts === 'number' ? prev.ts : 0;
        if (!prev || inTs >= prevTs) {
            store.adsById[key] = { ...prev, ...ad, id: key };
            mergedAds += 1;
        }
    });
    Object.entries(incomingCohorts).forEach(([key, cohort]) => {
        if (!cohort || typeof cohort !== 'object' || !Array.isArray(cohort.adIds)) return;
        const prev = store.cohortsByKey[key];
        const inTs = typeof cohort.ts === 'number' ? cohort.ts : 0;
        const prevTs = prev && typeof prev.ts === 'number' ? prev.ts : 0;
        if (!prev || inTs >= prevTs) {
            store.cohortsByKey[key] = {
                ts: inTs || Date.now(),
                adIds: cohort.adIds.map(v => String(v)).filter(Boolean),
                count: typeof cohort.count === 'number' ? cohort.count : cohort.adIds.length,
                vipDetails: typeof cohort.vipDetails === 'number' ? cohort.vipDetails : 0
            };
            mergedCohorts += 1;
        }
    });
    store.anchorsByAdId = store.anchorsByAdId && typeof store.anchorsByAdId === 'object' ? store.anchorsByAdId : {};
    Object.entries(incomingAnchors).forEach(([id, anchor]) => {
        if (!anchor || typeof anchor !== 'object') return;
        const key = String(id);
        const prev = store.anchorsByAdId[key];
        const inTs = typeof anchor.ts === 'number' ? anchor.ts : 0;
        const prevTs = prev && typeof prev.ts === 'number' ? prev.ts : 0;
        if (!prev || inTs >= prevTs) {
            store.anchorsByAdId[key] = { ...prev, ...anchor };
            mergedAnchors += 1;
        }
    });
    const ok = writePriceDataStore(store);
    return ok ? { mergedAds, mergedCohorts, mergedAnchors } : { mergedAds: 0, mergedCohorts: 0, mergedAnchors: 0 };
}

export function profileFromVipCohortAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') return null;
    return {
        makeId: anchor.makeId || '',
        modelId: anchor.modelId || '',
        make: anchor.make || '',
        model: anchor.model || '',
        modelRange: anchor.modelRange || '',
        mileageKm: anchor.mileageKm,
        firstRegistrationYear: anchor.firstRegistrationYear,
        powerKw: anchor.powerKw,
        powerPs: null
    };
}

export function readVipCohortAnchors() {
    const store = readPriceDataStore();
    const now = Date.now();
    return Object.entries(store.anchorsByAdId || {})
        .filter(([, a]) => a && typeof a.ts === 'number' && (now - a.ts) <= PRICE_COHORT_CACHE_TTL_MS)
        .map(([adId, anchor]) => ({ adId, anchor }));
}

export function persistVipCohortAnchor(profile, prCfg) {
    if (!profile || !profile.id) return;
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    if (!(profile.makeId || profile.make) || !(profile.modelId || profile.model)) return;
    const cacheKey = cohortCacheKey(profile, pr);
    if (!cacheKey) return;
    const bucketed = profileForCohortCacheKey(profile, pr);
    const anchor = {
        cacheKey,
        makeId: bucketed.makeId || '',
        modelId: bucketed.modelId || '',
        modelRange: bucketed.modelRange || '',
        mileageKm: bucketed.mileageKm,
        firstRegistrationYear: bucketed.firstRegistrationYear,
        powerKw: bucketed.powerKw,
        make: profile.make || '',
        model: profile.model || '',
        ts: Date.now()
    };
    const store = readPriceDataStore();
    store.anchorsByAdId = store.anchorsByAdId && typeof store.anchorsByAdId === 'object' ? store.anchorsByAdId : {};
    store.anchorsByAdId[String(profile.id)] = anchor;
    writePriceDataStore(store);
    priceRatingDebugLog('VIP-Kohorten-Anker gespeichert', { adId: profile.id, cacheKey });
}

export function cohortCacheStorageKey(key) {
    return PRICE_COHORT_CACHE_PREFIX + key;
}

export function readCohortCache(key) {
    const fromStore = readPriceDataStoreCohort(key);
    if (fromStore && fromStore.length) return fromStore;
    const storageKey = cohortCacheStorageKey(key);
    try {
        let raw = localStorage.getItem(storageKey);
        if (!raw) {
            raw = sessionStorage.getItem(storageKey);
            if (raw) {
                try {
                    localStorage.setItem(storageKey, raw);
                    sessionStorage.removeItem(storageKey);
                } catch (e) { /* noop */ }
            }
        }
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > PRICE_COHORT_CACHE_TTL_MS) return null;
        const items = parsed.items || null;
        if (Array.isArray(items) && items.length) writePriceDataStoreCohort(key, items, parsed.ts || Date.now());
        return items;
    } catch (e) {
        return null;
    }
}

export function notifyCohortCacheUpdated() {
    try {
        localStorage.setItem(PRICE_COHORT_CACHE_PREFIX + '_updated', String(Date.now()));
    } catch (e) { /* noop */ }
}

export function writeCohortCache(key, items) {
    try {
        writePriceDataStoreCohort(key, items, Date.now());
        localStorage.setItem(cohortCacheStorageKey(key), JSON.stringify({
            ts: Date.now(),
            items
        }));
        notifyCohortCacheUpdated();
    } catch (e) { /* noop */ }
}

export function mergeCohortCache(key, newItems) {
    if (!key || !Array.isArray(newItems) || !newItems.length) return 0;
    const existing = readCohortCache(key) || [];
    const byId = new Map();
    existing.forEach(it => {
        if (it && it.id) byId.set(String(it.id), it);
    });
    newItems.forEach(it => {
        if (it && it.id) byId.set(String(it.id), it);
    });
    const merged = [...byId.values()];
    if (merged.length < 1) return 0;
    writeCohortCache(key, merged);
    return merged.length;
}

export function findCohortItemsFromStoreByProfile(profile, prCfg) {
    if (!profile) return [];
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    const store = readPriceDataStore();
    const now = Date.now();
    const byId = new Map();
    Object.entries(store.cohortsByKey || {}).forEach(([, cohort]) => {
        if (!cohort || typeof cohort.ts !== 'number' || (now - cohort.ts) > PRICE_COHORT_CACHE_TTL_MS) return;
        (cohort.adIds || []).forEach(id => {
            const ad = store.adsById[String(id)];
            if (!ad || typeof ad !== 'object') return;
            const item = { ...ad };
            if (item.equipment && typeof item.equipment.score === 'number') {
                item.equipmentFromVipCache = !!item.equipmentFromVipCache;
            }
            if (!itemMatchesCohortProfile(item, profile, pr)) return;
            byId.set(String(id), item);
        });
    });
    return [...byId.values()];
}

export function vipEquipCacheStorageKey(adId) {
    return PRICE_VIP_EQUIP_CACHE_PREFIX + String(adId || '');
}

export function readVipEquipCache(adId) {
    if (!adId) return null;
    try {
        const store = readPriceDataStore();
        const ad = store.adsById[String(adId)];
        if (ad && ad.equipmentFromVipCache && ad.equipment && typeof ad.equipment.score === 'number') {
            return ad.equipment;
        }
    } catch (e) { /* noop */ }
    try {
        const raw = localStorage.getItem(vipEquipCacheStorageKey(adId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.equipment || typeof parsed.equipment.score !== 'number') return null;
        if (Date.now() - (parsed.ts || 0) > PRICE_COHORT_CACHE_TTL_MS) return null;
        return parsed.equipment;
    } catch (e) {
        return null;
    }
}

export function writeVipEquipCache(adId, equipment) {
    if (!adId || !equipment || typeof equipment.score !== 'number') return;
    try {
        const store = readPriceDataStore();
        const key = String(adId);
        const prev = store.adsById[key] || { id: key };
        store.adsById[key] = {
            ...prev,
            id: key,
            ts: Date.now(),
            equipment: {
                score: equipment.score,
                breakdown: Array.isArray(equipment.breakdown) ? equipment.breakdown : []
            },
            equipmentFromVipCache: true
        };
        writePriceDataStore(store);
        localStorage.setItem(vipEquipCacheStorageKey(adId), JSON.stringify({
            ts: Date.now(),
            equipment: {
                score: equipment.score,
                breakdown: Array.isArray(equipment.breakdown) ? equipment.breakdown : []
            }
        }));
    } catch (e) { /* noop */ }
}

export function profileFromSearchPageUrl(href) {
    try {
        const u = new URL(href, location.origin);
        if (!/\/fahrzeuge\/search\.html/.test(u.pathname)) return null;
        const p = {
            make: '',
            model: '',
            makeId: '',
            modelId: '',
            modelGroupId: '',
            searchMs: '',
            searchMsList: [],
            modelIdList: [],
            modelRange: '',
            mileageKm: null,
            firstRegistrationYear: null,
            powerKw: null,
            powerPs: null,
            fuel: '',
            transmission: ''
        };
        const msValues = u.searchParams.getAll('ms').filter(Boolean);
        if (msValues.length) {
            p.searchMsList = msValues;
            p.searchMs = msValues[0];
            const parsedList = msValues
                .map(v => parseMsParam(v))
                .filter(Boolean);
            if (parsedList.length) {
                p.makeId = parsedList[0].makeId || '';
                p.modelId = parsedList[0].modelId || '';
                p.modelGroupId = parsedList[0].modelGroupId || '';
                p.modelIdList = [...new Set(parsedList.map(x => x.modelId || '').filter(Boolean))];
            }
        }
        const midRange = param => {
            const v = u.searchParams.get(param);
            if (!v || !v.includes(':')) return null;
            const a = parseInt(v.split(':')[0], 10);
            const b = parseInt(v.split(':')[1], 10);
            if (Number.isNaN(a) || Number.isNaN(b)) return null;
            return Math.round((a + b) / 2);
        };
        p.mileageKm = midRange('ml');
        p.firstRegistrationYear = midRange('fr');
        p.powerKw = midRange('pw');
        return p;
    } catch (e) {
        return null;
    }
}

export function parseCohortItemsFromState(state, excludeId) {
    const rawList = findSrpListingsInState(state);
    return rawList
        .map(normalizeComparableAd)
        .filter(Boolean)
        .filter(c => !excludeId || String(c.id) !== String(excludeId));
}

/** SRP-Treffer mit ms/URL-Kontext anreichern, damit Cache-Keys zu VIP (3500|335|…) passen. */
export function enrichCohortItemFromSearchContext(item, searchProfile) {
    if (!item || !searchProfile) return item;
    const out = { ...item };
    if (!out.makeId && searchProfile.makeId) out.makeId = String(searchProfile.makeId);
    if (!out.modelId && searchProfile.modelId) out.modelId = String(searchProfile.modelId);
    if (!out.modelGroupId && searchProfile.modelGroupId) out.modelGroupId = String(searchProfile.modelGroupId);
    return out;
}

export function sameMakeModelForCohort(item, profile) {
    const iMake = String((item && (item.makeId || item.make)) || '').toLowerCase();
    const iModel = String((item && (item.modelId || item.model)) || '').toLowerCase();
    const pMake = String((profile && (profile.makeId || profile.make)) || '').toLowerCase();
    const pModel = String((profile && (profile.modelId || profile.model)) || '').toLowerCase();
    return !!(iMake && iModel && pMake && pModel && iMake === pMake && iModel === pModel);
}

/** Treffer innerhalb der Such-Toleranzen (wie buildCohortSearchUrl), nicht exakter Bucket-Key pro Inserat. */
export function itemMatchesCohortProfile(item, profile, prCfg) {
    if (!item || !profile) return false;
    if (!sameMakeModelForCohort(item, profile)) return false;
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    if (pr.keyUseMileage !== false && profile.mileageKm != null && item.mileageKm != null) {
        const tol = Math.max(0, parseInt(pr.kmToleranceAbs, 10) || 0);
        if (Math.abs(item.mileageKm - profile.mileageKm) > tol) return false;
    }
    if (pr.keyUseYear !== false && profile.firstRegistrationYear != null && item.firstRegistrationYear != null) {
        const tol = Math.max(0, parseInt(pr.yearTolerance, 10) || 0);
        if (Math.abs(item.firstRegistrationYear - profile.firstRegistrationYear) > tol) return false;
    }
    if (pr.keyUsePower !== false) {
        const pKw = profile.powerKw != null
            ? profile.powerKw
            : (profile.powerPs != null ? Math.round(profile.powerPs * PS_TO_KW) : null);
        const iKw = item.powerKw != null
            ? item.powerKw
            : (item.powerPs != null ? Math.round(item.powerPs * PS_TO_KW) : null);
        if (pKw != null && iKw != null) {
            const tol = Math.max(0, parseInt(pr.powerToleranceKw, 10) || 0);
            if (Math.abs(iKw - pKw) > tol) return false;
        }
    }
    return true;
}

export function cohortItemsForSearchProfile(items, searchProfile, prCfg) {
    if (!searchProfile || !(searchProfile.makeId || searchProfile.make)) return [];
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    return (items || [])
        .map(it => enrichCohortItemFromSearchContext(it, searchProfile))
        .filter(it => itemMatchesCohortProfile(it, searchProfile, pr));
}

/**
 * Kohorte aus Suchergebnisliste (__INITIAL_STATE__) — kein fetch, kein VIP-Besuch.
 * Einzelne Inseratsseiten füllen den Cache nicht; Tab teilt localStorage.
 */
export function syncCohortCacheFromSearchPage() {
    if (!isSearchResultsPage()) return;
    const state = getPageInitialState();
    if (!state) {
        priceRatingDebugLog('SRP-Cache-Sync übersprungen: kein __INITIAL_STATE__');
        return;
    }
    const items = parseCohortItemsFromState(state, null);
    if (items.length < 3) {
        priceRatingDebugLog('SRP-Cache-Sync übersprungen: zu wenige SRP-Treffer', { count: items.length });
        return;
    }
    const prCfg = getPriceRating(runtimeState.featureFlags);
    const urlProf = profileFromSearchPageUrl(location.href);
    const enriched = urlProf
        ? items.map(it => enrichCohortItemFromSearchContext(it, urlProf))
        : items;
    const cacheKeyForItem = item => {
        if (!item) return '';
        const ctx = urlProf ? enrichCohortItemFromSearchContext(item, urlProf) : item;
        return cohortCacheKey(ctx, prCfg);
    };
    const byKey = new Map();
    enriched.forEach(item => {
        if (!item || !(item.makeId || item.make) || !(item.modelId || item.model)) return;
        const key = cacheKeyForItem(item);
        if (!key) return;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(item);
    });
    let written = 0;
    let anchorMerged = 0;
    if (urlProf && (urlProf.makeId || urlProf.make) && (urlProf.modelId || urlProf.model)) {
        const searchKey = cohortCacheKey(urlProf, prCfg);
        const searchCohort = cohortItemsForSearchProfile(enriched, urlProf, prCfg);
        if (searchCohort.length >= 3) {
            writeCohortCache(searchKey, searchCohort);
            written += 1;
            priceRatingDebugLog('Kohorte unter Such-URL-Key gecacht', {
                searchKey,
                count: searchCohort.length,
                cohortHuman: cohortHumanLabel(urlProf, prCfg)
            });
        }
    }
    readVipCohortAnchors().forEach(({ adId, anchor }) => {
        const anchorProf = profileFromVipCohortAnchor(anchor);
        if (!anchorProf) return;
        const anchorKey = anchor.cacheKey || cohortCacheKey(anchorProf, prCfg);
        if (!anchorKey) return;
        const forAnchor = enriched.filter(it =>
            it && itemMatchesCohortProfile(it, anchorProf, prCfg)
        );
        if (forAnchor.length < 3) return;
        const mergedCount = mergeCohortCache(anchorKey, forAnchor);
        if (mergedCount >= 3) {
            anchorMerged += 1;
            priceRatingDebugLog('SRP-Kohorte in VIP-Anker-Key gemerged', {
                adId,
                anchorKey,
                count: mergedCount
            });
        }
    });
    if (!byKey.size && !written && !anchorMerged) {
        priceRatingDebugLog('SRP-Cache-Sync übersprungen: keine modellgenauen Cache-Keys aus Treffern ableitbar');
        return;
    }
    byKey.forEach((cohortItems, key) => {
        if (cohortItems.length < 3) return;
        writeCohortCache(key, cohortItems);
        written += 1;
    });
    if (!written && !anchorMerged) {
        priceRatingDebugLog('SRP-Cache-Sync übersprungen: modellgenaue Kohorten zu klein', { groups: byKey.size });
        return;
    }
    notifyCohortCacheUpdated();
    const top = [...byKey.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 6)
        .map(([key, list]) => ({ cacheKey: key, count: list.length }));
    priceRatingDebugLog('Kohorten aus SRP gecacht', {
        totalItems: items.length,
        groups: byKey.size,
        writtenGroups: written,
        anchorMerged,
        searchUrlKey: urlProf ? cohortCacheKey(urlProf, prCfg) : null,
        topGroups: top
    });
    debugLog('ui', 'SRP-Kohorten in Cache synchronisiert', { groups: byKey.size, writtenGroups: written, anchorMerged });
}

export function findSrpListingsInState(state) {
    if (!state || typeof state !== 'object') return [];
    const tryList = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (Array.isArray(v.items)) return v.items;
        if (Array.isArray(v.ads)) return v.ads;
        if (Array.isArray(v.results)) return v.results;
        if (Array.isArray(v.searchResults)) return v.searchResults;
        if (Array.isArray(v.listings)) return v.listings;
        if (typeof v === 'object') {
            const vals = Object.values(v);
            if (vals.length && vals.every(x => x && (x.id || x.ad || x.data))) {
                return vals.map(x => x.ad || x.data?.ad || x);
            }
        }
        return [];
    };
    const explicitPaths = [
        state?.search?.srp?.ads,
        state?.search?.srp?.items,
        state?.search?.srp?.searchResults,
        state?.search?.srp?.results,
        state?.search?.srp?.resultList,
        state?.search?.srp?.listings,
        state?.search?.results,
        state?.search?.resultList,
        state?.search?.listings
    ];
    for (const p of explicitPaths) {
        const list = tryList(p);
        if (list.length >= 3) return list;
    }

    const isAdLike = (entry) => {
        if (!entry) return false;
        const ad = entry?.ad || entry?.data?.ad || entry;
        if (!ad || typeof ad !== 'object') return false;
        return !!(ad.id || ad.adId || ad.mobileAdId)
            && !!(ad.price || ad.prices || ad.make || ad.model || ad.title || ad.vehicleDescription);
    };

    let best = [];
    const queue = [state?.search?.srp, state?.search, state].filter(Boolean);
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    let visited = 0;
    const MAX_OBJECTS = 4000;
    while (queue.length && visited < MAX_OBJECTS) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object') continue;
        if (seen) {
            if (seen.has(cur)) continue;
            seen.add(cur);
        }
        visited += 1;
        const candidate = tryList(cur);
        if (candidate.length >= 3) {
            const adLikeCount = candidate.reduce((acc, x) => acc + (isAdLike(x) ? 1 : 0), 0);
            if (adLikeCount >= Math.max(3, Math.floor(candidate.length * 0.5))) {
                if (adLikeCount > best.length) best = candidate;
            }
        }
        if (Array.isArray(cur)) {
            cur.forEach(v => {
                if (v && typeof v === 'object') queue.push(v);
            });
        } else {
            Object.values(cur).forEach(v => {
                if (v && typeof v === 'object') queue.push(v);
            });
        }
    }
    return best;
}

export function normalizeComparableAd(raw) {
    const ad = raw?.ad || raw?.data?.ad || raw;
    if (!ad || !ad.price) return null;
    const price = ad.price.grossAmount ?? parseEuroAmount(ad.price.gross);
    if (price == null || price <= 0) return null;
    const prof = buildVehicleProfileFromAd(ad, ad.id);
    if (!prof) return null;
    const cachedEquip = readVipEquipCache(prof.id);
    if (cachedEquip) {
        prof.equipment = cachedEquip;
        prof.equipmentFromVipCache = true;
    } else {
        prof.equipment = equipmentFingerprintFromProfile(prof);
    }
    return prof;
}

export function countCohortVipDetailCount(items) {
    return (items || []).filter(c => c && c.equipmentFromVipCache).length;
}

/** VIP-Besuch kann nach SRP-Cache kommen — beim Lesen erneut anreichern. */
export function enrichCohortItemsWithVipCache(items) {
    if (!Array.isArray(items)) return [];
    return items.map(c => {
        if (!c || !c.id) return c;
        const cachedEquip = readVipEquipCache(c.id);
        if (!cachedEquip) return c;
        return { ...c, equipment: cachedEquip, equipmentFromVipCache: true };
    });
}

export const cohortComparablesMemo = new Map();
export const COHORT_COMPARABLES_MEMO_TTL_MS = 1500;

export function pruneCohortComparablesMemo(nowTs) {
    const now = nowTs || Date.now();
    cohortComparablesMemo.forEach((entry, key) => {
        if (!entry || typeof entry.ts !== 'number' || (now - entry.ts) >= COHORT_COMPARABLES_MEMO_TTL_MS) {
            cohortComparablesMemo.delete(key);
        }
    });
}

/** Kohorte nur aus localStorage-Cache oder aktueller Suchseite — kein Hintergrund-fetch. */
export function getCohortComparables(profile, prCfg) {
    const uniqueModelCount = (list) => {
        const s = new Set();
        (list || []).forEach(item => {
            const mk = (item && (item.makeId || item.make) || '').toLowerCase();
            const md = (item && (item.modelId || item.model) || '').toLowerCase();
            if (mk || md) s.add(mk + '|' + md);
        });
        return s.size;
    };
    const now = Date.now();
    pruneCohortComparablesMemo(now);
    const cacheKey = cohortCacheKey(profile, prCfg);
    const memo = cohortComparablesMemo.get(cacheKey);
    if (memo && (now - memo.ts) < COHORT_COMPARABLES_MEMO_TTL_MS) {
        priceRatingDebugLog('Kohorte aus Memo', {
            cacheKey,
            count: memo.value && memo.value.items ? memo.value.items.length : 0
        });
        return memo.value;
    }
    const cached = readCohortCache(cacheKey);
    if (cached && cached.length) {
        const items = enrichCohortItemsWithVipCache(cached);
        priceRatingDebugLog('Kohorte aus Cache', {
            cacheKey,
            count: items.length,
            vipDetails: countCohortVipDetailCount(items),
            uniqueModelsInSource: uniqueModelCount(items),
            storeSource: 'local-cache'
        });
        const out = { items, fromCache: true, cacheKey };
        cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
        return out;
    }

    const fromStoreScan = enrichCohortItemsWithVipCache(findCohortItemsFromStoreByProfile(profile, prCfg));
    if (fromStoreScan.length >= 3) {
        writeCohortCache(cacheKey, fromStoreScan);
        priceRatingDebugLog('Kohorte aus Store-Scan (passende Keys)', {
            cacheKey,
            count: fromStoreScan.length,
            vipDetails: countCohortVipDetailCount(fromStoreScan),
            uniqueModelsInSource: uniqueModelCount(fromStoreScan),
            storeSource: 'store-scan'
        });
        const out = { items: fromStoreScan, fromCache: true, cacheKey, storeScan: true };
        cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
        return out;
    }

    if (isSearchResultsPage()) {
        const state = getPageInitialState();
        const urlProf = profileFromSearchPageUrl(location.href);
        const urlHasMakeModel = urlProf && (urlProf.makeId || urlProf.make) && (urlProf.modelId || urlProf.model);
        if (urlHasMakeModel && !sameMakeModelForCohort(urlProf, profile)) {
            priceRatingDebugLog('SRP ignoriert: URL-Profil passt nicht zum angeforderten Profil', {
                cacheKey,
                urlMake: urlProf.makeId || urlProf.make,
                urlModel: urlProf.modelId || urlProf.model,
                profMake: profile.makeId || profile.make,
                profModel: profile.modelId || profile.model
            });
        } else {
            const enrichCtx = urlHasMakeModel && sameMakeModelForCohort(urlProf, profile) ? urlProf : profile;
            const fromPage = enrichCohortItemsWithVipCache(
                parseCohortItemsFromState(state, profile.id)
            )
                .map(item => enrichCohortItemFromSearchContext(item, enrichCtx))
                .filter(item => itemMatchesCohortProfile(item, profile, prCfg));
            if (fromPage.length >= 3) {
                writeCohortCache(cacheKey, fromPage);
                priceRatingDebugLog('Kohorte von aktueller SRP', {
                    cacheKey,
                    count: fromPage.length,
                    vipDetails: countCohortVipDetailCount(fromPage),
                    uniqueModelsInSource: uniqueModelCount(fromPage),
                    storeSource: 'current-srp'
                });
                const out = { items: fromPage, fromCache: false, fromPage: true, cacheKey };
                cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
                return out;
            }
            priceRatingDebugLog('SRP ohne ausreichend Treffer', { cacheKey, count: fromPage.length });
        }
    }

    priceRatingDebugLog('Keine Kohorte — Vergleichssuche nötig', { cacheKey });
    const out = { items: [], needsManualSearch: true, cacheKey };
    cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
    return out;
}

async function openCohortSearchTab(profile) {
    const resolved = await resolveMakeModelIdsForProfile(profile || buildVehicleProfile());
    const url = buildCohortSearchUrl(resolved, getPriceRating(runtimeState.featureFlags));
    window.open(url, '_blank', 'noopener');
}

export function median(nums) {
    const arr = nums.filter(n => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

export function mobileMarketPriceFromRating(priceRating) {
    if (!priceRating) return null;
    const labels = priceRating.thresholdLabels;
    if (!Array.isArray(labels) || labels.length < 2) return null;
    const amounts = labels.map(parseEuroAmount).filter(n => n != null);
    if (amounts.length < 2) return null;
    const offset = typeof priceRating.vehiclePriceOffset === 'number'
        ? priceRating.vehiclePriceOffset
        : 50;
    const t = Math.max(0, Math.min(1, offset / 100));
    const min = amounts[0];
    const max = amounts[amounts.length - 1];
    return min + (max - min) * t;
}

export function clampAdjust(base, delta, maxPct) {
    const cap = base * (maxPct || 0.12);
    if (delta > cap) return cap;
    if (delta < -cap) return -cap;
    return delta;
}

export function deviationToLevel(devPct, thresholds) {
    const th = thresholds || PRICE_RATING_DEFAULT.thresholds;
    for (let i = 0; i < th.length; i++) {
        if (devPct <= th[i].maxPct) {
            return th[i].level;
        }
    }
    return 4;
}

export function computePriceRating(profile, comparables, options) {
    const prCfg = getPriceRating(runtimeState.featureFlags);
    const ownEquip = options?.equipment || equipmentFingerprintFromProfile(profile);
    const ownScore = ownEquip.score;
    const price = profile.priceGross;
    priceRatingDebugLog('Preisbewertung Start', {
        adId: profile && profile.id,
        price,
        ownScore,
        comparables: Array.isArray(comparables) ? comparables.length : 0,
        minComparables: prCfg.minComparables,
        punktZuEuro: prCfg.punktZuEuro,
        maxAdjustPct: prCfg.maxAdjustPct,
        useModelRange: prCfg.useModelRange !== false,
        keyUseMileage: prCfg.keyUseMileage !== false,
        keyUseYear: prCfg.keyUseYear !== false,
        keyUsePower: prCfg.keyUsePower !== false,
        keyKmBucket: prCfg.keyKmBucket,
        keyYearBucket: prCfg.keyYearBucket,
        keyPowerBucket: prCfg.keyPowerBucket,
        kmToleranceAbs: prCfg.kmToleranceAbs,
        yearTolerance: prCfg.yearTolerance,
        powerToleranceKw: prCfg.powerToleranceKw
    });
    if (price == null || price <= 0) {
        priceRatingDebugLog('Preisbewertung Abbruch: kein Preis', { adId: profile && profile.id, price });
        return { ok: false, reason: 'no_price' };
    }

    let basePrice = null;
    let cohortCount = 0;
    let usedMobileFallback = false;
    const equipScores = (comparables || []).map(c => (c.equipment && c.equipment.score) || 0);
    const prices = (comparables || []).map(c => c.priceGross).filter(n => n > 0);

    if (prices.length >= prCfg.minComparables) {
        basePrice = median(prices);
        cohortCount = prices.length;
        priceRatingDebugLog('Baseline aus Kohorte', { cohortCount, basePrice: Math.round(basePrice || 0) });
    } else if (prCfg.mobileFallback && profile.priceRating) {
        basePrice = mobileMarketPriceFromRating(profile.priceRating);
        usedMobileFallback = true;
        cohortCount = prices.length;
        priceRatingDebugLog('Baseline aus mobile-Fallback', {
            cohortCount,
            mobileLabel: profile.priceRating?.ratingLabel || null,
            basePrice: Math.round(basePrice || 0)
        });
    } else if (prices.length >= 5) {
        basePrice = median(prices);
        cohortCount = prices.length;
        usedMobileFallback = true;
        priceRatingDebugLog('Baseline aus kleiner Kohorte (Fallback-Flag)', { cohortCount, basePrice: Math.round(basePrice || 0) });
    }

    if (basePrice == null || basePrice <= 0) {
        priceRatingDebugLog('Preisbewertung Abbruch: keine Baseline', {
            adId: profile && profile.id,
            cohortCount: prices.length,
            mobileFallback: prCfg.mobileFallback
        });
        return { ok: false, reason: 'no_baseline', cohortCount: prices.length };
    }

    const medianEquip = equipScores.length ? median(equipScores) : 0;
    const equipDelta = ownScore - (medianEquip || 0);
    const rawAdjust = equipDelta * prCfg.punktZuEuro;
    const adjust = clampAdjust(basePrice, rawAdjust, prCfg.maxAdjustPct);
    const adjustedExpected = basePrice + adjust;
    const devPct = (price - adjustedExpected) / adjustedExpected;
    const level = deviationToLevel(devPct, prCfg.thresholds);
    const label = (PRICE_RATING_LEVELS[level] && PRICE_RATING_LEVELS[level].label) || 'Fairer Preis';
    priceRatingDebugLog('Preisbewertung Rechenweg', {
        basePrice: Math.round(basePrice),
        ownScore,
        medianEquip,
        equipDelta,
        rawAdjust: Math.round(rawAdjust),
        adjustEuro: Math.round(adjust),
        adjustedExpected: Math.round(adjustedExpected),
        devPct: Math.round(devPct * 10000) / 100,
        level,
        label
    });

    const minP = prices.length ? Math.min(...prices) : basePrice * 0.85;
    const maxP = prices.length ? Math.max(...prices) : basePrice * 1.15;
    const span = maxP - minP || 1;
    const offset = Math.max(0, Math.min(100, Math.round(((price - minP) / span) * 100)));

    const topBreakdown = [...ownEquip.breakdown]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5);

    return {
        ok: true,
        label,
        level,
        offset,
        price,
        basePrice: Math.round(basePrice),
        adjustedExpected: Math.round(adjustedExpected),
        devPct,
        devEuro: Math.round(price - adjustedExpected),
        ownScore,
        medianEquip,
        equipDelta,
        adjustEuro: Math.round(adjust),
        cohortCount,
        usedMobileFallback,
        insufficientCohort: cohortCount < prCfg.minComparables,
        breakdown: topBreakdown,
        mobileLabel: profile.priceRating?.ratingLabel || null,
        cohortVipDetailCount: 0
    };
}

export function enrichRatingWithCohortMeta(rating, cohortRes) {
    if (!rating) return rating;
    const items = (cohortRes && cohortRes.items) || [];
    rating.cohortVipDetailCount = countCohortVipDetailCount(items);
    if (cohortRes && cohortRes.cacheKey) rating.cohortCacheKey = cohortRes.cacheKey;
    return rating;
}

export function formatCohortCountText(rating, opts) {
    const forModal = opts && opts.forModal;
    let txt = forModal
        ? (rating.cohortCount + ' Vergleichsfahrzeuge')
        : ('Vergleich: ' + rating.cohortCount + ' Fahrzeuge');
    if (rating.cohortVipDetailCount > 0) {
        txt += ' (davon ' + rating.cohortVipDetailCount + ' mit VIP-Details)';
    }
    if (forModal && rating.usedMobileFallback && rating.cohortCount > 0) {
        txt += ' (mobile.de-Marktpreis als Basis)';
    }
    if (rating.insufficientCohort && rating.cohortCount > 0) {
        txt += forModal ? ' — wenige Treffer, Ergebnis mit Vorsicht' : ' (weniger als Minimum — mobile.de-Fallback)';
    } else if (!forModal && rating.usedMobileFallback && rating.cohortCount === 0) {
        txt += ' (nur mobile.de-Marktpreis, keine Kohorte im Cache)';
    }
    return txt;
}

export function readRatingCache(adId) {
    try {
        const raw = sessionStorage.getItem(PRICE_RATING_CACHE_PREFIX + adId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > PRICE_COHORT_CACHE_TTL_MS) return null;
        return parsed.rating;
    } catch (e) {
        return null;
    }
}

export function readRatingUiCache(adId) {
    if (!adId) return null;
    try {
        const raw = localStorage.getItem(PRICE_RATING_UI_CACHE_PREFIX + adId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - (parsed.ts || 0) > PRICE_RATING_UI_CACHE_TTL_MS) return null;
        return parsed.rating || null;
    } catch (e) {
        return null;
    }
}

export function writeRatingCache(adId, rating) {
    try {
        sessionStorage.setItem(PRICE_RATING_CACHE_PREFIX + adId, JSON.stringify({
            ts: Date.now(),
            rating
        }));
        localStorage.setItem(PRICE_RATING_UI_CACHE_PREFIX + adId, JSON.stringify({
            ts: Date.now(),
            rating
        }));
    } catch (e) { /* noop */ }
}

export let priceRatingFetchToken = 0;

export function priceRatingFetchTokenIncrement() { priceRatingFetchToken++; }

function scheduleStaleRatingRetry(profile) {
    const adId = profile && profile.id ? String(profile.id) : '';
    if (!adId) {
        renderVipPriceRatingWidget(null, false);
        return;
    }
    setTimeout(() => {
        if (!isVehicleDetailPage()) return;
        const current = buildVehicleProfile();
        if (!current || String(current.id) !== adId) return;
        preisBewertungAktualisieren({ force: true });
    }, 80);
}

export let vipRatingUpdateInFlight = false;
export let vipRatingLastRunSig = '';
export let vipRatingLastRunTs = 0;
export let vipRatingUiBootstrapped = false;

export function resetVipRatingUiOnNavigation() {
    vipRatingUiBootstrapped = false;
}

export function disconnectSrpPriceRatingObserver() {
    if (srpPriceRatingIo) {
        srpPriceRatingIo.disconnect();
        srpPriceRatingIo = null;
    }
}
export const inflightRatingByAdId = new Map();
export let srpPriceRatingIo = null;
export const SRP_DEBUG_LOG_MAX_ENTRIES = 100;
export let srpDebugLogEntries = [];

export function injectPriceRatingStyles() {
    if (document.getElementById('mobilede-price-rating-style')) return;
    const st = document.createElement('style');
    st.id = 'mobilede-price-rating-style';
    st.textContent = `
.mobilede-price-rating{
  display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;
  border-top:1px solid rgba(255,255,255,.08);font-size:13px;line-height:1.35;
}
.mobilede-price-rating--sidebar{
  margin-top:8px;padding-top:8px;width:100%;box-sizing:border-box;
}
.mobilede-price-rating--sidebar .mobilede-price-rating__bar{width:18px;}
.mobilede-price-rating__row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;}
.mobilede-price-rating__bars{display:flex;gap:3px;align-items:center;}
.mobilede-price-rating__bar{
  width:22px;height:6px;border-radius:2px;background:rgba(255,255,255,.15);
}
.mobilede-price-rating__bar--on{background:#3ddc84;}
.mobilede-price-rating__bar--on.level-0{background:#2ecc71;}
.mobilede-price-rating__bar--on.level-1{background:#52d869;}
.mobilede-price-rating__bar--on.level-2{background:#f0c040;}
.mobilede-price-rating__bar--on.level-3{background:#e8a040;}
.mobilede-price-rating__bar--on.level-4{background:#e07070;}
.mobilede-price-rating__label{font-weight:600;color:var(--mdr-text,#f2f3f5);}
.mobilede-price-rating__sub{font-size:11px;opacity:.75;color:var(--mdr-muted,#aeb0ba);}
.mobilede-price-rating__tag{
  font-size:10px;padding:1px 6px;border-radius:4px;
  background:rgba(255,255,255,.08);color:var(--mdr-muted,#aeb0ba);
}
.mobilede-price-rating__info{
  cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  border:1px solid rgba(174,176,186,.65);background:transparent;color:var(--mdr-muted,#aeb0ba);
  font-size:12px;font-weight:700;line-height:1;padding:0;
  font-family:"Segoe UI",Tahoma,Arial,sans-serif;
}
.mobilede-price-rating__info:hover{
  border-color:rgba(255,255,255,.9);background:rgba(255,255,255,.08);color:#fff;
}
.mobilede-price-rating--loading .mobilede-price-rating__bars{opacity:.4;}
.mobilede-price-rating-modal{
  position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.55);padding:16px;box-sizing:border-box;
}
.mobilede-price-rating-modal__box{
  max-width:420px;width:100%;max-height:85vh;overflow:auto;
  background:#25262c;color:#f2f3f5;border-radius:10px;padding:16px 18px;
  box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:13px;line-height:1.45;
}
.mobilede-price-rating-modal__box h4{margin:0 0 8px;font-size:15px;}
.mobilede-price-rating-modal__box p{margin:0 0 10px;opacity:.9;}
.mobilede-price-rating-modal__box ul{margin:0 0 12px;padding-left:18px;}
.mobilede-price-rating-modal__open-search{
  display:block;margin:0 0 12px;padding:8px 14px;border-radius:6px;border:1px solid #1976d2;
  cursor:pointer;background:#1976d2;color:#fff;font:inherit;font-size:13px;
}
.mobilede-price-rating-modal__open-search:hover{filter:brightness(1.08);}
.mobilede-price-rating-modal__close{
  margin-top:8px;padding:8px 14px;border-radius:6px;border:0;cursor:pointer;
  background:#3a3d46;color:#f0f1f3;font:inherit;
}
.mobilede-srp-price-badge{
  display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle;
  font-size:11px;line-height:1;white-space:nowrap;
}
.mobilede-srp-price-badge__bars{display:flex;gap:2px;}
.mobilede-srp-price-badge__bar{width:10px;height:4px;border-radius:1px;background:rgba(255,255,255,.2);}
.mobilede-srp-price-badge__bar--on{background:#3ddc84;}
.mobilede-srp-price-badge__text{opacity:.9;font-weight:500;}
.mobilede-srp-debug-card{
  margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.10);border-radius:10px;
  background:linear-gradient(180deg,rgba(64,68,79,.55),rgba(52,56,66,.45));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);color:#f0f1f3;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  width:100%;box-sizing:border-box;
}
.mobilede-srp-debug-card__title{font-size:13px;font-weight:600;line-height:1.25;margin-bottom:8px;opacity:.95;}
.mobilede-srp-debug-card__actions{display:flex;flex-wrap:wrap;gap:6px;}
.mobilede-srp-debug-card__btn{
  appearance:none;cursor:pointer;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.045);color:#f0f1f3;font-size:12px;line-height:1.2;
}
.mobilede-srp-debug-card__btn:hover{background:rgba(255,255,255,.10);}
.mobilede-srp-debug-card__btn:disabled{
  opacity:.45;cursor:not-allowed;background:rgba(255,255,255,.02);
  border-color:rgba(255,255,255,.08);color:rgba(240,241,243,.6);
}
.mobilede-srp-debug-card__log{
  margin-top:8px;max-height:220px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,.09);
  background:rgba(0,0,0,.22);padding:7px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:1.4;color:#dfe2e8;white-space:pre-wrap;word-break:break-word;
}
.mobilede-srp-debug-card__log-line{margin-bottom:5px;}
.mobilede-srp-debug-card__log-line:last-child{margin-bottom:0;}
.mobilede-srp-debug-card__log-line--warn{color:#ffd59e;}
.mobilede-srp-debug-card__log-line--error{color:#ffb6b6;}
.mobilede-srp-debug-card--detail{
  margin-top:8px;margin-bottom:14px;
  border-color:rgba(255,255,255,.08);
  background:linear-gradient(180deg,rgba(58,62,73,.35),rgba(46,50,60,.28));
  box-shadow:none;
}
.mobilede-srp-debug-card--detail .mobilede-srp-debug-card__title{
  font-size:12.5px;margin-bottom:7px;opacity:.9;
}
.mobilede-srp-debug-card--detail .mobilede-srp-debug-card__log{
  max-height:160px;background:rgba(0,0,0,.16);border-color:rgba(255,255,255,.07);
}
`;
    document.head.appendChild(st);
}

export function renderRatingBars(level, small) {
    const wrap = document.createElement('div');
    wrap.className = small ? 'mobilede-srp-price-badge__bars' : 'mobilede-price-rating__bars';
    for (let i = 0; i < 5; i++) {
        const bar = document.createElement('span');
        bar.className = (small ? 'mobilede-srp-price-badge__bar' : 'mobilede-price-rating__bar')
            + (i <= level ? ' mobilede-' + (small ? 'srp-price-badge' : 'price-rating') + '__bar--on' : '')
            + (i <= level ? ' level-' + level : '');
        wrap.appendChild(bar);
    }
    return wrap;
}

export function openPriceRatingModal(rating, profile) {
    document.querySelectorAll('.mobilede-price-rating-modal').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'mobilede-price-rating-modal';
    const box = document.createElement('div');
    box.className = 'mobilede-price-rating-modal__box';
    const h = document.createElement('h4');
    h.textContent = 'Preisbewertung (ausstattungsbereinigt)';
    box.appendChild(h);
    if (rating.needsCohortSearch) {
        const pBlock = document.createElement('p');
        pBlock.textContent = 'Für den Median-Basispreis die Vergleichssuche öffnen und auf der '
            + 'Suchergebnisseite bleiben (Liste muss laden). Geöffnete Inserate helfen zusätzlich für präzisere '
            + 'Ausstattungs-Scores (inkl. Beschreibungstext), erhöhen aber nicht die Kohortenanzahl. '
            + 'Die Trefferliste wird lokal zwischengespeichert (auch im neuen Tab) — keine Hintergrund-Anfragen.';
        box.appendChild(pBlock);
        if (profile) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'mobilede-price-rating-modal__open-search';
            openBtn.textContent = 'Vergleichssuche öffnen';
            openBtn.addEventListener('click', () => openCohortSearchTab(profile));
            box.appendChild(openBtn);
        }
    }
    const p1 = document.createElement('p');
    p1.textContent = rating.label + ' — Angebot ' + rating.price.toLocaleString('de-DE') + ' € vs. erwartet ~'
        + rating.adjustedExpected.toLocaleString('de-DE') + ' € (' +
        (rating.devEuro >= 0 ? '+' : '') + rating.devEuro.toLocaleString('de-DE') + ' €, ' +
        (rating.devPct * 100).toFixed(1) + ' %).';
    box.appendChild(p1);
    const p2 = document.createElement('p');
    p2.textContent = formatCohortCountText(rating, { forModal: true }) + '. Basispreis Median: ' + rating.basePrice.toLocaleString('de-DE')
        + ' €. Ausstattung: dein Score ' + rating.ownScore.toFixed(1) + ' vs. Median '
        + (rating.medianEquip || 0).toFixed(1) + ' (Δ ' + rating.equipDelta.toFixed(1) + ' → '
        + (rating.adjustEuro >= 0 ? '+' : '') + rating.adjustEuro.toLocaleString('de-DE') + ' €).';
    box.appendChild(p2);
    if (rating.mobileLabel) {
        const pm = document.createElement('p');
        pm.textContent = 'mobile.de: ' + rating.mobileLabel + '.';
        box.appendChild(pm);
    }
    if (rating.breakdown && rating.breakdown.length) {
        const ul = document.createElement('ul');
        rating.breakdown.forEach(b => {
            const li = document.createElement('li');
            li.textContent = b.label + ' (' + b.weight + ' Pkt., ' + b.source + ')';
            ul.appendChild(li);
        });
        box.appendChild(ul);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobilede-price-rating-modal__close';
    close.textContent = 'Schließen';
    close.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    box.appendChild(close);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

export function renderVipPriceRatingWidget(rating, loading) {
    const anchor = getVipPriceRatingAnchor();
    if (!anchor) return;
    injectPriceRatingStyles();
    const mainPriceBox = document.querySelector('[data-testid="vip-price-box"]');
    if (mainPriceBox && mainPriceBox !== anchor && !anchor.contains(mainPriceBox)) {
        mainPriceBox.querySelectorAll('.mobilede-price-rating').forEach(el => el.remove());
    }
    const inSidebar = anchor.classList.contains('wNWsk')
        || !!anchor.closest('aside.iKWwq');
    let wrap = anchor.querySelector('.mobilede-price-rating');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'mobilede-price-rating' + (inSidebar ? ' mobilede-price-rating--sidebar' : '');
        anchor.appendChild(wrap);
    } else if (inSidebar) {
        wrap.classList.add('mobilede-price-rating--sidebar');
    }
    wrap.classList.toggle('mobilede-price-rating--loading', !!loading);
    wrap.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'mobilede-price-rating__row';
    if (loading) {
        const lab = document.createElement('span');
        lab.className = 'mobilede-price-rating__label';
        lab.textContent = 'Vergleich wird geladen…';
        row.appendChild(lab);
        wrap.appendChild(row);
        return;
    }
    if (!rating || !rating.ok) {
        const lab = document.createElement('span');
        lab.className = 'mobilede-price-rating__sub';
        if (rating && rating.needsCohortSearch) {
            lab.textContent = 'Vergleichssuche manuell öffnen (ⓘ)';
        } else {
            lab.textContent = rating && rating.reason === 'no_baseline'
                ? 'Preisbewertung: zu wenig Vergleichsdaten'
                : 'Preisbewertung nicht verfügbar';
        }
        row.appendChild(lab);
        if (rating && rating.needsCohortSearch) {
            const info = document.createElement('button');
            info.type = 'button';
            info.className = 'mobilede-price-rating__info';
            info.setAttribute('aria-label', 'Vergleichssuche manuell öffnen');
            info.textContent = '?';
            const prof = buildVehicleProfile();
            info.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (prof) openCohortSearchTab(prof);
            });
            row.appendChild(info);
        }
        wrap.appendChild(row);
        return;
    }
    row.appendChild(renderRatingBars(rating.level, false));
    const label = document.createElement('span');
    label.className = 'mobilede-price-rating__label';
    label.textContent = rating.label;
    row.appendChild(label);
    const tag = document.createElement('span');
    tag.className = 'mobilede-price-rating__tag';
    tag.textContent = 'ausstattungsbereinigt';
    row.appendChild(tag);
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'mobilede-price-rating__info';
    info.setAttribute('aria-label', 'Details zur Preisbewertung');
    info.textContent = '?';
    info.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openPriceRatingModal(rating, buildVehicleProfile());
    });
    row.appendChild(info);
    wrap.appendChild(row);
    const sub = document.createElement('div');
    sub.className = 'mobilede-price-rating__sub';
    let subTxt = formatCohortCountText(rating);
    subTxt += ' · Erwartet ~' + rating.adjustedExpected.toLocaleString('de-DE') + ' €';
    sub.textContent = subTxt;
    wrap.appendChild(sub);
}

export function computeAndCacheRatingForProfile(profile) {
    const t0 = pricePerfMarkStart();
    const prCfg = getPriceRating(runtimeState.featureFlags);
    persistVipCohortAnchor(profile, prCfg);
    const cohortRes = getCohortComparables(profile, prCfg);
    const rating = enrichRatingWithCohortMeta(
        computePriceRating(profile, cohortRes.items),
        cohortRes
    );
    if (cohortRes.needsManualSearch) rating.needsCohortSearch = true;
    if (profile.id && rating.ok) writeRatingCache(profile.id, rating);
    priceRatingDebugLog('Bewertung berechnet', {
        adId: profile.id,
        ok: rating.ok,
        cohortCount: rating.cohortCount,
        vipDetails: rating.cohortVipDetailCount,
        cacheKey: cohortRes.cacheKey,
        ownScore: rating.ownScore,
        medianEquip: rating.medianEquip,
        adjustEuro: rating.adjustEuro
    });
    pricePerfMarkEnd('priceRatingCompute', t0, 50);
    return rating;
}

export function computeAndCacheRatingForProfileAsync(profile) {
    const adId = profile && profile.id ? String(profile.id) : '';
    if (!adId) {
        return new Promise((resolve, reject) => {
            requestIdle(() => {
                try {
                    resolve(computeAndCacheRatingForProfile(profile));
                } catch (err) {
                    reject(err);
                }
            }, 500);
        });
    }
    if (inflightRatingByAdId.has(adId)) return inflightRatingByAdId.get(adId);
    const p = new Promise((resolve, reject) => {
        requestIdle(() => {
            try {
                resolve(computeAndCacheRatingForProfile(profile));
            } catch (err) {
                reject(err);
            }
        }, 500);
    }).finally(() => inflightRatingByAdId.delete(adId));
    inflightRatingByAdId.set(adId, p);
    return p;
}

export function syncVipEquipmentCache(profile) {
    if (!profile || !profile.id || !isVehicleDetailPage()) return;
    persistVipCohortAnchor(profile, getPriceRating(runtimeState.featureFlags));
    const equipment = equipmentFingerprintFromProfile(profile);
    if (equipment && typeof equipment.score === 'number') {
        writeVipEquipCache(profile.id, equipment);
        priceRatingDebugLog('VIP-Ausstattung gecacht', {
            adId: profile.id,
            score: equipment.score,
            features: equipment.breakdown.length,
            fromDescription: equipment.breakdown.some(b => b.source === 'description' || b.source === 'match')
        });
        try {
            localStorage.setItem(PRICE_COHORT_CACHE_PREFIX + '_updated', String(Date.now()));
        } catch (e) { /* noop */ }
    }
}

export function invalidateVipRatingCacheForReload() {
    const id = getAdIdFromUrl();
    if (!id) return;
    try {
        sessionStorage.removeItem(PRICE_RATING_CACHE_PREFIX + id);
    } catch (e) { /* noop */ }
}

export function getVipRatingRunSignature(profile) {
    const pr = getPriceRating(runtimeState.featureFlags);
    const th = (pr.thresholds || []).map(t => String(t.maxPct)).join(',');
    return [
        location.pathname,
        profile && profile.id ? String(profile.id) : '',
        pr.enabled !== false ? 1 : 0,
        pr.enabledVip ? 1 : 0,
        pr.mobileFallback ? 1 : 0,
        pr.useModelRange ? 1 : 0,
        pr.onlyFavoriteWeights ? 1 : 0,
        pr.minComparables,
        pr.punktZuEuro,
        pr.maxAdjustPct,
        pr.kmToleranceAbs,
        pr.yearTolerance,
        pr.powerToleranceKw,
        th
    ].join('|');
}

export async function preisBewertungAktualisieren(opts) {
    const options = opts || {};
    const perfStart = pricePerfMarkStart();
    const prCfg = getPriceRating(runtimeState.featureFlags);
    if (!isVehicleDetailPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledVip) {
        priceRatingDebugLog('Preisbewertung übersprungen', {
            isVehicleDetailPage: isVehicleDetailPage(),
            enabled: isPriceRatingEnabled(prCfg),
            enabledVip: prCfg.enabledVip
        });
        document.querySelectorAll('.mobilede-price-rating').forEach(el => el.remove());
        vipRatingUiBootstrapped = false;
        return;
    }
    if (!options.force && vipRatingUpdateInFlight) {
        priceRatingDebugLog('Preisbewertung übersprungen: Update läuft bereits');
        return;
    }
    const profile = buildVehicleProfile();
    if (!profile || !profile.id) {
        priceRatingDebugLog('Preisbewertung übersprungen: kein Fahrzeugprofil');
        return;
    }
    const runSig = getVipRatingRunSignature(profile);
    const now = Date.now();
    if (!options.force && runSig === vipRatingLastRunSig && (now - vipRatingLastRunTs) < 2500) {
        priceRatingDebugLog('Preisbewertung übersprungen: identische Signatur', { adId: profile.id });
        return;
    }
    vipRatingUpdateInFlight = true;
    try {
        const token = ++priceRatingFetchToken;
        priceRatingDebugLog('Preisbewertung Lauf gestartet', { adId: profile.id, token, force: !!options.force });
        const uiCached = readRatingUiCache(profile.id);
        if (!vipRatingUiBootstrapped) {
            if (uiCached && uiCached.ok) {
                renderVipPriceRatingWidget(uiCached, false);
                priceRatingDebugLog('UI-Cache für Preisbewertung genutzt', { adId: profile.id });
            } else {
                renderVipPriceRatingWidget(null, true);
            }
            vipRatingUiBootstrapped = true;
        }

        try {
            await resolveMakeModelIdsForProfile(profile);
        } catch (e) { /* noop */ }
        if (token !== priceRatingFetchToken) {
            priceRatingDebugLog('Preisbewertung Lauf verworfen: Token gewechselt', { adId: profile.id, token });
            renderVipPriceRatingWidget(readRatingUiCache(profile.id) || null, false);
            scheduleStaleRatingRetry(profile);
            return;
        }

        persistVipCohortAnchor(profile, prCfg);
        syncVipEquipmentCache(profile);

        const cached = readRatingCache(profile.id);
        if (cached && cached.ok && !cached.needsCohortSearch) {
            const cohortRes = getCohortComparables(profile, prCfg);
            if (cohortRes.items.length || !cached.usedMobileFallback) {
                const rating = enrichRatingWithCohortMeta(cached, cohortRes);
                renderVipPriceRatingWidget(rating, false);
                vipRatingLastRunSig = runSig;
                vipRatingLastRunTs = Date.now();
                priceRatingDebugLog('Preisbewertung aus Session-Cache gerendert', {
                    adId: profile.id,
                    cohortCount: rating.cohortCount,
                    usedMobileFallback: rating.usedMobileFallback
                });
                pricePerfMarkEnd('preisBewertungAktualisieren_cached', perfStart, 50);
                return;
            }
            priceRatingDebugLog('Session-Cache vorhanden, aber Recompute nötig', {
                adId: profile.id,
                usedMobileFallback: cached.usedMobileFallback
            });
        }

        let rating;
        try {
            rating = await computeAndCacheRatingForProfileAsync(profile);
        } catch (err) {
            console.error('[mobilede Preis]', err);
            renderVipPriceRatingWidget({ ok: false, reason: 'error' }, false);
            return;
        }
        if (token !== priceRatingFetchToken) {
            priceRatingDebugLog('Preisbewertung Recompute verworfen: Token gewechselt', { adId: profile.id, token });
            renderVipPriceRatingWidget(readRatingUiCache(profile.id) || null, false);
            scheduleStaleRatingRetry(profile);
            return;
        }
        renderVipPriceRatingWidget(rating, false);
        vipRatingLastRunSig = runSig;
        vipRatingLastRunTs = Date.now();
        priceRatingDebugLog('Preisbewertung neu berechnet und gerendert', {
            adId: profile.id,
            ok: rating && rating.ok,
            reason: rating && rating.reason ? rating.reason : null
        });
        pricePerfMarkEnd('preisBewertungAktualisieren_recompute', perfStart, 50);
    } catch (err) {
        console.error('[mobilede Preis]', err);
        renderVipPriceRatingWidget({ ok: false, reason: 'error' }, false);
    } finally {
        vipRatingUpdateInFlight = false;
    }
}

export function findSrpListingRoots() {
    const links = document.querySelectorAll('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
    const roots = new Set();
    links.forEach(a => {
        const card = a.closest('article, li, [data-testid*="result"], [class*="result"]')
            || a.parentElement;
        if (card) roots.add(card);
    });
    return [...roots];
}

export function extractAdIdFromHref(href) {
    if (!href) return null;
    try {
        const u = new URL(href, location.origin);
        const id = u.searchParams.get('id');
        if (id) return id;
        const m = u.pathname.match(/\/auto-inserat\/([^/?#]+)/);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

export function profileFromSrpCard(card) {
    const link = card.querySelector('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
    if (!link) return null;
    const id = extractAdIdFromHref(link.getAttribute('href'));
    if (!id) return null;

    const state = getPageInitialState();
    if (state) {
        const listings = findSrpListingsInState(state);
        const hit = listings.find(raw => {
            const ad = raw?.ad || raw?.data?.ad || raw;
            return ad && String(ad.id) === String(id);
        });
        if (hit) {
            const prof = normalizeComparableAd(hit);
            if (prof) return prof;
        }
    }

    const title = link.textContent.trim() || card.textContent.trim().slice(0, 200);
    const priceMatch = card.textContent.replace(/\s/g, ' ').match(/([\d.]+)\s*€/);
    const priceGross = priceMatch ? parseEuroAmount(priceMatch[1] + ' €') : null;
    const kmMatch = card.textContent.match(/([\d.]+)\s*km/i);
    const yearMatch = card.textContent.match(/\b(19|20)\d{2}\b/);
    return {
        id,
        make: '',
        model: '',
        title,
        subTitle: '',
        priceGross,
        mileageKm: kmMatch ? parseKm(kmMatch[0]) : null,
        firstRegistrationYear: yearMatch ? parseInt(yearMatch[0], 10) : null,
        powerPs: null,
        fuel: '',
        transmission: '',
        features: [],
        priceRating: null,
        attributes: []
    };
}

export function renderSrpPriceBadge(card, rating, loading) {
    injectPriceRatingStyles();
    const link = card.querySelector('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
    if (!link) return;
    let badge = card.querySelector('.mobilede-srp-price-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mobilede-srp-price-badge';
        badge.title = 'Preisbewertung (ausstattungsbereinigt)';
        link.parentElement ? link.parentElement.insertBefore(badge, link.nextSibling)
            : link.after(badge);
    }
    badge.innerHTML = '';
    if (loading) {
        badge.appendChild(renderRatingBars(2, true));
        const t = document.createElement('span');
        t.className = 'mobilede-srp-price-badge__text';
        t.textContent = '…';
        badge.appendChild(t);
        return;
    }
    if (!rating || !rating.ok) {
        badge.remove();
        delete card.dataset.mobiledePriceRated;
        return;
    }
    badge.appendChild(renderRatingBars(rating.level, true));
    const shortLabels = ['Sehr gut', 'Gut', 'Fair', 'Erhöht', 'Hoch'];
    const t = document.createElement('span');
    t.className = 'mobilede-srp-price-badge__text';
    t.textContent = shortLabels[rating.level] || rating.label.split(' ')[0];
    badge.appendChild(t);
    badge.title = rating.label + ' — erwartet ~' + rating.adjustedExpected.toLocaleString('de-DE') + ' €';
}

export function loadSrpCardRating(card) {
    const prCfg = getPriceRating(runtimeState.featureFlags);
    if (!isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) return;
    if (card.dataset.mobiledePriceRated === '1') return;
    const profile = profileFromSrpCard(card);
    if (!profile || !profile.id) return;

    const cached = readRatingCache(profile.id);
    if (cached && cached.ok) {
        card.dataset.mobiledePriceRated = '1';
        renderSrpPriceBadge(card, cached, false);
        return;
    }

    card.dataset.mobiledePriceRated = 'pending';
    computeAndCacheRatingForProfileAsync(profile).then(rating => {
        if (!card.isConnected) return;
        card.dataset.mobiledePriceRated = '1';
        renderSrpPriceBadge(card, rating, false);
    }).catch(() => {
        delete card.dataset.mobiledePriceRated;
    });
}

export const srpRatingQueue = [];
export let srpRatingQueueRunning = false;
export let srpRatingLastInteractionMs = 0;

export function markSrpInteraction() {
    srpRatingLastInteractionMs = Date.now();
}

export function enqueueSrpCard(card) {
    if (!card || card.dataset.mobiledePriceRated) return;
    if (!srpRatingQueue.includes(card)) srpRatingQueue.push(card);
    if (!srpRatingQueueRunning) {
        srpRatingQueueRunning = true;
        requestIdle(runSrpRatingQueue, 220);
    }
}

export function runSrpRatingQueue() {
    const t0 = pricePerfMarkStart();
    const prCfg = getPriceRating(runtimeState.featureFlags);
    if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) {
        srpRatingQueue.length = 0;
        srpRatingQueueRunning = false;
        return;
    }
    if (Date.now() - srpRatingLastInteractionMs < 140) {
        requestIdle(runSrpRatingQueue, 180);
        return;
    }
    let processed = 0;
    while (srpRatingQueue.length && processed < 4) {
        const card = srpRatingQueue.shift();
        if (!card || !card.isConnected || card.dataset.mobiledePriceRated) continue;
        loadSrpCardRating(card);
        processed++;
    }
    pricePerfMarkEnd('scanSrpBadges_chunk', t0, 16);
    if (srpRatingQueue.length) {
        requestIdle(runSrpRatingQueue, 160);
    } else {
        srpRatingQueueRunning = false;
    }
}

export function ensureSrpPriceRatingObserver() {
    const prCfg = getPriceRating(runtimeState.featureFlags);
    if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) {
        if (srpPriceRatingIo) {
            srpPriceRatingIo.disconnect();
            srpPriceRatingIo = null;
        }
        return;
    }
    if (srpPriceRatingIo) return;
    srpPriceRatingIo = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const card = entry.target;
            srpPriceRatingIo.unobserve(card);
            enqueueSrpCard(card);
        });
    }, { rootMargin: '120px' });
    scanSrpPriceBadges();
}

export function scanSrpPriceBadges() {
    const prCfg = getPriceRating(runtimeState.featureFlags);
    if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) return;
    ensureSrpPriceRatingObserver();
    findSrpListingRoots().forEach(card => {
        if (card.dataset.mobiledePriceRated) return;
        if (srpPriceRatingIo) srpPriceRatingIo.observe(card);
        else enqueueSrpCard(card);
    });
}

export function clearPriceRatingUi() {
    document.querySelectorAll('.mobilede-price-rating, .mobilede-srp-price-badge').forEach(el => el.remove());
    document.querySelectorAll('[data-mobilede-price-rated]').forEach(el => {
        delete el.dataset.mobiledePriceRated;
    });
    findSrpListingRoots().forEach(card => { delete card.dataset.mobiledePriceRated; });
    srpRatingQueue.length = 0;
}
