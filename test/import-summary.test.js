import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeConfigImport } from '../src/popup/import-summary.js';

/** Der Import ersetzte ohne Vorschau die komplette Konfiguration. */
test('Zusammenfassung nennt Inhalte und Schema', () => {
    const text = JSON.stringify({
        __version: 13,
        suchKonfigurationen: new Array(98).fill({}),
        techDataKonfigurationen: new Array(5).fill({}),
        mergeGruppenConfig: [{}],
        featureFlags: {}
    });
    const sum = summarizeConfigImport(text, 13);
    assert.equal(sum.ok, true);
    assert.equal(sum.message, '98 Ausstattungen · 5 Tech-Felder · 1 Merge-Gruppe · Einstellungen · Schema v13');
});

test('abweichendes Schema wird genannt', () => {
    const sum = summarizeConfigImport(JSON.stringify({ __version: 11, suchKonfigurationen: [{}] }), 13);
    assert.equal(sum.ok, true);
    assert.match(sum.message, /1 Ausstattung · Schema v11 \(aktuell v13\)/);
});

test('ungültiges JSON, fremdes Objekt und leeres Feld', () => {
    assert.equal(summarizeConfigImport('{kaputt', 13).ok, false);
    assert.equal(summarizeConfigImport('{"foo":1}', 13).ok, false);
    assert.equal(summarizeConfigImport('[1,2]', 13).ok, false);
    const leer = summarizeConfigImport('   ', 13);
    assert.equal(leer.ok, false);
    assert.equal(leer.empty, true);
});
