import { isAutoModeEnabled } from '../../config/ordering.js';
import {
    fingerprintActiveConfigs,
    fingerprintListOrder,
    fingerprintMergeGroups,
    hashString,
} from '../../core/util/content-signature.js';
import { runtimeState } from '../../config/runtime-state.js';
import { getDescriptionEl, getFeatureItems, getTechDataDl } from '../../core/dom/selectors.js';

let entriesCache = null;
let entriesCacheSig = '';
let committedInputSig = '';

export function computeResultsInputSignature() {
    const items = getFeatureItems();
    const desc = getDescriptionEl();
    const tech = getTechDataDl();
    const descText = desc ? desc.textContent : '';
    const featureTexts = items.map(li => (li.textContent || '').trim()).join('\x1e');
    const flags = runtimeState.featureFlags || {};
    const parts = [
        isAutoModeEnabled() ? '1' : '0',
        String(items.length),
        hashString(featureTexts),
        String(descText.length),
        hashString(descText),
        tech ? hashString(tech.textContent) : '0',
        fingerprintActiveConfigs(runtimeState.suchKonfigurationen),
        fingerprintActiveConfigs(runtimeState.techDataKonfigurationen),
        fingerprintMergeGroups(runtimeState.mergeGruppenConfig),
        fingerprintListOrder(flags.listOrder),
    ];
    return parts.join('\x1f');
}

export function invalidateResultsCache() {
    entriesCache = null;
    entriesCacheSig = '';
    committedInputSig = '';
}

export function markResultsInputCommitted(sig) {
    committedInputSig = sig || computeResultsInputSignature();
}

/**
 * Ergebnis-Article hängt direkt hinter dem Anker. `technischeDatenHinzufuegen`
 * schiebt den Tech-Article davor, deshalb sind beide Reihenfolgen gültig.
 * Ohne diese Prüfung bliebe ein von mobile.de verschobener Block dauerhaft
 * an der falschen Stelle stehen, weil die Signatur unverändert ist.
 */
function resultsAnchoredCorrectly(anchor) {
    const next = anchor && anchor.nextElementSibling;
    if (!next) return false;
    if (next.classList.contains('mobilede-tech-article')) {
        const after = next.nextElementSibling;
        return !!(after && after.classList.contains('mobilede-result-article'));
    }
    return next.classList.contains('mobilede-result-article');
}

export function shouldSkipResultsRender(anchor, sig) {
    if (!resultsAnchoredCorrectly(anchor)) return false;
    const current = sig || computeResultsInputSignature();
    return current === committedInputSig;
}

export function getCachedResultEntries(computeFn, sig) {
    const current = sig || computeResultsInputSignature();
    if (entriesCache && current === entriesCacheSig) return entriesCache;
    const entries = computeFn();
    entriesCache = entries;
    entriesCacheSig = current;
    return entries;
}
