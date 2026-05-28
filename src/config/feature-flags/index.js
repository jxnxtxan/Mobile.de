import {
    FEATURE_FLAG_DEFINITIONS,
    LIST_ORDER_DEFAULT,
    SRP_SORT_OPTIONS,
    SRP_SORT_DEFAULT,
    PRICE_RATING_DEFAULT,
    DEBUG_SCOPE_DEFINITIONS,
    DEBUG_SCOPE_PREFIX,
    STORAGE_KEYS,
} from '../constants.js';
import { ladeConfig, speichereConfig } from '../persistence.js';
import { runtimeState } from '../runtime-state.js';

export function srpSortDefault() {
    return JSON.parse(JSON.stringify(SRP_SORT_DEFAULT));
}

export function findSrpSortOption(sortId) {
    return SRP_SORT_OPTIONS.find(o => o.id === sortId) || SRP_SORT_OPTIONS[0];
}

export function mergeSrpSort(stored) {
    const d = srpSortDefault();
    if (!stored || typeof stored !== 'object') return d;
    const sortId = SRP_SORT_OPTIONS.some(o => o.id === stored.sortId) ? stored.sortId : d.sortId;
    return { enabled: stored.enabled !== false, sortId };
}

export function priceRatingDefault() {
    return JSON.parse(JSON.stringify(PRICE_RATING_DEFAULT));
}

export function mergePriceRating(stored) {
    const d = priceRatingDefault();
    if (!stored || typeof stored !== 'object') return d;
    const out = { ...d, ...stored };
    if (Array.isArray(stored.thresholds) && stored.thresholds.length === 5) {
        out.thresholds = stored.thresholds.map((t, i) => {
            let maxPct = typeof t.maxPct === 'number' ? t.maxPct : d.thresholds[i].maxPct;
            if (maxPct >= 999 || maxPct === null) maxPct = Infinity;
            return {
                maxPct,
                level: typeof t.level === 'number' ? t.level : d.thresholds[i].level
            };
        });
    }
    out.enabled = stored.enabled !== false;
    out.useModelRange = stored.useModelRange !== false;
    out.keyUseMileage = stored.keyUseMileage !== false;
    out.keyUseYear = stored.keyUseYear !== false;
    out.keyUsePower = stored.keyUsePower !== false;
    out.keyKmBucket = Math.max(500, Math.min(50000, parseInt(out.keyKmBucket, 10) || d.keyKmBucket));
    out.keyYearBucket = Math.max(1, Math.min(5, parseInt(out.keyYearBucket, 10) || d.keyYearBucket));
    out.keyPowerBucket = Math.max(1, Math.min(50, parseInt(out.keyPowerBucket, 10) || d.keyPowerBucket));
    out.onlyFavoriteWeights = stored.onlyFavoriteWeights === true;
    out.minComparables = Math.max(5, Math.min(50, parseInt(out.minComparables, 10) || d.minComparables));
    out.punktZuEuro = Math.max(100, parseInt(out.punktZuEuro, 10) || d.punktZuEuro);
    out.maxAdjustPct = Math.max(0.05, Math.min(0.25, Number(out.maxAdjustPct) || d.maxAdjustPct));
    out.kmToleranceAbs = Math.max(0, Math.min(200000, parseInt(out.kmToleranceAbs, 10) || d.kmToleranceAbs));
    out.yearTolerance = Math.max(0, Math.min(3, parseInt(out.yearTolerance, 10) || d.yearTolerance));
    out.powerToleranceKw = Math.max(0, Math.min(80, parseInt(out.powerToleranceKw, 10) || d.powerToleranceKw));
    // Backward compatibility for previous %-based settings.
    if (stored.kmToleranceAbs == null && typeof stored.kmTolerancePct === 'number') {
        out.kmToleranceAbs = d.kmToleranceAbs;
    }
    if (stored.powerToleranceKw == null && typeof stored.powerTolerancePct === 'number') {
        out.powerToleranceKw = d.powerToleranceKw;
    }
    return out;
}

export function getPriceRating(flags) {
    return mergePriceRating(flags && flags.priceRating);
}

