// ==UserScript==
// @name         Mobile.de Ausstattungssuche mit modernem Popup & Import/Export (Generalisiertes Merging mit Merge-Konfiguration)
// @namespace    https://github.com/jxnxtxan/Mobile.de
// @version      2.15.12
// @author       jxnxtxan
// @description  Sucht bestimmte Ausstattungen & Technische Daten auf mobile.de. Preisbewertung mit Ausstattungs-Korrektur (VIP + SRP). Token-basierte Match-Engine, SPA-Robustheit, Konfig-Popup mit Filter, Drag&Drop, Reset, Backup und Schema-Versionierung.
// @homepageURL  https://github.com/jxnxtxan/Mobile.de
// @supportURL   https://github.com/jxnxtxan/Mobile.de/issues
// @updateURL    https://raw.githubusercontent.com/jxnxtxan/Mobile.de/main/mobile-ausstattungssuche.js
// @downloadURL  https://raw.githubusercontent.com/jxnxtxan/Mobile.de/main/mobile-ausstattungssuche.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mobile.de
// @match        http://suchen.mobile.de/fahrzeuge/details.html*
// @match        https://suchen.mobile.de/fahrzeuge/details.html*
// @match        http://suchen.mobile.de/auto-inserat/*
// @match        https://suchen.mobile.de/auto-inserat/*
// @match        http://suchen.mobile.de/fahrzeuge/search.html*
// @match        https://suchen.mobile.de/fahrzeuge/search.html*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // Konstanten / Schema
    // ============================================================
    const SCHEMA_VERSION = 11;
    const STORAGE_KEYS = {
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
    const FEATURE_FLAG_DEFINITIONS = [
        {
            key: 'mapsLink',
            title: 'Standort als Google-Maps-Link',
            description: 'Macht Standort-Texte auf der Detailseite (z.B. „DE-92690 Pressath") anklickbar. Ein Klick öffnet Google Maps mit der Adresse als Suche.',
            default: true
        },
        {
            key: 'autoMode',
            title: 'Automodus (vollständige Ausstattungsliste)',
            description: 'Zeigt alle Einträge aus Ausstattungsliste und strukturierter Beschreibung. Treffer aus deiner Konfiguration werden farbig hervorgehoben. Unbekannte Zeilen können per „+ Konfig“ ins Popup übernommen werden.',
            default: false
        }
    ];
    const LIST_ORDER_DEFAULT = {
        mode: 'alphabet',
        scopes: {
            ausstattungFavorites: false,
            ausstattung: false,
            tech: false
        },
        applyToVehicleResults: false
    };

    const SRP_SORT_OPTIONS = [
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
    const SRP_SORT_DEFAULT = { enabled: true, sortId: 'p_up' };

    const PRICE_RATING_LEVELS = [
        { id: 'VERY_GOOD', label: 'Sehr guter Preis' },
        { id: 'GOOD', label: 'Guter Preis' },
        { id: 'FAIR', label: 'Fairer Preis' },
        { id: 'INCREASED', label: 'Erhöhter Preis' },
        { id: 'HIGH', label: 'Hoher Preis' }
    ];

    const PRICE_RATING_DEFAULT = {
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

    const DEFAULT_PREIS_GEWICHT_BY_ANZEIGE = {
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

    const PRICE_COHORT_CACHE_PREFIX = 'mobilede_price_cohort_';
    const PRICE_RATING_CACHE_PREFIX = 'mobilede_price_rating_';
    const PRICE_RATING_UI_CACHE_PREFIX = 'mobilede_price_rating_ui_';
    const PRICE_VIP_EQUIP_CACHE_PREFIX = 'mobilede_price_vip_equip_';
    const MAKE_MODEL_CACHE_PREFIX = 'mobilede_mkmd_models_';
    const MAKE_MODEL_AD_CACHE_PREFIX = 'mobilede_mkmd_ad_';
    const PRICE_COHORT_CACHE_TTL_MS = 20 * 60 * 1000;
    const PRICE_RATING_UI_CACHE_TTL_MS = 3 * 60 * 1000;
    const DEBUG_SCOPE_DEFINITIONS = [
        { key: 'price', label: 'Preisbewertung', prefix: '[mobilede Preis]' },
        { key: 'perf', label: 'Performance', prefix: '[mobilede Perf]' },
        { key: 'ausstattung', label: 'Ausstattungssuche', prefix: '[mobilede Ausstattung]' },
        { key: 'tech', label: 'Technische Daten', prefix: '[mobilede Tech]' },
        { key: 'merge', label: 'Merge/Normalisierung', prefix: '[mobilede Merge]' },
        { key: 'ui', label: 'UI/Config', prefix: '[mobilede UI]' }
    ];
    const DEBUG_SCOPE_PREFIX = DEBUG_SCOPE_DEFINITIONS.reduce((acc, def) => {
        acc[def.key] = def.prefix;
        return acc;
    }, {});

    function srpSortDefault() {
        return JSON.parse(JSON.stringify(SRP_SORT_DEFAULT));
    }

    function findSrpSortOption(sortId) {
        return SRP_SORT_OPTIONS.find(o => o.id === sortId) || SRP_SORT_OPTIONS[0];
    }

    function mergeSrpSort(stored) {
        const d = srpSortDefault();
        if (!stored || typeof stored !== 'object') return d;
        const sortId = SRP_SORT_OPTIONS.some(o => o.id === stored.sortId) ? stored.sortId : d.sortId;
        return { enabled: stored.enabled !== false, sortId };
    }

    function priceRatingDefault() {
        return JSON.parse(JSON.stringify(PRICE_RATING_DEFAULT));
    }

    function mergePriceRating(stored) {
        const d = priceRatingDefault();
        if (!stored || typeof stored !== 'object') return d;
        const out = { ...d, ...stored };
        if (Array.isArray(stored.thresholds) && stored.thresholds.length === 5) {
            out.thresholds = stored.thresholds.map((t, i) => {
                let maxPct = typeof t.maxPct === 'number' ? t.maxPct : d.thresholds[i].maxPct;
                if (maxPct >= 999 || maxPct === null) maxPct = Infinity;
                return {
                    maxPct,
                    level: typeof t.level === 'number' ? t.level : d.thresholds[i].level
                };
            });
        }
        out.enabled = stored.enabled !== false;
        out.useModelRange = stored.useModelRange !== false;
        out.keyUseMileage = stored.keyUseMileage !== false;
        out.keyUseYear = stored.keyUseYear !== false;
        out.keyUsePower = stored.keyUsePower !== false;
        out.keyKmBucket = Math.max(500, Math.min(50000, parseInt(out.keyKmBucket, 10) || d.keyKmBucket));
        out.keyYearBucket = Math.max(1, Math.min(5, parseInt(out.keyYearBucket, 10) || d.keyYearBucket));
        out.keyPowerBucket = Math.max(1, Math.min(50, parseInt(out.keyPowerBucket, 10) || d.keyPowerBucket));
        out.onlyFavoriteWeights = stored.onlyFavoriteWeights === true;
        out.minComparables = Math.max(5, Math.min(50, parseInt(out.minComparables, 10) || d.minComparables));
        out.punktZuEuro = Math.max(100, parseInt(out.punktZuEuro, 10) || d.punktZuEuro);
        out.maxAdjustPct = Math.max(0.05, Math.min(0.25, Number(out.maxAdjustPct) || d.maxAdjustPct));
        out.kmToleranceAbs = Math.max(0, Math.min(200000, parseInt(out.kmToleranceAbs, 10) || d.kmToleranceAbs));
        out.yearTolerance = Math.max(0, Math.min(3, parseInt(out.yearTolerance, 10) || d.yearTolerance));
        out.powerToleranceKw = Math.max(0, Math.min(80, parseInt(out.powerToleranceKw, 10) || d.powerToleranceKw));
        // Backward compatibility for previous %-based settings.
        if (stored.kmToleranceAbs == null && typeof stored.kmTolerancePct === 'number') {
            out.kmToleranceAbs = d.kmToleranceAbs;
        }
        if (stored.powerToleranceKw == null && typeof stored.powerTolerancePct === 'number') {
            out.powerToleranceKw = d.powerToleranceKw;
        }
        return out;
    }

    function getPriceRating(flags) {
        return mergePriceRating(flags && flags.priceRating);
    }

    function isPriceRatingEnabled(prCfg) {
        const pr = prCfg || getPriceRating(featureFlags);
        return pr.enabled !== false;
    }

    function getSrpSort(flags) {
        return mergeSrpSort(flags && flags.srpSort);
    }

    const SRP_SORT_OVERRIDE_STORAGE_KEY = 'mobilede_srp_sort_user_choice';
    const SRP_SORT_APPLIED_STORAGE_KEY = 'mobilede_srp_sort_applied';
    /** URL-Parameter, die bei Sortierung/Navigation wechseln – nicht im Such-Fingerprint. */
    const SRP_FINGERPRINT_EXCLUDE = new Set(['sb', 'od', 'ref', 'refId', 'page', 'pageNumber', 'offset']);

    function srpSortParamsEqual(a, b) {
        return a && b && a.sb === b.sb && a.od === b.od;
    }

    function getStoredSrpSortApplied() {
        try {
            const raw = sessionStorage.getItem(SRP_SORT_APPLIED_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.fp !== 'string') return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function markSrpSortApplied(fp, sb, od) {
        try {
            sessionStorage.setItem(SRP_SORT_APPLIED_STORAGE_KEY, JSON.stringify({ fp, sb, od }));
        } catch (e) { /* noop */ }
    }

    function clearStoredSrpSortApplied() {
        try {
            sessionStorage.removeItem(SRP_SORT_APPLIED_STORAGE_KEY);
        } catch (e) { /* noop */ }
    }

    function getStoredSrpUserChoice() {
        try {
            const raw = sessionStorage.getItem(SRP_SORT_OVERRIDE_STORAGE_KEY);
            if (!raw) return null;
            if (raw.charAt(0) === '{') {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.fp === 'string') {
                    return {
                        fp: parsed.fp,
                        sb: parsed.sb != null ? parsed.sb : null,
                        od: parsed.od || 'up'
                    };
                }
            }
            if (raw.indexOf('/') !== -1) return { fp: raw, sb: null, od: 'up' };
        } catch (e) { /* noop */ }
        return null;
    }

    function setStoredSrpUserChoice(choice) {
        try {
            sessionStorage.setItem(SRP_SORT_OVERRIDE_STORAGE_KEY, JSON.stringify(choice));
        } catch (e) { /* noop */ }
    }

    function clearStoredSrpUserChoice() {
        try {
            sessionStorage.removeItem(SRP_SORT_OVERRIDE_STORAGE_KEY);
        } catch (e) { /* noop */ }
    }

    function hasSrpSortUserOverride(fp) {
        const choice = getStoredSrpUserChoice();
        return srpSortUserOverrideFp === fp || !!(choice && choice.fp === fp);
    }

    function markSrpSortUserOverride(sort) {
        const fp = getSrpSearchFingerprint();
        const current = sort || parseSortFromUrl();
        srpSortUserOverrideFp = fp;
        setStoredSrpUserChoice({
            fp,
            sb: current.sb,
            od: current.od || 'up'
        });
    }

    function clearSrpSortUserOverride() {
        srpSortUserOverrideFp = null;
        clearStoredSrpUserChoice();
    }

    function clearSrpSortSessionState() {
        clearSrpSortUserOverride();
        clearStoredSrpSortApplied();
    }

    function countConfigTabSettings(flags) {
        const f = flags || featureFlags;
        let on = FEATURE_FLAG_DEFINITIONS.filter(d => f[d.key] !== false).length;
        let all = FEATURE_FLAG_DEFINITIONS.length;
        if (getSrpSort(f).enabled) on += 1;
        all += 1;
        return { on, all };
    }

    function listOrderDefault() {
        return JSON.parse(JSON.stringify(LIST_ORDER_DEFAULT));
    }

    function mergeListOrder(stored) {
        const d = listOrderDefault();
        if (!stored || typeof stored !== 'object') return d;
        return {
            ...d,
            ...stored,
            scopes: { ...d.scopes, ...(stored.scopes || {}) }
        };
    }

    function getConfigListUi(flags) {
        return flags && flags.configListUi === 'split' ? 'split' : 'classic';
    }

    function mergeConfigListUi(stored, defaults) {
        const v = stored && stored.configListUi;
        return { ...defaults, configListUi: v === 'split' ? 'split' : 'classic' };
    }

    function debugConfigDefault() {
        const scopes = {};
        DEBUG_SCOPE_DEFINITIONS.forEach(def => { scopes[def.key] = false; });
        return { enabled: false, showSrpLogCard: false, scopes };
    }

    function mergeDebugConfig(stored, legacyFlags) {
        const d = debugConfigDefault();
        if (stored && typeof stored === 'object') {
            const scopes = { ...d.scopes, ...(stored.scopes || {}) };
            return {
                enabled: stored.enabled === true,
                showSrpLogCard: stored.showSrpLogCard === true,
                scopes
            };
        }
        const hasLegacy = legacyFlags && typeof legacyFlags === 'object';
        if (!hasLegacy) return d;
        const legacyPrice = legacyFlags.priceRatingDebug === true;
        const legacyPerf = legacyFlags.priceRatingPerfDebug === true;
        return {
            enabled: legacyPrice || legacyPerf,
            scopes: { ...d.scopes, price: legacyPrice, perf: legacyPerf }
        };
    }

    function getDebugConfig(flags) {
        const merged = mergeDebugConfig(flags && flags.debug, flags || featureFlags);
        return merged;
    }

    function isDebugEnabled(scope, flags) {
        const dbg = getDebugConfig(flags || featureFlags);
        if (!dbg.enabled) return false;
        if (!scope) return true;
        return dbg.scopes[scope] === true;
    }

    function debugLog(scope, ...args) {
        if (!isDebugEnabled(scope)) return;
        const prefix = DEBUG_SCOPE_PREFIX[scope] || '[mobilede Debug]';
        console.info(prefix, ...args);
    }

    function persistDebugConfig(nextDebugConfig) {
        const merged = ladeFeatureFlags();
        merged.debug = mergeDebugConfig(nextDebugConfig, merged);
        merged.priceRatingDebug = merged.debug.enabled && merged.debug.scopes.price === true;
        merged.priceRatingPerfDebug = merged.debug.enabled && merged.debug.scopes.perf === true;
        speichereConfig(STORAGE_KEYS.featureFlags, merged);
        featureFlags = merged;
    }

    function persistDebugMaster(enabled) {
        const merged = ladeFeatureFlags();
        const dbg = getDebugConfig(merged);
        persistDebugConfig({ ...dbg, enabled: !!enabled });
    }

    function persistDebugScope(scope, enabled) {
        const merged = ladeFeatureFlags();
        const dbg = getDebugConfig(merged);
        persistDebugConfig({
            ...dbg,
            scopes: { ...dbg.scopes, [scope]: !!enabled }
        });
    }

    function featureFlagsDefault() {
        const obj = {};
        FEATURE_FLAG_DEFINITIONS.forEach(d => { obj[d.key] = !!d.default; });
        obj.listOrder = listOrderDefault();
        obj.srpSort = srpSortDefault();
        obj.priceRating = priceRatingDefault();
        obj.configListUi = 'classic';
        obj.debug = debugConfigDefault();
        obj.priceRatingDebug = false;
        obj.priceRatingPerfDebug = false;
        return obj;
    }
    function ladeFeatureFlags() {
        const stored = ladeConfig(STORAGE_KEYS.featureFlags);
        const defaults = featureFlagsDefault();
        if (!stored || typeof stored !== 'object') return defaults;
        const merged = mergeConfigListUi(stored, { ...defaults, ...stored });
        merged.listOrder = mergeListOrder(stored.listOrder);
        merged.srpSort = mergeSrpSort(stored.srpSort);
        merged.priceRating = mergePriceRating(stored.priceRating);
        merged.debug = mergeDebugConfig(stored.debug, stored);
        merged.priceRatingDebug = merged.debug.enabled && merged.debug.scopes.price === true;
        merged.priceRatingPerfDebug = merged.debug.enabled && merged.debug.scopes.perf === true;
        return merged;
    }

    function persistPriceRatingDebug(enabled) {
        persistDebugMaster(!!enabled);
        persistDebugScope('price', !!enabled);
    }

    function persistPriceRatingPerfDebug(enabled) {
        persistDebugScope('perf', !!enabled);
    }

    // ============================================================
    // 1) GM_*-Speicherhilfen
    // ============================================================
    function ladeConfig(key) {
        try {
            const str = GM_getValue(key, null);
            if (!str) return null;
            return JSON.parse(str);
        } catch (e) {
            console.warn('Fehler beim Laden der Konfiguration:', key, e);
            return null;
        }
    }
    function speichereConfig(key, data) {
        try {
            GM_setValue(key, JSON.stringify(data));
        } catch (e) {
            console.error('Fehler beim Speichern der Konfiguration:', key, e);
        }
    }

    // ============================================================
    // 2) Default-Konfigurationen (bereinigt)
    //    - umlauts und diakritika dürfen vorkommen, werden bei
    //      cleanText() / tokenize() normalisiert.
    //    - 'nurInFeatures: true' ignoriert Treffer aus Beschreibung.
    //    - 'compound: true' erlaubt Substring-Match an beliebiger
    //      Stelle im Token (selten nötig).
    // ============================================================
    const suchKonfigurationenDefault = [
        { begriffe: ['360 grad', '360 kamera', '360 cam', 'umfeld kamera', 'surround cam'], anzeige: '360 Grad Kamera', farbe: 'red', aktiv: true },
        { begriffe: ['scheiben abgedunk', 'abgedunk scheib'], anzeige: 'Abgedunkelte Scheiben', aktiv: true },
        { begriffe: ['anti blockiersystem', 'antiblocksicherung', 'abs brems'], anzeige: 'ABS', aktiv: false },
        { begriffe: ['tempomat abstand', 'adapt temp', 'acc'], anzeige: 'Abstandstempomat', farbe: 'orange', aktiv: true },
        { begriffe: ['abstands warn', 'distance warn'], anzeige: 'Abstandswarner', aktiv: false },
        { begriffe: ['adapt kurv licht', 'kurvenlicht adaptiv'], anzeige: 'Adaptives Kurvenlicht', aktiv: true },
        { begriffe: ['adblue technologie', 'adblue hinweis', 'scr system'], anzeige: 'AdBlue / SCR', aktiv: true },
        { begriffe: ['akustikverglasung', 'akustik verglasung', 'frontscheibe akus'], anzeige: 'Akustikverglasung', aktiv: true },
        { begriffe: ['alarmanlage', 'diebstahlwarnanlage'], anzeige: 'Alarmanlage', aktiv: true },
        { begriffe: ['4wd', 'allrad'], anzeige: 'Allrad', farbe: 'orange', aktiv: true },
        { begriffe: ['ambiente beleuchtung', 'ambiente licht', 'stimmungslicht'], anzeige: 'Ambiente-Beleuchtung', aktiv: true },
        { begriffe: ['android auto'], anzeige: 'Android Auto', aktiv: true },
        { begriffe: ['anhängevorrichtung', 'anhängerkupplung', 'ahk'], anzeige: 'Anhängerkupplung', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['anhängevorrichtung schwenkbar', 'anhängerkupplung schwenkbar'], anzeige: 'Anhängerkupplung schwenkbar', aktiv: true },
        { begriffe: ['apple carplay', 'apple car play'], anzeige: 'Apple Carplay', aktiv: true },
        { begriffe: ['armlehne'], anzeige: 'Armlehne', aktiv: false },
        { begriffe: ['aussen innen mit abblendautomat', 'aussen innenspiegel mit abblendautomatik', 'aeussen innen mit abblendautomatik', 'aussen innenspiegel mit abblendautomatik und regensensor', 'innen aussen spiegel abblend'], anzeige: 'Außen-/Innenspiegel automatisch abblendend', aktiv: true },
        { begriffe: ['spiegel klappbar', 'elek spiegel klapp', 'außenspiegel anklappbar', 'außenspiegel klappbar', 'aussenspiegel elektr anklapp', 'spiegel elektr anklappbar'], anzeige: 'Außenspiegel anklappbar', aktiv: true },
        { begriffe: ['aussenspiegel mit abblendautomatik', 'aeussenspiegel mit abblendautomatik'], anzeige: 'Außenspiegel automatisch abblendend', aktiv: true },
        { begriffe: ['außenspiegel heizung', 'außenspiegel beheiz', 'außenspiegel heiz', 'verstell und heizbar', 'aussenspiegel verstell heizbar', 'heizbar beide', 'elektr verstell heizbar', 'verstell heizbar beide'], anzeige: 'Außenspiegel beheizbar', aktiv: true },
        { begriffe: ['außenspiegel elek verst', 'elek spiegel', 'aussenspiegel elektr verstell', 'elektr verstell'], anzeige: 'Außenspiegel elektr. verstellbar', aktiv: true },
        { begriffe: ['bang & olufsen', 'b&o', 'bang olufsen'], anzeige: 'Bang & Olufsen Sound System', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['beats'], anzeige: 'Beats Sound System', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['berganfahrassist', 'berganfahr', 'hill start', 'hill hold', 'anfahrassist'], anzeige: 'Berganfahrassistent', aktiv: true },
        { begriffe: ['bi xenon', 'scheinwerfer xenon', 'xenon scheinwerfer'], anzeige: 'Bi-/Xenon-Scheinwerfer', aktiv: true },
        { begriffe: ['bluetooth', 'blue tooth'], anzeige: 'Bluetooth', aktiv: true },
        { begriffe: ['bose'], anzeige: 'BOSE Sound System', farbe: 'red', aktiv: true },
        { begriffe: ['brems assist', 'brake assist'], verboten: ['notbrems', 'not brems'], anzeige: 'Bremsassistent', aktiv: true },
        { begriffe: ['burmester'], anzeige: 'Burmester Sound System', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['business paket professional', 'business paket'], anzeige: 'Business Paket', aktiv: true },
        { begriffe: ['canton'], anzeige: 'Canton Sound System', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['dachhimmel alcantara', 'himmel alcant'], anzeige: 'Dachhimmel Alcantara', aktiv: true },
        { begriffe: ['dachhimmel anth', 'himmel anth', 'dachhimmel schwarz', 'dachhim schwarz'], anzeige: 'Dachhimmel Anthrazit / Schwarz', aktiv: true },
        { begriffe: ['elek fenst'], anzeige: 'Elektr. Fensterheber', aktiv: true },
        { begriffe: ['elek heckklappe'], anzeige: 'Elektr. Heckklappe', aktiv: true },
        { begriffe: ['sitz elek verstell', 'sitzeinstellung', 'sitz einstellung', 'elektr sitz'], anzeige: 'Elektr. Sitzeinstellung', aktiv: true },
        { begriffe: ['memory sitz', 'sitz memory', 'sitz elek verstell memory'], anzeige: 'Elektr. Sitzeinstellung mit Memory-Funktion', farbe: 'red', aktiv: true },
        { begriffe: ['elek wegfahrsperre', 'elektrisch wegfahrsper', 'wegfahrsperre elek'], anzeige: 'Elektr. Wegfahrsperre', aktiv: false },
        { begriffe: ['elektronisches stabilit', 'fahrstabilität', 'fahrstabilitaet'], anzeige: 'ESP', aktiv: true },
        { begriffe: ['blendfrei fernlicht', 'anti blend licht', 'fernlicht assist', 'auto fernlicht'], anzeige: 'Fernlicht Assistent', farbe: 'orange', aktiv: true },
        { begriffe: ['freisprecheinrichtung', 'freisprechanlage', 'hands free einricht'], anzeige: 'Freisprecheinrichtung', aktiv: true },
        { begriffe: ['garantie'], anzeige: 'Garantie', aktiv: false },
        { begriffe: ['harman kardon', 'h&k', 'harman'], anzeige: 'Harman Kardon Sound System', farbe: 'red', aktiv: true, nurInFeatures: true },
        { begriffe: ['head up', 'head-up', 'hud'], anzeige: 'Head-Up Display', farbe: 'red', aktiv: true },
        { begriffe: ['heckantrieb', 'antrieb heck'], anzeige: 'Heckantrieb', aktiv: false },
        { begriffe: ['induktiv laden', 'induktion laden', 'induktionsladen', 'wireless charge'], anzeige: 'Induktionsladeschale für Smartphone (Wireless Charging)', aktiv: false },
        { begriffe: ['innenraumfilter aktiv', 'innenraum aktivkohlefilt', 'aktivkohle geruchs', 'innenraumfilter geruch'], anzeige: 'Innenraumfilter Aktivkohle', aktiv: true },
        { begriffe: ['innenspiegel abblend', 'inne spiegel auto'], anzeige: 'Innenspiegel autom. abblendend', aktiv: true },
        { begriffe: ['klima automatik', 'klimaautomatic', 'klima autom'], anzeige: 'Klimaautomatik', aktiv: false },
        { begriffe: ['lederlenkrad', 'leder lenkrad'], anzeige: 'Lederlenkrad', aktiv: false },
        { begriffe: ['lenkradheizung', 'beheizbares lenkrad', 'lenkrad heizung', 'lenkrad beheiz'], anzeige: 'Lenkradheizung', aktiv: true },
        { begriffe: ['lichtsensor'], anzeige: 'Lichtsensor', aktiv: true },
        { begriffe: ['matrix led', 'matrix scheinwerfer', 'matrix beam', 'matrix licht'], anzeige: 'Matrix Scheinwerfer', farbe: 'red', aktiv: true },
        { begriffe: ['multifunktionslenkrad', 'multifunktion lenkrad', 'multifunk lenkr'], anzeige: 'Multifunktionslenkrad', aktiv: true },
        { begriffe: ['nebelscheinwerfer', 'nebel scheinwerfer'], anzeige: 'Nebelscheinwerfer', aktiv: false },
        { begriffe: ['panorama', 'panoramadach', 'glas dach'], anzeige: 'Panoramadach', farbe: 'orange', aktiv: true },
        { begriffe: ['panorama schiebedach', 'schiebedach panorama', 'panorama schieb'], verboten: ['ohne panorama'], anzeige: 'Panoramadach elektr. schiebbar', farbe: 'orange', aktiv: true },
        { begriffe: ['pdc', 'park dist contr'], anzeige: 'Park-Distance-Control', aktiv: true },
        { begriffe: ['park assist', 'park hilfe'], anzeige: 'Parkassistent', aktiv: true },
        { begriffe: ['porsche dynam licht', 'porsche dynamic light', 'dynam licht syst'], verboten: ['licht system plus', 'porsche dynam licht plus'], anzeige: 'Porsche Dynamic Light System (PDLS)', aktiv: true },
        { begriffe: ['pdls plus', 'porsche dynam licht plus', 'dynam licht system plus'], anzeige: 'Porsche Dynamic Light System Plus (PDLS+)', aktiv: true },
        { begriffe: ['quattro'], anzeige: 'Quattro / Allrad', farbe: 'orange', aktiv: true },
        { begriffe: ['radio dab', 'empfang dab', 'radioempfang dab', 'radio digital dab'], anzeige: 'Radio digital (DAB / DAB+)', aktiv: true },
        { begriffe: ['regensensor'], anzeige: 'Regensensor', aktiv: true },
        { begriffe: ['reifen druck', 'druck kontrolle'], anzeige: 'Reifendruck Kontrollsystem', aktiv: true },
        { begriffe: ['rückfahrkamera', 'rückfahrkamerasystem'], anzeige: 'Rückfahrkamera', aktiv: true },
        { begriffe: ['scheckheft gepflegt', 'scheckheft'], anzeige: 'Scheckheftgepflegt', farbe: 'red', aktiv: true },
        { begriffe: ['keyless', 'schlüssel frei', 'schlüssellose zentral'], anzeige: 'Schlüssellose Zentralverriegelung (Keyless)', farbe: 'orange', aktiv: true },
        { begriffe: ['seiten airbag', 'airbag seite'], anzeige: 'Seitenairbag', aktiv: false },
        { begriffe: ['seitenscheibe akus', 'türscheiben akus', 'seitenscheibe verglasung'], anzeige: 'Seitenscheiben Akustikverglasung', aktiv: true, nurInFeatures: true },
        { begriffe: ['sitzbelüftung', 'sitz belüftung', 'sitzkühlung', 'sitz kühlung'], anzeige: 'Sitzbelüftung', farbe: 'red', aktiv: true },
        { begriffe: ['sitzheizung', 'sitz heizung', 'heizung sitz'], anzeige: 'Sitzheizung', farbe: 'orange', aktiv: true },
        { begriffe: ['servoschließung tür', 'soft close', 'softclose'], verboten: ['pedal', 'virtuell'], anzeige: 'Softclose', aktiv: true },
        { begriffe: ['sonnenschutzverglasung'], anzeige: 'Sonnenschutzverglasung', aktiv: true },
        { begriffe: ['sonnenschutzverglasung abgedunkelt'], anzeige: 'Sonnenschutzverglasung abgedunkelt', aktiv: true },
        { begriffe: ['spurhalte assist', 'lane assist'], anzeige: 'Spurhalteassistent', aktiv: true },
        { begriffe: ['standbelüf'], anzeige: 'Standbelüftung', aktiv: true },
        { begriffe: ['standheizung', 'standhei'], anzeige: 'Standheizung', aktiv: true },
        { begriffe: ['start stop', 'auto stop'], anzeige: 'Start/Stopp-Automatik', aktiv: true },
        { begriffe: ['tempolimit anzeige', 'tempo limit hinwe', 'geschwind limit hinwe'], anzeige: 'Tempolimit-Anzeige', aktiv: true },
        { begriffe: ['totwinkel', 'blind spot'], anzeige: 'Totwinkel-Assistent', aktiv: true },
        { begriffe: ['traktionskontrolle', 'traction control', 'traktio kontr', 'antischlupf', 'antrieb schlupf', 'asr'], anzeige: 'Traktionskontrolle', aktiv: false },
        { begriffe: ['verkehrszeichen', 'road sign'], anzeige: 'Verkehrszeichenerkennung', aktiv: true },
        { begriffe: ['digital cockpit', 'virtual cockpit', 'volldigit kombiinstrument', 'kombiinstrument digital'], anzeige: 'Volldigitales Kombiinstrument', aktiv: true },
        { begriffe: ['winter paket', 'kalt paket'], anzeige: 'Winterpaket', aktiv: true },
        { begriffe: ['zentral verriegelung', 'central lock', 'zentralverriegelung'], anzeige: 'Zentralverriegelung', aktiv: true }

    ];

    const techDataKonfigurationenDefault = [
        { begriff: 'Fahrzeugzustand',    aktiv: true },
        { begriff: 'Erstzulassung',      aktiv: true },
        { begriff: 'Innenausstattung',   aktiv: true },
        { begriff: 'Farbe (Hersteller)', aktiv: true },
        { begriff: 'Farbe',              aktiv: true }
    ];

    const mergeGruppenConfigDefault = [
        { basis: 'außenspiegel', order: ['elektr. verstellbar', 'beheizbar', 'anklappbar', 'klappbar', 'automatisch abblend.', 'auto. abblend.'], aktiv: true }
    ];

    function getFavoriteAnzeigeKeys(config) {
        const keys = new Set();
        if (!Array.isArray(config)) return keys;
        config.forEach(item => {
            if (item && item.favorit === true && item.anzeige) {
                keys.add(String(item.anzeige).trim().toLowerCase());
            }
        });
        return keys;
    }

    function partitionEntriesByFavorites(entries, favoriteKeys) {
        if (!favoriteKeys || favoriteKeys.size === 0) return entries;
        const fav = [];
        const rest = [];
        entries.forEach(e => {
            const key = (e.anzeige || '').trim().toLowerCase();
            if (favoriteKeys.has(key)) fav.push(e);
            else rest.push(e);
        });
        return fav.concat(rest);
    }

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
    function unionBegriffeMitDefaults(userConfig, defaults) {
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
    const ANZEIGE_RENAMES = {
        'seitenspiegel anklappbar': 'Außenspiegel anklappbar'
    };

    function applyAnzeigeRenames(userConfig) {
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
    const ANZEIGE_PROPERTY_UPDATES = {
        'seitenscheiben akustikverglasung': { nurInFeatures: true },
        'bremsassistent': { verboten: ['notbrems', 'not brems'] }
    };

    function applyAnzeigePropertyUpdates(userConfig) {
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

    function addMissingDefaultEntries(userConfig, defaults) {
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
    const BEGRIFF_EXCLUSIVE_OWNERS = [
        { begriff: 'verstell und heizbar', ownerAnzeige: 'Außenspiegel beheizbar' }
    ];

    function dedupeAmbiguousBegriffeAcrossConfigs(userConfig) {
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

    function migrateAusstattungFavorit(userConfig) {
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

    function migrateAusstattungPreisGewicht(userConfig) {
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

    function applyPreisGewichtDefaults(userConfig, force) {
        if (!Array.isArray(userConfig)) return userConfig;
        return userConfig.map(item => {
            const key = (item.anzeige || '').trim().toLowerCase();
            const def = DEFAULT_PREIS_GEWICHT_BY_ANZEIGE[key];
            if (def == null) return item;
            if (!force && typeof item.preisGewicht === 'number' && item.preisGewicht > 0) return item;
            return { ...item, preisGewicht: def };
        });
    }

    function clearAllPreisGewichte(userConfig) {
        if (!Array.isArray(userConfig)) return userConfig;
        return userConfig.map(item => ({ ...item, preisGewicht: 0 }));
    }

    function migrateMergeGroups(userMerge, defaults) {
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

    function migrateIfNeeded() {
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
    migrateIfNeeded();

    let suchKonfigurationen     = migrateAusstattungPreisGewicht(dedupeAmbiguousBegriffeAcrossConfigs(
        ladeConfig(STORAGE_KEYS.config) || suchKonfigurationenDefault
    ));
    let techDataKonfigurationen = ladeConfig(STORAGE_KEYS.techConfig)  || techDataKonfigurationenDefault;
    let mergeGruppenConfig      = ladeConfig(STORAGE_KEYS.mergeGroups) || mergeGruppenConfigDefault;
    let featureFlags            = ladeFeatureFlags();
    /** Prefill für neuen Ausstattungseintrag aus Ergebnisliste („+ Konfig“). */
    let pendingAusstattungPrefill = null;

    function isAutoModeEnabled() {
        return !!(featureFlags && featureFlags.autoMode === true);
    }

    function getListOrder(flags) {
        return mergeListOrder(flags && flags.listOrder);
    }

    function isManualScope(scopeKey, flags) {
        const lo = getListOrder(flags || featureFlags);
        if (lo.mode !== 'manual') return false;
        return !!(lo.scopes && lo.scopes[scopeKey]);
    }

    function hasAnyManualListScope(flags) {
        const lo = getListOrder(flags || featureFlags);
        if (lo.mode !== 'manual') return false;
        const s = lo.scopes || {};
        return !!(s.ausstattung || s.ausstattungFavorites || s.tech);
    }

    function shouldApplyOrderToVehicleResults(flags) {
        const lo = getListOrder(flags || featureFlags);
        return lo.mode === 'manual' && !!lo.applyToVehicleResults && hasAnyManualListScope(flags);
    }

    function getConfigOrderIndexMap(config, keyFn) {
        const map = new Map();
        if (!Array.isArray(config)) return map;
        config.forEach((item, idx) => {
            const k = keyFn(item);
            if (k && !map.has(k)) map.set(k, idx);
        });
        return map;
    }

    function sortEntriesByConfigOrder(entries, config, favoriteKeys, flags) {
        const lo = getListOrder(flags || featureFlags);
        const useConfigOrder = lo.mode === 'manual' && lo.applyToVehicleResults &&
            (isManualScope('ausstattung', flags) || isManualScope('ausstattungFavorites', flags));
        if (!useConfigOrder) {
            const out = [...entries].sort((a, b) =>
                (a.anzeige || '').localeCompare((b.anzeige || ''), 'de'));
            return partitionEntriesByFavorites(out, favoriteKeys);
        }
        const keyFn = item => (item.anzeige || '').trim().toLowerCase();
        const orderMap = getConfigOrderIndexMap(config, keyFn);
        const favOnly = isManualScope('ausstattungFavorites', flags) && !isManualScope('ausstattung', flags);
        const sorted = [...entries].sort((a, b) => {
            const ka = (a.anzeige || '').trim().toLowerCase();
            const kb = (b.anzeige || '').trim().toLowerCase();
            const af = favoriteKeys && favoriteKeys.has(ka);
            const bf = favoriteKeys && favoriteKeys.has(kb);
            if (af !== bf) return af ? -1 : 1;
            if (favOnly && !af && !bf) {
                return (a.anzeige || '').localeCompare((b.anzeige || ''), 'de');
            }
            const ia = orderMap.has(ka) ? orderMap.get(ka) : 999999;
            const ib = orderMap.has(kb) ? orderMap.get(kb) : 999999;
            if (ia !== ib) return ia - ib;
            return (a.anzeige || '').localeCompare((b.anzeige || ''), 'de');
        });
        return sorted;
    }

    function applySaveOrdering(ausConfig, techConfig, listOrder) {
        const lo = mergeListOrder(listOrder);
        const cmpAus = (a, b) => (a.anzeige || '').trim().localeCompare((b.anzeige || '').trim(), 'de');
        const cmpTech = (a, b) => (a.begriff || '').trim().localeCompare((b.begriff || '').trim(), 'de');
        if (lo.mode !== 'manual') {
            ausConfig.sort(cmpAus);
            techConfig.sort(cmpTech);
            return;
        }
        if (!lo.scopes.ausstattung) {
            if (lo.scopes.ausstattungFavorites) {
                const nonFavSorted = ausConfig.filter(x => !x.favorit).sort(cmpAus);
                let j = 0;
                for (let i = 0; i < ausConfig.length; i++) {
                    if (!ausConfig[i].favorit) ausConfig[i] = nonFavSorted[j++];
                }
            } else {
                ausConfig.sort(cmpAus);
            }
        }
        if (!lo.scopes.tech) {
            techConfig.sort(cmpTech);
        }
    }

    function orderIndicesByArrayPosition(indices) {
        return [...indices].sort((a, b) => a - b);
    }

    // ============================================================
    // 4) Textaufbereitung & Tokenisierung
    // ============================================================
    function cleanText(text) {
        if (!text) return '';
        return text
            .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
            .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
            .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
            .replace(/ß/g, 'ss')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[–—\-]+/g, ' ')
            .replace(/[\n\r\t]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[,;:|()\[\]"']/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .toLowerCase();
    }

    function tokenize(text) {
        const cleaned = cleanText(text);
        if (!cleaned) return [];
        return cleaned.split(/\s+/).filter(Boolean);
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================================
    // 5) Match-Engine
    //    - tokenMatches: exakt, Prefix oder Suffix (>= 4 Zeichen),
    //      Substring nur bei compound: true.
    //    - matchInTokens: Sliding-Window über Trefferpositionen,
    //      O(n log n) statt kartesischem Produkt.
    // ============================================================
    const MAX_WORD_GAP = { 1: 0, 2: 3, 3: 6, 4: 10, 5: 14 };
    function getMaxWordGap(parts) {
        return MAX_WORD_GAP[parts] || (parts > 5 ? parts * 3 : 0);
    }

    function tokenMatches(token, part, compound) {
        if (!token || !part) return false;
        if (token === part) return true;
        if (part.length < 4) return false;
        if (compound) return token.includes(part);
        if (token.startsWith(part) || token.endsWith(part)) return true;
        // Mid-substring nur ab 5 Zeichen erlauben, um false-positives bei
        // 4-Zeichen-Patterns (head, glas, heiz, ende, …) zu vermeiden.
        if (part.length >= 5 && token.includes(part)) return true;
        return false;
    }

    function findPositions(tokens, part, compound) {
        const positions = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokenMatches(tokens[i], part, compound)) positions.push(i);
        }
        return positions;
    }

    /**
     * Sucht ein Fenster in `tokens`, das alle `parts` enthält und
     * dabei höchstens maxGap Wörter Differenz zwischen erstem und
     * letztem getroffenen Token hat.
     * Gibt {startIdx, endIdx} oder null zurück.
     */
    function matchInTokens(tokens, parts, maxGap, compound) {
        if (parts.length === 0 || tokens.length === 0) return null;
        if (parts.length === 1) {
            const pos = findPositions(tokens, parts[0], compound);
            if (pos.length === 0) return null;
            return { startIdx: pos[0], endIdx: pos[0] };
        }
        const positionLists = parts.map(p => findPositions(tokens, p, compound));
        for (const list of positionLists) {
            if (list.length === 0) return null;
        }
        // Pointer pro Liste -> sliding window
        const pointers = new Array(positionLists.length).fill(0);
        let best = null;
        while (true) {
            const current = positionLists.map((list, i) => list[pointers[i]]);
            const min = Math.min(...current);
            const max = Math.max(...current);
            if (max - min <= maxGap) {
                if (!best || (max - min) < (best.endIdx - best.startIdx)) {
                    best = { startIdx: min, endIdx: max };
                    if (max - min === parts.length - 1) return best;
                }
            }
            // bewege den Pointer mit dem kleinsten Wert weiter
            const minListIdx = current.indexOf(min);
            pointers[minListIdx]++;
            if (pointers[minListIdx] >= positionLists[minListIdx].length) break;
        }
        return best;
    }

    function isForbiddenInWindow(tokens, window, verboten) {
        if (!verboten || verboten.length === 0) return false;
        const slice = tokens.slice(window.startIdx, window.endIdx + 1).join(' ');
        const pattern = new RegExp(verboten.map(escapeRegex).join('|'), 'i');
        return pattern.test(slice);
    }

    // ============================================================
    // 6) Quellen-Extraktion (lazy, mit heuristischem Fallback)
    // ============================================================
    function getFeatureItems() {
        return Array.from(document.querySelectorAll("ul[data-testid='vip-features-list'] li"));
    }
    function getDescriptionEl() {
        return document.querySelector("div[data-testid='vip-vehicle-description-text']");
    }
    function getTechDataDl() {
        return document.querySelector("article[data-testid='vip-technical-data-box'] dl");
    }
    /**
     * Heuristik-Fallback für den ehemaligen ".GOIOV fqe3L EevEz"-Block:
     * sucht ein Geschwister-Element zur Beschreibung, das zusätzliche
     * Texte enthält (Verkäufer-Hinweise etc.). Bei Layout-Änderung
     * von mobile.de bleibt das Skript funktional.
     */
    function getZusatzEl() {
        const desc = getDescriptionEl();
        if (!desc) return null;
        const candidate = desc.parentElement && desc.parentElement.nextElementSibling;
        if (candidate && candidate.textContent && candidate.textContent.trim().length > 20) {
            return candidate;
        }
        return null;
    }

    /**
     * Heuristik: erkennt einen Beschreibungs-Block, der in Wahrheit eine
     * Komma-getrennte Feature-Liste ist (typischer mobile.de-Block). Wenn
     * ja, wird der Block als 'high' confidence eingestuft, sodass auch
     * Einträge mit nurInFeatures: true ihn berücksichtigen.
     */
    function classifyDescription(rawText) {
        if (!rawText) return 'low';
        const items = rawText.split(/,/).map(s => s.trim()).filter(Boolean);
        // Eindeutige Komma-Liste: viele Items → strukturierte Ausstattung.
        if (items.length >= 12) return 'high';
        if (items.length >= 6) {
            // Anteil kurzer Items zählen statt nur Mittelwert (robuster gegen
            // einzelne lange Items wie "Multi-Media-Interface MMI Navigation").
            const shortRatio = items.filter(it => it.split(/\s+/).length <= 5).length / items.length;
            if (shortRatio >= 0.6) return 'high';
        }
        return 'low';
    }

    /**
     * Liefert eine Liste von Quellen mit confidence:
     *   - features    -> high
     *   - tech        -> high
     *   - description -> high (wenn Komma-Liste) sonst low
     *   - zusatz      -> low
     */
    function extractSources() {
        const sources = [];

        const featureItems = getFeatureItems();
        if (featureItems.length > 0) {
            const text = featureItems.map(li => li.textContent.trim()).filter(Boolean).join(' | ');
            sources.push({ id: 'features', confidence: 'high', text, tokens: tokenize(text) });
        }

        const techDl = getTechDataDl();
        if (techDl) {
            const text = techDl.textContent.replace(/\s+/g, ' ').trim();
            sources.push({ id: 'tech', confidence: 'high', text, tokens: tokenize(text) });
        }

        const desc = getDescriptionEl();
        if (desc) {
            const rawText = desc.textContent.replace(/\s+/g, ' ').trim();
            const confidence = classifyDescription(rawText);
            const text = rawText.replace(/,/g, ' ');
            sources.push({ id: 'description', confidence, text, tokens: tokenize(text) });
        }

        const zusatz = getZusatzEl();
        if (zusatz) {
            const text = zusatz.textContent.trim();
            sources.push({ id: 'zusatz', confidence: 'low', text, tokens: tokenize(text) });
        }
        return sources;
    }

    // ============================================================
    // 6b) Automodus: Roh-Extraktion & Hybrid-Merge
    // ============================================================
    function isPlausibleEquipmentLabel(label, source) {
        const t = (label || '').trim();
        if (!t) return false;
        if (source === 'features') return true;
        if (t.length > 72) return false;
        if (t.split(/\s+/).filter(Boolean).length > 10) return false;
        const low = t.toLowerCase();
        if (/willkommen|gmbh\b|https?:|www\.|@[\w.-]|fußnote|weitere ausstattung\s*:|sonderausstattung\s*:/i.test(low)) {
            return false;
        }
        return true;
    }

    /**
     * Komma-Liste aus Beschreibung: kurze Anhängsel (beide, links, …) an
     * den vorherigen Eintrag hängen statt eigene Zeile erzeugen.
     */
    function splitDescriptionIntoFeatures(rawText) {
        const normalized = rawText
            .replace(/\b(weitere ausstattung|sonderausstattung)\s*:/gi, ', ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        const parts = normalized.split(/,/).map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return [];
        const merged = [];
        const orphanOnly = /^(beide|links|rechts|vorn|hinten|optional)$/i;
        for (const part of parts) {
            const words = part.split(/\s+/).filter(Boolean);
            const isOrphan = words.length <= 2 && orphanOnly.test(part);
            if (merged.length > 0 && (isOrphan || part.length <= 8)) {
                merged[merged.length - 1] = merged[merged.length - 1] + ', ' + part;
            } else {
                merged.push(part);
            }
        }
        return merged;
    }

    function isAussenInnenCombinedSpiegel(text) {
        const c = cleanText(text || '');
        if (!c) return false;
        // „innen“ allein trifft z. B. „Innenraum“ – Kombi nur mit Innenspiegel-Token
        const hasInnenMirror = /innenspiegel/.test(c);
        if (!hasInnenMirror) return false;
        return /aussenspiegel|seitenspiegel|aussen/.test(c);
    }

    function isInnenSpiegelOnly(text) {
        const c = cleanText(text || '');
        if (/aussenspiegel|seitenspiegel/.test(c)) return false;
        if (isAussenInnenCombinedSpiegel(text)) return false;
        return /innenspiegel/.test(c);
    }

    /** Nur Außenspiegel / Seitenspiegel — ohne Innen- oder Kombi-Zeile. */
    function isAussenSpiegelOnly(text) {
        const c = cleanText(text || '');
        if (!c) return false;
        if (isAussenInnenCombinedSpiegel(text)) return false;
        if (/innenspiegel/.test(c) && !/aussenspiegel|seitenspiegel/.test(c)) return false;
        return /aussenspiegel|seitenspiegel/.test(c);
    }

    function entryMatchesMergeGroup(entry, group) {
        if (!group || group.aktiv === false || !group.basis) return false;
        const a = cleanText(entry.anzeige || '');
        const basis = cleanText(group.basis);
        if (basis && /aussenspiegel/.test(basis)) {
            return isAussenSpiegelOnly(entry.anzeige);
        }
        return !!(basis && a.includes(basis));
    }

    function mergeModifierFromEntry(anzeige, group) {
        const basis = cleanText(group.basis);
        const original = cleanText(anzeige);
        let m = cleanText(anzeige);
        if (basis && m.includes(basis)) {
            m = m.replace(basis, '').trim();
        } else if (isAussenSpiegelOnly(anzeige)) {
            m = m.replace(/^aussenspiegel\s*/i, '').trim();
        } else if (isAussenInnenCombinedSpiegel(anzeige)) {
            m = m.replace(/^(aussen|innen|aussen innen|innen aussen)\s*-?\s*\/?\s*/i, '').trim();
        }
        const out = m || original;
        if (out !== original) {
            debugLog('merge', 'Merge-Modifier extrahiert', { basis, original, modifier: out });
        }
        return out;
    }

    /** Zusatz-Modifier aus Roh-Text (z. B. „verstell- und heizbar“ → beheizbar). */
    function aussenModifiersFromRawLabel(rawLabel) {
        const c = cleanText(rawLabel || '');
        const mods = [];
        if (!/aussenspiegel|seitenspiegel/.test(c)) return mods;
        if (/heizbar|beheiz/.test(c)) mods.push('beheizbar');
        if (/anklapp|klappbar/.test(c)) mods.push('anklappbar');
        if (/verstell/.test(c)) mods.push('elektr. verstellbar');
        if (/abblend/.test(c)) mods.push('automatisch abblend.');
        return mods;
    }

    function enrichAussenMergeFromRaw(entries, rawItems) {
        const group = mergeGruppenConfig.find(g =>
            g && g.aktiv !== false && /aussenspiegel/.test(cleanText(g.basis || '')));
        if (!group) return entries;
        const basisClean = cleanText(group.basis);
        const basisCap = group.basis.charAt(0).toUpperCase() + group.basis.slice(1);
        const order = (group.order || []).map(item => item.toLowerCase());

        const targetIdx = entries.findIndex(e => {
            const c = cleanText(e.anzeige || '');
            if (!c.startsWith(basisClean)) return false;
            if (isAussenInnenCombinedSpiegel(e.anzeige) || isInnenSpiegelOnly(e.anzeige)) {
                return false;
            }
            return true;
        });
        if (targetIdx === -1) return entries;

        const hintSet = new Set();
        rawItems.forEach(raw => {
            aussenModifiersFromRawLabel(raw.label).forEach(m => hintSet.add(m));
        });
        if (hintSet.size === 0) return entries;

        const entry = entries[targetIdx];
        let tail = entry.anzeige.replace(new RegExp('^' + basisCap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
        const mods = tail ? tail.split(',').map(s => s.trim()).filter(Boolean) : [];
        hintSet.forEach(h => {
            const hk = h.toLowerCase();
            if (!mods.some(m => m.toLowerCase().includes(hk) || hk.includes(m.toLowerCase()))) {
                mods.push(h);
            }
        });
        mods.sort((a, b) => {
            let ia = order.findIndex(key => a.toLowerCase().includes(key.replace(/\./g, '').trim()));
            let ib = order.findIndex(key => b.toLowerCase().includes(key.replace(/\./g, '').trim()));
            if (ia === -1) ia = 999;
            if (ib === -1) ib = 999;
            return ia - ib;
        });
        const out = [...entries];
        out[targetIdx] = {
            ...entry,
            anzeige: basisCap + (mods.length ? ' ' + mods.join(', ') : '')
        };
        return out;
    }

    function findConfigEntryForRawLabel(rawLabel) {
        const r = cleanText(rawLabel);
        if (!r) return null;
        for (const cfg of suchKonfigurationen) {
            if (!cfg) continue;
            const anzeigeKey = cleanText(cfg.anzeige || '');
            if (anzeigeKey && anzeigeKey === r) return cfg;
            if (anzeigeKey && stringsMatchForHighlight(rawLabel, { anzeige: cfg.anzeige })) {
                return cfg;
            }
            if (Array.isArray(cfg.begriffe)) {
                for (const b of cfg.begriffe) {
                    if (stringsMatchForHighlight(rawLabel, { anzeige: b, begriff: b })) {
                        return cfg;
                    }
                }
            }
        }
        return null;
    }

    function extractRawEquipmentItems() {
        const byKey = new Map();
        const sourcePriority = { features: 2, description: 1 };

        function add(label, source, confidence) {
            const trimmed = (label || '').trim();
            if (!trimmed) return;
            if (!isPlausibleEquipmentLabel(trimmed, source)) return;
            const key = cleanText(trimmed);
            if (!key) return;
            const entry = { label: trimmed, source, confidence };
            const existing = byKey.get(key);
            if (!existing || sourcePriority[source] > sourcePriority[existing.source]) {
                byKey.set(key, entry);
            }
        }

        getFeatureItems().forEach(li => add(li.textContent, 'features', 'high'));

        const desc = getDescriptionEl();
        if (desc) {
            const rawText = desc.textContent.replace(/\s+/g, ' ').trim();
            if (classifyDescription(rawText) === 'high') {
                splitDescriptionIntoFeatures(rawText).forEach(part => add(part, 'description', 'high'));
            }
        }

        return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
    }

    function tokenJaccard(textA, textB) {
        const A = new Set(tokenize(textA));
        const B = new Set(tokenize(textB));
        if (A.size === 0 || B.size === 0) return 0;
        let inter = 0;
        for (const t of A) {
            if (B.has(t)) inter++;
        }
        return inter / (A.size + B.size - inter);
    }

    function stringsMatchForHighlight(rawLabel, hit) {
        const r = cleanText(rawLabel);
        if (!r) return false;
        const candidates = [hit.anzeige, hit.begriff, hit.snippet].filter(Boolean);
        for (const raw of candidates) {
            const c = cleanText(raw);
            if (!c) continue;
            if (r === c) return true;
            if (r.length >= 4 && c.length >= 4 && (r.includes(c) || c.includes(r))) return true;
            if (tokenJaccard(rawLabel, raw) >= 0.6) return true;
        }
        return false;
    }

    function rawCoveredByEntryLabel(rawLabel, entryAnzeige, entryHighlighted) {
        if (!entryAnzeige || !entryHighlighted) return false;
        if (stringsMatchForHighlight(rawLabel, { anzeige: entryAnzeige })) return true;

        if (isInnenSpiegelOnly(rawLabel)) {
            return isInnenSpiegelOnly(entryAnzeige) || isAussenInnenCombinedSpiegel(entryAnzeige);
        }
        if (isAussenInnenCombinedSpiegel(rawLabel)) {
            return isAussenInnenCombinedSpiegel(entryAnzeige);
        }
        if (isAussenSpiegelOnly(rawLabel) && isAussenSpiegelOnly(entryAnzeige)) {
            const r = cleanText(rawLabel);
            const e = cleanText(entryAnzeige);
            if (/heizbar|beheiz/.test(r) && /heizbar|beheiz/.test(e)) return true;
            if (/anklapp/.test(r) && /anklapp/.test(e)) return true;
            if (/verstell/.test(r) && /verstell/.test(e)) return true;
            return stringsMatchForHighlight(rawLabel, { anzeige: entryAnzeige });
        }
        return false;
    }

    function consolidateAutoModeResults(entries, rawItems) {
        const byAnzeigeKey = new Map();
        entries.forEach(e => {
            const k = cleanText(e.anzeige);
            if (!k) return;
            const prev = byAnzeigeKey.get(k);
            if (!prev) { byAnzeigeKey.set(k, e); return; }
            if (e.highlighted && !prev.highlighted) byAnzeigeKey.set(k, e);
        });
        let list = [...byAnzeigeKey.values()];

        const highlighted = list.filter(e => e.highlighted);
        let neutral = list.filter(e => !e.highlighted);

        let mergedHi = generalizedMergeEntries(highlighted, mergeGruppenConfig);
        mergedHi = subsetDedup(mergedHi);

        const aussenHighlight = mergedHi.some(e => isAussenSpiegelOnly(e.anzeige));
        const mirrorNeutralLabels = [];
        const keptNeutral = [];

        neutral.forEach(n => {
            const label = n.rawLabel || n.anzeige;
            if (mergedHi.some(h => rawCoveredByEntryLabel(label, h.anzeige, true))) {
                return;
            }
            if (aussenHighlight && isAussenSpiegelOnly(label)) {
                mirrorNeutralLabels.push(n.anzeige);
                return;
            }
            keptNeutral.push(n);
        });

        if (mirrorNeutralLabels.length > 0) {
            const uniq = [...new Set(mirrorNeutralLabels)];
            const shortUniq = uniq.filter(l => !mergedHi.some(h =>
                rawCoveredByEntryLabel(l, h.anzeige, true)));
            if (shortUniq.length === 0) {
                /* alle Spiegel-Rohzeilen bereits durch Merge abgedeckt */
            } else {
            keptNeutral.push({
                anzeige: 'Außenspiegel (weitere, nicht in Konfig): ' + shortUniq.join(', '),
                farbe: '#b0b0b0',
                source: 'features',
                confidence: 'high',
                highlighted: false,
                learnable: true,
                rawLabel: shortUniq[0]
            });
            }
        }

        let out = [...mergedHi, ...keptNeutral];
        out = enrichAussenMergeFromRaw(out, rawItems || []);
        out = subsetDedup(out);
        return sortEntriesByConfigOrder(out, suchKonfigurationen, getFavoriteAnzeigeKeys(suchKonfigurationen));
    }

    function buildUnifiedResults(rawItems, configHits) {
        const usedRawKeys = new Set();
        const usedHitIndexes = new Set();
        const results = [];

        configHits.forEach((hit, hitIdx) => {
            let rawMatch = null;
            let rawKey = null;
            for (const raw of rawItems) {
                const key = cleanText(raw.label);
                if (usedRawKeys.has(key)) continue;
                if (stringsMatchForHighlight(raw.label, hit)) {
                    rawMatch = raw;
                    rawKey = key;
                    break;
                }
            }
            if (rawMatch) {
                usedRawKeys.add(rawKey);
                usedHitIndexes.add(hitIdx);
                results.push({
                    anzeige: hit.anzeige,
                    farbe: (hit.farbe || '#66ff66').toLowerCase(),
                    source: hit.source || rawMatch.source,
                    confidence: hit.confidence || rawMatch.confidence,
                    snippet: hit.snippet,
                    begriff: hit.begriff,
                    highlighted: true,
                    learnable: false,
                    rawLabel: rawMatch.label
                });
            }
        });

        configHits.forEach((hit, hitIdx) => {
            if (usedHitIndexes.has(hitIdx)) return;
            results.push({
                anzeige: hit.anzeige,
                farbe: (hit.farbe || '#66ff66').toLowerCase(),
                source: hit.source,
                confidence: hit.confidence,
                snippet: hit.snippet,
                begriff: hit.begriff,
                highlighted: true,
                learnable: false
            });
        });

        rawItems.forEach(raw => {
            const key = cleanText(raw.label);
            if (usedRawKeys.has(key)) return;
            const covered = results.some(e =>
                e.highlighted && rawCoveredByEntryLabel(raw.label, e.anzeige, true));
            if (covered) return;

            const cfg = findConfigEntryForRawLabel(raw.label);
            if (cfg) {
                const anzeigeKey = cleanText(cfg.anzeige || '');
                if (results.some(e => cleanText(e.anzeige) === anzeigeKey)) return;
                results.push({
                    anzeige: cfg.anzeige || raw.label,
                    farbe: (cfg.farbe || '#66ff66').toLowerCase(),
                    source: raw.source,
                    confidence: raw.confidence,
                    highlighted: true,
                    configInactive: cfg.aktiv === false,
                    learnable: false,
                    rawLabel: raw.label
                });
                return;
            }

            results.push({
                anzeige: raw.label,
                farbe: '#b0b0b0',
                source: raw.source,
                confidence: raw.confidence,
                highlighted: false,
                learnable: true,
                rawLabel: raw.label
            });
        });

        return consolidateAutoModeResults(results, rawItems);
    }

    /** Konfig-Treffer vor Merge/Sortierung (für Automodus-Hybrid). */
    function dedupeConfigMatchesByAnzeige(matches) {
        const byAnzeige = new Map();
        for (const item of matches) {
            const existing = byAnzeige.get(item.anzeige);
            if (!existing) { byAnzeige.set(item.anzeige, item); continue; }
            const existingHigh = existing.confidence === 'high';
            const itemHigh = item.confidence === 'high';
            if (!existingHigh && itemHigh) byAnzeige.set(item.anzeige, item);
        }
        return [...byAnzeige.values()];
    }

    function collectRawConfigHits() {
        const sources = extractSources();
        if (sources.length === 0) return [];
        return dedupeConfigMatchesByAnzeige(
            collectConfigMatches(sources, suchKonfigurationen));
    }

    function getResultEntries() {
        if (isAutoModeEnabled()) {
            const rawItems = extractRawEquipmentItems();
            return buildUnifiedResults(rawItems, collectRawConfigHits());
        }
        return sucheBegriffe();
    }

    function openLearnConfig(label, source) {
        const trimmed = (label || '').trim();
        if (!trimmed) return;
        if (findConfigEntryForRawLabel(trimmed)) {
            pendingAusstattungPrefill = null;
            oeffneKonfigPopup();
            return;
        }
        pendingAusstattungPrefill = { label: trimmed, source: source || 'features' };
        oeffneKonfigPopup();
    }

    /**
     * Gemeinsamer Abschluss für Keyword-Modus und Automodus-Konfig-Treffer:
     * Merge-Gruppen, Außenspiegel-Modifier aus Seitentext, Favoriten.
     */
    function finalizeAusstattungResults(entries) {
        let unique = subsetDedup([...entries]);
        unique = generalizedMergeEntries(unique, mergeGruppenConfig);
        unique = enrichAussenMergeFromRaw(unique, extractRawEquipmentItems());
        unique = subsetDedup(unique);
        return sortEntriesByConfigOrder(unique, suchKonfigurationen, getFavoriteAnzeigeKeys(suchKonfigurationen));
    }

    function begriffMatchScore(begriff) {
        return tokenize(begriff).length;
    }

    function windowKey(srcId, window) {
        return srcId + ':' + window.startIdx + ':' + window.endIdx;
    }

    function isOnlyFeaturesSource(src) {
        if (!src || !src.id) return false;
        return src.id === 'features' || src.id === 'tech';
    }

    /**
     * Sammelt Treffer pro Quelle/Fenster/Anzeige. Gleicher Begriff darf
     * mehrere Anzeige-Einträge treffen (z. B. beheizbar + verstellbar), aber
     * pro Anzeige nur den spezifischsten Begriff.
     */
    function collectConfigMatches(sources, configs) {
        const candidates = [];
        const configList = isManualScope('ausstattung') || isManualScope('ausstattungFavorites')
            ? [...configs]
            : [...configs].sort((a, b) => (a.anzeige || '').localeCompare(b.anzeige || '', 'de'));

        configList.forEach(cfg => {
            if (!cfg.aktiv) return;
            if (!Array.isArray(cfg.begriffe) || cfg.begriffe.length === 0) return;

            const onlyHigh = cfg.nurInFeatures === true;
            const compound = cfg.compound === true;

            for (const src of sources) {
                if (onlyHigh && !isOnlyFeaturesSource(src)) continue;

                for (const begriff of cfg.begriffe) {
                    const parts = tokenize(begriff);
                    if (parts.length === 0) continue;
                    const maxGap = getMaxWordGap(parts.length);
                    const window = matchInTokens(src.tokens, parts, maxGap, compound);
                    if (!window) continue;
                    if (cfg.verboten && cfg.verboten.length > 0) {
                        const forbiddenParts = cfg.verboten
                            .map(v => cleanText(v))
                            .filter(Boolean);
                        if (isForbiddenInWindow(src.tokens, window, forbiddenParts)) {
                            continue;
                        }
                    }
                    const snippetTokens = src.tokens.slice(
                        Math.max(0, window.startIdx - 2),
                        Math.min(src.tokens.length, window.endIdx + 3)
                    );
                    candidates.push({
                        anzeige: cfg.anzeige,
                        farbe: (cfg.farbe || '#66ff66').toLowerCase(),
                        source: src.id,
                        confidence: src.confidence,
                        snippet: snippetTokens.join(' '),
                        begriff,
                        window,
                        score: begriffMatchScore(begriff)
                    });
                }
            }
        });

        const bestPerAnzeigeWindow = new Map();
        candidates.forEach(c => {
            const key = windowKey(c.source, c.window) + ':' + cleanText(c.anzeige);
            const prev = bestPerAnzeigeWindow.get(key);
            if (!prev || c.score > prev.score) bestPerAnzeigeWindow.set(key, c);
        });

        return [...bestPerAnzeigeWindow.values()].map(c => ({
            anzeige: c.anzeige,
            farbe: c.farbe,
            source: c.source,
            confidence: c.confidence,
            snippet: c.snippet,
            begriff: c.begriff
        }));
    }

    // ============================================================
    // 7) Begriffs-Suche (ersetzt sucheBegriffe)
    // ============================================================
    function sucheBegriffe() {
        let unique = collectRawConfigHits();
        if (unique.length === 0) return [];
        unique = finalizeAusstattungResults(unique);
        debugLog('ausstattung', 'Gefundene Begriffe', unique.map(i => `${i.anzeige} [${i.source}]`));
        return unique;
    }

    function subsetDedup(entries) {
        const tokenSets = entries.map(e => new Set(tokenize(e.anzeige)));
        const result = [];
        for (let i = 0; i < entries.length; i++) {
            const a = tokenSets[i];
            let dropped = false;
            for (let j = 0; j < entries.length; j++) {
                if (i === j) continue;
                const b = tokenSets[j];
                if (b.size <= a.size) continue;
                let containsAll = true;
                for (const t of a) {
                    if (!b.has(t)) { containsAll = false; break; }
                }
                if (containsAll) { dropped = true; break; }
            }
            if (!dropped) result.push(entries[i]);
        }
        return result;
    }

    /** Übernimmt Automodus-Metadaten von Quell-Treffern (u. a. highlighted für consolidateAutoModeResults). */
    function pickMergedEntryMeta(matching) {
        const meta = {
            highlighted: matching.some(e => e.highlighted !== false)
        };
        if (matching.some(e => e.learnable)) meta.learnable = true;
        const rawLabel = matching.map(e => e.rawLabel).find(Boolean);
        if (rawLabel) meta.rawLabel = rawLabel;
        const begriff = matching.map(e => e.begriff).find(Boolean);
        if (begriff) meta.begriff = begriff;
        const snippet = matching.map(e => e.snippet).find(Boolean);
        if (snippet) meta.snippet = snippet;
        if (matching.some(e => e.configInactive)) meta.configInactive = true;
        return meta;
    }

    function generalizedMergeEntries(entries, gruppen) {
        if (!Array.isArray(gruppen) || gruppen.length === 0) return entries;
        let result = [...entries];
        gruppen.forEach(group => {
            if (!group || !group.basis || group.aktiv === false) return;
            const order = (group.order || []).map(item => item.toLowerCase());
            const matching = result.filter(e => entryMatchesMergeGroup(e, group));
            if (matching.length <= 1) return;
            result = result.filter(e => !entryMatchesMergeGroup(e, group));
            let modifiers = matching
                .map(e => mergeModifierFromEntry(e.anzeige, group))
                .filter(Boolean);
            modifiers = Array.from(new Set(modifiers));
            modifiers.sort((a, b) => {
                let ia = order.findIndex(key => a.includes(key.replace(/\./g, '').trim()));
                let ib = order.findIndex(key => b.includes(key.replace(/\./g, '').trim()));
                if (ia === -1) ia = 999;
                if (ib === -1) ib = 999;
                return ia - ib;
            });
            const basisCap = group.basis.charAt(0).toUpperCase() + group.basis.slice(1);
            const merged = basisCap + (modifiers.length ? ' ' + modifiers.join(', ') : '');
            // beste confidence der Gruppe übernehmen
            const bestConf = matching.some(e => e.confidence === 'high') ? 'high' : 'low';
            const sources = [...new Set(matching.map(e => e.source))].join(',');
            result.push({
                anzeige: merged,
                farbe: matching[0].farbe,
                source: sources,
                confidence: bestConf,
                ...pickMergedEntryMeta(matching)
            });
        });
        return result;
    }

    // ============================================================
    // 7b) Ergebnis-UI Styles (minimal, eingebettet in mobile.de)
    // ============================================================
    function injectResultStyles() {
        if (document.getElementById('mobilede-result-style')) return;
        const st = document.createElement('style');
        st.id = 'mobilede-result-style';
        st.textContent = `
article.mobilede-tech-article,article.mobilede-result-article{
  box-sizing:border-box;margin:0;padding:12px 16px;
}
.mobilede-tech-article+.mobilede-result-article{margin-top:8px;}
.mobilede-result-card,.mobilede-tech-card{
  --mdr-text:inherit;--mdr-muted:rgba(255,255,255,.65);--mdr-divider:rgba(255,255,255,.12);
  box-sizing:border-box;width:100%;padding:0;margin:0;background:transparent;
  color:var(--mdr-text);font-size:14px;line-height:1.45;text-align:left;
}
.mobilede-section-title{
  margin:0 0 8px;font-size:15px;font-weight:600;line-height:1.3;color:inherit;
}
.mobilede-subsection-title{
  grid-column:1/-1;margin:0 0 4px;font-size:13px;font-weight:600;line-height:1.3;
  color:var(--mdr-muted);
}
.mobilede-result-grid{
  display:grid;grid-template-columns:1fr;gap:4px 0;align-items:start;
}
@media(min-width:560px){
  .mobilede-result-grid{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px;}
}
.mobilede-result-row{
  display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0;
}
.mobilede-result-hit{
  flex:1;min-width:0;overflow-wrap:anywhere;display:inline-block;
  padding-left:.6em;text-indent:-.6em;
}
.mobilede-result-hit--help{cursor:help;}
.mobilede-result-fav-divider{
  grid-column:1/-1;border-top:1px solid rgba(255,255,255,.22);margin:8px 0 6px;height:0;
}
.mobilede-result-legend{
  width:100%;margin-top:10px;font-size:11px;line-height:1.4;opacity:.7;color:var(--mdr-muted);
}
.mobilede-result-empty{color:var(--mdr-muted);}
.mobilede-learn-btn{
  flex-shrink:0;cursor:pointer;font-size:11px;padding:2px 6px;
  border:1px solid rgba(255,255,255,.25);border-radius:4px;
  background:rgba(255,255,255,.08);color:#e0e0e0;font-family:inherit;
}
.mobilede-learn-btn:hover{background:rgba(255,255,255,.14);}
.mobilede-tech-list{display:flex;flex-direction:column;gap:8px;}
.mobilede-tech-row{
  display:grid;grid-template-columns:1fr;gap:2px 0;align-items:start;
}
@media(min-width:560px){
  .mobilede-tech-row{grid-template-columns:minmax(8rem,38%) 1fr;column-gap:16px;}
}
.mobilede-tech-label{font-weight:500;color:var(--mdr-muted);}
.mobilede-tech-value{overflow-wrap:anywhere;}
`;
        document.head.appendChild(st);
    }

    // ============================================================
    // 8) Suche nach Technischen Daten
    // ============================================================
    function sucheTechnischeDaten() {
        const techDataBereich = getTechDataDl();
        if (!techDataBereich) return [];
        const dtElements = techDataBereich.querySelectorAll('dt');
        const daten = [];
        const useManualOrder = isManualScope('tech') && shouldApplyOrderToVehicleResults();
        const configs = useManualOrder
            ? techDataKonfigurationen
            : [...techDataKonfigurationen].sort((a, b) =>
                (a.begriff || '').trim().localeCompare((b.begriff || '').trim(), 'de'));
        configs.forEach(cfg => {
            if (!cfg.aktiv) return;
            for (const dt of dtElements) {
                if (dt.textContent.trim().toLowerCase() === cfg.begriff.toLowerCase()) {
                    const dd = dt.nextElementSibling;
                    if (dd && dd.tagName.toLowerCase() === 'dd') {
                        daten.push({ title: cfg.begriff, value: dd.textContent.trim() });
                    }
                    break;
                }
            }
        });
        return daten;
    }

    function technischeDatenHinzufuegen(parentElement) {
        const technischeDaten = sucheTechnischeDaten();
        if (technischeDaten.length === 0) {
            debugLog('tech', 'Keine konfigurierten technischen Daten gefunden');
            return;
        }
        debugLog('tech', 'Technische Daten gerendert', { count: technischeDaten.length });
        injectResultStyles();
        const techArticle = document.createElement('article');
        techArticle.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-tech-article';
        const techContainer = document.createElement('div');
        techContainer.className = 'mobilede-tech-card';
        const title = document.createElement('div');
        title.className = 'mobilede-section-title';
        title.textContent = 'Technische Daten:';
        techContainer.appendChild(title);
        const list = document.createElement('div');
        list.className = 'mobilede-tech-list';
        technischeDaten.forEach(d => {
            const row = document.createElement('div');
            row.className = 'mobilede-tech-row';
            const label = document.createElement('div');
            label.className = 'mobilede-tech-label';
            label.textContent = d.title + ':';
            const value = document.createElement('div');
            value.className = 'mobilede-tech-value';
            value.textContent = d.value;
            row.appendChild(label);
            row.appendChild(value);
            list.appendChild(row);
        });
        techContainer.appendChild(list);
        techArticle.appendChild(techContainer);
        parentElement.parentNode.insertBefore(techArticle, parentElement);
    }

    // ============================================================
    // 9) Render: Ergebnis-Article einfügen
    // ============================================================
    function appendResultRow(columns, item, autoMode) {
        const el = document.createElement('div');
        el.className = 'mobilede-result-row';
        const isLow = item.confidence === 'low';
        const isHighlight = autoMode ? item.highlighted !== false : true;

        const span = document.createElement('span');
        span.className = 'mobilede-result-hit';
        const inactiveSuffix = item.configInactive ? ' (inaktiv)' : '';
        span.textContent = `- ${item.anzeige}${inactiveSuffix}${isLow ? ' *' : ''}`;
        span.style.color = item.farbe || '#66ff66';
        if (isHighlight) span.classList.add('mobilede-result-hit--help');

        if (item.configInactive) {
            span.style.fontStyle = 'italic';
            span.style.opacity = '0.75';
        }

        if (autoMode && !isHighlight) {
            span.title = `Quelle: ${item.source || 'unbekannt'}`;
            span.style.opacity = '0.92';
        } else {
            const sourceLabel = isLow
                ? `Nur in Beschreibung gefunden (Quelle: ${item.source})`
                : `Quelle: ${item.source}`;
            const inactiveNote = item.configInactive
                ? '\nIn deiner Konfiguration, aber deaktiviert – aktivieren zum Highlighten per Suchbegriff.'
                : '';
            const trigger = item.begriff ? `\nTrigger: "${item.begriff}"` : '';
            const snippet = item.snippet ? `\nKontext: …${item.snippet}…` : '';
            span.title = sourceLabel + inactiveNote + trigger + snippet;
            if (isLow) {
                span.style.fontStyle = 'italic';
                span.style.opacity = '0.85';
            }
        }
        el.appendChild(span);

        if (autoMode && item.learnable && !isHighlight) {
            const learnBtn = document.createElement('button');
            learnBtn.type = 'button';
            learnBtn.className = 'mobilede-learn-btn';
            learnBtn.textContent = '+ Konfig';
            learnBtn.title = 'Neuen Eintrag in der Konfiguration anlegen';
            learnBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                openLearnConfig(item.rawLabel || item.anzeige, item.source);
            });
            el.appendChild(learnBtn);
        }

        columns.appendChild(el);
    }

    function ergebnisHinzufuegen() {
        document.querySelectorAll('.mobilede-result-article, .mobilede-tech-article').forEach(el => el.remove());
        const zielBereich = document.querySelector("article[data-testid='vip-key-features-box']");
        if (!zielBereich) return;

        injectResultStyles();
        const autoMode = isAutoModeEnabled();
        const gefundeneTexte = getResultEntries();

        const article = document.createElement('article');
        article.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-result-article';
        const ergebnisBereich = document.createElement('div');
        ergebnisBereich.id = 'ergebnisBereich';
        ergebnisBereich.className = 'mobilede-result-card';
        article.appendChild(ergebnisBereich);

        const title = document.createElement('div');
        title.className = 'mobilede-section-title';
        title.textContent = autoMode ? 'Ausstattung (vollständig):' : 'Gefundene Begriffe:';
        ergebnisBereich.appendChild(title);

        if (gefundeneTexte.length > 0) {
            const favKeys = getFavoriteAnzeigeKeys(suchKonfigurationen);
            const favCount = gefundeneTexte.filter(i =>
                favKeys.has((i.anzeige || '').trim().toLowerCase())).length;
            const columns = document.createElement('div');
            columns.className = 'mobilede-result-grid';

            gefundeneTexte.forEach((item, index) => {
                if (index === 0 && favCount > 0) {
                    const favTitle = document.createElement('div');
                    favTitle.className = 'mobilede-subsection-title';
                    favTitle.textContent = 'Favoriten';
                    columns.appendChild(favTitle);
                }
                if (favCount > 0 && favCount < gefundeneTexte.length && index === favCount) {
                    const divider = document.createElement('div');
                    divider.className = 'mobilede-result-fav-divider';
                    divider.setAttribute('aria-hidden', 'true');
                    columns.appendChild(divider);
                }
                appendResultRow(columns, item, autoMode);
            });
            ergebnisBereich.appendChild(columns);

            const legendParts = [];
            if (autoMode) {
                legendParts.push('Grau = nur auf der Seite gefunden · Farbig = in deiner Konfiguration erkannt · (inaktiv) = Eintrag vorhanden, aber deaktiviert');
            }
            const hasLow = gefundeneTexte.some(i => i.confidence === 'low');
            if (hasLow) {
                legendParts.push('* = nur in Beschreibungstext gefunden (geringere Sicherheit)');
            }
            if (legendParts.length > 0) {
                const legend = document.createElement('div');
                legend.className = 'mobilede-result-legend';
                legend.textContent = legendParts.join(' · ');
                ergebnisBereich.appendChild(legend);
            }
        } else {
            const keine = document.createElement('div');
            keine.className = 'mobilede-result-empty';
            keine.textContent = autoMode
                ? 'Keine Ausstattungseinträge auf der Seite gefunden.'
                : 'Keine der gesuchten Begriffe gefunden.';
            ergebnisBereich.appendChild(keine);
        }

        zielBereich.parentNode.insertBefore(article, zielBereich.nextSibling);
        technischeDatenHinzufuegen(article);
    }

    function clearResults() {
        document.querySelectorAll('.mobilede-result-article, .mobilede-tech-article').forEach(el => el.remove());
    }

    // ============================================================
    // 9b) Preisbewertung (Ausstattungs-Korrektur)
    // ============================================================
    function isPriceRatingDebugEnabled() {
        return isDebugEnabled('price');
    }

    function priceRatingDebugLog(...args) {
        if (!isPriceRatingDebugEnabled()) return;
        debugLog('price', ...args);
    }

    function isPriceRatingPerfDebugEnabled() {
        return isDebugEnabled('perf');
    }

    function pricePerfMarkStart() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
    }

    function pricePerfMarkEnd(label, startMs, warnMs) {
        const end = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        const duration = Math.round((end - startMs) * 10) / 10;
        if (isPriceRatingPerfDebugEnabled()) {
            const level = duration >= (warnMs || 50) ? 'warn' : 'info';
            const prefix = DEBUG_SCOPE_PREFIX.perf || '[mobilede Perf]';
            console[level](prefix, label, duration + 'ms');
        }
        return duration;
    }

    function isVehicleDetailPage() {
        return /\/fahrzeuge\/details\.html/.test(location.pathname)
            || /\/auto-inserat\//.test(location.pathname);
    }

    function getAdIdFromUrl(href) {
        const u = new URL(href || location.href);
        const id = u.searchParams.get('id');
        if (id) return String(id);
        const m = u.pathname.match(/\/auto-inserat\/([^/]+)/);
        return m ? m[1] : null;
    }

    function getUnsafeWindow() {
        try {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        } catch (e) {
            return window;
        }
    }

    function getPageInitialState() {
        try {
            const st = getUnsafeWindow().__INITIAL_STATE__;
            return st && typeof st === 'object' ? st : null;
        } catch (e) {
            return null;
        }
    }

    function getVipAdFromState(adId) {
        const id = adId || getAdIdFromUrl();
        if (!id) return null;
        const state = getPageInitialState();
        const ad = state?.search?.vip?.ads?.[id]?.data?.ad;
        return ad || null;
    }

    function parseEuroAmount(str) {
        if (str == null) return null;
        if (typeof str === 'number' && !Number.isNaN(str)) return str;
        const m = String(str).replace(/\s/g, '').replace(/\./g, '').replace(',', '.').match(/([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
    }

    function parseKm(str) {
        if (!str) return null;
        const m = String(str).replace(/\s/g, '').match(/([\d.]+)/);
        return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
    }

    function parseYear(str) {
        if (!str) return null;
        const m = String(str).match(/(19|20)\d{2}/);
        return m ? parseInt(m[0], 10) : null;
    }

    /** mobile.de pw-Parameter = Leistung in kW (nicht PS). */
    const PS_TO_KW = 0.73549875;

    function parsePower(str) {
        if (str == null || str === '') return { kw: null, ps: null };
        const s = String(str);
        const kwM = s.match(/([\d.,]+)\s*kW/i);
        const psM = s.match(/(\d+)\s*PS/i);
        let kw = kwM ? parseInt(kwM[1].replace(/[.,]/g, ''), 10) : null;
        let ps = psM ? parseInt(psM[1], 10) : null;
        if (kw == null && ps != null) kw = Math.round(ps * PS_TO_KW);
        if (ps == null && kw != null) ps = Math.round(kw / PS_TO_KW);
        return {
            kw: Number.isFinite(kw) && kw > 0 ? kw : null,
            ps: Number.isFinite(ps) && ps > 0 ? ps : null
        };
    }

    function parsePs(str) {
        return parsePower(str).ps;
    }

    function attrByTag(attributes, tag) {
        if (!Array.isArray(attributes)) return null;
        const a = attributes.find(x => x && x.tag === tag);
        return a ? a.value : null;
    }

    function resolveNumericId(v) {
        if (v == null || v === '') return null;
        const n = typeof v === 'number' ? v : parseInt(String(v), 10);
        return Number.isFinite(n) && n > 0 ? String(n) : null;
    }

    /** mobile.de ms-Parameter: makeId;modelId;modelGroupId; (numerische IDs, nicht Anzeigenamen). */
    function parseMsParam(ms) {
        if (!ms || typeof ms !== 'string') return null;
        const parts = ms.split(';');
        const makeId = (parts[0] || '').trim();
        if (!makeId || !/^\d+$/.test(makeId)) return null;
        const modelId = (parts[1] || '').trim();
        const modelGroupId = (parts[2] || '').trim();
        return {
            makeId,
            modelId: modelId && /^\d+$/.test(modelId) ? modelId : null,
            modelGroupId: modelGroupId && /^\d+$/.test(modelGroupId) ? modelGroupId : null
        };
    }

    function formatMsParam(makeId, modelId, modelGroupId) {
        const m = resolveNumericId(makeId);
        if (!m) return null;
        const mod = resolveNumericId(modelId);
        const grp = resolveNumericId(modelGroupId);
        if (mod) return m + ';' + mod + ';' + (grp || '') + ';';
        return m + ';;;';
    }

    function getMsFromPageUrl(href) {
        try {
            const u = new URL(href || location.href);
            return u.searchParams.get('ms');
        } catch (e) {
            return null;
        }
    }

    function extractIdsFromAd(ad) {
        if (!ad) return {};
        const makeId = resolveNumericId(
            ad.makeId ?? ad.make?.id ?? ad.make?.key ?? ad.vehicle?.makeId
        );
        const modelId = resolveNumericId(
            ad.modelId ?? ad.model?.id ?? ad.model?.key ?? ad.vehicle?.modelId
        );
        const modelGroupId = resolveNumericId(
            ad.modelGroupId ?? ad.modelGroup?.id ?? ad.vehicle?.modelGroupId
        );
        return { makeId, modelId, modelGroupId };
    }

    function normalizeMakeModelLabel(s) {
        return cleanText(s || '').replace(/\s+/g, ' ').trim();
    }

    function scoreMakeModelLabelMatch(label, target) {
        const l = normalizeMakeModelLabel(label);
        const t = normalizeMakeModelLabel(target);
        if (!l || !t) return -1;
        if (l === t) return 1000;
        if (l.startsWith(t)) return 500 + t.length;
        if (t.startsWith(l)) return 100 + l.length;
        return -1;
    }

    function matchSelectOptionValue(selectEl, target) {
        if (!selectEl || !target) return null;
        let best = null;
        let bestScore = -1;
        for (const opt of selectEl.options) {
            if (!opt.value) continue;
            const score = scoreMakeModelLabelMatch(opt.textContent, target);
            if (score > bestScore) {
                bestScore = score;
                best = opt.value;
            }
        }
        return bestScore >= 100 ? best : null;
    }

    function readMakeModelCache(makeId) {
        try {
            const raw = sessionStorage.getItem(MAKE_MODEL_CACHE_PREFIX + makeId);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeMakeModelCache(makeId, map) {
        try {
            sessionStorage.setItem(MAKE_MODEL_CACHE_PREFIX + makeId, JSON.stringify(map));
        } catch (e) { /* noop */ }
    }

    function readAdMakeModelCache(adId) {
        if (!adId) return null;
        try {
            const raw = sessionStorage.getItem(MAKE_MODEL_AD_CACHE_PREFIX + adId);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeAdMakeModelCache(adId, data) {
        if (!adId || !data) return;
        try {
            sessionStorage.setItem(MAKE_MODEL_AD_CACHE_PREFIX + adId, JSON.stringify(data));
        } catch (e) { /* noop */ }
    }

    function modelIdFromCache(map, modelName) {
        if (!map || !modelName) return null;
        const target = normalizeMakeModelLabel(modelName);
        let best = null;
        let bestScore = -1;
        for (const [label, id] of Object.entries(map)) {
            const score = scoreMakeModelLabelMatch(label, target);
            if (score > bestScore) {
                bestScore = score;
                best = id;
            }
        }
        return bestScore >= 100 ? best : null;
    }

    /** Lädt Modell-Optionen für Marke (select[name=md]) – IDs wie auf mobile.de-Suche. */
    function loadModelOptionsForMakeId(makeId) {
        const cached = readMakeModelCache(makeId);
        if (cached && Object.keys(cached).length > 2) {
            return Promise.resolve(cached);
        }
        return new Promise(resolve => {
            const mk = document.querySelector('select[name="mk"]');
            const md = document.querySelector('select[name="md"]');
            if (!mk || !md) {
                resolve(null);
                return;
            }
            const collect = () => {
                const map = {};
                for (const opt of md.options) {
                    if (!opt.value) continue;
                    const label = (opt.textContent || '').trim();
                    if (label) map[label] = opt.value;
                }
                if (Object.keys(map).length < 2) return null;
                writeMakeModelCache(makeId, map);
                return map;
            };
            if (mk.value === String(makeId) && md.options.length > 2) {
                resolve(collect());
                return;
            }
            mk.value = String(makeId);
            mk.dispatchEvent(new Event('change', { bubbles: true }));
            let tries = 0;
            const poll = () => {
                const map = collect();
                if (map) {
                    resolve(map);
                    return;
                }
                if (++tries > 40) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, 100);
            };
            poll();
        });
    }

    function applyMakeModelIdsToProfile(profile, makeId, modelId, modelGroupId) {
        if (!profile) return profile;
        if (makeId) profile.makeId = String(makeId);
        if (modelId) profile.modelId = String(modelId);
        if (modelGroupId) profile.modelGroupId = String(modelGroupId);
        profile.searchMs = formatMsParam(profile.makeId, profile.modelId, profile.modelGroupId) || profile.searchMs || '';
        return profile;
    }

    async function resolveMakeModelIdsForProfile(profile) {
        if (!profile) return profile;
        const adId = profile.id;
        const cachedAd = readAdMakeModelCache(adId);
        if (cachedAd && cachedAd.makeId) {
            return applyMakeModelIdsToProfile(profile, cachedAd.makeId, cachedAd.modelId, cachedAd.modelGroupId);
        }

        const pageMs = getMsFromPageUrl();
        if (pageMs) {
            const parsed = parseMsParam(pageMs);
            if (parsed) {
                applyMakeModelIdsToProfile(profile, parsed.makeId, parsed.modelId, parsed.modelGroupId);
                writeAdMakeModelCache(adId, {
                    makeId: profile.makeId,
                    modelId: profile.modelId,
                    modelGroupId: profile.modelGroupId,
                    searchMs: profile.searchMs
                });
                return profile;
            }
        }

        const fromAd = extractIdsFromAd(getVipAdFromState(adId));
        if (fromAd.makeId) {
            applyMakeModelIdsToProfile(profile, fromAd.makeId, fromAd.modelId, fromAd.modelGroupId);
            writeAdMakeModelCache(adId, {
                makeId: profile.makeId,
                modelId: profile.modelId,
                modelGroupId: profile.modelGroupId,
                searchMs: profile.searchMs
            });
            return profile;
        }

        if (profile.makeId && profile.modelId) {
            profile.searchMs = formatMsParam(profile.makeId, profile.modelId, profile.modelGroupId) || profile.searchMs;
            return profile;
        }

        let makeId = profile.makeId || matchSelectOptionValue(document.querySelector('select[name="mk"]'), profile.make);
        if (!makeId) return profile;

        let modelId = profile.modelId
            || matchSelectOptionValue(document.querySelector('select[name="md"]'), profile.model);
        if (!modelId && profile.model) {
            const map = await loadModelOptionsForMakeId(makeId);
            modelId = modelIdFromCache(map, profile.model);
        }

        applyMakeModelIdsToProfile(profile, makeId, modelId, profile.modelGroupId);
        writeAdMakeModelCache(adId, {
            makeId: profile.makeId,
            modelId: profile.modelId,
            modelGroupId: profile.modelGroupId,
            searchMs: profile.searchMs
        });
        return profile;
    }

    function enrichProfileWithSearchMs(profile, adId) {
        if (!profile) return profile;
        const cachedAd = readAdMakeModelCache(adId || profile.id);
        if (cachedAd && cachedAd.makeId) {
            return applyMakeModelIdsToProfile(profile, cachedAd.makeId, cachedAd.modelId, cachedAd.modelGroupId);
        }
        const fromAd = extractIdsFromAd(getVipAdFromState(adId || profile.id));
        if (fromAd.makeId) {
            applyMakeModelIdsToProfile(profile, fromAd.makeId, fromAd.modelId, fromAd.modelGroupId);
            return profile;
        }
        const pageMs = getMsFromPageUrl();
        if (pageMs) {
            const parsed = parseMsParam(pageMs);
            if (parsed) {
                applyMakeModelIdsToProfile(profile, parsed.makeId, parsed.modelId, parsed.modelGroupId);
                return profile;
            }
        }
        const mk = document.querySelector('select[name="mk"]');
        const md = document.querySelector('select[name="md"]');
        const makeId = matchSelectOptionValue(mk, profile.make);
        const modelId = matchSelectOptionValue(md, profile.model);
        if (makeId || modelId) {
            applyMakeModelIdsToProfile(profile, makeId || profile.makeId, modelId || profile.modelId, profile.modelGroupId);
        }
        return profile;
    }

    function buildVehicleProfileFromAd(ad, adId) {
        if (!ad) return null;
        const attrs = ad.attributes || [];
        const ids = extractIdsFromAd(ad);
        const power = parsePower(attrByTag(attrs, 'power'));
        return {
            id: String(adId || ad.id || getAdIdFromUrl() || ''),
            make: ad.make || '',
            model: ad.model || '',
            makeId: ids.makeId || '',
            modelId: ids.modelId || '',
            modelGroupId: ids.modelGroupId || '',
            searchMs: formatMsParam(ids.makeId, ids.modelId, ids.modelGroupId) || '',
            modelRange: attrByTag(attrs, 'modelRange') || '',
            trimLine: attrByTag(attrs, 'trimLine') || '',
            title: ad.title || '',
            subTitle: ad.subTitle || '',
            priceGross: ad.price?.grossAmount ?? parseEuroAmount(ad.price?.gross),
            mileageKm: parseKm(attrByTag(attrs, 'mileage')),
            firstRegistrationYear: parseYear(attrByTag(attrs, 'firstRegistration')),
            powerKw: power.kw,
            powerPs: power.ps,
            fuel: attrByTag(attrs, 'fuel') || '',
            transmission: attrByTag(attrs, 'transmission') || '',
            category: attrByTag(attrs, 'category') || '',
            features: Array.isArray(ad.features) ? ad.features : [],
            priceRating: ad.priceRating || null,
            attributes: attrs
        };
    }

    /**
     * Anker für VIP-Preisbewertung: Sidebar-Preiszeile (48.950 € / Guter Preis),
     * nicht die ausführliche Preis-Box weiter unten mit Finanzierung.
     */
    function getVipPriceRatingAnchor() {
        const aside = document.querySelector('aside.iKWwq');
        if (aside) {
            const row = aside.querySelector('.wNWsk');
            if (row) return row;
            const label = aside.querySelector('[data-testid="vip-price-label"]');
            if (label) {
                return label.closest('.wNWsk') || label.parentElement || label;
            }
        }
        return document.querySelector('[data-testid="vip-price-box"]');
    }

    function buildVehicleProfileDomFallback() {
        const id = getAdIdFromUrl();
        const aside = document.querySelector('aside.iKWwq');
        const priceEl = (aside && aside.querySelector('[data-testid="vip-price-label"]'))
            || document.querySelector('[data-testid="vip-price-label"]');
        const priceGross = priceEl ? parseEuroAmount(priceEl.textContent) : null;
        const techDl = getTechDataDl();
        const attrs = {};
        if (techDl) {
            techDl.querySelectorAll('dt').forEach(dt => {
                const dd = dt.nextElementSibling;
                if (dd) attrs[dt.textContent.trim()] = dd.textContent.trim();
            });
        }
        const h = document.querySelector('h1, h2');
        const power = parsePower(attrs['Leistung']);
        return {
            id: id || '',
            make: '',
            model: '',
            modelRange: attrs['Baureihe'] || '',
            trimLine: attrs['Ausstattungslinie'] || '',
            title: h ? h.textContent.trim() : '',
            subTitle: '',
            priceGross,
            mileageKm: parseKm(attrs['Kilometerstand']),
            firstRegistrationYear: parseYear(attrs['Erstzulassung']),
            powerKw: power.kw,
            powerPs: power.ps,
            fuel: attrs['Kraftstoffart'] || '',
            transmission: attrs['Getriebe'] || '',
            category: attrs['Kategorie'] || '',
            features: getFeatureItems().map(li => li.textContent.trim()),
            priceRating: null,
            attributes: []
        };
    }

    let vehicleProfileMemo = { key: '', ts: 0, profile: null };

    function getVehicleProfileMemoKey(adId) {
        const id = adId || getAdIdFromUrl() || '';
        const cfg = getPriceRating(featureFlags);
        const desc = isVehicleDetailPage() && getDescriptionEl()
            ? (getDescriptionEl().textContent || '').length
            : 0;
        return [
            location.pathname,
            id,
            cfg.onlyFavoriteWeights ? 1 : 0,
            cfg.kmToleranceAbs,
            cfg.yearTolerance,
            cfg.powerToleranceKw,
            desc
        ].join('|');
    }

    function buildVehicleProfile(adId) {
        const memoKey = getVehicleProfileMemoKey(adId);
        const now = Date.now();
        if (vehicleProfileMemo.key === memoKey && (now - vehicleProfileMemo.ts) < 1200) {
            return vehicleProfileMemo.profile ? { ...vehicleProfileMemo.profile } : null;
        }
        const id = adId || getAdIdFromUrl();
        const ad = getVipAdFromState(id);
        let profile = null;
        if (ad) profile = buildVehicleProfileFromAd(ad, id);
        else if (isVehicleDetailPage()) profile = buildVehicleProfileDomFallback();
        const enriched = enrichProfileWithSearchMs(profile, id);
        vehicleProfileMemo = { key: memoKey, ts: now, profile: enriched ? { ...enriched } : null };
        return enriched;
    }

    function getPreisGewichtForConfig(cfg, prCfg) {
        if (!cfg) return 0;
        const pr = prCfg || getPriceRating(featureFlags);
        if (pr.onlyFavoriteWeights && cfg.favorit !== true) return 0;
        const w = cfg.preisGewicht;
        if (typeof w === 'number' && w > 0) return w;
        const key = (cfg.anzeige || '').trim().toLowerCase();
        return DEFAULT_PREIS_GEWICHT_BY_ANZEIGE[key] || 0;
    }

    function matchTitleTokensToConfigs(text, configs, keys, breakdown) {
        if (!text) return;
        const parts = String(text).split(/[+/,·|]/).map(s => s.trim()).filter(Boolean);
        const blob = cleanText(text);
        configs.forEach(cfg => {
            if (!cfg.aktiv) return;
            if (cfg.nurInFeatures === true) return;
            const key = (cfg.anzeige || '').trim().toLowerCase();
            if (!key || keys.has(key)) return;
            const weight = getPreisGewichtForConfig(cfg);
            if (weight <= 0) return;
            let hit = false;
            for (const b of (cfg.begriffe || [])) {
                const bt = cleanText(b);
                if (!bt || bt.length < 2) continue;
                if (blob.includes(bt)) { hit = true; break; }
                for (const p of parts) {
                    if (cleanText(p).includes(bt) || bt.includes(cleanText(p))) {
                        hit = true;
                        break;
                    }
                }
                if (hit) break;
            }
            if (!hit) return;
            keys.add(key);
            breakdown.push({
                key,
                label: cfg.anzeige,
                weight,
                source: 'title'
            });
        });
    }

    function equipmentFingerprintForTexts(texts, configs) {
        const keys = new Set();
        const breakdown = [];
        const sources = [];
        if (texts.titleBlob) {
            sources.push({
                id: 'title',
                confidence: 'high',
                text: texts.titleBlob,
                tokens: tokenize(texts.titleBlob)
            });
        }
        if (texts.featuresText) {
            sources.push({
                id: 'features',
                confidence: 'high',
                text: texts.featuresText,
                tokens: tokenize(texts.featuresText)
            });
        }
        if (texts.descriptionText) {
            const conf = classifyDescription(texts.descriptionText);
            sources.push({
                id: 'description',
                confidence: conf,
                text: texts.descriptionText.replace(/,/g, ' '),
                tokens: tokenize(texts.descriptionText)
            });
        }
        const hits = collectConfigMatches(sources, configs);
        hits.forEach(hit => {
            const cfg = configs.find(c => cleanText(c.anzeige) === cleanText(hit.anzeige));
            const key = (hit.anzeige || '').trim().toLowerCase();
            if (!key || keys.has(key)) return;
            const weight = getPreisGewichtForConfig(cfg);
            if (weight <= 0) return;
            keys.add(key);
            breakdown.push({
                key,
                label: hit.anzeige,
                weight,
                source: hit.source || 'match'
            });
        });
        matchTitleTokensToConfigs(texts.titleBlob || '', configs, keys, breakdown);
        const score = breakdown.reduce((s, b) => s + b.weight, 0);
        return { keys, score, breakdown };
    }

    function equipmentFingerprintFromProfile(profile) {
        const configs = suchKonfigurationen;
        if (isVehicleDetailPage() && document.querySelector('[data-testid="vip-features-list"]')) {
            const rawItems = extractRawEquipmentItems();
            const keys = new Set();
            const breakdown = [];
            rawItems.forEach(raw => {
                const cfg = findConfigEntryForRawLabel(raw.label);
                if (!cfg || !cfg.aktiv) return;
                const key = (cfg.anzeige || '').trim().toLowerCase();
                if (!key || keys.has(key)) return;
                const weight = getPreisGewichtForConfig(cfg);
                if (weight <= 0) return;
                keys.add(key);
                breakdown.push({
                    key,
                    label: cfg.anzeige,
                    weight,
                    source: raw.source || 'features'
                });
            });
            matchTitleTokensToConfigs(
                [profile.title, profile.subTitle].filter(Boolean).join(' '),
                configs,
                keys,
                breakdown
            );
            const score = breakdown.reduce((s, b) => s + b.weight, 0);
            return { keys, score, breakdown };
        }
        const featuresText = (profile.features || []).join(' | ');
        const descEl = isVehicleDetailPage() ? getDescriptionEl() : null;
        const descriptionText = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';
        return equipmentFingerprintForTexts({
            titleBlob: [profile.title, profile.subTitle].filter(Boolean).join(' '),
            featuresText,
            descriptionText
        }, configs);
    }

    function profileFromComparableAd(ad) {
        if (!ad) return null;
        const id = ad.id || ad.adId;
        return buildVehicleProfileFromAd(ad, id);
    }

    function buildCohortSearchUrl(profile, prCfg) {
        const useModelRange = !prCfg || prCfg.useModelRange !== false;
        const u = new URL('https://suchen.mobile.de/fahrzeuge/search.html');
        u.searchParams.set('isSearchRequest', 'true');
        u.searchParams.set('scopeId', 'C');
        u.searchParams.set('vc', 'Car');
        u.searchParams.set('s', 'Car');
        u.searchParams.set('dam', 'false');
        const modelGroupId = useModelRange ? profile.modelGroupId : null;
        const ms = useModelRange
            ? (profile.searchMs || formatMsParam(profile.makeId, profile.modelId, modelGroupId))
            : formatMsParam(profile.makeId, profile.modelId, null);
        if (ms) {
            u.searchParams.set('ms', ms);
        } else if (profile.makeId) {
            u.searchParams.set('mk', profile.makeId);
            if (profile.modelId) u.searchParams.set('md', profile.modelId);
        } else if (profile.make && profile.model) {
            u.searchParams.set('userInput', (profile.make + ' ' + profile.model).trim());
        } else if (profile.make) {
            u.searchParams.set('userInput', profile.make.trim());
        }
        if (profile.mileageKm != null) {
            const tolKm = Math.max(0, parseInt(prCfg.kmToleranceAbs, 10) || 0);
            const min = Math.max(0, Math.floor(profile.mileageKm - tolKm));
            const max = Math.ceil(profile.mileageKm + tolKm);
            u.searchParams.set('ml', min + ':' + max);
        }
        if (profile.firstRegistrationYear != null) {
            const yTol = prCfg.yearTolerance || 1;
            const yMin = profile.firstRegistrationYear - yTol;
            const yMax = profile.firstRegistrationYear + yTol;
            u.searchParams.set('fr', yMin + ':' + yMax);
        }
        const powerKw = profile.powerKw != null
            ? profile.powerKw
            : (profile.powerPs != null ? Math.round(profile.powerPs * PS_TO_KW) : null);
        if (powerKw != null) {
            const pTolKw = Math.max(0, parseInt(prCfg.powerToleranceKw, 10) || 0);
            const pMin = Math.max(1, Math.floor(powerKw - pTolKw));
            const pMax = Math.ceil(powerKw + pTolKw);
            u.searchParams.set('pw', pMin + ':' + pMax);
        }
        return u.toString();
    }

    /** Gleiche Filter-Mitten wie in buildCohortSearchUrl / profileFromSearchPageUrl (Cache-Treffer VIP ↔ SRP). */
    function profileForCohortCacheKey(profile, prCfg) {
        const pr = prCfg || getPriceRating(featureFlags);
        const useModelRange = pr.useModelRange !== false;
        const useMileage = pr.keyUseMileage !== false;
        const useYear = pr.keyUseYear !== false;
        const usePower = pr.keyUsePower !== false;
        const kmBucket = Math.max(500, parseInt(pr.keyKmBucket, 10) || 5000);
        const yearBucketRaw = Math.max(1, parseInt(pr.keyYearBucket, 10) || 1);
        const yearTol = Math.max(0, parseInt(pr.yearTolerance, 10) || 0);
        // Respect EZ tolerance in cache matching: with ±1 years, 2022 and 2023 should map together.
        const yearBucket = Math.max(yearBucketRaw, (yearTol * 2) + 1);
        const powerBucket = Math.max(1, parseInt(pr.keyPowerBucket, 10) || 10);
        const p = {
            makeId: profile.makeId || '',
            modelId: profile.modelId || '',
            make: profile.make || '',
            model: profile.model || '',
            modelRange: useModelRange ? (profile.modelRange || '') : '',
            mileageKm: useMileage ? profile.mileageKm : null,
            firstRegistrationYear: useYear ? profile.firstRegistrationYear : null,
            powerKw: usePower ? profile.powerKw : null,
            powerPs: usePower ? profile.powerPs : null
        };
        if (p.mileageKm != null) {
            const tolKm = Math.max(0, parseInt(pr.kmToleranceAbs, 10) || 0);
            const min = Math.max(0, Math.floor(p.mileageKm - tolKm));
            const max = Math.ceil(p.mileageKm + tolKm);
            const mid = Math.round((min + max) / 2);
            p.mileageKm = Math.round(mid / kmBucket) * kmBucket;
        }
        if (p.firstRegistrationYear != null) {
            p.firstRegistrationYear = Math.floor(p.firstRegistrationYear / yearBucket) * yearBucket;
        }
        if (p.powerKw == null && p.powerPs != null) {
            p.powerKw = Math.round(p.powerPs * PS_TO_KW);
        }
        if (p.powerKw != null) {
            const pTolKw = Math.max(0, parseInt(pr.powerToleranceKw, 10) || 0);
            const min = Math.max(1, Math.floor(p.powerKw - pTolKw));
            const max = Math.ceil(p.powerKw + pTolKw);
            const mid = Math.round((min + max) / 2);
            p.powerKw = Math.round(mid / powerBucket) * powerBucket;
            p.powerPs = null;
        }
        return p;
    }

    function cohortCacheKey(profile, prCfg) {
        const p = profileForCohortCacheKey(profile, prCfg);
        return [
            p.makeId || p.make,
            p.modelId || p.model,
            p.modelRange,
            p.mileageKm,
            p.firstRegistrationYear,
            p.powerKw || p.powerPs
        ].join('|').toLowerCase();
    }

    function cohortHumanLabel(profile, prCfg) {
        if (!profile) return null;
        const p = profileForCohortCacheKey(profile, prCfg);
        const model = [p.make || p.makeId || '', p.model || p.modelId || '']
            .filter(Boolean)
            .join(' ')
            .trim();
        const parts = [];
        if (model) parts.push(model);
        if (typeof p.firstRegistrationYear === 'number') parts.push('EZ-Bucket ' + p.firstRegistrationYear);
        if (typeof p.mileageKm === 'number') parts.push('km-Bucket ' + p.mileageKm.toLocaleString('de-DE'));
        if (typeof p.powerKw === 'number') parts.push('kW-Bucket ' + p.powerKw);
        return parts.join(' | ');
    }

    function cohortCacheStorageKey(key) {
        return PRICE_COHORT_CACHE_PREFIX + key;
    }

    function readCohortCache(key) {
        const storageKey = cohortCacheStorageKey(key);
        try {
            let raw = localStorage.getItem(storageKey);
            if (!raw) {
                raw = sessionStorage.getItem(storageKey);
                if (raw) {
                    try {
                        localStorage.setItem(storageKey, raw);
                        sessionStorage.removeItem(storageKey);
                    } catch (e) { /* noop */ }
                }
            }
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - parsed.ts > PRICE_COHORT_CACHE_TTL_MS) return null;
            return parsed.items || null;
        } catch (e) {
            return null;
        }
    }

    function notifyCohortCacheUpdated() {
        try {
            localStorage.setItem(PRICE_COHORT_CACHE_PREFIX + '_updated', String(Date.now()));
        } catch (e) { /* noop */ }
    }

    function writeCohortCache(key, items) {
        try {
            localStorage.setItem(cohortCacheStorageKey(key), JSON.stringify({
                ts: Date.now(),
                items
            }));
            notifyCohortCacheUpdated();
        } catch (e) { /* noop */ }
    }

    function vipEquipCacheStorageKey(adId) {
        return PRICE_VIP_EQUIP_CACHE_PREFIX + String(adId || '');
    }

    function readVipEquipCache(adId) {
        if (!adId) return null;
        try {
            const raw = localStorage.getItem(vipEquipCacheStorageKey(adId));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.equipment || typeof parsed.equipment.score !== 'number') return null;
            if (Date.now() - (parsed.ts || 0) > PRICE_COHORT_CACHE_TTL_MS) return null;
            return parsed.equipment;
        } catch (e) {
            return null;
        }
    }

    function writeVipEquipCache(adId, equipment) {
        if (!adId || !equipment || typeof equipment.score !== 'number') return;
        try {
            localStorage.setItem(vipEquipCacheStorageKey(adId), JSON.stringify({
                ts: Date.now(),
                equipment: {
                    score: equipment.score,
                    breakdown: Array.isArray(equipment.breakdown) ? equipment.breakdown : []
                }
            }));
        } catch (e) { /* noop */ }
    }

    function profileFromSearchPageUrl(href) {
        try {
            const u = new URL(href, location.origin);
            if (!/\/fahrzeuge\/search\.html/.test(u.pathname)) return null;
            const p = {
                make: '',
                model: '',
                makeId: '',
                modelId: '',
                modelGroupId: '',
                searchMs: '',
                modelRange: '',
                mileageKm: null,
                firstRegistrationYear: null,
                powerKw: null,
                powerPs: null,
                fuel: '',
                transmission: ''
            };
            const ms = u.searchParams.get('ms');
            if (ms) {
                p.searchMs = ms;
                const parsed = parseMsParam(ms);
                if (parsed) {
                    p.makeId = parsed.makeId;
                    p.modelId = parsed.modelId || '';
                    p.modelGroupId = parsed.modelGroupId || '';
                }
            }
            const midRange = param => {
                const v = u.searchParams.get(param);
                if (!v || !v.includes(':')) return null;
                const a = parseInt(v.split(':')[0], 10);
                const b = parseInt(v.split(':')[1], 10);
                if (Number.isNaN(a) || Number.isNaN(b)) return null;
                return Math.round((a + b) / 2);
            };
            p.mileageKm = midRange('ml');
            p.firstRegistrationYear = midRange('fr');
            p.powerKw = midRange('pw');
            return p;
        } catch (e) {
            return null;
        }
    }

    function parseCohortItemsFromState(state, excludeId) {
        const rawList = findSrpListingsInState(state);
        return rawList
            .map(normalizeComparableAd)
            .filter(Boolean)
            .filter(c => !excludeId || String(c.id) !== String(excludeId));
    }

    /**
     * Kohorte aus Suchergebnisliste (__INITIAL_STATE__) — kein fetch, kein VIP-Besuch.
     * Einzelne Inseratsseiten füllen den Cache nicht; Tab teilt localStorage.
     */
    function syncCohortCacheFromSearchPage() {
        if (!isSearchResultsPage()) return;
        const state = getPageInitialState();
        if (!state) {
            priceRatingDebugLog('SRP-Cache-Sync übersprungen: kein __INITIAL_STATE__');
            return;
        }
        const items = parseCohortItemsFromState(state, null);
        if (items.length < 5) {
            priceRatingDebugLog('SRP-Cache-Sync übersprungen: zu wenige SRP-Treffer', { count: items.length });
            return;
        }
        const prof = profileFromSearchPageUrl(location.href);
        const key = prof && (prof.makeId || prof.make || prof.modelId || prof.model)
            ? cohortCacheKey(prof)
            : null;
        if (key) {
            writeCohortCache(key, items);
            priceRatingDebugLog('Kohorte aus SRP gecacht', {
                cacheKey: key,
                count: items.length,
                vipDetails: countCohortVipDetailCount(items)
            });
            debugLog('ui', 'SRP-Kohorte in Cache synchronisiert', { cacheKey: key, count: items.length });
        } else {
            priceRatingDebugLog('SRP-Cache-Sync übersprungen: kein cacheKey aus URL ableitbar');
        }
    }

    function findSrpListingsInState(state) {
        if (!state || typeof state !== 'object') return [];
        const tryList = (v) => {
            if (!v) return [];
            if (Array.isArray(v)) return v;
            if (Array.isArray(v.items)) return v.items;
            if (Array.isArray(v.ads)) return v.ads;
            if (Array.isArray(v.results)) return v.results;
            if (Array.isArray(v.searchResults)) return v.searchResults;
            if (Array.isArray(v.listings)) return v.listings;
            if (typeof v === 'object') {
                const vals = Object.values(v);
                if (vals.length && vals.every(x => x && (x.id || x.ad || x.data))) {
                    return vals.map(x => x.ad || x.data?.ad || x);
                }
            }
            return [];
        };
        const explicitPaths = [
            state?.search?.srp?.ads,
            state?.search?.srp?.items,
            state?.search?.srp?.searchResults,
            state?.search?.srp?.results,
            state?.search?.srp?.resultList,
            state?.search?.srp?.listings,
            state?.search?.results,
            state?.search?.resultList,
            state?.search?.listings
        ];
        for (const p of explicitPaths) {
            const list = tryList(p);
            if (list.length >= 3) return list;
        }

        const isAdLike = (entry) => {
            if (!entry) return false;
            const ad = entry?.ad || entry?.data?.ad || entry;
            if (!ad || typeof ad !== 'object') return false;
            return !!(ad.id || ad.adId || ad.mobileAdId)
                && !!(ad.price || ad.prices || ad.make || ad.model || ad.title || ad.vehicleDescription);
        };

        let best = [];
        const queue = [state?.search?.srp, state?.search, state].filter(Boolean);
        const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
        let visited = 0;
        const MAX_OBJECTS = 4000;
        while (queue.length && visited < MAX_OBJECTS) {
            const cur = queue.shift();
            if (!cur || typeof cur !== 'object') continue;
            if (seen) {
                if (seen.has(cur)) continue;
                seen.add(cur);
            }
            visited += 1;
            const candidate = tryList(cur);
            if (candidate.length >= 3) {
                const adLikeCount = candidate.reduce((acc, x) => acc + (isAdLike(x) ? 1 : 0), 0);
                if (adLikeCount >= Math.max(3, Math.floor(candidate.length * 0.5))) {
                    if (adLikeCount > best.length) best = candidate;
                }
            }
            if (Array.isArray(cur)) {
                cur.forEach(v => {
                    if (v && typeof v === 'object') queue.push(v);
                });
            } else {
                Object.values(cur).forEach(v => {
                    if (v && typeof v === 'object') queue.push(v);
                });
            }
        }
        return best;
    }

    function normalizeComparableAd(raw) {
        const ad = raw?.ad || raw?.data?.ad || raw;
        if (!ad || !ad.price) return null;
        const price = ad.price.grossAmount ?? parseEuroAmount(ad.price.gross);
        if (price == null || price <= 0) return null;
        const prof = buildVehicleProfileFromAd(ad, ad.id);
        if (!prof) return null;
        const cachedEquip = readVipEquipCache(prof.id);
        if (cachedEquip) {
            prof.equipment = cachedEquip;
            prof.equipmentFromVipCache = true;
        } else {
            prof.equipment = equipmentFingerprintFromProfile(prof);
        }
        return prof;
    }

    function countCohortVipDetailCount(items) {
        return (items || []).filter(c => c && c.equipmentFromVipCache).length;
    }

    /** VIP-Besuch kann nach SRP-Cache kommen — beim Lesen erneut anreichern. */
    function enrichCohortItemsWithVipCache(items) {
        if (!Array.isArray(items)) return [];
        return items.map(c => {
            if (!c || !c.id) return c;
            const cachedEquip = readVipEquipCache(c.id);
            if (!cachedEquip) return c;
            return { ...c, equipment: cachedEquip, equipmentFromVipCache: true };
        });
    }

    const cohortComparablesMemo = new Map();
    const COHORT_COMPARABLES_MEMO_TTL_MS = 1500;

    function pruneCohortComparablesMemo(nowTs) {
        const now = nowTs || Date.now();
        cohortComparablesMemo.forEach((entry, key) => {
            if (!entry || typeof entry.ts !== 'number' || (now - entry.ts) >= COHORT_COMPARABLES_MEMO_TTL_MS) {
                cohortComparablesMemo.delete(key);
            }
        });
    }

    /** Kohorte nur aus localStorage-Cache oder aktueller Suchseite — kein Hintergrund-fetch. */
    function getCohortComparables(profile, prCfg) {
        const now = Date.now();
        pruneCohortComparablesMemo(now);
        const cacheKey = cohortCacheKey(profile, prCfg);
        const memo = cohortComparablesMemo.get(cacheKey);
        if (memo && (now - memo.ts) < COHORT_COMPARABLES_MEMO_TTL_MS) {
            priceRatingDebugLog('Kohorte aus Memo', {
                cacheKey,
                count: memo.value && memo.value.items ? memo.value.items.length : 0
            });
            return memo.value;
        }
        const cached = readCohortCache(cacheKey);
        if (cached && cached.length) {
            const items = enrichCohortItemsWithVipCache(cached);
            priceRatingDebugLog('Kohorte aus Cache', {
                cacheKey,
                count: items.length,
                vipDetails: countCohortVipDetailCount(items)
            });
            const out = { items, fromCache: true, cacheKey };
            cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
            return out;
        }

        if (isSearchResultsPage()) {
            const state = getPageInitialState();
            const fromPage = enrichCohortItemsWithVipCache(
                parseCohortItemsFromState(state, profile.id)
            );
            if (fromPage.length >= 5) {
                writeCohortCache(cacheKey, fromPage);
                priceRatingDebugLog('Kohorte von aktueller SRP', {
                    cacheKey,
                    count: fromPage.length,
                    vipDetails: countCohortVipDetailCount(fromPage)
                });
                const out = { items: fromPage, fromCache: false, fromPage: true, cacheKey };
                cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
                return out;
            }
            priceRatingDebugLog('SRP ohne ausreichend Treffer', { cacheKey, count: fromPage.length });
        }

        priceRatingDebugLog('Keine Kohorte — Vergleichssuche nötig', { cacheKey });
        const out = { items: [], needsManualSearch: true, cacheKey };
        cohortComparablesMemo.set(cacheKey, { ts: Date.now(), value: out });
        return out;
    }

    async function openCohortSearchTab(profile) {
        const resolved = await resolveMakeModelIdsForProfile(profile || buildVehicleProfile());
        const url = buildCohortSearchUrl(resolved, getPriceRating(featureFlags));
        window.open(url, '_blank', 'noopener');
    }

    function median(nums) {
        const arr = nums.filter(n => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
        if (!arr.length) return null;
        const mid = Math.floor(arr.length / 2);
        return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }

    function mobileMarketPriceFromRating(priceRating) {
        if (!priceRating) return null;
        const labels = priceRating.thresholdLabels;
        if (!Array.isArray(labels) || labels.length < 2) return null;
        const amounts = labels.map(parseEuroAmount).filter(n => n != null);
        if (amounts.length < 2) return null;
        const offset = typeof priceRating.vehiclePriceOffset === 'number'
            ? priceRating.vehiclePriceOffset
            : 50;
        const t = Math.max(0, Math.min(1, offset / 100));
        const min = amounts[0];
        const max = amounts[amounts.length - 1];
        return min + (max - min) * t;
    }

    function clampAdjust(base, delta, maxPct) {
        const cap = base * (maxPct || 0.12);
        if (delta > cap) return cap;
        if (delta < -cap) return -cap;
        return delta;
    }

    function deviationToLevel(devPct, thresholds) {
        const th = thresholds || PRICE_RATING_DEFAULT.thresholds;
        for (let i = 0; i < th.length; i++) {
            if (devPct <= th[i].maxPct) {
                return th[i].level;
            }
        }
        return 4;
    }

    function computePriceRating(profile, comparables, options) {
        const prCfg = getPriceRating(featureFlags);
        const ownEquip = options?.equipment || equipmentFingerprintFromProfile(profile);
        const ownScore = ownEquip.score;
        const price = profile.priceGross;
        priceRatingDebugLog('Preisbewertung Start', {
            adId: profile && profile.id,
            price,
            ownScore,
            comparables: Array.isArray(comparables) ? comparables.length : 0,
            minComparables: prCfg.minComparables,
            punktZuEuro: prCfg.punktZuEuro,
            maxAdjustPct: prCfg.maxAdjustPct,
            useModelRange: prCfg.useModelRange !== false,
            keyUseMileage: prCfg.keyUseMileage !== false,
            keyUseYear: prCfg.keyUseYear !== false,
            keyUsePower: prCfg.keyUsePower !== false,
            keyKmBucket: prCfg.keyKmBucket,
            keyYearBucket: prCfg.keyYearBucket,
            keyPowerBucket: prCfg.keyPowerBucket,
            kmToleranceAbs: prCfg.kmToleranceAbs,
            yearTolerance: prCfg.yearTolerance,
            powerToleranceKw: prCfg.powerToleranceKw
        });
        if (price == null || price <= 0) {
            priceRatingDebugLog('Preisbewertung Abbruch: kein Preis', { adId: profile && profile.id, price });
            return { ok: false, reason: 'no_price' };
        }

        let basePrice = null;
        let cohortCount = 0;
        let usedMobileFallback = false;
        const equipScores = (comparables || []).map(c => (c.equipment && c.equipment.score) || 0);
        const prices = (comparables || []).map(c => c.priceGross).filter(n => n > 0);

        if (prices.length >= prCfg.minComparables) {
            basePrice = median(prices);
            cohortCount = prices.length;
            priceRatingDebugLog('Baseline aus Kohorte', { cohortCount, basePrice: Math.round(basePrice || 0) });
        } else if (prCfg.mobileFallback && profile.priceRating) {
            basePrice = mobileMarketPriceFromRating(profile.priceRating);
            usedMobileFallback = true;
            cohortCount = prices.length;
            priceRatingDebugLog('Baseline aus mobile-Fallback', {
                cohortCount,
                mobileLabel: profile.priceRating?.ratingLabel || null,
                basePrice: Math.round(basePrice || 0)
            });
        } else if (prices.length >= 5) {
            basePrice = median(prices);
            cohortCount = prices.length;
            usedMobileFallback = true;
            priceRatingDebugLog('Baseline aus kleiner Kohorte (Fallback-Flag)', { cohortCount, basePrice: Math.round(basePrice || 0) });
        }

        if (basePrice == null || basePrice <= 0) {
            priceRatingDebugLog('Preisbewertung Abbruch: keine Baseline', {
                adId: profile && profile.id,
                cohortCount: prices.length,
                mobileFallback: prCfg.mobileFallback
            });
            return { ok: false, reason: 'no_baseline', cohortCount: prices.length };
        }

        const medianEquip = equipScores.length ? median(equipScores) : 0;
        const equipDelta = ownScore - (medianEquip || 0);
        const rawAdjust = equipDelta * prCfg.punktZuEuro;
        const adjust = clampAdjust(basePrice, rawAdjust, prCfg.maxAdjustPct);
        const adjustedExpected = basePrice + adjust;
        const devPct = (price - adjustedExpected) / adjustedExpected;
        const level = deviationToLevel(devPct, prCfg.thresholds);
        const label = (PRICE_RATING_LEVELS[level] && PRICE_RATING_LEVELS[level].label) || 'Fairer Preis';
        priceRatingDebugLog('Preisbewertung Rechenweg', {
            basePrice: Math.round(basePrice),
            ownScore,
            medianEquip,
            equipDelta,
            rawAdjust: Math.round(rawAdjust),
            adjustEuro: Math.round(adjust),
            adjustedExpected: Math.round(adjustedExpected),
            devPct: Math.round(devPct * 10000) / 100,
            level,
            label
        });

        const minP = prices.length ? Math.min(...prices) : basePrice * 0.85;
        const maxP = prices.length ? Math.max(...prices) : basePrice * 1.15;
        const span = maxP - minP || 1;
        const offset = Math.max(0, Math.min(100, Math.round(((price - minP) / span) * 100)));

        const topBreakdown = [...ownEquip.breakdown]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 5);

        return {
            ok: true,
            label,
            level,
            offset,
            price,
            basePrice: Math.round(basePrice),
            adjustedExpected: Math.round(adjustedExpected),
            devPct,
            devEuro: Math.round(price - adjustedExpected),
            ownScore,
            medianEquip,
            equipDelta,
            adjustEuro: Math.round(adjust),
            cohortCount,
            usedMobileFallback,
            insufficientCohort: cohortCount < prCfg.minComparables,
            breakdown: topBreakdown,
            mobileLabel: profile.priceRating?.ratingLabel || null,
            cohortVipDetailCount: 0
        };
    }

    function enrichRatingWithCohortMeta(rating, cohortRes) {
        if (!rating) return rating;
        const items = (cohortRes && cohortRes.items) || [];
        rating.cohortVipDetailCount = countCohortVipDetailCount(items);
        if (cohortRes && cohortRes.cacheKey) rating.cohortCacheKey = cohortRes.cacheKey;
        return rating;
    }

    function formatCohortCountText(rating, opts) {
        const forModal = opts && opts.forModal;
        let txt = forModal
            ? (rating.cohortCount + ' Vergleichsfahrzeuge')
            : ('Vergleich: ' + rating.cohortCount + ' Fahrzeuge');
        if (rating.cohortVipDetailCount > 0) {
            txt += ' (davon ' + rating.cohortVipDetailCount + ' mit VIP-Details)';
        }
        if (forModal && rating.usedMobileFallback && rating.cohortCount > 0) {
            txt += ' (mobile.de-Marktpreis als Basis)';
        }
        if (rating.insufficientCohort && rating.cohortCount > 0) {
            txt += forModal ? ' — wenige Treffer, Ergebnis mit Vorsicht' : ' (weniger als Minimum — mobile.de-Fallback)';
        } else if (!forModal && rating.usedMobileFallback && rating.cohortCount === 0) {
            txt += ' (nur mobile.de-Marktpreis, keine Kohorte im Cache)';
        }
        return txt;
    }

    function readRatingCache(adId) {
        try {
            const raw = sessionStorage.getItem(PRICE_RATING_CACHE_PREFIX + adId);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - parsed.ts > PRICE_COHORT_CACHE_TTL_MS) return null;
            return parsed.rating;
        } catch (e) {
            return null;
        }
    }

    function readRatingUiCache(adId) {
        if (!adId) return null;
        try {
            const raw = localStorage.getItem(PRICE_RATING_UI_CACHE_PREFIX + adId);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - (parsed.ts || 0) > PRICE_RATING_UI_CACHE_TTL_MS) return null;
            return parsed.rating || null;
        } catch (e) {
            return null;
        }
    }

    function writeRatingCache(adId, rating) {
        try {
            sessionStorage.setItem(PRICE_RATING_CACHE_PREFIX + adId, JSON.stringify({
                ts: Date.now(),
                rating
            }));
            localStorage.setItem(PRICE_RATING_UI_CACHE_PREFIX + adId, JSON.stringify({
                ts: Date.now(),
                rating
            }));
        } catch (e) { /* noop */ }
    }

    let priceRatingFetchToken = 0;
    let vipRatingUpdateInFlight = false;
    let vipRatingLastRunSig = '';
    let vipRatingLastRunTs = 0;
    let vipRatingUiBootstrapped = false;
    const inflightRatingByAdId = new Map();
    let srpPriceRatingIo = null;
    const SRP_DEBUG_LOG_MAX_ENTRIES = 100;
    let srpDebugLogEntries = [];

    function injectPriceRatingStyles() {
        if (document.getElementById('mobilede-price-rating-style')) return;
        const st = document.createElement('style');
        st.id = 'mobilede-price-rating-style';
        st.textContent = `
.mobilede-price-rating{
  display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;
  border-top:1px solid rgba(255,255,255,.08);font-size:13px;line-height:1.35;
}
.mobilede-price-rating--sidebar{
  margin-top:8px;padding-top:8px;width:100%;box-sizing:border-box;
}
.mobilede-price-rating--sidebar .mobilede-price-rating__bar{width:18px;}
.mobilede-price-rating__row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;}
.mobilede-price-rating__bars{display:flex;gap:3px;align-items:center;}
.mobilede-price-rating__bar{
  width:22px;height:6px;border-radius:2px;background:rgba(255,255,255,.15);
}
.mobilede-price-rating__bar--on{background:#3ddc84;}
.mobilede-price-rating__bar--on.level-0{background:#2ecc71;}
.mobilede-price-rating__bar--on.level-1{background:#52d869;}
.mobilede-price-rating__bar--on.level-2{background:#f0c040;}
.mobilede-price-rating__bar--on.level-3{background:#e8a040;}
.mobilede-price-rating__bar--on.level-4{background:#e07070;}
.mobilede-price-rating__label{font-weight:600;color:var(--mdr-text,#f2f3f5);}
.mobilede-price-rating__sub{font-size:11px;opacity:.75;color:var(--mdr-muted,#aeb0ba);}
.mobilede-price-rating__tag{
  font-size:10px;padding:1px 6px;border-radius:4px;
  background:rgba(255,255,255,.08);color:var(--mdr-muted,#aeb0ba);
}
.mobilede-price-rating__info{
  cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  border:1px solid rgba(174,176,186,.65);background:transparent;color:var(--mdr-muted,#aeb0ba);
  font-size:12px;font-weight:700;line-height:1;padding:0;
  font-family:"Segoe UI",Tahoma,Arial,sans-serif;
}
.mobilede-price-rating__info:hover{
  border-color:rgba(255,255,255,.9);background:rgba(255,255,255,.08);color:#fff;
}
.mobilede-price-rating--loading .mobilede-price-rating__bars{opacity:.4;}
.mobilede-price-rating-modal{
  position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.55);padding:16px;box-sizing:border-box;
}
.mobilede-price-rating-modal__box{
  max-width:420px;width:100%;max-height:85vh;overflow:auto;
  background:#25262c;color:#f2f3f5;border-radius:10px;padding:16px 18px;
  box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:13px;line-height:1.45;
}
.mobilede-price-rating-modal__box h4{margin:0 0 8px;font-size:15px;}
.mobilede-price-rating-modal__box p{margin:0 0 10px;opacity:.9;}
.mobilede-price-rating-modal__box ul{margin:0 0 12px;padding-left:18px;}
.mobilede-price-rating-modal__open-search{
  display:block;margin:0 0 12px;padding:8px 14px;border-radius:6px;border:1px solid #1976d2;
  cursor:pointer;background:#1976d2;color:#fff;font:inherit;font-size:13px;
}
.mobilede-price-rating-modal__open-search:hover{filter:brightness(1.08);}
.mobilede-price-rating-modal__close{
  margin-top:8px;padding:8px 14px;border-radius:6px;border:0;cursor:pointer;
  background:#3a3d46;color:#f0f1f3;font:inherit;
}
.mobilede-srp-price-badge{
  display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle;
  font-size:11px;line-height:1;white-space:nowrap;
}
.mobilede-srp-price-badge__bars{display:flex;gap:2px;}
.mobilede-srp-price-badge__bar{width:10px;height:4px;border-radius:1px;background:rgba(255,255,255,.2);}
.mobilede-srp-price-badge__bar--on{background:#3ddc84;}
.mobilede-srp-price-badge__text{opacity:.9;font-weight:500;}
.mobilede-srp-debug-card{
  margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.10);border-radius:10px;
  background:linear-gradient(180deg,rgba(64,68,79,.55),rgba(52,56,66,.45));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);color:#f0f1f3;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  width:100%;box-sizing:border-box;
}
.mobilede-srp-debug-card__title{font-size:13px;font-weight:600;line-height:1.25;margin-bottom:8px;opacity:.95;}
.mobilede-srp-debug-card__actions{display:flex;flex-wrap:wrap;gap:6px;}
.mobilede-srp-debug-card__btn{
  appearance:none;cursor:pointer;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.045);color:#f0f1f3;font-size:12px;line-height:1.2;
}
.mobilede-srp-debug-card__btn:hover{background:rgba(255,255,255,.10);}
.mobilede-srp-debug-card__btn:disabled{
  opacity:.45;cursor:not-allowed;background:rgba(255,255,255,.02);
  border-color:rgba(255,255,255,.08);color:rgba(240,241,243,.6);
}
.mobilede-srp-debug-card__log{
  margin-top:8px;max-height:220px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,.09);
  background:rgba(0,0,0,.22);padding:7px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:1.4;color:#dfe2e8;white-space:pre-wrap;word-break:break-word;
}
.mobilede-srp-debug-card__log-line{margin-bottom:5px;}
.mobilede-srp-debug-card__log-line:last-child{margin-bottom:0;}
.mobilede-srp-debug-card__log-line--warn{color:#ffd59e;}
.mobilede-srp-debug-card__log-line--error{color:#ffb6b6;}
.mobilede-srp-debug-card--detail{
  margin-top:8px;margin-bottom:14px;
  border-color:rgba(255,255,255,.08);
  background:linear-gradient(180deg,rgba(58,62,73,.35),rgba(46,50,60,.28));
  box-shadow:none;
}
.mobilede-srp-debug-card--detail .mobilede-srp-debug-card__title{
  font-size:12.5px;margin-bottom:7px;opacity:.9;
}
.mobilede-srp-debug-card--detail .mobilede-srp-debug-card__log{
  max-height:160px;background:rgba(0,0,0,.16);border-color:rgba(255,255,255,.07);
}
`;
        document.head.appendChild(st);
    }

    function renderRatingBars(level, small) {
        const wrap = document.createElement('div');
        wrap.className = small ? 'mobilede-srp-price-badge__bars' : 'mobilede-price-rating__bars';
        for (let i = 0; i < 5; i++) {
            const bar = document.createElement('span');
            bar.className = (small ? 'mobilede-srp-price-badge__bar' : 'mobilede-price-rating__bar')
                + (i <= level ? ' mobilede-' + (small ? 'srp-price-badge' : 'price-rating') + '__bar--on' : '')
                + (i <= level ? ' level-' + level : '');
            wrap.appendChild(bar);
        }
        return wrap;
    }

    function openPriceRatingModal(rating, profile) {
        document.querySelectorAll('.mobilede-price-rating-modal').forEach(el => el.remove());
        const overlay = document.createElement('div');
        overlay.className = 'mobilede-price-rating-modal';
        const box = document.createElement('div');
        box.className = 'mobilede-price-rating-modal__box';
        const h = document.createElement('h4');
        h.textContent = 'Preisbewertung (ausstattungsbereinigt)';
        box.appendChild(h);
        if (rating.needsCohortSearch) {
            const pBlock = document.createElement('p');
            pBlock.textContent = 'Für den Median-Basispreis die Vergleichssuche öffnen und auf der '
                + 'Suchergebnisseite bleiben (Liste muss laden). Geöffnete Inserate helfen zusätzlich für präzisere '
                + 'Ausstattungs-Scores (inkl. Beschreibungstext), erhöhen aber nicht die Kohortenanzahl. '
                + 'Die Trefferliste wird lokal zwischengespeichert (auch im neuen Tab) — keine Hintergrund-Anfragen.';
            box.appendChild(pBlock);
            if (profile) {
                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'mobilede-price-rating-modal__open-search';
                openBtn.textContent = 'Vergleichssuche öffnen';
                openBtn.addEventListener('click', () => openCohortSearchTab(profile));
                box.appendChild(openBtn);
            }
        }
        const p1 = document.createElement('p');
        p1.textContent = rating.label + ' — Angebot ' + rating.price.toLocaleString('de-DE') + ' € vs. erwartet ~'
            + rating.adjustedExpected.toLocaleString('de-DE') + ' € (' +
            (rating.devEuro >= 0 ? '+' : '') + rating.devEuro.toLocaleString('de-DE') + ' €, ' +
            (rating.devPct * 100).toFixed(1) + ' %).';
        box.appendChild(p1);
        const p2 = document.createElement('p');
        p2.textContent = formatCohortCountText(rating, { forModal: true }) + '. Basispreis Median: ' + rating.basePrice.toLocaleString('de-DE')
            + ' €. Ausstattung: dein Score ' + rating.ownScore.toFixed(1) + ' vs. Median '
            + (rating.medianEquip || 0).toFixed(1) + ' (Δ ' + rating.equipDelta.toFixed(1) + ' → '
            + (rating.adjustEuro >= 0 ? '+' : '') + rating.adjustEuro.toLocaleString('de-DE') + ' €).';
        box.appendChild(p2);
        if (rating.mobileLabel) {
            const pm = document.createElement('p');
            pm.textContent = 'mobile.de: ' + rating.mobileLabel + '.';
            box.appendChild(pm);
        }
        if (rating.breakdown && rating.breakdown.length) {
            const ul = document.createElement('ul');
            rating.breakdown.forEach(b => {
                const li = document.createElement('li');
                li.textContent = b.label + ' (' + b.weight + ' Pkt., ' + b.source + ')';
                ul.appendChild(li);
            });
            box.appendChild(ul);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'mobilede-price-rating-modal__close';
        close.textContent = 'Schließen';
        close.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        box.appendChild(close);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    function renderVipPriceRatingWidget(rating, loading) {
        const anchor = getVipPriceRatingAnchor();
        if (!anchor) return;
        injectPriceRatingStyles();
        const mainPriceBox = document.querySelector('[data-testid="vip-price-box"]');
        if (mainPriceBox && mainPriceBox !== anchor && !anchor.contains(mainPriceBox)) {
            mainPriceBox.querySelectorAll('.mobilede-price-rating').forEach(el => el.remove());
        }
        const inSidebar = anchor.classList.contains('wNWsk')
            || !!anchor.closest('aside.iKWwq');
        let wrap = anchor.querySelector('.mobilede-price-rating');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'mobilede-price-rating' + (inSidebar ? ' mobilede-price-rating--sidebar' : '');
            anchor.appendChild(wrap);
        } else if (inSidebar) {
            wrap.classList.add('mobilede-price-rating--sidebar');
        }
        wrap.classList.toggle('mobilede-price-rating--loading', !!loading);
        wrap.innerHTML = '';
        const row = document.createElement('div');
        row.className = 'mobilede-price-rating__row';
        if (loading) {
            const lab = document.createElement('span');
            lab.className = 'mobilede-price-rating__label';
            lab.textContent = 'Vergleich wird geladen…';
            row.appendChild(lab);
            wrap.appendChild(row);
            return;
        }
        if (!rating || !rating.ok) {
            const lab = document.createElement('span');
            lab.className = 'mobilede-price-rating__sub';
            if (rating && rating.needsCohortSearch) {
                lab.textContent = 'Vergleichssuche manuell öffnen (ⓘ)';
            } else {
                lab.textContent = rating && rating.reason === 'no_baseline'
                    ? 'Preisbewertung: zu wenig Vergleichsdaten'
                    : 'Preisbewertung nicht verfügbar';
            }
            row.appendChild(lab);
            if (rating && rating.needsCohortSearch) {
                const info = document.createElement('button');
                info.type = 'button';
                info.className = 'mobilede-price-rating__info';
                info.setAttribute('aria-label', 'Vergleichssuche manuell öffnen');
                info.textContent = '?';
                const prof = buildVehicleProfile();
                info.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (prof) openCohortSearchTab(prof);
                });
                row.appendChild(info);
            }
            wrap.appendChild(row);
            return;
        }
        row.appendChild(renderRatingBars(rating.level, false));
        const label = document.createElement('span');
        label.className = 'mobilede-price-rating__label';
        label.textContent = rating.label;
        row.appendChild(label);
        const tag = document.createElement('span');
        tag.className = 'mobilede-price-rating__tag';
        tag.textContent = 'ausstattungsbereinigt';
        row.appendChild(tag);
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'mobilede-price-rating__info';
        info.setAttribute('aria-label', 'Details zur Preisbewertung');
        info.textContent = '?';
        info.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            openPriceRatingModal(rating, buildVehicleProfile());
        });
        row.appendChild(info);
        wrap.appendChild(row);
        const sub = document.createElement('div');
        sub.className = 'mobilede-price-rating__sub';
        let subTxt = formatCohortCountText(rating);
        subTxt += ' · Erwartet ~' + rating.adjustedExpected.toLocaleString('de-DE') + ' €';
        sub.textContent = subTxt;
        wrap.appendChild(sub);
    }

    function computeAndCacheRatingForProfile(profile) {
        const t0 = pricePerfMarkStart();
        const prCfg = getPriceRating(featureFlags);
        const cohortRes = getCohortComparables(profile, prCfg);
        const rating = enrichRatingWithCohortMeta(
            computePriceRating(profile, cohortRes.items),
            cohortRes
        );
        if (cohortRes.needsManualSearch) rating.needsCohortSearch = true;
        if (profile.id && rating.ok) writeRatingCache(profile.id, rating);
        priceRatingDebugLog('Bewertung berechnet', {
            adId: profile.id,
            ok: rating.ok,
            cohortCount: rating.cohortCount,
            vipDetails: rating.cohortVipDetailCount,
            cacheKey: cohortRes.cacheKey,
            ownScore: rating.ownScore,
            medianEquip: rating.medianEquip,
            adjustEuro: rating.adjustEuro
        });
        pricePerfMarkEnd('priceRatingCompute', t0, 50);
        return rating;
    }

    function computeAndCacheRatingForProfileAsync(profile) {
        const adId = profile && profile.id ? String(profile.id) : '';
        if (!adId) {
            return new Promise((resolve, reject) => {
                requestIdle(() => {
                    try {
                        resolve(computeAndCacheRatingForProfile(profile));
                    } catch (err) {
                        reject(err);
                    }
                }, 500);
            });
        }
        if (inflightRatingByAdId.has(adId)) return inflightRatingByAdId.get(adId);
        const p = new Promise((resolve, reject) => {
            requestIdle(() => {
                try {
                    resolve(computeAndCacheRatingForProfile(profile));
                } catch (err) {
                    reject(err);
                }
            }, 500);
        }).finally(() => inflightRatingByAdId.delete(adId));
        inflightRatingByAdId.set(adId, p);
        return p;
    }

    function syncVipEquipmentCache(profile) {
        if (!profile || !profile.id || !isVehicleDetailPage()) return;
        const equipment = equipmentFingerprintFromProfile(profile);
        if (equipment && typeof equipment.score === 'number') {
            writeVipEquipCache(profile.id, equipment);
            priceRatingDebugLog('VIP-Ausstattung gecacht', {
                adId: profile.id,
                score: equipment.score,
                features: equipment.breakdown.length,
                fromDescription: equipment.breakdown.some(b => b.source === 'description' || b.source === 'match')
            });
            try {
                localStorage.setItem(PRICE_COHORT_CACHE_PREFIX + '_updated', String(Date.now()));
            } catch (e) { /* noop */ }
        }
    }

    function invalidateVipRatingCacheForReload() {
        const id = getAdIdFromUrl();
        if (!id) return;
        try {
            sessionStorage.removeItem(PRICE_RATING_CACHE_PREFIX + id);
        } catch (e) { /* noop */ }
    }

    function getVipRatingRunSignature(profile) {
        const pr = getPriceRating(featureFlags);
        const th = (pr.thresholds || []).map(t => String(t.maxPct)).join(',');
        return [
            location.pathname,
            profile && profile.id ? String(profile.id) : '',
            pr.enabled !== false ? 1 : 0,
            pr.enabledVip ? 1 : 0,
            pr.mobileFallback ? 1 : 0,
            pr.useModelRange ? 1 : 0,
            pr.onlyFavoriteWeights ? 1 : 0,
            pr.minComparables,
            pr.punktZuEuro,
            pr.maxAdjustPct,
            pr.kmToleranceAbs,
            pr.yearTolerance,
            pr.powerToleranceKw,
            th
        ].join('|');
    }

    async function preisBewertungAktualisieren(opts) {
        const options = opts || {};
        const perfStart = pricePerfMarkStart();
        const prCfg = getPriceRating(featureFlags);
        if (!isVehicleDetailPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledVip) {
            priceRatingDebugLog('Preisbewertung übersprungen', {
                isVehicleDetailPage: isVehicleDetailPage(),
                enabled: isPriceRatingEnabled(prCfg),
                enabledVip: prCfg.enabledVip
            });
            document.querySelectorAll('.mobilede-price-rating').forEach(el => el.remove());
            vipRatingUiBootstrapped = false;
            return;
        }
        if (!options.force && vipRatingUpdateInFlight) {
            priceRatingDebugLog('Preisbewertung übersprungen: Update läuft bereits');
            return;
        }
        const profile = buildVehicleProfile();
        if (!profile || !profile.id) {
            priceRatingDebugLog('Preisbewertung übersprungen: kein Fahrzeugprofil');
            return;
        }
        const runSig = getVipRatingRunSignature(profile);
        const now = Date.now();
        if (!options.force && runSig === vipRatingLastRunSig && (now - vipRatingLastRunTs) < 2500) {
            priceRatingDebugLog('Preisbewertung übersprungen: identische Signatur', { adId: profile.id });
            return;
        }
        vipRatingUpdateInFlight = true;
        try {
            const token = ++priceRatingFetchToken;
            priceRatingDebugLog('Preisbewertung Lauf gestartet', { adId: profile.id, token, force: !!options.force });
            const uiCached = readRatingUiCache(profile.id);
            if (!vipRatingUiBootstrapped) {
                if (uiCached && uiCached.ok) {
                    renderVipPriceRatingWidget(uiCached, false);
                    priceRatingDebugLog('UI-Cache für Preisbewertung genutzt', { adId: profile.id });
                } else {
                    renderVipPriceRatingWidget(null, true);
                }
                vipRatingUiBootstrapped = true;
            }

            try {
                await resolveMakeModelIdsForProfile(profile);
            } catch (e) { /* noop */ }
            if (token !== priceRatingFetchToken) {
                priceRatingDebugLog('Preisbewertung Lauf verworfen: Token gewechselt', { adId: profile.id, token });
                return;
            }

            syncVipEquipmentCache(profile);

            const cached = readRatingCache(profile.id);
            if (cached && cached.ok && !cached.needsCohortSearch) {
                const cohortRes = getCohortComparables(profile, prCfg);
                if (cohortRes.items.length || !cached.usedMobileFallback) {
                    const rating = enrichRatingWithCohortMeta(cached, cohortRes);
                    renderVipPriceRatingWidget(rating, false);
                    vipRatingLastRunSig = runSig;
                    vipRatingLastRunTs = Date.now();
                    priceRatingDebugLog('Preisbewertung aus Session-Cache gerendert', {
                        adId: profile.id,
                        cohortCount: rating.cohortCount,
                        usedMobileFallback: rating.usedMobileFallback
                    });
                    pricePerfMarkEnd('preisBewertungAktualisieren_cached', perfStart, 50);
                    return;
                }
                priceRatingDebugLog('Session-Cache vorhanden, aber Recompute nötig', {
                    adId: profile.id,
                    usedMobileFallback: cached.usedMobileFallback
                });
            }

            const rating = await computeAndCacheRatingForProfileAsync(profile);
            if (token !== priceRatingFetchToken) {
                priceRatingDebugLog('Preisbewertung Recompute verworfen: Token gewechselt', { adId: profile.id, token });
                return;
            }
            renderVipPriceRatingWidget(rating, false);
            vipRatingLastRunSig = runSig;
            vipRatingLastRunTs = Date.now();
            priceRatingDebugLog('Preisbewertung neu berechnet und gerendert', {
                adId: profile.id,
                ok: rating && rating.ok,
                reason: rating && rating.reason ? rating.reason : null
            });
            pricePerfMarkEnd('preisBewertungAktualisieren_recompute', perfStart, 50);
        } finally {
            vipRatingUpdateInFlight = false;
        }
    }

    function findSrpListingRoots() {
        const links = document.querySelectorAll('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
        const roots = new Set();
        links.forEach(a => {
            const card = a.closest('article, li, [data-testid*="result"], [class*="result"]')
                || a.parentElement;
            if (card) roots.add(card);
        });
        return [...roots];
    }

    function extractAdIdFromHref(href) {
        if (!href) return null;
        try {
            const u = new URL(href, location.origin);
            const id = u.searchParams.get('id');
            if (id) return id;
            const m = u.pathname.match(/\/auto-inserat\/([^/?#]+)/);
            return m ? m[1] : null;
        } catch (e) {
            return null;
        }
    }

    function profileFromSrpCard(card) {
        const link = card.querySelector('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
        if (!link) return null;
        const id = extractAdIdFromHref(link.getAttribute('href'));
        if (!id) return null;

        const state = getPageInitialState();
        if (state) {
            const listings = findSrpListingsInState(state);
            const hit = listings.find(raw => {
                const ad = raw?.ad || raw?.data?.ad || raw;
                return ad && String(ad.id) === String(id);
            });
            if (hit) {
                const prof = normalizeComparableAd(hit);
                if (prof) return prof;
            }
        }

        const title = link.textContent.trim() || card.textContent.trim().slice(0, 200);
        const priceMatch = card.textContent.replace(/\s/g, ' ').match(/([\d.]+)\s*€/);
        const priceGross = priceMatch ? parseEuroAmount(priceMatch[1] + ' €') : null;
        const kmMatch = card.textContent.match(/([\d.]+)\s*km/i);
        const yearMatch = card.textContent.match(/\b(19|20)\d{2}\b/);
        return {
            id,
            make: '',
            model: '',
            title,
            subTitle: '',
            priceGross,
            mileageKm: kmMatch ? parseKm(kmMatch[0]) : null,
            firstRegistrationYear: yearMatch ? parseInt(yearMatch[0], 10) : null,
            powerPs: null,
            fuel: '',
            transmission: '',
            features: [],
            priceRating: null,
            attributes: []
        };
    }

    function renderSrpPriceBadge(card, rating, loading) {
        injectPriceRatingStyles();
        const link = card.querySelector('a[href*="details.html?id="], a[href*="/auto-inserat/"]');
        if (!link) return;
        let badge = card.querySelector('.mobilede-srp-price-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'mobilede-srp-price-badge';
            badge.title = 'Preisbewertung (ausstattungsbereinigt)';
            link.parentElement ? link.parentElement.insertBefore(badge, link.nextSibling)
                : link.after(badge);
        }
        badge.innerHTML = '';
        if (loading) {
            badge.appendChild(renderRatingBars(2, true));
            const t = document.createElement('span');
            t.className = 'mobilede-srp-price-badge__text';
            t.textContent = '…';
            badge.appendChild(t);
            return;
        }
        if (!rating || !rating.ok) {
            badge.remove();
            delete card.dataset.mobiledePriceRated;
            return;
        }
        badge.appendChild(renderRatingBars(rating.level, true));
        const shortLabels = ['Sehr gut', 'Gut', 'Fair', 'Erhöht', 'Hoch'];
        const t = document.createElement('span');
        t.className = 'mobilede-srp-price-badge__text';
        t.textContent = shortLabels[rating.level] || rating.label.split(' ')[0];
        badge.appendChild(t);
        badge.title = rating.label + ' — erwartet ~' + rating.adjustedExpected.toLocaleString('de-DE') + ' €';
    }

    function loadSrpCardRating(card) {
        const prCfg = getPriceRating(featureFlags);
        if (!isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) return;
        if (card.dataset.mobiledePriceRated === '1') return;
        const profile = profileFromSrpCard(card);
        if (!profile || !profile.id) return;

        const cached = readRatingCache(profile.id);
        if (cached && cached.ok) {
            card.dataset.mobiledePriceRated = '1';
            renderSrpPriceBadge(card, cached, false);
            return;
        }

        card.dataset.mobiledePriceRated = 'pending';
        computeAndCacheRatingForProfileAsync(profile).then(rating => {
            if (!card.isConnected) return;
            card.dataset.mobiledePriceRated = '1';
            renderSrpPriceBadge(card, rating, false);
        }).catch(() => {
            delete card.dataset.mobiledePriceRated;
        });
    }

    const srpRatingQueue = [];
    let srpRatingQueueRunning = false;
    let srpRatingLastInteractionMs = 0;

    function markSrpInteraction() {
        srpRatingLastInteractionMs = Date.now();
    }

    function enqueueSrpCard(card) {
        if (!card || card.dataset.mobiledePriceRated) return;
        if (!srpRatingQueue.includes(card)) srpRatingQueue.push(card);
        if (!srpRatingQueueRunning) {
            srpRatingQueueRunning = true;
            requestIdle(runSrpRatingQueue, 220);
        }
    }

    function runSrpRatingQueue() {
        const t0 = pricePerfMarkStart();
        const prCfg = getPriceRating(featureFlags);
        if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) {
            srpRatingQueue.length = 0;
            srpRatingQueueRunning = false;
            return;
        }
        if (Date.now() - srpRatingLastInteractionMs < 140) {
            requestIdle(runSrpRatingQueue, 180);
            return;
        }
        let processed = 0;
        while (srpRatingQueue.length && processed < 4) {
            const card = srpRatingQueue.shift();
            if (!card || !card.isConnected || card.dataset.mobiledePriceRated) continue;
            loadSrpCardRating(card);
            processed++;
        }
        pricePerfMarkEnd('scanSrpBadges_chunk', t0, 16);
        if (srpRatingQueue.length) {
            requestIdle(runSrpRatingQueue, 160);
        } else {
            srpRatingQueueRunning = false;
        }
    }

    function ensureSrpPriceRatingObserver() {
        const prCfg = getPriceRating(featureFlags);
        if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) {
            if (srpPriceRatingIo) {
                srpPriceRatingIo.disconnect();
                srpPriceRatingIo = null;
            }
            return;
        }
        if (srpPriceRatingIo) return;
        srpPriceRatingIo = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const card = entry.target;
                srpPriceRatingIo.unobserve(card);
                enqueueSrpCard(card);
            });
        }, { rootMargin: '120px' });
        scanSrpPriceBadges();
    }

    function scanSrpPriceBadges() {
        const prCfg = getPriceRating(featureFlags);
        if (!isSearchResultsPage() || !isPriceRatingEnabled(prCfg) || !prCfg.enabledSrp) return;
        ensureSrpPriceRatingObserver();
        findSrpListingRoots().forEach(card => {
            if (card.dataset.mobiledePriceRated) return;
            if (srpPriceRatingIo) srpPriceRatingIo.observe(card);
            else enqueueSrpCard(card);
        });
    }

    function clearPriceRatingUi() {
        document.querySelectorAll('.mobilede-price-rating, .mobilede-srp-price-badge').forEach(el => el.remove());
        document.querySelectorAll('[data-mobilede-price-rated]').forEach(el => {
            delete el.dataset.mobiledePriceRated;
        });
        findSrpListingRoots().forEach(card => { delete card.dataset.mobiledePriceRated; });
        srpRatingQueue.length = 0;
    }

    // ============================================================
    // 10) Lifecycle: Observer + SPA-Navigation
    // ============================================================
    let observer = null;
    let triggerTimer = null;
    const scheduledJobs = new Map();
    let schedulerTickPending = false;
    const taskPriority = { ui: 0, network: 1, rating: 2 };

    function requestIdle(fn, timeoutMs) {
        if (typeof requestIdleCallback === 'function') {
            return requestIdleCallback(fn, { timeout: timeoutMs || 350 });
        }
        return setTimeout(fn, Math.min(timeoutMs || 350, 220));
    }

    function scheduleTask(key, type, job) {
        if (!key || typeof job !== 'function') return;
        const existing = scheduledJobs.get(key);
        if (existing && existing.type === type) return;
        scheduledJobs.set(key, { type: type || 'ui', job });
        if (schedulerTickPending) return;
        schedulerTickPending = true;
        requestIdle(runScheduledTasks, 220);
    }

    function runScheduledTasks() {
        schedulerTickPending = false;
        if (!scheduledJobs.size) return;
        const popupOpen = isConfigPopupOpen();
        const items = [...scheduledJobs.entries()]
            .sort((a, b) => (taskPriority[a[1].type] ?? 99) - (taskPriority[b[1].type] ?? 99));
        scheduledJobs.clear();
        let deferredCount = 0;
        items.forEach(([key, task]) => {
            if (popupOpen && task.type !== 'ui') {
                scheduledJobs.set(key, task);
                deferredCount++;
                return;
            }
            const t0 = pricePerfMarkStart();
            try { task.job(); } catch (e) { console.error(e); }
            pricePerfMarkEnd('task:' + task.type, t0, 16);
        });
        if (deferredCount > 0 && !schedulerTickPending) {
            schedulerTickPending = true;
            requestIdle(runScheduledTasks, 400);
        }
    }

    function isConfigPopupOpen() {
        const overlay = document.querySelector('#mobilede-config-overlay');
        return !!(overlay && overlay.querySelector('.mc-popup'));
    }

    function hasActiveSelectionInsideResults() {
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
        for (let i = 0; i < sel.rangeCount; i++) {
            const range = sel.getRangeAt(i);
            const nodes = [range.startContainer, range.endContainer];
            for (const node of nodes) {
                if (!node) continue;
                const el = node.nodeType === 1 ? node : node.parentElement;
                if (!el) continue;
                if (el.closest('.mobilede-result-article, .mobilede-tech-article')) return true;
            }
        }
        return false;
    }

    function trigger() {
        clearTimeout(triggerTimer);
        triggerTimer = setTimeout(() => {
            if (hasActiveSelectionInsideResults()) return;
            scheduleTask('ui:results', 'ui', () => {
                ergebnisHinzufuegen();
                verlinkeStandortAufGoogleMaps();
                ensureSrpDebugLogCard();
                ensureDetailDebugLogCard();
            });
            scheduleTask('network:cohort-sync', 'network', () => syncCohortCacheFromSearchPage());
            // Detailseite: keine periodischen Observer-Recomputes beim bloßen DOM-Rauschen.
            if (!isVehicleDetailPage()) {
                scheduleTask('rating:vip-refresh', 'rating', () => { preisBewertungAktualisieren(); });
            }
            scheduleTask('rating:srp-scan', 'rating', () => scanSrpPriceBadges());
        }, 300);
    }

    /**
     * Macht Standort-Texte (z.B. „DE-92690 Pressath", „AT-1010 Wien") überall
     * auf der Seite klickbar: Klick öffnet Google Maps mit der Adresse.
     * Robust gegen mobile.de Class-Name-Änderungen via Pattern-Match auf den
     * Textinhalt einzelner Blatt-Elemente (kein Scope-Restrictor, damit auch
     * Standorte außerhalb der Aktions-Box `.Va7Gr` erfasst werden, z.B. in
     * `aside.iKWwq` der Verkäufer-Karte).
     *
     * Per Feature-Flag (`featureFlags.mapsLink`) abschaltbar – Listener werden
     * mit AbortController gekoppelt und beim Ausschalten abgemeldet, damit
     * keine Duplikate entstehen und die Optik beim Wiedereinschalten stimmt.
     */
    function verlinkeStandortAufGoogleMaps() {
        const enabled = !!(featureFlags && featureFlags.mapsLink !== false);
        const re = /^[A-Z]{2}-\d{4,5}\s+\S.*$/;
        const candidates = document.querySelectorAll('div, span, p, address');
        const matched = [];
        for (const el of candidates) {
            if (!el || !el.dataset) continue;
            if (el.children && el.children.length > 0) continue;
            const txt = (el.textContent || '').trim();
            if (txt.length < 6 || txt.length > 80) continue;
            if (!re.test(txt)) continue;
            if (el.closest && el.closest('#mobilede-config-popup')) continue;
            matched.push({ el, txt });
        }

        if (!enabled) {
            matched.forEach(({ el }) => {
                if (el.dataset.mobiledeStandort !== '1') return;
                const ctl = el._mobileDeMapsCtl;
                if (ctl && typeof ctl.abort === 'function') {
                    try { ctl.abort(); } catch (_) { /* noop */ }
                }
                el._mobileDeMapsCtl = null;
                el.style.cursor = '';
                el.style.textDecoration = '';
                el.style.textDecorationStyle = '';
                el.style.textUnderlineOffset = '';
                el.style.opacity = '';
                el.removeAttribute('role');
                el.removeAttribute('tabindex');
                el.removeAttribute('title');
                delete el.dataset.mobiledeStandort;
            });
            return;
        }

        matched.forEach(({ el, txt }) => {
            el.style.cursor = 'pointer';
            el.style.textDecoration = 'underline';
            el.style.textDecorationStyle = 'dotted';
            el.style.textUnderlineOffset = '3px';
            el.title = 'In Google Maps öffnen: ' + txt;
            el.setAttribute('role', 'link');
            el.setAttribute('tabindex', '0');

            const existing = el._mobileDeMapsCtl;
            if (el.dataset.mobiledeStandort === '1' && existing && !existing.signal.aborted) {
                return;
            }
            if (existing && typeof existing.abort === 'function') {
                try { existing.abort(); } catch (_) { /* noop */ }
            }

            el.dataset.mobiledeStandort = '1';
            const ac = new AbortController();
            el._mobileDeMapsCtl = ac;
            const opts = { signal: ac.signal };
            el.addEventListener('mouseenter', () => {
                if (!featureFlags || featureFlags.mapsLink === false) return;
                el.style.textDecorationStyle = 'solid';
                el.style.opacity = '0.85';
            }, opts);
            el.addEventListener('mouseleave', () => {
                el.style.textDecorationStyle = 'dotted';
                el.style.opacity = '';
            }, opts);
            const open = () => {
                const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(txt);
                window.open(url, '_blank', 'noopener,noreferrer');
            };
            el.addEventListener(
                'click',
                e => {
                    if (!featureFlags || featureFlags.mapsLink === false) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                    open();
                },
                { capture: true, signal: ac.signal }
            );
            el.addEventListener('keydown', e => {
                if (!featureFlags || featureFlags.mapsLink === false) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            }, opts);
        });
    }

    function startObserver() {
        if (observer) observer.disconnect();
        // Wir lassen den Observer dauerhaft laufen; trigger() ist debounced
        // und ergebnisHinzufuegen() baut den Ergebnisblock bei Bedarf neu auf.
        // Bei SPA-Re-Renders (DOM ohne URL-Wechsel) wird so neu gerendert.
        observer = new MutationObserver(() => trigger());
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ============================================================
    // 10b) Suchergebnisse: Standard-Sortierung aus Config
    // ============================================================
    let srpSortUserOverrideFp = null;
    let applyingDefaultSrpSort = false;
    let lastSrpFingerprint = null;
    let lastPolledSrpSort = null;
    let srpSortMo = null;
    let srpSortPollTimerId = null;
    let srpSortOnPageshow = null;

    function isSearchResultsPage() {
        return /\/fahrzeuge\/search\.html/.test(location.pathname);
    }

    function isSrpLogCardEnabled(flags) {
        const dbg = getDebugConfig(flags || featureFlags);
        return dbg && dbg.showSrpLogCard === true;
    }

    function serializeSrpDebugPayload(payload) {
        if (payload == null) return '';
        if (typeof payload === 'string') return payload;
        try {
            return JSON.stringify(payload, null, 2);
        } catch (e) {
            return String(payload);
        }
    }

    function appendSrpDebugLog(level, label, payload) {
        const ts = new Date().toLocaleTimeString('de-DE', { hour12: false });
        const line = `[${ts}] ${String(level || 'info').toUpperCase()} ${label}${payload == null ? '' : '\n' + serializeSrpDebugPayload(payload)}`;
        srpDebugLogEntries.push({ level: level || 'info', text: line });
        if (srpDebugLogEntries.length > SRP_DEBUG_LOG_MAX_ENTRIES) {
            srpDebugLogEntries = srpDebugLogEntries.slice(-SRP_DEBUG_LOG_MAX_ENTRIES);
        }
        renderSrpDebugLogCard();
    }

    function clearSrpDebugLog() {
        srpDebugLogEntries = [];
        renderSrpDebugLogCard();
    }

    function getSrpDebugLogText() {
        if (!srpDebugLogEntries.length) return 'Noch keine Logs vorhanden.';
        return srpDebugLogEntries.map(e => e.text).join('\n\n');
    }

    async function copySrpDebugLogToClipboard(sourceBtn) {
        const safeToast = (msg, kind) => {
            if (typeof showToast === 'function') showToast(msg, kind);
        };
        const setButtonFeedback = (tempLabel) => {
            if (!sourceBtn) return;
            const base = sourceBtn.dataset.defaultLabel || '⧉ Copy';
            if (sourceBtn._copyResetTimer) clearTimeout(sourceBtn._copyResetTimer);
            sourceBtn.textContent = tempLabel;
            sourceBtn.disabled = true;
            sourceBtn._copyResetTimer = setTimeout(() => {
                sourceBtn.textContent = base;
                sourceBtn.disabled = false;
                sourceBtn._copyResetTimer = null;
            }, 1100);
        };
        const text = getSrpDebugLogText();
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                setButtonFeedback('Kopiert!');
                safeToast('Debug-Logs kopiert', 'success');
                return;
            }
        } catch (e) { /* fallback below */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) {
                setButtonFeedback('Kopiert!');
                safeToast('Debug-Logs kopiert', 'success');
            }
            else safeToast('Kopieren nicht moeglich', 'warn');
        } catch (e2) {
            safeToast('Kopieren nicht moeglich', 'warn');
            setButtonFeedback('Fehler');
        }
    }

    function runManualCohortLog() {
        const prof = buildVehicleProfile();
        if (!prof || !prof.id) {
            console.warn('[mobilede Preis]', 'Kein Fahrzeugprofil auf dieser Seite');
            appendSrpDebugLog('warn', 'Kohorten-Check nicht moeglich', { reason: 'Kein Fahrzeugprofil auf dieser Seite' });
            showToast('Nur auf einer Fahrzeugdetailseite mit Inserat-ID', 'warn');
            return;
        }
        const prCfg = getPriceRating(featureFlags);
        const cohortRes = getCohortComparables(prof, prCfg);
        const payload = {
            profileId: prof.id,
            cacheKey: cohortRes.cacheKey,
            cohortHuman: cohortHumanLabel(prof, prCfg),
            count: cohortRes.items.length,
            vipDetails: countCohortVipDetailCount(cohortRes.items),
            needsManualSearch: !!cohortRes.needsManualSearch
        };
        console.info('[mobilede Preis]', 'Manueller Kohorten-Check', payload);
        appendSrpDebugLog('info', 'Manueller Kohorten-Check', payload);
        showToast('Kohorte wurde geloggt', 'success');
    }

    function runManualSrpStatusLog() {
        if (!isSearchResultsPage()) {
            console.warn('[mobilede Preis]', 'SRP-Status nur auf Suchergebnisseite verfügbar');
            appendSrpDebugLog('warn', 'SRP-Status nicht verfuegbar', { reason: 'Nicht auf Suchergebnisseite' });
            showToast('Nur auf einer Suchergebnisseite (SRP)', 'warn');
            return;
        }
        const state = getPageInitialState();
        if (!state) {
            console.warn('[mobilede Preis]', 'SRP-Status: kein __INITIAL_STATE__ vorhanden');
            appendSrpDebugLog('warn', 'SRP-Status ohne __INITIAL_STATE__', null);
            showToast('Kein __INITIAL_STATE__ auf dieser SRP', 'warn');
            return;
        }
        const rawList = findSrpListingsInState(state);
        const items = parseCohortItemsFromState(state, null);
        const prof = profileFromSearchPageUrl(location.href);
        const prCfg = getPriceRating(featureFlags);
        const cacheKey = prof && (prof.makeId || prof.make || prof.modelId || prof.model)
            ? cohortCacheKey(prof, prCfg)
            : null;
        const cached = cacheKey ? readCohortCache(cacheKey) : null;
        const payload = {
            url: location.href,
            rawListings: rawList.length,
            parsedComparables: items.length,
            cacheKey,
            cohortHuman: prof ? cohortHumanLabel(prof, prCfg) : null,
            cachedCount: Array.isArray(cached) ? cached.length : 0,
            profileFromUrl: prof ? {
                makeId: prof.makeId || '',
                modelId: prof.modelId || '',
                modelGroupId: prof.modelGroupId || '',
                mileageKm: prof.mileageKm,
                firstRegistrationYear: prof.firstRegistrationYear,
                powerKw: prof.powerKw
            } : null
        };
        console.info('[mobilede Preis]', 'Manueller SRP-Status', payload);
        appendSrpDebugLog('info', 'Manueller SRP-Status', payload);
        showToast('SRP-Status wurde geloggt', 'success');
    }

    function runManualPriceRatingUiLog() {
        if (!isVehicleDetailPage()) {
            appendSrpDebugLog('warn', 'Preisbewertung-UI nicht verfuegbar', { reason: 'Nicht auf Detailseite' });
            showToast('Nur auf einer Fahrzeugdetailseite', 'warn');
            return;
        }
        const profile = buildVehicleProfile();
        const adId = profile && profile.id ? String(profile.id) : null;
        const wrap = document.querySelector('.mobilede-price-rating');
        const row = wrap ? wrap.querySelector('.mobilede-price-rating__row') : null;
        const bars = wrap ? wrap.querySelectorAll('.mobilede-price-rating__bar') : [];
        const barsOn = wrap ? wrap.querySelectorAll('.mobilede-price-rating__bar--on') : [];
        const labelEl = wrap ? wrap.querySelector('.mobilede-price-rating__label') : null;
        const tagEl = wrap ? wrap.querySelector('.mobilede-price-rating__tag') : null;
        const subEl = wrap ? wrap.querySelector('.mobilede-price-rating__sub') : null;
        const infoEl = wrap ? wrap.querySelector('.mobilede-price-rating__info') : null;
        const csInfo = infoEl ? getComputedStyle(infoEl) : null;
        const csTag = tagEl ? getComputedStyle(tagEl) : null;
        const ratingCache = adId ? (readRatingUiCache(adId) || readRatingCache(adId)) : null;
        const payload = {
            profileId: adId,
            cohortHuman: profile ? cohortHumanLabel(profile, getPriceRating(featureFlags)) : null,
            hasWidget: !!wrap,
            widgetClass: wrap ? wrap.className : null,
            hasRow: !!row,
            barsTotal: bars ? bars.length : 0,
            barsOn: barsOn ? barsOn.length : 0,
            labelText: labelEl ? labelEl.textContent.trim() : '',
            tagText: tagEl ? tagEl.textContent.trim() : '',
            subText: subEl ? subEl.textContent.trim() : '',
            infoButtonText: infoEl ? infoEl.textContent.trim() : '',
            infoButtonStyle: csInfo ? {
                width: csInfo.width,
                height: csInfo.height,
                lineHeight: csInfo.lineHeight,
                fontSize: csInfo.fontSize,
                fontWeight: csInfo.fontWeight,
                fontFamily: csInfo.fontFamily,
                borderRadius: csInfo.borderRadius,
                borderTop: csInfo.borderTopWidth + ' ' + csInfo.borderTopStyle + ' ' + csInfo.borderTopColor
            } : null,
            tagStyle: csTag ? {
                fontSize: csTag.fontSize,
                lineHeight: csTag.lineHeight,
                padding: csTag.padding
            } : null,
            ratingCache: ratingCache ? {
                ok: !!ratingCache.ok,
                label: ratingCache.label || null,
                level: typeof ratingCache.level === 'number' ? ratingCache.level : null,
                price: typeof ratingCache.price === 'number' ? ratingCache.price : null,
                adjustedExpected: typeof ratingCache.adjustedExpected === 'number' ? ratingCache.adjustedExpected : null,
                basePrice: typeof ratingCache.basePrice === 'number' ? ratingCache.basePrice : null,
                devEuro: typeof ratingCache.devEuro === 'number' ? ratingCache.devEuro : null,
                devPct: typeof ratingCache.devPct === 'number'
                    ? Math.round(ratingCache.devPct * 10000) / 100
                    : null,
                mobileLabel: ratingCache.mobileLabel || null,
                cohortCount: typeof ratingCache.cohortCount === 'number' ? ratingCache.cohortCount : null,
                cohortVipDetailCount: typeof ratingCache.cohortVipDetailCount === 'number' ? ratingCache.cohortVipDetailCount : null,
                usedMobileFallback: !!ratingCache.usedMobileFallback,
                insufficientCohort: !!ratingCache.insufficientCohort
            } : null
        };
        console.info('[mobilede Preis]', 'Manuelle Preisbewertung-UI', payload);
        appendSrpDebugLog('info', 'Manuelle Preisbewertung-UI', payload);
        showToast('Preisbewertung-UI wurde geloggt', 'success');
    }

    function renderDebugLogIntoCard(cardId) {
        const existing = document.getElementById(cardId);
        if (!existing) return;
        const logBox = existing.querySelector('.mobilede-srp-debug-card__log');
        const copyBtn = existing.querySelector('.mobilede-srp-debug-card__btn[data-copy-log="1"]');
        if (copyBtn) {
            const hasLogs = srpDebugLogEntries.length > 0;
            copyBtn.disabled = !hasLogs;
            copyBtn.title = hasLogs ? 'Logs in Zwischenablage kopieren' : 'Keine Logs zum Kopieren vorhanden';
        }
        if (!logBox) return;
        logBox.innerHTML = '';
        if (srpDebugLogEntries.length === 0) {
            logBox.textContent = 'Noch keine Logs vorhanden.';
            return;
        }
        srpDebugLogEntries.slice().reverse().forEach(entry => {
            const line = document.createElement('div');
            line.className = 'mobilede-srp-debug-card__log-line mobilede-srp-debug-card__log-line--' + entry.level;
            line.textContent = entry.text;
            logBox.appendChild(line);
        });
    }

    function renderSrpDebugLogCard() {
        renderDebugLogIntoCard('mobilede-srp-debug-card');
        renderDebugLogIntoCard('mobilede-detail-debug-card');
        wireDebugCardCopyButtons();
    }

    function wireDebugCardCopyButtons() {
        const cards = ['mobilede-srp-debug-card', 'mobilede-detail-debug-card'];
        cards.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (!card) return;
            const buttons = card.querySelectorAll('.mobilede-srp-debug-card__btn');
            buttons.forEach(btn => {
                const txt = (btn.textContent || '').toLowerCase();
                if (!txt.includes('copy')) return;
                btn.onclick = () => { copySrpDebugLogToClipboard(btn); };
            });
        });
    }

    function removeSrpDebugLogCard() {
        const existing = document.getElementById('mobilede-srp-debug-card');
        if (existing) existing.remove();
    }

    function removeDetailDebugLogCard() {
        const existing = document.getElementById('mobilede-detail-debug-card');
        if (existing) existing.remove();
    }

    function ensureSrpDebugLogCard() {
        if (!isSearchResultsPage() || !isSrpLogCardEnabled(featureFlags)) {
            removeSrpDebugLogCard();
            return;
        }
        injectPriceRatingStyles();
        const summarySection = document.querySelector(
            'div.leHcX article.A3G6X.vTKPY section.HaBLt.ku0Os.Ln3aV'
        );
        const summaryArticle = summarySection ? summarySection.closest('article.A3G6X.vTKPY') : null;
        const leftFilterSection = document.querySelector('section[data-testid="search-column-content-section"]');
        const topBtn = leftFilterSection && leftFilterSection.querySelector('button[data-testid="dsp-button-top"]');
        const fallbackParent = topBtn ? topBtn.parentElement : (leftFilterSection ? leftFilterSection.querySelector('[data-testid="search-column-content"]') : null);
        if (!summarySection && !fallbackParent) return;

        let card = document.getElementById('mobilede-srp-debug-card');
        if (!card) {
            card = document.createElement('div');
            card.id = 'mobilede-srp-debug-card';
            card.className = 'mobilede-srp-debug-card';

            const title = document.createElement('div');
            title.className = 'mobilede-srp-debug-card__title';
            title.textContent = 'Mobile.de Debug-Logs';
            card.appendChild(title);

            const actions = document.createElement('div');
            actions.className = 'mobilede-srp-debug-card__actions';
            const bSrp = document.createElement('button');
            bSrp.type = 'button';
            bSrp.className = 'mobilede-srp-debug-card__btn';
            bSrp.textContent = 'SRP-Status jetzt loggen';
            bSrp.addEventListener('click', runManualSrpStatusLog);
            actions.appendChild(bSrp);
            const bClear = document.createElement('button');
            bClear.type = 'button';
            bClear.className = 'mobilede-srp-debug-card__btn';
            bClear.textContent = 'Logs leeren';
            bClear.addEventListener('click', clearSrpDebugLog);
            actions.appendChild(bClear);
            const bCopy = document.createElement('button');
            bCopy.type = 'button';
            bCopy.className = 'mobilede-srp-debug-card__btn';
            bCopy.textContent = '⧉ Copy';
            bCopy.dataset.defaultLabel = bCopy.textContent;
            bCopy.dataset.copyLog = '1';
            bCopy.title = 'Logs in Zwischenablage kopieren';
            bCopy.addEventListener('click', () => { copySrpDebugLogToClipboard(bCopy); });
            actions.appendChild(bCopy);
            card.appendChild(actions);

            const logBox = document.createElement('div');
            logBox.className = 'mobilede-srp-debug-card__log';
            card.appendChild(logBox);
        }
        if (summaryArticle) {
            const shouldMove = card.parentElement !== summaryArticle.parentElement
                || card.previousElementSibling !== summaryArticle;
            if (shouldMove) summaryArticle.insertAdjacentElement('afterend', card);
        } else if (summarySection) {
            const shouldMove = card.parentElement !== summarySection.parentElement
                || card.previousElementSibling !== summarySection;
            if (shouldMove) summarySection.insertAdjacentElement('afterend', card);
        } else if (topBtn) {
            const shouldMove = card.parentElement !== topBtn.parentElement
                || card.previousElementSibling !== topBtn;
            if (shouldMove) topBtn.insertAdjacentElement('afterend', card);
        } else if (fallbackParent && !card.parentElement) {
            fallbackParent.prepend(card);
        } else if (fallbackParent) {
            if (card.parentElement !== fallbackParent) fallbackParent.appendChild(card);
        }
        renderSrpDebugLogCard();
    }

    function ensureDetailDebugLogCard() {
        if (!isVehicleDetailPage() || !isSrpLogCardEnabled(featureFlags)) {
            removeDetailDebugLogCard();
            return;
        }
        injectPriceRatingStyles();
        const galleryArticle = document.querySelector('article[data-testid="gallery-main-focus-container"]');
        if (!galleryArticle || !galleryArticle.parentElement) return;

        let card = document.getElementById('mobilede-detail-debug-card');
        if (!card) {
            card = document.createElement('div');
            card.id = 'mobilede-detail-debug-card';
            card.className = 'mobilede-srp-debug-card mobilede-srp-debug-card--detail';

            const title = document.createElement('div');
            title.className = 'mobilede-srp-debug-card__title';
            title.textContent = 'Mobile.de Debug-Logs (Detailseite)';
            card.appendChild(title);

            const actions = document.createElement('div');
            actions.className = 'mobilede-srp-debug-card__actions';
            const bCohort = document.createElement('button');
            bCohort.type = 'button';
            bCohort.className = 'mobilede-srp-debug-card__btn';
            bCohort.textContent = 'Kohorte jetzt loggen';
            bCohort.addEventListener('click', runManualCohortLog);
            actions.appendChild(bCohort);
            const bRatingUi = document.createElement('button');
            bRatingUi.type = 'button';
            bRatingUi.className = 'mobilede-srp-debug-card__btn';
            bRatingUi.textContent = 'Preisbewertung-UI loggen';
            bRatingUi.addEventListener('click', runManualPriceRatingUiLog);
            actions.appendChild(bRatingUi);
            const bClear = document.createElement('button');
            bClear.type = 'button';
            bClear.className = 'mobilede-srp-debug-card__btn';
            bClear.textContent = 'Logs leeren';
            bClear.addEventListener('click', clearSrpDebugLog);
            actions.appendChild(bClear);
            const bCopy = document.createElement('button');
            bCopy.type = 'button';
            bCopy.className = 'mobilede-srp-debug-card__btn';
            bCopy.textContent = '⧉ Copy';
            bCopy.dataset.defaultLabel = bCopy.textContent;
            bCopy.dataset.copyLog = '1';
            bCopy.title = 'Logs in Zwischenablage kopieren';
            bCopy.addEventListener('click', () => { copySrpDebugLogToClipboard(bCopy); });
            actions.appendChild(bCopy);
            card.appendChild(actions);

            const logBox = document.createElement('div');
            logBox.className = 'mobilede-srp-debug-card__log';
            card.appendChild(logBox);
        }

        const shouldMove = card.parentElement !== galleryArticle.parentElement
            || card.previousElementSibling !== galleryArticle;
        if (shouldMove) galleryArticle.insertAdjacentElement('afterend', card);
        renderSrpDebugLogCard();
    }

    function getSrpSearchFingerprint() {
        const u = new URL(location.href);
        const parts = [];
        for (const [k, v] of u.searchParams.entries()) {
            if (SRP_FINGERPRINT_EXCLUDE.has(k)) continue;
            parts.push(k + '=' + v);
        }
        parts.sort((a, b) => a.localeCompare(b));
        return u.pathname + (parts.length ? '?' + parts.join('&') : '');
    }

    function getSrpConfigSort() {
        const opt = findSrpSortOption(getSrpSort(featureFlags).sortId);
        return { sb: opt.sb, od: opt.od };
    }

    function urlSortMatchesUserChoice(fp) {
        const choice = getStoredSrpUserChoice();
        if (!choice || choice.fp !== fp) return false;
        return srpSortParamsEqual(parseSortFromUrl(), choice);
    }

    function parseSortFromUrl(href) {
        const u = new URL(href || location.href);
        return { sb: u.searchParams.get('sb'), od: u.searchParams.get('od') || 'up' };
    }

    /** Nach Reload: gespeicherte User-Sort oder Abweichung von zuletzt gesetzter Config-Sort. */
    function detectUserSortAfterReload(fp) {
        const srp = getSrpSort(featureFlags);
        if (!srp.enabled) return false;

        if (urlSortMatchesUserChoice(fp)) {
            srpSortUserOverrideFp = fp;
            return true;
        }

        const current = parseSortFromUrl();
        const configSort = getSrpConfigSort();
        if (srpSortParamsEqual(current, configSort)) return false;

        const applied = getStoredSrpSortApplied();
        if (applied && applied.fp === fp && !srpSortParamsEqual(current, applied)) {
            markSrpSortUserOverride(current);
            return true;
        }
        return false;
    }

    function applySrpDefaultSort(force) {
        if (!isSearchResultsPage()) return;
        const srp = getSrpSort(featureFlags);
        if (!srp.enabled) return;
        const fp = getSrpSearchFingerprint();
        if (!force && (hasSrpSortUserOverride(fp) || urlSortMatchesUserChoice(fp))) return;

        const configSort = getSrpConfigSort();
        const current = parseSortFromUrl();
        if (srpSortParamsEqual(current, configSort)) {
            markSrpSortApplied(fp, configSort.sb, configSort.od);
            return;
        }

        applyingDefaultSrpSort = true;
        try {
            const u = new URL(location.href);
            u.searchParams.set('sb', configSort.sb);
            u.searchParams.set('od', configSort.od);
            const newUrl = u.toString();
            markSrpSortApplied(fp, configSort.sb, configSort.od);
            lastUrl = newUrl;
            location.replace(newUrl);
        } finally {
            applyingDefaultSrpSort = false;
        }
    }

    function resetSrpSortOverrideAndApply() {
        clearSrpSortSessionState();
        applySrpDefaultSort(true);
    }

    function bindSrpSortDropdown() {
        if (!isSearchResultsPage()) return;
        const sel = document.getElementById('sorting-menu-dropdown');
        if (!sel || sel.dataset.mobiledeSrpBound === '1') return;
        sel.dataset.mobiledeSrpBound = '1';
        const onUserSort = () => {
            if (applyingDefaultSrpSort) return;
            markSrpSortUserOverride(parseSortFromUrl());
        };
        sel.addEventListener('change', onUserSort, true);
        sel.addEventListener('input', onUserSort, true);
        sel.addEventListener('pointerdown', () => {
            sel.dataset.mobiledeSortTouched = '1';
        }, true);
    }

    function pollSrpSortFromUrl() {
        if (!isSearchResultsPage() || applyingDefaultSrpSort) return;
        const srp = getSrpSort(featureFlags);
        if (!srp.enabled) return;

        const fp = getSrpSearchFingerprint();
        const current = parseSortFromUrl();
        const configSort = getSrpConfigSort();
        const key = fp + '|' + (current.sb || '') + '|' + current.od;

        if (lastPolledSrpSort === key) return;
        const prev = lastPolledSrpSort;
        lastPolledSrpSort = key;

        if (prev === null) return;

        if (!srpSortParamsEqual(current, configSort)) {
            markSrpSortUserOverride(current);
        }
    }

    function destroySrpSortBehavior() {
        if (srpSortMo) {
            srpSortMo.disconnect();
            srpSortMo = null;
        }
        if (srpSortPollTimerId != null) {
            clearInterval(srpSortPollTimerId);
            srpSortPollTimerId = null;
        }
        if (srpSortOnPageshow) {
            window.removeEventListener('pageshow', srpSortOnPageshow);
            srpSortOnPageshow = null;
        }
    }

    function syncSrpPolledSortKey(fp) {
        const cur = parseSortFromUrl();
        lastPolledSrpSort = fp + '|' + (cur.sb || '') + '|' + cur.od;
    }

    function handleSrpUrlChange() {
        if (!isSearchResultsPage()) return;
        bindSrpSortDropdown();
        const fp = getSrpSearchFingerprint();
        if (fp !== lastSrpFingerprint) {
            lastSrpFingerprint = fp;
            lastPolledSrpSort = null;
            clearSrpSortSessionState();
            applySrpDefaultSort(false);
            return;
        }

        pollSrpSortFromUrl();
    }

    function ensureSrpSortBehavior() {
        if (!isSearchResultsPage()) {
            destroySrpSortBehavior();
            return;
        }
        if (srpSortPollTimerId != null) return;

        const fp = getSrpSearchFingerprint();
        lastSrpFingerprint = fp;
        lastPolledSrpSort = null;

        const choice = getStoredSrpUserChoice();
        if (choice && choice.fp === fp) srpSortUserOverrideFp = fp;

        bindSrpSortDropdown();
        if (!detectUserSortAfterReload(fp)) {
            applySrpDefaultSort(false);
        }
        syncSrpPolledSortKey(fp);

        srpSortMo = new MutationObserver(() => bindSrpSortDropdown());
        srpSortMo.observe(document.body, { childList: true, subtree: true });

        srpSortOnPageshow = () => {
            if (!isSearchResultsPage()) return;
            const fpNow = getSrpSearchFingerprint();
            if (detectUserSortAfterReload(fpNow)) syncSrpPolledSortKey(fpNow);
        };
        window.addEventListener('pageshow', srpSortOnPageshow);

        srpSortPollTimerId = setInterval(pollSrpSortFromUrl, 400);
    }

    function initSrpSortBehavior() {
        destroySrpSortBehavior();
        ensureSrpSortBehavior();
    }

    let lastUrl = location.href;
    function onUrlChange() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        vipRatingUiBootstrapped = false;
        clearResults();
        priceRatingFetchToken++;
        clearPriceRatingUi();
        startObserver();
        trigger();
        if (isSearchResultsPage()) {
            ensureSrpSortBehavior();
            handleSrpUrlChange();
            ensureSrpPriceRatingObserver();
            ensureSrpDebugLogCard();
            removeDetailDebugLogCard();
        } else {
            destroySrpSortBehavior();
            if (srpPriceRatingIo) {
                srpPriceRatingIo.disconnect();
                srpPriceRatingIo = null;
            }
            removeSrpDebugLogCard();
            ensureDetailDebugLogCard();
        }
        setTimeout(() => {
            if (!document.querySelector('#mobilede-config-btn')) erstelleKonfigButton();
        }, 1500);
    }

    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);
    setInterval(onUrlChange, 1000);
    window.addEventListener('scroll', markSrpInteraction, { passive: true });
    window.addEventListener('pointermove', markSrpInteraction, { passive: true });

    window.addEventListener('storage', e => {
        if (e.key !== PRICE_COHORT_CACHE_PREFIX + '_updated') return;
        if (!isVehicleDetailPage()) return;
        invalidateVipRatingCacheForReload();
        priceRatingFetchToken++;
        scheduleTask('rating:vip-storage-refresh', 'rating', () => { preisBewertungAktualisieren({ force: true }); });
    });

    startObserver();
    trigger();
    scheduleTask('rating:vip-initial-detail', 'rating', () => { preisBewertungAktualisieren({ force: true }); });
    initSrpSortBehavior();
    scheduleTask('rating:srp-observer-init', 'rating', () => ensureSrpPriceRatingObserver());
    scheduleTask('ui:srp-debug-card-init', 'ui', () => ensureSrpDebugLogCard());
    scheduleTask('ui:detail-debug-card-init', 'ui', () => ensureDetailDebugLogCard());

    // Hilfe-Texte für Konfig-Popup (Tabs). Statisches HTML, nur innerHTML aus diesem Map.
    const KONFIG_TAB_HELP_HTML = new Map([
        ['aus', `
<h4>Was macht das?</h4>
<p>Hier konfigurierst du, welche Ausstattungsbegriffe (z.B. „Sitzheizung", „Panoramadach") auf einer mobile.de-Detailseite gesucht und im Ergebnis angezeigt werden.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter (links)</strong>: Eintrag ein-/ausschalten. Inaktive werden ignoriert.</li>
<li><strong>Anzeigetext</strong>: Wie der Treffer im Ergebnisbereich erscheint (z.B. „Sitzheizung").</li>
<li><strong>Farbe</strong>: Hintergrundakzent im Ergebnis. Klick auf das Quadrat öffnet einen Color-Picker; alternativ Hex-Code (<code>#66ff66</code>) oder Schlüsselwort (<code>red</code>, <code>orange</code>).</li>
<li><strong>Nur Ausstattungsliste</strong>: Treffer werden <strong>nur</strong> in der strukturierten Ausstattungsliste / Tech-Daten gezählt. Beschreibungstext wird ignoriert. Empfohlen für sicherheitskritische Begriffe wie „Anhängerkupplung" oder Sound-Systeme.</li>
<li><strong>Wortteil-Suche</strong>: Erlaubt Treffer auch mitten in zusammengesetzten Wörtern (z.B. „heizung" findet „Standheizung"). Vorsicht: kann False-Positives erzeugen.</li>
<li><strong>Details [N]</strong> öffnet erweiterte Optionen mit den eigentlichen Suchbegriffen und Verboten (Komma-getrennt).</li>
<li><strong>Stern (☆/★)</strong>: Favorit markieren. Favoriten erscheinen oben (eigener Block mit Trenner) und im Suchergebnis auf der Fahrzeugseite zuerst.</li>
<li><strong>Listen-Reihenfolge</strong> (Tab Config): Modus <em>Manuell</em> + Bereich „Gesamte Ausstattungsliste“ oder „Favoriten“ aktiviert Drag&amp;Drop (⋮⋮) mit sichtbarer Zeilenbewegung. Modus <em>Alphabetisch</em>: Speichern sortiert nach Anzeigetext.</li>
<li><strong>Spaltenköpfe</strong> sortieren die Anzeige (bei manueller Reihenfolge deaktiviert).</li>
<li><strong>Ziehen</strong> (⋮⋮): ganze Zeile als Vorschau; Live-Platzhalter beim Ziehen.</li>
<li><strong>Filter</strong> „nur aktive“ / „nur Favoriten“ und <strong>Alle Einträge</strong> (Ein/Aus für alle Einträge im Tab) stehen in einer Zeile.</li>
<li><strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong> (mit Trennlinie) – nicht in der Listen-Toolbar.</li>
<li><strong>Listen-Layout</strong> (Tab Config): Umschaltung zwischen diesem klassischen Grid und der Split-View (Liste + Editor).</li>
</ul>`],
        ['aus_split', `
<h4>Was macht das?</h4>
<p>Wie im klassischen Modus — Ausstattungsbegriffe für die mobile.de-Detailseite konfigurieren.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Kompakte Zeilen (Aktiv, Favorit, Name, Farbe, Badges). Eintrag anklicken → Editor rechts.</li>
<li><strong>Editor rechts</strong>: Anzeigetext, Suchbegriffe und Verbote als <strong>Chips</strong> (Enter oder Komma zum Hinzufügen, × zum Entfernen).</li>
<li><strong>Farbe</strong>, <strong>Nur Ausstattungsliste</strong>, <strong>Wortteil-Suche</strong>, <strong>Duplizieren</strong> und <strong>Löschen</strong> im Editor.</li>
<li><strong>Sortierung</strong> über Dropdown in der Toolbar (bei manueller Reihenfolge deaktiviert).</li>
<li><strong>Filter</strong> inkl. „Mit Verboten“; Favoriten-Block und Drag&amp;Drop (⋮⋮) wie bisher.</li>
<li>Auf schmalen Bildschirmen: Editor als Sheet von unten („Fertig“ zum Schließen).</li>
<li>Layout umschalten: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
        ['tech', `
<h4>Was macht das?</h4>
<p>Hier wählst du, welche technischen Datenfelder (aus dem mobile.de-Tech-Daten-Block) zusätzlich im Ergebnis angezeigt werden, z.B. „Erstzulassung" oder „Fahrzeugzustand".</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong> zum Ein-/Ausblenden.</li>
<li><strong>Begriff</strong>: Muss exakt mit dem <code>&lt;dt&gt;</code>-Label aus dem mobile.de-Tech-Daten-Block übereinstimmen (Groß-/Kleinschreibung egal).</li>
<li><strong>Suche</strong>, <strong>Alle Einträge</strong> (Ein/Aus für alle Tech-Einträge) und <strong>Spaltenköpfe</strong> wie auf der Ausstattungs-Seite. <strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Reihenfolge</strong> (Tab Config): Bereich „Tech-Daten“ + Modus Manuell → Drag&amp;Drop; optional Reihenfolge auf der Fahrzeugseite übernehmen.</li>
<li><strong>Reihenfolge</strong> per Drag&amp;Drop (⋮⋮) mit Live-Vorschau in der Liste.</li>
<li><strong>Listen-Layout</strong> (Tab Config): optional Split-View (Liste + Editor).</li>
</ul>`],
        ['tech_split', `
<h4>Was macht das?</h4>
<p>Technische Datenfelder aus dem mobile.de-Tech-Block für die Ergebnisanzeige wählen.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Aktiv-Schalter und gekürzter Begriff — Zeile anklicken für den Editor.</li>
<li><strong>Editor rechts</strong>: Vollständiger Begriff (exakt wie <code>&lt;dt&gt;</code>-Label), Option <strong>Aktiv</strong>, Löschen.</li>
<li><strong>Sortierung</strong> per Dropdown; Drag&amp;Drop bei manueller Tech-Reihenfolge (Config).</li>
<li>Layout: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
        ['merge', `
<h4>Was macht das?</h4>
<p>Mehrere getrennt gefundene Einträge mit gleichem Basis-Wort werden zu <strong>einer</strong> Zeile zusammengefasst. Beispiel: „Außenspiegel beheizbar", „Außenspiegel anklappbar", „Außenspiegel elektr. verstellbar" → eine Zeile <strong>Außenspiegel beheizbar, anklappbar, elektr. verstellbar</strong>.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong>: Inaktive Gruppen werden beim Zusammenfassen auf der Fahrzeugseite ignoriert.</li>
<li><strong>Basis</strong>: Das gemeinsame Wort, nach dem gruppiert wird (z.B. <code>außenspiegel</code>). Klein- und Großschreibung egal.</li>
<li><strong>Reihenfolge</strong>: Komma-getrennte Liste der Modifizierer-Schlüsselwörter in der gewünschten Reihenfolge im zusammengefassten Eintrag (z.B. <code>elektr. verstellbar, beheizbar, anklappbar</code>). Treffer, die in keiner Reihenfolge auftauchen, kommen ans Ende.</li>
<li><strong>Spaltenköpfe</strong> zum Sortieren, <strong>Filter „nur aktive“</strong> und <strong>Alle Einträge</strong> (Ein/Aus) in einer Zeile wie bei Ausstattung. Speichern sortiert alphabetisch nach Basis. <strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Layout</strong> (Tab Config): optional Split-View.</li>
</ul>`],
        ['merge_split', `
<h4>Was macht das?</h4>
<p>Merge-Gruppen fassen mehrere Treffer mit gleicher Basis zu einer Zeile zusammen.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Aktiv, Basis (gekürzt), Badge mit Anzahl Modifier.</li>
<li><strong>Editor rechts</strong>: Basis-Feld; Modifier-Reihenfolge als <strong>Chips</strong> (Enter/Komma); Option <strong>Aktiv</strong>, Löschen.</li>
<li><strong>Sortierung</strong> per Dropdown in der Toolbar.</li>
<li>Layout: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
        ['ie', `
<h4>Was macht das?</h4>
<p>Komplette Konfiguration als JSON sichern oder einspielen – praktisch zum Wechsel zwischen Browsern oder zum Verteilen einer Standardkonfiguration.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Export aktualisieren</strong> generiert das aktuelle JSON. <strong>Kopieren</strong> legt es in die Zwischenablage; <strong>Herunterladen</strong> speichert eine Datei <code>mobilede-config-YYYY-MM-DD.json</code>.</li>
<li><strong>Import</strong>: JSON entweder per <strong>Drag&amp;Drop</strong> der Datei auf die Drop-Zone oder direkt in die Textarea einfügen. <strong>Importieren</strong> überschreibt die aktuelle Konfiguration; ein automatisches Backup wird vorher angelegt und kann per <strong>Rückgängig</strong> im Footer zurückgeholt werden.</li>
</ul>`],
        ['config', `
<h4>Was macht das?</h4>
<p>Hier schaltest du Zusatz-Features des Skripts global ein oder aus. Änderungen werden mit <strong>Speichern</strong> übernommen und greifen sofort – auch ohne Seiten-Reload.</p>
<h4>So bedienst du es:</h4>
<ul>
<li>Jede Karte beschreibt ein Feature und besitzt einen Toggle.</li>
<li><strong>Automodus:</strong> Aus = nur Treffer aus deiner Ausstattungs-Konfiguration (wie bisher). An = vollständige Liste aus Ausstattungsliste und strukturierter Beschreibung; Konfig-Treffer farbig, unbekannte Zeilen mit <strong>+ Konfig</strong> übernehmbar.</li>
<li>Beim Deaktivieren werden bereits aktive Manipulationen (z.B. die Maps-Verlinkung) auf der gerade geöffneten Detailseite optisch zurückgenommen.</li>
<li><strong>Listen-Reihenfolge:</strong> Alphabetisch vs. manuell (Drag&amp;Drop). Bereiche: Favoriten, gesamte Ausstattungsliste, Tech-Daten (mehrfach wählbar). Optional: Reihenfolge in den Ergebnisblöcken auf der Fahrzeugseite.</li>
<li><strong>Suchergebnis-Sortierung:</strong> Standard-Sortierung für die PKW-Suchergebnisseite (z.&nbsp;B. Preis aufsteigend). Beim Öffnen einer neuen Suche wird sie gesetzt; änderst du sie danach im Dropdown von mobile.de, bleibt deine Wahl bis zur nächsten Suche (auch nach Seiten-Reload). Auf der Suchergebnisseite öffnest du dieses Popup über das Tampermonkey-Menü.</li>
<li>Neue Features werden automatisch mit ihren Standardwerten ergänzt; bestehende Einstellungen bleiben erhalten.</li>
<li><strong>Defaults zurücksetzen</strong> für alle Feature-Flags: Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Layout:</strong> Schaltet die Tabs Ausstattung, Tech-Daten und Merge-Gruppen zwischen klassischem Grid und Split-View (Liste + Editor) um. Gilt nach <strong>Speichern</strong>.</li>
<li><strong>Preisbewertung:</strong> Vollständig im Tab <strong>Config</strong> — Schwellen, €/Punkt, Vergleichskohorte, Ausstattungs-Gewichte. Änderungen mit starker Auswirkung fragen per Warnung nach.</li>
</ul>`]
    ]);

    // ============================================================
    // 11) Konfig-Popup
    // ============================================================
    function oeffneKonfigPopup() {
        const popupPerfStart = pricePerfMarkStart();
        const existingOverlay = document.querySelector('#mobilede-config-overlay');
        if (existingOverlay) {
            if (existingOverlay.querySelector('.mc-popup')) return;
            existingOverlay.remove();
        }

        let aktuelleAusstattungsKonfig = JSON.parse(JSON.stringify(suchKonfigurationen));
        let aktuelleTechKonfigurationen = JSON.parse(JSON.stringify(techDataKonfigurationen));
        let aktuelleMergeGruppen = JSON.parse(JSON.stringify(mergeGruppenConfig));
        let aktuelleFeatureFlags = mergeConfigListUi(
            featureFlags || {},
            { ...featureFlagsDefault(), ...(featureFlags || {}) }
        );
        aktuelleFeatureFlags.listOrder = mergeListOrder(aktuelleFeatureFlags.listOrder);
        aktuelleFeatureFlags.srpSort = mergeSrpSort(aktuelleFeatureFlags.srpSort);
        aktuelleFeatureFlags.priceRating = mergePriceRating(aktuelleFeatureFlags.priceRating);

        let baselineAus = JSON.parse(JSON.stringify(aktuelleAusstattungsKonfig));
        let baselineTech = JSON.parse(JSON.stringify(aktuelleTechKonfigurationen));
        let baselineMerge = JSON.parse(JSON.stringify(aktuelleMergeGruppen));
        let baselineFlags = JSON.parse(JSON.stringify(aktuelleFeatureFlags));

        function refreshSaveBaseline() {
            baselineAus = JSON.parse(JSON.stringify(aktuelleAusstattungsKonfig));
            baselineTech = JSON.parse(JSON.stringify(aktuelleTechKonfigurationen));
            baselineMerge = JSON.parse(JSON.stringify(aktuelleMergeGruppen));
            baselineFlags = JSON.parse(JSON.stringify(aktuelleFeatureFlags));
            baselineFlags.listOrder = mergeListOrder(baselineFlags.listOrder);
            baselineFlags.srpSort = mergeSrpSort(baselineFlags.srpSort);
            baselineFlags.priceRating = mergePriceRating(baselineFlags.priceRating);
            baselineFlags.configListUi = getConfigListUi(baselineFlags);
        }

        let dirty = false;
        let saveBtnRef = null;
        let activeTabIndex = 0;
        const undoStack = [];
        /** Max. eine Ausstattungs-Card mit geöffnetem Details-Panel — Array-Index in `aktuelleAusstattungsKonfig`. */
        let expandedAusstattungIndex = null;
        let selectedAusIndex = null;
        let selectedTechIndex = null;
        let selectedMergeIndex = null;
        const konfigHelpPanels = {};
        /** Hilfe-Panel je Tab (Ausstattung, Tech, Merge, Import/Export, Config) — vermeidet Zustandsverlust beim Tab-Wechsel. */
        const helpExpandedByTab = { aus: false, tech: false, merge: false, ie: false, config: false };
        const SCRIPT_UI_VERSION = '2.11.17';
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        let ausSort = { key: 'config', dir: 'asc' };
        let techSort = { key: 'config', dir: 'asc' };
        let mergeSort = { key: 'config', dir: 'asc' };

        const prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function syncSaveBtn() {
            if (!saveBtnRef) return;
            saveBtnRef.disabled = !dirty;
            saveBtnRef.classList.toggle('mc-btn--save-idle', !dirty);
            if (dirty) {
                saveBtnRef.textContent = 'Speichern';
            } else if (saveBtnRef.textContent !== '✔ Gespeichert') {
                saveBtnRef.textContent = 'Speichern';
            }
        }

        function recomputeDirty() {
            dirty = collectPendingChanges().length > 0;
            syncSaveBtn();
        }

        /** Setzt dirty anhand des echten Diff zur Popup-Baseline (nicht nur „jemals geändert“). */
        function markDirty() {
            recomputeDirty();
        }

        function normStrList(arr) {
            return [...(arr || [])].map(s => cleanText(s)).filter(Boolean).sort();
        }

        function arrayChangeSummary(before, after) {
            const b = normStrList(before);
            const a = normStrList(after);
            if (JSON.stringify(b) === JSON.stringify(a)) return null;
            const bSet = new Set(b);
            const aSet = new Set(a);
            let added = 0;
            let removed = 0;
            a.forEach(x => { if (!bSet.has(x)) added++; });
            b.forEach(x => { if (!aSet.has(x)) removed++; });
            if (added === 0 && removed === 0) return 'geändert';
            const parts = [];
            if (added > 0) parts.push('+' + added);
            if (removed > 0) parts.push('−' + removed);
            return parts.join(' / ');
        }

        function orderChangedByKey(baseline, current, keyFn) {
            const bKeys = baseline.map(keyFn);
            const cKeys = current.map(keyFn);
            if (bKeys.length !== cKeys.length) return false;
            const bSorted = [...bKeys].sort().join('\0');
            const cSorted = [...cKeys].sort().join('\0');
            if (bSorted !== cSorted) return false;
            return bKeys.join('\0') !== cKeys.join('\0');
        }

        function diffAusstattungLists(baseline, current, sectionLabel) {
            const lines = [];
            const keyFn = item => cleanText(item.anzeige || '');
            const baseMap = new Map();
            baseline.forEach(item => {
                const k = keyFn(item);
                if (k) baseMap.set(k, item);
            });
            const curMap = new Map();
            current.forEach(item => {
                const k = keyFn(item);
                if (k) curMap.set(k, item);
            });

            curMap.forEach((item, k) => {
                if (!baseMap.has(k)) {
                    lines.push('+ Neu (Ausstattung): ' + (item.anzeige || k).trim());
                }
            });
            baseMap.forEach((item, k) => {
                if (!curMap.has(k)) {
                    lines.push('− Entfernt (Ausstattung): ' + (item.anzeige || k).trim());
                }
            });
            curMap.forEach((after, k) => {
                const before = baseMap.get(k);
                if (!before) return;
                const name = (after.anzeige || before.anzeige || k).trim();
                if (!!before.aktiv !== !!after.aktiv) {
                    lines.push('✎ ' + name + ': aktiv ' + (before.aktiv ? 'Aktiv' : 'Aus') + ' → ' + (after.aktiv ? 'Aktiv' : 'Aus'));
                }
                if ((before.farbe || '') !== (after.farbe || '')) {
                    lines.push('✎ ' + name + ': Farbe geändert');
                }
                if (!!before.favorit !== !!after.favorit) {
                    lines.push('✎ ' + name + ': Favorit ' + (before.favorit ? 'ja' : 'nein') + ' → ' + (after.favorit ? 'ja' : 'nein'));
                }
                if (!!before.nurInFeatures !== !!after.nurInFeatures) {
                    lines.push('✎ ' + name + ': nur in Feature-Liste ' + (before.nurInFeatures ? 'an' : 'aus') + ' → ' + (after.nurInFeatures ? 'an' : 'aus'));
                }
                if (!!before.compound !== !!after.compound) {
                    lines.push('✎ ' + name + ': Substring-Match ' + (before.compound ? 'an' : 'aus') + ' → ' + (after.compound ? 'an' : 'aus'));
                }
                const bSum = arrayChangeSummary(before.begriffe, after.begriffe);
                if (bSum) lines.push('✎ ' + name + ': Suchbegriffe (' + bSum + ')');
                const vSum = arrayChangeSummary(before.verboten, after.verboten);
                if (vSum) lines.push('✎ ' + name + ': Verbotene Wörter (' + vSum + ')');
                const wB = Number(before.preisGewicht) || 0;
                const wA = Number(after.preisGewicht) || 0;
                if (wB !== wA) {
                    lines.push('✎ ' + name + ': Preis-Gewicht ' + wB + ' → ' + wA + ' Pkt.');
                }
            });
            if (orderChangedByKey(baseline, current, keyFn)) {
                lines.push('Reihenfolge in ' + sectionLabel + ' geändert');
            }
            return lines;
        }

        function diffTechLists(baseline, current) {
            const lines = [];
            const keyFn = item => cleanText(item.begriff || '');
            const baseMap = new Map();
            baseline.forEach(item => {
                const k = keyFn(item);
                if (k) baseMap.set(k, item);
            });
            const curMap = new Map();
            current.forEach(item => {
                const k = keyFn(item);
                if (k) curMap.set(k, item);
            });

            curMap.forEach((item, k) => {
                if (!baseMap.has(k)) lines.push('+ Neu (Tech): ' + (item.begriff || k).trim());
            });
            baseMap.forEach((item, k) => {
                if (!curMap.has(k)) lines.push('− Entfernt (Tech): ' + (item.begriff || k).trim());
            });
            curMap.forEach((after, k) => {
                const before = baseMap.get(k);
                if (!before) return;
                const name = (after.begriff || before.begriff || k).trim();
                if (!!before.aktiv !== !!after.aktiv) {
                    lines.push('✎ ' + name + ': aktiv ' + (before.aktiv ? 'Aktiv' : 'Aus') + ' → ' + (after.aktiv ? 'Aktiv' : 'Aus'));
                }
            });
            if (orderChangedByKey(baseline, current, keyFn)) {
                lines.push('Reihenfolge in Tech-Daten geändert');
            }
            return lines;
        }

        function diffMergeLists(baseline, current) {
            const lines = [];
            const keyFn = item => cleanText(item.basis || '');
            const baseMap = new Map();
            baseline.forEach(item => {
                const k = keyFn(item);
                if (k) baseMap.set(k, item);
            });
            const curMap = new Map();
            current.forEach(item => {
                const k = keyFn(item);
                if (k) curMap.set(k, item);
            });

            curMap.forEach((item, k) => {
                if (!baseMap.has(k)) lines.push('+ Neu (Merge): ' + (item.basis || k).trim());
            });
            baseMap.forEach((item, k) => {
                if (!curMap.has(k)) lines.push('− Entfernt (Merge): ' + (item.basis || k).trim());
            });
            curMap.forEach((after, k) => {
                const before = baseMap.get(k);
                if (!before) return;
                const name = (after.basis || before.basis || k).trim();
                if (!!before.aktiv !== !!after.aktiv) {
                    lines.push('✎ ' + name + ': aktiv ' + (before.aktiv ? 'Aktiv' : 'Aus') + ' → ' + (after.aktiv ? 'Aktiv' : 'Aus'));
                }
                const oSum = arrayChangeSummary(before.order, after.order);
                if (oSum) lines.push('✎ ' + name + ': Merge-Reihenfolge (' + oSum + ')');
            });
            if (orderChangedByKey(baseline, current, keyFn)) {
                lines.push('Reihenfolge in Merge-Gruppen geändert');
            }
            return lines;
        }

        function diffListOrder(baseline, current) {
            const lines = [];
            const b = mergeListOrder(baseline && baseline.listOrder);
            const c = mergeListOrder(current && current.listOrder);
            if (b.mode !== c.mode) {
                lines.push('Listen-Reihenfolge: Modus ' +
                    (b.mode === 'manual' ? 'manuell' : 'alphabetisch') + ' → ' +
                    (c.mode === 'manual' ? 'manuell' : 'alphabetisch'));
            }
            const scopeLabels = {
                ausstattungFavorites: 'Favoriten',
                ausstattung: 'Ausstattungsliste',
                tech: 'Tech-Daten'
            };
            Object.keys(scopeLabels).forEach(k => {
                if (!!b.scopes[k] !== !!c.scopes[k]) {
                    lines.push('Listen-Reihenfolge: ' + scopeLabels[k] + ' manuell ' +
                        (c.scopes[k] ? 'an' : 'aus'));
                }
            });
            if (!!b.applyToVehicleResults !== !!c.applyToVehicleResults) {
                lines.push('Listen-Reihenfolge: Fahrzeugseite ' +
                    (c.applyToVehicleResults ? 'übernimmt Reihenfolge' : 'alphabetisch/Favoriten'));
            }
            return lines;
        }

        function srpSortLabel(flags) {
            return findSrpSortOption(getSrpSort(flags).sortId).label;
        }

        function diffSrpSort(baseline, current) {
            const lines = [];
            const b = getSrpSort(baseline);
            const c = getSrpSort(current);
            if (!!b.enabled !== !!c.enabled) {
                lines.push('Suchergebnis-Sortierung: ' + (c.enabled ? 'an' : 'aus'));
            }
            if (b.enabled && c.enabled && b.sortId !== c.sortId) {
                lines.push('Suchergebnis-Sortierung: ' + srpSortLabel(baseline) + ' → ' + srpSortLabel(current));
            }
            return lines;
        }

        function diffPriceRating(baseline, current) {
            const lines = [];
            const b = getPriceRating(baseline);
            const c = getPriceRating(current);
            if (!!b.enabled !== !!c.enabled) {
                lines.push('Preisbewertung gesamt: ' + (c.enabled ? 'an' : 'aus'));
            }
            if (!!b.enabledVip !== !!c.enabledVip) {
                lines.push('Preisbewertung VIP: ' + (c.enabledVip ? 'an' : 'aus'));
            }
            if (!!b.enabledSrp !== !!c.enabledSrp) {
                lines.push('Preisbewertung SRP: ' + (c.enabledSrp ? 'an' : 'aus'));
            }
            if (!!b.mobileFallback !== !!c.mobileFallback) {
                lines.push('Preisbewertung mobile-Fallback: ' + (c.mobileFallback ? 'an' : 'aus'));
            }
            if (!!b.useModelRange !== !!c.useModelRange) {
                lines.push('Preisbewertung Baureihe-Filter: ' + (c.useModelRange ? 'an' : 'aus'));
            }
            if (!!b.keyUseMileage !== !!c.keyUseMileage) {
                lines.push('Preisbewertung Cache-Key km: ' + (c.keyUseMileage ? 'an' : 'aus'));
            }
            if (!!b.keyUseYear !== !!c.keyUseYear) {
                lines.push('Preisbewertung Cache-Key EZ: ' + (c.keyUseYear ? 'an' : 'aus'));
            }
            if (!!b.keyUsePower !== !!c.keyUsePower) {
                lines.push('Preisbewertung Cache-Key Leistung: ' + (c.keyUsePower ? 'an' : 'aus'));
            }
            if (b.keyKmBucket !== c.keyKmBucket) {
                lines.push('Preisbewertung Cache-Key km-Schritt: ' + b.keyKmBucket + ' → ' + c.keyKmBucket);
            }
            if (b.keyYearBucket !== c.keyYearBucket) {
                lines.push('Preisbewertung Cache-Key EZ-Schritt: ' + b.keyYearBucket + ' → ' + c.keyYearBucket);
            }
            if (b.keyPowerBucket !== c.keyPowerBucket) {
                lines.push('Preisbewertung Cache-Key kW-Schritt: ' + b.keyPowerBucket + ' → ' + c.keyPowerBucket);
            }
            if (b.minComparables !== c.minComparables) {
                lines.push('Preisbewertung min. Vergleiche: ' + b.minComparables + ' → ' + c.minComparables);
            }
            if (b.punktZuEuro !== c.punktZuEuro) {
                lines.push('Preisbewertung €/Punkt: ' + b.punktZuEuro + ' → ' + c.punktZuEuro);
            }
            if (b.maxAdjustPct !== c.maxAdjustPct) {
                lines.push('Preisbewertung max. Korrektur: ' + Math.round(b.maxAdjustPct * 100) + '% → '
                    + Math.round(c.maxAdjustPct * 100) + '%');
            }
            if (b.kmToleranceAbs !== c.kmToleranceAbs) {
                lines.push('Preisbewertung km-Toleranz (± km): ' + b.kmToleranceAbs + ' → ' + c.kmToleranceAbs);
            }
            if (b.yearTolerance !== c.yearTolerance) {
                lines.push('Preisbewertung EZ-Toleranz (± Jahre): ' + b.yearTolerance + ' → ' + c.yearTolerance);
            }
            if (b.powerToleranceKw !== c.powerToleranceKw) {
                lines.push('Preisbewertung Leistung-Toleranz (± kW): ' + b.powerToleranceKw + ' → ' + c.powerToleranceKw);
            }
            if (!!b.onlyFavoriteWeights !== !!c.onlyFavoriteWeights) {
                lines.push('Preisbewertung nur Favoriten-Gewichte: ' + (c.onlyFavoriteWeights ? 'an' : 'aus'));
            }
            b.thresholds.forEach((bt, i) => {
                const ct = c.thresholds[i];
                if (!ct || bt.maxPct === ct.maxPct) return;
                const fmt = v => (v === Infinity ? '∞' : Math.round(v * 100) + '%');
                lines.push('Preisbewertung Schwelle „' + PRICE_RATING_LEVELS[i].label + '“: '
                    + fmt(bt.maxPct) + ' → ' + fmt(ct.maxPct));
            });
            return lines;
        }

        function diffFeatureFlags(baseline, current) {
            const lines = diffListOrder(baseline, current);
            lines.push(...diffSrpSort(baseline, current));
            lines.push(...diffPriceRating(baseline, current));
            if (getConfigListUi(baseline) !== getConfigListUi(current)) {
                const labels = { classic: 'Klassisch', split: 'Split-View' };
                lines.push('Listen-Layout: ' + labels[getConfigListUi(baseline)] + ' → ' + labels[getConfigListUi(current)]);
            }
            FEATURE_FLAG_DEFINITIONS.forEach(def => {
                const bOn = baseline[def.key] !== false;
                const cOn = current[def.key] !== false;
                if (bOn !== cOn) {
                    lines.push(def.title + ': ' + (bOn ? 'Aktiv' : 'Aus') + ' → ' + (cOn ? 'Aktiv' : 'Aus'));
                }
            });
            return lines;
        }

        function collectPendingChanges() {
            const lines = [];
            lines.push(...diffAusstattungLists(baselineAus, aktuelleAusstattungsKonfig, 'Ausstattung'));
            lines.push(...diffTechLists(baselineTech, aktuelleTechKonfigurationen));
            lines.push(...diffMergeLists(baselineMerge, aktuelleMergeGruppen));
            lines.push(...diffFeatureFlags(baselineFlags, aktuelleFeatureFlags));
            return lines;
        }

        function injectStyles() {
            if (document.getElementById('mobilede-config-style')) return;
            const st = document.createElement('style');
            st.id = 'mobilede-config-style';
            st.textContent = `
#mobilede-config-overlay.mc-overlay-root{
  --mc-bg:#1a1b20;--mc-surface:#25262c;--mc-elevated:#32333a;--mc-border:#4a4b55;
  --mc-text:#f2f3f5;--mc-muted:#aeb0ba;--mc-accent:#2196f3;--mc-danger:#e57373;
  --mc-warn:#ffb74d;--mc-ok:#81c784;--mc-radius:10px;
  --mc-bg-soft:rgba(255,255,255,.07);
  backdrop-filter:blur(4px);
  -webkit-backdrop-filter:blur(4px);
}
.mc-popup{
  box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  color:var(--mc-text);background:var(--mc-surface);border-radius:var(--mc-radius);
  width:100%;max-width:920px;height:88vh;max-height:calc(100vh - 32px);display:flex;flex-direction:column;
  min-height:0;box-shadow:0 18px 50px rgba(0,0,0,.55);outline:none;
}
.mc-popup.mc-popup--config-split{max-width:1040px;}
.mc-popup--config-split .mc-popup__scroll{display:flex;flex-direction:column;min-height:0;}
.mc-popup--config-split .mc-panel--split-host.mc-panel--active{
  flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:8px;
}
.mc-config-split-root{
  display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;
}
.mc-config-split{
  display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:12px;
  flex:1;min-height:0;min-width:0;align-items:start;
}
.mc-config-split__list-scroll{
  overflow-y:auto;overflow-x:hidden;min-height:0;max-height:100%;
  -webkit-overflow-scrolling:touch;border:1px solid var(--mc-border);border-radius:10px;
  background:rgba(0,0,0,.08);padding:8px;
}
.mc-config-split__list{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
  gap:6px;align-content:start;
}
.mc-config-split__list > .mc-section-head,
.mc-config-split__list > .mc-section-divider,
.mc-config-split__list > .mc-empty-state{grid-column:1/-1;}
.mc-config-split__editor{
  position:sticky;top:0;align-self:start;max-height:100%;overflow-y:auto;
  padding:12px;border-radius:10px;box-sizing:border-box;
  background:rgba(0,0,0,.12);border:1px solid var(--mc-border);
}
.mc-config-split__editor-placeholder{color:var(--mc-muted);font-size:13px;line-height:1.45;padding:8px 4px;}
.mc-config-split__editor-title{font-size:12px;font-weight:600;color:var(--mc-muted);margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em;}
.mc-config-split__editor-fields{display:flex;flex-direction:column;gap:12px;}
.mc-config-split__editor-field{display:flex;flex-direction:column;gap:5px;}
.mc-config-split__editor-footer{
  margin-top:4px;padding-top:12px;
  display:flex;flex-direction:column;gap:10px;
}
.mc-config-split__editor-color-row{
  display:flex;align-items:center;gap:8px;
}
.mc-config-split__editor-color-row .mc-color-row{flex:1;min-width:0;display:flex;align-items:center;gap:8px;}
.mc-config-split__editor-color-row .mc-color-hex-input{flex:1;min-width:0;}
.mc-config-split__editor-color-row .mc-color-native-hidden{
  position:absolute;width:0;height:0;opacity:0;pointer-events:none;padding:0;border:0;
}
.mc-config-split__editor-color-swatch{
  width:38px;height:38px;min-width:38px;flex-shrink:0;border-radius:8px;
  border:none;padding:0;cursor:pointer;
}
.mc-config-split__editor-options{
  display:flex;flex-direction:column;gap:0;
  border:1px solid var(--mc-border);border-radius:8px;background:rgba(0,0,0,.1);overflow:hidden;
}
.mc-config-split__editor-check{
  display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
  font-size:13px;line-height:1.35;cursor:pointer;user-select:none;
  border-bottom:1px solid var(--mc-border);
}
.mc-config-split__editor-check:last-child{border-bottom:none;}
.mc-config-split__editor-check:hover{background:rgba(255,255,255,.03);}
.mc-config-split__editor-check input[type=checkbox]{
  margin:2px 0 0;flex-shrink:0;accent-color:var(--mc-accent);width:15px;height:15px;
}
.mc-config-split__editor-check-text{flex:1;min-width:0;}
.mc-config-split__editor-check-title{display:block;color:var(--mc-text);font-weight:500;}
.mc-config-split__editor-check-hint{display:block;font-size:11px;color:var(--mc-muted);margin-top:2px;line-height:1.35;}
.mc-config-split__editor-actions{
  display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;
  padding-top:10px;border-top:1px dashed var(--mc-border);margin-top:2px;
}
.mc-config-split__list-item.mc-card{
  display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;
  gap:6px;padding:6px 8px;margin:0;min-height:0;cursor:pointer;
  border:1px solid var(--mc-border);background:var(--mc-elevated);border-radius:8px;
  box-sizing:border-box;
}
.mc-config-split__list-item.mc-card:hover{background:rgba(255,255,255,.04);}
.mc-config-split__list-item--selected.mc-card{
  border-left:3px solid var(--mc-accent);padding-left:6px;
  background:rgba(33,150,243,.1);box-shadow:inset 0 0 0 1px rgba(33,150,243,.15);
}
.mc-config-split__list-item--inactive{opacity:.55;}
.mc-config-split__list-item-controls{
  display:flex;align-items:center;gap:4px;flex-shrink:0;
}
.mc-config-split__list-item-main{
  display:flex;align-items:center;gap:6px;flex:1;min-width:0;
}
.mc-config-split__list-item-label{
  flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:13px;line-height:1.25;
}
.mc-config-split__list-item-meta{
  display:flex;align-items:center;gap:4px;flex-shrink:0;flex-wrap:wrap;
}
.mc-config-split__list-item-badges{display:flex;flex-wrap:wrap;gap:3px;}
.mc-config-split__badge{font-size:10px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.08);color:var(--mc-muted);white-space:nowrap;}
.mc-config-split__color-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0;border:1px solid rgba(255,255,255,.2);}
.mc-config-split__warn{font-size:13px;color:var(--mc-warn);flex-shrink:0;line-height:1;}
.mc-config-split__list-item .mc-drag-handle{width:22px;min-width:22px;font-size:11px;padding:0;}
.mc-drag-spacer{width:26px;min-width:26px;flex-shrink:0;}
.mc-card__main-row--aus > .mc-drag-spacer{box-sizing:border-box;}
.mc-config-split__list-item .mc-fav-btn{width:30px;height:30px;min-width:30px;font-size:15px;}
.mc-config-split__list-item .mc-toggle-wrap{min-height:0;}
.mc-config-split--tech .mc-config-split__list,
.mc-config-split--merge .mc-config-split__list{grid-template-columns:1fr;}
.mc-chip-input{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;min-height:38px;
  border:1px solid var(--mc-border);border-radius:8px;background:var(--mc-elevated);
}
.mc-chip-input input{
  flex:1;min-width:80px;border:none;background:transparent;color:var(--mc-text);
  font-size:13px;padding:4px 2px;outline:none;
}
.mc-chip{
  display:inline-flex;align-items:center;gap:2px;font-size:12px;padding:2px 4px 2px 8px;border-radius:6px;
  background:var(--mc-elevated);border:1px solid var(--mc-border);color:var(--mc-text);
  max-width:100%;
}
.mc-chip__text{
  cursor:text;padding:2px 0;border-radius:3px;outline:none;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(200px,100%);
}
.mc-chip__text:hover{background:rgba(255,255,255,.06);}
.mc-chip__edit{
  border:1px solid var(--mc-accent);background:var(--mc-surface);color:var(--mc-text);
  font-size:12px;padding:2px 6px;border-radius:4px;min-width:72px;max-width:min(200px,100%);
  box-sizing:border-box;
}
.mc-chip--warn{border-color:rgba(255,152,0,.45);background:rgba(255,152,0,.12);}
.mc-chip--dup{border-color:var(--mc-danger);background:rgba(229,57,53,.15);}
.mc-chip__x{border:none;background:transparent;color:var(--mc-muted);cursor:pointer;padding:0 2px;font-size:14px;line-height:1;}
.mc-chip__x:hover{color:var(--mc-text);}
.mc-config-split__sheet-backdrop{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:8;
}
.mc-config-split__sheet-backdrop--open{display:block;}
.mc-config-split__sheet{
  display:none;position:fixed;left:0;right:0;bottom:0;max-height:80vh;z-index:9;
  background:var(--mc-surface);border-top:1px solid var(--mc-border);border-radius:12px 12px 0 0;
  flex-direction:column;box-shadow:0 -8px 32px rgba(0,0,0,.45);
}
.mc-config-split__sheet--open{display:flex;}
.mc-config-split__sheet-head{display:flex;justify-content:flex-end;padding:8px 12px;border-bottom:1px solid var(--mc-border);}
.mc-config-split__sheet-body{overflow-y:auto;padding:12px 16px 20px;flex:1;min-height:0;}
.mc-toolbar-sort{display:flex;align-items:center;gap:6px;}
.mc-toolbar-sort label{
  font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--mc-muted);white-space:nowrap;min-width:4.5rem;
}
.mc-toolbar-sort select{
  border:1px solid var(--mc-border);background:var(--mc-elevated);color:var(--mc-text);
  border-radius:8px;font-size:12px;padding:6px 8px;min-height:32px;
}
.mc-toolbar-split-only{display:none;}
.mc-popup--config-split .mc-toolbar-split-only{display:flex;}
.mc-popup--config-split .mc-toolbar-classic-only{display:none;}
@media(max-width:719px){
  .mc-config-split{
    grid-template-columns:1fr;
    grid-template-rows:minmax(140px,1fr) auto;
  }
  .mc-config-split__list{grid-template-columns:1fr;}
  .mc-config-split__editor{position:relative;max-height:min(45vh,320px);}
}
@media(max-width:559px){
  .mc-config-split .mc-config-split__editor{display:none;}
  .mc-config-split{grid-template-rows:1fr;}
}
.mc-popup__head{
  position:sticky;top:0;z-index:4;background:var(--mc-surface);
  border-bottom:1px solid var(--mc-border);padding:14px 16px 0;
}
.mc-popup__head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;}
.mc-popup__title{margin:0;font-size:19px;font-weight:600;line-height:1.2;}
.mc-popup__ver{font-size:11px;color:var(--mc-muted);font-weight:400;margin-top:2px;}
.mc-btn{
  appearance:none;border:1px solid var(--mc-border);background:var(--mc-elevated);color:var(--mc-text);
  border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;line-height:1.2;display:inline-flex;align-items:center;gap:6px;
}
.mc-btn:disabled{opacity:.45;cursor:not-allowed;}
.mc-btn:hover:not(:disabled){filter:brightness(1.06);}
.mc-btn--primary{background:#1976d2;border-color:#1976d2;color:#fff;}
.mc-btn--ghost{background:transparent;border-color:var(--mc-border);}
.mc-btn--danger{background:rgba(229,115,115,.15);border-color:#c62828;color:#ffcdd2;}
.mc-btn--toggle-active{background:rgba(25,118,210,.2);border-color:#1976d2;color:#d3e7ff;}
.mc-btn--action-dup:hover:not(:disabled){
  filter:none;background:rgba(33,150,243,.2);border-color:#2196f3;color:#90caf9;
}
.mc-btn--action-del:hover:not(:disabled){
  filter:none;background:rgba(229,57,53,.2);border-color:#c62828;color:#ffcdd2;
}
.mc-btn--action-prem:hover:not(:disabled){
  filter:none;opacity:1;background:rgba(229,57,53,.2);border-color:#c62828;color:#ffcdd2;
}
.mc-btn--action-clearw:hover:not(:disabled){
  filter:none;background:rgba(229,57,53,.2);border-color:#c62828;color:#ffcdd2;
}
.mc-icon-btn{background:transparent;border:none;color:var(--mc-muted);padding:6px;cursor:pointer;border-radius:8px;line-height:0;}
.mc-icon-btn:hover{color:#fff;background:var(--mc-elevated);}
.mc-tabs-strip{
  display:flex;flex-wrap:nowrap;gap:6px;margin-top:10px;margin-bottom:0;padding-bottom:10px;
  overflow-x:auto;-webkit-overflow-scrolling:touch;
}
@media(max-width:699px){.mc-tabs-strip{scrollbar-width:thin}}
.mc-tab{
  flex-shrink:0;border:1px solid var(--mc-border);background:var(--mc-elevated);color:var(--mc-muted);
  border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;white-space:nowrap;
}
.mc-tab:focus{outline:2px solid var(--mc-accent);outline-offset:2px;}
.mc-tab--active{border-color:#5c6bc0;background:#30334a;color:#fff;}
.mc-tab--config{margin-left:auto;}
.mc-tab-badge{opacity:.85;font-size:12px;margin-left:4px;}
.mc-popup__scroll{flex:1;min-height:0;overflow-y:auto;padding:12px 16px 8px;}
.mc-panel{display:none;flex-direction:column;min-height:0;gap:8px;}
.mc-panel--active{display:flex;}
.mc-toolbar{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin-bottom:4px;padding:12px;
  background:rgba(0,0,0,.12);border:1px solid var(--mc-border);border-radius:10px;}
.mc-toolbar--minimal{padding:8px 12px;gap:0;}
.mc-toolbar-meta{font-size:11px;color:var(--mc-muted);width:100%;}
.mc-toolbar-stats{font-size:12px;color:var(--mc-text);width:100%;line-height:1.35;}
.mc-toolbar-hint{font-size:11px;color:var(--mc-muted);width:100%;line-height:1.35;margin-top:2px;}
.mc-toolbar-help-slot{margin-left:auto;display:flex;align-items:center;flex-shrink:0;align-self:center;}
.mc-toolbar__row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;}
.mc-toolbar__row--search{display:flex;align-items:center;gap:8px;}
.mc-toolbar__row--search .mc-toolbar-zone--search{flex:1;min-width:0;}
.mc-toolbar__row--meta{align-items:flex-end;justify-content:space-between;gap:12px;}
.mc-toolbar-meta-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.mc-toolbar-meta-col .mc-toolbar-stats,.mc-toolbar-meta-col .mc-toolbar-hint{width:100%;}
.mc-toolbar__row--meta > .mc-btn--primary{flex-shrink:0;align-self:flex-end;}
.mc-toolbar__row--controls{align-items:center;gap:12px;}
.mc-toolbar__row--controls .mc-toolbar-zone--anzeige{flex:1 1 auto;min-width:0;}
.mc-toolbar__row--controls .mc-toolbar-zone--bulk{flex:0 0 auto;}
.mc-toolbar__row--controls .mc-toolbar-zone--bulk:first-child:last-child{margin-left:auto;}
.mc-toolbar__row--controls .mc-toolbar-zone--bulk:not(:first-child){
  padding-left:12px;margin-left:4px;border-left:1px solid var(--mc-border);
}
.mc-toolbar-zone{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;}
.mc-toolbar-zone--stack{flex-direction:column;align-items:flex-start;gap:6px;}
.mc-toolbar-zone__label{
  font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--mc-muted);flex-shrink:0;min-width:4.5rem;
}
.mc-toolbar-zone__body{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;flex:1;}
.mc-toolbar-zone--stack .mc-toolbar-zone__body{width:100%;}
.mc-btn-group{display:inline-flex;align-items:stretch;}
.mc-btn-group .mc-btn{border-radius:0;margin:0;}
.mc-btn-group .mc-btn:first-child{border-top-left-radius:8px;border-bottom-left-radius:8px;}
.mc-btn-group .mc-btn:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px;}
.mc-btn-group .mc-btn + .mc-btn{margin-left:-1px;}
.mc-foot-sep{
  display:inline-block;width:1px;height:24px;background:var(--mc-border);margin:0 4px;flex-shrink:0;
}
.mc-foot-reset{display:none;}
.mc-foot-reset.mc-foot-reset--visible{display:inline-flex;}
.mc-toolbar-toggle{display:inline-flex;align-items:center;gap:8px;padding:3px 14px 3px 5px;
  background:rgba(255,255,255,.04);border:1px solid var(--mc-border);border-radius:999px;
  font-size:13px;color:var(--mc-text);cursor:pointer;user-select:none;align-self:center;
  transition:background .15s ease,border-color .15s ease;}
.mc-toolbar-toggle:hover{background:rgba(255,255,255,.07);border-color:var(--mc-border-strong,#5a5d66);}
.mc-toolbar-toggle:has(input:checked){background:rgba(25,118,210,.18);border-color:#1976d2;}
.mc-toolbar-toggle > .mc-toggle{flex-shrink:0;}
.mc-toolbar-toggle--plain{
  padding:0;background:transparent;border:none;border-radius:0;
}
.mc-toolbar-toggle--plain:hover{background:transparent;border:none;}
.mc-toolbar-toggle--plain:has(input:checked){background:transparent;border:none;}
.mc-col-sort-header{
  padding:6px 10px;margin-bottom:8px;
  background:rgba(0,0,0,.2);border:1px solid var(--mc-border);border-radius:8px;
  box-sizing:border-box;
}
.mc-aus-grid{
  display:grid;
  grid-template-columns:26px 38px 44px minmax(100px,1.35fr) 142px minmax(9.2rem,0.95fr) minmax(8.2rem,0.9fr) minmax(5.8rem,auto);
  gap:8px;align-items:center;
}
.mc-tech-grid{
  display:grid;
  grid-template-columns:26px 44px minmax(120px,1fr) 76px;
  gap:8px;align-items:center;
}
.mc-merge-grid{
  display:grid;
  grid-template-columns:44px minmax(140px,1.05fr) minmax(200px,1.2fr) 72px;
  gap:10px;align-items:center;
}
.mc-col-sort-header.mc-aus-grid{min-width:720px;}
.mc-col-sort-header.mc-tech-grid{min-width:420px;}
.mc-col-sort-header.mc-merge-grid{min-width:580px;}
.mc-col-sort-spacer,.mc-col-sort-inert{display:block;min-height:1px;}
.mc-col-sort-btn{
  appearance:none;border:1px solid transparent;background:transparent;
  color:var(--mc-muted);font-size:11px;font-weight:600;line-height:1.2;
  padding:5px 4px;border-radius:6px;cursor:pointer;white-space:nowrap;
  width:100%;box-sizing:border-box;text-align:center;min-width:0;
}
.mc-col-sort-btn:hover{color:var(--mc-text);background:rgba(255,255,255,.07);border-color:var(--mc-border);}
.mc-col-sort-btn--active{color:#fff;border-color:#5c6bc0;background:#30334a;}
.mc-col-sort-btn--left{text-align:left;padding-left:6px;}
.mc-section-head{font-size:12px;font-weight:600;color:var(--mc-muted);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px;padding:0 2px;}
.mc-section-head:first-child{margin-top:0;}
.mc-section-divider{border:none;border-top:1px solid var(--mc-border);margin:12px 0 8px;}
.mc-fav-btn{
  flex-shrink:0;border:1px solid var(--mc-border);background:transparent;color:var(--mc-muted);
  border-radius:8px;width:38px;height:38px;font-size:18px;line-height:1;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center;
}
.mc-fav-btn:hover{background:rgba(255,255,255,.06);color:#f5d442;}
.mc-fav-btn--on{color:#f5d442;border-color:rgba(245,212,66,.45);background:rgba(245,212,66,.12);}
.mc-card--inactive-merge{opacity:.72;}
.mc-help-btn{min-width:36px;padding:7px 10px;justify-content:center;font-weight:600;}
.mc-help-btn .mc-help-btn__q{font-size:15px;line-height:1;}
.mc-help-panel{
  box-sizing:border-box;width:100%;align-self:stretch;
  max-height:0;overflow:hidden;transition:max-height .32s ease,opacity .2s ease,margin .2s ease;
  opacity:0;margin:0;padding:0;border:1px solid transparent;border-radius:10px;background:transparent;
}
.mc-help-panel--open{
  flex:0 0 auto;
  max-height:min(70vh,720px);overflow-y:auto;opacity:1;margin-bottom:8px;
  border-color:var(--mc-border);background:var(--mc-bg-soft);
}
.mc-help-panel__head{display:flex;justify-content:flex-end;align-items:center;padding:6px 8px 0;}
.mc-help-panel__close{padding:4px;}
.mc-help-panel__body{padding:4px 12px 12px;font-size:13px;line-height:1.45;color:var(--mc-text);}
.mc-help-panel__body h4{margin:10px 0 6px;font-size:13px;font-weight:600;color:var(--mc-text);}
.mc-help-panel__body h4:first-child{margin-top:0;}
.mc-help-panel__body p{margin:0 0 8px;}
.mc-help-panel__body ul{margin:0 0 4px;padding-left:20px;}
.mc-help-panel__body li{margin:4px 0;}
.mc-help-panel__body code{font-size:12px;background:rgba(0,0,0,.25);padding:1px 5px;border-radius:4px;}
.mc-input,.mc-textarea,.mc-popup select{
  border:1px solid var(--mc-border);background:var(--mc-elevated);color:var(--mc-text);border-radius:8px;font-size:13px;
}
.mc-input{padding:8px 10px;min-height:38px;}
.mc-textarea{padding:8px 10px;resize:vertical;}
.mc-searchbox{flex:1;min-width:160px;display:flex;align-items:center;gap:6px;border:1px solid var(--mc-border);
  background:var(--mc-elevated);border-radius:8px;padding:2px 8px;}
.mc-searchbox input{flex:1;border:none;background:transparent;color:var(--mc-text);padding:6px 4px;outline:none;}
.mc-search-clear{border:none;background:transparent;color:var(--mc-muted);cursor:pointer;font-size:16px;line-height:1;padding:4px;}
.mc-card{
  border:1px solid var(--mc-border);border-radius:10px;background:var(--mc-elevated);
  padding:10px;margin-bottom:6px;display:flex;flex-direction:column;gap:8px;
}
.mc-card--invalid{border-color:#e53935;}
.mc-card__err{font-size:11px;color:#ffcdd2;margin:0;}
.mc-card__main-row{display:flex;align-items:flex-start;gap:8px;}
.mc-card__main-row--aus{
  display:grid;
  grid-template-columns:26px 38px 44px minmax(100px,1.35fr) 142px minmax(9.2rem,0.95fr) minmax(8.2rem,0.9fr) minmax(5.8rem,auto);
  gap:8px;align-items:center;min-width:720px;
}
.mc-card__main-row--tech{
  display:grid;
  grid-template-columns:26px 44px minmax(120px,1fr) 76px;
  gap:8px;align-items:center;min-width:420px;
}
.mc-card__main-row--merge.mc-merge-grid{
  display:grid;align-items:center;min-width:580px;
}
.mc-aus-list-scroll,.mc-tech-list-scroll,.mc-merge-list-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;}
.mc-card__main-row--merge > .mc-toggle-wrap{
  flex-shrink:0;display:flex;align-items:center;justify-content:center;
  align-self:center;min-height:38px;
}
.mc-card__main-row--merge .mc-input{
  min-width:0;width:100%;box-sizing:border-box;min-height:38px;
}
.mc-merge-modifier{
  resize:none;overflow:hidden;line-height:1.35;padding:8px 10px;
  min-height:38px;max-height:38px;field-sizing:fixed;
}
.mc-merge-modifier--expanded{
  max-height:min(200px,40vh);overflow-y:auto;white-space:pre-wrap;word-break:break-word;
  z-index:2;position:relative;box-shadow:0 4px 14px rgba(0,0,0,.35);
}
.mc-card__main-row--merge > .mc-btn{
  justify-self:stretch;align-self:center;white-space:nowrap;min-height:38px;padding:6px 10px;
}
.mc-card__main-row--tech > .mc-drag-handle,
.mc-card__main-row--tech > .mc-toggle-wrap,
.mc-card__main-row--tech > .mc-btn{
  box-sizing:border-box;min-height:38px;
}
.mc-card__main-row--tech > .mc-drag-handle{display:inline-flex;align-items:center;}
.mc-card__main-row--aus .mc-color-row input[type=color]{
  height:38px;min-height:38px;box-sizing:border-box;width:46px;padding:3px;
  flex-shrink:0;
}
.mc-card__main-row--aus .mc-pill{
  box-sizing:border-box;min-height:38px;padding:6px 10px;font-size:12px;line-height:1.2;
}
.mc-drag-handle{
  cursor:grab;user-select:none;touch-action:none;color:var(--mc-muted);font-size:15px;line-height:1.2;
  padding:6px 4px;border-radius:6px;flex-shrink:0;
}
.mc-drag-handle:active{cursor:grabbing;}
.mc-drag-handle--disabled{opacity:0.35;cursor:not-allowed;}
.mc-drag-handle--active{cursor:grabbing;}
.mc-card--drag-source-hidden{display:none!important;}
.mc-drag-float{
  opacity:1;background:var(--mc-surface,#25262c);
  box-shadow:0 10px 28px rgba(0,0,0,.5);outline:2px solid var(--mc-accent);
  border-radius:8px;pointer-events:none;box-sizing:border-box;
}
.mc-card--drop-target{box-shadow:inset 0 3px 0 var(--mc-accent);}
.mc-drop-placeholder{
  box-sizing:border-box;background:rgba(33,150,243,.12);border:2px dashed var(--mc-accent);
  border-radius:8px;margin:4px 0;pointer-events:none;transition:height .12s ease;
}
.mc-list-dragging{user-select:none;cursor:grabbing;}
.mc-list-dragging *{cursor:grabbing!important;}
.mc-config-panel{display:flex;flex-direction:column;gap:14px;min-height:0;}
.mc-config-body{display:flex;flex-direction:column;gap:16px;}
.mc-config-header{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:12px 14px;border-radius:10px;border:1px solid var(--mc-border);background:rgba(0,0,0,.12);
}
.mc-config-intro{margin:0;font-size:13px;line-height:1.5;color:var(--mc-muted);flex:1;min-width:0;}
.mc-config-intro strong{color:var(--mc-text);font-weight:600;}
.mc-config-section{display:flex;flex-direction:column;gap:10px;}
.mc-config-section-title{
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mc-muted);
  padding:0 2px;
}
.mc-config-features{display:flex;flex-direction:column;gap:8px;}
.mc-pr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 14px;margin-top:8px;}
.mc-pr-field{display:flex;flex-direction:column;gap:4px;}
.mc-pr-field--impact .mc-label-sm{color:#f0c878;}
.mc-pr-weights{
  max-height:280px;overflow:auto;border:1px solid var(--mc-border);border-radius:8px;
  margin-top:8px;background:rgba(0,0,0,.12);
}
.mc-pr-weight-row{
  display:grid;grid-template-columns:1fr 72px;gap:8px;align-items:center;
  padding:6px 10px;border-bottom:1px solid var(--mc-border);font-size:12px;
}
.mc-pr-weight-row:last-child{border-bottom:none;}
.mc-pr-weight-row--inactive{opacity:.55;}
.mc-pr-weight-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mc-pr-weight-inp{width:100%;padding:4px 6px;font-size:12px;}
.mc-pr-top{
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 14px;align-items:start;
}
.mc-pr-head-block{
  grid-column:1;display:flex;flex-direction:column;gap:4px;min-width:0;
}
.mc-pr-head-left{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;}
.mc-pr-beta-badge{
    display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;
    letter-spacing:.04em;text-transform:uppercase;color:#1a1d24;background:#f0c878;
}
.mc-pr-beta-notice{
  width:fit-content;max-width:100%;
  padding:6px 10px;border-radius:6px;font-size:12px;line-height:1.4;
  color:#e8dcc8;background:rgba(240,200,120,.12);border:1px solid rgba(240,200,120,.28);
}
.mc-pr-master-control{
  grid-column:2;display:flex;flex-shrink:0;align-items:center;gap:10px 12px;
}
.mc-pr-master-control .mc-feature-aside{flex-direction:column;min-width:76px;padding:0;align-self:auto;}
.mc-pr-body--disabled{opacity:.5;pointer-events:none;user-select:none;}
.mc-pr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.mc-pr-thresholds{display:flex;flex-direction:column;gap:8px;margin-top:8px;}
.mc-pr-threshold-row{display:grid;grid-template-columns:1fr 88px;gap:8px;align-items:center;font-size:12px;}
.mc-list-order-card{margin-top:0;padding:16px 18px;display:flex;flex-direction:column;gap:8px;}
.mc-list-order-card > .mc-feature-desc{margin-bottom:2px;}
.mc-lo-body{display:flex;flex-direction:column;gap:14px;}
.mc-lo-hint{
  font-size:12px;line-height:1.45;color:var(--mc-muted);padding:8px 10px;border-radius:8px;
  background:rgba(0,0,0,.14);border:1px solid var(--mc-border);
}
.mc-lo-hint--active{color:#b8d4f0;border-color:rgba(33,150,243,.35);background:rgba(33,150,243,.1);}
.mc-lo-section{display:flex;flex-direction:column;gap:8px;}
.mc-lo-section-title{
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mc-muted);
}
.mc-lo-segment{
  display:inline-flex;align-self:flex-start;flex-wrap:wrap;gap:0;padding:3px;border-radius:10px;
  background:rgba(0,0,0,.22);border:1px solid var(--mc-border);
}
.mc-lo-segment-btn{
  border:none;background:transparent;color:var(--mc-muted);font-size:13px;font-weight:500;
  padding:8px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;
}
.mc-lo-segment-btn:hover:not(.mc-lo-segment-btn--active){color:var(--mc-text);background:rgba(255,255,255,.06);}
.mc-lo-segment-btn--active{background:var(--mc-accent);color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);}
.mc-lo-segment-btn:focus-visible{outline:2px solid var(--mc-accent);outline-offset:2px;}
.mc-lo-scope-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}
.mc-lo-scope-item{
  display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;
  border:1px solid var(--mc-border);background:rgba(0,0,0,.12);transition:border-color .15s,background .15s,opacity .15s;
}
.mc-lo-scope-item:hover:not(.mc-lo-scope-item--disabled){border-color:#5c6bc0;background:rgba(92,107,192,.12);}
.mc-lo-scope-item--on{border-color:var(--mc-accent);background:rgba(33,150,243,.12);}
.mc-lo-scope-item--disabled{opacity:.45;cursor:not-allowed;}
.mc-lo-scope-item input[type=checkbox]{margin-top:2px;flex-shrink:0;accent-color:var(--mc-accent);}
.mc-lo-scope-text{display:flex;flex-direction:column;gap:2px;min-width:0;}
.mc-lo-scope-label{font-size:13px;font-weight:600;line-height:1.25;}
.mc-lo-scope-sub{font-size:11px;color:var(--mc-muted);line-height:1.35;}
.mc-lo-divider{height:1px;background:var(--mc-border);margin:2px 0;}
.mc-srp-body{display:flex;flex-direction:column;gap:12px;}
.mc-srp-select-wrap{display:flex;flex-direction:column;gap:6px;}
.mc-srp-select-wrap--disabled{opacity:.45;pointer-events:none;}
.mc-srp-select{
  width:100%;max-width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--mc-border);
  background:var(--mc-elevated);color:var(--mc-text);font-size:13px;font-family:inherit;
}
.mc-srp-select:focus-visible{outline:2px solid var(--mc-accent);outline-offset:2px;}
.mc-lo-veh{
  display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;
  border:1px dashed var(--mc-border);background:rgba(0,0,0,.08);
}
.mc-lo-veh--disabled{opacity:.45;cursor:not-allowed;}
.mc-lo-veh--on{border-color:var(--mc-accent);border-style:solid;background:rgba(33,150,243,.08);}
.mc-lo-veh input[type=checkbox]{margin-top:2px;flex-shrink:0;accent-color:var(--mc-accent);}
.mc-col-sort-header--disabled .mc-col-sort-btn{opacity:0.4;pointer-events:none;cursor:default;}
.mc-toggle-wrap{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.mc-toggle{position:relative;width:40px;height:22px;flex-shrink:0;}
.mc-toggle input{opacity:0;width:0;height:0;}
.mc-toggle span{
  position:absolute;inset:0;background:#555;border-radius:999px;transition:background .2s;
}
.mc-toggle span::before{
  content:'';position:absolute;height:16px;width:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .2s;
}
.mc-toggle input:checked+span{background:#1976d2;}
.mc-toggle input:checked+span::before{transform:translateX(18px);}
.mc-card__header-line{display:flex;align-items:center;gap:10px;flex:1;min-width:0;}
.mc-card__main-row--aus .mc-card__title-input{min-width:0;width:100%;}
.mc-card__main-row--aus .mc-color-row{min-width:0;width:100%;}
.mc-card__title-input{flex:1 1 auto;flex-shrink:1;min-width:120px;font-weight:600;font-size:15px;}
.mc-card__title-input.inactive{opacity:.55;font-weight:500;}
.mc-color-row{display:flex;align-items:center;gap:8px;flex-shrink:1;min-width:0;}
.mc-card__main-row--aus .mc-color-row input.mc-color-hex-input{width:100%;min-width:0;max-width:88px;}
.mc-card__main-row--aus .mc-pill{max-width:100%;box-sizing:border-box;}
.mc-card__main-row--feature{
  display:flex;align-items:stretch;justify-content:space-between;gap:16px;min-height:56px;
}
.mc-feature-card{padding:16px 18px;}
.mc-feature-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px;justify-content:center;}
.mc-feature-title{font-weight:600;font-size:15px;line-height:1.25;}
.mc-feature-desc{font-size:12.5px;color:var(--mc-muted);line-height:1.45;max-width:52em;}
.mc-feature-aside{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  flex-shrink:0;align-self:stretch;min-width:76px;padding:2px 0;
}
.mc-feature-status{
  font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--mc-muted);
  padding:4px 10px;border-radius:999px;border:1px solid var(--mc-border);background:rgba(0,0,0,.18);
  white-space:nowrap;line-height:1.2;
}
.mc-feature-status--on{color:#bfe5c5;border-color:#3e8e4a;background:rgba(76,175,80,.18);}
.mc-lo-scope-item--disabled input[type=checkbox]{pointer-events:none;}
.mc-pill-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.mc-card__main-row--aus > .mc-pill{min-width:0;}
.mc-pill{
  display:inline-flex;align-items:center;gap:4px;border:1px solid var(--mc-border);border-radius:999px;
  padding:4px 8px;font-size:12px;background:rgba(0,0,0,.15);cursor:pointer;user-select:none;
}
.mc-pill input{margin:0;}
.mc-pill--on{border-color:#5c6bc0;background:#34374d;}
.mc-info{font-size:12px;color:var(--mc-muted);cursor:help;}
.mc-card__expand{
  margin-left:0;min-height:38px;padding:6px 14px;font-size:12px;gap:6px;font-weight:500;
  flex-shrink:0;line-height:1.2;justify-self:end;width:100%;max-width:100%;
  background:rgba(255,255,255,.04);border-color:#5f6470;color:var(--mc-text);
  transition:background .15s,border-color .15s,box-shadow .15s;
}
.mc-card__expand:hover{background:rgba(33,150,243,.14);border-color:var(--mc-accent);}
.mc-card__expand:focus-visible{outline:2px solid var(--mc-accent);outline-offset:2px;box-shadow:0 0 0 3px rgba(33,150,243,.18);}
.mc-card__expand-icon{display:inline-block;color:var(--mc-accent);transition:transform .18s ease;}
.mc-card__expand[aria-expanded="true"] .mc-card__expand-icon{transform:rotate(180deg);}
.mc-advanced{display:none;flex-direction:column;gap:6px;padding-top:4px;border-top:1px dashed var(--mc-border);}
.mc-advanced--open{display:flex;}
.mc-label-sm{font-size:11px;color:var(--mc-muted);}
.mc-popup__foot{
  position:sticky;bottom:0;z-index:4;background:linear-gradient(180deg,rgba(37,38,44,.2),var(--mc-surface) 18%);
  border-top:1px solid var(--mc-border);padding:10px 16px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
}
.mc-foot-left{flex:1;min-width:140px;display:flex;align-items:center;gap:8px;}
.mc-foot-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;}
@media(max-width:699px){
  .mc-toolbar-zone{flex-direction:column;align-items:flex-start;}
  .mc-toolbar-zone__label{min-width:0;}
  .mc-toolbar-sort label{min-width:0;}
}
.mc-status-btn{border:none;background:transparent;padding:4px 6px;cursor:pointer;font-size:13px;border-radius:8px;text-align:left;}
.mc-status-btn:hover{background:var(--mc-elevated);}
.mc-status-ok{color:var(--mc-ok);}
.mc-status-warn{color:var(--mc-warn);}
.mc-issue-pop{
  position:absolute;bottom:48px;left:16px;max-width:min(420px,90vw);max-height:40vh;overflow:auto;
  background:var(--mc-elevated);border:1px solid var(--mc-border);border-radius:10px;padding:10px 12px;
  font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;z-index:6;
}
.mc-issue-pop--open{display:block;}
.mc-issue-pop ul{margin:6px 0 0 18px;padding:0;}
.mc-toast-host{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.mc-toast{
  pointer-events:auto;min-width:220px;max-width:min(92vw,420px);padding:10px 14px;border-radius:10px;
  font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);
}
.mc-toast--success{background:#1b3a1f;color:#e8f5e9;}
.mc-toast--warn{background:#3a2e1b;color:#ffe0b2;}
.mc-toast--error{background:#3a1b1b;color:#ffcdd2;}
.mc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;}
.mc-modal{background:var(--mc-surface);border:1px solid var(--mc-border);border-radius:12px;padding:16px 18px;max-width:420px;width:100%;color:var(--mc-text);}
.mc-modal p{margin:0 0 14px;font-size:14px;line-height:1.45;white-space:pre-wrap;}
.mc-modal--wide{max-width:520px;}
.mc-modal__title{margin:0 0 10px;font-size:16px;font-weight:600;}
.mc-changelog{margin:0 0 14px;padding:0 0 0 18px;max-height:40vh;overflow-y:auto;font-size:13px;line-height:1.5;color:var(--mc-text);}
.mc-changelog li{margin:4px 0;}
.mc-modal-actions{display:flex;justify-content:flex-end;gap:8px;}
.mc-btn--primary.mc-btn--save-idle{opacity:.55;}
.mc-ie-panel{display:flex;flex-direction:column;gap:12px;min-height:0;flex:1;}
.mc-ie-header{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:12px 14px;border-radius:10px;border:1px solid var(--mc-border);background:rgba(0,0,0,.12);
}
.mc-ie-intro{margin:0;font-size:13px;line-height:1.5;color:var(--mc-muted);flex:1;min-width:0;}
.mc-ie-intro strong{color:var(--mc-text);font-weight:600;}
.mc-ie-grid{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:stretch;flex:1;min-height:0;
}
@media(max-width:760px){.mc-ie-grid{grid-template-columns:1fr;}}
.mc-ie-card{
  display:flex;flex-direction:column;gap:10px;min-width:0;min-height:300px;
  padding:14px 16px;border:1px solid var(--mc-border);border-radius:12px;background:var(--mc-elevated);
}
.mc-ie-card--export{border-color:rgba(33,150,243,.32);box-shadow:inset 0 1px 0 rgba(33,150,243,.08);}
.mc-ie-card--import{border-color:rgba(129,199,132,.28);box-shadow:inset 0 1px 0 rgba(129,199,132,.08);}
.mc-ie-card__head{display:flex;flex-direction:column;gap:4px;}
.mc-ie-card__title{font-size:15px;font-weight:600;line-height:1.25;display:flex;align-items:center;gap:8px;}
.mc-ie-card__title::before{content:'';width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.mc-ie-card--export .mc-ie-card__title::before{background:var(--mc-accent);}
.mc-ie-card--import .mc-ie-card__title::before{background:var(--mc-ok);}
.mc-ie-card__desc{font-size:12px;color:var(--mc-muted);line-height:1.4;}
.mc-ie-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.mc-ie-code{
  flex:1;min-height:220px;width:100%;box-sizing:border-box;resize:vertical;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;
  border:1px solid var(--mc-border);background:rgba(0,0,0,.22);color:var(--mc-text);border-radius:8px;
}
.mc-ie-code[readonly]{cursor:default;opacity:.95;}
.mc-ie-meta{font-size:11px;color:var(--mc-muted);line-height:1.35;margin-top:-4px;}
.mc-ie-import-footer{display:flex;justify-content:flex-end;margin-top:auto;padding-top:2px;}
.mc-dropzone{
  flex-shrink:0;border:2px dashed var(--mc-border);border-radius:10px;padding:14px 12px;
  text-align:center;cursor:pointer;background:rgba(0,0,0,.14);
  display:flex;flex-direction:column;align-items:center;gap:4px;transition:border-color .15s,background .15s;
}
.mc-dropzone--hover{border-color:var(--mc-accent);background:rgba(33,150,243,.1);}
.mc-dropzone__icon{font-size:24px;line-height:1;opacity:.75;}
.mc-dropzone__main{font-size:13px;font-weight:500;color:var(--mc-text);}
.mc-dropzone__sub{font-size:11px;color:var(--mc-muted);line-height:1.35;}
.mc-empty{padding:22px;text-align:center;color:var(--mc-muted);font-size:14px;border:1px dashed var(--mc-border);border-radius:10px;}
`;
            document.head.appendChild(st);
        }
        injectStyles();

        function mkBtn(variant, label, onClick) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mc-btn'
                + (variant === 'primary' ? ' mc-btn--primary'
                    : variant === 'ghost' ? ' mc-btn--ghost'
                        : variant === 'danger' ? ' mc-btn--danger'
                            : variant === 'dup' ? ' mc-btn--ghost mc-btn--action-dup'
                                : variant === 'del' ? ' mc-btn--ghost mc-btn--action-del'
                                    : variant === 'prem' ? ' mc-btn--ghost mc-btn--action-prem'
                                            : variant === 'clearw' ? ' mc-btn--ghost mc-btn--action-clearw' : '');
            b.textContent = label;
            if (onClick) b.addEventListener('click', onClick);
            return b;
        }

        function mkToolbarZone(label, stack) {
            const zone = document.createElement('div');
            zone.className = 'mc-toolbar-zone' + (stack ? ' mc-toolbar-zone--stack' : '');
            const lbl = document.createElement('span');
            lbl.className = 'mc-toolbar-zone__label';
            lbl.textContent = label;
            const body = document.createElement('div');
            body.className = 'mc-toolbar-zone__body';
            zone.appendChild(lbl);
            zone.appendChild(body);
            return { zone, body };
        }

        function mkBtnGroup(buttons) {
            const g = document.createElement('div');
            g.className = 'mc-btn-group';
            buttons.forEach(btn => g.appendChild(btn));
            return g;
        }

        /**
         * Einheitliche Listen-Toolbar (Suche, Filter, Bulk, Neu, Meta).
         * @returns {{ toolbar, searchRow, search, metaStats, metaHint, filterCbs?: HTMLInputElement[] }}
         */
        function buildListToolbar(opts) {
            const {
                searchPlaceholder,
                onSearch,
                filters = [],
                bulk,
                onNeu,
                neuLabel = '+ Neu'
            } = opts;

            const toolbar = document.createElement('div');
            toolbar.className = 'mc-toolbar';

            const metaStats = document.createElement('div');
            metaStats.className = 'mc-toolbar-stats';
            const metaHint = document.createElement('div');
            metaHint.className = 'mc-toolbar-hint';

            const searchRow = document.createElement('div');
            searchRow.className = 'mc-toolbar__row mc-toolbar__row--search';
            const searchZone = mkToolbarZone('Suche', false);
            searchZone.zone.classList.add('mc-toolbar-zone--search');
            const search = mkSearchBox(searchPlaceholder, onSearch);
            searchZone.body.appendChild(search);
            searchRow.appendChild(searchZone.zone);

            toolbar.appendChild(searchRow);

            const filterCbs = [];
            if (filters.length || bulk) {
                const controlRow = document.createElement('div');
                controlRow.className = 'mc-toolbar__row mc-toolbar__row--controls';
                if (filters.length) {
                    const displayZone = mkToolbarZone('Anzeige', false);
                    displayZone.zone.classList.add('mc-toolbar-zone--anzeige');
                    filters.forEach(f => {
                        const wrap = document.createElement('label');
                        wrap.className = 'mc-toolbar-toggle';
                        if (f.title) wrap.title = f.title;
                        const toggle = mkToggle(!!f.initial, () => {
                            if (f.onChange) f.onChange();
                            else onSearch();
                        });
                        const cb = toggle.querySelector('input');
                        filterCbs.push(cb);
                        wrap.appendChild(toggle);
                        const txt = document.createElement('span');
                        txt.textContent = f.label;
                        wrap.appendChild(txt);
                        displayZone.body.appendChild(wrap);
                    });
                    controlRow.appendChild(displayZone.zone);
                }
                if (bulk) {
                    const bulkZone = mkToolbarZone('Alle Einträge', false);
                    bulkZone.zone.classList.add('mc-toolbar-zone--bulk');
                    const onBtn = mkBtn('ghost', 'Ein', () => bulk.onAll(true));
                    const offBtn = mkBtn('ghost', 'Aus', () => bulk.onAll(false));
                    onBtn.title = 'Alle Einträge im Tab aktivieren';
                    offBtn.title = 'Alle Einträge im Tab deaktivieren';
                    bulkZone.body.appendChild(mkBtnGroup([onBtn, offBtn]));
                    controlRow.appendChild(bulkZone.zone);
                }
                toolbar.appendChild(controlRow);
            }

            const metaRow = document.createElement('div');
            metaRow.className = 'mc-toolbar__row mc-toolbar__row--meta';
            const metaCol = document.createElement('div');
            metaCol.className = 'mc-toolbar-meta-col';
            metaCol.appendChild(metaStats);
            metaCol.appendChild(metaHint);
            metaRow.appendChild(metaCol);
            if (onNeu) {
                metaRow.appendChild(mkBtn('primary', neuLabel, onNeu));
            }
            toolbar.appendChild(metaRow);

            return { toolbar, searchRow, search, metaStats, metaHint, filterCbs };
        }

        function mkHelpPanel(htmlContent) {
            const wrap = document.createElement('div');
            wrap.className = 'mc-help-panel';
            wrap.setAttribute('role', 'region');
            const head = document.createElement('div');
            head.className = 'mc-help-panel__head';
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'mc-icon-btn mc-help-panel__close';
            closeBtn.setAttribute('aria-label', 'Hilfe schließen');
            closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.3 5.71a1 1 0 00-1.41 0L12 10.59 7.11 5.7A1 1 0 105.7 7.11L10.59 12 5.7 16.89a1 1 0 101.41 1.41L12 13.41l4.89 4.89a1 1 0 001.41-1.41L13.41 12l4.89-4.89a1 1 0 000-1.4z"/></svg>';
            const body = document.createElement('div');
            body.className = 'mc-help-panel__body';
            body.innerHTML = htmlContent;
            head.appendChild(closeBtn);
            wrap.appendChild(head);
            wrap.appendChild(body);
            return { wrap, closeBtn, body };
        }

        function mkHelpButton(label) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mc-btn mc-btn--ghost mc-help-btn';
            btn.setAttribute('aria-label', label);
            const q = document.createElement('span');
            q.className = 'mc-help-btn__q';
            q.setAttribute('aria-hidden', 'true');
            q.textContent = '?';
            btn.appendChild(q);
            return btn;
        }

        function konfigHelpKey(baseKey) {
            if (baseKey === 'aus' || baseKey === 'tech' || baseKey === 'merge') {
                return getConfigListUi(aktuelleFeatureFlags) === 'split' ? baseKey + '_split' : baseKey;
            }
            return baseKey;
        }

        function refreshKonfigHelpPanels() {
            Object.keys(konfigHelpPanels).forEach(baseKey => {
                const p = konfigHelpPanels[baseKey];
                if (!p || !p.body) return;
                const html = KONFIG_TAB_HELP_HTML.get(konfigHelpKey(baseKey));
                if (html) p.body.innerHTML = html;
            });
        }

        function installKonfigTabHelp(baseKey, panelId, regionAriaLabel, btnLabel, toolbarEl, metaEl, panelColumn, beforeNode) {
            const html = KONFIG_TAB_HELP_HTML.get(konfigHelpKey(baseKey));
            if (!html) return;
            const { wrap, closeBtn, body } = mkHelpPanel(html);
            wrap.id = panelId;
            wrap.setAttribute('aria-label', regionAriaLabel);
            konfigHelpPanels[baseKey] = { wrap, body };
            const btn = mkHelpButton(btnLabel);
            btn.setAttribute('aria-controls', panelId);
            function applyHelpState() {
                const o = helpExpandedByTab[baseKey];
                btn.setAttribute('aria-expanded', o ? 'true' : 'false');
                wrap.classList.toggle('mc-help-panel--open', o);
            }
            btn.addEventListener('click', () => {
                helpExpandedByTab[baseKey] = !helpExpandedByTab[baseKey];
                applyHelpState();
            });
            closeBtn.addEventListener('click', () => {
                helpExpandedByTab[baseKey] = false;
                applyHelpState();
            });
            const slot = document.createElement('div');
            slot.className = 'mc-toolbar-help-slot';
            slot.appendChild(btn);
            if (metaEl && metaEl.parentElement === toolbarEl) toolbarEl.insertBefore(slot, metaEl);
            else toolbarEl.appendChild(slot);
            panelColumn.insertBefore(wrap, beforeNode);
            applyHelpState();
        }

        function useConfigSplitView() {
            return getConfigListUi(aktuelleFeatureFlags) === 'split';
        }

        let popupRef = null;

        function syncPopupConfigLayoutClass() {
            if (!popupRef) return;
            const split = useConfigSplitView();
            popupRef.classList.toggle('mc-popup--config-split', split);
            [panelAus, panelTech, panelMerge].forEach(p => {
                p.classList.toggle('mc-panel--split-host', split);
            });
        }

        function syncAllTabSelectionOnUiModeSwitch() {
            if (useConfigSplitView()) {
                if (expandedAusstattungIndex !== null) selectedAusIndex = expandedAusstattungIndex;
                expandedAusstattungIndex = null;
            } else if (selectedAusIndex !== null) {
                expandedAusstattungIndex = selectedAusIndex;
            }
        }

        function onConfigListUiChanged() {
            syncPopupConfigLayoutClass();
            syncAllTabSelectionOnUiModeSwitch();
            refreshKonfigHelpPanels();
            syncSplitToolbarVisibility();
            renderAusstattung();
            renderTechData();
            renderMergeConfig();
        }

        function mkChipInput(tokens, opts) {
            const { variant = 'neutral', onChange } = opts || {};
            const wrap = document.createElement('div');
            wrap.className = 'mc-chip-input';
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.setAttribute('autocomplete', 'off');
            inp.placeholder = opts && opts.placeholder ? opts.placeholder : 'Hinzufügen…';

            function normDupSet(arr) {
                const seen = new Map();
                (arr || []).forEach(t => {
                    const k = String(t).trim().toLowerCase();
                    if (k) seen.set(k, (seen.get(k) || 0) + 1);
                });
                return seen;
            }

            function applyChipEdit(index, raw, prevVal) {
                const trimmed = String(raw || '').trim();
                if (!trimmed) {
                    tokens.splice(index, 1);
                    onChange([...tokens]);
                    return true;
                }
                if (trimmed === prevVal) return false;
                tokens[index] = trimmed;
                onChange([...tokens]);
                return true;
            }

            function startChipEdit(index, textEl) {
                if (wrap._chipEditEnd) wrap._chipEditEnd(true);
                const prev = tokens[index];
                const editInp = document.createElement('input');
                editInp.type = 'text';
                editInp.className = 'mc-chip__edit';
                editInp.value = prev;
                textEl.replaceWith(editInp);
                wrap.classList.add('mc-chip-input--editing');
                editInp.focus();
                editInp.select();
                let done = false;
                function finish(save) {
                    if (done) return;
                    done = true;
                    wrap._chipEditEnd = null;
                    wrap.classList.remove('mc-chip-input--editing');
                    if (save) applyChipEdit(index, editInp.value, prev);
                    renderChips();
                }
                wrap._chipEditEnd = finish;
                editInp.addEventListener('blur', () => {
                    setTimeout(() => {
                        if (done) return;
                        if (document.activeElement === editInp) return;
                        finish(true);
                    }, 0);
                });
                editInp.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        finish(true);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        finish(false);
                    }
                });
            }

            function bindChipText(textEl, index) {
                textEl.title = 'Klicken zum Bearbeiten';
                textEl.addEventListener('mousedown', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    startChipEdit(index, textEl);
                });
            }

            function renderChips() {
                if (wrap._chipEditEnd) {
                    wrap._chipEditEnd(true);
                    return;
                }
                wrap.querySelectorAll('.mc-chip').forEach(c => c.remove());
                const dup = normDupSet(tokens);
                (tokens || []).forEach((tok, i) => {
                    const chip = document.createElement('span');
                    const k = String(tok).trim().toLowerCase();
                    chip.className = 'mc-chip' + (variant === 'warn' ? ' mc-chip--warn' : '');
                    if (dup.get(k) > 1) chip.classList.add('mc-chip--dup');
                    const textEl = document.createElement('span');
                    textEl.className = 'mc-chip__text';
                    textEl.textContent = tok;
                    bindChipText(textEl, i);
                    chip.appendChild(textEl);
                    const x = document.createElement('button');
                    x.type = 'button';
                    x.className = 'mc-chip__x';
                    x.setAttribute('aria-label', 'Entfernen');
                    x.textContent = '×';
                    x.addEventListener('click', e => {
                        e.stopPropagation();
                        if (wrap._chipEditEnd) wrap._chipEditEnd(true);
                        tokens.splice(i, 1);
                        onChange([...tokens]);
                        renderChips();
                    });
                    chip.appendChild(x);
                    wrap.insertBefore(chip, inp);
                });
            }

            function addToken(raw) {
                const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
                if (!parts.length) return;
                if (wrap._chipEditEnd) wrap._chipEditEnd(true);
                let changed = false;
                parts.forEach(p => {
                    if (!tokens.some(t => String(t).trim().toLowerCase() === p.toLowerCase())) {
                        tokens.push(p);
                        changed = true;
                    }
                });
                if (changed) {
                    onChange([...tokens]);
                    renderChips();
                }
                inp.value = '';
            }

            inp.addEventListener('keydown', e => {
                if (wrap.querySelector('.mc-chip__edit')) return;
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addToken(inp.value);
                } else if (e.key === 'Backspace' && !inp.value && tokens.length) {
                    tokens.pop();
                    onChange([...tokens]);
                    renderChips();
                }
            });
            inp.addEventListener('blur', () => {
                if (wrap._chipEditEnd || wrap.querySelector('.mc-chip__edit')) return;
                if (inp.value.trim()) addToken(inp.value);
            });

            wrap.appendChild(inp);
            renderChips();
            return { wrap, focusInput: () => inp.focus(), refresh: renderChips };
        }

        function mkConfigSplitShell(tabId) {
            const root = document.createElement('div');
            root.className = 'mc-config-split-root mc-config-split-root--' + tabId;

            const backdrop = document.createElement('div');
            backdrop.className = 'mc-config-split__sheet-backdrop';
            const sheet = document.createElement('div');
            sheet.className = 'mc-config-split__sheet';
            sheet.dataset.tab = tabId;
            const sheetHead = document.createElement('div');
            sheetHead.className = 'mc-config-split__sheet-head';
            const sheetDone = mkBtn('ghost', 'Fertig', () => closeEditorSheet(tabId));
            sheetHead.appendChild(sheetDone);
            const sheetBody = document.createElement('div');
            sheetBody.className = 'mc-config-split__sheet-body';

            const split = document.createElement('div');
            split.className = 'mc-config-split mc-config-split--' + tabId;
            const listScroll = document.createElement('div');
            listScroll.className = 'mc-config-split__list-scroll';
            const list = document.createElement('div');
            list.className = 'mc-config-split__list';
            listScroll.appendChild(list);
            const editor = document.createElement('div');
            editor.className = 'mc-config-split__editor';
            split.appendChild(listScroll);
            split.appendChild(editor);

            root.appendChild(split);
            root.appendChild(backdrop);
            sheet.appendChild(sheetHead);
            sheet.appendChild(sheetBody);
            root.appendChild(sheet);

            function closeEditorSheet() {
                backdrop.classList.remove('mc-config-split__sheet-backdrop--open');
                sheet.classList.remove('mc-config-split__sheet--open');
                if (editor.parentElement !== split) split.appendChild(editor);
            }
            function openEditorSheet() {
                if (window.matchMedia('(min-width: 560px)').matches) return;
                sheetBody.innerHTML = '';
                sheetBody.appendChild(editor);
                backdrop.classList.add('mc-config-split__sheet-backdrop--open');
                sheet.classList.add('mc-config-split__sheet--open');
            }
            backdrop.addEventListener('click', closeEditorSheet);

            return { root, split, listScroll, list, editor, sheetBody, openEditorSheet, closeEditorSheet };
        }

        function mkSortDropdown(sortState, options, locked, onChange) {
            const wrap = document.createElement('div');
            wrap.className = 'mc-toolbar-sort mc-toolbar-split-only';
            const lab = document.createElement('label');
            lab.textContent = 'Sortierung';
            const sel = document.createElement('select');
            sel.disabled = !!locked;
            options.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.key + ':' + o.dir;
                opt.textContent = o.label;
                if (sortState.key === o.key && sortState.dir === o.dir) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => {
                const [key, dir] = sel.value.split(':');
                sortState.key = key;
                sortState.dir = dir;
                onChange();
            });
            wrap.appendChild(lab);
            wrap.appendChild(sel);
            return wrap;
        }

        function mkSplitListItem(opts) {
            const row = document.createElement('div');
            row.className = 'mc-card mc-config-split__list-item';
            if (opts.selected) row.classList.add('mc-config-split__list-item--selected');
            if (opts.inactive) row.classList.add('mc-config-split__list-item--inactive');
            if (opts.dragSection) row.dataset.dragSection = opts.dragSection;

            const controls = document.createElement('div');
            controls.className = 'mc-config-split__list-item-controls';
            if (opts.handle) controls.appendChild(opts.handle);
            if (opts.toggleWrap) controls.appendChild(opts.toggleWrap);
            if (opts.favBtn) controls.appendChild(opts.favBtn);
            row.appendChild(controls);

            const main = document.createElement('div');
            main.className = 'mc-config-split__list-item-main';
            if (opts.colorDot) main.appendChild(opts.colorDot);
            const lab = document.createElement('span');
            lab.className = 'mc-config-split__list-item-label';
            lab.textContent = opts.label || '';
            if (opts.title) lab.title = opts.title;
            main.appendChild(lab);
            row.appendChild(main);

            if ((opts.badges && opts.badges.length) || opts.warn) {
                const meta = document.createElement('div');
                meta.className = 'mc-config-split__list-item-meta';
                if (opts.badges && opts.badges.length) {
                    const bw = document.createElement('span');
                    bw.className = 'mc-config-split__list-item-badges';
                    opts.badges.forEach(t => {
                        const b = document.createElement('span');
                        b.className = 'mc-config-split__badge';
                        b.textContent = t;
                        bw.appendChild(b);
                    });
                    meta.appendChild(bw);
                }
                if (opts.warn) {
                    const w = document.createElement('span');
                    w.className = 'mc-config-split__warn';
                    w.textContent = '⚠';
                    w.title = opts.warn;
                    meta.appendChild(w);
                }
                row.appendChild(meta);
            }

            row.addEventListener('click', e => {
                if (e.target.closest('button, label, input, .mc-toggle, .mc-drag-handle, .mc-fav-btn')) return;
                opts.onSelect();
            });
            return row;
        }

        function fillEditorPlaceholder(editorEl, msg) {
            editorEl.innerHTML = '';
            const p = document.createElement('div');
            p.className = 'mc-config-split__editor-placeholder';
            p.textContent = msg || 'Eintrag in der Liste wählen oder „+ Neu“ klicken.';
            editorEl.appendChild(p);
        }

        function mkConfigSplitEditorField(labelText, el) {
            const grp = document.createElement('div');
            grp.className = 'mc-config-split__editor-field';
            const lb = document.createElement('div');
            lb.className = 'mc-label-sm';
            lb.textContent = labelText;
            grp.appendChild(lb);
            grp.appendChild(el);
            return grp;
        }

        function mkConfigSplitEditorCheck(checked, checkTitle, hint, onChange) {
            const lab = document.createElement('label');
            lab.className = 'mc-config-split__editor-check';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!checked;
            cb.addEventListener('change', () => onChange(cb.checked));
            const txt = document.createElement('span');
            txt.className = 'mc-config-split__editor-check-text';
            const tTitle = document.createElement('span');
            tTitle.className = 'mc-config-split__editor-check-title';
            tTitle.textContent = checkTitle;
            txt.appendChild(tTitle);
            if (hint) {
                const tHint = document.createElement('span');
                tHint.className = 'mc-config-split__editor-check-hint';
                tHint.textContent = hint;
                txt.appendChild(tHint);
            }
            lab.appendChild(cb);
            lab.appendChild(txt);
            return { lab, cb };
        }

        function mkConfigSplitOptionsField(checks) {
            const optionsField = document.createElement('div');
            optionsField.className = 'mc-config-split__editor-field';
            const lbOpt = document.createElement('div');
            lbOpt.className = 'mc-label-sm';
            lbOpt.textContent = 'Optionen';
            const optionsBox = document.createElement('div');
            optionsBox.className = 'mc-config-split__editor-options';
            checks.forEach(c => {
                optionsBox.appendChild(mkConfigSplitEditorCheck(c.checked, c.title, c.hint, c.onChange).lab);
            });
            optionsField.appendChild(lbOpt);
            optionsField.appendChild(optionsBox);
            return optionsField;
        }

        function mkConfigSplitEditorFooter() {
            const footer = document.createElement('div');
            footer.className = 'mc-config-split__editor-footer';
            return footer;
        }

        function mkConfigSplitEditorActions() {
            const actions = document.createElement('div');
            actions.className = 'mc-config-split__editor-actions';
            return actions;
        }

        function mkToggle(checked, onChange) {
            const lab = document.createElement('label');
            lab.className = 'mc-toggle';
            const inp = document.createElement('input');
            inp.type = 'checkbox';
            inp.checked = !!checked;
            const span = document.createElement('span');
            lab.appendChild(inp);
            lab.appendChild(span);
            inp.addEventListener('change', () => onChange(inp.checked));
            return lab;
        }

        let mergeModifierExpandedEl = null;

        function mkMergeModifierField(group, rowEl) {
            const ta = document.createElement('textarea');
            ta.className = 'mc-input mc-merge-modifier';
            ta.rows = 1;
            ta.value = (group.order || []).join(', ');
            ta.placeholder = 'Modifier, kommagetrennt';
            ta.title = 'Reihenfolge der Zusätze, z. B. beheizbar, anklappbar, elektr. verstellbar';
            ta.setAttribute('autocomplete', 'off');

            function applyOrder() {
                group.order = ta.value.split(',').map(s => s.trim()).filter(Boolean);
                markDirty();
                refreshValidationUI();
            }

            function resizeExpanded() {
                ta.style.height = 'auto';
                const h = Math.max(38, Math.min(ta.scrollHeight + 2, 200));
                ta.style.height = h + 'px';
            }

            function collapse() {
                if (mergeModifierExpandedEl === ta) mergeModifierExpandedEl = null;
                ta.classList.remove('mc-merge-modifier--expanded');
                if (rowEl) rowEl.classList.remove('mc-merge-row--modifier-open');
                ta.style.height = '';
            }

            function expand() {
                if (mergeModifierExpandedEl && mergeModifierExpandedEl !== ta) {
                    mergeModifierExpandedEl.blur();
                }
                mergeModifierExpandedEl = ta;
                ta.classList.add('mc-merge-modifier--expanded');
                if (rowEl) rowEl.classList.add('mc-merge-row--modifier-open');
                resizeExpanded();
            }

            ta.addEventListener('focus', expand);
            ta.addEventListener('input', () => {
                applyOrder();
                if (ta.classList.contains('mc-merge-modifier--expanded')) resizeExpanded();
            });
            ta.addEventListener('blur', () => {
                applyOrder();
                collapse();
            });

            return ta;
        }

        function namedColorToHex(name) {
            const m = { orange: '#ff9800', red: '#f44336', green: '#4caf50', blue: '#2196f3', purple: '#9c27b0' };
            const k = String(name || '').trim().toLowerCase();
            return m[k] || '';
        }

        function normalizeHexColor(v) {
            let s = String(v || '').trim();
            if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
            const n = namedColorToHex(s);
            return n || '#66ff66';
        }

        function mkColorInput(value, onChange, opts) {
            const styledPicker = !!(opts && opts.styledPicker);
            const wrap = document.createElement('div');
            wrap.className = 'mc-color-row';
            const hex = normalizeHexColor(value);
            const colorInp = document.createElement('input');
            colorInp.type = 'color';
            colorInp.value = hex;
            colorInp.className = 'mc-input' + (styledPicker ? ' mc-color-native-hidden' : '');
            const textInp = document.createElement('input');
            textInp.type = 'text';
            textInp.className = 'mc-input mc-color-hex-input';
            textInp.value = value || '';
            textInp.placeholder = '#66ff66';
            let swatch = null;
            function syncSwatch() {
                if (swatch) swatch.style.background = normalizeHexColor(textInp.value || value);
            }
            function applyFromPicker() {
                textInp.value = colorInp.value;
                onChange(colorInp.value);
                syncSwatch();
            }
            textInp.addEventListener('input', () => {
                const h = normalizeHexColor(textInp.value);
                colorInp.value = h;
                onChange(textInp.value.trim());
                syncSwatch();
            });
            colorInp.addEventListener('input', applyFromPicker);
            if (styledPicker) {
                swatch = document.createElement('button');
                swatch.type = 'button';
                swatch.className = 'mc-config-split__editor-color-swatch';
                swatch.title = 'Farbe wählen';
                syncSwatch();
                swatch.addEventListener('click', () => colorInp.click());
                wrap.appendChild(swatch);
            }
            wrap.appendChild(colorInp);
            wrap.appendChild(textInp);
            return wrap;
        }

        function mkDragHandle(enabled) {
            const h = document.createElement('div');
            h.className = 'mc-drag-handle' + (enabled === false ? ' mc-drag-handle--disabled' : '');
            h.textContent = '⋮⋮';
            h.title = enabled === false
                ? 'Manuelle Reihenfolge im Config-Tab aktivieren (Bereich + Modus „Manuell“)'
                : 'Ziehen zum Sortieren (nur vertikal)';
            h.draggable = false;
            return h;
        }

        /** Vertikales Pointer-Sortieren mit Snap-Platzhalter (kein HTML5-Drag-Ghost). */
        function setupListDragReorder(opts) {
            const {
                container,
                handle,
                card,
                indexAttr,
                getFromIndex,
                isEnabled,
                getSection,
                canDropInSection,
                onDrop
            } = opts;
            if (!isEnabled()) return;

            let dragFrom = null;
            let placeholder = null;
            let floatPreview = null;
            let slotHeight = 48;
            let activePointerId = null;
            let dragOffsetY = 0;
            let dragAnchorLeft = 0;
            let dragWidth = 0;
            let lastClientY = 0;
            let scrollParent = null;
            let autoScrollRaf = null;
            const SCROLL_EDGE_PX = 96;
            const SCROLL_MAX_PX = 28;
            let dragScrollLoopActive = false;

            function cardIndex(el) {
                return parseInt(el.getAttribute(indexAttr), 10);
            }

            function listCards() {
                return [...container.querySelectorAll('.mc-card[' + indexAttr + ']')]
                    .filter(c => !c.classList.contains('mc-card--drag-source-hidden'));
            }

            function eligibleCards() {
                const all = listCards();
                if (!canDropInSection || !getSection) return all;
                const fromSec = getSection(card);
                return all.filter(c => canDropInSection(fromSec, getSection(c)));
            }

            function getScrollParent() {
                if (scrollParent) return scrollParent;
                const listPane = container.closest('.mc-config-split__list-scroll');
                if (listPane) {
                    scrollParent = listPane;
                    return scrollParent;
                }
                const preferred = container.closest('.mc-popup__scroll');
                let best = null;
                let bestOverflow = 0;
                let p = container;
                while (p) {
                    const overflow = p.scrollHeight - p.clientHeight;
                    if (overflow > bestOverflow) {
                        const oy = window.getComputedStyle(p).overflowY;
                        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay' ||
                            p.classList.contains('mc-popup__scroll')) {
                            best = p;
                            bestOverflow = overflow;
                        }
                    }
                    p = p.parentElement;
                }
                scrollParent = best || preferred || container;
                return scrollParent;
            }

            /** Scroll-Viewport (volle Höhe, X egal — auch Maus links/rechts neben dem Popup). */
            function getEdgeViewportRect() {
                const sp = getScrollParent();
                const sr = sp.getBoundingClientRect();
                return { top: sr.top, bottom: sr.bottom, scrollEl: sp };
            }

            function getPopupClipRect() {
                const popup = container.closest('.mc-popup');
                return popup ? popup.getBoundingClientRect() : null;
            }

            function clampFloatPreviewBox(top, left, width, height) {
                const pr = getPopupClipRect();
                if (!pr) return { top, left, width };
                const w = Math.min(width, Math.max(0, pr.right - pr.left));
                const l = Math.max(pr.left, Math.min(pr.right - w, left));
                const h = height || slotHeight;
                const t = Math.max(pr.top, Math.min(pr.bottom - h, top));
                return { top: t, left: l, width: w };
            }

            function stopAutoScroll() {
                dragScrollLoopActive = false;
                if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
                autoScrollRaf = null;
            }

            function syncFloatAnchorX() {
                const cr = container.getBoundingClientRect();
                const box = clampFloatPreviewBox(cr.top, cr.left, cr.width, slotHeight);
                dragAnchorLeft = box.left;
                dragWidth = box.width;
                if (floatPreview) {
                    floatPreview.style.left = box.left + 'px';
                    floatPreview.style.width = box.width + 'px';
                }
            }

            function applyAutoScroll(clientY) {
                const vp = getEdgeViewportRect();
                const sp = vp.scrollEl;
                const maxTop = Math.max(0, sp.scrollHeight - sp.clientHeight);
                if (maxTop < 1) return false;
                let delta = 0;
                if (clientY < vp.top) {
                    delta = -SCROLL_MAX_PX;
                } else if (clientY < vp.top + SCROLL_EDGE_PX) {
                    const power = (vp.top + SCROLL_EDGE_PX - clientY) / SCROLL_EDGE_PX;
                    delta = -Math.max(5, Math.round(SCROLL_MAX_PX * Math.min(1, power)));
                } else if (clientY > vp.bottom) {
                    delta = SCROLL_MAX_PX;
                } else if (clientY > vp.bottom - SCROLL_EDGE_PX) {
                    const power = (clientY - (vp.bottom - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX;
                    delta = Math.max(5, Math.round(SCROLL_MAX_PX * Math.min(1, power)));
                }
                if (delta === 0) return false;
                const before = sp.scrollTop;
                sp.scrollBy(0, delta);
                if (sp.scrollTop === before) {
                    sp.scrollTop = Math.max(0, Math.min(maxTop, before + delta));
                }
                if (sp.scrollTop === before) return false;
                syncFloatAnchorX();
                return true;
            }

            function dragScrollLoop() {
                if (!dragScrollLoopActive || dragFrom === null) {
                    stopAutoScroll();
                    return;
                }
                applyAutoScroll(lastClientY);
                updatePlaceholderAtY(lastClientY);
                updateFloatPreviewY(lastClientY);
                autoScrollRaf = requestAnimationFrame(dragScrollLoop);
            }

            function startDragScrollLoop() {
                if (dragScrollLoopActive) return;
                dragScrollLoopActive = true;
                if (autoScrollRaf === null) autoScrollRaf = requestAnimationFrame(dragScrollLoop);
            }

            function clearDragUi() {
                stopAutoScroll();
                scrollParent = null;
                container.classList.remove('mc-list-dragging');
                handle.classList.remove('mc-drag-handle--active');
                container.querySelectorAll('.mc-card--drop-target').forEach(el => el.classList.remove('mc-card--drop-target'));
                card.classList.remove('mc-card--drag-source-hidden');
                card.style.display = '';
                if (floatPreview && floatPreview.parentNode) floatPreview.remove();
                floatPreview = null;
                if (placeholder && placeholder.parentNode) placeholder.remove();
                placeholder = null;
                dragFrom = null;
                activePointerId = null;
            }

            function createFloatPreview(pointerY) {
                const rect = card.getBoundingClientRect();
                dragOffsetY = pointerY - rect.top;
                dragAnchorLeft = rect.left;
                dragWidth = rect.width;
                floatPreview = card.cloneNode(true);
                floatPreview.classList.add('mc-drag-float');
                floatPreview.classList.remove('mc-card--drag-source-hidden');
                floatPreview.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
                floatPreview.style.position = 'fixed';
                floatPreview.style.zIndex = '2147483647';
                floatPreview.style.margin = '0';
                const popup = container.closest('.mc-popup');
                (popup || document.body).appendChild(floatPreview);
                const h = floatPreview.offsetHeight || slotHeight;
                const box = clampFloatPreviewBox(pointerY - dragOffsetY, dragAnchorLeft, dragWidth, h);
                dragAnchorLeft = box.left;
                dragWidth = box.width;
                floatPreview.style.left = box.left + 'px';
                floatPreview.style.top = box.top + 'px';
                floatPreview.style.width = box.width + 'px';
            }

            function updateFloatPreviewY(pointerY) {
                if (!floatPreview) return;
                const h = floatPreview.offsetHeight || slotHeight;
                const box = clampFloatPreviewBox(pointerY - dragOffsetY, dragAnchorLeft, dragWidth, h);
                floatPreview.style.top = box.top + 'px';
                floatPreview.style.left = box.left + 'px';
                floatPreview.style.width = box.width + 'px';
            }

            function ensurePlaceholder() {
                if (!placeholder) {
                    placeholder = document.createElement('div');
                    placeholder.className = 'mc-drop-placeholder';
                    placeholder.setAttribute('aria-hidden', 'true');
                }
                placeholder.style.height = Math.max(28, slotHeight) + 'px';
                return placeholder;
            }

            function findInsertBeforeCard(clientY) {
                const cards = eligibleCards();
                if (!cards.length) return null;
                for (const c of cards) {
                    const r = c.getBoundingClientRect();
                    if (clientY < r.top + r.height / 2) return c;
                }
                return null;
            }

            function updatePlaceholderAtY(clientY) {
                const ph = ensurePlaceholder();
                const before = findInsertBeforeCard(clientY);
                container.querySelectorAll('.mc-card--drop-target').forEach(el => el.classList.remove('mc-card--drop-target'));
                if (before) {
                    before.classList.add('mc-card--drop-target');
                    if (ph.nextSibling !== before) before.parentNode.insertBefore(ph, before);
                } else {
                    const cards = eligibleCards();
                    const last = cards[cards.length - 1];
                    if (last) {
                        last.classList.add('mc-card--drop-target');
                        const after = last.nextSibling;
                        if (ph !== after) last.parentNode.insertBefore(ph, after);
                    } else if (!ph.parentNode) {
                        container.appendChild(ph);
                    }
                }
            }

            function computeToIndex() {
                if (!placeholder || !placeholder.parentNode || dragFrom === null) return dragFrom;
                let next = placeholder.nextElementSibling;
                while (next) {
                    if (next.matches && next.matches('.mc-card[' + indexAttr + ']') &&
                        !next.classList.contains('mc-card--drag-source-hidden')) {
                        return cardIndex(next);
                    }
                    next = next.nextElementSibling;
                }
                const cards = eligibleCards();
                if (!cards.length) return dragFrom;
                const lastIdx = cardIndex(cards[cards.length - 1]);
                return lastIdx + 1;
            }

            function endPointerDrag() {
                stopAutoScroll();
                document.removeEventListener('pointermove', onPointerMove, true);
                document.removeEventListener('pointerup', onPointerUp, true);
                document.removeEventListener('pointercancel', onPointerUp, true);
                handle.removeEventListener('pointermove', onPointerMove);
                try { handle.releasePointerCapture(activePointerId); } catch (_e) { /* ignore */ }
                if (dragFrom === null) return;
                const from = dragFrom;
                const to = computeToIndex();
                clearDragUi();
                if (from === to) return;
                onDrop(from, to);
            }

            function onPointerMove(e) {
                if (dragFrom === null || e.pointerId !== activePointerId) return;
                e.preventDefault();
                lastClientY = e.clientY;
                updatePlaceholderAtY(lastClientY);
                updateFloatPreviewY(lastClientY);
            }

            function onPointerUp(e) {
                if (e.pointerId !== activePointerId) return;
                endPointerDrag();
            }

            handle.addEventListener('pointerdown', e => {
                if (!isEnabled() || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                dragFrom = getFromIndex();
                activePointerId = e.pointerId;
                lastClientY = e.clientY;
                scrollParent = null;
                slotHeight = card.offsetHeight || 48;
                container.classList.add('mc-list-dragging');
                handle.classList.add('mc-drag-handle--active');
                createFloatPreview(e.clientY);
                card.classList.add('mc-card--drag-source-hidden');
                card.style.display = 'none';
                const ph = ensurePlaceholder();
                updatePlaceholderAtY(e.clientY);
                startDragScrollLoop();
                try { handle.setPointerCapture(e.pointerId); } catch (_e) { /* ignore */ }
                handle.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointermove', onPointerMove, true);
                document.addEventListener('pointerup', onPointerUp, true);
                document.addEventListener('pointercancel', onPointerUp, true);
            });
        }

        /** Diagnose DnD-Scroll — in Chrome-F12 nach Tampermonkey-Update (unsafeWindow). */
        pageWindow.__mobiledeDragDiag = function(clientY) {
            const c = typeof ausstattungContainer !== 'undefined' ? ausstattungContainer : null;
            if (!c) return { error: 'Popup nicht offen' };
            const sp = c.closest('.mc-popup__scroll');
            const sr = sp ? sp.getBoundingClientRect() : null;
            const maxTop = sp ? Math.max(0, sp.scrollHeight - sp.clientHeight) : 0;
            const y = typeof clientY === 'number' ? clientY : null;
            const edge = 96;
            const inTop = y !== null && sr && y < sr.top + edge;
            const inBottom = y !== null && sr && y > sr.bottom - edge;
            return {
                version: SCRIPT_UI_VERSION,
                manualAus: isPopupManualScope('ausstattung'),
                manualFav: isPopupManualScope('ausstattungFavorites'),
                scrollEl: sp ? sp.className : null,
                scrollTop: sp ? sp.scrollTop : null,
                scrollHeight: sp ? sp.scrollHeight : null,
                clientHeight: sp ? sp.clientHeight : null,
                maxTop,
                scrollable: maxTop >= 1,
                scrollViewportTop: sr ? sr.top : null,
                scrollViewportBottom: sr ? sr.bottom : null,
                pointerY: y,
                inTopEdge: inTop,
                inBottomEdge: inBottom,
                hint: 'Scroll wenn Maus-Y oberhalb/unterhalb des grauen Listenfensters (mc-popup__scroll) liegt',
                listOrder: getAusListOrder()
            };
        };

        function getAusListOrder() {
            return mergeListOrder(aktuelleFeatureFlags.listOrder);
        }

        function isPopupManualScope(scopeKey) {
            const lo = getAusListOrder();
            if (lo.mode !== 'manual') return false;
            return !!(lo.scopes && lo.scopes[scopeKey]);
        }

        function ausDragEnabledForSection(section) {
            if (!isPopupManualScope('ausstattung') && !isPopupManualScope('ausstattungFavorites')) return false;
            if (isPopupManualScope('ausstattung')) return true;
            return section === 'fav' && isPopupManualScope('ausstattungFavorites');
        }

        function ausShowsDragHandles() {
            return isPopupManualScope('ausstattung') || isPopupManualScope('ausstattungFavorites');
        }

        function mkAusDragSpacer() {
            const sp = document.createElement('div');
            sp.className = 'mc-drag-spacer';
            sp.setAttribute('aria-hidden', 'true');
            return sp;
        }

        function techDragEnabled() {
            return isPopupManualScope('tech');
        }

        function listOrderMetaHint(kind) {
            const lo = getAusListOrder();
            const split = useConfigSplitView();
            if (lo.mode === 'manual') {
                if (kind === 'aus') {
                    const parts = [];
                    if (isPopupManualScope('ausstattung')) parts.push('gesamte Liste');
                    else if (isPopupManualScope('ausstattungFavorites')) parts.push('Favoriten');
                    let msg = 'Manuelle Reihenfolge' + (parts.length ? ' (' + parts.join(', ') + ')' : '');
                    if (split && columnSortLockedForAus()) msg += ' · Sort-Dropdown deaktiviert';
                    if (ausShowsDragHandles()) msg += ' · Ziehen (⋮⋮) zum Sortieren';
                    return msg;
                }
                if (kind === 'tech' && isPopupManualScope('tech')) {
                    let msg = 'Manuelle Reihenfolge (Tech) · Ziehen (⋮⋮) zum Sortieren';
                    if (split && columnSortLockedForTech()) msg += ' · Sort-Dropdown deaktiviert';
                    return msg;
                }
            }
            if (kind === 'aus') {
                if (split) {
                    return 'Sortierung über Dropdown · Speichern sortiert alphabetisch nach Anzeigetext';
                }
                return 'Spaltenköpfe sortieren die Anzeige · Speichern sortiert alphabetisch nach Anzeigetext';
            }
            if (kind === 'tech') {
                if (split) {
                    return 'Sortierung über Dropdown · Speichern sortiert alphabetisch nach Begriff';
                }
                return 'Spaltenköpfe sortieren die Anzeige · Speichern sortiert alphabetisch nach Begriff';
            }
            return '';
        }

        function columnSortLockedForAus() {
            const lo = getAusListOrder();
            return lo.mode === 'manual' && (isPopupManualScope('ausstattung') || isPopupManualScope('ausstattungFavorites'));
        }

        function columnSortLockedForTech() {
            return isPopupManualScope('tech');
        }

        function mkSearchBox(placeholder, onInput) {
            const box = document.createElement('div');
            box.className = 'mc-searchbox';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.style.opacity = '0.55';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill', 'currentColor');
            path.setAttribute('d', 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z');
            svg.appendChild(path);
            const inp = document.createElement('input');
            inp.type = 'search';
            inp.placeholder = placeholder;
            inp.autocomplete = 'off';
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'mc-search-clear';
            clear.textContent = '×';
            clear.title = 'Leeren';
            clear.style.display = 'none';
            function emit() { onInput(inp.value); }
            inp.addEventListener('input', () => {
                clear.style.display = inp.value ? 'block' : 'none';
                emit();
            });
            clear.addEventListener('click', () => {
                inp.value = '';
                clear.style.display = 'none';
                emit();
            });
            box.appendChild(svg);
            box.appendChild(inp);
            box.appendChild(clear);
            box._input = inp;
            return box;
        }

        function mkEmptyState(text) {
            const d = document.createElement('div');
            d.className = 'mc-empty';
            d.textContent = text;
            return d;
        }

        function compareBoolVal(v) {
            return v === true ? 1 : 0;
        }

        function sortIndices(indices, items, key, dir, valueFn) {
            if (!key || key === 'config') return [...indices];
            const mult = dir === 'desc' ? -1 : 1;
            return [...indices].sort((ia, ib) => {
                const va = valueFn(items[ia], ia, key);
                const vb = valueFn(items[ib], ib, key);
                let cmp = 0;
                if (typeof va === 'boolean' || typeof vb === 'boolean') {
                    cmp = compareBoolVal(va) - compareBoolVal(vb);
                } else if (typeof va === 'number' && typeof vb === 'number') {
                    cmp = va - vb;
                } else {
                    cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
                }
                if (cmp === 0) return ia - ib;
                return mult * cmp;
            });
        }

        function partitionFavoriteIndices(indices, items) {
            const fav = [];
            const rest = [];
            indices.forEach(i => {
                if (items[i] && items[i].favorit === true) fav.push(i);
                else rest.push(i);
            });
            return { fav, rest };
        }

        function mkSectionHead(text) {
            const h = document.createElement('div');
            h.className = 'mc-section-head';
            h.textContent = text;
            return h;
        }

        function mkSectionDivider() {
            const d = document.createElement('hr');
            d.className = 'mc-section-divider';
            return d;
        }

        function mkColSortBtn(label, sortKey, title, getState, setState, onChange, opts) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mc-col-sort-btn'
                + (opts && opts.left ? ' mc-col-sort-btn--left' : '');
            btn.title = title || ('Nach „' + label + '“ sortieren (Klick wechselt ↑/↓)');
            function syncBtn() {
                const s = getState();
                const on = s.key === sortKey;
                btn.classList.toggle('mc-col-sort-btn--active', on);
                btn.textContent = label + (on ? (s.dir === 'asc' ? ' ↑' : ' ↓') : '');
            }
            btn.addEventListener('click', () => {
                const s = getState();
                if (s.key === sortKey) setState({ key: sortKey, dir: s.dir === 'asc' ? 'desc' : 'asc' });
                else setState({ key: sortKey, dir: 'asc' });
                onChange();
            });
            btn._syncColSort = syncBtn;
            syncBtn();
            return btn;
        }

        function mkColumnSortHeader(rootClass, cells, getState, setState, onChange, gridClass) {
            const row = document.createElement('div');
            row.className = 'mc-col-sort-header ' + rootClass + (gridClass ? ' ' + gridClass : '');
            const syncFns = [];
            cells.forEach(cell => {
                if (cell.spacer) {
                    const sp = document.createElement('span');
                    sp.className = 'mc-col-sort-spacer ' + cell.spacer;
                    sp.setAttribute('aria-hidden', 'true');
                    row.appendChild(sp);
                    return;
                }
                const btn = mkColSortBtn(cell.label, cell.key, cell.title, getState, setState, onChange, cell);
                syncFns.push(btn._syncColSort);
                row.appendChild(btn);
            });
            row._syncColSort = () => syncFns.forEach(fn => fn());
            return row;
        }

        function mkFavBtn(item, onToggle) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mc-fav-btn' + (item.favorit === true ? ' mc-fav-btn--on' : '');
            btn.textContent = item.favorit === true ? '★' : '☆';
            btn.title = item.favorit === true ? 'Favorit entfernen' : 'Als Favorit markieren';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                item.favorit = !item.favorit;
                markDirty();
                onToggle();
            });
            return btn;
        }

        const overlay = document.createElement('div');
        overlay.id = 'mobilede-config-overlay';
        overlay.className = 'mc-overlay-root';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
            width: '100vw', height: '100vh', zIndex: '2147483647',
            backgroundColor: 'rgba(0, 0, 0, 0.72)', opacity: '0',
            transition: 'opacity 0.25s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px', boxSizing: 'border-box'
        });
        document.body.appendChild(overlay);

        const toastHost = document.createElement('div');
        toastHost.className = 'mc-toast-host';
        overlay.appendChild(toastHost);

        function showToast(msg, kind) {
            const t = document.createElement('div');
            t.className = 'mc-toast mc-toast--' + (kind === 'success' ? 'success' : kind === 'warn' ? 'warn' : 'error');
            t.textContent = msg;
            toastHost.appendChild(t);
            setTimeout(() => {
                t.style.opacity = '0';
                t.style.transition = 'opacity .35s';
                setTimeout(() => t.remove(), 400);
            }, 3200);
        }

        function confirmAsync(msg) {
            return new Promise(resolve => {
                const back = document.createElement('div');
                back.className = 'mc-modal-backdrop';
                const modal = document.createElement('div');
                modal.className = 'mc-modal';
                const p = document.createElement('p');
                p.textContent = msg;
                const row = document.createElement('div');
                row.className = 'mc-modal-actions';
                const no = mkBtn('ghost', 'Abbrechen', () => { back.remove(); resolve(false); });
                const yes = mkBtn('primary', 'Bestätigen', () => { back.remove(); resolve(true); });
                row.appendChild(no);
                row.appendChild(yes);
                modal.appendChild(p);
                modal.appendChild(row);
                back.appendChild(modal);
                overlay.appendChild(back);
                yes.focus();
            });
        }

        function confirmSaveWithChangelog(changes) {
            return new Promise(resolve => {
                const back = document.createElement('div');
                back.className = 'mc-modal-backdrop';
                const modal = document.createElement('div');
                modal.className = 'mc-modal mc-modal--wide';
                const h = document.createElement('h3');
                h.className = 'mc-modal__title';
                h.textContent = 'Änderungen speichern?';
                const ul = document.createElement('ul');
                ul.className = 'mc-changelog';
                changes.forEach(line => {
                    const li = document.createElement('li');
                    li.textContent = line;
                    ul.appendChild(li);
                });
                const row = document.createElement('div');
                row.className = 'mc-modal-actions';
                const no = mkBtn('ghost', 'Abbrechen', () => { back.remove(); resolve(false); });
                const yes = mkBtn('primary', 'Speichern', () => { back.remove(); resolve(true); });
                row.appendChild(no);
                row.appendChild(yes);
                modal.appendChild(h);
                modal.appendChild(ul);
                modal.appendChild(row);
                back.appendChild(modal);
                overlay.appendChild(back);
                yes.focus();
            });
        }

        function escListener(e) {
            if (e.key === 'Escape') tryCloseFromUser();
        }
        document.addEventListener('keydown', escListener);

        function removeOverlay() {
            document.removeEventListener('keydown', escListener);
            document.body.style.overflow = prevBodyOverflow;
            try { delete pageWindow.__mobiledeDragDiag; } catch (_e) { pageWindow.__mobiledeDragDiag = undefined; }
            overlay.remove();
        }

        function tryCloseFromUser() {
            if (dirty) {
                showToast('Ungespeicherte Änderungen – bitte Speichern oder Abbrechen.', 'warn');
                return;
            }
            removeOverlay();
        }

        overlay.addEventListener('click', e => {
            if (e.target === overlay) tryCloseFromUser();
        });

        function pushUndo(entry) {
            if (undoStack.length >= 10) undoStack.shift();
            undoStack.push(entry);
            syncUndoBtn();
        }

        function snapshotAus() { return JSON.parse(JSON.stringify(aktuelleAusstattungsKonfig)); }
        function snapshotTech() { return JSON.parse(JSON.stringify(aktuelleTechKonfigurationen)); }
        function snapshotMerge() { return JSON.parse(JSON.stringify(aktuelleMergeGruppen)); }

        let undoBtnRef = null;
        function syncUndoBtn() {
            if (undoBtnRef) undoBtnRef.disabled = undoStack.length === 0;
        }

        function performUndo() {
            const u = undoStack.pop();
            if (!u) return;
            if (u.kind === 'all') {
                aktuelleAusstattungsKonfig = u.aus;
                aktuelleTechKonfigurationen = u.tech;
                aktuelleMergeGruppen = u.merge;
            } else if (u.kind === 'ausstattung') aktuelleAusstattungsKonfig = u.data;
            else if (u.kind === 'tech') aktuelleTechKonfigurationen = u.data;
            else if (u.kind === 'merge') aktuelleMergeGruppen = u.data;
            renderAusstattung();
            renderTechData();
            renderMergeConfig();
            refreshExportArea();
            refreshValidationUI();
            updateTabBadges();
            showToast('Letzte Änderung rückgängig gemacht', 'success');
            syncUndoBtn();
            recomputeDirty();
        }

        const popup = document.createElement('div');
        popup.className = 'mc-popup';
        popup.tabIndex = -1;
        popupRef = popup;

        const head = document.createElement('div');
        head.className = 'mc-popup__head';
        const headRow = document.createElement('div');
        headRow.className = 'mc-popup__head-row';
        const titleBlock = document.createElement('div');
        const title = document.createElement('h2');
        title.className = 'mc-popup__title';
        title.textContent = 'Konfiguration';
        const ver = document.createElement('div');
        ver.className = 'mc-popup__ver';
        ver.textContent = 'Skript UI v' + SCRIPT_UI_VERSION + ' · Schema ' + SCHEMA_VERSION;
        titleBlock.appendChild(title);
        titleBlock.appendChild(ver);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'mc-icon-btn';
        closeBtn.setAttribute('aria-label', 'Schließen');
        closeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71a1 1 0 00-1.41 0L12 10.59 7.11 5.7A1 1 0 105.7 7.11L10.59 12 5.7 16.89a1 1 0 101.41 1.41L12 13.41l4.89 4.89a1 1 0 001.41-1.41L13.41 12l4.89-4.89a1 1 0 000-1.4z"/></svg>';
        closeBtn.addEventListener('click', tryCloseFromUser);
        headRow.appendChild(titleBlock);
        headRow.appendChild(closeBtn);
        head.appendChild(headRow);

        const tabStrip = document.createElement('div');
        tabStrip.className = 'mc-tabs-strip';
        tabStrip.setAttribute('role', 'tablist');
        head.appendChild(tabStrip);

        const scroll = document.createElement('div');
        scroll.className = 'mc-popup__scroll';

        const panelAus = document.createElement('div');
        panelAus.className = 'mc-panel mc-panel--active';
        panelAus.setAttribute('role', 'tabpanel');
        const panelTech = document.createElement('div');
        panelTech.className = 'mc-panel';
        panelTech.setAttribute('role', 'tabpanel');
        const panelMerge = document.createElement('div');
        panelMerge.className = 'mc-panel';
        const panelIE = document.createElement('div');
        panelIE.className = 'mc-panel';
        const panelConfig = document.createElement('div');
        panelConfig.className = 'mc-panel';
        panelConfig.setAttribute('role', 'tabpanel');

        scroll.appendChild(panelAus);
        scroll.appendChild(panelTech);
        scroll.appendChild(panelMerge);
        scroll.appendChild(panelIE);
        scroll.appendChild(panelConfig);

        const footWrap = document.createElement('div');
        footWrap.style.position = 'relative';
        const issuePop = document.createElement('div');
        issuePop.className = 'mc-issue-pop';
        const foot = document.createElement('div');
        foot.className = 'mc-popup__foot';
        const footLeft = document.createElement('div');
        footLeft.className = 'mc-foot-left';
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.className = 'mc-status-btn mc-status-ok';
        statusBtn.textContent = '✔ Alles ok';
        const footRight = document.createElement('div');
        footRight.className = 'mc-foot-right';
        const undoBtn = mkBtn('ghost', 'Rückgängig', () => performUndo());
        undoBtn.disabled = true;
        undoBtnRef = undoBtn;
        const footerResetHandlers = [null, null, null, null, null];
        const btnResetTab = mkBtn('danger', 'Defaults zurücksetzen', () => {
            const fn = footerResetHandlers[activeTabIndex];
            if (fn) fn();
        });
        btnResetTab.classList.add('mc-foot-reset');
        const footSep = document.createElement('span');
        footSep.className = 'mc-foot-sep';
        footSep.setAttribute('aria-hidden', 'true');
        function syncFooterReset(tabIdx) {
            const fn = footerResetHandlers[tabIdx];
            btnResetTab.classList.toggle('mc-foot-reset--visible', !!fn);
            btnResetTab.disabled = !fn;
        }
        const cancelBtn = mkBtn('ghost', 'Abbrechen', () => removeOverlay());
        const saveBtn = mkBtn('primary', 'Speichern', null);
        saveBtnRef = saveBtn;
        syncSaveBtn();

        footLeft.appendChild(statusBtn);
        footRight.appendChild(btnResetTab);
        footRight.appendChild(footSep);
        footRight.appendChild(undoBtn);
        footRight.appendChild(cancelBtn);
        footRight.appendChild(saveBtn);
        foot.appendChild(footLeft);
        foot.appendChild(footRight);
        footWrap.appendChild(issuePop);
        footWrap.appendChild(foot);

        popup.appendChild(head);
        popup.appendChild(scroll);
        popup.appendChild(footWrap);

        overlay.appendChild(popup);
        requestAnimationFrame(() => {
            pricePerfMarkEnd('popupOpen', popupPerfStart, 50);
        });

        const tabButtons = [];
        function mkTab(label, idx) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mc-tab' + (idx === 0 ? ' mc-tab--active' : '');
            if (label === 'Config') b.classList.add('mc-tab--config');
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
            b.dataset.tabIndex = String(idx);
            const spanMain = document.createElement('span');
            spanMain.textContent = label;
            const badge = document.createElement('span');
            badge.className = 'mc-tab-badge';
            b.appendChild(spanMain);
            b.appendChild(badge);
            b.addEventListener('click', () => setActiveTab(idx));
            tabStrip.appendChild(b);
            tabButtons.push({ btn: b, badge, labelSpan: spanMain });
            return badge;
        }
        mkTab('Ausstattung', 0);
        mkTab('Tech-Daten', 1);
        mkTab('Merge-Gruppen', 2);
        mkTab('Import / Export', 3);
        mkTab('Config', 4);

        const panels = [panelAus, panelTech, panelMerge, panelIE, panelConfig];

        function setActiveTab(idx) {
            activeTabIndex = idx;
            tabButtons.forEach((t, i) => {
                const on = i === idx;
                t.btn.classList.toggle('mc-tab--active', on);
                t.btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            panels.forEach((p, i) => p.classList.toggle('mc-panel--active', i === idx));
            syncFooterReset(idx);
            tabButtons[idx].btn.focus();
        }

        tabStrip.addEventListener('keydown', e => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                setActiveTab((activeTabIndex + 1) % panels.length);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setActiveTab((activeTabIndex + panels.length - 1) % panels.length);
            }
        });

        /** --- Ausstattung --- */
        const ausTb = buildListToolbar({
            searchPlaceholder: 'Filter (Anzeigetext oder Begriff)…',
            onSearch: () => { renderAusstattung(); },
            filters: [
                { label: 'nur aktive', title: 'Nur aktive Einträge anzeigen' },
                { label: 'nur Favoriten', title: 'Nur favorisierte Einträge anzeigen' },
                { label: 'mit Verboten', title: 'Nur Einträge mit verbotenen Begriffen' }
            ],
            bulk: { onAll: flag => bulkAusAlle(flag) },
            onNeu: () => {
                aktuelleAusstattungsKonfig.unshift({ begriffe: [], anzeige: '', farbe: '#66ff66', aktiv: true });
                ausTb.search._input.value = '';
                onlyCb.checked = false;
                favOnlyCb.checked = false;
                verbotenOnlyCb.checked = false;
                selectedAusIndex = 0;
                expandedAusstattungIndex = useConfigSplitView() ? null : 0;
                markDirty();
                renderAusstattung();
                showToast('Neuer Ausstattungseintrag', 'success');
            }
        });
        const ausToolbar = ausTb.toolbar;
        const ausSearch = ausTb.search;
        const ausMetaStats = ausTb.metaStats;
        const ausMetaHint = ausTb.metaHint;
        const onlyCb = ausTb.filterCbs[0];
        const favOnlyCb = ausTb.filterCbs[1];
        const verbotenOnlyCb = ausTb.filterCbs[2];
        const ausSortDropdown = mkSortDropdown(ausSort, [
            { key: 'anzeige', dir: 'asc', label: 'Anzeige A–Z' },
            { key: 'anzeige', dir: 'desc', label: 'Anzeige Z–A' },
            { key: 'aktiv', dir: 'desc', label: 'Aktiv zuerst' },
            { key: 'favorit', dir: 'desc', label: 'Favoriten zuerst' },
            { key: 'begriffeCount', dir: 'desc', label: 'Meiste Begriffe' }
        ], false, () => renderAusstattung());
        const ausDupToolbarBtn = mkBtn('ghost', 'Duplizieren', () => {
            if (selectedAusIndex === null) return;
            duplicateAusEntry(selectedAusIndex);
        });
        ausDupToolbarBtn.classList.add('mc-toolbar-split-only');
        ausDupToolbarBtn.disabled = true;
        const ausToolbarMetaRow = ausToolbar.querySelector('.mc-toolbar__row--meta');
        if (ausToolbarMetaRow) {
            ausToolbarMetaRow.insertBefore(ausSortDropdown, ausToolbarMetaRow.firstChild);
            const neuBtn = ausToolbarMetaRow.querySelector('.mc-btn--primary');
            if (neuBtn) ausToolbarMetaRow.insertBefore(ausDupToolbarBtn, neuBtn);
            else ausToolbarMetaRow.appendChild(ausDupToolbarBtn);
        }
        function syncSplitToolbarVisibility() {
            const split = useConfigSplitView();
            ausSortDropdown.querySelector('select').disabled = columnSortLockedForAus();
            ausDupToolbarBtn.disabled = !split || selectedAusIndex === null;
        }
        footerResetHandlers[0] = async () => {
            const ok = await confirmAsync('Ausstattungs-Konfiguration auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'ausstattung', data: snapshotAus() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_config', aktuelleAusstattungsKonfig);
            aktuelleAusstattungsKonfig = JSON.parse(JSON.stringify(suchKonfigurationenDefault));
            markDirty();
            renderAusstattung();
            showToast('Ausstattung auf Standard zurückgesetzt (Backup angelegt)', 'success');
        };

        const ausstattungContainer = document.createElement('div');
        ausstattungContainer.className = 'mc-aus-list-scroll mc-config-classic-root';
        const ausSplitShell = mkConfigSplitShell('aus');
        ausSplitShell.root.classList.add('mc-config-split-root');
        ausSplitShell.root.hidden = true;
        const ausSplit = ausSplitShell;
        panelAus.appendChild(ausToolbar);
        panelAus.appendChild(ausstattungContainer);
        panelAus.appendChild(ausSplit.root);
        installKonfigTabHelp('aus', 'mc-konfig-help-aus', 'Hilfe zum Tab Ausstattung', 'Hilfe zu Ausstattung', ausTb.searchRow, null, panelAus, ausstattungContainer);

        function ausCompareValue(item, idx, key) {
            switch (key) {
                case 'anzeige': return (item.anzeige || '').trim();
                case 'aktiv': return item.aktiv === true;
                case 'favorit': return item.favorit === true;
                case 'farbe': return normalizeHexColor(item.farbe || '');
                case 'nurInFeatures': return item.nurInFeatures === true;
                case 'compound': return item.compound === true;
                case 'begriffeCount': return Array.isArray(item.begriffe) ? item.begriffe.length : 0;
                case 'config':
                default: return idx;
            }
        }

        function mkAusColumnSortHeader() {
            return mkColumnSortHeader('mc-col-sort-header--aus', [
                { spacer: 'mc-col-sort-inert' },
                { spacer: 'mc-col-sort-inert' },
                { key: 'aktiv', label: 'Aktiv' },
                { key: 'anzeige', label: 'Anzeige', left: true },
                { key: 'farbe', label: 'Farbe' },
                { key: 'nurInFeatures', label: 'Ausst.-Liste', title: 'Nur Ausstattungsliste' },
                { key: 'compound', label: 'Wortteil', title: 'Wortteil-Suche' },
                { key: 'begriffeCount', label: 'Details', title: 'Anzahl Begriffe' }
            ], () => ausSort, s => { ausSort = s; }, () => { renderAusstattung(); }, 'mc-aus-grid');
        }

        function ausstattungSichtbar(item) {
            const f = ausSearch._input.value.trim().toLowerCase();
            if (onlyCb.checked && !item.aktiv) return false;
            if (favOnlyCb.checked && item.favorit !== true) return false;
            if (verbotenOnlyCb.checked && !(Array.isArray(item.verboten) && item.verboten.length)) return false;
            if (!f) return true;
            if ((item.anzeige || '').toLowerCase().includes(f)) return true;
            if ((item.begriffe || []).some(b => String(b).toLowerCase().includes(f))) return true;
            if ((item.verboten || []).some(b => String(b).toLowerCase().includes(f))) return true;
            return false;
        }

        function duplicateAusEntry(idx) {
            pushUndo({ kind: 'ausstattung', data: snapshotAus() });
            const copy = JSON.parse(JSON.stringify(aktuelleAusstattungsKonfig[idx]));
            copy.anzeige = (copy.anzeige || '') + ' (Kopie)';
            aktuelleAusstattungsKonfig.splice(idx + 1, 0, copy);
            selectedAusIndex = idx + 1;
            expandedAusstattungIndex = useConfigSplitView() ? null : selectedAusIndex;
            markDirty();
            renderAusstattung();
            showToast('Eintrag dupliziert', 'success');
        }

        function sanitizeSelectedAusIndex() {
            if (selectedAusIndex === null) return;
            const n = aktuelleAusstattungsKonfig.length;
            if (!Number.isInteger(selectedAusIndex) || selectedAusIndex < 0 || selectedAusIndex >= n) {
                selectedAusIndex = null;
            }
        }

        function reorderSelectedAusAfterDrop(from, to) {
            if (selectedAusIndex === null) return;
            const insertAt = from < to ? to - 1 : to;
            if (selectedAusIndex === from) {
                selectedAusIndex = insertAt;
                return;
            }
            let e = selectedAusIndex;
            if (from < e) e--;
            if (insertAt <= e) e++;
            selectedAusIndex = e;
        }

        function selectAusIndex(idx, openSheet) {
            selectedAusIndex = idx;
            syncSplitToolbarVisibility();
            if (openSheet !== false && useConfigSplitView()) {
                fillAusEditor(idx);
                ausSplit.openEditorSheet();
            } else if (useConfigSplitView()) {
                fillAusEditor(idx);
            }
            ausSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                const i = parseInt(el.dataset.cfgIndex, 10);
                el.classList.toggle('mc-config-split__list-item--selected', i === idx);
            });
        }

        function fillAusEditor(idx) {
            const editor = ausSplit.editor;
            editor.innerHTML = '';
            if (idx === null || !aktuelleAusstattungsKonfig[idx]) {
                fillEditorPlaceholder(editor);
                return;
            }
            const item = aktuelleAusstattungsKonfig[idx];
            const title = document.createElement('div');
            title.className = 'mc-config-split__editor-title';
            title.textContent = (item.anzeige || '').trim() || 'Neuer Eintrag';
            editor.appendChild(title);

            const fields = document.createElement('div');
            fields.className = 'mc-config-split__editor-fields';

            const inpAnz = document.createElement('input');
            inpAnz.type = 'text';
            inpAnz.className = 'mc-input';
            inpAnz.value = item.anzeige || '';
            inpAnz.addEventListener('input', () => {
                item.anzeige = inpAnz.value;
                markDirty();
                refreshValidationUI();
                title.textContent = (item.anzeige || '').trim() || 'Neuer Eintrag';
            });
            fields.appendChild(mkConfigSplitEditorField('Anzeigetext', inpAnz));

            if (!Array.isArray(item.begriffe)) item.begriffe = [];
            const chipB = mkChipInput(item.begriffe, {
                onChange: arr => {
                    item.begriffe = arr;
                    markDirty();
                    refreshValidationUI();
                    renderAusstattungSplitListOnly();
                }
            });
            fields.appendChild(mkConfigSplitEditorField('Suchbegriffe (Komma oder Enter · Klick auf Chip zum Bearbeiten)', chipB.wrap));

            if (!Array.isArray(item.verboten)) item.verboten = [];
            const chipV = mkChipInput(item.verboten, {
                variant: 'warn',
                onChange: arr => {
                    item.verboten = arr;
                    markDirty();
                    refreshValidationUI();
                    renderAusstattungSplitListOnly();
                }
            });
            fields.appendChild(mkConfigSplitEditorField('Verbotene Begriffe', chipV.wrap));

            editor.appendChild(fields);

            const footer = mkConfigSplitEditorFooter();

            const colorField = document.createElement('div');
            colorField.className = 'mc-config-split__editor-field';
            const lbC = document.createElement('div');
            lbC.className = 'mc-label-sm';
            lbC.textContent = 'Farbe';
            const colorRowWrap = document.createElement('div');
            colorRowWrap.className = 'mc-config-split__editor-color-row';
            const colorRow = mkColorInput(item.farbe || '', v => {
                item.farbe = v;
                markDirty();
                renderAusstattungSplitListOnly();
            }, { styledPicker: true });
            colorRowWrap.appendChild(colorRow);
            colorField.appendChild(lbC);
            colorField.appendChild(colorRowWrap);
            footer.appendChild(colorField);

            footer.appendChild(mkConfigSplitOptionsField([
                {
                    checked: item.nurInFeatures === true,
                    title: 'Nur Ausstattungsliste',
                    hint: 'Treffer nur in der strukturierten Liste, nicht im Beschreibungstext',
                    onChange: v => {
                        item.nurInFeatures = v;
                        markDirty();
                        renderAusstattungSplitListOnly();
                    }
                },
                {
                    checked: item.compound === true,
                    title: 'Wortteil-Suche',
                    hint: 'Treffer auch mitten im Wort (z. B. „heizung" findet „Standheizung")',
                    onChange: v => {
                        item.compound = v;
                        markDirty();
                        renderAusstattungSplitListOnly();
                    }
                }
            ]));

            const actions = mkConfigSplitEditorActions();
            actions.appendChild(mkBtn('dup', 'Duplizieren', () => duplicateAusEntry(idx)));
            actions.appendChild(mkBtn('del', 'Löschen', async () => {
                const ok = await confirmAsync('Eintrag wirklich löschen?');
                if (!ok) return;
                pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                aktuelleAusstattungsKonfig.splice(idx, 1);
                if (selectedAusIndex === idx) selectedAusIndex = null;
                else if (selectedAusIndex !== null && selectedAusIndex > idx) selectedAusIndex--;
                markDirty();
                renderAusstattung();
                showToast('Eintrag entfernt', 'success');
            }));
            footer.appendChild(actions);

            editor.appendChild(footer);
        }

        function countAusaktiv() {
            const t = aktuelleAusstattungsKonfig.length;
            const a = aktuelleAusstattungsKonfig.filter(i => i.aktiv).length;
            return { a, t };
        }

        function getVisibleAusIndices() {
            const ix = [];
            aktuelleAusstattungsKonfig.forEach((item, idx) => {
                if (ausstattungSichtbar(item)) ix.push(idx);
            });
            return ix;
        }

        function bulkAusAlle(flag) {
            pushUndo({ kind: 'ausstattung', data: snapshotAus() });
            aktuelleAusstattungsKonfig.forEach(i => { i.aktiv = flag; });
            markDirty();
            renderAusstattung();
            showToast(flag ? 'Alle Einträge aktiviert' : 'Alle Einträge deaktiviert', 'success');
        }

        function cardIssuesAus(idx, item) {
            const errs = [];
            if (!item.anzeige || !item.anzeige.trim()) errs.push('Anzeigetext fehlt');
            if (!Array.isArray(item.begriffe) || item.begriffe.length === 0) errs.push('Keine Suchbegriffe');
            const key = (item.anzeige || '').trim().toLowerCase();
            if (key) {
                const dup = aktuelleAusstattungsKonfig.findIndex((other, j) =>
                    j !== idx && (other.anzeige || '').trim().toLowerCase() === key);
                if (dup !== -1) errs.push('Doppelter Anzeigetext');
            }
            return errs;
        }

        function sanitizeExpandedAusstattungIndex() {
            if (expandedAusstattungIndex === null) return;
            const n = aktuelleAusstattungsKonfig.length;
            if (!Number.isInteger(expandedAusstattungIndex) || expandedAusstattungIndex < 0 ||
                expandedAusstattungIndex >= n) {
                expandedAusstattungIndex = null;
            }
        }

        function applyAusAccordionStateToAusCards() {
            sanitizeExpandedAusstattungIndex();
            ausstattungContainer.querySelectorAll('.mc-card').forEach(card => {
                const ci = parseInt(card.dataset.cfgIndex, 10);
                const item = aktuelleAusstattungsKonfig[ci];
                if (!item) return;
                const panel = card.querySelector('.mc-advanced');
                const eb = card.querySelector('.mc-card__expand');
                const mainLab = eb && eb.querySelector('.mc-card__expand-main');
                const isOpen = expandedAusstattungIndex !== null && expandedAusstattungIndex === ci;
                if (panel) panel.classList.toggle('mc-advanced--open', isOpen);
                const nPart = Array.isArray(item.begriffe) ? item.begriffe.length : 0;
                const vPart = Array.isArray(item.verboten) ? item.verboten.length : 0;
                const begriffeW = nPart === 1 ? 'Begriff' : 'Begriffe';
                const verboteW = vPart === 1 ? 'Verbot' : 'Verbote';
                if (eb) {
                    eb.setAttribute('aria-expanded', String(isOpen));
                    eb.title = 'Details anzeigen / verbergen — ' + nPart + ' ' + begriffeW + ', ' + vPart + ' ' + verboteW;
                    eb.setAttribute('aria-label',
                        (isOpen
                            ? 'Details-Bereich verbergen. Blendet die Felder für Suchbegriffe und verbotene Wörter aus.'
                            : 'Details-Bereich anzeigen. Öffnet die Felder zum Bearbeiten von Suchbegriffen und verbotenen Wörtern.') +
                        ' Aktuell ' + nPart + ' ' + begriffeW + ' und ' + vPart + ' ' + verboteW + '.');
                }
                if (mainLab) mainLab.textContent = 'Details [' + nPart + ']';
            });
        }

        function reorderExpandedAusAfterDrop(from, to) {
            if (expandedAusstattungIndex === null) return;
            const insertAt = from < to ? to - 1 : to;
            if (expandedAusstattungIndex === from) {
                expandedAusstattungIndex = insertAt;
                return;
            }
            let e = expandedAusstattungIndex;
            if (from < e) e--;
            if (insertAt <= e) e++;
            expandedAusstattungIndex = e;
        }

        function appendAusstattungCard(index, dragSection) {
                const item = aktuelleAusstattungsKonfig[index];
                if (!item) return;
                const section = dragSection || 'rest';
                const card = document.createElement('div');
                card.className = 'mc-card';
                card.dataset.cfgIndex = String(index);
                card.dataset.dragSection = section;
                card.draggable = false;

                const errs = cardIssuesAus(index, item);
                if (errs.length) {
                    card.classList.add('mc-card--invalid');
                    const er = document.createElement('p');
                    er.className = 'mc-card__err';
                    er.textContent = errs.join(' · ');
                    card.appendChild(er);
                }

                const rowTop = document.createElement('div');
                rowTop.className = 'mc-card__main-row mc-card__main-row--aus mc-aus-grid';

                const dragOn = ausDragEnabledForSection(section);

                const toggleEl = mkToggle(item.aktiv === true, v => {
                    item.aktiv = v;
                    markDirty();
                    renderAusstattung();
                    refreshValidationUI();
                });

                const titleInp = document.createElement('input');
                titleInp.type = 'text';
                titleInp.className = 'mc-card__title-input mc-input' + (!item.aktiv ? ' inactive' : '');
                titleInp.value = item.anzeige || '';
                titleInp.placeholder = 'Anzeigetext';
                titleInp.addEventListener('input', () => {
                    item.anzeige = titleInp.value;
                    markDirty();
                    refreshValidationUI();
                });

                const panelId = 'mc-card-panel-' + index;

                const colorRow = mkColorInput(item.farbe || '', v => {
                    item.farbe = v;
                    markDirty();
                });

                if (dragOn) rowTop.appendChild(mkDragHandle(true));
                else rowTop.appendChild(mkAusDragSpacer());
                rowTop.appendChild(mkFavBtn(item, () => renderAusstattung()));
                const tw = document.createElement('div');
                tw.className = 'mc-toggle-wrap';
                tw.appendChild(toggleEl);
                rowTop.appendChild(tw);
                rowTop.appendChild(titleInp);
                rowTop.appendChild(colorRow);

                const pf = document.createElement('label');
                pf.className = 'mc-pill' + (item.nurInFeatures ? ' mc-pill--on' : '');
                pf.title = 'Nur in der strukturierten Ausstattungsliste suchen, Beschreibungstext ignorieren';
                const pfc = document.createElement('input');
                pfc.type = 'checkbox';
                pfc.checked = item.nurInFeatures === true;
                pfc.addEventListener('change', () => {
                    item.nurInFeatures = pfc.checked;
                    pf.classList.toggle('mc-pill--on', pfc.checked);
                    markDirty();
                });
                pf.appendChild(pfc);
                pf.appendChild(document.createTextNode('Nur Ausstattungsliste '));
                const inf1 = document.createElement('span');
                inf1.className = 'mc-info';
                inf1.textContent = '?';
                inf1.title = pf.title;
                pf.appendChild(inf1);

                const pc = document.createElement('label');
                pc.className = 'mc-pill' + (item.compound ? ' mc-pill--on' : '');
                pc.title = 'Treffer auch mitten im Wort erlauben (z.B. „heizung" findet „Standheizung")';
                const pcc = document.createElement('input');
                pcc.type = 'checkbox';
                pcc.checked = item.compound === true;
                pcc.addEventListener('change', () => {
                    item.compound = pcc.checked;
                    pc.classList.toggle('mc-pill--on', pcc.checked);
                    markDirty();
                });
                pc.appendChild(pcc);
                pc.appendChild(document.createTextNode('Wortteil-Suche '));
                const inf2 = document.createElement('span');
                inf2.className = 'mc-info';
                inf2.textContent = '?';
                inf2.title = pc.title;
                pc.appendChild(inf2);

                rowTop.appendChild(pf);
                rowTop.appendChild(pc);

                const expandBtn = document.createElement('button');
                expandBtn.type = 'button';
                expandBtn.className = 'mc-btn mc-btn--ghost mc-card__expand';
                expandBtn.setAttribute('aria-controls', panelId);
                const expandIcon = document.createElement('span');
                expandIcon.className = 'mc-card__expand-icon';
                expandIcon.setAttribute('aria-hidden', 'true');
                expandIcon.textContent = '▾';
                const expandLabelWrap = document.createElement('span');
                expandLabelWrap.className = 'mc-card__expand-label-wrap';
                const expandMainLabel = document.createElement('span');
                expandMainLabel.className = 'mc-card__expand-main';
                expandMainLabel.setAttribute('aria-hidden', 'true');
                expandLabelWrap.appendChild(expandMainLabel);
                expandBtn.appendChild(expandIcon);
                expandBtn.appendChild(expandLabelWrap);
                rowTop.appendChild(expandBtn);

                card.appendChild(rowTop);

                const adv = document.createElement('div');
                adv.id = panelId;
                adv.className = 'mc-advanced' + (expandedAusstattungIndex !== null && expandedAusstattungIndex === index ? ' mc-advanced--open' : '');
                function updateExpandButton() {
                    const isOpen = expandedAusstattungIndex !== null && expandedAusstattungIndex === index;
                    const n = Array.isArray(item.begriffe) ? item.begriffe.length : 0;
                    const v = Array.isArray(item.verboten) ? item.verboten.length : 0;
                    const begriffeW = n === 1 ? 'Begriff' : 'Begriffe';
                    const verboteW = v === 1 ? 'Verbot' : 'Verbote';
                    expandBtn.setAttribute('aria-expanded', String(isOpen));
                    expandMainLabel.textContent = 'Details [' + n + ']';
                    expandBtn.title = 'Details anzeigen / verbergen — ' + n + ' ' + begriffeW + ', ' + v + ' ' + verboteW;
                    expandBtn.setAttribute('aria-label',
                        (isOpen
                            ? 'Details-Bereich verbergen. Blendet die Felder für Suchbegriffe und verbotene Wörter aus.'
                            : 'Details-Bereich anzeigen. Öffnet die Felder zum Bearbeiten von Suchbegriffen und verbotenen Wörtern.') +
                        ' Aktuell ' + n + ' ' + begriffeW + ' und ' + v + ' ' + verboteW + '.');
                }
                function toggleAdvanced() {
                    if (expandedAusstattungIndex === index) expandedAusstattungIndex = null;
                    else expandedAusstattungIndex = index;
                    applyAusAccordionStateToAusCards();
                }
                updateExpandButton();
                expandBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleAdvanced();
                });
                const lb1 = document.createElement('div');
                lb1.className = 'mc-label-sm';
                lb1.textContent = 'Begriffe (Komma-getrennt)';
                const txtBegriffe = document.createElement('textarea');
                txtBegriffe.className = 'mc-textarea';
                txtBegriffe.rows = 3;
                txtBegriffe.value = (item.begriffe || []).join(', ');
                txtBegriffe.addEventListener('input', () => {
                    item.begriffe = txtBegriffe.value.split(',').map(s => s.trim()).filter(Boolean);
                    markDirty();
                    refreshValidationUI();
                    updateExpandButton();
                });
                const lb2 = document.createElement('div');
                lb2.className = 'mc-label-sm';
                lb2.textContent = 'Verbotene Wörter';
                const txtVerboten = document.createElement('textarea');
                txtVerboten.className = 'mc-textarea';
                txtVerboten.rows = 2;
                txtVerboten.value = (item.verboten || []).join(', ');
                txtVerboten.addEventListener('input', () => {
                    item.verboten = txtVerboten.value.split(',').map(s => s.trim()).filter(Boolean);
                    markDirty();
                    updateExpandButton();
                });
                const btnLoeschen = mkBtn('ghost', 'Löschen', () => {
                    pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                    const ix = parseInt(card.dataset.cfgIndex, 10);
                    aktuelleAusstattungsKonfig.splice(ix, 1);
                    if (expandedAusstattungIndex !== null) {
                        if (expandedAusstattungIndex === ix) expandedAusstattungIndex = null;
                        else if (expandedAusstattungIndex > ix) expandedAusstattungIndex--;
                    }
                    markDirty();
                    renderAusstattung();
                    showToast('Eintrag entfernt', 'success');
                });
                btnLoeschen.style.alignSelf = 'flex-end';

                adv.appendChild(lb1);
                adv.appendChild(txtBegriffe);
                adv.appendChild(lb2);
                adv.appendChild(txtVerboten);
                adv.appendChild(btnLoeschen);
                card.appendChild(adv);

                if (dragOn) setupListDragReorder({
                    container: ausstattungContainer,
                    handle: card.querySelector('.mc-drag-handle'),
                    card,
                    indexAttr: 'data-cfg-index',
                    getFromIndex: () => parseInt(card.dataset.cfgIndex, 10),
                    isEnabled: () => ausDragEnabledForSection(section),
                    getSection: c => c.dataset.dragSection || 'rest',
                    canDropInSection: (fromSec, toSec) => {
                        if (isPopupManualScope('ausstattung')) return true;
                        return fromSec === toSec;
                    },
                    onDrop: (from, to) => {
                        if (from === to) return;
                        pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                        const moved = aktuelleAusstattungsKonfig[from];
                        aktuelleAusstattungsKonfig.splice(from, 1);
                        const insertAt = from < to ? to - 1 : to;
                        aktuelleAusstattungsKonfig.splice(insertAt, 0, moved);
                        reorderExpandedAusAfterDrop(from, to);
                        markDirty();
                        renderAusstattung();
                    }
                });

                ausstattungContainer.appendChild(card);
        }

        function appendAusListRow(index, dragSection) {
            const item = aktuelleAusstattungsKonfig[index];
            if (!item) return;
            const section = dragSection || 'rest';
            const dragOn = ausDragEnabledForSection(section);
            const handle = dragOn ? mkDragHandle(true) : null;
            const toggleEl = mkToggle(item.aktiv === true, v => {
                item.aktiv = v;
                markDirty();
                renderAusstattung();
                refreshValidationUI();
            });
            const tw = document.createElement('div');
            tw.className = 'mc-toggle-wrap';
            tw.appendChild(toggleEl);
            const favBtn = mkFavBtn(item, () => renderAusstattung());
            const dot = document.createElement('span');
            dot.className = 'mc-config-split__color-dot';
            dot.style.background = normalizeHexColor(item.farbe || '');
            const badges = [];
            if (item.nurInFeatures) badges.push('Ausstattung');
            if (item.compound) badges.push('Wortteil');
            const vCount = Array.isArray(item.verboten) ? item.verboten.length : 0;
            if (vCount) badges.push(vCount + ' verboten');
            const errs = cardIssuesAus(index, item);
            const row = mkSplitListItem({
                index,
                dragSection: section,
                selected: selectedAusIndex === index,
                inactive: !item.aktiv,
                handle,
                toggleWrap: tw,
                favBtn,
                colorDot: dot,
                label: (item.anzeige || '').trim() || '(ohne Anzeige)',
                title: item.anzeige || '',
                badges,
                warn: errs.length ? errs.join(' · ') : null,
                onSelect: () => selectAusIndex(index, true)
            });
            row.dataset.cfgIndex = String(index);
            row.dataset.dragSection = section;
            if (dragOn && handle) setupListDragReorder({
                container: ausSplit.list,
                handle,
                card: row,
                indexAttr: 'data-cfg-index',
                getFromIndex: () => parseInt(row.dataset.cfgIndex, 10),
                isEnabled: () => ausDragEnabledForSection(section),
                getSection: c => c.dataset.dragSection || 'rest',
                canDropInSection: (fromSec, toSec) => {
                    if (isPopupManualScope('ausstattung')) return true;
                    return fromSec === toSec;
                },
                onDrop: (from, to) => {
                    if (from === to) return;
                    pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                    const moved = aktuelleAusstattungsKonfig[from];
                    aktuelleAusstattungsKonfig.splice(from, 1);
                    const insertAt = from < to ? to - 1 : to;
                    aktuelleAusstattungsKonfig.splice(insertAt, 0, moved);
                    reorderSelectedAusAfterDrop(from, to);
                    markDirty();
                    renderAusstattung();
                }
            });
            ausSplit.list.appendChild(row);
        }

        function getSortedAusVisibleIndices() {
            const vis = getVisibleAusIndices();
            const manualFull = isPopupManualScope('ausstattung');
            const manualFavOnly = isPopupManualScope('ausstattungFavorites') && !manualFull;
            const sortKey = columnSortLockedForAus() ? 'config' : ausSort.key;
            const sortDir = ausSort.dir;
            const { fav, rest } = partitionFavoriteIndices(vis, aktuelleAusstattungsKonfig);
            let sortedFav;
            let sortedRest;
            if (manualFull) {
                sortedFav = orderIndicesByArrayPosition(fav);
                sortedRest = orderIndicesByArrayPosition(rest);
            } else if (manualFavOnly) {
                sortedFav = orderIndicesByArrayPosition(fav);
                sortedRest = sortIndices(rest, aktuelleAusstattungsKonfig, sortKey, sortDir, ausCompareValue);
            } else {
                sortedFav = sortIndices(fav, aktuelleAusstattungsKonfig, sortKey, sortDir, ausCompareValue);
                sortedRest = sortIndices(rest, aktuelleAusstattungsKonfig, sortKey, sortDir, ausCompareValue);
            }
            return { vis, sortedFav, sortedRest, favVis: vis.filter(i => aktuelleAusstattungsKonfig[i].favorit === true).length };
        }

        function renderAusstattungSplitListOnly() {
            if (!useConfigSplitView()) return;
            const sel = selectedAusIndex;
            ausSplit.list.innerHTML = '';
            const { vis, sortedFav, sortedRest, favVis } = getSortedAusVisibleIndices();
            if (!vis.length) return;
            function renderBlock(indices, heading, dragSection) {
                if (!indices.length) return;
                if (heading) ausSplit.list.appendChild(mkSectionHead(heading));
                indices.forEach(idx => appendAusListRow(idx, dragSection));
            }
            if (sortedFav.length && sortedRest.length) {
                renderBlock(sortedFav, 'Favoriten', 'fav');
                ausSplit.list.appendChild(mkSectionDivider());
                renderBlock(sortedRest, 'Weitere Einträge', 'rest');
            } else if (sortedFav.length) {
                renderBlock(sortedFav, favVis < vis.length ? 'Favoriten' : null, 'fav');
            } else {
                renderBlock(sortedRest, null, 'rest');
            }
            if (sel !== null) {
                ausSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                    el.classList.toggle('mc-config-split__list-item--selected', parseInt(el.dataset.cfgIndex, 10) === sel);
                });
            }
        }

        function renderAusstattungSplit() {
            sanitizeSelectedAusIndex();
            ausSplit.list.innerHTML = '';
            const { a, t } = countAusaktiv();
            const { vis, sortedFav, sortedRest, favVis } = getSortedAusVisibleIndices();
            ausMetaStats.textContent = vis.length + ' sichtbar · ' + a + ' von ' + t + ' aktiv · ' + favVis + ' Favoriten';
            ausMetaHint.textContent = listOrderMetaHint('aus');
            syncSplitToolbarVisibility();
            if (aktuelleAusstattungsKonfig.length === 0) {
                ausSplit.list.appendChild(mkEmptyState('Noch keine Einträge.'));
                fillEditorPlaceholder(ausSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (vis.length === 0) {
                ausSplit.list.appendChild(mkEmptyState('Keine Treffer für den aktuellen Filter.'));
                fillEditorPlaceholder(ausSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            function renderBlock(indices, heading, dragSection) {
                if (!indices.length) return;
                if (heading) ausSplit.list.appendChild(mkSectionHead(heading));
                indices.forEach(idx => appendAusListRow(idx, dragSection));
            }
            if (sortedFav.length && sortedRest.length) {
                renderBlock(sortedFav, 'Favoriten', 'fav');
                ausSplit.list.appendChild(mkSectionDivider());
                renderBlock(sortedRest, 'Weitere Einträge', 'rest');
            } else if (sortedFav.length) {
                renderBlock(sortedFav, favVis < vis.length ? 'Favoriten' : null, 'fav');
            } else {
                renderBlock(sortedRest, null, 'rest');
            }
            if (selectedAusIndex === null || !vis.includes(selectedAusIndex)) {
                selectedAusIndex = vis[0];
            }
            fillAusEditor(selectedAusIndex);
            selectAusIndex(selectedAusIndex, false);
            updateTabBadges();
            refreshValidationUI();
        }

        function renderAusstattungClassic() {
            sanitizeExpandedAusstattungIndex();
            ausstattungContainer.innerHTML = '';
            const vis = getVisibleAusIndices();
            const { a, t } = countAusaktiv();
            const favVis = vis.filter(i => aktuelleAusstattungsKonfig[i].favorit === true).length;
            ausMetaStats.textContent = vis.length + ' sichtbar · ' + a + ' von ' + t + ' aktiv · ' + favVis + ' Favoriten';
            ausMetaHint.textContent = listOrderMetaHint('aus');
            if (aktuelleAusstattungsKonfig.length === 0) {
                ausstattungContainer.appendChild(mkEmptyState('Noch keine Einträge.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (vis.length === 0) {
                ausstattungContainer.appendChild(mkEmptyState('Keine Treffer für den aktuellen Filter.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }

            const colHeader = mkAusColumnSortHeader();
            if (columnSortLockedForAus()) colHeader.classList.add('mc-col-sort-header--disabled');
            ausstattungContainer.appendChild(colHeader);

            const { sortedFav, sortedRest } = getSortedAusVisibleIndices();
            colHeader._syncColSort();

            function renderAusBlock(indices, heading, dragSection) {
                if (!indices.length) return;
                if (heading) ausstattungContainer.appendChild(mkSectionHead(heading));
                indices.forEach(idx => appendAusstattungCard(idx, dragSection));
            }

            if (sortedFav.length && sortedRest.length) {
                renderAusBlock(sortedFav, 'Favoriten', 'fav');
                ausstattungContainer.appendChild(mkSectionDivider());
                renderAusBlock(sortedRest, 'Weitere Einträge', 'rest');
            } else if (sortedFav.length) {
                renderAusBlock(sortedFav, favVis < vis.length ? 'Favoriten' : null, 'fav');
            } else {
                renderAusBlock(sortedRest, null, 'rest');
            }
            updateTabBadges();
            refreshValidationUI();
        }

        function renderAusstattung() {
            ausstattungContainer.hidden = useConfigSplitView();
            ausSplit.root.hidden = !useConfigSplitView();
            syncPopupConfigLayoutClass();
            syncSplitToolbarVisibility();
            if (useConfigSplitView()) renderAusstattungSplit();
            else renderAusstattungClassic();
        }

        /** --- Tech --- */
        const techTb = buildListToolbar({
            searchPlaceholder: 'Suche (Begriff)…',
            onSearch: () => { renderTechData(); },
            bulk: { onAll: flag => bulkTechAlle(flag) },
            onNeu: () => {
                aktuelleTechKonfigurationen.push({ begriff: '', aktiv: true });
                selectedTechIndex = aktuelleTechKonfigurationen.length - 1;
                markDirty();
                renderTechData();
            }
        });
        const techToolbar = techTb.toolbar;
        const techSearch = techTb.search;
        const techMetaStats = techTb.metaStats;
        const techMetaHint = techTb.metaHint;
        const techSortDropdown = mkSortDropdown(techSort, [
            { key: 'begriff', dir: 'asc', label: 'Begriff A–Z' },
            { key: 'begriff', dir: 'desc', label: 'Begriff Z–A' },
            { key: 'aktiv', dir: 'desc', label: 'Aktiv zuerst' }
        ], false, () => renderTechData());
        const techMetaRow = techToolbar.querySelector('.mc-toolbar__row--meta');
        if (techMetaRow) techMetaRow.insertBefore(techSortDropdown, techMetaRow.firstChild);
        footerResetHandlers[1] = async () => {
            const ok = await confirmAsync('Tech-Konfiguration auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'tech', data: snapshotTech() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_techconfig', aktuelleTechKonfigurationen);
            aktuelleTechKonfigurationen = JSON.parse(JSON.stringify(techDataKonfigurationenDefault));
            markDirty();
            renderTechData();
            showToast('Tech-Daten auf Standard zurückgesetzt', 'success');
        };

        const techContainer = document.createElement('div');
        techContainer.className = 'mc-tech-list-scroll mc-config-classic-root';
        const techSplitShell = mkConfigSplitShell('tech');
        techSplitShell.root.hidden = true;
        const techSplit = techSplitShell;
        panelTech.appendChild(techToolbar);
        panelTech.appendChild(techContainer);
        panelTech.appendChild(techSplit.root);
        installKonfigTabHelp('tech', 'mc-konfig-help-tech', 'Hilfe zum Tab Tech-Daten', 'Hilfe zu Tech-Daten', techTb.searchRow, null, panelTech, techContainer);

        function techCompareValue(item, idx, key) {
            switch (key) {
                case 'begriff': return (item.begriff || '').trim();
                case 'aktiv': return item.aktiv === true;
                case 'config':
                default: return idx;
            }
        }

        function mkTechColumnSortHeader() {
            return mkColumnSortHeader('mc-col-sort-header--tech', [
                { spacer: 'mc-col-sort-inert' },
                { key: 'aktiv', label: 'Aktiv' },
                { key: 'begriff', label: 'Begriff', left: true },
                { spacer: 'mc-col-sort-spacer--del' }
            ], () => techSort, s => { techSort = s; }, () => { renderTechData(); }, 'mc-tech-grid');
        }

        function techSichtbar(item) {
            const f = techSearch._input.value.trim().toLowerCase();
            if (!f) return true;
            return String(item.begriff || '').toLowerCase().includes(f);
        }

        function getVisibleTechIndices() {
            const ix = [];
            aktuelleTechKonfigurationen.forEach((item, idx) => {
                if (techSichtbar(item)) ix.push(idx);
            });
            return ix;
        }

        function bulkTechAlle(flag) {
            pushUndo({ kind: 'tech', data: snapshotTech() });
            aktuelleTechKonfigurationen.forEach(i => { i.aktiv = flag; });
            markDirty();
            renderTechData();
            showToast('Alle Tech-Zeilen ' + (flag ? 'aktiviert' : 'deaktiviert'), 'success');
        }

        function cardIssuesTech(item) {
            const errs = [];
            if (!String(item.begriff || '').trim()) errs.push('Begriff fehlt');
            return errs;
        }

        function sanitizeSelectedTechIndex() {
            if (selectedTechIndex === null) return;
            if (selectedTechIndex < 0 || selectedTechIndex >= aktuelleTechKonfigurationen.length) {
                selectedTechIndex = null;
            }
        }

        function selectTechIndex(idx, openSheet) {
            selectedTechIndex = idx;
            if (useConfigSplitView()) {
                fillTechEditor(idx);
                if (openSheet !== false) techSplit.openEditorSheet();
                techSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                    el.classList.toggle('mc-config-split__list-item--selected', parseInt(el.dataset.techIndex, 10) === idx);
                });
            }
        }

        function fillTechEditor(idx) {
            const editor = techSplit.editor;
            editor.innerHTML = '';
            if (idx === null || !aktuelleTechKonfigurationen[idx]) {
                fillEditorPlaceholder(editor);
                return;
            }
            const item = aktuelleTechKonfigurationen[idx];
            const title = document.createElement('div');
            title.className = 'mc-config-split__editor-title';
            title.textContent = (item.begriff || '').trim() || 'Neuer Tech-Eintrag';
            editor.appendChild(title);
            const fields = document.createElement('div');
            fields.className = 'mc-config-split__editor-fields';
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'mc-input';
            inp.value = item.begriff || '';
            inp.placeholder = 'z. B. Fahrzeugzustand';
            inp.addEventListener('input', () => {
                item.begriff = inp.value;
                title.textContent = (item.begriff || '').trim() || 'Neuer Tech-Eintrag';
                markDirty();
                refreshValidationUI();
                renderTechSplitListOnly();
            });
            fields.appendChild(mkConfigSplitEditorField('Begriff (exakt wie mobile.de dt-Label)', inp));
            editor.appendChild(fields);

            const footer = mkConfigSplitEditorFooter();
            footer.appendChild(mkConfigSplitOptionsField([{
                checked: item.aktiv === true,
                title: 'Aktiv',
                hint: 'Feld in Suche und Ergebnisanzeige ein- oder ausblenden',
                onChange: v => {
                    item.aktiv = v;
                    markDirty();
                    renderTechSplitListOnly();
                }
            }]));

            const actions = mkConfigSplitEditorActions();
            actions.appendChild(mkBtn('del', 'Löschen', async () => {
                const ok = await confirmAsync('Tech-Eintrag löschen?');
                if (!ok) return;
                pushUndo({ kind: 'tech', data: snapshotTech() });
                aktuelleTechKonfigurationen.splice(idx, 1);
                if (selectedTechIndex === idx) selectedTechIndex = null;
                else if (selectedTechIndex !== null && selectedTechIndex > idx) selectedTechIndex--;
                markDirty();
                renderTechData();
            }));
            footer.appendChild(actions);
            editor.appendChild(footer);
        }

        function appendTechListRow(index) {
            const item = aktuelleTechKonfigurationen[index];
            if (!item) return;
            const handle = mkDragHandle(techDragEnabled());
            const toggleEl = mkToggle(item.aktiv === true, v => {
                item.aktiv = v;
                markDirty();
                renderTechData();
                refreshValidationUI();
            });
            const tw = document.createElement('div');
            tw.className = 'mc-toggle-wrap';
            tw.appendChild(toggleEl);
            const errs = cardIssuesTech(item);
            const row = mkSplitListItem({
                index,
                selected: selectedTechIndex === index,
                inactive: !item.aktiv,
                handle,
                toggleWrap: tw,
                label: (item.begriff || '').trim() || '(ohne Begriff)',
                title: item.begriff || '',
                warn: errs.length ? errs.join(' · ') : null,
                onSelect: () => selectTechIndex(index, true)
            });
            row.dataset.techIndex = String(index);
            setupListDragReorder({
                container: techSplit.list,
                handle,
                card: row,
                indexAttr: 'data-tech-index',
                getFromIndex: () => parseInt(row.dataset.techIndex, 10),
                isEnabled: techDragEnabled,
                onDrop: (from, to) => {
                    if (from === to) return;
                    pushUndo({ kind: 'tech', data: snapshotTech() });
                    const moved = aktuelleTechKonfigurationen[from];
                    aktuelleTechKonfigurationen.splice(from, 1);
                    const insertAt = from < to ? to - 1 : to;
                    aktuelleTechKonfigurationen.splice(insertAt, 0, moved);
                    if (selectedTechIndex === from) selectedTechIndex = insertAt;
                    else if (selectedTechIndex !== null) {
                        if (from < selectedTechIndex && insertAt >= selectedTechIndex) selectedTechIndex--;
                        else if (from > selectedTechIndex && insertAt <= selectedTechIndex) selectedTechIndex++;
                    }
                    markDirty();
                    renderTechData();
                }
            });
            techSplit.list.appendChild(row);
        }

        function getSortedTechVisibleIndices() {
            const vis = getVisibleTechIndices();
            const techSortKey = columnSortLockedForTech() ? 'config' : techSort.key;
            return isPopupManualScope('tech')
                ? orderIndicesByArrayPosition(vis)
                : sortIndices(vis, aktuelleTechKonfigurationen, techSortKey, techSort.dir, techCompareValue);
        }

        function renderTechSplitListOnly() {
            if (!useConfigSplitView()) return;
            const sel = selectedTechIndex;
            techSplit.list.innerHTML = '';
            getSortedTechVisibleIndices().forEach(idx => appendTechListRow(idx));
            if (sel !== null) {
                techSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                    el.classList.toggle('mc-config-split__list-item--selected', parseInt(el.dataset.techIndex, 10) === sel);
                });
            }
        }

        function renderTechDataSplit() {
            sanitizeSelectedTechIndex();
            techSplit.list.innerHTML = '';
            const vis = getVisibleTechIndices();
            const total = aktuelleTechKonfigurationen.length;
            const act = aktuelleTechKonfigurationen.filter(t => t.aktiv).length;
            techMetaStats.textContent = vis.length + ' von ' + total + ' sichtbar · ' + act + ' aktiv';
            techMetaHint.textContent = listOrderMetaHint('tech');
            techSortDropdown.querySelector('select').disabled = columnSortLockedForTech();
            if (aktuelleTechKonfigurationen.length === 0) {
                techSplit.list.appendChild(mkEmptyState('Keine Tech-Parameter.'));
                fillEditorPlaceholder(techSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (!vis.length) {
                techSplit.list.appendChild(mkEmptyState('Keine Treffer.'));
                fillEditorPlaceholder(techSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            const sortedVis = getSortedTechVisibleIndices();
            sortedVis.forEach(index => appendTechListRow(index));
            if (selectedTechIndex === null || !vis.includes(selectedTechIndex)) {
                selectedTechIndex = vis[0];
            }
            fillTechEditor(selectedTechIndex);
            selectTechIndex(selectedTechIndex, false);
            updateTabBadges();
            refreshValidationUI();
        }

        function renderTechDataClassic() {
            techContainer.innerHTML = '';
            const vis = getVisibleTechIndices();
            const total = aktuelleTechKonfigurationen.length;
            const act = aktuelleTechKonfigurationen.filter(t => t.aktiv).length;
            const sortedVis = getSortedTechVisibleIndices();
            techMetaStats.textContent = vis.length + ' von ' + total + ' sichtbar · ' + act + ' aktiv';
            techMetaHint.textContent = listOrderMetaHint('tech');

            if (aktuelleTechKonfigurationen.length === 0) {
                techContainer.appendChild(mkEmptyState('Keine Tech-Parameter.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (!vis.length) {
                techContainer.appendChild(mkEmptyState('Keine Treffer.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }

            const techColHeader = mkTechColumnSortHeader();
            if (columnSortLockedForTech()) techColHeader.classList.add('mc-col-sort-header--disabled');
            techContainer.appendChild(techColHeader);
            techColHeader._syncColSort();

            sortedVis.forEach(index => {
                const item = aktuelleTechKonfigurationen[index];
                if (!item) return;
                const card = document.createElement('div');
                card.className = 'mc-card';
                card.dataset.techIndex = String(index);

                const te = cardIssuesTech(item);
                if (te.length) {
                    card.classList.add('mc-card--invalid');
                    const er = document.createElement('p');
                    er.className = 'mc-card__err';
                    er.textContent = te.join(' · ');
                    card.appendChild(er);
                }

                const row = document.createElement('div');
                row.className = 'mc-card__main-row mc-card__main-row--tech mc-tech-grid';
                const handle = mkDragHandle(techDragEnabled());

                const toggleEl = mkToggle(item.aktiv === true, v => {
                    item.aktiv = v;
                    markDirty();
                    renderTechData();
                    refreshValidationUI();
                });
                const tw = document.createElement('div');
                tw.className = 'mc-toggle-wrap';
                tw.appendChild(toggleEl);

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'mc-input';
                input.style.flex = '1';
                input.value = item.begriff || '';
                input.placeholder = 'z. B. Fahrzeugzustand';
                input.addEventListener('input', () => {
                    item.begriff = input.value;
                    markDirty();
                    refreshValidationUI();
                });

                row.appendChild(handle);
                row.appendChild(tw);

                const mid = document.createElement('div');
                mid.style.flex = '1';
                mid.style.minWidth = '0';
                mid.appendChild(input);
                row.appendChild(mid);

                const btnDel = mkBtn('ghost', 'Löschen', () => {
                    pushUndo({ kind: 'tech', data: snapshotTech() });
                    const ix = parseInt(card.dataset.techIndex, 10);
                    aktuelleTechKonfigurationen.splice(ix, 1);
                    markDirty();
                    renderTechData();
                });

                row.appendChild(btnDel);
                card.appendChild(row);

                setupListDragReorder({
                    container: techContainer,
                    handle,
                    card,
                    indexAttr: 'data-tech-index',
                    getFromIndex: () => parseInt(card.dataset.techIndex, 10),
                    isEnabled: techDragEnabled,
                    onDrop: (from, to) => {
                        if (from === to) return;
                        pushUndo({ kind: 'tech', data: snapshotTech() });
                        const moved = aktuelleTechKonfigurationen[from];
                        aktuelleTechKonfigurationen.splice(from, 1);
                        const insertAt = from < to ? to - 1 : to;
                        aktuelleTechKonfigurationen.splice(insertAt, 0, moved);
                        markDirty();
                        renderTechData();
                    }
                });

                techContainer.appendChild(card);
            });
            updateTabBadges();
            refreshValidationUI();
        }

        function renderTechData() {
            techContainer.hidden = useConfigSplitView();
            techSplit.root.hidden = !useConfigSplitView();
            if (useConfigSplitView()) renderTechDataSplit();
            else renderTechDataClassic();
        }

        /** --- Merge --- */
        const mergeTb = buildListToolbar({
            searchPlaceholder: 'Suche nach Basis…',
            onSearch: () => { renderMergeConfig(); },
            filters: [
                { label: 'nur aktive', title: 'Nur aktive Merge-Gruppen anzeigen' }
            ],
            bulk: { onAll: flag => bulkMergeAlle(flag) },
            onNeu: () => {
                aktuelleMergeGruppen.push({ basis: '', order: [], aktiv: true });
                selectedMergeIndex = aktuelleMergeGruppen.length - 1;
                markDirty();
                renderMergeConfig();
            }
        });
        const mergeToolbar = mergeTb.toolbar;
        const mergeSearch = mergeTb.search;
        const mergeMetaStats = mergeTb.metaStats;
        const mergeMetaHint = mergeTb.metaHint;
        const mergeOnlyCb = mergeTb.filterCbs[0];
        const mergeSortDropdown = mkSortDropdown(mergeSort, [
            { key: 'basis', dir: 'asc', label: 'Basis A–Z' },
            { key: 'basis', dir: 'desc', label: 'Basis Z–A' },
            { key: 'aktiv', dir: 'desc', label: 'Aktiv zuerst' },
            { key: 'orderCount', dir: 'desc', label: 'Meiste Modifier' }
        ], false, () => renderMergeConfig());
        const mergeMetaRow = mergeToolbar.querySelector('.mc-toolbar__row--meta');
        if (mergeMetaRow) mergeMetaRow.insertBefore(mergeSortDropdown, mergeMetaRow.firstChild);
        footerResetHandlers[2] = async () => {
            const ok = await confirmAsync('Merge-Gruppen auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'merge', data: snapshotMerge() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_mergeGruppen', aktuelleMergeGruppen);
            aktuelleMergeGruppen = JSON.parse(JSON.stringify(mergeGruppenConfigDefault));
            markDirty();
            renderMergeConfig();
            showToast('Merge-Gruppen auf Standard zurückgesetzt', 'success');
        };

        const mergeContainer = document.createElement('div');
        mergeContainer.className = 'mc-merge-list-scroll mc-config-classic-root';
        const mergeSplitShell = mkConfigSplitShell('merge');
        mergeSplitShell.root.hidden = true;
        const mergeSplit = mergeSplitShell;
        panelMerge.appendChild(mergeToolbar);
        panelMerge.appendChild(mergeContainer);
        panelMerge.appendChild(mergeSplit.root);
        installKonfigTabHelp('merge', 'mc-konfig-help-merge', 'Hilfe zum Tab Merge-Gruppen', 'Hilfe zu Merge-Gruppen', mergeTb.searchRow, null, panelMerge, mergeContainer);

        function mergeCompareValue(group, idx, key) {
            switch (key) {
                case 'basis': return (group.basis || '').trim();
                case 'aktiv': return group.aktiv !== false;
                case 'orderCount': return Array.isArray(group.order) ? group.order.length : 0;
                case 'config':
                default: return idx;
            }
        }

        function mkMergeColumnSortHeader() {
            return mkColumnSortHeader('mc-col-sort-header--merge', [
                { key: 'aktiv', label: 'Aktiv' },
                { key: 'basis', label: 'Basis', left: true },
                { key: 'orderCount', label: 'Modifier', title: 'Anzahl Modifizierer' },
                { spacer: 'mc-col-sort-spacer--del' }
            ], () => mergeSort, s => { mergeSort = s; }, () => { renderMergeConfig(); }, 'mc-merge-grid');
        }

        function mergeSichtbar(g) {
            if (mergeOnlyCb.checked && g.aktiv === false) return false;
            const f = mergeSearch._input.value.trim().toLowerCase();
            if (!f) return true;
            if ((g.basis || '').toLowerCase().includes(f)) return true;
            if ((g.order || []).some(o => String(o).toLowerCase().includes(f))) return true;
            return false;
        }

        function getVisibleMergeIndices() {
            const ix = [];
            aktuelleMergeGruppen.forEach((g, idx) => {
                if (mergeSichtbar(g)) ix.push(idx);
            });
            return ix;
        }

        function bulkMergeAlle(flag) {
            pushUndo({ kind: 'merge', data: snapshotMerge() });
            aktuelleMergeGruppen.forEach(g => { g.aktiv = flag; });
            markDirty();
            renderMergeConfig();
            showToast('Alle Merge-Gruppen ' + (flag ? 'aktiviert' : 'deaktiviert'), 'success');
        }

        function cardIssuesMerge(g) {
            const errs = [];
            if (!(g.basis || '').trim()) errs.push('Basis fehlt');
            if (!Array.isArray(g.order) || !g.order.length) errs.push('Reihenfolge leer');
            return errs;
        }

        function sanitizeSelectedMergeIndex() {
            if (selectedMergeIndex === null) return;
            if (selectedMergeIndex < 0 || selectedMergeIndex >= aktuelleMergeGruppen.length) {
                selectedMergeIndex = null;
            }
        }

        function selectMergeIndex(idx, openSheet) {
            selectedMergeIndex = idx;
            if (useConfigSplitView()) {
                fillMergeEditor(idx);
                if (openSheet !== false) mergeSplit.openEditorSheet();
                mergeSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                    el.classList.toggle('mc-config-split__list-item--selected', parseInt(el.dataset.mergeIndex, 10) === idx);
                });
            }
        }

        function fillMergeEditor(idx) {
            const editor = mergeSplit.editor;
            editor.innerHTML = '';
            if (idx === null || !aktuelleMergeGruppen[idx]) {
                fillEditorPlaceholder(editor);
                return;
            }
            const group = aktuelleMergeGruppen[idx];
            const title = document.createElement('div');
            title.className = 'mc-config-split__editor-title';
            title.textContent = (group.basis || '').trim() || 'Neue Merge-Gruppe';
            editor.appendChild(title);
            const fields = document.createElement('div');
            fields.className = 'mc-config-split__editor-fields';
            const inpB = document.createElement('input');
            inpB.type = 'text';
            inpB.className = 'mc-input';
            inpB.value = group.basis || '';
            inpB.placeholder = 'Basis, z. B. außenspiegel';
            inpB.addEventListener('input', () => {
                group.basis = inpB.value;
                title.textContent = (group.basis || '').trim() || 'Neue Merge-Gruppe';
                markDirty();
                refreshValidationUI();
                renderMergeSplitListOnly();
            });
            fields.appendChild(mkConfigSplitEditorField('Basis', inpB));
            if (!Array.isArray(group.order)) group.order = [];
            const chipO = mkChipInput(group.order, {
                onChange: arr => {
                    group.order = arr;
                    markDirty();
                    refreshValidationUI();
                    renderMergeSplitListOnly();
                }
            });
            fields.appendChild(mkConfigSplitEditorField('Modifier-Reihenfolge (Komma oder Enter)', chipO.wrap));
            editor.appendChild(fields);

            const footer = mkConfigSplitEditorFooter();
            footer.appendChild(mkConfigSplitOptionsField([{
                checked: group.aktiv !== false,
                title: 'Aktiv',
                hint: 'Gruppe beim Zusammenfassen auf der Fahrzeugseite ein- oder ausblenden',
                onChange: v => {
                    group.aktiv = v;
                    markDirty();
                    renderMergeSplitListOnly();
                }
            }]));

            const actions = mkConfigSplitEditorActions();
            actions.appendChild(mkBtn('del', 'Löschen', async () => {
                const ok = await confirmAsync('Merge-Gruppe löschen?');
                if (!ok) return;
                pushUndo({ kind: 'merge', data: snapshotMerge() });
                aktuelleMergeGruppen.splice(idx, 1);
                if (selectedMergeIndex === idx) selectedMergeIndex = null;
                else if (selectedMergeIndex !== null && selectedMergeIndex > idx) selectedMergeIndex--;
                markDirty();
                renderMergeConfig();
                showToast('Merge-Gruppe entfernt', 'success');
            }));
            footer.appendChild(actions);
            editor.appendChild(footer);
        }

        function appendMergeListRow(index) {
            const group = aktuelleMergeGruppen[index];
            if (!group) return;
            const toggleEl = mkToggle(group.aktiv !== false, v => {
                group.aktiv = v;
                markDirty();
                renderMergeConfig();
                refreshValidationUI();
            });
            const tw = document.createElement('div');
            tw.className = 'mc-toggle-wrap';
            tw.appendChild(toggleEl);
            const nMod = Array.isArray(group.order) ? group.order.length : 0;
            const badges = [nMod + ' Modifier'];
            const errs = cardIssuesMerge(group);
            const row = mkSplitListItem({
                index,
                selected: selectedMergeIndex === index,
                inactive: group.aktiv === false,
                toggleWrap: tw,
                label: (group.basis || '').trim() || '(ohne Basis)',
                title: group.basis || '',
                badges,
                warn: errs.length ? errs.join(' · ') : null,
                onSelect: () => selectMergeIndex(index, true)
            });
            row.dataset.mergeIndex = String(index);
            mergeSplit.list.appendChild(row);
        }

        function getSortedMergeVisibleIndices() {
            const vis = getVisibleMergeIndices();
            return sortIndices(vis, aktuelleMergeGruppen, mergeSort.key, mergeSort.dir, mergeCompareValue);
        }

        function renderMergeSplitListOnly() {
            if (!useConfigSplitView()) return;
            const sel = selectedMergeIndex;
            mergeSplit.list.innerHTML = '';
            getSortedMergeVisibleIndices().forEach(idx => appendMergeListRow(idx));
            if (sel !== null) {
                mergeSplit.list.querySelectorAll('.mc-config-split__list-item').forEach(el => {
                    el.classList.toggle('mc-config-split__list-item--selected', parseInt(el.dataset.mergeIndex, 10) === sel);
                });
            }
        }

        function mergeMetaHintText() {
            if (useConfigSplitView()) return 'Sortierung über Dropdown · Speichern nach Basis';
            return 'Spaltenköpfe sortieren die Anzeige · Speichern nach Basis';
        }

        function renderMergeConfigSplit() {
            sanitizeSelectedMergeIndex();
            mergeSplit.list.innerHTML = '';
            const vis = getVisibleMergeIndices();
            const total = aktuelleMergeGruppen.length;
            const act = aktuelleMergeGruppen.filter(g => g.aktiv !== false).length;
            mergeMetaStats.textContent = vis.length + ' von ' + total + ' sichtbar · ' + act + ' aktiv';
            mergeMetaHint.textContent = mergeMetaHintText();
            if (aktuelleMergeGruppen.length === 0) {
                mergeSplit.list.appendChild(mkEmptyState('Keine Merge-Gruppen.'));
                fillEditorPlaceholder(mergeSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (!vis.length) {
                mergeSplit.list.appendChild(mkEmptyState('Keine Treffer für den aktuellen Filter.'));
                fillEditorPlaceholder(mergeSplit.editor);
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            getSortedMergeVisibleIndices().forEach(index => appendMergeListRow(index));
            if (selectedMergeIndex === null || !vis.includes(selectedMergeIndex)) {
                selectedMergeIndex = vis[0];
            }
            fillMergeEditor(selectedMergeIndex);
            selectMergeIndex(selectedMergeIndex, false);
            updateTabBadges();
            refreshValidationUI();
        }

        function renderMergeConfigClassic() {
            mergeContainer.innerHTML = '';
            const vis = getVisibleMergeIndices();
            const total = aktuelleMergeGruppen.length;
            const act = aktuelleMergeGruppen.filter(g => g.aktiv !== false).length;
            const sortedVis = getSortedMergeVisibleIndices();
            mergeMetaStats.textContent = vis.length + ' von ' + total + ' sichtbar · ' + act + ' aktiv';
            mergeMetaHint.textContent = mergeMetaHintText();
            if (aktuelleMergeGruppen.length === 0) {
                mergeContainer.appendChild(mkEmptyState('Keine Merge-Gruppen.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }
            if (!vis.length) {
                mergeContainer.appendChild(mkEmptyState('Keine Treffer für den aktuellen Filter.'));
                updateTabBadges();
                refreshValidationUI();
                return;
            }

            const mergeColHeader = mkMergeColumnSortHeader();
            mergeContainer.appendChild(mergeColHeader);
            mergeColHeader._syncColSort();

            sortedVis.forEach(index => {
                const group = aktuelleMergeGruppen[index];
                if (!group) return;
                const card = document.createElement('div');
                card.className = 'mc-card' + (group.aktiv === false ? ' mc-card--inactive-merge' : '');

                const me = cardIssuesMerge(group);
                if (me.length) {
                    card.classList.add('mc-card--invalid');
                    const er = document.createElement('p');
                    er.className = 'mc-card__err';
                    er.textContent = me.join(' · ');
                    card.appendChild(er);
                }

                const rowTop = document.createElement('div');
                rowTop.className = 'mc-card__main-row mc-card__main-row--merge mc-merge-grid';

                const toggleEl = mkToggle(group.aktiv !== false, v => {
                    group.aktiv = v;
                    markDirty();
                    renderMergeConfig();
                    refreshValidationUI();
                });
                const tw = document.createElement('div');
                tw.className = 'mc-toggle-wrap';
                tw.appendChild(toggleEl);
                rowTop.appendChild(tw);

                const inputBasis = document.createElement('input');
                inputBasis.type = 'text';
                inputBasis.className = 'mc-input';
                inputBasis.value = group.basis || '';
                inputBasis.placeholder = 'Basis, z. B. außenspiegel';
                inputBasis.title = 'Gemeinsamer Anzeige-Präfix für zusammengefasste Treffer';
                inputBasis.addEventListener('input', () => {
                    group.basis = inputBasis.value;
                    markDirty();
                    refreshValidationUI();
                });

                const inputOrder = mkMergeModifierField(group, rowTop);

                rowTop.appendChild(inputBasis);
                rowTop.appendChild(inputOrder);

                const btnDel = mkBtn('ghost', 'Löschen', () => {
                    pushUndo({ kind: 'merge', data: snapshotMerge() });
                    aktuelleMergeGruppen.splice(index, 1);
                    markDirty();
                    renderMergeConfig();
                    showToast('Merge-Gruppe entfernt', 'success');
                });
                rowTop.appendChild(btnDel);
                card.appendChild(rowTop);
                mergeContainer.appendChild(card);
            });
            updateTabBadges();
            refreshValidationUI();
        }

        function renderMergeConfig() {
            mergeContainer.hidden = useConfigSplitView();
            mergeSplit.root.hidden = !useConfigSplitView();
            if (useConfigSplitView()) renderMergeConfigSplit();
            else renderMergeConfigClassic();
        }

        /** --- Import / Export --- */
        const iePanel = document.createElement('div');
        iePanel.className = 'mc-ie-panel';
        const ieHeader = document.createElement('div');
        ieHeader.className = 'mc-ie-header';
        const ieIntro = document.createElement('p');
        ieIntro.className = 'mc-ie-intro';
        ieIntro.innerHTML = '<strong>Backup &amp; Teilen:</strong> Konfiguration als JSON exportieren oder einspielen. '
            + 'Vor dem Import wird automatisch ein Backup angelegt — per <strong>Rückgängig</strong> im Footer wiederherstellbar. '
            + 'Schema <strong>v' + SCHEMA_VERSION + '</strong>.';
        ieHeader.appendChild(ieIntro);
        const ieGrid = document.createElement('div');
        ieGrid.className = 'mc-ie-grid';

        const cardEx = document.createElement('div');
        cardEx.className = 'mc-ie-card mc-ie-card--export';
        const exHead = document.createElement('div');
        exHead.className = 'mc-ie-card__head';
        const exTitle = document.createElement('div');
        exTitle.className = 'mc-ie-card__title';
        exTitle.textContent = 'Export';
        const exDesc = document.createElement('div');
        exDesc.className = 'mc-ie-card__desc';
        exDesc.textContent = 'Aktuelle Konfiguration als JSON — kopieren oder als Datei speichern.';
        exHead.appendChild(exTitle);
        exHead.appendChild(exDesc);
        const exActions = document.createElement('div');
        exActions.className = 'mc-ie-actions';
        const exBtnGroup = document.createElement('div');
        exBtnGroup.className = 'mc-btn-group';
        const exportArea = document.createElement('textarea');
        exportArea.className = 'mc-textarea mc-ie-code';
        exportArea.readOnly = true;
        exportArea.rows = 12;
        exportArea.setAttribute('aria-label', 'Export JSON');
        const exMeta = document.createElement('div');
        exMeta.className = 'mc-ie-meta';
        exMeta.textContent = 'Dateiname: mobilede-config-YYYY-MM-DD.json';

        function buildExportPayload() {
            return {
                __version: SCHEMA_VERSION,
                suchKonfigurationen: aktuelleAusstattungsKonfig,
                techDataKonfigurationen: aktuelleTechKonfigurationen,
                mergeGruppenConfig: aktuelleMergeGruppen,
                featureFlags: aktuelleFeatureFlags
            };
        }

        function refreshExportArea() {
            exportArea.value = JSON.stringify(buildExportPayload(), null, 2);
        }

        const btnGenerateExport = mkBtn('ghost', 'Aktualisieren', () => {
            refreshExportArea();
            showToast('Export-Vorschau aktualisiert', 'success');
        });
        const btnCopyExport = mkBtn('ghost', 'Kopieren', async () => {
            refreshExportArea();
            const text = exportArea.value || '';
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
                else { exportArea.select(); document.execCommand('copy'); }
                showToast('In Zwischenablage kopiert', 'success');
            } catch (_e) {
                exportArea.select();
                try { document.execCommand('copy'); showToast('Kopiert (Fallback)', 'success'); }
                catch (_e2) { showToast('Konnte nicht kopieren', 'error'); }
            }
        });
        const btnDownloadExport = mkBtn('primary', 'Download', () => {
            refreshExportArea();
            const blob = new Blob([exportArea.value], { type: 'application/json' });
            const a = document.createElement('a');
            const y = new Date();
            const dateStr = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
            a.download = 'mobilede-config-' + dateStr + '.json';
            a.href = URL.createObjectURL(blob);
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2500);
            showToast('Datei gestartet', 'success');
        });
        exBtnGroup.appendChild(btnGenerateExport);
        exBtnGroup.appendChild(btnCopyExport);
        exActions.appendChild(exBtnGroup);
        exActions.appendChild(btnDownloadExport);
        cardEx.appendChild(exHead);
        cardEx.appendChild(exActions);
        cardEx.appendChild(exportArea);
        cardEx.appendChild(exMeta);

        const cardIm = document.createElement('div');
        cardIm.className = 'mc-ie-card mc-ie-card--import';
        const imHead = document.createElement('div');
        imHead.className = 'mc-ie-card__head';
        const imTitle = document.createElement('div');
        imTitle.className = 'mc-ie-card__title';
        imTitle.textContent = 'Import';
        const imDesc = document.createElement('div');
        imDesc.className = 'mc-ie-card__desc';
        imDesc.textContent = 'JSON-Datei laden oder einfügen — ersetzt die Konfiguration im Popup (Speichern nicht vergessen).';
        imHead.appendChild(imTitle);
        imHead.appendChild(imDesc);
        const drop = document.createElement('div');
        drop.className = 'mc-dropzone';
        drop.setAttribute('role', 'button');
        drop.setAttribute('tabindex', '0');
        const dropIcon = document.createElement('span');
        dropIcon.className = 'mc-dropzone__icon';
        dropIcon.setAttribute('aria-hidden', 'true');
        dropIcon.textContent = '⬆';
        const dropMain = document.createElement('span');
        dropMain.className = 'mc-dropzone__main';
        dropMain.textContent = 'JSON-Datei hierher ziehen';
        const dropSub = document.createElement('span');
        dropSub.className = 'mc-dropzone__sub';
        dropSub.textContent = 'oder klicken zum Auswählen';
        drop.appendChild(dropIcon);
        drop.appendChild(dropMain);
        drop.appendChild(dropSub);
        drop.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInp.click(); }
        });
        const fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.accept = 'application/json,.json';
        fileInp.style.display = 'none';
        drop.addEventListener('click', () => fileInp.click());
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('mc-dropzone--hover'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('mc-dropzone--hover'));
        drop.addEventListener('drop', e => {
            e.preventDefault();
            drop.classList.remove('mc-dropzone--hover');
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
                importArea.value = String(r.result || '');
                showToast('Datei eingeladen – bitte prüfen', 'success');
            };
            r.readAsText(file);
        });
        fileInp.addEventListener('change', () => {
            const file = fileInp.files && fileInp.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
                importArea.value = String(r.result || '');
                showToast('Datei eingeladen', 'success');
            };
            r.readAsText(file);
            fileInp.value = '';
        });

        const importArea = document.createElement('textarea');
        importArea.className = 'mc-textarea mc-ie-code';
        importArea.rows = 10;
        importArea.placeholder = 'JSON einfügen oder aus Datei laden…';
        importArea.setAttribute('aria-label', 'Import JSON');
        const imFooter = document.createElement('div');
        imFooter.className = 'mc-ie-import-footer';

        const btnImport = mkBtn('primary', 'Import durchführen', async () => {
            const text = importArea.value.trim();
            if (!text) {
                showToast('Import: Textfeld ist leer', 'warn');
                return;
            }
            try {
                JSON.parse(text);
            } catch (err) {
                showToast('Ungültiges JSON: ' + err, 'error');
                return;
            }
            const ok = await confirmAsync('Import ersetzt die geladenen Konfig-Daten im Popup (vorher automatisches Backup in GM-Speicher). Fortfahren?');
            if (!ok) return;
            try {
                const obj = JSON.parse(text);
                const ts = Date.now();
                pushUndo({ kind: 'all', aus: snapshotAus(), tech: snapshotTech(), merge: snapshotMerge() });
                speichereConfig(STORAGE_KEYS.backupPrefix + ts + '_config', aktuelleAusstattungsKonfig);
                speichereConfig(STORAGE_KEYS.backupPrefix + ts + '_techconfig', aktuelleTechKonfigurationen);
                speichereConfig(STORAGE_KEYS.backupPrefix + ts + '_mergeGruppen', aktuelleMergeGruppen);

                if (Array.isArray(obj.suchKonfigurationen)) aktuelleAusstattungsKonfig = obj.suchKonfigurationen;
                if (Array.isArray(obj.techDataKonfigurationen)) aktuelleTechKonfigurationen = obj.techDataKonfigurationen;
                if (Array.isArray(obj.mergeGruppenConfig)) aktuelleMergeGruppen = obj.mergeGruppenConfig;
                if (obj.featureFlags && typeof obj.featureFlags === 'object') {
                    aktuelleFeatureFlags = mergeConfigListUi(
                        obj.featureFlags,
                        { ...featureFlagsDefault(), ...obj.featureFlags }
                    );
                    aktuelleFeatureFlags.listOrder = mergeListOrder(aktuelleFeatureFlags.listOrder);
                    aktuelleFeatureFlags.srpSort = mergeSrpSort(aktuelleFeatureFlags.srpSort);
                }
                markDirty();
                onConfigListUiChanged();
                renderConfig();
                refreshExportArea();
                showToast('Import angewendet. Backup-Zeitstempel: ' + ts + '. Bitte Speichern klicken.', 'success');
            } catch (e2) {
                showToast('Fehler beim Import: ' + e2, 'error');
            }
        });

        imFooter.appendChild(btnImport);
        cardIm.appendChild(imHead);
        cardIm.appendChild(drop);
        cardIm.appendChild(fileInp);
        cardIm.appendChild(importArea);
        cardIm.appendChild(imFooter);

        ieGrid.appendChild(cardEx);
        ieGrid.appendChild(cardIm);
        iePanel.appendChild(ieHeader);
        iePanel.appendChild(ieGrid);
        panelIE.appendChild(iePanel);
        installKonfigTabHelp('ie', 'mc-konfig-help-ie', 'Hilfe zum Tab Import / Export', 'Hilfe zu Import und Export', ieHeader, null, iePanel, ieGrid);

        /** --- Config (Feature-Flags) --- */
        const configPanel = document.createElement('div');
        configPanel.className = 'mc-config-panel';
        const configHeader = document.createElement('div');
        configHeader.className = 'mc-config-header';
        const configIntro = document.createElement('p');
        configIntro.className = 'mc-config-intro';
        configIntro.innerHTML = '<strong>Skript-Einstellungen:</strong> Features, Listen-Reihenfolge und Suchergebnis-Sortierung. '
            + 'Änderungen gelten nach <strong>Speichern</strong> — teils sofort auf der geöffneten Fahrzeug- oder Suchergebnisseite.';
        configHeader.appendChild(configIntro);
        const configContainer = document.createElement('div');
        configContainer.className = 'mc-config-body';
        configPanel.appendChild(configHeader);
        configPanel.appendChild(configContainer);
        panelConfig.appendChild(configPanel);
        installKonfigTabHelp('config', 'mc-konfig-help-config', 'Hilfe zum Tab Config', 'Hilfe zu Config', configHeader, null, configPanel, configContainer);

        let configDebugUnlockClicks = 0;
        let configDebugUnlockTimer = null;
        let configDebugUiUnlocked = !!getDebugConfig(aktuelleFeatureFlags).enabled;
        configIntro.addEventListener('click', () => {
            configDebugUnlockClicks++;
            clearTimeout(configDebugUnlockTimer);
            configDebugUnlockTimer = setTimeout(() => { configDebugUnlockClicks = 0; }, 1500);
            if (configDebugUnlockClicks < 5) return;
            configDebugUnlockClicks = 0;
            configDebugUiUnlocked = true;
            const currentDebug = getDebugConfig(aktuelleFeatureFlags);
            const next = !currentDebug.enabled;
            aktuelleFeatureFlags.debug = { ...currentDebug, enabled: next };
            persistDebugMaster(next);
            renderConfig();
            showToast(
                next
                    ? 'Debug-Modus aktiv — Ausgaben in der Browser-Konsole (F12)'
                    : 'Debug-Modus deaktiviert',
                'success'
            );
            debugLog('ui', 'Debug-Mode über Hidden-Unlock umgeschaltet', { enabled: next });
        });
        footerResetHandlers[4] = async () => {
            const ok = await confirmAsync('Alle Feature-Flags auf Standard zurücksetzen?');
            if (!ok) return;
            aktuelleFeatureFlags = featureFlagsDefault();
            markDirty();
            onConfigListUiChanged();
            renderConfig();
            showToast('Feature-Flags zurückgesetzt', 'success');
        };

        function onListOrderChanged() {
            aktuelleFeatureFlags.listOrder = mergeListOrder(aktuelleFeatureFlags.listOrder);
            markDirty();
            updateTabBadges();
            renderAusstattung();
            renderTechData();
            renderConfig();
        }

        function renderConfig() {
            configContainer.innerHTML = '';
            aktuelleFeatureFlags.listOrder = mergeListOrder(aktuelleFeatureFlags.listOrder);
            aktuelleFeatureFlags.srpSort = mergeSrpSort(aktuelleFeatureFlags.srpSort);
            const lo = aktuelleFeatureFlags.listOrder;
            const srp = aktuelleFeatureFlags.srpSort;

            function listOrderHintText() {
                if (lo.mode !== 'manual') {
                    return 'Alphabetisch: Beim Speichern werden Ausstattung und Tech-Daten nach Anzeigetext sortiert.';
                }
                const parts = [];
                if (lo.scopes.ausstattungFavorites) parts.push('Favoriten');
                if (lo.scopes.ausstattung) parts.push('gesamte Ausstattungsliste');
                if (lo.scopes.tech) parts.push('Tech-Daten');
                if (!parts.length) {
                    return 'Manuell: Wähle mindestens einen Bereich — dann erscheint am Griff ⋮⋮ Drag-and-Drop.';
                }
                let msg = 'Manuell aktiv: Ziehen per ⋮⋮ in ' + parts.join(', ') + '.';
                if (lo.applyToVehicleResults) {
                    msg += ' Dieselbe Reihenfolge gilt auf der Fahrzeugdetailseite.';
                }
                return msg;
            }

            function appendFeaturesSection() {
                if (!FEATURE_FLAG_DEFINITIONS.length) return;
                const featSec = document.createElement('div');
                featSec.className = 'mc-config-section';
                const featSecTitle = document.createElement('div');
                featSecTitle.className = 'mc-config-section-title';
                featSecTitle.textContent = 'Features';
                featSec.appendChild(featSecTitle);
                const featList = document.createElement('div');
                featList.className = 'mc-config-features';

                FEATURE_FLAG_DEFINITIONS.forEach(def => {
                    const card = document.createElement('div');
                    card.className = 'mc-card mc-feature-card';

                    const row = document.createElement('div');
                    row.className = 'mc-card__main-row mc-card__main-row--feature';

                    const txtCol = document.createElement('div');
                    txtCol.className = 'mc-feature-text';
                    const title = document.createElement('div');
                    title.className = 'mc-feature-title';
                    title.textContent = def.title;
                    const desc = document.createElement('div');
                    desc.className = 'mc-feature-desc';
                    desc.textContent = def.description || '';
                    txtCol.appendChild(title);
                    if (def.description) txtCol.appendChild(desc);

                    const aside = document.createElement('div');
                    aside.className = 'mc-feature-aside';
                    const current = aktuelleFeatureFlags[def.key];
                    const statusLbl = document.createElement('span');
                    statusLbl.className = 'mc-feature-status' + ((current !== false) ? ' mc-feature-status--on' : '');
                    statusLbl.textContent = (current !== false) ? 'Aktiv' : 'Aus';
                    const toggleEl = mkToggle(current !== false, v => {
                        aktuelleFeatureFlags[def.key] = v;
                        markDirty();
                        statusLbl.textContent = v ? 'Aktiv' : 'Aus';
                        statusLbl.classList.toggle('mc-feature-status--on', v);
                        updateTabBadges();
                    });
                    aside.appendChild(statusLbl);
                    aside.appendChild(toggleEl);

                    row.appendChild(txtCol);
                    row.appendChild(aside);
                    card.appendChild(row);
                    featList.appendChild(card);
                });
                featSec.appendChild(featList);
                configContainer.appendChild(featSec);
            }

            appendFeaturesSection();

            function syncListOrderUi() {
                const manual = lo.mode === 'manual';
                const hasScope = manual &&
                    (lo.scopes.ausstattung || lo.scopes.ausstattungFavorites || lo.scopes.tech);
                loHint.textContent = listOrderHintText();
                loHint.classList.toggle('mc-lo-hint--active', manual && hasScope);
                modeBtns.forEach(({ val, btn }) => {
                    const on = lo.mode === val;
                    btn.classList.toggle('mc-lo-segment-btn--active', on);
                    btn.setAttribute('aria-checked', on ? 'true' : 'false');
                });
                scopeUi.forEach(({ key, wrap, cb }) => {
                    const on = !!lo.scopes[key];
                    wrap.classList.toggle('mc-lo-scope-item--on', manual && on);
                    wrap.classList.toggle('mc-lo-scope-item--disabled', !manual);
                    cb.disabled = !manual;
                    cb.checked = manual && on;
                });
                vehWrap.classList.toggle('mc-lo-veh--disabled', !hasScope);
                vehWrap.classList.toggle('mc-lo-veh--on', hasScope && !!lo.applyToVehicleResults);
                vehCb.disabled = !hasScope;
                vehCb.checked = hasScope && !!lo.applyToVehicleResults;
            }

            const uiListCard = document.createElement('div');
            uiListCard.className = 'mc-card mc-list-order-card';
            const uiHead = document.createElement('div');
            uiHead.className = 'mc-feature-title';
            uiHead.textContent = 'Listen-Layout';
            const uiDesc = document.createElement('div');
            uiDesc.className = 'mc-feature-desc';
            uiDesc.textContent = 'Gilt für die Tabs Ausstattung, Tech-Daten und Merge-Gruppen. Split-View: kompakte Liste links, Editor rechts (auf schmalen Screens als Sheet).';
            const uiMode = document.createElement('div');
            uiMode.className = 'mc-lo-segment';
            uiMode.setAttribute('role', 'radiogroup');
            uiMode.setAttribute('aria-label', 'Listen-Layout');
            const uiLayoutBtns = [];
            function syncUiLayoutBtns() {
                const cur = getConfigListUi(aktuelleFeatureFlags);
                uiLayoutBtns.forEach(({ val, btn }) => {
                    btn.classList.toggle('mc-lo-segment-btn--active', cur === val);
                    btn.setAttribute('aria-checked', cur === val ? 'true' : 'false');
                });
            }
            [['classic', 'Klassisch'], ['split', 'Split-View (neu)']].forEach(([val, lab]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mc-lo-segment-btn';
                btn.textContent = lab;
                btn.setAttribute('role', 'radio');
                btn.addEventListener('click', () => {
                    aktuelleFeatureFlags.configListUi = val;
                    syncUiLayoutBtns();
                    markDirty();
                    onConfigListUiChanged();
                });
                uiLayoutBtns.push({ val, btn });
                uiMode.appendChild(btn);
            });
            uiListCard.appendChild(uiHead);
            uiListCard.appendChild(uiDesc);
            uiListCard.appendChild(uiMode);
            syncUiLayoutBtns();

            const uiListSec = document.createElement('div');
            uiListSec.className = 'mc-config-section';
            const uiListSecTitle = document.createElement('div');
            uiListSecTitle.className = 'mc-config-section-title';
            uiListSecTitle.textContent = 'Konfig-Popup';
            uiListSec.appendChild(uiListSecTitle);
            uiListSec.appendChild(uiListCard);
            configContainer.appendChild(uiListSec);

            const loCard = document.createElement('div');
            loCard.className = 'mc-card mc-list-order-card';
            const loHead = document.createElement('div');
            loHead.className = 'mc-feature-title';
            loHead.textContent = 'Listen-Reihenfolge';
            const loDesc = document.createElement('div');
            loDesc.className = 'mc-feature-desc';
            loDesc.textContent = 'Steuert Sortierung beim Speichern und optional Drag-and-Drop im Konfig-Popup.';
            const loHint = document.createElement('div');
            loHint.className = 'mc-lo-hint';
            const loBody = document.createElement('div');
            loBody.className = 'mc-lo-body';

            const modeSec = document.createElement('div');
            modeSec.className = 'mc-lo-section';
            const modeTitle = document.createElement('div');
            modeTitle.className = 'mc-lo-section-title';
            modeTitle.textContent = 'Modus';
            const loMode = document.createElement('div');
            loMode.className = 'mc-lo-segment';
            loMode.setAttribute('role', 'radiogroup');
            loMode.setAttribute('aria-label', 'Sortiermodus');
            const modeBtns = [];
            [['alphabet', 'Alphabetisch'], ['manual', 'Manuell']].forEach(([val, lab]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mc-lo-segment-btn';
                btn.textContent = lab;
                btn.setAttribute('role', 'radio');
                btn.addEventListener('click', () => {
                    lo.mode = val;
                    syncListOrderUi();
                    onListOrderChanged();
                });
                modeBtns.push({ val, btn });
                loMode.appendChild(btn);
            });
            modeSec.appendChild(modeTitle);
            modeSec.appendChild(loMode);

            const scopeSec = document.createElement('div');
            scopeSec.className = 'mc-lo-section';
            const scopeTitle = document.createElement('div');
            scopeTitle.className = 'mc-lo-section-title';
            scopeTitle.textContent = 'Bereiche (nur bei Manuell)';
            const loScopeGrid = document.createElement('div');
            loScopeGrid.className = 'mc-lo-scope-grid';
            const scopeUi = [];
            [
                ['ausstattungFavorites', 'Favoriten', 'Nur Stern-Einträge im Ausstattungs-Tab'],
                ['ausstattung', 'Gesamte Ausstattungsliste', 'Alle Zeilen inkl. Favoriten & Rest'],
                ['tech', 'Tech-Daten', 'Reihenfolge im Tech-Daten-Tab']
            ].forEach(([key, lab, sub]) => {
                const wrap = document.createElement('label');
                wrap.className = 'mc-lo-scope-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.addEventListener('change', () => {
                    lo.scopes[key] = cb.checked;
                    syncListOrderUi();
                    onListOrderChanged();
                });
                const text = document.createElement('span');
                text.className = 'mc-lo-scope-text';
                const labEl = document.createElement('span');
                labEl.className = 'mc-lo-scope-label';
                labEl.textContent = lab;
                const subEl = document.createElement('span');
                subEl.className = 'mc-lo-scope-sub';
                subEl.textContent = sub;
                text.appendChild(labEl);
                text.appendChild(subEl);
                wrap.appendChild(cb);
                wrap.appendChild(text);
                loScopeGrid.appendChild(wrap);
                scopeUi.push({ key, wrap, cb });
            });
            scopeSec.appendChild(scopeTitle);
            scopeSec.appendChild(loScopeGrid);

            const vehSec = document.createElement('div');
            vehSec.className = 'mc-lo-section';
            const vehTitle = document.createElement('div');
            vehTitle.className = 'mc-lo-section-title';
            vehTitle.textContent = 'Fahrzeugdetailseite';
            const vehWrap = document.createElement('label');
            vehWrap.className = 'mc-lo-veh';
            const vehCb = document.createElement('input');
            vehCb.type = 'checkbox';
            vehCb.addEventListener('change', () => {
                lo.applyToVehicleResults = vehCb.checked;
                syncListOrderUi();
                onListOrderChanged();
            });
            const vehText = document.createElement('span');
            vehText.className = 'mc-lo-scope-text';
            const vehLab = document.createElement('span');
            vehLab.className = 'mc-lo-scope-label';
            vehLab.textContent = 'Reihenfolge übernehmen';
            const vehSub = document.createElement('span');
            vehSub.className = 'mc-lo-scope-sub';
            vehSub.textContent = 'Gefundene Begriffe / Tech-Daten in derselben Reihenfolge wie hier';
            vehText.appendChild(vehLab);
            vehText.appendChild(vehSub);
            vehWrap.appendChild(vehCb);
            vehWrap.appendChild(vehText);
            vehSec.appendChild(vehTitle);
            vehSec.appendChild(vehWrap);

            const loDivider = document.createElement('div');
            loDivider.className = 'mc-lo-divider';
            loBody.appendChild(modeSec);
            loBody.appendChild(scopeSec);
            loBody.appendChild(loDivider);
            loBody.appendChild(vehSec);
            loCard.appendChild(loHead);
            loCard.appendChild(loDesc);
            loCard.appendChild(loHint);
            loCard.appendChild(loBody);
            syncListOrderUi();

            const loSec = document.createElement('div');
            loSec.className = 'mc-config-section';
            const loSecTitle = document.createElement('div');
            loSecTitle.className = 'mc-config-section-title';
            loSecTitle.textContent = 'Listen & Sortierung';
            loSec.appendChild(loSecTitle);
            loSec.appendChild(loCard);
            configContainer.appendChild(loSec);

            const srpCard = document.createElement('div');
            srpCard.className = 'mc-card mc-list-order-card';
            const srpHead = document.createElement('div');
            srpHead.className = 'mc-feature-title';
            srpHead.textContent = 'Standard-Sortierung (Suchergebnisse)';
            const srpDesc = document.createElement('div');
            srpDesc.className = 'mc-feature-desc';
            srpDesc.textContent = 'Beim Öffnen einer Suche wird diese Sortierung gesetzt. Änderst du sie danach im Dropdown von mobile.de, bleibt deine Wahl bis zur nächsten Suche.';
            const srpBody = document.createElement('div');
            srpBody.className = 'mc-srp-body';

            const srpEnableRow = document.createElement('div');
            srpEnableRow.className = 'mc-card__main-row mc-card__main-row--feature';
            const srpEnableTxt = document.createElement('div');
            srpEnableTxt.className = 'mc-feature-text';
            const srpEnableLab = document.createElement('div');
            srpEnableLab.className = 'mc-feature-title';
            srpEnableLab.textContent = 'Auf Suchergebnisseiten anwenden';
            srpEnableTxt.appendChild(srpEnableLab);
            const srpEnableAside = document.createElement('div');
            srpEnableAside.className = 'mc-feature-aside';
            const srpEnableStatus = document.createElement('span');
            srpEnableStatus.className = 'mc-feature-status' + (srp.enabled ? ' mc-feature-status--on' : '');
            srpEnableStatus.textContent = srp.enabled ? 'Aktiv' : 'Aus';
            const srpEnableToggle = mkToggle(!!srp.enabled, v => {
                srp.enabled = v;
                aktuelleFeatureFlags.srpSort = srp;
                markDirty();
                srpEnableStatus.textContent = v ? 'Aktiv' : 'Aus';
                srpEnableStatus.classList.toggle('mc-feature-status--on', v);
                syncSrpSortUi();
                updateTabBadges();
            });
            srpEnableAside.appendChild(srpEnableStatus);
            srpEnableAside.appendChild(srpEnableToggle);
            srpEnableRow.appendChild(srpEnableTxt);
            srpEnableRow.appendChild(srpEnableAside);

            const srpSelectWrap = document.createElement('div');
            srpSelectWrap.className = 'mc-srp-select-wrap';
            const srpSelectLab = document.createElement('label');
            srpSelectLab.className = 'mc-lo-section-title';
            srpSelectLab.textContent = 'Sortierung';
            const srpSelect = document.createElement('select');
            srpSelect.className = 'mc-srp-select';
            srpSelect.setAttribute('aria-label', 'Standard-Sortierung Suchergebnisse');
            SRP_SORT_OPTIONS.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.id;
                o.textContent = opt.label;
                srpSelect.appendChild(o);
            });
            srpSelect.value = srp.sortId;
            srpSelect.addEventListener('change', () => {
                srp.sortId = srpSelect.value;
                aktuelleFeatureFlags.srpSort = srp;
                markDirty();
                updateTabBadges();
            });
            srpSelectLab.setAttribute('for', 'mc-srp-sort-select');
            srpSelect.id = 'mc-srp-sort-select';
            srpSelectWrap.appendChild(srpSelectLab);
            srpSelectWrap.appendChild(srpSelect);

            function syncSrpSortUi() {
                const on = !!srp.enabled;
                srpSelectWrap.classList.toggle('mc-srp-select-wrap--disabled', !on);
                srpSelect.disabled = !on;
            }
            syncSrpSortUi();

            srpBody.appendChild(srpEnableRow);
            srpBody.appendChild(srpSelectWrap);
            srpCard.appendChild(srpHead);
            srpCard.appendChild(srpDesc);
            srpCard.appendChild(srpBody);

            const srpSec = document.createElement('div');
            srpSec.className = 'mc-config-section';
            const srpSecTitle = document.createElement('div');
            srpSecTitle.className = 'mc-config-section-title';
            srpSecTitle.textContent = 'Suchergebnisse';
            srpSec.appendChild(srpSecTitle);
            srpSec.appendChild(srpCard);
            configContainer.appendChild(srpSec);

            const pr = mergePriceRating(aktuelleFeatureFlags.priceRating);
            aktuelleFeatureFlags.priceRating = pr;

            async function confirmPrImpact(message) {
                return confirmAsync(
                    '⚠ Starke Auswirkung auf die Preisbewertung\n\n' + message + '\n\nTrotzdem übernehmen?'
                );
            }

            async function confirmMasterPrToggle(enabling) {
                if (enabling) {
                    return confirmAsync(
                        'Preisbewertung aktivieren (Beta)\n\n'
                        + 'Die ausstattungsbereinigte Preisbewertung ist experimentell. Bewertungen und Schwellen '
                        + 'können sich mit Skript-Updates ändern. Geplant ist, die Funktion später dauerhaft '
                        + 'ohne Beta-Kennzeichnung anzubieten.\n\nJetzt aktivieren?'
                    );
                }
                return confirmAsync(
                    'Preisbewertung deaktivieren\n\n'
                    + 'Es werden keine Preis-Badges mehr auf Fahrzeugdetail- und Suchergebnisseiten angezeigt. '
                    + 'Deine Einstellungen bleiben gespeichert.\n\nJetzt deaktivieren?'
                );
            }

            const prCard = document.createElement('div');
            prCard.className = 'mc-card mc-list-order-card';
            const prTop = document.createElement('div');
            prTop.className = 'mc-pr-top';
            const prHeadLeft = document.createElement('div');
            prHeadLeft.className = 'mc-pr-head-left';
            const prHead = document.createElement('div');
            prHead.className = 'mc-feature-title';
            prHead.textContent = 'Preisbewertung (ausstattungsbereinigt)';
            const prBetaBadge = document.createElement('span');
            prBetaBadge.className = 'mc-pr-beta-badge';
            prBetaBadge.textContent = 'Beta';
            prBetaBadge.title = 'Experimentelle Funktion — kann sich noch ändern';
            prHeadLeft.appendChild(prHead);
            prHeadLeft.appendChild(prBetaBadge);
            const prMasterControl = document.createElement('div');
            prMasterControl.className = 'mc-pr-master-control';
            const prMasterLabel = document.createElement('div');
            prMasterLabel.className = 'mc-feature-title';
            prMasterLabel.textContent = 'Preisbewertung aktiv';
            const prMasterAside = document.createElement('div');
            prMasterAside.className = 'mc-feature-aside';
            const prMasterStatus = document.createElement('span');
            prMasterStatus.className = 'mc-feature-status' + (pr.enabled !== false ? ' mc-feature-status--on' : '');
            prMasterStatus.textContent = pr.enabled !== false ? 'Aktiv' : 'Aus';
            const prMasterToggle = mkToggle(pr.enabled !== false, async v => {
                const wasOn = pr.enabled !== false;
                if (v !== wasOn) {
                    const ok = await confirmMasterPrToggle(v);
                    if (!ok) {
                        prMasterToggle.querySelector('input').checked = wasOn;
                        return;
                    }
                }
                pr.enabled = v;
                syncPrFlags();
                prMasterStatus.textContent = v ? 'Aktiv' : 'Aus';
                prMasterStatus.classList.toggle('mc-feature-status--on', v);
                updatePrBodyState();
                updateTabBadges();
            });
            prMasterAside.appendChild(prMasterStatus);
            prMasterAside.appendChild(prMasterToggle);
            prMasterControl.appendChild(prMasterLabel);
            prMasterControl.appendChild(prMasterAside);
            const prBetaNotice = document.createElement('div');
            prBetaNotice.className = 'mc-pr-beta-notice';
            prBetaNotice.textContent = 'Experimentelle Funktion: Verhalten und Schwellen können sich noch ändern.';
            const prHeadBlock = document.createElement('div');
            prHeadBlock.className = 'mc-pr-head-block';
            prHeadBlock.appendChild(prHeadLeft);
            prHeadBlock.appendChild(prBetaNotice);
            prTop.appendChild(prHeadBlock);
            prTop.appendChild(prMasterControl);
            const prDesc = document.createElement('div');
            prDesc.className = 'mc-feature-desc';
            prDesc.textContent = 'Alle Einstellungen für die Preisbewertung an einem Ort. Ausstattungs-Gewichte gelten für erkannte Features (Liste, Titel, Beschreibung). '
                + 'Vergleichsfahrzeuge kommen von der Suchergebnisseite (ⓘ → Vergleichssuche). Geöffnete Inserate '
                + 'können zusätzlich Ausstattungs-Details/Beschreibung für präzisere Scores liefern. Cache gilt tabübergreifend (localStorage).';
            prCard.appendChild(prTop);
            prCard.appendChild(prDesc);
            const prBody = document.createElement('div');
            prBody.className = 'mc-srp-body';

            function syncPrFlags() {
                aktuelleFeatureFlags.priceRating = mergePriceRating(pr);
                markDirty();
            }

            function updatePrBodyState() {
                const on = pr.enabled !== false;
                prBody.classList.toggle('mc-pr-body--disabled', !on);
            }

            function mkPrToggleRow(label, getVal, setVal, impactMsg, confirmFn) {
                const row = document.createElement('div');
                row.className = 'mc-card__main-row mc-card__main-row--feature';
                const txt = document.createElement('div');
                txt.className = 'mc-feature-text';
                const t = document.createElement('div');
                t.className = 'mc-feature-title';
                t.textContent = label;
                txt.appendChild(t);
                const aside = document.createElement('div');
                aside.className = 'mc-feature-aside';
                const st = document.createElement('span');
                st.className = 'mc-feature-status' + (getVal() ? ' mc-feature-status--on' : '');
                st.textContent = getVal() ? 'Aktiv' : 'Aus';
                const tog = mkToggle(getVal(), async v => {
                    if (v !== getVal()) {
                        let ok = true;
                        if (confirmFn) {
                            ok = await confirmFn(v);
                        } else if (impactMsg) {
                            ok = await confirmPrImpact(impactMsg);
                        }
                        if (!ok) {
                            tog.querySelector('input').checked = getVal();
                            return;
                        }
                    }
                    setVal(v);
                    syncPrFlags();
                    st.textContent = v ? 'Aktiv' : 'Aus';
                    st.classList.toggle('mc-feature-status--on', v);
                    updateTabBadges();
                });
                aside.appendChild(st);
                aside.appendChild(tog);
                row.appendChild(txt);
                row.appendChild(aside);
                return row;
            }

            function mkPrNumberField(label, key, min, max, opts) {
                const field = document.createElement('div');
                field.className = 'mc-pr-field' + (opts && opts.impact ? ' mc-pr-field--impact' : '');
                const lb = document.createElement('div');
                lb.className = 'mc-label-sm';
                lb.textContent = label;
                const inp = document.createElement('input');
                inp.type = 'number';
                inp.className = 'mc-input mc-pr-weight-inp';
                inp.min = String(min);
                inp.max = String(max);
                if (opts && opts.step) inp.step = String(opts.step);
                const display = opts && opts.display ? opts.display : v => v;
                const parse = opts && opts.parse ? opts.parse : v => v;
                inp.value = String(display(pr[key]));
                inp.addEventListener('change', async () => {
                    const prev = pr[key];
                    const next = parse(inp.value);
                    if (next === prev || (Number.isNaN(next) && Number.isNaN(prev))) return;
                    if (opts && opts.impact) {
                        const ok = await confirmPrImpact(
                            opts.warn || (label + ': ' + display(prev) + ' → ' + display(next))
                        );
                        if (!ok) {
                            inp.value = String(display(prev));
                            return;
                        }
                    }
                    pr[key] = next;
                    syncPrFlags();
                });
                field.appendChild(lb);
                field.appendChild(inp);
                return field;
            }

            updatePrBodyState();
            prBody.appendChild(mkPrToggleRow('Auf Fahrzeugdetailseite', () => !!pr.enabledVip, v => { pr.enabledVip = v; }));
            prBody.appendChild(mkPrToggleRow('Badge in Suchergebnissen', () => !!pr.enabledSrp, v => { pr.enabledSrp = v; }));
            prBody.appendChild(mkPrToggleRow(
                'mobile.de als Fallback',
                () => !!pr.mobileFallback,
                v => { pr.mobileFallback = v; },
                'Ohne Fallback zeigt die Bewertung bei zu wenig Vergleichsfahrzeugen ggf. gar nichts an.'
            ));
            prBody.appendChild(mkPrToggleRow(
                'Baureihe in Vergleichssuche',
                () => pr.useModelRange !== false,
                v => { pr.useModelRange = v; },
                'Wenn aus: ignoriert Baureihe/Modelgruppe im Vergleich (hilfreich, wenn Baureihe oft fehlt).'
            ));
            prBody.appendChild(mkPrToggleRow(
                'Cache-Key: km berücksichtigen',
                () => pr.keyUseMileage !== false,
                v => { pr.keyUseMileage = v; },
                'Wenn aus: Kilometerstand wird beim Cache-Matching ignoriert.'
            ));
            prBody.appendChild(mkPrToggleRow(
                'Cache-Key: EZ berücksichtigen',
                () => pr.keyUseYear !== false,
                v => { pr.keyUseYear = v; },
                'Wenn aus: Erstzulassungsjahr wird beim Cache-Matching ignoriert.'
            ));
            prBody.appendChild(mkPrToggleRow(
                'Cache-Key: Leistung berücksichtigen',
                () => pr.keyUsePower !== false,
                v => { pr.keyUsePower = v; },
                'Wenn aus: Leistung (kW/PS) wird beim Cache-Matching ignoriert.'
            ));
            prBody.appendChild(mkPrToggleRow(
                'Nur Favoriten-Gewichte',
                () => !!pr.onlyFavoriteWeights,
                v => { pr.onlyFavoriteWeights = v; },
                'Nur Ausstattungen mit Stern zählen für die Preis-Korrektur — alle anderen Gewichte werden ignoriert.'
            ));

            const prGrid = document.createElement('div');
            prGrid.className = 'mc-pr-grid';
            prGrid.appendChild(mkPrNumberField('Min. Vergleichsfahrzeuge', 'minComparables', 5, 50, {
                impact: true,
                warn: 'Weniger Vergleiche = ungenauere, aber schnellere Bewertung. Mehr = stabiler, aber strenger Filter.'
            }));
            prGrid.appendChild(mkPrNumberField('€ pro Ausstattungspunkt', 'punktZuEuro', 100, 5000, {
                impact: true,
                warn: 'Direkter Multiplikator: 1 Punkt mehr Ausstattung ≈ so viele Euro höherer Erwartungspreis.'
            }));
            prGrid.appendChild(mkPrNumberField('Max. Ausstattungs-Korrektur (%)', 'maxAdjustPct', 5, 25, {
                impact: true,
                step: 1,
                display: v => Math.round(v * 100),
                parse: v => Math.max(0.05, Math.min(0.25, parseInt(v, 10) / 100 || pr.maxAdjustPct)),
                warn: 'Deckelt, wie stark die Ausstattung den erwarteten Preis nach oben/unten schieben darf.'
            }));
            prGrid.appendChild(mkPrNumberField('km-Toleranz Suche (± km)', 'kmToleranceAbs', 0, 200000, {
                impact: true,
                step: 500,
                parse: v => Math.max(0, Math.min(200000, parseInt(v, 10) || pr.kmToleranceAbs)),
                warn: 'Abweichung in Kilometer (±) für die Vergleichssuche.'
            }));
            prGrid.appendChild(mkPrNumberField('EZ-Toleranz (± Jahre)', 'yearTolerance', 0, 3, {
                impact: true,
                warn: 'Größere EZ-Spanne in der Vergleichssuche.'
            }));
            prGrid.appendChild(mkPrNumberField('Leistung-Toleranz (± kW)', 'powerToleranceKw', 0, 80, {
                impact: true,
                step: 1,
                parse: v => Math.max(0, Math.min(80, parseInt(v, 10) || pr.powerToleranceKw)),
                warn: 'Abweichung in kW (±) für die Vergleichssuche.'
            }));
            prGrid.appendChild(mkPrNumberField('Cache-Key km-Schritt', 'keyKmBucket', 500, 50000, {
                impact: true,
                step: 500,
                parse: v => Math.max(500, Math.min(50000, parseInt(v, 10) || pr.keyKmBucket)),
                warn: 'Rundet km im Cache-Key auf diesen Schritt (größer = tolerantere Cache-Treffer).'
            }));
            prGrid.appendChild(mkPrNumberField('Cache-Key EZ-Schritt (Jahre)', 'keyYearBucket', 1, 5, {
                impact: true,
                step: 1,
                parse: v => Math.max(1, Math.min(5, parseInt(v, 10) || pr.keyYearBucket)),
                warn: 'Rundet Erstzulassung im Cache-Key auf diesen Schritt.'
            }));
            prGrid.appendChild(mkPrNumberField('Cache-Key kW-Schritt', 'keyPowerBucket', 1, 50, {
                impact: true,
                step: 1,
                parse: v => Math.max(1, Math.min(50, parseInt(v, 10) || pr.keyPowerBucket)),
                warn: 'Rundet Leistung im Cache-Key auf diesen Schritt (größer = toleranter).'
            }));
            prBody.appendChild(prGrid);

            const thTitle = document.createElement('div');
            thTitle.className = 'mc-lo-section-title';
            thTitle.style.marginTop = '12px';
            thTitle.textContent = 'Preis-Stufen (Abweichung vom erwarteten Preis)';
            prBody.appendChild(thTitle);
            const thHint = document.createElement('div');
            thHint.className = 'mc-feature-desc';
            thHint.textContent = 'Grenzen in % unter/über dem ausstattungsbereinigten Erwartungspreis. „Hoher Preis“ gilt für alles darüber.';
            prBody.appendChild(thHint);
            const thWrap = document.createElement('div');
            thWrap.className = 'mc-pr-thresholds';
            pr.thresholds.slice(0, 4).forEach((th, i) => {
                const row = document.createElement('div');
                row.className = 'mc-pr-threshold-row';
                const lab = document.createElement('span');
                lab.textContent = PRICE_RATING_LEVELS[i].label + ' bis';
                const inp = document.createElement('input');
                inp.type = 'number';
                inp.className = 'mc-input';
                inp.step = '1';
                inp.value = String(Math.round(th.maxPct * 100));
                inp.addEventListener('change', async () => {
                    const prev = th.maxPct;
                    let next = parseInt(inp.value, 10) / 100;
                    if (Number.isNaN(next)) {
                        inp.value = String(Math.round(prev * 100));
                        return;
                    }
                    if (i === 0 && next > -0.02) next = -0.02;
                    if (i > 0 && next <= pr.thresholds[i - 1].maxPct) {
                        next = pr.thresholds[i - 1].maxPct + 0.01;
                    }
                    if (next === prev) return;
                    const ok = await confirmPrImpact(
                        'Schwelle „' + PRICE_RATING_LEVELS[i].label + '“: '
                        + Math.round(prev * 100) + '% → ' + Math.round(next * 100) + '%. '
                        + 'Verschiebt die gesamte 5-Stufen-Einteilung.'
                    );
                    if (!ok) {
                        inp.value = String(Math.round(prev * 100));
                        return;
                    }
                    pr.thresholds[i].maxPct = next;
                    syncPrFlags();
                });
                row.appendChild(lab);
                row.appendChild(inp);
                thWrap.appendChild(row);
            });
            const thHigh = document.createElement('div');
            thHigh.className = 'mc-pr-threshold-row';
            thHigh.style.opacity = '0.7';
            thHigh.textContent = PRICE_RATING_LEVELS[4].label + ': alles darüber';
            thWrap.appendChild(thHigh);
            prBody.appendChild(thWrap);

            const wtTitle = document.createElement('div');
            wtTitle.className = 'mc-lo-section-title';
            wtTitle.style.marginTop = '14px';
            wtTitle.textContent = 'Ausstattungs-Gewichte (Punkte)';
            prBody.appendChild(wtTitle);
            const wtHint = document.createElement('div');
            wtHint.className = 'mc-feature-desc';
            wtHint.textContent = '0 = Feature ignorieren. Höhere Werte = stärkerer Einfluss auf den erwarteten Preis.';
            prBody.appendChild(wtHint);

            const wtToolbar = document.createElement('div');
            wtToolbar.className = 'mc-pr-actions';
            const wtSearch = document.createElement('input');
            wtSearch.type = 'search';
            wtSearch.className = 'mc-input';
            wtSearch.placeholder = 'Ausstattung filtern…';
            wtSearch.style.flex = '1 1 160px';
            wtToolbar.appendChild(wtSearch);
            const wtOnlyWrap = document.createElement('label');
            wtOnlyWrap.className = 'mc-toolbar-toggle mc-toolbar-toggle--plain';
            wtOnlyWrap.title = 'Nur Einträge mit Gewicht > 0 anzeigen';
            const wtOnlyToggle = mkToggle(false, () => renderWeightRows());
            const wtOnlyCb = wtOnlyToggle.querySelector('input');
            const wtOnlyTxt = document.createElement('span');
            wtOnlyTxt.textContent = 'Nur mit Gewicht';
            wtOnlyWrap.appendChild(wtOnlyTxt);
            wtOnlyWrap.appendChild(wtOnlyToggle);
            wtToolbar.appendChild(wtOnlyWrap);
            prBody.appendChild(wtToolbar);

            const wtList = document.createElement('div');
            wtList.className = 'mc-pr-weights';
            prBody.appendChild(wtList);
            let wtVisibleLimit = 80;
            let wtFilteredIndices = [];
            let wtRenderRaf = 0;
            let wtSearchDebounce = 0;

            function renderWeightRows() {
                const t0 = pricePerfMarkStart();
                wtList.innerHTML = '';
                const q = wtSearch.value.trim().toLowerCase();
                const indices = [];
                aktuelleAusstattungsKonfig.forEach((item, idx) => {
                    const w = Number(item.preisGewicht) || 0;
                    if (wtOnlyCb.checked && w <= 0) return;
                    const name = (item.anzeige || '').toLowerCase();
                    if (q && !name.includes(q)) return;
                    indices.push(idx);
                });
                wtFilteredIndices = indices;
                if (!wtFilteredIndices.length) {
                    const empty = document.createElement('div');
                    empty.style.padding = '12px';
                    empty.style.opacity = '0.7';
                    empty.textContent = 'Keine Einträge für den Filter.';
                    wtList.appendChild(empty);
                    pricePerfMarkEnd('renderWeightRows', t0, 16);
                    return;
                }
                const capped = wtFilteredIndices.slice(0, wtVisibleLimit);
                capped.forEach(idx => {
                    const item = aktuelleAusstattungsKonfig[idx] || {};
                    const row = document.createElement('div');
                    row.className = 'mc-pr-weight-row' + (item.aktiv === false ? ' mc-pr-weight-row--inactive' : '');
                    row.dataset.weightIdx = String(idx);
                    const name = document.createElement('div');
                    name.className = 'mc-pr-weight-name';
                    name.textContent = (item.favorit ? '★ ' : '') + (item.anzeige || '—');
                    name.title = item.anzeige || '';
                    const inp = document.createElement('input');
                    inp.type = 'number';
                    inp.className = 'mc-input mc-pr-weight-inp';
                    inp.min = '0';
                    inp.max = '10';
                    inp.step = '0.1';
                    inp.value = String(Number(item.preisGewicht) || 0);
                    row.appendChild(name);
                    row.appendChild(inp);
                    wtList.appendChild(row);
                });
                if (wtFilteredIndices.length > capped.length) {
                    const more = document.createElement('button');
                    more.type = 'button';
                    more.className = 'mc-btn mc-btn--ghost';
                    more.style.marginTop = '8px';
                    more.textContent = 'Mehr laden (' + (wtFilteredIndices.length - capped.length) + ')';
                    more.addEventListener('click', () => {
                        wtVisibleLimit += 80;
                        renderWeightRows();
                    });
                    wtList.appendChild(more);
                }
                pricePerfMarkEnd('renderWeightRows', t0, 16);
            }
            wtList.addEventListener('change', async e => {
                const inp = e.target;
                if (!(inp instanceof HTMLInputElement) || !inp.classList.contains('mc-pr-weight-inp')) return;
                const row = inp.closest('.mc-pr-weight-row');
                const idx = row ? parseInt(row.dataset.weightIdx || '', 10) : NaN;
                if (!Number.isInteger(idx) || idx < 0) return;
                const item = aktuelleAusstattungsKonfig[idx];
                if (!item) return;
                const prev = Number(item.preisGewicht) || 0;
                let next = parseFloat(inp.value);
                if (Number.isNaN(next) || next < 0) next = 0;
                if (next === prev) return;
                const impactful = next >= 2.5 || prev >= 2.5 || (prev === 0 && next > 0) || Math.abs(next - prev) >= 1.5;
                if (impactful) {
                    const ok = await confirmPrImpact(
                        '„' + (item.anzeige || 'Eintrag') + '“: Gewicht '
                        + prev + ' → ' + next + ' Punkte.'
                    );
                    if (!ok) {
                        inp.value = String(prev);
                        return;
                    }
                }
                item.preisGewicht = next;
                markDirty();
            });
            wtSearch.addEventListener('input', () => {
                wtVisibleLimit = 80;
                clearTimeout(wtSearchDebounce);
                wtSearchDebounce = setTimeout(() => {
                    if (wtRenderRaf) cancelAnimationFrame(wtRenderRaf);
                    wtRenderRaf = requestAnimationFrame(renderWeightRows);
                }, 140);
            });
            renderWeightRows();

            const wtBulk = document.createElement('div');
            wtBulk.className = 'mc-pr-actions';
            wtBulk.appendChild(mkBtn('prem', 'Premium-Defaults setzen', async () => {
                const ok = await confirmPrImpact(
                    'Setzt für alle bekannten Premium-Ausstattungen (HUD, 360°, B&O, …) die Standard-Gewichte. '
                    + 'Bereits gesetzte Gewichte > 0 bleiben erhalten, außer es gibt einen Default-Eintrag.'
                );
                if (!ok) return;
                pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                aktuelleAusstattungsKonfig = applyPreisGewichtDefaults(aktuelleAusstattungsKonfig, false);
                markDirty();
                renderWeightRows();
                showToast('Premium-Gewichte übernommen', 'success');
            }));
            wtBulk.appendChild(mkBtn('clearw', 'Alle Gewichte auf 0', async () => {
                const ok = await confirmPrImpact(
                    'Alle Ausstattungs-Gewichte werden auf 0 gesetzt — die Preisbewertung ignoriert dann Ausstattungs-Unterschiede.'
                );
                if (!ok) return;
                pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                aktuelleAusstattungsKonfig = clearAllPreisGewichte(aktuelleAusstattungsKonfig);
                markDirty();
                renderWeightRows();
                showToast('Alle Gewichte zurückgesetzt', 'success');
            }));
            prBody.appendChild(wtBulk);

            prCard.appendChild(prBody);

            const prSec = document.createElement('div');
            prSec.className = 'mc-config-section';
            const prSecTitle = document.createElement('div');
            prSecTitle.className = 'mc-config-section-title';
            prSecTitle.textContent = 'Preisbewertung';
            prSec.appendChild(prSecTitle);
            prSec.appendChild(prCard);
            configContainer.appendChild(prSec);

            function appendPriceDebugSection() {
                const dbgCfg = getDebugConfig(aktuelleFeatureFlags);
                if (!dbgCfg.enabled && !configDebugUiUnlocked) return;
                const areAllScopesEnabled = (cfg) => {
                    const scopes = (cfg && cfg.scopes) || {};
                    return DEBUG_SCOPE_DEFINITIONS.every(def => scopes[def.key] === true);
                };
                const applyScopesFromPreset = (scopes, enabled) => {
                    const mergedScopes = {};
                    DEBUG_SCOPE_DEFINITIONS.forEach(def => {
                        mergedScopes[def.key] = scopes[def.key] === true;
                    });
                    const nextEnabled = enabled !== false && Object.values(mergedScopes).some(Boolean);
                    aktuelleFeatureFlags.debug = { enabled: nextEnabled, scopes: mergedScopes };
                    persistDebugConfig(aktuelleFeatureFlags.debug);
                    aktuelleFeatureFlags = ladeFeatureFlags();
                    renderConfig();
                };
                const dbgSec = document.createElement('div');
                dbgSec.className = 'mc-config-section';
                const dbgTitle = document.createElement('div');
                dbgTitle.className = 'mc-config-section-title';
                dbgTitle.textContent = 'Debug (Entwickler)';
                dbgSec.appendChild(dbgTitle);
                const dbgCard = document.createElement('div');
                dbgCard.className = 'mc-card mc-list-order-card';
                const dbgDesc = document.createElement('div');
                dbgDesc.className = 'mc-feature-desc';
                dbgDesc.textContent = 'Schreibt modulare Debug-Infos in die Browser-Konsole. '
                    + '5× auf den Einleitungstext oben klicken zum Ein-/Ausschalten.';
                dbgCard.appendChild(dbgDesc);
                const dbgRow = document.createElement('div');
                dbgRow.className = 'mc-pr-actions';
                dbgRow.style.marginTop = '10px';
                const dbgOff = mkBtn('dbg-off', 'Debug ausschalten', () => {
                    persistDebugMaster(false);
                    aktuelleFeatureFlags = ladeFeatureFlags();
                    renderConfig();
                    showToast('Debug-Modus deaktiviert', 'success');
                });
                const dbgAllOn = mkBtn('dbg-all-on', 'Alle Module an', () => {
                    const curr = getDebugConfig(aktuelleFeatureFlags);
                    const nextAllOn = !areAllScopesEnabled(curr);
                    const scopes = {};
                    DEBUG_SCOPE_DEFINITIONS.forEach(def => { scopes[def.key] = nextAllOn; });
                    applyScopesFromPreset(scopes, nextAllOn);
                    showToast(nextAllOn ? 'Alle Debug-Module aktiviert' : 'Alle Debug-Module deaktiviert', 'success');
                });
                const dbgLog = mkBtn('dbg-log', 'Kohorte jetzt loggen', () => {
                    runManualCohortLog();
                });
                const dbgSrpLog = mkBtn('dbg-srp-log', 'SRP-Status jetzt loggen', () => {
                    runManualSrpStatusLog();
                });
                const dbgSrpCard = mkBtn(
                    'dbg-srp-card',
                    'Debug-Log-Cards: ' + (dbgCfg.showSrpLogCard ? 'an' : 'aus'),
                    () => {
                        const now = getDebugConfig(aktuelleFeatureFlags);
                        persistDebugConfig({ ...now, showSrpLogCard: !now.showSrpLogCard });
                        aktuelleFeatureFlags = ladeFeatureFlags();
                        ensureSrpDebugLogCard();
                        renderConfig();
                        showToast('Debug-Log-Cards ' + (isSrpLogCardEnabled(aktuelleFeatureFlags) ? 'aktiviert' : 'deaktiviert'), 'success');
                    }
                );
                dbgAllOn.classList.toggle('mc-btn--toggle-active', areAllScopesEnabled(dbgCfg));
                dbgAllOn.setAttribute('aria-pressed', areAllScopesEnabled(dbgCfg) ? 'true' : 'false');
                dbgSrpCard.classList.toggle('mc-btn--toggle-active', dbgCfg.showSrpLogCard === true);
                dbgSrpCard.setAttribute('aria-pressed', dbgCfg.showSrpLogCard === true ? 'true' : 'false');
                dbgRow.appendChild(dbgOff);
                dbgRow.appendChild(dbgAllOn);
                dbgRow.appendChild(dbgLog);
                dbgRow.appendChild(dbgSrpLog);
                dbgRow.appendChild(dbgSrpCard);
                dbgCard.appendChild(dbgRow);

                const scopeList = document.createElement('div');
                scopeList.className = 'mc-pr-actions';
                scopeList.style.marginTop = '10px';
                DEBUG_SCOPE_DEFINITIONS.forEach(def => {
                    const scopeOn = getDebugConfig(aktuelleFeatureFlags).scopes[def.key] === true;
                    const btn = mkBtn(
                        'dbg-scope-' + def.key,
                        def.label + ': ' + (scopeOn ? 'an' : 'aus'),
                        () => {
                            const nowCfg = getDebugConfig(aktuelleFeatureFlags);
                            const next = !nowCfg.scopes[def.key];
                            persistDebugMaster(true);
                            persistDebugScope(def.key, next);
                            aktuelleFeatureFlags = ladeFeatureFlags();
                            renderConfig();
                            showToast((def.label + (next ? ' Debug aktiv' : ' Debug aus')), 'success');
                        }
                    );
                    btn.classList.toggle('mc-btn--toggle-active', scopeOn);
                    btn.setAttribute('aria-pressed', scopeOn ? 'true' : 'false');
                    scopeList.appendChild(btn);
                });
                dbgCard.appendChild(scopeList);
                dbgSec.appendChild(dbgCard);
                configContainer.appendChild(dbgSec);
            }
            appendPriceDebugSection();
        }

        /** Validation + footer status */
        let allIssues = [];

        function collectValidation() {
            const issues = [];
            aktuelleAusstattungsKonfig.forEach((item, idx) => {
                cardIssuesAus(idx, item).forEach(msg => issues.push('[Ausstattung #' + (idx + 1) + '] ' + msg));
            });
            aktuelleTechKonfigurationen.forEach((item, idx) => {
                cardIssuesTech(item).forEach(msg => issues.push('[Tech #' + (idx + 1) + '] ' + msg));
            });
            aktuelleMergeGruppen.forEach((g, idx) => {
                cardIssuesMerge(g).forEach(msg => issues.push('[Merge #' + (idx + 1) + '] ' + msg));
            });
            return issues;
        }

        function refreshValidationUI() {
            allIssues = collectValidation();
            if (allIssues.length === 0) {
                statusBtn.className = 'mc-status-btn mc-status-ok';
                statusBtn.textContent = '✔ Alles ok';
            } else {
                statusBtn.className = 'mc-status-btn mc-status-warn';
                statusBtn.textContent = '⚠ ' + allIssues.length + ' Hinweis' + (allIssues.length !== 1 ? 'e' : '');
            }
        }

        let issuePopoverOpen = false;
        statusBtn.addEventListener('click', () => {
            issuePopoverOpen = !issuePopoverOpen;
            if (!issuePopoverOpen || allIssues.length === 0) {
                issuePop.classList.remove('mc-issue-pop--open');
                issuePop.innerHTML = '';
                return;
            }
            issuePop.innerHTML = '<strong>Validierung</strong><ul>'
                + allIssues.slice(0, 40).map(t => '<li>' + t.replace(/</g, '&lt;') + '</li>').join('')
                + (allIssues.length > 40 ? '<li>…</li>' : '')
                + '</ul>';
            issuePop.classList.add('mc-issue-pop--open');
        });

        popup.addEventListener('click', e => {
            if (!issuePop.contains(e.target) && e.target !== statusBtn) {
                issuePop.classList.remove('mc-issue-pop--open');
            }
        });

        function updateTabBadges() {
            const { a, t } = countAusaktiv();
            if (tabButtons[0]) {
                tabButtons[0].labelSpan.textContent = 'Ausstattung';
                tabButtons[0].badge.textContent = '[' + a + ' / ' + t + ']';
            }
            const ta = aktuelleTechKonfigurationen.filter(i => i.aktiv).length;
            const tt = aktuelleTechKonfigurationen.length;
            if (tabButtons[1]) {
                tabButtons[1].labelSpan.textContent = 'Tech-Daten';
                tabButtons[1].badge.textContent = '[' + ta + ' / ' + tt + ']';
            }
            const ma = aktuelleMergeGruppen.filter(g => g.aktiv !== false).length;
            const tm = aktuelleMergeGruppen.length;
            if (tabButtons[2]) {
                tabButtons[2].labelSpan.textContent = 'Merge-Gruppen';
                tabButtons[2].badge.textContent = '[' + ma + ' / ' + tm + ']';
            }
            if (tabButtons[3]) {
                tabButtons[3].labelSpan.textContent = 'Import / Export';
                tabButtons[3].badge.textContent = '';
            }
            if (tabButtons[4]) {
                const cfg = countConfigTabSettings(aktuelleFeatureFlags);
                tabButtons[4].labelSpan.textContent = 'Config';
                tabButtons[4].badge.textContent = '[' + cfg.on + ' / ' + cfg.all + ']';
            }
        }

        /** Save */
        saveBtn.addEventListener('click', async () => {
            if (!dirty) return;
            const changes = collectPendingChanges();
            if (changes.length === 0) {
                dirty = false;
                syncSaveBtn();
                return;
            }
            const okChangelog = await confirmSaveWithChangelog(changes);
            if (!okChangelog) return;

            const issuesTxt = collectValidation();
            if (issuesTxt.length > 0) {
                const preview = issuesTxt.slice(0, 10).join('\n') + (issuesTxt.length > 10 ? '\n…und ' + (issuesTxt.length - 10) + ' weitere' : '');
                const okSave = await confirmAsync('Es gibt Hinweise:\n\n' + preview + '\n\nTrotzdem speichern?');
                if (!okSave) {
                    refreshValidationUI();
                    return;
                }
            }
            aktuelleFeatureFlags.listOrder = mergeListOrder(aktuelleFeatureFlags.listOrder);
            aktuelleFeatureFlags.srpSort = mergeSrpSort(aktuelleFeatureFlags.srpSort);
            aktuelleFeatureFlags.priceRating = mergePriceRating(aktuelleFeatureFlags.priceRating);
            applySaveOrdering(
                aktuelleAusstattungsKonfig,
                aktuelleTechKonfigurationen,
                aktuelleFeatureFlags.listOrder
            );
            aktuelleMergeGruppen.sort((x, y) => (x.basis || '').localeCompare(y.basis || ''));

            speichereConfig(STORAGE_KEYS.config, aktuelleAusstattungsKonfig);
            speichereConfig(STORAGE_KEYS.techConfig, aktuelleTechKonfigurationen);
            speichereConfig(STORAGE_KEYS.mergeGroups, aktuelleMergeGruppen);
            speichereConfig(STORAGE_KEYS.featureFlags, aktuelleFeatureFlags);
            speichereConfig(STORAGE_KEYS.version, SCHEMA_VERSION);

            suchKonfigurationen = aktuelleAusstattungsKonfig;
            techDataKonfigurationen = aktuelleTechKonfigurationen;
            mergeGruppenConfig = aktuelleMergeGruppen;
            featureFlags = aktuelleFeatureFlags;

            refreshSaveBaseline();
            dirty = false;
            undoStack.length = 0;
            syncUndoBtn();
            syncSaveBtn();
            saveBtn.disabled = true;
            saveBtn.textContent = '✔ Gespeichert';
            showToast('Konfiguration gespeichert — Popup bleibt offen.', 'success');
            if (isSearchResultsPage()) resetSrpSortOverrideAndApply();
            clearResults();
            clearPriceRatingUi();
            trigger();
            renderAusstattung();
            renderTechData();
            renderMergeConfig();
            renderConfig();
            updateTabBadges();
            refreshValidationUI();
            setTimeout(() => syncSaveBtn(), 1600);
        });

        refreshExportArea();
        renderAusstattung();
        renderTechData();
        renderMergeConfig();
        renderConfig();
        updateTabBadges();
        refreshValidationUI();
        syncUndoBtn();
        syncFooterReset(activeTabIndex);

        if (pendingAusstattungPrefill && pendingAusstattungPrefill.label) {
            const label = pendingAusstattungPrefill.label.trim();
            const cleaned = cleanText(label);
            const begriffe = [];
            if (cleaned) begriffe.push(cleaned);
            const rawNorm = label.toLowerCase().trim();
            if (rawNorm && rawNorm !== cleaned && !begriffe.includes(rawNorm)) {
                begriffe.push(rawNorm);
            }
            if (begriffe.length === 0) begriffe.push(rawNorm || label);
            aktuelleAusstattungsKonfig.unshift({
                begriffe,
                anzeige: label,
                farbe: '#66ff66',
                aktiv: true,
                favorit: false
            });
            expandedAusstattungIndex = useConfigSplitView() ? null : 0;
            selectedAusIndex = 0;
            pendingAusstattungPrefill = null;
            markDirty();
            setActiveTab(0);
            renderAusstattung();
            updateTabBadges();
            refreshValidationUI();
        }

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            popup.style.opacity = '1';
            tabButtons[0].btn.focus();
        });
    }

    // ============================================================
    // 12) Konfig-Button & Tampermonkey-Menü
    // ============================================================
    function erstelleKonfigButton() {
        if (document.querySelector('#mobilede-config-btn')) return;
        // Verwaiste Wrapper aus altem Render entfernen, damit kein doppelter
        // Wrapper ohne Button stehen bleibt (z.B. nach SPA-Re-Render).
        const orphanWrap = document.querySelector('#mobilede-config-btn-wrap');
        if (orphanWrap && !orphanWrap.querySelector('#mobilede-config-btn')) orphanWrap.remove();
        const targetDiv = document.querySelector('.Va7Gr')
            || document.querySelector("article[data-testid='vip-key-features-box']");
        if (!targetDiv) return;

        // Wrapper sorgt dafür, dass der Button in jedem Parent-Layout
        // (flex row/column, grid) als eigene Zeile in voller Breite sitzt.
        const wrap = document.createElement('div');
        wrap.id = 'mobilede-config-btn-wrap';
        Object.assign(wrap.style, {
            display: 'block',
            width: '100%',
            flex: '1 1 100%',
            flexBasis: '100%',
            gridColumn: '1 / -1',
            marginTop: '8px',
            boxSizing: 'border-box'
        });

        const button = document.createElement('button');
        button.id = 'mobilede-config-btn';
        button.type = 'button';
        button.setAttribute('aria-label', 'Ausstattungssuche konfigurieren');
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px;margin-right:6px"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg><span>Konfiguration</span>';
        Object.assign(button.style, {
            cursor: 'pointer',
            padding: '11px 14px',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '8px',
            background: 'linear-gradient(180deg,#3a3d46,#2e3138)',
            color: '#f0f1f3',
            fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 2px 8px rgba(0,0,0,.25)',
            transition: 'filter .15s, box-shadow .15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            boxSizing: 'border-box'
        });
        button.addEventListener('mouseenter', () => {
            button.style.filter = 'brightness(1.08)';
            button.style.boxShadow = '0 4px 14px rgba(0,0,0,.35)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.filter = '';
            button.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
        });
        button.addEventListener('click', oeffneKonfigPopup);
        wrap.appendChild(button);
        targetDiv.appendChild(wrap);
    }
    setTimeout(erstelleKonfigButton, 3000);

    if (typeof GM_registerMenuCommand === 'function') {
        try {
            GM_registerMenuCommand('Mobile.de Ausstattungssuche – Konfiguration', oeffneKonfigPopup);
        } catch (e) { /* ignore */ }
    }
})();
