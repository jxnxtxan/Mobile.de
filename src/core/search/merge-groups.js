import { cleanText, tokenize, escapeRegex } from '../text/normalize.js';
import { debugLog } from '../../config/feature-flags/index.js';
import { runtimeState } from '../../config/runtime-state.js';

export function isAussenInnenCombinedSpiegel(text) {
    const c = cleanText(text || '');
    if (!c) return false;
    const hasInnenMirror = /innenspiegel/.test(c);
    if (!hasInnenMirror) return false;
    return /aussenspiegel|seitenspiegel|aussen/.test(c);
}

export function isInnenSpiegelOnly(text) {
    const c = cleanText(text || '');
    if (/aussenspiegel|seitenspiegel/.test(c)) return false;
    if (isAussenInnenCombinedSpiegel(text)) return false;
    return /innenspiegel/.test(c);
}

/** Nur Außenspiegel / Seitenspiegel — ohne Innen- oder Kombi-Zeile. */
export function isAussenSpiegelOnly(text) {
    const c = cleanText(text || '');
    if (!c) return false;
    if (isAussenInnenCombinedSpiegel(text)) return false;
    if (/innenspiegel/.test(c) && !/aussenspiegel|seitenspiegel/.test(c)) return false;
    return /aussenspiegel|seitenspiegel/.test(c);
}

/**
 * Reihenfolge-Schlüssel und Modifier gleich normalisieren (Umlaute, Groß/klein,
 * Punkte), damit z. B. „elektr. verstellbar“ auch „elektr. verstellbar“ trifft.
 */
