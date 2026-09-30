/**
 * Kurzfassung einer Konfig-Datei vor dem Import: was sie enthält und ob sie
 * überhaupt nach einer Konfiguration aussieht. Der Import ersetzt sonst ohne
 * Vorschau die komplette Popup-Konfiguration.
 */
export function summarizeConfigImport(text, currentSchema) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, empty: true, message: '' };
    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (err) {
        return { ok: false, message: 'Kein gültiges JSON: ' + (err && err.message ? err.message : err) };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, message: 'Kein Konfigurations-Objekt erkannt.' };
    }
    const parts = [];
    const count = (arr, one, many) => arr.length + ' ' + (arr.length === 1 ? one : many);
    if (Array.isArray(obj.suchKonfigurationen)) {
        parts.push(count(obj.suchKonfigurationen, 'Ausstattung', 'Ausstattungen'));
    }
    if (Array.isArray(obj.techDataKonfigurationen)) {
        parts.push(count(obj.techDataKonfigurationen, 'Tech-Feld', 'Tech-Felder'));
    }
    if (Array.isArray(obj.mergeGruppenConfig)) {
        parts.push(count(obj.mergeGruppenConfig, 'Merge-Gruppe', 'Merge-Gruppen'));
    }
    if (obj.featureFlags && typeof obj.featureFlags === 'object') parts.push('Einstellungen');
    if (obj.priceDataStore && typeof obj.priceDataStore === 'object') {
        const ads = Object.keys(obj.priceDataStore.adsById || {}).length;
        parts.push('Preisdaten (' + ads + ' Inserate)');
    }
    if (!parts.length) {
        return { ok: false, message: 'Die Datei enthält keine bekannten Konfigurationsteile.' };
    }
    const schema = typeof obj.__version === 'number' ? obj.__version : null;
    let note = '';
    if (schema == null) note = 'ohne Schema-Angabe';
    else if (currentSchema != null && schema !== currentSchema) {
        note = 'Schema v' + schema + ' (aktuell v' + currentSchema + ')';
    } else note = 'Schema v' + schema;
    return { ok: true, parts, schema, message: parts.join(' · ') + ' · ' + note };
}