export function isPriceRatingEnabled(prCfg) {
    const pr = prCfg || getPriceRating(runtimeState.featureFlags);
    return pr.enabled !== false;
}

export function getSrpSort(flags) {
    return mergeSrpSort(flags && flags.srpSort);
}

export const SRP_SORT_OVERRIDE_STORAGE_KEY = 'mobilede_srp_sort_user_choice';
export const SRP_SORT_APPLIED_STORAGE_KEY = 'mobilede_srp_sort_applied';
/** URL-Parameter, die bei Sortierung/Navigation wechseln – nicht im Such-Fingerprint. */
export const SRP_FINGERPRINT_EXCLUDE = new Set(['sb', 'od', 'ref', 'refId', 'page', 'pageNumber', 'offset']);

export function srpSortParamsEqual(a, b) {
    return a && b && a.sb === b.sb && a.od === b.od;
}

export function getStoredSrpSortApplied() {
    try {
        const raw = sessionStorage.getItem(SRP_SORT_APPLIED_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.fp !== 'string') return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

export function markSrpSortApplied(fp, sb, od) {
    try {
        sessionStorage.setItem(SRP_SORT_APPLIED_STORAGE_KEY, JSON.stringify({ fp, sb, od }));
    } catch (e) { /* noop */ }
}

export function clearStoredSrpSortApplied() {
    try {
        sessionStorage.removeItem(SRP_SORT_APPLIED_STORAGE_KEY);
    } catch (e) { /* noop */ }
}

export function getStoredSrpUserChoice() {
    try {
        const raw = sessionStorage.getItem(SRP_SORT_OVERRIDE_STORAGE_KEY);
        if (!raw) return null;
        if (raw.charAt(0) === '{') {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.fp === 'string') {
                return {
                    fp: parsed.fp,
                    sb: parsed.sb != null ? parsed.sb : null,
                    od: parsed.od || 'up'
                };
            }
        }
        if (raw.indexOf('/') !== -1) return { fp: raw, sb: null, od: 'up' };
    } catch (e) { /* noop */ }
    return null;
}

export function setStoredSrpUserChoice(choice) {
    try {
        sessionStorage.setItem(SRP_SORT_OVERRIDE_STORAGE_KEY, JSON.stringify(choice));
    } catch (e) { /* noop */ }
}

export function clearStoredSrpUserChoice() {
    try {
        sessionStorage.removeItem(SRP_SORT_OVERRIDE_STORAGE_KEY);
    } catch (e) { /* noop */ }
}

export function hasSrpSortUserOverride(fp) {
    const choice = getStoredSrpUserChoice();
    return srpSortUserOverrideFp === fp || !!(choice && choice.fp === fp);
}

export function markSrpSortUserOverride(sort) {
    const fp = getSrpSearchFingerprint();
    const current = sort || parseSortFromUrl();
    srpSortUserOverrideFp = fp;
    setStoredSrpUserChoice({
        fp,
        sb: current.sb,
        od: current.od || 'up'
    });
}

export function clearSrpSortUserOverride() {
    srpSortUserOverrideFp = null;
    clearStoredSrpUserChoice();
}

export function clearSrpSortSessionState() {
    clearSrpSortUserOverride();
    clearStoredSrpSortApplied();
}

export function countConfigTabSettings(flags) {
    const f = flags || runtimeState.featureFlags;
    let on = FEATURE_FLAG_DEFINITIONS.filter(d => f[d.key] !== false).length;
    let all = FEATURE_FLAG_DEFINITIONS.length;
    if (getSrpSort(f).enabled) on += 1;
    all += 1;
    return { on, all };
}

export function listOrderDefault() {
    return JSON.parse(JSON.stringify(LIST_ORDER_DEFAULT));
}

export function mergeListOrder(stored) {
    const d = listOrderDefault();
    if (!stored || typeof stored !== 'object') return d;
    return {
        ...d,
        ...stored,
        scopes: { ...d.scopes, ...(stored.scopes || {}) }
    };
}

export function getConfigListUi(flags) {
    return flags && flags.configListUi === 'split' ? 'split' : 'classic';
}

export function mergeConfigListUi(stored, defaults) {
    const v = stored && stored.configListUi;
    return { ...defaults, configListUi: v === 'split' ? 'split' : 'classic' };
}

export function debugConfigDefault() {
    const scopes = {};
    DEBUG_SCOPE_DEFINITIONS.forEach(def => { scopes[def.key] = false; });
    return { enabled: false, showSrpLogCard: false, scopes };
}

export function mergeDebugConfig(stored, legacyFlags) {
    const d = debugConfigDefault();
    if (stored && typeof stored === 'object') {
        const scopes = { ...d.scopes, ...(stored.scopes || {}) };
        return {
            enabled: stored.enabled === true,
            showSrpLogCard: stored.showSrpLogCard === true,
            scopes
        };
    }
    const hasLegacy = legacyFlags && typeof legacyFlags === 'object';
    if (!hasLegacy) return d;
    const legacyPrice = legacyFlags.priceRatingDebug === true;
    const legacyPerf = legacyFlags.priceRatingPerfDebug === true;
    return {
        enabled: legacyPrice || legacyPerf,
        scopes: { ...d.scopes, price: legacyPrice, perf: legacyPerf }
    };
}

export function getDebugConfig(flags) {
    const merged = mergeDebugConfig(flags && flags.debug, flags || runtimeState.featureFlags);
    return merged;
}

export function isDebugEnabled(scope, flags) {
    const dbg = getDebugConfig(flags || runtimeState.featureFlags);
    if (!dbg.enabled) return false;
    if (!scope) return true;
    return dbg.scopes[scope] === true;
}

export function debugLog(scope, ...args) {
    if (!isDebugEnabled(scope)) return;
    const prefix = DEBUG_SCOPE_PREFIX[scope] || '[mobilede Debug]';
    console.info(prefix, ...args);
}

export function persistDebugConfig(nextDebugConfig) {
    const merged = ladeFeatureFlags();
    merged.debug = mergeDebugConfig(nextDebugConfig, merged);
    merged.priceRatingDebug = merged.debug.enabled && merged.debug.scopes.price === true;
    merged.priceRatingPerfDebug = merged.debug.enabled && merged.debug.scopes.perf === true;
    speichereConfig(STORAGE_KEYS.featureFlags, merged);
    runtimeState.featureFlags = merged;
}

export function persistDebugMaster(enabled) {
    const merged = ladeFeatureFlags();
    const dbg = getDebugConfig(merged);
    persistDebugConfig({ ...dbg, enabled: !!enabled });
}

export function persistDebugScope(scope, enabled) {
    const merged = ladeFeatureFlags();
    const dbg = getDebugConfig(merged);
    persistDebugConfig({
        ...dbg,
        scopes: { ...dbg.scopes, [scope]: !!enabled }
    });
}

export function featureFlagsDefault() {
    const obj = {};
    FEATURE_FLAG_DEFINITIONS.forEach(d => { obj[d.key] = !!d.default; });
    obj.listOrder = listOrderDefault();
    obj.srpSort = srpSortDefault();
    obj.priceRating = priceRatingDefault();
    obj.configListUi = 'classic';
    obj.debug = debugConfigDefault();
    obj.priceRatingDebug = false;
    obj.priceRatingPerfDebug = false;
    return obj;
}
export function ladeFeatureFlags() {
    const stored = ladeConfig(STORAGE_KEYS.featureFlags);
    const defaults = featureFlagsDefault();
    if (!stored || typeof stored !== 'object') return defaults;
    const merged = mergeConfigListUi(stored, { ...defaults, ...stored });
    merged.listOrder = mergeListOrder(stored.listOrder);
    merged.srpSort = mergeSrpSort(stored.srpSort);
    merged.priceRating = mergePriceRating(stored.priceRating);
    merged.debug = mergeDebugConfig(stored.debug, stored);
    merged.priceRatingDebug = merged.debug.enabled && merged.debug.scopes.price === true;
    merged.priceRatingPerfDebug = merged.debug.enabled && merged.debug.scopes.perf === true;
    return merged;
}

export function persistPriceRatingDebug(enabled) {
    persistDebugMaster(!!enabled);
    persistDebugScope('price', !!enabled);
}

export function persistPriceRatingPerfDebug(enabled) {
    persistDebugScope('perf', !!enabled);
}
