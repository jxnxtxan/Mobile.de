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

test('Merge-Vorschau zeigt Einzeltreffer und zusammengefasste Zeile', async () => {
    const { mergePreviewText } = await import('../src/core/search/merge-groups.js');
    const pv = mergePreviewText({ basis: 'außenspiegel', order: ['elektr. verstellbar', 'beheizbar', 'anklappbar', 'klappbar'] });
    assert.deepEqual(pv.from, ['Außenspiegel elektr. verstellbar', 'Außenspiegel beheizbar', 'Außenspiegel anklappbar']);
    assert.equal(pv.to, 'Außenspiegel elektr. verstellbar, beheizbar, anklappbar');
    assert.equal(mergePreviewText({ basis: 'x', order: ['a'] }), null);
    assert.equal(mergePreviewText({ basis: '', order: ['a', 'b'] }), null);
});

test('Merge-Reihenfolge greift auch bei Schlüsseln mit Punkt', async () => {
    const { generalizedMergeEntries } = await import('../src/core/search/merge-groups.js');
    const out = generalizedMergeEntries(
        [{ anzeige: 'Außenspiegel beheizbar' }, { anzeige: 'Außenspiegel elektr. verstellbar' }, { anzeige: 'Außenspiegel anklappbar' }],
        [{ basis: 'außenspiegel', order: ['elektr. verstellbar', 'beheizbar', 'anklappbar'], aktiv: true }]
    );
    assert.deepEqual(out.map(e => e.anzeige), ['Außenspiegel elektr. verstellbar, beheizbar, anklappbar']);
});

test('Merge-Kandidaten: nur aktive Einträge der Basis, ohne Kombi-Spiegel', async () => {
    const { mergeModifierCandidates } = await import('../src/core/search/merge-groups.js');
    const aus = [
        { anzeige: 'Außenspiegel anklappbar', aktiv: true },
        { anzeige: 'Außenspiegel beheizbar', aktiv: true },
        { anzeige: 'Außenspiegel elektr. verstellbar', aktiv: false },
        { anzeige: 'Außen-/Innenspiegel automatisch abblendend', aktiv: true },
        { anzeige: 'Sitzheizung', aktiv: true }
    ];
    const c = mergeModifierCandidates({ basis: 'außenspiegel', aktiv: false }, aus);
    assert.deepEqual(c.map(x => x.modifier), ['anklappbar', 'beheizbar']);
    assert.deepEqual(mergeModifierCandidates({ basis: '' }, aus), []);
});

test('Merge-Reihenfolge prüfen: wirksam, überflüssig, ohne Treffer, fehlend', async () => {
    const { mergeModifierCandidates, analyzeMergeOrder } = await import('../src/core/search/merge-groups.js');
    const aus = [
        { anzeige: 'Außenspiegel anklappbar' },
        { anzeige: 'Außenspiegel beheizbar' },
        { anzeige: 'Außenspiegel automatisch abblendend' }
    ];
    const group = { basis: 'außenspiegel', order: ['anklappbar', 'klappbar', 'automatisch abblend.', 'auto. abblend.'] };
    const r = analyzeMergeOrder(group, mergeModifierCandidates(group, aus));
    assert.deepEqual(r.chips.map(c => c.state), ['ok', 'shadowed', 'ok', 'unmatched']);
    assert.deepEqual(r.chips[1].shadowedBy, [0]);
    assert.deepEqual(r.uncovered.map(c => c.modifier), ['beheizbar']);
});

test('Merge-Beispiel aus echten Einträgen in Reihenfolge', async () => {
    const { mergeModifierCandidates, mergePreviewFromCandidates } = await import('../src/core/search/merge-groups.js');
    const aus = [
        { anzeige: 'Außenspiegel anklappbar' },
        { anzeige: 'Außenspiegel beheizbar' },
        { anzeige: 'Außenspiegel elektr. verstellbar' }
    ];
    const group = { basis: 'außenspiegel', order: ['elektr. verstellbar', 'beheizbar'] };
    const pv = mergePreviewFromCandidates(group, mergeModifierCandidates(group, aus));
    assert.deepEqual(pv.from, ['Außenspiegel elektr. verstellbar', 'Außenspiegel beheizbar', 'Außenspiegel anklappbar']);
    assert.equal(pv.to, 'Außenspiegel elektr. verstellbar, beheizbar, anklappbar');
    assert.equal(mergePreviewFromCandidates(group, mergeModifierCandidates(group, aus.slice(0, 1))), null);
});
