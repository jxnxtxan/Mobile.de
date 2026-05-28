import { SCHEMA_VERSION, STORAGE_KEYS, DEFAULT_PREIS_GEWICHT_BY_ANZEIGE } from '../constants.js';
import { ladeConfig, speichereConfig } from '../persistence.js';
import { suchKonfigurationenDefault } from '../defaults/ausstattung.js';
import { mergeGruppenConfigDefault } from '../defaults/merge-groups.js';
import {
    featureFlagsDefault,
    mergeConfigListUi,
    mergeListOrder,
    mergeSrpSort,
    mergePriceRating,
} from '../feature-flags/index.js';

// ============================================================
// 3) Migration & Konfig-Laden
// ============================================================
/**
 * Vereint die begriffe-Listen einer User-Config mit den aktuellen
 * Defaults (per anzeige-Schlüssel). Neue Begriffsvarianten aus den
 * Defaults werden additiv ergänzt, User-eigene begriffe bleiben.
 * Andere Felder (anzeige, farbe, aktiv, verboten, …) werden NICHT
 * angerührt.
 */
export function unionBegriffeMitDefaults(userConfig, defaults) {
    if (!Array.isArray(userConfig)) return userConfig;
    const defaultByAnzeige = new Map();
    defaults.forEach(d => {
        if (d && d.anzeige) defaultByAnzeige.set(d.anzeige.trim().toLowerCase(), d);
    });
    let added = 0;
    const merged = userConfig.map(item => {
        const key = (item.anzeige || '').trim().toLowerCase();
        const def = defaultByAnzeige.get(key);
        if (!def || !Array.isArray(def.begriffe)) return item;
        const existing = new Set((item.begriffe || []).map(b => String(b).toLowerCase().trim()));
        const additions = def.begriffe.filter(b => !existing.has(String(b).toLowerCase().trim()));
        if (additions.length === 0) return item;
        added += additions.length;
        return { ...item, begriffe: [...(item.begriffe || []), ...additions] };
    });
    if (added > 0) {
        console.info(`mobilede: ${added} neue Default-Begriffe in User-Config integriert.`);
    }
    return merged;
}

/**
 * Renamings für Anzeige-Texte zwischen Schema-Versionen.
 * key (lowercase, getrimmt) -> neue Anzeige.
 */
export const ANZEIGE_RENAMES = {
    'seitenspiegel anklappbar': 'Außenspiegel anklappbar'
};

export function applyAnzeigeRenames(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    let renamed = 0;
    userConfig.forEach(item => {
        const key = (item.anzeige || '').trim().toLowerCase();
        if (ANZEIGE_RENAMES[key]) {
            item.anzeige = ANZEIGE_RENAMES[key];
            renamed++;
        }
    });
    if (renamed > 0) console.info(`mobilede: ${renamed} Anzeige-Text(e) auf neuen Default umbenannt.`);
    return userConfig;
}

/**
 * Korrekturen, die false-positive Treffer in bekannten Einträgen
 * verhindern. Werden additiv auf User-Configs angewandt:
 *  - nurInFeatures: true wird gesetzt, wenn aktuell nicht true.
 *  - verboten: Listen werden zur bestehenden verboten-Liste hinzugefügt
 *    (Duplikate bereinigt). Vom User selbst entfernte Einträge können
 *    so wiederkommen - das ist gewollt, damit Match-Korrekturen greifen.
 * Key: lowercase, getrimmtes Anzeige-Feld.
 */
export const ANZEIGE_PROPERTY_UPDATES = {
    'seitenscheiben akustikverglasung': { nurInFeatures: true },
    'bremsassistent': { verboten: ['notbrems', 'not brems'] }
};

export function applyAnzeigePropertyUpdates(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    let touched = 0;
    userConfig.forEach(item => {
        const key = (item.anzeige || '').trim().toLowerCase();
        const upd = ANZEIGE_PROPERTY_UPDATES[key];
        if (!upd) return;
        if (upd.nurInFeatures === true && item.nurInFeatures !== true) {
            item.nurInFeatures = true;
            touched++;
        }
        if (Array.isArray(upd.verboten) && upd.verboten.length > 0) {
            const existing = new Set((item.verboten || []).map(v => String(v).toLowerCase().trim()));
            const additions = upd.verboten.filter(v => !existing.has(String(v).toLowerCase().trim()));
            if (additions.length > 0) {
                item.verboten = [...(item.verboten || []), ...additions];
                touched++;
            }
        }
    });
    if (touched > 0) console.info(`mobilede: ${touched} Match-Korrektur(en) auf Default-Einträge angewandt.`);
    return userConfig;
}

export function addMissingDefaultEntries(userConfig, defaults) {
    if (!Array.isArray(userConfig)) return userConfig;
    const userKeys = new Set(
        userConfig.map(c => (c.anzeige || '').trim().toLowerCase()).filter(Boolean)
    );
    const missing = defaults.filter(d => {
        const k = (d.anzeige || '').trim().toLowerCase();
        return k && !userKeys.has(k);
    });
    if (missing.length === 0) return userConfig;
    console.info(
        `mobilede: ${missing.length} neue Default-Eintraege ergaenzt: `
        + missing.map(m => m.anzeige).join(', ')
    );
    return [...userConfig, ...missing.map(d => JSON.parse(JSON.stringify(d)))];
}

/**
 * Begriffe, die nur bei einem Anzeige-Eintrag vorkommen sollen (vermeidet
 * konkurrierende Treffer bei gleichem Textfenster).
 */
export const BEGRIFF_EXCLUSIVE_OWNERS = [
    { begriff: 'verstell und heizbar', ownerAnzeige: 'Außenspiegel beheizbar' }
];

