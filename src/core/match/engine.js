import { escapeRegex } from '../text/normalize.js';

export const MAX_WORD_GAP = { 1: 0, 2: 3, 3: 6, 4: 10, 5: 14 };
export function getMaxWordGap(parts) {
    return MAX_WORD_GAP[parts] || (parts > 5 ? parts * 3 : 0);
}

export function tokenMatches(token, part, compound) {
    if (!token || !part) return false;
    if (token === part) return true;
    if (part.length < 4) return false;
    if (compound) return token.includes(part);
    if (token.startsWith(part) || token.endsWith(part)) return true;
    // Mid-substring nur ab 5 Zeichen erlauben, um false-positives bei
    // 4-Zeichen-Patterns (head, glas, heiz, ende, …) zu vermeiden.
    if (part.length >= 5 && token.includes(part)) return true;
    return false;
}

export function findPositions(tokens, part, compound) {
    const positions = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokenMatches(tokens[i], part, compound)) positions.push(i);
    }
    return positions;
}

/**
 * Sucht ein Fenster in `tokens`, das alle `parts` enthält und
 * dabei höchstens maxGap Wörter Differenz zwischen erstem und
 * letztem getroffenen Token hat.
 * Gibt {startIdx, endIdx} oder null zurück.
 */
export function matchInTokens(tokens, parts, maxGap, compound) {
    if (parts.length === 0 || tokens.length === 0) return null;
    if (parts.length === 1) {
        const pos = findPositions(tokens, parts[0], compound);
        if (pos.length === 0) return null;
        return { startIdx: pos[0], endIdx: pos[0] };
    }
    const positionLists = parts.map(p => findPositions(tokens, p, compound));
    for (const list of positionLists) {
        if (list.length === 0) return null;
    }
    // Pointer pro Liste -> sliding window
    const pointers = new Array(positionLists.length).fill(0);
    let best = null;
    while (true) {
        const current = positionLists.map((list, i) => list[pointers[i]]);
        const min = Math.min(...current);
        const max = Math.max(...current);
        if (max - min <= maxGap) {
            if (!best || (max - min) < (best.endIdx - best.startIdx)) {
                best = { startIdx: min, endIdx: max };
                if (max - min === parts.length - 1) return best;
            }
        }
        // bewege den Pointer mit dem kleinsten Wert weiter
        const minListIdx = current.indexOf(min);
        pointers[minListIdx]++;
        if (pointers[minListIdx] >= positionLists[minListIdx].length) break;
    }
    return best;
}

export function isForbiddenInWindow(tokens, window, verboten) {
    if (!verboten || verboten.length === 0) return false;
    const slice = tokens.slice(window.startIdx, window.endIdx + 1).join(' ');
    const pattern = new RegExp(verboten.map(escapeRegex).join('|'), 'i');
    return pattern.test(slice);
}

// ============================================================
