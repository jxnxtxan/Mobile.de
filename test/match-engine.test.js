import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getMaxWordGap,
    isForbiddenInWindow,
    matchInTokens,
    tokenMatches,
} from '../src/core/match/engine.js';
import { tokenize } from '../src/core/text/normalize.js';

test('tokenMatches: Begriffe unter vier Zeichen nur exakt', () => {
    assert.equal(tokenMatches('abs', 'abs'), true);
    assert.equal(tokenMatches('absesp', 'abs'), false);
    assert.equal(tokenMatches('esp', 'es'), false);
});

test('tokenMatches: ab vier Zeichen Präfix und Suffix, ab fünf auch mitten im Wort', () => {
    assert.equal(tokenMatches('sitzheizung', 'sitz'), true);
    assert.equal(tokenMatches('sitzheizung', 'heizung'), true);
    assert.equal(tokenMatches('vordersitzheizung', 'sitzheiz'), true);
    // Vier Zeichen mitten im Wort bleiben gesperrt (head, glas, heiz, …).
    assert.equal(tokenMatches('vordersitzheizung', 'sitz'), false);
});

test('tokenMatches: Wortteil-Suche erlaubt Treffer im Wortinneren', () => {
    assert.equal(tokenMatches('standheizung', 'heiz', true), true);
    assert.equal(tokenMatches('standheizung', 'heiz', false), false);
});

test('matchInTokens: einzelner Begriff liefert seine Position', () => {
    assert.deepEqual(
        matchInTokens(tokenize('Sitzheizung vorn'), tokenize('Sitzheizung'), 0, false),
        { startIdx: 0, endIdx: 0 }
    );
});

test('matchInTokens: Mehrwort-Begriff findet das engste Fenster', () => {
    const tokens = tokenize('Außenspiegel elektrisch anklappbar und beheizbar, Sitze');
    const parts = tokenize('Außenspiegel beheizbar');
    assert.deepEqual(matchInTokens(tokens, parts, 4, false), { startIdx: 0, endIdx: 4 });
});

test('matchInTokens: zu großer Wortabstand liefert keinen Treffer', () => {
    const tokens = tokenize('Außenspiegel elektrisch anklappbar und beheizbar, Sitze');
    const parts = tokenize('Außenspiegel beheizbar');
    assert.equal(matchInTokens(tokens, parts, 3, false), null);
});

test('matchInTokens: fehlender Teilbegriff liefert null', () => {
    assert.equal(
        matchInTokens(tokenize('Sitzheizung vorn'), tokenize('Sitzheizung hinten'), 3, false),
        null
    );
    assert.equal(matchInTokens([], ['sitz'], 0, false), null);
    assert.equal(matchInTokens(['sitz'], [], 0, false), null);
});

test('getMaxWordGap wächst mit der Anzahl der Wortteile', () => {
    assert.equal(getMaxWordGap(1), 0);
    assert.equal(getMaxWordGap(2), 3);
    assert.equal(getMaxWordGap(5), 14);
    assert.equal(getMaxWordGap(6), 18);
});

/** Entspricht der Default-Korrektur „bremsassistent“ / verboten: notbrems. */
test('isForbiddenInWindow schlägt nur im gefundenen Fenster an', () => {
    const tokens = tokenize('Bremsassistent mit Notbremsfunktion');
    assert.equal(isForbiddenInWindow(tokens, { startIdx: 0, endIdx: 2 }, ['notbrems']), true);
    assert.equal(isForbiddenInWindow(tokens, { startIdx: 0, endIdx: 0 }, ['notbrems']), false);
});

test('isForbiddenInWindow ohne Verbote ist immer falsch', () => {
    const tokens = tokenize('Bremsassistent');
    assert.equal(isForbiddenInWindow(tokens, { startIdx: 0, endIdx: 0 }, []), false);
    assert.equal(isForbiddenInWindow(tokens, { startIdx: 0, endIdx: 0 }, null), false);
});