export function dedupeAmbiguousBegriffeAcrossConfigs(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    let anyChanged = false;
    const merged = userConfig.map(item => {
        const anzeigeKey = (item.anzeige || '').trim().toLowerCase();
        if (!Array.isArray(item.begriffe)) return item;
        let begriffe = [...item.begriffe];
        let itemChanged = false;
        BEGRIFF_EXCLUSIVE_OWNERS.forEach(rule => {
            const ownerKey = rule.ownerAnzeige.trim().toLowerCase();
            const bKey = rule.begriff.trim().toLowerCase();
            if (anzeigeKey === ownerKey) return;
            const before = begriffe.length;
            begriffe = begriffe.filter(b => (b || '').trim().toLowerCase() !== bKey);
            if (begriffe.length !== before) itemChanged = true;
        });
        if (itemChanged) {
            anyChanged = true;
            return { ...item, begriffe };
        }
        return item;
    });
    if (anyChanged) {
        console.info('mobilede: Mehrdeutige Begriffe aus Konflikt-Einträgen entfernt (z. B. „verstell und heizbar“ nur bei Außenspiegel beheizbar).');
    }
    return merged;
}

export function migrateAusstattungFavorit(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    let updated = false;
    const merged = userConfig.map(item => {
        if (item.favorit !== undefined) return item;
        updated = true;
        return { ...item, favorit: false };
    });
    if (updated) console.info('mobilede: favorit-Feld in Ausstattungs-Config ergänzt.');
    return merged;
}

export function migrateAusstattungPreisGewicht(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    let updated = false;
    const merged = userConfig.map(item => {
        if (item.preisGewicht !== undefined && item.preisGewicht !== null) return item;
        const key = (item.anzeige || '').trim().toLowerCase();
        const def = DEFAULT_PREIS_GEWICHT_BY_ANZEIGE[key];
        if (def == null) return item;
        updated = true;
        return { ...item, preisGewicht: def };
    });
    if (updated) console.info('mobilede: preisGewicht-Defaults für Premium-Ausstattungen ergänzt.');
    return merged;
}

export function applyPreisGewichtDefaults(userConfig, force) {
    if (!Array.isArray(userConfig)) return userConfig;
    return userConfig.map(item => {
        const key = (item.anzeige || '').trim().toLowerCase();
        const def = DEFAULT_PREIS_GEWICHT_BY_ANZEIGE[key];
        if (def == null) return item;
        if (!force && typeof item.preisGewicht === 'number' && item.preisGewicht > 0) return item;
        return { ...item, preisGewicht: def };
    });
}

export function clearAllPreisGewichte(userConfig) {
    if (!Array.isArray(userConfig)) return userConfig;
    return userConfig.map(item => ({ ...item, preisGewicht: 0 }));
}

export function migrateMergeGroups(userMerge, defaults) {
    if (!Array.isArray(userMerge)) return userMerge;
    let updated = false;
    const byBasis = new Map(defaults.map(g => [g.basis.toLowerCase(), g]));
    const merged = userMerge.map(g => {
        let next = g;
        if (g.aktiv === undefined) {
            updated = true;
            next = { ...next, aktiv: true };
        }
        const def = byBasis.get((g.basis || '').toLowerCase());
        if (!def) return next;
        const existingOrder = new Set((next.order || []).map(o => o.toLowerCase()));
        const additions = (def.order || []).filter(o => !existingOrder.has(o.toLowerCase()));
        if (additions.length === 0) return next;
        updated = true;
        return { ...next, order: [...(next.order || []), ...additions] };
    });
    if (updated) console.info('mobilede: Merge-Gruppen mit Schema-Updates ergänzt.');
    return merged;
}

export function migrateIfNeeded() {
    const stored = ladeConfig(STORAGE_KEYS.version);
    if (stored === SCHEMA_VERSION) return;

    // Ausstattungs-Config: rename, union begriffe, property-updates, add missing
    const userConfig = ladeConfig(STORAGE_KEYS.config);
    if (Array.isArray(userConfig)) {
        let next = applyAnzeigeRenames(userConfig);
        next = unionBegriffeMitDefaults(next, suchKonfigurationenDefault);
        next = applyAnzeigePropertyUpdates(next);
        next = addMissingDefaultEntries(next, suchKonfigurationenDefault);
        next = migrateAusstattungFavorit(next);
        next = migrateAusstattungPreisGewicht(next);
        next = dedupeAmbiguousBegriffeAcrossConfigs(next);
        speichereConfig(STORAGE_KEYS.config, next);
    }

    // Merge-Gruppen: neue Order-Modifier additiv ergänzen
    const userMerge = ladeConfig(STORAGE_KEYS.mergeGroups);
    if (Array.isArray(userMerge)) {
        const next = migrateMergeGroups(userMerge, mergeGruppenConfigDefault);
        speichereConfig(STORAGE_KEYS.mergeGroups, next);
    }

    const userFlags = ladeConfig(STORAGE_KEYS.featureFlags);
    if (userFlags && typeof userFlags === 'object') {
        const mergedFlags = mergeConfigListUi(userFlags, { ...featureFlagsDefault(), ...userFlags });
        mergedFlags.listOrder = mergeListOrder(userFlags.listOrder);
        mergedFlags.srpSort = mergeSrpSort(userFlags.srpSort);
        mergedFlags.priceRating = mergePriceRating(userFlags.priceRating);
        speichereConfig(STORAGE_KEYS.featureFlags, mergedFlags);
    }

    speichereConfig(STORAGE_KEYS.version, SCHEMA_VERSION);
}
