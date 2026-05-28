import { debugLog } from '../../config/feature-flags/index.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { isAutoModeEnabled, sortEntriesByConfigOrder } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import { extractSources } from '../dom/sources.js';
import { collectConfigMatches } from './config-matches.js';
import {
    buildUnifiedResults,
    dedupeConfigMatchesByAnzeige,
    extractRawEquipmentItems,
    findConfigEntryForRawLabel,
} from './automode.js'; // re-exported for openLearnConfig
import {
    enrichAussenMergeFromRaw,
    generalizedMergeEntries,
    subsetDedup,
} from './merge-groups.js';
import { openConfigPopup } from './popup-bridge.js';

export function collectRawConfigHits() {
    const sources = extractSources();
    if (sources.length === 0) return [];
    return dedupeConfigMatchesByAnzeige(
        collectConfigMatches(sources, runtimeState.suchKonfigurationen));
}

export function getResultEntries() {
    if (isAutoModeEnabled()) {
        const rawItems = extractRawEquipmentItems();
        return buildUnifiedResults(rawItems, collectRawConfigHits());
    }
    return sucheBegriffe();
}

export function openLearnConfig(label, source) {
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    if (findConfigEntryForRawLabel(trimmed)) {
        runtimeState.pendingAusstattungPrefill = null;
        openConfigPopup();
        return;
    }
    runtimeState.pendingAusstattungPrefill = { label: trimmed, source: source || 'features' };
    openConfigPopup();
}

export function finalizeAusstattungResults(entries) {
    let unique = subsetDedup([...entries]);
    unique = generalizedMergeEntries(unique, runtimeState.mergeGruppenConfig);
    unique = enrichAussenMergeFromRaw(unique, extractRawEquipmentItems());
    unique = subsetDedup(unique);
    return sortEntriesByConfigOrder(unique, runtimeState.suchKonfigurationen, getFavoriteAnzeigeKeys(runtimeState.suchKonfigurationen));
}

export function sucheBegriffe() {
    let unique = collectRawConfigHits();
    if (unique.length === 0) return [];
    unique = finalizeAusstattungResults(unique);
    debugLog('ausstattung', 'Gefundene Begriffe', unique.map(i => `${i.anzeige} [${i.source}]`));
    return unique;
}

