import { mergeListOrder } from './feature-flags/index.js';
import { getFavoriteAnzeigeKeys, partitionEntriesByFavorites } from './list-helpers.js';
import { runtimeState } from './runtime-state.js';

export function isAutoModeEnabled() {
    return !!(runtimeState.featureFlags && runtimeState.featureFlags.autoMode === true);
}

export function getListOrder(flags) {
    return mergeListOrder(flags && flags.listOrder);
}

export function isManualScope(scopeKey, flags) {
    const lo = getListOrder(flags || runtimeState.featureFlags);
    if (lo.mode !== 'manual') return false;
    return !!(lo.scopes && lo.scopes[scopeKey]);
}

export function hasAnyManualListScope(flags) {
    const lo = getListOrder(flags || runtimeState.featureFlags);
    if (lo.mode !== 'manual') return false;
    const s = lo.scopes || {};
    return !!(s.ausstattung || s.ausstattungFavorites || s.tech);
}

export function shouldApplyOrderToVehicleResults(flags) {
    const lo = getListOrder(flags || runtimeState.featureFlags);
    return lo.mode === 'manual' && !!lo.applyToVehicleResults && hasAnyManualListScope(flags);
}

export function getConfigOrderIndexMap(config, keyFn) {
    const map = new Map();
    if (!Array.isArray(config)) return map;
    config.forEach((item, idx) => {
        const k = keyFn(item);
        if (k && !map.has(k)) map.set(k, idx);
    });
    return map;
}

export function sortEntriesByConfigOrder(entries, config, favoriteKeys, flags) {
    const lo = getListOrder(flags || runtimeState.featureFlags);
    const useConfigOrder = lo.mode === 'manual' && lo.applyToVehicleResults &&
        (isManualScope('ausstattung', flags) || isManualScope('ausstattungFavorites', flags));
    if (!useConfigOrder) {
        const out = [...entries].sort((a, b) =>
            (a.anzeige || '').localeCompare((b.anzeige || ''), 'de'));
        return partitionEntriesByFavorites(out, favoriteKeys);
    }
    const keyFn = item => (item.anzeige || '').trim().toLowerCase();
    const orderMap = getConfigOrderIndexMap(config, keyFn);
    const favOnly = isManualScope('ausstattungFavorites', flags) && !isManualScope('ausstattung', flags);
    const sorted = [...entries].sort((a, b) => {
        const ka = (a.anzeige || '').trim().toLowerCase();
        const kb = (b.anzeige || '').trim().toLowerCase();
        const af = favoriteKeys && favoriteKeys.has(ka);
        const bf = favoriteKeys && favoriteKeys.has(kb);
        if (af !== bf) return af ? -1 : 1;
        if (favOnly && !af && !bf) {
            return (a.anzeige || '').localeCompare((b.anzeige || ''), 'de');
        }
        const ia = orderMap.has(ka) ? orderMap.get(ka) : 999999;
        const ib = orderMap.has(kb) ? orderMap.get(kb) : 999999;
        if (ia !== ib) return ia - ib;
        return (a.anzeige || '').localeCompare((b.anzeige || ''), 'de');
    });
    return sorted;
}

export function applySaveOrdering(ausConfig, techConfig, listOrder) {
    const lo = mergeListOrder(listOrder);
    const cmpAus = (a, b) => (a.anzeige || '').trim().localeCompare((b.anzeige || '').trim(), 'de');
    const cmpTech = (a, b) => (a.begriff || '').trim().localeCompare((b.begriff || '').trim(), 'de');
    if (lo.mode !== 'manual') {
        ausConfig.sort(cmpAus);
        techConfig.sort(cmpTech);
        return;
    }
    if (!lo.scopes.ausstattung) {
        if (lo.scopes.ausstattungFavorites) {
            const nonFavSorted = ausConfig.filter(x => !x.favorit).sort(cmpAus);
            let j = 0;
            for (let i = 0; i < ausConfig.length; i++) {
                if (!ausConfig[i].favorit) ausConfig[i] = nonFavSorted[j++];
            }
        } else {
            ausConfig.sort(cmpAus);
        }
    }
    if (!lo.scopes.tech) {
        techConfig.sort(cmpTech);
    }
}

export function orderIndicesByArrayPosition(indices) {
    return [...indices].sort((a, b) => a - b);
}

// ============================================================
