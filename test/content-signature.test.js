import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fingerprintActiveConfigs,
    fingerprintListOrder,
    fingerprintMergeGroups,
    hashString,
} from '../src/core/util/content-signature.js';

const baseConfig = () => ([
    { begriffe: ['allrad', '4wd'], anzeige: 'Allrad', farbe: 'orange', aktiv: true },
    { begriffe: ['ahk'], anzeige: 'Anhängerkupplung', farbe: 'red', aktiv: true, nurInFeatures: true },
]);

test('hashString ist stabil und unterscheidet Inhalte', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    assert.notEqual(hashString('abc'), hashString('abd'));
    assert.equal(hashString(null), hashString(''));
});

test('gleiche Konfiguration ergibt gleichen Fingerprint', () => {
    assert.equal(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(baseConfig()));
});

/**
 * Diese vier Felder fehlten in der ersten Fassung. Der Render-Cache hielt
 * deshalb veraltete Ergebnisse, wenn nur Farbe, Verbote, nurInFeatures oder
 * die Reihenfolge geändert wurden.
 */
test('Farbänderung ändert den Fingerprint', () => {
    const changed = baseConfig();
    changed[0].farbe = 'green';
    assert.notEqual(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(changed));
});

test('verbotene Begriffe ändern den Fingerprint', () => {
    const changed = baseConfig();
    changed[0].verboten = ['vorbereitung'];
    assert.notEqual(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(changed));
});

test('nurInFeatures ändert den Fingerprint', () => {
    const changed = baseConfig();
    changed[0].nurInFeatures = true;
    assert.notEqual(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(changed));
});

test('Reihenfolge ändert den Fingerprint (Manual-Sortierung übernimmt sie)', () => {
    const reordered = baseConfig().reverse();
    assert.notEqual(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(reordered));
});

test('Deaktivieren ändert den Fingerprint', () => {
    const changed = baseConfig();
    changed[1].aktiv = false;
    assert.notEqual(fingerprintActiveConfigs(baseConfig()), fingerprintActiveConfigs(changed));
});

test('leere und fehlende Konfiguration sind definiert', () => {
    assert.equal(fingerprintActiveConfigs([]), '0');
    assert.equal(fingerprintActiveConfigs(null), '0');
    assert.equal(fingerprintActiveConfigs(undefined), '0');
});

test('Merge-Gruppen: Basis, Reihenfolge und aktiv-Flag zählen', () => {
    const base = [{ basis: 'außenspiegel', order: ['beheizbar', 'anklappbar'], aktiv: true }];
    const sameContent = [{ basis: 'Außenspiegel', order: ['Beheizbar', 'Anklappbar'], aktiv: true }];
    const otherOrder = [{ basis: 'außenspiegel', order: ['anklappbar', 'beheizbar'], aktiv: true }];
    const inactive = [{ basis: 'außenspiegel', order: ['beheizbar', 'anklappbar'], aktiv: false }];

    assert.equal(fingerprintMergeGroups(base), fingerprintMergeGroups(sameContent));
    assert.notEqual(fingerprintMergeGroups(base), fingerprintMergeGroups(otherOrder));
    assert.notEqual(fingerprintMergeGroups(base), fingerprintMergeGroups(inactive));
    assert.equal(fingerprintMergeGroups([]), '0');
});

test('listOrder: Modus, Scopes und applyToVehicleResults zählen', () => {
    const alpha = { mode: 'alphabet', scopes: { ausstattung: false, tech: false }, applyToVehicleResults: false };
    const manual = { mode: 'manual', scopes: { ausstattung: false, tech: false }, applyToVehicleResults: false };
    const applied = { mode: 'manual', scopes: { ausstattung: false, tech: false }, applyToVehicleResults: true };
    const scoped = { mode: 'manual', scopes: { ausstattung: true, tech: false }, applyToVehicleResults: false };

    assert.notEqual(fingerprintListOrder(alpha), fingerprintListOrder(manual));
    assert.notEqual(fingerprintListOrder(manual), fingerprintListOrder(applied));
    assert.notEqual(fingerprintListOrder(manual), fingerprintListOrder(scoped));
    assert.equal(fingerprintListOrder(null), '0');
});
