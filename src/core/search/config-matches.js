import { cleanText, tokenize } from '../text/normalize.js';
import { isManualScope } from '../../config/ordering.js';
import { getMaxWordGap, isForbiddenInWindow, matchInTokens } from '../match/engine.js';

export function begriffMatchScore(begriff) {
    return tokenize(begriff).length;
}

export function windowKey(srcId, window) {
    return srcId + ':' + window.startIdx + ':' + window.endIdx;
}

export function isOnlyFeaturesSource(src) {
    if (!src || !src.id) return false;
    return src.id === 'features' || src.id === 'tech';
}

/**
 * Sammelt Treffer pro Quelle/Fenster/Anzeige. Gleicher Begriff darf
 * mehrere Anzeige-Einträge treffen (z. B. beheizbar + verstellbar), aber
 * pro Anzeige nur den spezifischsten Begriff.
 */
export function collectConfigMatches(sources, configs) {
    const candidates = [];
    const configList = isManualScope('ausstattung') || isManualScope('ausstattungFavorites')
        ? [...configs]
        : [...configs].sort((a, b) => (a.anzeige || '').localeCompare(b.anzeige || '', 'de'));

    configList.forEach(cfg => {
        if (!cfg.aktiv) return;
        if (!Array.isArray(cfg.begriffe) || cfg.begriffe.length === 0) return;

        const onlyHigh = cfg.nurInFeatures === true;
        const compound = cfg.compound === true;

        for (const src of sources) {
            if (onlyHigh && !isOnlyFeaturesSource(src)) continue;

            for (const begriff of cfg.begriffe) {
                const parts = tokenize(begriff);
                if (parts.length === 0) continue;
                const maxGap = getMaxWordGap(parts.length);
                const window = matchInTokens(src.tokens, parts, maxGap, compound);
                if (!window) continue;
                if (cfg.verboten && cfg.verboten.length > 0) {
                    const forbiddenParts = cfg.verboten
                        .map(v => cleanText(v))
                        .filter(Boolean);
                    if (isForbiddenInWindow(src.tokens, window, forbiddenParts)) {
                        continue;
                    }
                }
                const snippetTokens = src.tokens.slice(
                    Math.max(0, window.startIdx - 2),
                    Math.min(src.tokens.length, window.endIdx + 3)
                );
                candidates.push({
                    anzeige: cfg.anzeige,
                    farbe: (cfg.farbe || '#66ff66').toLowerCase(),
                    source: src.id,
                    confidence: src.confidence,
                    snippet: snippetTokens.join(' '),
                    begriff,
                    window,
                    score: begriffMatchScore(begriff)
                });
            }
        }
    });

    const bestPerAnzeigeWindow = new Map();
    candidates.forEach(c => {
        const key = windowKey(c.source, c.window) + ':' + cleanText(c.anzeige);
        const prev = bestPerAnzeigeWindow.get(key);
        if (!prev || c.score > prev.score) bestPerAnzeigeWindow.set(key, c);
    });

    return [...bestPerAnzeigeWindow.values()].map(c => ({
        anzeige: c.anzeige,
        farbe: c.farbe,
        source: c.source,
        confidence: c.confidence,
        snippet: c.snippet,
        begriff: c.begriff
    }));
}

// ============================================================
