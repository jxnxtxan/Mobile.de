import test from 'node:test';
import assert from 'node:assert/strict';

import {
    itemMatchesCohortProfile,
    excludeOwnAdFromCohort,
    equipmentBaseline,
    equipmentAdjustCapPct,
    mobileMarketPriceFromRating,
    cohortCacheWriteSet,
    cohortMemoSignature,
} from '../src/features/price-rating/index.js';
import { findConfigEntryForRawLabel } from '../src/core/search/automode.js';
import { runtimeState } from '../src/config/runtime-state.js';
import { priceRatingDefault } from '../src/config/feature-flags/index.js';
import { migratePriceRatingMaxAdjust, migratePriceRatingMinComparables } from '../src/config/migration/index.js';

const pr = { ...priceRatingDefault(), kmToleranceAbs: 10000, yearTolerance: 1, powerToleranceKw: 0 };
const profil = {
    id: '45666909071712', make: 'Audi', model: 'A6', makeId: '1900', modelId: '10',
    mileageKm: 241000, firstRegistrationYear: 2015, powerKw: 235
};

/**
 * Echter Fall A6 3.0 BiTDI: Einträge ohne Leistung (Neuwagen für 85.990 €,
 * alte 2.0 TDI) rutschten durch, weil nur geprüft wurde, wenn beide Seiten
 * den Wert kannten.
 */
test('Vergleichsfahrzeug ohne Leistung fliegt raus, wenn das Profil sie kennt', () => {
    const ohneLeistung = { id: '1', make: 'Audi', model: 'A6', makeId: '1900', modelId: '10', mileageKm: 240000, firstRegistrationYear: 2015 };
    assert.equal(itemMatchesCohortProfile(ohneLeistung, profil, pr), false);
});

test('Vergleichsfahrzeug ohne km und EZ fliegt raus', () => {
    const neuwagen = { id: '2', make: 'Audi', model: 'A6', makeId: '1900', modelId: '10', powerKw: 235 };
    assert.equal(itemMatchesCohortProfile(neuwagen, profil, pr), false);
});

test('vollständiges passendes Vergleichsfahrzeug bleibt drin', () => {
    const passt = { id: '3', make: 'Audi', model: 'A6', makeId: '1900', modelId: '10', mileageKm: 235000, firstRegistrationYear: 2016, powerKw: 235 };
    assert.equal(itemMatchesCohortProfile(passt, profil, pr), true);
});

test('fehlt der Wert im Profil, wird er auch beim Vergleichsfahrzeug nicht verlangt', () => {
    const ohneKm = { ...profil, mileageKm: null };
    const item = { id: '4', make: 'Audi', model: 'A6', makeId: '1900', modelId: '10', firstRegistrationYear: 2015, powerKw: 235 };
    assert.equal(itemMatchesCohortProfile(item, ohneKm, pr), true);
});

test('eigenes Inserat wird aus der Kohorte entfernt', () => {
    const items = [{ id: '45666909071712' }, { id: '9' }, { id: 45666909071712 }];
    assert.deepEqual(excludeOwnAdFromCohort(items, profil).map(i => i.id), ['9']);
    assert.equal(excludeOwnAdFromCohort(items, { id: null }).length, 3);
});

test('ab 3 bekannten Ausstattungen zählt nur deren Median', () => {
    const c = [
        { equipmentFromVipCache: true, equipment: { score: 4 } },
        { equipmentFromVipCache: true, equipment: { score: 6 } },
        { equipmentFromVipCache: true, equipment: { score: 5 } },
        { equipment: { score: 0 } },
        { equipment: { score: 0 } },
        { equipment: { score: 0 } },
        { equipment: { score: 0 } }
    ];
    const b = equipmentBaseline(c, c.map(x => x.equipment.score));
    assert.equal(b.basis, 'known');
    assert.equal(b.knownCount, 3);
    assert.equal(b.medianEquip, 5);
});

test('unter 3 bekannten bleibt der alte Median über alle', () => {
    const c = [
        { equipmentFromVipCache: true, equipment: { score: 4 } },
        { equipment: { score: 0 } },
        { equipment: { score: 0 } }
    ];
    const b = equipmentBaseline(c, c.map(x => x.equipment.score));
    assert.equal(b.basis, 'all');
    assert.equal(b.medianEquip, 0);
});

