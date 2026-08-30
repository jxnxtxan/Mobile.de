import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanText, escapeRegex, tokenize } from '../src/core/text/normalize.js';

/**
 * Kernfall des Fixes: die Umlaut-Ersetzung lief vor dem CamelCase-Split und
 * der trennte dann im künstlichen „Ae“/„Oe“/„Ue“. Großgeschriebene Wörter aus
 * Verkäufer-Beschreibungen zerfielen dadurch in zwei Tokens und konnten den
 * gleichlautenden Konfig-Begriff nie treffen.
 */
test('großgeschriebene Umlaut-Wörter ergeben dieselben Tokens wie die Normalschreibung', () => {
    const paare = [
        ['ANHÄNGERKUPPLUNG', 'Anhängerkupplung'],
        ['ÖLWECHSEL', 'Ölwechsel'],
        ['ÜBERROLLBÜGEL', 'Überrollbügel'],
        ['ÄUSSERE SPIEGEL', 'Äußere Spiegel'],
    ];
    for (const [seite, begriff] of paare) {
        assert.deepEqual(tokenize(seite), tokenize(begriff), `${seite} != ${begriff}`);
    }
});

test('Umlaute werden auch großgeschrieben transliteriert', () => {
    assert.equal(cleanText('ANHÄNGERKUPPLUNG'), 'anhaengerkupplung');
    assert.equal(cleanText('Überrollbügel'), 'ueberrollbuegel');
    assert.equal(cleanText('Straße'), 'strasse');
});

/** Der CamelCase-Split muss trotz der neuen Reihenfolge weiter greifen. */
test('CamelCase wird getrennt, auch an Umlaut-Großbuchstaben', () => {
    assert.deepEqual(tokenize('SitzHeizung'), ['sitz', 'heizung']);
    assert.deepEqual(tokenize('ÖlWechsel'), ['oel', 'wechsel']);
    assert.deepEqual(tokenize('StandheizungÖl'), ['standheizung', 'oel']);
});

/** Dekomponierte Eingaben (a + U+0308) erreichten die Umlaut-Ersetzung nicht. */
test('dekomponierte Umlaute werden wie komponierte behandelt', () => {
    assert.deepEqual(tokenize('Anha\u0308ngerkupplung'), tokenize('Anhängerkupplung'));
});

/**
 * „ABS/ESP“ blieb ein einzelnes Token. Weil `tokenMatches` Begriffe unter vier
 * Zeichen nur exakt vergleicht, fand „ABS“ den Eintrag nicht.
 */
test('Schrägstrich und Plus trennen Tokens', () => {
    assert.deepEqual(tokenize('ABS/ESP'), ['abs', 'esp']);
    assert.deepEqual(tokenize('Sitzheizung+Lenkradheizung'), ['sitzheizung', 'lenkradheizung']);
});

test('Bindestriche, Klammern und Satzzeichen trennen Tokens', () => {
    assert.deepEqual(tokenize('LED-Scheinwerfer'), ['led', 'scheinwerfer']);
    assert.deepEqual(tokenize('Spiegel (beheizbar)'), ['spiegel', 'beheizbar']);
    assert.deepEqual(tokenize('Navi; Klima'), ['navi', 'klima']);
});

test('leere und fehlende Eingaben sind definiert', () => {
    assert.equal(cleanText(''), '');
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(undefined), '');
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('   '), []);
});

test('escapeRegex neutralisiert Metazeichen', () => {
    const roh = 'elektr. (verstellbar)';
    assert.ok(new RegExp(escapeRegex(roh)).test(roh));
    assert.equal(escapeRegex('a+b'), 'a\\+b');
});
