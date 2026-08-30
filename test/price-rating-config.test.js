import test from 'node:test';
import assert from 'node:assert/strict';

import { mergePriceRating, priceRatingDefault } from '../src/config/feature-flags/index.js';

/**
 * `parseInt(x) || default` verwarf die eingegebene 0 und schrieb den Default
 * zurück. Bei den drei Toleranzen ist 0 aber gültig und bedeutet „exakte
 * Übereinstimmung verlangen“ — sichtbar an der umschließenden Math.max(0, …).
 */
test('Toleranz 0 bleibt erhalten', () => {
    const pr = mergePriceRating({ kmToleranceAbs: 0, yearTolerance: 0, powerToleranceKw: 0 });
    assert.equal(pr.kmToleranceAbs, 0);
    assert.equal(pr.yearTolerance, 0);
    assert.equal(pr.powerToleranceKw, 0);
});

test('unbrauchbare Werte fallen auf die Defaults zurück', () => {
    const d = priceRatingDefault();
    const pr = mergePriceRating({ kmToleranceAbs: 'abc', yearTolerance: null, punktZuEuro: undefined });
    assert.equal(pr.kmToleranceAbs, d.kmToleranceAbs);
    assert.equal(pr.yearTolerance, d.yearTolerance);
    assert.equal(pr.punktZuEuro, d.punktZuEuro);
});

test('Werte werden auf ihre Grenzen geklemmt', () => {
    const klein = mergePriceRating({ minComparables: 0, keyKmBucket: 1, maxAdjustPct: 0 });
    assert.equal(klein.minComparables, 5);
    assert.equal(klein.keyKmBucket, 500);
    assert.equal(klein.maxAdjustPct, 0.05);

    const gross = mergePriceRating({ minComparables: 999, keyKmBucket: 999999, yearTolerance: 99 });
    assert.equal(gross.minComparables, 50);
    assert.equal(gross.keyKmBucket, 50000);
    assert.equal(gross.yearTolerance, 3);
});

/**
 * Die oberste Schwelle ist Infinity. JSON.stringify schreibt dafür null —
 * der Roundtrip durch den Tampermonkey-Speicher muss trotzdem Infinity
 * ergeben, sonst greift die höchste Preisstufe nie.
 */
test('oberste Schwelle übersteht den JSON-Roundtrip als Infinity', () => {
    const roundtrip = JSON.parse(JSON.stringify(priceRatingDefault()));
    assert.equal(roundtrip.thresholds[4].maxPct, null);
    const pr = mergePriceRating(roundtrip);
    assert.equal(pr.thresholds[4].maxPct, Infinity);
    assert.equal(pr.thresholds.length, 5);
});

test('999 wird als offene obere Schwelle gelesen', () => {
    const pr = mergePriceRating({
        thresholds: [
            { maxPct: -0.12, level: 0 },
            { maxPct: -0.04, level: 1 },
            { maxPct: 0.04, level: 2 },
            { maxPct: 0.12, level: 3 },
            { maxPct: 999, level: 4 },
        ],
    });
    assert.equal(pr.thresholds[4].maxPct, Infinity);
    assert.equal(pr.thresholds[0].maxPct, -0.12);
});

test('Schalter sind nur bei explizitem false aus', () => {
    assert.equal(mergePriceRating({}).enabled, true);
    assert.equal(mergePriceRating({ enabled: false }).enabled, false);
    assert.equal(mergePriceRating({ useModelRange: false }).useModelRange, false);
    assert.equal(mergePriceRating({ onlyFavoriteWeights: true }).onlyFavoriteWeights, true);
    assert.equal(mergePriceRating({}).onlyFavoriteWeights, false);
});

test('fehlende Konfiguration ergibt die Defaults', () => {
    assert.deepEqual(mergePriceRating(null), priceRatingDefault());
    assert.deepEqual(mergePriceRating(undefined), priceRatingDefault());
});
