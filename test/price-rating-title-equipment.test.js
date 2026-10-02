import test from 'node:test';
import assert from 'node:assert/strict';

import { equipmentFingerprintForTexts, computePriceRating } from '../src/features/price-rating/index.js';
import { suchKonfigurationenDefault } from '../src/config/defaults/ausstattung.js';
import { runtimeState } from '../src/config/runtime-state.js';
import { priceRatingDefault } from '../src/config/feature-flags/index.js';

runtimeState.featureFlags = { priceRating: priceRatingDefault() };
runtimeState.suchKonfigurationen = suchKonfigurationenDefault;

const keysFor = title => equipmentFingerprintForTexts({ titleBlob: title }, suchKonfigurationenDefault)
    .breakdown.map(b => b.key);

/**
 * Echter Fall Audi A4 (SRP): Ein Titelstück wie „S“ oder „P“ steckt in fast
 * jedem Ausstattungsbegriff. Der Abgleich „Begriff enthält Titelstück“ machte
 * daraus 24 Punkte (Keramikbremse, Laserlicht, Nachtsicht …), das Inserat wirkte
 * dadurch ~20 % billiger als erwartet.
 */
test('Ein-Buchstaben-Titelstücke ergeben keine Ausstattung', () => {
    assert.deepEqual(keysFor('Audi A4 Avant 35 2.0 TFSI S-tronic 17"+NAVI+LED+DAB+S'), []);
    assert.deepEqual(keysFor('Audi A4 Avant 35 2.0 TFSI S-tronic NAVI+LED+DAB+SHZ+P'), []);
});

test('„LED“ im Titel ist weder Leder noch Matrix-Licht', () => {
    assert.deepEqual(keysFor('Audi A4 Avant 2.0 35 TFSI Navi|SHZ|Alu|LED'), []);
});

test('Abkürzungen ab 4 Zeichen treffen weiter den Begriff', () => {
    const keys = keysFor('Audi A4 Avant 40 TDI+Pano+Leder+ACC');
    assert.ok(keys.includes('panoramadach'), keys.join(', '));
    assert.ok(keys.includes('lederausstattung'), keys.join(', '));
    assert.ok(keys.includes('abstandstempomat'), keys.join(', '));
});

/**
 * Auf der Ergebnisliste hängt am eigenen Profil schon die beim Detailseiten-
 * Besuch gespeicherte Ausstattung. Die Bewertung rechnete trotzdem neu aus dem
 * Titel und landete bei 0 Punkten.
 */
test('SRP: gespeicherte Detailseiten-Ausstattung des eigenen Inserats zählt', () => {
    const prevLocation = globalThis.location;
    globalThis.location = { pathname: '/fahrzeuge/search.html' };
    try {
        const equipment = { keys: new Set(['abstandstempomat']), score: 1, breakdown: [{ key: 'abstandstempomat', label: 'Abstandstempomat', weight: 1, source: 'features' }] };
        const profile = {
            id: '1', make: 'Audi', model: 'A4', title: 'Audi A4', subTitle: 'Avant 35 TFSI',
            priceGross: 20000, equipment, equipmentFromVipCache: true
        };
        const comparables = Array.from({ length: 6 }, (_, i) => ({
            id: 'c' + i, priceGross: 20000, equipment: { score: 0 }
        }));
        const rating = computePriceRating(profile, comparables);
        assert.equal(rating.ok, true);
        assert.equal(rating.ownScore, 1);
    } finally {
        globalThis.location = prevLocation;
    }
});

/**
 * Das Kartenprofil der Ergebnisliste kam ohne die gespeicherte Ausstattung bei
 * computePriceRating an — der Zweig oben griff dadurch nie, die Liste rechnete
 * weiter nur mit dem Titel (Detailseite „Guter Preis“, Liste „Fair“).
 */
test('SRP: Kartenprofil übernimmt gespeicherte Detailseiten-Ausstattung', async () => {
    const { withCachedVipEquipment, writeVipEquipCache } = await import('../src/features/price-rating/index.js');
    const prevStorage = globalThis.localStorage;
    const mem = new Map();
    globalThis.localStorage = {
        getItem: k => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: k => mem.delete(k),
        key: i => [...mem.keys()][i] ?? null,
        get length() { return mem.size; }
    };
    try {
        writeVipEquipCache('42', { score: 3, breakdown: [{ key: 'abstandstempomat', weight: 3 }] });
        const besucht = withCachedVipEquipment({ id: '42', title: 'Audi A4' });
        assert.equal(besucht.equipmentFromVipCache, true);
        assert.equal(besucht.equipment.score, 3);

        const unbekannt = withCachedVipEquipment({ id: '43', title: 'Audi A4' });
        assert.equal(unbekannt.equipmentFromVipCache, undefined);
        assert.equal(unbekannt.equipment, undefined);
        assert.equal(withCachedVipEquipment(null), null);
    } finally {
        globalThis.localStorage = prevStorage;
    }
});

