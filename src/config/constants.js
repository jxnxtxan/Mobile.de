export const SCHEMA_VERSION = 11;

/** Eingebettete Seiten-UI (Ergebnisse, Button, Badges) – unter Konfig-Popup. */
export const PAGE_UI_Z_INDEX = 2147483000;
export const POPUP_OVERLAY_Z_INDEX = 2147483647;
export const STORAGE_KEYS = {
        config:        'mobilede_config',
        techConfig:    'mobilede_techconfig',
        mergeGroups:   'mobilede_mergeGruppen',
        featureFlags:  'mobilede_feature_flags',
        version:       'mobilede_config_version',
        backupPrefix:  'mobilede_config_backup_'
    };

    // ============================================================
    // Feature-Flag-Registry (erweiterbar)
    // - Neue Optionen einfach unten anhängen, das Config-Tab rendert
    //   sie automatisch und Defaults werden vorwärts-kompatibel
    //   in bestehende User-Configs gemerged.
    // ============================================================
export const FEATURE_FLAG_DEFINITIONS = [
        {
            key: 'mapsLink',
            title: 'Standort als Google-Maps-Link',
            description: 'Macht Standort-Texte (z.B. „DE-92690 Pressath") anklickbar. Ein Klick öffnet Google Maps mit der Adresse als Suche.',
            default: true
        },
        {
            key: 'autoMode',
            title: 'Automodus (vollständige Ausstattungsliste)',
            description: 'Zeigt alle Einträge aus Ausstattungsliste und strukturierter Beschreibung. Treffer aus deiner Konfiguration werden farbig hervorgehoben. Unbekannte Zeilen können per „+ Konfig“ ins Popup übernommen werden.',
            default: false
        }
    ];
export const LIST_ORDER_DEFAULT = {
        mode: 'alphabet',
        scopes: {
            ausstattungFavorites: false,
            ausstattung: false,
            tech: false
        },
        applyToVehicleResults: false
    };

export const SRP_SORT_OPTIONS = [
        { id: 'rel_up', label: 'Standard-Sortierung', sb: 'rel', od: 'up' },
        { id: 'p_up', label: 'Preis (niedrigster zuerst)', sb: 'p', od: 'up' },
        { id: 'p_down', label: 'Preis (höchster zuerst)', sb: 'p', od: 'down' },
        { id: 'ml_up', label: 'Kilometerstand (niedrigster zuerst)', sb: 'ml', od: 'up' },
        { id: 'ml_down', label: 'Kilometerstand (höchster zuerst)', sb: 'ml', od: 'down' },
        { id: 'fr_up', label: 'Erstzulassung (älteste zuerst)', sb: 'fr', od: 'up' },
        { id: 'fr_down', label: 'Erstzulassung (jüngste zuerst)', sb: 'fr', od: 'down' },
        { id: 'doc_up', label: 'Inserate (älteste zuerst)', sb: 'doc', od: 'up' },
        { id: 'doc_down', label: 'Inserate (neueste zuerst)', sb: 'doc', od: 'down' }
    ];
export const SRP_SORT_DEFAULT = { enabled: true, sortId: 'p_up' };

export const PRICE_RATING_LEVELS = [
        { id: 'VERY_GOOD', label: 'Sehr guter Preis' },
        { id: 'GOOD', label: 'Guter Preis' },
        { id: 'FAIR', label: 'Fairer Preis' },
        { id: 'INCREASED', label: 'Erhöhter Preis' },
        { id: 'HIGH', label: 'Hoher Preis' }
    ];

export const PRICE_RATING_DEFAULT = {
        enabled: true,
        enabledVip: true,
        enabledSrp: true,
        mobileFallback: true,
        useModelRange: true,
        keyUseMileage: true,
        keyUseYear: true,
        keyUsePower: true,
        keyKmBucket: 5000,
        keyYearBucket: 1,
        keyPowerBucket: 10,
        onlyFavoriteWeights: false,
        minComparables: 20,
        punktZuEuro: 800,
        maxAdjustPct: 0.12,
        kmToleranceAbs: 10000,
        yearTolerance: 1,
        powerToleranceKw: 0,
        thresholds: [
            { maxPct: -0.12, level: 0 },
            { maxPct: -0.04, level: 1 },
            { maxPct: 0.04, level: 2 },
            { maxPct: 0.12, level: 3 },
            { maxPct: Infinity, level: 4 }
        ]
    };

export const DEFAULT_PREIS_GEWICHT_BY_ANZEIGE = {
        'head-up display': 2.5,
        '360 grad kamera': 2,
        'panoramadach': 1.8,
        'matrix scheinwerfer': 1.5,
        'bang & olufsen sound system': 2,
        'burmester sound system': 2.5,
        'harman kardon sound system': 1.5,
        'bose sound system': 1.2,
        'elektr. sitzeinstellung mit memory-funktion': 1.2,
        'anhängerkupplung': 1,
        'abstandstempomat': 1
    };

export const PRICE_COHORT_CACHE_PREFIX = 'mobilede_price_cohort_';
export const PRICE_RATING_CACHE_PREFIX = 'mobilede_price_rating_';
export const PRICE_RATING_UI_CACHE_PREFIX = 'mobilede_price_rating_ui_';
export const PRICE_VIP_EQUIP_CACHE_PREFIX = 'mobilede_price_vip_equip_';
export const PRICE_DATA_STORE_KEY = 'mobilede_price_data_store_v1';
export const PRICE_DATA_STORE_VERSION = 1;
export const PRICE_DATA_STORE_MAX_ADS = 1500;
export const PRICE_DATA_STORE_MAX_COHORTS = 500;
export const MAKE_MODEL_CACHE_PREFIX = 'mobilede_mkmd_models_';
export const MAKE_MODEL_AD_CACHE_PREFIX = 'mobilede_mkmd_ad_';
export const PRICE_COHORT_CACHE_TTL_MS = 20 * 60 * 1000;
export const PRICE_RATING_UI_CACHE_TTL_MS = 3 * 60 * 1000;
export const DEBUG_SCOPE_DEFINITIONS = [
        { key: 'price', label: 'Preisbewertung', prefix: '[mobilede Preis]' },
        { key: 'perf', label: 'Performance', prefix: '[mobilede Perf]' },
        { key: 'ausstattung', label: 'Ausstattungssuche', prefix: '[mobilede Ausstattung]' },
        { key: 'tech', label: 'Technische Daten', prefix: '[mobilede Tech]' },
        { key: 'merge', label: 'Merge/Normalisierung', prefix: '[mobilede Merge]' },
        { key: 'ui', label: 'UI/Config', prefix: '[mobilede UI]' }
    ];
export const DEBUG_SCOPE_PREFIX = DEBUG_SCOPE_DEFINITIONS.reduce((acc, def) => {
        acc[def.key] = def.prefix;
        return acc;
    }, {});
