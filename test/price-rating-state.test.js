import test from 'node:test';
import assert from 'node:assert/strict';

import {
    priceRatingFetchToken,
    priceRatingFetchTokenIncrement,
    vehicleProfileMemo,
} from '../src/features/price-rating/index.js';

/**
 * Der Token ist das Abbruchsignal für alles, was zur vorigen Seite gehört:
 * das Modell-Options-Polling (bis zu 4 s), der Stale-Retry-Timer und das
 * Profil-Memo. Vorher erhöhte die Funktion nur den Zähler, sodass ein Poll
 * nach der Navigation weiterlief und die Modell-Liste einer fremden Seite
 * unter der alten `makeId` cachen konnte.
 */
test('priceRatingFetchTokenIncrement erhöht den Token', () => {
    const before = priceRatingFetchToken;
    priceRatingFetchTokenIncrement();
    assert.equal(priceRatingFetchToken, before + 1);
});

test('priceRatingFetchTokenIncrement verwirft das Profil-Memo', () => {
    priceRatingFetchTokenIncrement();
    assert.deepEqual(vehicleProfileMemo, { key: '', ts: 0, profile: null });
});

test('mehrfaches Invalidieren bleibt monoton', () => {
    const before = priceRatingFetchToken;
    priceRatingFetchTokenIncrement();
    priceRatingFetchTokenIncrement();
    priceRatingFetchTokenIncrement();
    assert.equal(priceRatingFetchToken, before + 3);
});