test('cohortPriceSpread: Interquartilsabstand relativ zum Median', async () => {
    const { cohortPriceSpread } = await import('../src/features/price-rating/index.js');
    assert.equal(cohortPriceSpread([20000, 20000, 20000]), null);
    assert.equal(cohortPriceSpread([20000, 20000, 20000, 20000]), 0);
    const breit = cohortPriceSpread([16000, 18000, 20000, 22000, 24000]);
    assert.ok(breit > 0.15 && breit < 0.25, String(breit));
});

/**
 * Echter Fall: Ergebnisliste „ab 20.000 €, Preis aufsteigend“ — alle Vergleichs-
 * fahrzeuge zwischen 20.200 und 20.450 €, jede Karte kam bei „Fair“ heraus.
 */
test('Zu einheitliche Vergleichsgruppe wird als unsicher markiert', async () => {
    const { computePriceRating } = await import('../src/features/price-rating/index.js');
    const prevLocation = globalThis.location;
    globalThis.location = { pathname: '/fahrzeuge/search.html' };
    try {
        const equipment = { keys: new Set(), score: 0, breakdown: [] };
        const profile = { id: '1', priceGross: 20220, make: 'Audi', model: 'A4' };
        const eng = [20200, 20220, 20248, 20248, 20333, 20380, 20390, 20400, 20420, 20448, 20450, 20450]
            .map((p, i) => ({ id: 'c' + i, priceGross: p, equipment: { score: 0 } }));
        const r1 = computePriceRating(profile, eng, { equipment });
        assert.equal(r1.ok, true);
        assert.equal(r1.narrowCohort, true);

        const breit = [16500, 17900, 18800, 19400, 20100, 20500, 21300, 22000, 22900, 24500, 25800, 27000]
            .map((p, i) => ({ id: 'b' + i, priceGross: p, equipment: { score: 0 } }));
        const r2 = computePriceRating(profile, breit, { equipment });
        assert.equal(r2.narrowCohort, false);
    } finally {
        globalThis.location = prevLocation;
    }
});

/**
 * Echter Fall: Audi A4 40 TFSI (204 PS) bekam in der Ergebnisliste „Sehr gut“ aus
 * nur 5 Vergleichsfahrzeugen (Minimum 10) — ohne jeden Hinweis im Badge.
 */
test('ratingUnsureReason: zu einheitlich oder zu wenige Vergleichsfahrzeuge', async () => {
    const { ratingUnsureReason } = await import('../src/features/price-rating/index.js');
    assert.equal(ratingUnsureReason({ ok: true, narrowCohort: true }), 'narrow');
    assert.equal(ratingUnsureReason({ ok: true, insufficientCohort: true, baseSource: 'cohort', cohortCount: 5 }), 'small');
    // mobile.de-Marktpreis als Basis ist eine eigene, belastbare Grundlage
    assert.equal(ratingUnsureReason({ ok: true, insufficientCohort: true, baseSource: 'mobile', cohortCount: 2 }), null);
    assert.equal(ratingUnsureReason({ ok: true, cohortCount: 30 }), null);
    assert.equal(ratingUnsureReason(null), null);
});

/**
 * Fester €-Betrag je Punkt: Bei günstigen Autos war der Deckel nach wenigen
 * Punkten erreicht, bei teuren bewirkte Ausstattung kaum etwas.
 */
test('Ausstattungsaufschlag skaliert im %-Modus mit dem Basispreis', async () => {
    const { computePriceRating } = await import('../src/features/price-rating/index.js');
    const prevLocation = globalThis.location;
    const prevFlags = runtimeState.featureFlags;
    globalThis.location = { pathname: '/fahrzeuge/search.html' };
    const equipment = { keys: new Set(['x']), score: 2, breakdown: [{ key: 'x', weight: 2 }] };
    const cohort = base => [0.85, 0.9, 0.95, 1, 1, 1.05, 1.1, 1.15, 0.92, 1.08, 0.97, 1.03]
        .map((f, i) => ({ id: 'c' + i, priceGross: Math.round(base * f), equipment: { score: 0 } }));
    try {
        runtimeState.featureFlags = { priceRating: { ...priceRatingDefault(), aufschlagModus: 'prozent', punktZuProzent: 0.03 } };
        const guenstig = computePriceRating({ id: 'a', priceGross: 15000 }, cohort(15000), { equipment });
        const teuer = computePriceRating({ id: 'b', priceGross: 60000 }, cohort(60000), { equipment });
        assert.equal(guenstig.adjustEuro, 900);   // 2 Punkte × 3 % × 15.000
        assert.equal(teuer.adjustEuro, 3600);     // 2 Punkte × 3 % × 60.000

        runtimeState.featureFlags = { priceRating: { ...priceRatingDefault(), aufschlagModus: 'euro', punktZuEuro: 800 } };
        const euro = computePriceRating({ id: 'c', priceGross: 60000 }, cohort(60000), { equipment });
        assert.equal(euro.adjustEuro, 1600);
    } finally {
        globalThis.location = prevLocation;
        runtimeState.featureFlags = prevFlags;
    }
});
