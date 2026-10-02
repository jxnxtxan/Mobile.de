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
