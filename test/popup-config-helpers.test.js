import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clampInt,
    clampNum,
    thresholdsAscending,
    mergePriceRating,
    priceRatingDefault,
    withDerivedDebugMaster,
} from '../src/config/feature-flags/index.js';
import { cohortHumanLabel } from '../src/features/price-rating/index.js';

/** `parseInt(x) || alt` machte aus einer eingegebenen 0 den alten Wert. */
test('clampInt behält 0 und begrenzt auf den Bereich', () => {
    assert.equal(clampInt('0', 0, 200000, 10000), 0);
    assert.equal(clampInt('250000', 0, 200000, 10000), 200000);
    assert.equal(clampInt('-5', 0, 80, 7), 0);
    assert.equal(clampInt('abc', 0, 80, 7), 7);
    assert.equal(clampInt('', 5, 50, 10), 10);
});

test('clampNum akzeptiert Komma und begrenzt', () => {
    assert.equal(clampNum('1,5', 0, 10, 0), 1.5);
    assert.equal(clampNum('12', 0, 10, 0), 10);
    assert.equal(clampNum('x', 0, 10, 3), 3);
});

test('Schwellen müssen streng aufsteigen, sonst gelten die Defaults', () => {
    const d = priceRatingDefault();
    assert.equal(thresholdsAscending(d.thresholds), true);
    const kaputt = [
        { maxPct: -0.12, level: 0 },
        { maxPct: 0.05, level: 1 },
        { maxPct: 0.04, level: 2 },
        { maxPct: 0.12, level: 3 },
        { maxPct: null, level: 4 }
    ];
    const pr = mergePriceRating({ thresholds: kaputt });
    assert.deepEqual(pr.thresholds.map(t => t.maxPct), d.thresholds.map(t => t.maxPct));
});

test('gespeicherte Schwellen mit null als letzter Grenze bleiben gültig', () => {
    const ok = [
        { maxPct: -0.15, level: 0 },
        { maxPct: -0.05, level: 1 },
        { maxPct: 0.05, level: 2 },
        { maxPct: 0.15, level: 3 },
        { maxPct: null, level: 4 }
    ];
    const pr = mergePriceRating({ thresholds: ok });
    assert.equal(pr.thresholds[0].maxPct, -0.15);
    assert.equal(pr.thresholds[4].maxPct, Infinity);
});

test('€ pro Punkt ist auf 5000 gedeckelt', () => {
    assert.equal(mergePriceRating({ punktZuEuro: 99999 }).punktZuEuro, 5000);
});

test('Debug-Hauptschalter folgt Modulen und Log-Cards', () => {
    assert.equal(withDerivedDebugMaster({ enabled: true, scopes: { price: false }, showSrpLogCard: false }).enabled, false);
    assert.equal(withDerivedDebugMaster({ enabled: false, scopes: { price: true }, showSrpLogCard: false }).enabled, true);
    assert.equal(withDerivedDebugMaster({ enabled: false, scopes: {}, showSrpLogCard: true }).enabled, true);
});

test('Kohorten-Beschriftung zeigt den EZ-Bereich statt des Gruppenanfangs', () => {
    const prCfg = { ...priceRatingDefault(), yearTolerance: 1, keyYearBucket: 1 };
    const label = cohortHumanLabel(
        { make: 'Audi', model: 'A6', firstRegistrationYear: 2015, mileageKm: 241000, powerKw: 235 },
        prCfg
    );
    assert.match(label, /EZ 2013–2015/);
    assert.doesNotMatch(label, /Bucket/);
});
