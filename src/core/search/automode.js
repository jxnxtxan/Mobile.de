import { cleanText, tokenize } from '../text/normalize.js';
import { classifyDescription } from '../dom/sources.js';
import { getDescriptionEl, getFeatureItems } from '../dom/selectors.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { sortEntriesByConfigOrder } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import {
    enrichAussenMergeFromRaw,
    generalizedMergeEntries,
    isAussenInnenCombinedSpiegel,
    isAussenSpiegelOnly,
    isInnenSpiegelOnly,
    subsetDedup,
} from './merge-groups.js';

export function isPlausibleEquipmentLabel(label, source) {
    const t = (label || '').trim();
    if (!t) return false;
    if (source === 'features') return true;
    if (t.length > 72) return false;
    if (t.split(/\s+/).filter(Boolean).length > 10) return false;
    const low = t.toLowerCase();
    if (/willkommen|gmbh\b|https?:|www\.|@[\w.-]|fußnote|weitere ausstattung\s*:|sonderausstattung\s*:/i.test(low)) {
        return false;
    }
    return true;
}

/**
 * Komma-Liste aus Beschreibung: kurze Anhängsel (beide, links, …) an
 * den vorherigen Eintrag hängen statt eigene Zeile erzeugen.
 */
export function splitDescriptionIntoFeatures(rawText) {
    const normalized = rawText
        .replace(/\b(weitere ausstattung|sonderausstattung)\s*:/gi, ', ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const parts = normalized.split(/,/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return [];
    const merged = [];
    // Nur die aufgezählten Anhängsel dürfen an den Vorgänger wandern. Eine
    // zusätzliche Längenregel (früher: part.length <= 8) verschluckte
    // eigenständige Kurznamen wie ABS, ESP, AHK, LED oder Navi.
    const orphanOnly = /^(beide|links|rechts|vorn|hinten|optional)$/i;
    for (const part of parts) {
        if (merged.length > 0 && orphanOnly.test(part)) {
            merged[merged.length - 1] = merged[merged.length - 1] + ', ' + part;
        } else {
            merged.push(part);
        }
    }
    return merged;
}

export function extractRawEquipmentItems() {
    const byKey = new Map();
    const sourcePriority = { features: 2, description: 1 };

    function add(label, source, confidence) {
        const trimmed = (label || '').trim();
        if (!trimmed) return;
        if (!isPlausibleEquipmentLabel(trimmed, source)) return;
        const key = cleanText(trimmed);
        if (!key) return;
        const entry = { label: trimmed, source, confidence };
        const existing = byKey.get(key);
        if (!existing || sourcePriority[source] > sourcePriority[existing.source]) {
            byKey.set(key, entry);
        }
    }

    getFeatureItems().forEach(li => add(li.textContent, 'features', 'high'));

    const desc = getDescriptionEl();
    if (desc) {
        const rawText = desc.textContent.replace(/\s+/g, ' ').trim();
        if (classifyDescription(rawText) === 'high') {
            splitDescriptionIntoFeatures(rawText).forEach(part => add(part, 'description', 'high'));
        }
    }

    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

export function tokenJaccard(textA, textB) {
    const A = new Set(tokenize(textA));
    const B = new Set(tokenize(textB));
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const t of A) {
        if (B.has(t)) inter++;
    }
    return inter / (A.size + B.size - inter);
}

export function stringsMatchForHighlight(rawLabel, hit) {
    const r = cleanText(rawLabel);
    if (!r) return false;
    const candidates = [hit.anzeige, hit.begriff, hit.snippet].filter(Boolean);
    for (const raw of candidates) {
        const c = cleanText(raw);
        if (!c) continue;
        if (r === c) return true;
        if (r.length >= 4 && c.length >= 4 && (r.includes(c) || c.includes(r))) return true;
        if (tokenJaccard(rawLabel, raw) >= 0.6) return true;
    }
    return false;
}

export function findConfigEntryForRawLabel(rawLabel) {
    const r = cleanText(rawLabel);
    if (!r) return null;
    for (const cfg of runtimeState.suchKonfigurationen) {
        if (!cfg) continue;
        const anzeigeKey = cleanText(cfg.anzeige || '');
        if (anzeigeKey && anzeigeKey === r) return cfg;
        if (anzeigeKey && stringsMatchForHighlight(rawLabel, { anzeige: cfg.anzeige })) {
            return cfg;
        }
        if (Array.isArray(cfg.begriffe)) {
            for (const b of cfg.begriffe) {
                if (stringsMatchForHighlight(rawLabel, { anzeige: b, begriff: b })) {
                    return cfg;
                }
            }
        }
    }
    return null;
}

export function rawCoveredByEntryLabel(rawLabel, entryAnzeige, entryHighlighted) {
    if (!entryAnzeige || !entryHighlighted) return false;
    if (stringsMatchForHighlight(rawLabel, { anzeige: entryAnzeige })) return true;

    if (isInnenSpiegelOnly(rawLabel)) {
        return isInnenSpiegelOnly(entryAnzeige) || isAussenInnenCombinedSpiegel(entryAnzeige);
    }
    if (isAussenInnenCombinedSpiegel(rawLabel)) {
        return isAussenInnenCombinedSpiegel(entryAnzeige);
    }
    if (isAussenSpiegelOnly(rawLabel) && isAussenSpiegelOnly(entryAnzeige)) {
        const r = cleanText(rawLabel);
        const e = cleanText(entryAnzeige);
        if (/heizbar|beheiz/.test(r) && /heizbar|beheiz/.test(e)) return true;
        if (/anklapp/.test(r) && /anklapp/.test(e)) return true;
        if (/verstell/.test(r) && /verstell/.test(e)) return true;
        return stringsMatchForHighlight(rawLabel, { anzeige: entryAnzeige });
    }
    return false;
}

export function consolidateAutoModeResults(entries, rawItems) {
    const byAnzeigeKey = new Map();
    entries.forEach(e => {
        const k = cleanText(e.anzeige);
        if (!k) return;
        const prev = byAnzeigeKey.get(k);
        if (!prev) { byAnzeigeKey.set(k, e); return; }
        if (e.highlighted && !prev.highlighted) byAnzeigeKey.set(k, e);
    });
    let list = [...byAnzeigeKey.values()];

    const highlighted = list.filter(e => e.highlighted);
    let neutral = list.filter(e => !e.highlighted);

    let mergedHi = generalizedMergeEntries(highlighted, runtimeState.mergeGruppenConfig);
    mergedHi = subsetDedup(mergedHi);

    const aussenHighlight = mergedHi.some(e => isAussenSpiegelOnly(e.anzeige));
    const mirrorNeutralLabels = [];
    const keptNeutral = [];

    neutral.forEach(n => {
        const label = n.rawLabel || n.anzeige;
        if (mergedHi.some(h => rawCoveredByEntryLabel(label, h.anzeige, true))) {
            return;
        }
        if (aussenHighlight && isAussenSpiegelOnly(label)) {
            mirrorNeutralLabels.push(n.anzeige);
            return;
        }
        keptNeutral.push(n);
    });

    if (mirrorNeutralLabels.length > 0) {
        const uniq = [...new Set(mirrorNeutralLabels)];
        const shortUniq = uniq.filter(l => !mergedHi.some(h =>
            rawCoveredByEntryLabel(l, h.anzeige, true)));
        if (shortUniq.length === 0) {
            /* alle Spiegel-Rohzeilen bereits durch Merge abgedeckt */
        } else {
        keptNeutral.push({
            anzeige: 'Außenspiegel (weitere, nicht in Konfig): ' + shortUniq.join(', '),
            farbe: '#b0b0b0',
            source: 'features',
            confidence: 'high',
            highlighted: false,
            learnable: true,
            rawLabel: shortUniq[0]
        });
        }
    }

    let out = [...mergedHi, ...keptNeutral];
    out = enrichAussenMergeFromRaw(out, rawItems || []);
    out = subsetDedup(out);
    return sortEntriesByConfigOrder(out, runtimeState.suchKonfigurationen, getFavoriteAnzeigeKeys(runtimeState.suchKonfigurationen));
}

export function buildUnifiedResults(rawItems, configHits) {
    const usedRawKeys = new Set();
    const usedHitIndexes = new Set();
    const results = [];

    configHits.forEach((hit, hitIdx) => {
        let rawMatch = null;
        let rawKey = null;
        for (const raw of rawItems) {
            const key = cleanText(raw.label);
            if (usedRawKeys.has(key)) continue;
            if (stringsMatchForHighlight(raw.label, hit)) {
                rawMatch = raw;
                rawKey = key;
                break;
            }
        }
        if (rawMatch) {
            usedRawKeys.add(rawKey);
            usedHitIndexes.add(hitIdx);
            results.push({
                anzeige: hit.anzeige,
                farbe: (hit.farbe || '#66ff66').toLowerCase(),
                source: hit.source || rawMatch.source,
                confidence: hit.confidence || rawMatch.confidence,
                snippet: hit.snippet,
                begriff: hit.begriff,
                highlighted: true,
                learnable: false,
                rawLabel: rawMatch.label
            });
        }
    });

    configHits.forEach((hit, hitIdx) => {
        if (usedHitIndexes.has(hitIdx)) return;
        results.push({
            anzeige: hit.anzeige,
            farbe: (hit.farbe || '#66ff66').toLowerCase(),
            source: hit.source,
            confidence: hit.confidence,
            snippet: hit.snippet,
            begriff: hit.begriff,
            highlighted: true,
            learnable: false
        });
    });

    rawItems.forEach(raw => {
        const key = cleanText(raw.label);
        if (usedRawKeys.has(key)) return;
        const covered = results.some(e =>
            e.highlighted && rawCoveredByEntryLabel(raw.label, e.anzeige, true));
        if (covered) return;

        const cfg = findConfigEntryForRawLabel(raw.label);
        if (cfg) {
            const anzeigeKey = cleanText(cfg.anzeige || '');
            if (results.some(e => cleanText(e.anzeige) === anzeigeKey)) return;
            results.push({
                anzeige: cfg.anzeige || raw.label,
                farbe: (cfg.farbe || '#66ff66').toLowerCase(),
                source: raw.source,
                confidence: raw.confidence,
                highlighted: true,
                configInactive: cfg.aktiv === false,
                learnable: false,
                rawLabel: raw.label
            });
            return;
        }

        results.push({
            anzeige: raw.label,
            farbe: '#b0b0b0',
            source: raw.source,
            confidence: raw.confidence,
            highlighted: false,
            learnable: true,
            rawLabel: raw.label
        });
    });

    return consolidateAutoModeResults(results, rawItems);
}

/** Konfig-Treffer vor Merge/Sortierung (für Automodus-Hybrid). */
export function dedupeConfigMatchesByAnzeige(matches) {
    const byAnzeige = new Map();
    for (const item of matches) {
        const existing = byAnzeige.get(item.anzeige);
        if (!existing) { byAnzeige.set(item.anzeige, item); continue; }
        const existingHigh = existing.confidence === 'high';
        const itemHigh = item.confidence === 'high';
        if (!existingHigh && itemHigh) byAnzeige.set(item.anzeige, item);
    }
    return [...byAnzeige.values()];
}

