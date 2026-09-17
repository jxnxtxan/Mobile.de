import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sameMakeModelForCohort,
    readVipVariant,
    splitMakeModelFromTitle,
} from '../src/features/price-rating/index.js';

/**
 * Ohne __INITIAL_STATE__ stammen die beiden Seiten aus verschiedenen Quellen:
 * die Detailseite kennt nur Namen, die Karten der Ergebnisliste bekommen ihre
 * IDs aus der Such-URL. Verglich man wie zuvor immer „ID sonst Name“, stand
 * „1900“ gegen „audi“ und keine Kohorte fand je ihr Fahrzeug.
 */
test('IDs entscheiden, wenn beide Seiten sie kennen', () => {
    const a = { makeId: '1900', modelId: '35', make: 'Audi', model: 'S6' };
    const b = { makeId: '1900', modelId: '35', make: 'Audi', model: 'A6' };
    assert.equal(sameMakeModelForCohort(a, b), true);
});

test('abweichende IDs schlagen trotz gleicher Namen fehl', () => {
    const a = { makeId: '1900', modelId: '35', make: 'Audi', model: 'S6' };
    const b = { makeId: '1900', modelId: '36', make: 'Audi', model: 'S6' };
    assert.equal(sameMakeModelForCohort(a, b), false);
});

test('Namen entscheiden, wenn eine Seite keine IDs hat', () => {
    const karte = { makeId: '1900', modelId: '35', make: 'Audi', model: 'S6' };
    const detailseite = { make: 'Audi', model: 'S6' };
    assert.equal(sameMakeModelForCohort(karte, detailseite), true);
});

test('Namensvergleich ignoriert Schreibweise und Leerraum', () => {
    const a = { make: ' Alfa Romeo ', model: 'Giulia' };
    const b = { make: 'alfa romeo', model: 'GIULIA' };
    assert.equal(sameMakeModelForCohort(a, b), true);
});

test('verschiedene Modelle ohne IDs bleiben getrennt', () => {
    assert.equal(
        sameMakeModelForCohort({ make: 'Audi', model: 'S6' }, { make: 'Audi', model: 'A6' }),
        false
    );
});

test('leere Marke oder leeres Modell zaehlt nie als Treffer', () => {
    assert.equal(sameMakeModelForCohort({ make: '', model: '' }, { make: '', model: '' }), false);
    assert.equal(sameMakeModelForCohort({ make: 'Audi', model: '' }, { make: 'Audi', model: '' }), false);
    assert.equal(sameMakeModelForCohort(null, { make: 'Audi', model: 'S6' }), false);
});

/**
 * Zeilen einer echten Kontaktbox. Die Variante traegt kein eigenes Merkmal und
 * steht auch nicht im Nachbarelement des Titels, deshalb die Suche ueber den
 * Zeilentext. Ohne sie fehlen der Bewertung die Ausstattungshinweise.
 */
const boxAudi = { innerText: 'Audi S6\nAvant 3.0 TDI, Matrix, Std-Hz., B&O, NP:120k\n31.499 €\nGuter Preis' };

test('Variante ist die Zeile unter dem Titel', () => {
    assert.equal(readVipVariant(boxAudi, 'Audi S6'), 'Avant 3.0 TDI, Matrix, Std-Hz., B&O, NP:120k');
});

test('folgt auf den Titel der Preis, gibt es keine Variante', () => {
    const box = { innerText: 'Audi S6\n31.499 €\nGuter Preis' };
    assert.equal(readVipVariant(box, 'Audi S6'), '');
});

test('Variante bleibt leer ohne Box oder ohne Titel', () => {
    assert.equal(readVipVariant(null, 'Audi S6'), '');
    assert.equal(readVipVariant(boxAudi, ''), '');
});

/**
 * Taucht der Titel nicht wortgleich als eigene Zeile in der Box auf, lieferte
 * indexOf() -1; das +1 landete dann bei lines[0] statt bei "kein Treffer" —
 * die erste Zeile der Box wurde faelschlich als Variante gelesen.
 */
test('Titel ohne Zeilentreffer liefert leere Variante statt der ersten Zeile', () => {
    const box = { innerText: 'Audi S6 Sonderangebot\nAvant 3.0 TDI, Matrix\n31.499 €\nGuter Preis' };
    assert.equal(readVipVariant(box, 'Audi S6'), '');
});

test('Titel der Detailseite ergibt Marke und Modell', () => {
    assert.deepEqual(splitMakeModelFromTitle('Audi S6', []), { make: 'Audi', model: 'S6' });
    assert.deepEqual(
        splitMakeModelFromTitle('Alfa Romeo Giulia', ['Alfa Romeo']),
        { make: 'Alfa Romeo', model: 'Giulia' }
    );
});
