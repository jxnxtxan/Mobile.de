import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isPlausibleEquipmentLabel,
    splitDescriptionIntoFeatures,
    tokenJaccard,
} from '../src/core/search/automode.js';

/**
 * Die frühere Regel `part.length <= 8` hängte jeden kurzen Komma-Teil an den
 * Vorgänger. „Klimaautomatik, ABS, ESP, Navi“ wurde dadurch zu einer einzigen
 * Zeile und die Kurznamen verschwanden aus der Automodus-Liste.
 */
test('eigenständige Kurznamen bleiben eigene Einträge', () => {
    assert.deepEqual(
        splitDescriptionIntoFeatures('Klimaautomatik, ABS, ESP, Navi, LED, AHK'),
        ['Klimaautomatik', 'ABS', 'ESP', 'Navi', 'LED', 'AHK']
    );
});

test('Anhängsel werden an den vorherigen Eintrag gehängt', () => {
    assert.deepEqual(
        splitDescriptionIntoFeatures('Außenspiegel beheizbar, beide, Sitzheizung, vorn'),
        ['Außenspiegel beheizbar, beide', 'Sitzheizung, vorn']
    );
});

test('ein führendes Anhängsel bleibt eigener Eintrag', () => {
    assert.deepEqual(splitDescriptionIntoFeatures('beide, Sitzheizung'), ['beide', 'Sitzheizung']);
});

test('Abschnittsüberschriften werden zu Trennern', () => {
    assert.deepEqual(
        splitDescriptionIntoFeatures('Klima, weitere Ausstattung: Navi'),
        ['Klima', 'Navi']
    );
});

test('leere Beschreibung ergibt keine Einträge', () => {
    assert.deepEqual(splitDescriptionIntoFeatures(''), []);
    assert.deepEqual(splitDescriptionIntoFeatures('  ,  , '), []);
});

test('Einträge aus der Ausstattungsliste gelten immer als plausibel', () => {
    const lang = 'Ein sehr langer Eintrag mit vielen Wörtern der aus der strukturierten Liste stammt';
    assert.equal(isPlausibleEquipmentLabel(lang, 'features'), true);
    assert.equal(isPlausibleEquipmentLabel(lang, 'description'), false);
});

test('Werbe- und Kontakttexte werden aus der Beschreibung verworfen', () => {
    assert.equal(isPlausibleEquipmentLabel('Besuchen Sie www.example.com', 'description'), false);
    assert.equal(isPlausibleEquipmentLabel('Autohaus Müller GmbH', 'description'), false);
    assert.equal(isPlausibleEquipmentLabel('https://example.com', 'description'), false);
    assert.equal(isPlausibleEquipmentLabel('Sitzheizung', 'description'), true);
});

test('leere Labels sind nie plausibel', () => {
    assert.equal(isPlausibleEquipmentLabel('', 'features'), false);
    assert.equal(isPlausibleEquipmentLabel('   ', 'features'), false);
    assert.equal(isPlausibleEquipmentLabel(null, 'features'), false);
});

test('tokenJaccard vergleicht Tokenmengen', () => {
    assert.equal(tokenJaccard('Sitzheizung', 'Sitzheizung'), 1);
    assert.equal(tokenJaccard('Sitzheizung', 'Panoramadach'), 0);
    assert.equal(tokenJaccard('', 'Sitzheizung'), 0);
    assert.ok(tokenJaccard('Außenspiegel beheizbar', 'Außenspiegel anklappbar') > 0);
});
