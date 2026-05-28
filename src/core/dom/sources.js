import { tokenize } from '../text/normalize.js';
import { getDescriptionEl, getFeatureItems, getTechDataDl, getZusatzEl } from './selectors.js';

export function classifyDescription(rawText) {
    if (!rawText) return 'low';
    const items = rawText.split(/,/).map(s => s.trim()).filter(Boolean);
    // Eindeutige Komma-Liste: viele Items → strukturierte Ausstattung.
    if (items.length >= 12) return 'high';
    if (items.length >= 6) {
        // Anteil kurzer Items zählen statt nur Mittelwert (robuster gegen
        // einzelne lange Items wie "Multi-Media-Interface MMI Navigation").
        const shortRatio = items.filter(it => it.split(/\s+/).length <= 5).length / items.length;
        if (shortRatio >= 0.6) return 'high';
    }
    return 'low';
}

/**
 * Liefert eine Liste von Quellen mit confidence:
 *   - features    -> high
 *   - tech        -> high
 *   - description -> high (wenn Komma-Liste) sonst low
 *   - zusatz      -> low
 */
export function extractSources() {
    const sources = [];

    const featureItems = getFeatureItems();
    if (featureItems.length > 0) {
        const text = featureItems.map(li => li.textContent.trim()).filter(Boolean).join(' | ');
        sources.push({ id: 'features', confidence: 'high', text, tokens: tokenize(text) });
    }

    const techDl = getTechDataDl();
    if (techDl) {
        const text = techDl.textContent.replace(/\s+/g, ' ').trim();
        sources.push({ id: 'tech', confidence: 'high', text, tokens: tokenize(text) });
    }

    const desc = getDescriptionEl();
    if (desc) {
        const rawText = desc.textContent.replace(/\s+/g, ' ').trim();
        const confidence = classifyDescription(rawText);
        const text = rawText.replace(/,/g, ' ');
        sources.push({ id: 'description', confidence, text, tokens: tokenize(text) });
    }

    const zusatz = getZusatzEl();
    if (zusatz) {
        const text = zusatz.textContent.trim();
        sources.push({ id: 'zusatz', confidence: 'low', text, tokens: tokenize(text) });
    }
    return sources;
}

// ============================================================