export function normalizeOrderKey(text) {
    return cleanText(text || '').replace(/\./g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Index des ersten Reihenfolge-Schlüssels, der im Modifier vorkommt, sonst -1. */
export function orderIndexOf(modifier, order) {
    const m = normalizeOrderKey(modifier);
    if (!m || !Array.isArray(order)) return -1;
    return order.findIndex(key => {
        const k = normalizeOrderKey(key);
        return !!k && m.includes(k);
    });
}

function sortByOrder(mods, order) {
    const rank = mod => {
        const i = orderIndexOf(mod, order);
        return i === -1 ? 999 : i;
    };
    return mods.sort((a, b) => rank(a) - rank(b));
}

export function entryMatchesMergeGroup(entry, group) {
    if (!group || group.aktiv === false || !group.basis) return false;
    const a = cleanText(entry.anzeige || '');
    const basis = cleanText(group.basis);
    if (basis && /aussenspiegel/.test(basis)) {
        return isAussenSpiegelOnly(entry.anzeige);
    }
    return !!(basis && a.includes(basis));
}

export function mergeModifierFromEntry(anzeige, group) {
    const basis = cleanText(group.basis);
    const original = cleanText(anzeige);
    let m = cleanText(anzeige);
    if (basis && m.includes(basis)) {
        m = m.replace(basis, '').trim();
    } else if (isAussenSpiegelOnly(anzeige)) {
        m = m.replace(/^aussenspiegel\s*/i, '').trim();
    } else if (isAussenInnenCombinedSpiegel(anzeige)) {
        m = m.replace(/^(aussen|innen|aussen innen|innen aussen)\s*-?\s*\/?\s*/i, '').trim();
    }
    const out = m || original;
    if (out !== original) {
        debugLog('merge', 'Merge-Modifier extrahiert', { basis, original, modifier: out });
    }
    return out;
}

/** Zusatz-Modifier aus Roh-Text (z. B. „verstell- und heizbar“ → beheizbar). */
export function aussenModifiersFromRawLabel(rawLabel) {
    const c = cleanText(rawLabel || '');
    const mods = [];
    if (!/aussenspiegel|seitenspiegel/.test(c)) return mods;
    if (/heizbar|beheiz/.test(c)) mods.push('beheizbar');
    if (/anklapp|klappbar/.test(c)) mods.push('anklappbar');
    if (/verstell/.test(c)) mods.push('elektr. verstellbar');
    if (/abblend/.test(c)) mods.push('automatisch abblend.');
    return mods;
}

export function enrichAussenMergeFromRaw(entries, rawItems) {
    const group = runtimeState.mergeGruppenConfig.find(g =>
        g && g.aktiv !== false && /aussenspiegel/.test(cleanText(g.basis || '')));
    if (!group) return entries;
    const basisClean = cleanText(group.basis);
    const basisCap = group.basis.charAt(0).toUpperCase() + group.basis.slice(1);
    const targetIdx = entries.findIndex(e => {
        const c = cleanText(e.anzeige || '');
        if (!c.startsWith(basisClean)) return false;
        if (isAussenInnenCombinedSpiegel(e.anzeige) || isInnenSpiegelOnly(e.anzeige)) {
            return false;
        }
        return true;
    });
    if (targetIdx === -1) return entries;

    const hintSet = new Set();
    rawItems.forEach(raw => {
        aussenModifiersFromRawLabel(raw.label).forEach(m => hintSet.add(m));
    });
    if (hintSet.size === 0) return entries;

    const entry = entries[targetIdx];
    let tail = entry.anzeige.replace(new RegExp('^' + basisCap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
    const mods = tail ? tail.split(',').map(s => s.trim()).filter(Boolean) : [];
    hintSet.forEach(h => {
        const hk = h.toLowerCase();
        if (!mods.some(m => m.toLowerCase().includes(hk) || hk.includes(m.toLowerCase()))) {
            mods.push(h);
        }
    });
    sortByOrder(mods, group.order || []);
    const out = [...entries];
    out[targetIdx] = {
        ...entry,
        anzeige: basisCap + (mods.length ? ' ' + mods.join(', ') : '')
    };
    return out;
}

export function subsetDedup(entries) {
    const tokenSets = entries.map(e => new Set(tokenize(e.anzeige)));
    const result = [];
    for (let i = 0; i < entries.length; i++) {
        const a = tokenSets[i];
        let dropped = false;
        for (let j = 0; j < entries.length; j++) {
            if (i === j) continue;
            const b = tokenSets[j];
            if (b.size <= a.size) continue;
            let containsAll = true;
            for (const t of a) {
                if (!b.has(t)) { containsAll = false; break; }
            }
            if (containsAll) { dropped = true; break; }
        }
        if (!dropped) result.push(entries[i]);
    }
    return result;
}

/** Übernimmt Automodus-Metadaten von Quell-Treffern (u. a. highlighted für consolidateAutoModeResults). */
export function pickMergedEntryMeta(matching) {
    const meta = {
        highlighted: matching.some(e => e.highlighted !== false)
    };
    if (matching.some(e => e.learnable)) meta.learnable = true;
    const rawLabel = matching.map(e => e.rawLabel).find(Boolean);
    if (rawLabel) meta.rawLabel = rawLabel;
    const begriff = matching.map(e => e.begriff).find(Boolean);
    if (begriff) meta.begriff = begriff;
    const snippet = matching.map(e => e.snippet).find(Boolean);
    if (snippet) meta.snippet = snippet;
    if (matching.some(e => e.configInactive)) meta.configInactive = true;
    return meta;
}

/**
 * Beispiel für das Konfig-Popup: welche Einzeltreffer zu welcher Zeile
 * zusammengefasst werden (gleiche Schreibweise wie generalizedMergeEntries).
 */
export function mergePreviewText(group, maxModifiers = 3) {
    const basis = ((group && group.basis) || '').trim();
    if (!basis) return null;
    const mods = ((group && group.order) || [])
        .map(m => String(m || '').trim())
        .filter(Boolean)
        .slice(0, maxModifiers);
    if (mods.length < 2) return null;
    const basisCap = basis.charAt(0).toUpperCase() + basis.slice(1);
    return {
        from: mods.map(m => basisCap + ' ' + m),
        to: basisCap + ' ' + mods.join(', ')
    };
}

/** Modifier in Original-Schreibweise („Außenspiegel elektr. verstellbar“ → „elektr. verstellbar“). */
function displayModifier(anzeige, group) {
    const basis = String(group.basis || '').trim();
    const re = new RegExp('^\\s*' + escapeRegex(basis) + '\\s*', 'i');
    if (basis && re.test(anzeige)) {
        const rest = anzeige.replace(re, '').trim();
        if (rest) return rest;
    }
    return mergeModifierFromEntry(anzeige, group);
}

/**
 * Aktive Ausstattungs-Einträge, die eine Merge-Gruppe zusammenfassen würde —
 * Grundlage für Vorschläge, Treffer-Prüfung und Beispiel im Konfig-Popup.
 */
export function mergeModifierCandidates(group, ausstattung) {
    if (!group || !String(group.basis || '').trim()) return [];
    const g = { ...group, aktiv: true };
    const seen = new Set();
    const out = [];
    (ausstattung || []).forEach(e => {
        if (!e || e.aktiv === false || !e.anzeige) return;
        if (!entryMatchesMergeGroup(e, g)) return;
        const key = normalizeOrderKey(mergeModifierFromEntry(e.anzeige, g));
        if (!key || key === normalizeOrderKey(g.basis) || seen.has(key)) return;
        seen.add(key);
        out.push({ anzeige: e.anzeige, modifier: displayModifier(e.anzeige, g), key });
    });
    return out;
}

/**
 * Prüft jeden Reihenfolge-Eintrag gegen die Kandidaten:
 * - ok: legt die Position mindestens eines Eintrags fest
 * - shadowed: trifft nur Einträge, die ein früherer Chip schon abdeckt
 * - unmatched: trifft keinen Eintrag
 * uncovered: Kandidaten ohne passenden Chip (landen am Ende).
 */
export function analyzeMergeOrder(group, candidates) {
    const order = (group && group.order) || [];
    const chips = order.map(() => ({ state: 'unmatched', hits: [], shadowedBy: [] }));
    const uncovered = [];
    (candidates || []).forEach(c => {
        const first = orderIndexOf(c.key, order);
        if (first === -1) {
            uncovered.push(c);
            return;
        }
        chips[first].hits.push(c);
        order.forEach((key, i) => {
            if (i === first) return;
            const k = normalizeOrderKey(key);
            if (k && c.key.includes(k) && !chips[i].shadowedBy.includes(first)) {
                chips[i].shadowedBy.push(first);
            }
        });
    });
    chips.forEach(ch => {
        if (ch.hits.length) ch.state = 'ok';
        else if (ch.shadowedBy.length) ch.state = 'shadowed';
    });
    return { chips, uncovered };
}

/** Beispiel aus echten Ausstattungs-Einträgen, genau wie generalizedMergeEntries es zusammenfasst. */
export function mergePreviewFromCandidates(group, candidates, max = 4) {
    if (!group || !String(group.basis || '').trim()) return null;
    const list = [...(candidates || [])];
    const order = group.order || [];
    list.sort((a, b) => {
        const ia = orderIndexOf(a.key, order);
        const ib = orderIndexOf(b.key, order);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    const pick = list.slice(0, max);
    if (pick.length < 2) return null;
    const merged = generalizedMergeEntries(
        pick.map(c => ({ anzeige: c.anzeige })),
        [{ ...group, aktiv: true }]
    );
    if (merged.length !== 1) return null;
    return { from: pick.map(c => c.anzeige), to: merged[0].anzeige, total: list.length };
}

export function generalizedMergeEntries(entries, gruppen) {
    if (!Array.isArray(gruppen) || gruppen.length === 0) return entries;
    let result = [...entries];
    gruppen.forEach(group => {
        if (!group || !group.basis || group.aktiv === false) return;
        const matching = result.filter(e => entryMatchesMergeGroup(e, group));
        if (matching.length <= 1) return;
        result = result.filter(e => !entryMatchesMergeGroup(e, group));
        let modifiers = matching
            .map(e => mergeModifierFromEntry(e.anzeige, group))
            .filter(Boolean);
        modifiers = Array.from(new Set(modifiers));
        sortByOrder(modifiers, group.order || []);
        const basisCap = group.basis.charAt(0).toUpperCase() + group.basis.slice(1);
        const merged = basisCap + (modifiers.length ? ' ' + modifiers.join(', ') : '');
        // beste confidence der Gruppe übernehmen
        const bestConf = matching.some(e => e.confidence === 'high') ? 'high' : 'low';
        const sources = [...new Set(matching.map(e => e.source))].join(',');
        result.push({
            anzeige: merged,
            farbe: matching[0].farbe,
            source: sources,
            confidence: bestConf,
            ...pickMergedEntryMeta(matching)
        });
    });
    return result;
}

// ============================================================
