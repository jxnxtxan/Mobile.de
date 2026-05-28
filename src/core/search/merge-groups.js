import { cleanText, tokenize } from '../text/normalize.js';
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
    const order = (group.order || []).map(item => item.toLowerCase());

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
    mods.sort((a, b) => {
        let ia = order.findIndex(key => a.toLowerCase().includes(key.replace(/\./g, '').trim()));
        let ib = order.findIndex(key => b.toLowerCase().includes(key.replace(/\./g, '').trim()));
        if (ia === -1) ia = 999;
        if (ib === -1) ib = 999;
        return ia - ib;
    });
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

export function generalizedMergeEntries(entries, gruppen) {
    if (!Array.isArray(gruppen) || gruppen.length === 0) return entries;
    let result = [...entries];
    gruppen.forEach(group => {
        if (!group || !group.basis || group.aktiv === false) return;
        const order = (group.order || []).map(item => item.toLowerCase());
        const matching = result.filter(e => entryMatchesMergeGroup(e, group));
        if (matching.length <= 1) return;
        result = result.filter(e => !entryMatchesMergeGroup(e, group));
        let modifiers = matching
            .map(e => mergeModifierFromEntry(e.anzeige, group))
            .filter(Boolean);
        modifiers = Array.from(new Set(modifiers));
        modifiers.sort((a, b) => {
            let ia = order.findIndex(key => a.includes(key.replace(/\./g, '').trim()));
            let ib = order.findIndex(key => b.includes(key.replace(/\./g, '').trim()));
            if (ia === -1) ia = 999;
            if (ib === -1) ib = 999;
            return ia - ib;
        });
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
