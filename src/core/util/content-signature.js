/** Leichter String-Fingerprint (kein Krypto, nur Änderungserkennung). */
export function hashString(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
}

const FIELD_SEP = '\x1e';
const ENTRY_SEP = '\x1f';
const LIST_SEP = '\x1d';

function norm(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function normList(value) {
    return Array.isArray(value) ? value.map(norm).join(LIST_SEP) : norm(value);
}

function flag(value) {
    return value === true ? '1' : '0';
}

/**
 * Erfasst alle Felder, die das Suchergebnis beeinflussen — inklusive
 * Array-Position, weil `sortEntriesByConfigOrder` im Manual-Modus die
 * Reihenfolge der Konfiguration übernimmt. Deshalb wird hier bewusst
 * nicht sortiert.
 */
export function fingerprintActiveConfigs(configs) {
    if (!Array.isArray(configs) || !configs.length) return '0';
    const parts = [];
    for (const cfg of configs) {
        if (!cfg) continue;
        parts.push([
            cfg.aktiv === false ? '0' : '1',
            flag(cfg.favorit),
            norm(cfg.anzeige || cfg.begriff),
            norm(cfg.farbe),
            flag(cfg.nurInFeatures),
            flag(cfg.compound),
            normList(cfg.begriffe),
            normList(cfg.verboten),
        ].join(FIELD_SEP));
    }
    return hashString(parts.join(ENTRY_SEP));
}

export function fingerprintMergeGroups(groups) {
    if (!Array.isArray(groups) || !groups.length) return '0';
    const parts = groups.map(g => {
        if (!g) return '';
        return [
            g.aktiv === false ? '0' : '1',
            norm(g.basis),
            normList(g.order),
        ].join(FIELD_SEP);
    });
    return hashString(parts.join(ENTRY_SEP));
}

/** Sortier-/Anzeige-relevante Feature-Flags (ohne Preisbewertung & Debug). */
export function fingerprintListOrder(listOrder) {
    if (!listOrder || typeof listOrder !== 'object') return '0';
    const scopes = listOrder.scopes || {};
    return [
        norm(listOrder.mode),
        flag(listOrder.applyToVehicleResults),
        flag(scopes.ausstattung),
        flag(scopes.ausstattungFavorites),
        flag(scopes.tech),
    ].join(FIELD_SEP);
}
