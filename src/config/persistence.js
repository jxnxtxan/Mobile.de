import { gmGetValue, gmSetValue } from '../platform/gm.js';

export function ladeConfig(key) {
    try {
        const str = gmGetValue(key, null);
        if (!str) return null;
        return JSON.parse(str);
    } catch (e) {
        console.warn('Fehler beim Laden der Konfiguration:', key, e);
        return null;
    }
}
export function speichereConfig(key, data) {
    try {
        gmSetValue(key, JSON.stringify(data));
    } catch (e) {
        console.error('Fehler beim Speichern der Konfiguration:', key, e);
    }
}
