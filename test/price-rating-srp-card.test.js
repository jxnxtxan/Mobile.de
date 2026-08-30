import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseSrpAttributeLine,
    splitMakeModelFromTitle,
} from '../src/features/price-rating/index.js';

/* Alle Attributzeilen stammen aus echten Ergebniskarten von mobile.de. */

test('parseSrpAttributeLine liest die Standardzeile eines Gebrauchtwagens', () => {
    assert.deepEqual(
        parseSrpAttributeLine('Unfallfrei • EZ 10/2020 • 74.335 km • 110 kW (150 PS) • Benzin'),
        { firstRegistrationYear: 2020, mileageKm: 74335, powerKw: 110, powerPs: 150, fuel: 'Benzin' }
    );
});

test('parseSrpAttributeLine kommt ohne Zustandsangabe aus', () => {
    const r = parseSrpAttributeLine('EZ 08/2017 • 118.050 km • 445 kW (605 PS) • Benzin');
    assert.equal(r.firstRegistrationYear, 2017);
    assert.equal(r.mileageKm, 118050);
    assert.equal(r.powerKw, 445);
    assert.equal(r.powerPs, 605);
});

test('parseSrpAttributeLine überspringt zusätzliche Zustandsangaben', () => {
    const r = parseSrpAttributeLine(
        'Unfallfrei • Vorführfahrzeug • EZ 04/2026 • 2.700 km • 110 kW (150 PS)'
        + ' • Benzin6,1 l/100km (komb.) • 139 g CO₂/km (komb.) • CO₂-Klasse E (komb.)'
    );
    assert.equal(r.firstRegistrationYear, 2026);
    assert.equal(r.mileageKm, 2700);
    assert.equal(r.fuel, 'Benzin');
});

/**
 * Eine freie Suche nach `([\d.]+)\s*km` fand in „4,0 l/100km“ den Wert 100 und
 * schrieb einem Neuwagen damit 100 km Laufleistung zu.
 */
test('parseSrpAttributeLine hält Verbrauchsangaben aus dem Kilometerstand', () => {
    const r = parseSrpAttributeLine(
        'Neuwagen • 85 kW (116 PS) • Hybrid (Benzin/Elektro)4,0 l/100km (komb.)'
        + ' • 91 g CO₂/km (komb.) • CO₂-Klasse B (komb.)'
    );
    assert.equal(r.mileageKm, null);
    assert.equal(r.firstRegistrationYear, null);
    assert.equal(r.powerKw, 85);
    assert.equal(r.fuel, 'Hybrid (Benzin/Elektro)');
});

/** „18,5 kWh/100km“ darf nicht als Motorleistung von 19 kW gelesen werden. */
test('parseSrpAttributeLine verwechselt kWh-Verbrauch nicht mit Leistung', () => {
    const r = parseSrpAttributeLine(
        'Unfallfrei • EZ 06/2023 • 25.000 km • 150 kW (204 PS) • Elektro18,5 kWh/100km (komb.)'
    );
    assert.equal(r.powerKw, 150);
    assert.equal(r.powerPs, 204);
    assert.equal(r.mileageKm, 25000);
    assert.equal(r.fuel, 'Elektro');
});

test('parseSrpAttributeLine liefert leere Werte ohne Eingabe', () => {
    assert.deepEqual(
        parseSrpAttributeLine(''),
        { firstRegistrationYear: null, mileageKm: null, powerKw: null, powerPs: null, fuel: '' }
    );
    assert.equal(parseSrpAttributeLine(null).mileageKm, null);
});

test('splitMakeModelFromTitle trennt mehrteilige Marken anhand der Filterliste', () => {
    const makes = ['Alfa Romeo', 'Land Rover', 'DS Automobiles', 'Audi'];
    assert.deepEqual(splitMakeModelFromTitle('Alfa Romeo Giulia', makes), { make: 'Alfa Romeo', model: 'Giulia' });
    assert.deepEqual(splitMakeModelFromTitle('Land Rover Defender', makes), { make: 'Land Rover', model: 'Defender' });
});

test('splitMakeModelFromTitle behält mehrteilige Modellnamen zusammen', () => {
    assert.deepEqual(
        splitMakeModelFromTitle('Volkswagen Tiguan Allspace', ['Volkswagen']),
        { make: 'Volkswagen', model: 'Tiguan Allspace' }
    );
});

test('splitMakeModelFromTitle nutzt das erste Wort ohne Filterliste', () => {
    assert.deepEqual(splitMakeModelFromTitle('Audi RS6', []), { make: 'Audi', model: 'RS6' });
    assert.deepEqual(splitMakeModelFromTitle('Citroën DS', []), { make: 'Citroën', model: 'DS' });
});

test('splitMakeModelFromTitle bleibt bei unvollständigen Titeln stabil', () => {
    assert.deepEqual(splitMakeModelFromTitle('', []), { make: '', model: '' });
    assert.deepEqual(splitMakeModelFromTitle(null, []), { make: '', model: '' });
    assert.deepEqual(splitMakeModelFromTitle('Smart', []), { make: 'Smart', model: '' });
});
