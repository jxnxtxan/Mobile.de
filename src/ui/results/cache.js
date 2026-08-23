import { isAutoModeEnabled } from '../../config/ordering.js';
import {
    fingerprintActiveConfigs,
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

export function shouldSkipResultsRender() {
    const sig = computeResultsInputSignature();
    if (sig !== committedInputSig) return false;
    return !!document.querySelector('.mobilede-result-article');
}

export function getCachedResultEntries(computeFn) {
    const sig = computeResultsInputSignature();
    if (entriesCache && sig === entriesCacheSig) return entriesCache;
    const entries = computeFn();
    entriesCache = entries;
    entriesCacheSig = sig;
    return entries;
}