/**
 * „Elektr. Sitzeinstellung“ steht alphabetisch vor „… mit Memory-Funktion“ und
 * gewann als Teilstring — damit fiel das Preisgewicht der Memory-Sitze weg.
 */
test('Konfig-Zuordnung bevorzugt den exakten Eintrag vor dem Teilstring', () => {
    const vorher = runtimeState.suchKonfigurationen;
    runtimeState.suchKonfigurationen = [
        { anzeige: 'Elektr. Sitzeinstellung', begriffe: ['elektr sitzeinstellung'], aktiv: true },
        { anzeige: 'Elektr. Sitzeinstellung mit Memory-Funktion', begriffe: ['memory'], aktiv: true },
        { anzeige: 'Klimaautomatik', begriffe: ['klima autom'], aktiv: false },
        { anzeige: '4-Zonen-Klimaautomatik', begriffe: ['4 zonen klima'], aktiv: true }
    ];
    try {
        assert.equal(
            findConfigEntryForRawLabel('Elektr. Sitzeinstellung mit Memory-Funktion').anzeige,
            'Elektr. Sitzeinstellung mit Memory-Funktion'
        );
        assert.equal(findConfigEntryForRawLabel('Elektr. Sitzeinstellung').anzeige, 'Elektr. Sitzeinstellung');
        assert.equal(findConfigEntryForRawLabel('Klimaautomatik').anzeige, 'Klimaautomatik');
    } finally {
        runtimeState.suchKonfigurationen = vorher;
    }
});

test('Migration hebt nur den alten Default 12 % auf 20 %', () => {
    assert.equal(migratePriceRatingMaxAdjust({ maxAdjustPct: 0.12 }, 11).maxAdjustPct, 0.2);
    assert.equal(migratePriceRatingMaxAdjust({ maxAdjustPct: 0.15 }, 11).maxAdjustPct, 0.15);
    assert.equal(migratePriceRatingMaxAdjust({ maxAdjustPct: 0.12 }, 12).maxAdjustPct, 0.12);
});

/**
 * Echte Werte des A6 (16.800 €, „Guter Preis“, Offset 84). Früher wurde der
 * Offset als Position über die ganze Skala gelesen → 20.836 € Marktpreis.
 */
test('mobile.de-Marktpreis ist die Mitte des Fair-Bereichs', () => {
    const pr = {
        thresholdLabels: ['12.100 €', '15.700 €', '17.000 €', '18.900 €', '20.200 €', '22.500 €'],
        vehiclePriceOffset: 84
    };
    assert.equal(mobileMarketPriceFromRating(pr), 17950);
});

test('Ausstattungs-Kappung halbiert sich nur beim mobile.de-Marktpreis', () => {
    assert.equal(equipmentAdjustCapPct(0.2, 'mobile'), 0.1);
    assert.equal(equipmentAdjustCapPct(0.2, 'cohort'), 0.2);
});

test('Migration senkt nur den alten Default 20 Vergleichsfahrzeuge auf 10', () => {
    assert.equal(migratePriceRatingMinComparables({ minComparables: 20 }, 12).minComparables, 10);
    assert.equal(migratePriceRatingMinComparables({ minComparables: 15 }, 12).minComparables, 15);
    assert.equal(migratePriceRatingMinComparables({ minComparables: 20 }, 13).minComparables, 20);
});

test('Cache-Rückschrieb behält Einträge, die nur andere Profile brauchen', () => {
    const cached = [{ id: 'a', mileageKm: 52000 }, { id: 'b', mileageKm: 41000 }];
    const store = [{ id: 'b', mileageKm: 41000 }, { id: 'c', mileageKm: 39000 }];
    const w = cohortCacheWriteSet(cached, store);
    assert.deepEqual(w.items.map(i => i.id).sort(), ['a', 'b', 'c']);
    assert.equal(w.added, 1);
});

test('Cache-Rückschrieb ohne neue Store-Treffer meldet nichts Neues', () => {
    const w = cohortCacheWriteSet([{ id: 'a' }], [{ id: 'a' }]);
    assert.equal(w.added, 0);
});

test('Kohorten-Memo unterscheidet Profile mit gleichem Cache-Key', () => {
    const a = { ...profil, id: '1', mileageKm: 37600 };
    const b = { ...profil, id: '2', mileageKm: 42400 };
    assert.notEqual(cohortMemoSignature(a), cohortMemoSignature(b));
    assert.equal(cohortMemoSignature(a), cohortMemoSignature({ ...a }));
});
