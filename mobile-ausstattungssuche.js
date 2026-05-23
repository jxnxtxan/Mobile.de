// ==UserScript==
// @name         Mobile.de Ausstattungssuche mit modernem Popup & Import/Export (Generalisiertes Merging mit Merge-Konfiguration)
// @namespace    https://github.com/jxnxtxan/Mobile
// @version      2.7.5
// @author       jxnxtxan
// @description  Sucht bestimmte Ausstattungen & Technische Daten auf mobile.de. Token-basierte Match-Engine mit Wortgrenzen, Quellen-Gewichtung (Feature-Liste vs. Beschreibung), SPA-Robustheit, Konfig-Popup mit Filter, Drag&Drop, Reset, Backup und Schema-Versionierung.
// @homepageURL  https://github.com/jxnxtxan/Mobile
// @supportURL   https://github.com/jxnxtxan/Mobile/issues
// @updateURL    https://raw.githubusercontent.com/jxnxtxan/Mobile/main/mobile-ausstattungssuche.js
// @downloadURL  https://raw.githubusercontent.com/jxnxtxan/Mobile/main/mobile-ausstattungssuche.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mobile.de
// @match        http://suchen.mobile.de/fahrzeuge/details.html*
// @match        https://suchen.mobile.de/fahrzeuge/details.html*
// @match        http://suchen.mobile.de/auto-inserat/*
// @match        https://suchen.mobile.de/auto-inserat/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // Konstanten / Schema
    // ============================================================
    const SCHEMA_VERSION = 7;
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
        }
    ];
    function featureFlagsDefault() {
        const obj = {};
        FEATURE_FLAG_DEFINITIONS.forEach(d => { obj[d.key] = !!d.default; });
        return obj;
    }
    function ladeFeatureFlags() {
        const stored = ladeConfig(STORAGE_KEYS.featureFlags);
        const defaults = featureFlagsDefault();
        if (!stored || typeof stored !== 'object') return defaults;
        // Defaults für neu hinzugekommene Flags ergänzen, unbekannte Keys
        // bleiben erhalten (zukunftskompatibel).
        return { ...defaults, ...stored };
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
        { begriffe: ['anti blockiersystem', 'antiblocksicherung', 'abs brems'], anzeige: 'ABS', aktiv: true },
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
        { begriffe: ['aussen innen mit abblendautomat', 'aussen innenspiegel mit abblendautomatik', 'aeussen innen mit abblendautomatik'], anzeige: 'Außen-/Innenspiegel automatisch abblendend', aktiv: true },
        { begriffe: ['spiegel klappbar', 'elek spiegel klapp', 'außenspiegel anklappbar', 'außenspiegel klappbar'], anzeige: 'Außenspiegel anklappbar', aktiv: true },
        { begriffe: ['aussenspiegel mit abblendautomatik', 'aeussenspiegel mit abblendautomatik'], anzeige: 'Außenspiegel automatisch abblendend', aktiv: true },
        { begriffe: ['außenspiegel heizung', 'außenspiegel beheiz', 'außenspiegel heiz'], anzeige: 'Außenspiegel beheizbar', aktiv: true },
        { begriffe: ['außenspiegel elek verst', 'elek spiegel'], anzeige: 'Außenspiegel elektr. verstellbar', aktiv: true },
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
        { begriffe: ['elek wegfahrsperre', 'elektrisch wegfahrsper', 'wegfahrsperre elek'], anzeige: 'Elektr. Wegfahrsperre', aktiv: true },
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
        { begriffe: ['klima automatik', 'klimaautomatic', 'klima autom'], anzeige: 'Klimaautomatik', aktiv: true },
        { begriffe: ['lederlenkrad', 'leder lenkrad'], anzeige: 'Lederlenkrad', aktiv: false },
        { begriffe: ['lenkradheizung', 'beheizbares lenkrad', 'lenkrad heizung', 'lenkrad beheiz'], anzeige: 'Lenkradheizung', aktiv: true },
        { begriffe: ['lichtsensor'], anzeige: 'Lichtsensor', aktiv: true },
        { begriffe: ['matrix led', 'matrix scheinwerfer', 'matrix beam', 'matrix licht'], anzeige: 'Matrix Scheinwerfer', farbe: 'red', aktiv: true },
        { begriffe: ['multifunktionslenkrad', 'multifunktion lenkrad', 'multifunk lenkr'], anzeige: 'Multifunktionslenkrad', aktiv: true },
        { begriffe: ['nebelscheinwerfer', 'nebel scheinwerfer'], anzeige: 'Nebelscheinwerfer', aktiv: true },
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
        { begriffe: ['traction control', 'traktio kontr', 'antischlupf', 'antrieb schlupf', 'asr'], anzeige: 'Traktionskontrolle', aktiv: true },
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
            speichereConfig(STORAGE_KEYS.config, next);
        }

        // Merge-Gruppen: neue Order-Modifier additiv ergänzen
        const userMerge = ladeConfig(STORAGE_KEYS.mergeGroups);
        if (Array.isArray(userMerge)) {
            const next = migrateMergeGroups(userMerge, mergeGruppenConfigDefault);
            speichereConfig(STORAGE_KEYS.mergeGroups, next);
        }

        speichereConfig(STORAGE_KEYS.version, SCHEMA_VERSION);
    }
    migrateIfNeeded();

    let suchKonfigurationen     = ladeConfig(STORAGE_KEYS.config)      || suchKonfigurationenDefault;
    let techDataKonfigurationen = ladeConfig(STORAGE_KEYS.techConfig)  || techDataKonfigurationenDefault;
    let mergeGruppenConfig      = ladeConfig(STORAGE_KEYS.mergeGroups) || mergeGruppenConfigDefault;
    let featureFlags            = ladeFeatureFlags();

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
    // 7) Begriffs-Suche (ersetzt sucheBegriffe)
    // ============================================================
    function sucheBegriffe() {
        const sources = extractSources();
        if (sources.length === 0) return [];
        const gefundene = [];

        suchKonfigurationen.forEach(cfg => {
            if (!cfg.aktiv) return;
            if (!Array.isArray(cfg.begriffe) || cfg.begriffe.length === 0) return;

            const onlyHigh = cfg.nurInFeatures === true;
            const compound = cfg.compound === true;

            for (const src of sources) {
                if (onlyHigh && src.confidence !== 'high') continue;

                let matched = false;
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
                            console.debug('Verbotenes Token im Fenster für', cfg.anzeige, '→ skip');
                            continue;
                        }
                    }
                    const snippetTokens = src.tokens.slice(
                        Math.max(0, window.startIdx - 2),
                        Math.min(src.tokens.length, window.endIdx + 3)
                    );
                    gefundene.push({
                        anzeige: cfg.anzeige,
                        farbe: (cfg.farbe || '#66ff66').toLowerCase(),
                        source: src.id,
                        confidence: src.confidence,
                        snippet: snippetTokens.join(' '),
                        begriff
                    });
                    matched = true;
                    break;
                }
                if (matched) break;
            }
        });

        // Dedup: gleiche anzeige nur einmal, dabei beste confidence behalten
        const byAnzeige = new Map();
        for (const item of gefundene) {
            const existing = byAnzeige.get(item.anzeige);
            if (!existing) { byAnzeige.set(item.anzeige, item); continue; }
            const existingHigh = existing.confidence === 'high';
            const itemHigh = item.confidence === 'high';
            if (!existingHigh && itemHigh) byAnzeige.set(item.anzeige, item);
        }
        let unique = [...byAnzeige.values()];
        unique.sort((a, b) => a.anzeige.localeCompare(b.anzeige));

        // Substring-Dedup: kürzeren Eintrag entfernen, wenn ein längerer
        // Eintrag existiert, der ALLE Tokens des kürzeren als komplette
        // Tokens enthält (kein Prefix-Hack mehr).
        unique = subsetDedup(unique);

        // Generalisiertes Merging
        unique = generalizedMergeEntries(unique, mergeGruppenConfig);

        // Endgültige alphabetische Sortierung, Favoriten zuerst
        unique.sort((a, b) => a.anzeige.localeCompare(b.anzeige));
        unique = partitionEntriesByFavorites(unique, getFavoriteAnzeigeKeys(suchKonfigurationen));
        console.debug('Gefundene Begriffe:', unique.map(i => `${i.anzeige} [${i.source}]`));
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

    function generalizedMergeEntries(entries, gruppen) {
        if (!Array.isArray(gruppen) || gruppen.length === 0) return entries;
        let result = [...entries];
        gruppen.forEach(group => {
            if (!group || !group.basis || group.aktiv === false) return;
            const basis = group.basis.toLowerCase();
            const order = (group.order || []).map(item => item.toLowerCase());
            const matching = result.filter(e => e.anzeige.toLowerCase().includes(basis));
            if (matching.length <= 1) return;
            result = result.filter(e => !e.anzeige.toLowerCase().includes(basis));
            let modifiers = matching
                .map(e => e.anzeige.toLowerCase().replace(basis, '').trim())
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
                confidence: bestConf
            });
        });
        return result;
    }

    // ============================================================
    // 8) Suche nach Technischen Daten
    // ============================================================
    function sucheTechnischeDaten() {
        const techDataBereich = getTechDataDl();
        if (!techDataBereich) return [];
        const dtElements = techDataBereich.querySelectorAll('dt');
        const daten = [];
        techDataKonfigurationen.forEach(cfg => {
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
        if (technischeDaten.length === 0) return;
        const techArticle = document.createElement('article');
        techArticle.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-tech-article';
        techArticle.style.marginBottom = '10px';
        const techContainer = document.createElement('div');
        Object.assign(techContainer.style, {
            border: '1px solid #8a2be2',
            padding: '10px',
            backgroundColor: '#1e1f24',
            color: 'white',
            width: '100%',
            textAlign: 'left',
            boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
            fontSize: '14px',
            lineHeight: '1.5',
            display: 'block'
        });
        const title = document.createElement('div');
        title.textContent = 'Technische Daten:';
        title.style.color = 'white';
        title.style.marginBottom = '5px';
        techContainer.appendChild(title);
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        technischeDaten.forEach(d => {
            const tr = document.createElement('tr');
            const tdKey = document.createElement('td');
            tdKey.textContent = d.title + ':';
            Object.assign(tdKey.style, { color: 'white', paddingRight: '20px', whiteSpace: 'nowrap', verticalAlign: 'top' });
            const tdValue = document.createElement('td');
            tdValue.textContent = d.value;
            Object.assign(tdValue.style, { color: 'white', width: '100%', verticalAlign: 'top' });
            tr.appendChild(tdKey);
            tr.appendChild(tdValue);
            table.appendChild(tr);
        });
        techContainer.appendChild(table);
        techArticle.appendChild(techContainer);
        parentElement.parentNode.insertBefore(techArticle, parentElement);
    }

    // ============================================================
    // 9) Render: Ergebnis-Article einfügen
    // ============================================================
    function ergebnisHinzufuegen() {
        if (document.querySelector('#ergebnisBereich')) return;
        const zielBereich = document.querySelector("article[data-testid='vip-key-features-box']");
        if (!zielBereich) return;

        const gefundeneTexte = sucheBegriffe();

        const article = document.createElement('article');
        article.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-result-article';
        const ergebnisBereich = document.createElement('div');
        ergebnisBereich.id = 'ergebnisBereich';
        Object.assign(ergebnisBereich.style, {
            border: '1px solid #8a2be2',
            padding: '10px',
            marginTop: '10px',
            backgroundColor: '#1e1f24',
            color: 'white',
            width: '100%',
            textAlign: 'left',
            boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
            fontSize: '14px',
            lineHeight: '1.5',
            display: 'block'
        });
        article.appendChild(ergebnisBereich);

        const title = document.createElement('div');
        title.style.color = 'white';
        title.style.marginBottom = '5px';
        title.style.width = '100%';
        title.textContent = 'Gefundene Begriffe:';
        ergebnisBereich.appendChild(title);

        if (gefundeneTexte.length > 0) {
            const favKeys = getFavoriteAnzeigeKeys(suchKonfigurationen);
            const favCount = gefundeneTexte.filter(i =>
                favKeys.has((i.anzeige || '').trim().toLowerCase())).length;
            const columns = document.createElement('div');
            Object.assign(columns.style, {
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: '24px',
                rowGap: '2px',
                alignItems: 'start'
            });

            let placed = 0;
            gefundeneTexte.forEach((item, index) => {
                if (favCount > 0 && favCount < gefundeneTexte.length && index === favCount) {
                    const divider = document.createElement('div');
                    divider.setAttribute('aria-hidden', 'true');
                    Object.assign(divider.style, {
                        gridColumn: '1 / -1',
                        borderTop: '1px solid rgba(255,255,255,0.22)',
                        margin: '8px 0 6px',
                        height: '0'
                    });
                    columns.appendChild(divider);
                }
                const el = document.createElement('div');
                const isLow = item.confidence === 'low';
                el.style.minWidth = '0';
                el.style.gridColumn = (placed % 2 === 0) ? '1' : '2';
                const span = document.createElement('span');
                span.textContent = `- ${item.anzeige}${isLow ? ' *' : ''}`;
                span.style.color = item.farbe;
                span.style.cursor = 'help';
                span.style.overflowWrap = 'anywhere';
                span.style.display = 'inline-block';
                span.style.paddingLeft = '0.6em';
                span.style.textIndent = '-0.6em';
                const sourceLabel = isLow
                    ? `Nur in Beschreibung gefunden (Quelle: ${item.source})`
                    : `Quelle: ${item.source}`;
                const trigger = item.begriff ? `\nTrigger: "${item.begriff}"` : '';
                const snippet = item.snippet ? `\nKontext: …${item.snippet}…` : '';
                span.title = sourceLabel + trigger + snippet;
                if (isLow) {
                    span.style.fontStyle = 'italic';
                    span.style.opacity = '0.85';
                }
                el.appendChild(span);
                columns.appendChild(el);
                placed++;
            });
            ergebnisBereich.appendChild(columns);
            const hasLow = gefundeneTexte.some(i => i.confidence === 'low');
            if (hasLow) {
                const legend = document.createElement('div');
                legend.style.width = '100%';
                legend.style.fontSize = '11px';
                legend.style.opacity = '0.7';
                legend.style.marginTop = '6px';
                legend.textContent = '* = nur in Beschreibungstext gefunden (geringere Sicherheit)';
                ergebnisBereich.appendChild(legend);
            }
        } else {
            const keine = document.createElement('div');
            keine.textContent = 'Keine der gesuchten Begriffe gefunden.';
            keine.style.color = 'white';
            ergebnisBereich.appendChild(keine);
        }

        zielBereich.parentNode.insertBefore(article, zielBereich.nextSibling);
        technischeDatenHinzufuegen(article);
    }

    function clearResults() {
        document.querySelectorAll('.mobilede-result-article, .mobilede-tech-article').forEach(el => el.remove());
    }

    // ============================================================
    // 10) Lifecycle: Observer + SPA-Navigation
    // ============================================================
    let observer = null;
    let triggerTimer = null;
    function trigger() {
        clearTimeout(triggerTimer);
        triggerTimer = setTimeout(() => {
            try { ergebnisHinzufuegen(); } catch (e) { console.error(e); }
            try { verlinkeStandortAufGoogleMaps(); } catch (e) { console.error(e); }
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
        // und ergebnisHinzufuegen() bricht früh ab, wenn bereits eingefügt.
        // Bei SPA-Re-Renders (DOM ohne URL-Wechsel) wird so neu gerendert.
        observer = new MutationObserver(() => trigger());
        observer.observe(document.body, { childList: true, subtree: true });
    }

    let lastUrl = location.href;
    function onUrlChange() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        clearResults();
        startObserver();
        trigger();
        // Konfig-Button neu setzen, falls Parent re-rendered wurde
        setTimeout(() => {
            if (!document.querySelector('#mobilede-config-btn')) erstelleKonfigButton();
        }, 1500);
    }

    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);
    setInterval(onUrlChange, 1000);

    startObserver();
    trigger();

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
<li><strong>Spaltenköpfe</strong> über der Liste: Klick sortiert nach dieser Spalte (↑/↓). Nur Anzeige im Popup. <strong>Speichern</strong> sortiert alphabetisch nach Anzeigetext.</li>
<li><strong>Ziehen</strong> (⋮⋮) ändert die gespeicherte Konfig-Reihenfolge bis zum nächsten Speichern.</li>
<li><strong>Filter</strong> „nur aktive“ / „nur Favoriten“ und <strong>Bulk-Aktionen</strong> wirken auf sichtbare Einträge.</li>
</ul>`],
        ['tech', `
<h4>Was macht das?</h4>
<p>Hier wählst du, welche technischen Datenfelder (aus dem mobile.de-Tech-Daten-Block) zusätzlich im Ergebnis angezeigt werden, z.B. „Erstzulassung" oder „Fahrzeugzustand".</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong> zum Ein-/Ausblenden.</li>
<li><strong>Begriff</strong>: Muss exakt mit dem <code>&lt;dt&gt;</code>-Label aus dem mobile.de-Tech-Daten-Block übereinstimmen (Groß-/Kleinschreibung egal).</li>
<li><strong>Bulk-Aktionen</strong>, <strong>Suche</strong> und <strong>Spaltenköpfe</strong> zum Sortieren wie auf der Ausstattungs-Seite.</li>
<li><strong>Reihenfolge</strong> per Drag&amp;Drop ändert die Anzeigereihenfolge im Tech-Daten-Block.</li>
</ul>`],
        ['merge', `
<h4>Was macht das?</h4>
<p>Mehrere getrennt gefundene Einträge mit gleichem Basis-Wort werden zu <strong>einer</strong> Zeile zusammengefasst. Beispiel: „Außenspiegel beheizbar", „Außenspiegel anklappbar", „Außenspiegel elektr. verstellbar" → eine Zeile <strong>Außenspiegel beheizbar, anklappbar, elektr. verstellbar</strong>.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong>: Inaktive Gruppen werden beim Zusammenfassen auf der Fahrzeugseite ignoriert.</li>
<li><strong>Basis</strong>: Das gemeinsame Wort, nach dem gruppiert wird (z.B. <code>außenspiegel</code>). Klein- und Großschreibung egal.</li>
<li><strong>Reihenfolge</strong>: Komma-getrennte Liste der Modifizierer-Schlüsselwörter in der gewünschten Reihenfolge im zusammengefassten Eintrag (z.B. <code>elektr. verstellbar, beheizbar, anklappbar</code>). Treffer, die in keiner Reihenfolge auftauchen, kommen ans Ende.</li>
<li><strong>Spaltenköpfe</strong> zum Sortieren, <strong>Filter „nur aktive“</strong> und <strong>Bulk-Aktionen</strong> wie bei den anderen Tabs. Speichern sortiert alphabetisch nach Basis.</li>
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
<li>Beim Deaktivieren werden bereits aktive Manipulationen (z.B. die Maps-Verlinkung) auf der gerade geöffneten Detailseite optisch zurückgenommen.</li>
<li>Neue Features werden automatisch mit ihren Standardwerten ergänzt; bestehende Einstellungen bleiben erhalten.</li>
</ul>`]
    ]);

    // ============================================================
    // 11) Konfig-Popup
    // ============================================================
    function oeffneKonfigPopup() {
        const existingOverlay = document.querySelector('#mobilede-config-overlay');
        if (existingOverlay) {
            if (existingOverlay.querySelector('.mc-popup')) return;
            existingOverlay.remove();
        }

        let aktuelleAusstattungsKonfig = JSON.parse(JSON.stringify(suchKonfigurationen));
        let aktuelleTechKonfigurationen = JSON.parse(JSON.stringify(techDataKonfigurationen));
        let aktuelleMergeGruppen = JSON.parse(JSON.stringify(mergeGruppenConfig));
        let aktuelleFeatureFlags = { ...featureFlagsDefault(), ...(featureFlags || {}) };

        let dirty = false;
        let activeTabIndex = 0;
        let draggedAusstattungIndex = null;
        let draggedTechItemIndex = null;
        const undoStack = [];
        /** Max. eine Ausstattungs-Card mit geöffnetem Details-Panel — Array-Index in `aktuelleAusstattungsKonfig`. */
        let expandedAusstattungIndex = null;
        /** Hilfe-Panel je Tab (Ausstattung, Tech, Merge, Import/Export, Config) — vermeidet Zustandsverlust beim Tab-Wechsel. */
        const helpExpandedByTab = { aus: false, tech: false, merge: false, ie: false, config: false };
        const SCRIPT_UI_VERSION = '2.7.5';
        let ausSort = { key: 'config', dir: 'asc' };
        let techSort = { key: 'config', dir: 'asc' };
        let mergeSort = { key: 'config', dir: 'asc' };

        const prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function markDirty() { dirty = true; }

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
.mc-panel{display:none;flex-direction:column;min-height:0;gap:8px;height:100%;}
.mc-panel--active{display:flex;}
.mc-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:4px;padding:8px;
  background:rgba(0,0,0,.12);border:1px solid var(--mc-border);border-radius:10px;}
@media(max-width:699px){.mc-toolbar{flex-direction:column;align-items:stretch}}
.mc-toolbar-meta{font-size:11px;color:var(--mc-muted);width:100%;}
.mc-toolbar-help-slot{margin-left:auto;display:flex;align-items:center;flex-shrink:0;align-self:center;}
.mc-toolbar__row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;}
.mc-toolbar__row--top{}
.mc-toolbar__row--bottom{justify-content:space-between;}
.mc-toolbar__row--bottom > .mc-btn--danger{margin-left:auto;}
.mc-toolbar__row--config > .mc-btn--danger{margin-left:auto;}
.mc-toolbar__row--config .mc-toolbar-help-slot{margin-left:0;}
.mc-toolbar-toggle{display:inline-flex;align-items:center;gap:8px;padding:3px 14px 3px 5px;
  background:rgba(255,255,255,.04);border:1px solid var(--mc-border);border-radius:999px;
  font-size:13px;color:var(--mc-text);cursor:pointer;user-select:none;align-self:center;
  transition:background .15s ease,border-color .15s ease;}
.mc-toolbar-toggle:hover{background:rgba(255,255,255,.07);border-color:var(--mc-border-strong,#5a5d66);}
.mc-toolbar-toggle:has(input:checked){background:rgba(25,118,210,.18);border-color:#1976d2;}
.mc-toolbar-toggle > .mc-toggle{flex-shrink:0;}
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
  grid-template-columns:44px minmax(120px,1fr) 88px 76px;
  gap:8px;align-items:center;
}
.mc-col-sort-header.mc-aus-grid{min-width:720px;}
.mc-col-sort-header.mc-tech-grid{min-width:420px;}
.mc-col-sort-header.mc-merge-grid{min-width:520px;}
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
.mc-card__main-row--merge{
  display:grid;
  grid-template-columns:44px minmax(120px,1fr) 88px 76px;
  gap:8px;align-items:start;min-width:520px;
}
.mc-aus-list-scroll,.mc-tech-list-scroll,.mc-merge-list-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;}
.mc-card__main-row--merge > .mc-toggle-wrap{flex-shrink:0;padding-top:4px;}
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
.mc-card__main-row--feature{align-items:center;gap:14px;}
.mc-feature-card{padding:14px 16px;}
.mc-feature-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px;}
.mc-feature-title{font-weight:600;font-size:15px;line-height:1.25;}
.mc-feature-desc{font-size:12.5px;color:var(--mc-muted);line-height:1.45;}
.mc-feature-status{
  font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--mc-muted);
  padding:3px 8px;border-radius:999px;border:1px solid var(--mc-border);background:rgba(0,0,0,.18);
}
.mc-feature-status--on{color:#bfe5c5;border-color:#3e8e4a;background:rgba(76,175,80,.18);}
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
.mc-modal-actions{display:flex;justify-content:flex-end;gap:8px;}
.mc-row-ie{display:flex;gap:12px;flex-wrap:wrap;}
.mc-ie-card{flex:1;min-width:260px;border:1px solid var(--mc-border);border-radius:10px;padding:12px;background:rgba(0,0,0,.12);}
.mc-dropzone{
  border:2px dashed var(--mc-border);border-radius:10px;padding:18px;text-align:center;font-size:13px;color:var(--mc-muted);
  margin:8px 0;cursor:pointer;background:rgba(0,0,0,.12);
}
.mc-dropzone--hover{border-color:var(--mc-accent);color:var(--mc-text);}
.mc-empty{padding:22px;text-align:center;color:var(--mc-muted);font-size:14px;border:1px dashed var(--mc-border);border-radius:10px;}
`;
            document.head.appendChild(st);
        }
        injectStyles();

        function mkBtn(variant, label, onClick) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mc-btn' + (variant === 'primary' ? ' mc-btn--primary' : variant === 'ghost' ? ' mc-btn--ghost' : variant === 'danger' ? ' mc-btn--danger' : '');
            b.textContent = label;
            if (onClick) b.addEventListener('click', onClick);
            return b;
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
            return { wrap, closeBtn };
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

        function installKonfigTabHelp(tabKey, panelId, regionAriaLabel, btnLabel, toolbarEl, metaEl, panelColumn, beforeNode) {
            const html = KONFIG_TAB_HELP_HTML.get(tabKey);
            if (!html) return;
            const { wrap, closeBtn } = mkHelpPanel(html);
            wrap.id = panelId;
            wrap.setAttribute('aria-label', regionAriaLabel);
            const btn = mkHelpButton(btnLabel);
            btn.setAttribute('aria-controls', panelId);
            function applyHelpState() {
                const o = helpExpandedByTab[tabKey];
                btn.setAttribute('aria-expanded', o ? 'true' : 'false');
                wrap.classList.toggle('mc-help-panel--open', o);
            }
            btn.addEventListener('click', () => {
                helpExpandedByTab[tabKey] = !helpExpandedByTab[tabKey];
                applyHelpState();
            });
            closeBtn.addEventListener('click', () => {
                helpExpandedByTab[tabKey] = false;
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

        function mkColorInput(value, onChange) {
            const wrap = document.createElement('div');
            wrap.className = 'mc-color-row';
            const hex = normalizeHexColor(value);
            const colorInp = document.createElement('input');
            colorInp.type = 'color';
            colorInp.value = hex;
            colorInp.className = 'mc-input';
            const textInp = document.createElement('input');
            textInp.type = 'text';
            textInp.className = 'mc-input mc-color-hex-input';
            textInp.value = value || '';
            textInp.placeholder = '#66ff66';
            function applyFromText() {
                const h = normalizeHexColor(textInp.value);
                colorInp.value = h;
                onChange(textInp.value.trim());
            }
            function applyFromPicker() {
                textInp.value = colorInp.value;
                onChange(colorInp.value);
            }
            textInp.addEventListener('input', () => {
                const h = normalizeHexColor(textInp.value);
                colorInp.value = h;
                onChange(textInp.value.trim());
            });
            colorInp.addEventListener('input', applyFromPicker);
            wrap.appendChild(colorInp);
            wrap.appendChild(textInp);
            return wrap;
        }

        function mkDragHandle() {
            const h = document.createElement('div');
            h.className = 'mc-drag-handle';
            h.textContent = '⋮⋮';
            h.title = 'Ziehen zum Sortieren';
            return h;
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

        function escListener(e) {
            if (e.key === 'Escape') tryCloseFromUser();
        }
        document.addEventListener('keydown', escListener);

        function removeOverlay() {
            document.removeEventListener('keydown', escListener);
            document.body.style.overflow = prevBodyOverflow;
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
        }

        const popup = document.createElement('div');
        popup.className = 'mc-popup';
        popup.tabIndex = -1;

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
        ver.textContent = 'Skript v' + SCRIPT_UI_VERSION + ' · Schema ' + SCHEMA_VERSION;
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
        const cancelBtn = mkBtn('ghost', 'Abbrechen', () => removeOverlay());
        const saveBtn = mkBtn('primary', 'Speichern', null);

        footLeft.appendChild(statusBtn);
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
        const ausToolbar = document.createElement('div');
        ausToolbar.className = 'mc-toolbar';
        const ausMeta = document.createElement('div');
        ausMeta.className = 'mc-toolbar-meta';
        const ausSearch = mkSearchBox('Filter (Anzeigetext oder Begriff)…', () => { renderAusstattung(); });
        const onlyWrap = document.createElement('label');
        onlyWrap.className = 'mc-toolbar-toggle';
        onlyWrap.title = 'Nur aktive Einträge anzeigen';
        const onlyToggle = mkToggle(false, () => { renderAusstattung(); });
        const onlyCb = onlyToggle.querySelector('input');
        onlyWrap.appendChild(onlyToggle);
        const onlyTxt = document.createElement('span');
        onlyTxt.textContent = 'nur aktive';
        onlyWrap.appendChild(onlyTxt);
        const favOnlyWrap = document.createElement('label');
        favOnlyWrap.className = 'mc-toolbar-toggle';
        favOnlyWrap.title = 'Nur favorisierte Einträge anzeigen';
        const favOnlyToggle = mkToggle(false, () => { renderAusstattung(); });
        const favOnlyCb = favOnlyToggle.querySelector('input');
        favOnlyWrap.appendChild(favOnlyToggle);
        const favOnlyTxt = document.createElement('span');
        favOnlyTxt.textContent = 'nur Favoriten';
        favOnlyWrap.appendChild(favOnlyTxt);
        const bulkAllOn = mkBtn('ghost', 'Alle ein', () => bulkAusAlle(true));
        const bulkAllOff = mkBtn('ghost', 'Alle aus', () => bulkAusAlle(false));
        const bulkVisOn = mkBtn('ghost', 'Sichtbare ein', () => bulkAusSichtbar(true));
        const bulkVisOff = mkBtn('ghost', 'Sichtbare aus', () => bulkAusSichtbar(false));
        const btnNeuAus = mkBtn('primary', '+ Neu', () => {
            aktuelleAusstattungsKonfig.unshift({ begriffe: [], anzeige: '', farbe: '#66ff66', aktiv: true });
            ausSearch._input.value = '';
            onlyCb.checked = false;
            favOnlyCb.checked = false;
            markDirty();
            renderAusstattung();
            showToast('Neuer Ausstattungseintrag', 'success');
        });
        const btnResetAus = mkBtn('danger', 'Reset Defaults', async () => {
            const ok = await confirmAsync('Ausstattungs-Konfiguration auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'ausstattung', data: snapshotAus() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_config', aktuelleAusstattungsKonfig);
            aktuelleAusstattungsKonfig = JSON.parse(JSON.stringify(suchKonfigurationenDefault));
            markDirty();
            renderAusstattung();
            showToast('Ausstattung auf Standard zurückgesetzt (Backup angelegt)', 'success');
        });
        const ausTopRow = document.createElement('div');
        ausTopRow.className = 'mc-toolbar__row mc-toolbar__row--top';
        ausTopRow.appendChild(ausSearch);
        ausTopRow.appendChild(bulkAllOn);
        ausTopRow.appendChild(bulkAllOff);
        ausTopRow.appendChild(bulkVisOn);
        ausTopRow.appendChild(bulkVisOff);
        ausTopRow.appendChild(btnNeuAus);

        const ausBottomRow = document.createElement('div');
        ausBottomRow.className = 'mc-toolbar__row mc-toolbar__row--bottom';
        ausBottomRow.appendChild(onlyWrap);
        ausBottomRow.appendChild(favOnlyWrap);
        ausBottomRow.appendChild(btnResetAus);

        ausToolbar.appendChild(ausTopRow);
        ausToolbar.appendChild(ausBottomRow);
        ausToolbar.appendChild(ausMeta);

        const ausstattungContainer = document.createElement('div');
        ausstattungContainer.className = 'mc-aus-list-scroll';
        panelAus.appendChild(ausToolbar);
        panelAus.appendChild(ausstattungContainer);
        installKonfigTabHelp('aus', 'mc-konfig-help-aus', 'Hilfe zum Tab Ausstattung', 'Hilfe zu Ausstattung', ausTopRow, null, panelAus, ausstattungContainer);

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
            if (!f) return true;
            if ((item.anzeige || '').toLowerCase().includes(f)) return true;
            if ((item.begriffe || []).some(b => String(b).toLowerCase().includes(f))) return true;
            return false;
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

        function bulkAusSichtbar(flag) {
            const vis = getVisibleAusIndices();
            if (vis.length === 0) {
                showToast('Keine sichtbaren Einträge', 'warn');
                return;
            }
            pushUndo({ kind: 'ausstattung', data: snapshotAus() });
            vis.forEach(ix => { aktuelleAusstattungsKonfig[ix].aktiv = flag; });
            markDirty();
            renderAusstattung();
            showToast('Sichtbare Einträge ' + (flag ? 'aktiviert' : 'deaktiviert'), 'success');
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

        function appendAusstattungCard(index) {
                const item = aktuelleAusstattungsKonfig[index];
                if (!item) return;
                const card = document.createElement('div');
                card.className = 'mc-card';
                card.dataset.cfgIndex = String(index);
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

                const handle = mkDragHandle();
                handle.draggable = true;
                handle.addEventListener('dragstart', e => {
                    draggedAusstattungIndex = parseInt(card.dataset.cfgIndex, 10);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(draggedAusstattungIndex));
                });
                handle.addEventListener('dragend', () => { draggedAusstattungIndex = null; });

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

                rowTop.appendChild(handle);
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

                card.addEventListener('dragover', e => e.preventDefault());
                card.addEventListener('drop', e => {
                    e.preventDefault();
                    const to = parseInt(card.dataset.cfgIndex, 10);
                    if (draggedAusstattungIndex === null || draggedAusstattungIndex === to) return;
                    pushUndo({ kind: 'ausstattung', data: snapshotAus() });
                    const from = draggedAusstattungIndex;
                    const moved = aktuelleAusstattungsKonfig[from];
                    aktuelleAusstattungsKonfig.splice(from, 1);
                    const insertAt = from < to ? to - 1 : to;
                    aktuelleAusstattungsKonfig.splice(insertAt, 0, moved);
                    reorderExpandedAusAfterDrop(from, to);
                    draggedAusstattungIndex = null;
                    markDirty();
                    renderAusstattung();
                });

                ausstattungContainer.appendChild(card);
        }

        function renderAusstattung() {
            sanitizeExpandedAusstattungIndex();
            ausstattungContainer.innerHTML = '';
            const vis = getVisibleAusIndices();
            const { a, t } = countAusaktiv();
            const favVis = vis.filter(i => aktuelleAusstattungsKonfig[i].favorit === true).length;
            const restVis = vis.length - favVis;
            ausMeta.textContent = 'Bulk auf ' + vis.length + ' sichtbare (' + favVis + ' Favoriten, ' + restVis + ' weitere). Gesamt ' + t + ', ' + a + ' aktiv. Spaltenköpfe sortieren die Anzeige · Speichern alphabetisch nach Anzeigetext.';
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
            ausstattungContainer.appendChild(colHeader);

            const { fav, rest } = partitionFavoriteIndices(vis, aktuelleAusstattungsKonfig);
            const sortedFav = sortIndices(fav, aktuelleAusstattungsKonfig, ausSort.key, ausSort.dir, ausCompareValue);
            const sortedRest = sortIndices(rest, aktuelleAusstattungsKonfig, ausSort.key, ausSort.dir, ausCompareValue);
            colHeader._syncColSort();

            function renderAusBlock(indices, heading) {
                if (!indices.length) return;
                if (heading) ausstattungContainer.appendChild(mkSectionHead(heading));
                indices.forEach(idx => appendAusstattungCard(idx));
            }

            if (sortedFav.length && sortedRest.length) {
                renderAusBlock(sortedFav, 'Favoriten');
                ausstattungContainer.appendChild(mkSectionDivider());
                renderAusBlock(sortedRest, 'Weitere Einträge');
            } else if (sortedFav.length) {
                renderAusBlock(sortedFav, favVis < vis.length ? 'Favoriten' : null);
            } else {
                renderAusBlock(sortedRest, null);
            }
            updateTabBadges();
            refreshValidationUI();
        }

        /** --- Tech --- */
        const techToolbar = document.createElement('div');
        techToolbar.className = 'mc-toolbar';
        const techMeta = document.createElement('div');
        techMeta.className = 'mc-toolbar-meta';
        const techSearch = mkSearchBox('Suche (Begriff)…', () => { renderTechData(); });
        const techBulkOn = mkBtn('ghost', 'Alle ein', () => bulkTechAlle(true));
        const techBulkOff = mkBtn('ghost', 'Alle aus', () => bulkTechAlle(false));
        const techBulkVisOn = mkBtn('ghost', 'Sichtbare ein', () => bulkTechSichtbar(true));
        const techBulkVisOff = mkBtn('ghost', 'Sichtbare aus', () => bulkTechSichtbar(false));
        const btnNeuTech = mkBtn('primary', '+ Neu', () => {
            aktuelleTechKonfigurationen.push({ begriff: '', aktiv: true });
            markDirty();
            renderTechData();
        });
        const btnResetTech = mkBtn('danger', 'Reset Defaults', async () => {
            const ok = await confirmAsync('Tech-Konfiguration auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'tech', data: snapshotTech() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_techconfig', aktuelleTechKonfigurationen);
            aktuelleTechKonfigurationen = JSON.parse(JSON.stringify(techDataKonfigurationenDefault));
            markDirty();
            renderTechData();
            showToast('Tech-Daten auf Standard zurückgesetzt', 'success');
        });
        const techTopRow = document.createElement('div');
        techTopRow.className = 'mc-toolbar__row mc-toolbar__row--top';
        techTopRow.appendChild(techSearch);
        techTopRow.appendChild(techBulkOn);
        techTopRow.appendChild(techBulkOff);
        techTopRow.appendChild(techBulkVisOn);
        techTopRow.appendChild(techBulkVisOff);
        techTopRow.appendChild(btnNeuTech);
        techTopRow.appendChild(btnResetTech);
        techToolbar.appendChild(techTopRow);
        techToolbar.appendChild(techMeta);

        const techContainer = document.createElement('div');
        techContainer.className = 'mc-tech-list-scroll';
        panelTech.appendChild(techToolbar);
        panelTech.appendChild(techContainer);
        installKonfigTabHelp('tech', 'mc-konfig-help-tech', 'Hilfe zum Tab Tech-Daten', 'Hilfe zu Tech-Daten', techToolbar, techMeta, panelTech, techContainer);

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

        function bulkTechSichtbar(flag) {
            const vis = getVisibleTechIndices();
            if (!vis.length) {
                showToast('Keine sichtbaren Tech-Einträge', 'warn');
                return;
            }
            pushUndo({ kind: 'tech', data: snapshotTech() });
            vis.forEach(ix => { aktuelleTechKonfigurationen[ix].aktiv = flag; });
            markDirty();
            renderTechData();
            showToast('Sichtbare Tech-Einträge ' + (flag ? 'aktiviert' : 'deaktiviert'), 'success');
        }

        function cardIssuesTech(item) {
            const errs = [];
            if (!String(item.begriff || '').trim()) errs.push('Begriff fehlt');
            return errs;
        }

        function renderTechData() {
            techContainer.innerHTML = '';
            const vis = getVisibleTechIndices();
            const total = aktuelleTechKonfigurationen.length;
            const act = aktuelleTechKonfigurationen.filter(t => t.aktiv).length;
            const sortedVis = sortIndices(vis, aktuelleTechKonfigurationen, techSort.key, techSort.dir, techCompareValue);
            techMeta.textContent = 'Bulk auf ' + vis.length + ' von ' + total + ' sichtbare Zeilen · ' + act + ' aktiv. Spaltenköpfe sortieren die Anzeige.';

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
                const handle = mkDragHandle();
                handle.draggable = true;
                handle.addEventListener('dragstart', e => {
                    draggedTechItemIndex = parseInt(card.dataset.techIndex, 10);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(draggedTechItemIndex));
                });
                handle.addEventListener('dragend', () => { draggedTechItemIndex = null; });

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

                card.addEventListener('dragover', e => e.preventDefault());
                card.addEventListener('drop', e => {
                    e.preventDefault();
                    const to = parseInt(card.dataset.techIndex, 10);
                    if (draggedTechItemIndex === null || draggedTechItemIndex === to) return;
                    pushUndo({ kind: 'tech', data: snapshotTech() });
                    const from = draggedTechItemIndex;
                    const moved = aktuelleTechKonfigurationen[from];
                    aktuelleTechKonfigurationen.splice(from, 1);
                    const insertAt = from < to ? to - 1 : to;
                    aktuelleTechKonfigurationen.splice(insertAt, 0, moved);
                    draggedTechItemIndex = null;
                    markDirty();
                    renderTechData();
                });

                techContainer.appendChild(card);
            });
            updateTabBadges();
            refreshValidationUI();
        }

        /** --- Merge --- */
        const mergeToolbar = document.createElement('div');
        mergeToolbar.className = 'mc-toolbar';
        const mergeMeta = document.createElement('div');
        mergeMeta.className = 'mc-toolbar-meta';
        const mergeSearch = mkSearchBox('Suche nach Basis…', () => renderMergeConfig());
        const mergeOnlyWrap = document.createElement('label');
        mergeOnlyWrap.className = 'mc-toolbar-toggle';
        mergeOnlyWrap.title = 'Nur aktive Merge-Gruppen anzeigen';
        const mergeOnlyToggle = mkToggle(false, () => { renderMergeConfig(); });
        const mergeOnlyCb = mergeOnlyToggle.querySelector('input');
        mergeOnlyWrap.appendChild(mergeOnlyToggle);
        const mergeOnlyTxt = document.createElement('span');
        mergeOnlyTxt.textContent = 'nur aktive';
        mergeOnlyWrap.appendChild(mergeOnlyTxt);
        const mergeBulkOn = mkBtn('ghost', 'Alle ein', () => bulkMergeAlle(true));
        const mergeBulkOff = mkBtn('ghost', 'Alle aus', () => bulkMergeAlle(false));
        const mergeBulkVisOn = mkBtn('ghost', 'Sichtbare ein', () => bulkMergeSichtbar(true));
        const mergeBulkVisOff = mkBtn('ghost', 'Sichtbare aus', () => bulkMergeSichtbar(false));
        const btnNewMerge = mkBtn('primary', '+ Neu', () => {
            aktuelleMergeGruppen.push({ basis: '', order: [], aktiv: true });
            markDirty();
            renderMergeConfig();
        });
        const btnResetMerge = mkBtn('danger', 'Reset Defaults', async () => {
            const ok = await confirmAsync('Merge-Gruppen auf Defaults zurücksetzen? Aktueller Stand wird vorher gesichert.');
            if (!ok) return;
            pushUndo({ kind: 'merge', data: snapshotMerge() });
            speichereConfig(STORAGE_KEYS.backupPrefix + Date.now() + '_mergeGruppen', aktuelleMergeGruppen);
            aktuelleMergeGruppen = JSON.parse(JSON.stringify(mergeGruppenConfigDefault));
            markDirty();
            renderMergeConfig();
            showToast('Merge-Gruppen auf Standard zurückgesetzt', 'success');
        });
        const mergeTopRow = document.createElement('div');
        mergeTopRow.className = 'mc-toolbar__row mc-toolbar__row--top';
        mergeTopRow.appendChild(mergeSearch);
        mergeTopRow.appendChild(mergeBulkOn);
        mergeTopRow.appendChild(mergeBulkOff);
        mergeTopRow.appendChild(mergeBulkVisOn);
        mergeTopRow.appendChild(mergeBulkVisOff);
        mergeTopRow.appendChild(btnNewMerge);
        mergeTopRow.appendChild(btnResetMerge);
        const mergeBottomRow = document.createElement('div');
        mergeBottomRow.className = 'mc-toolbar__row mc-toolbar__row--bottom';
        mergeBottomRow.appendChild(mergeOnlyWrap);
        mergeToolbar.appendChild(mergeTopRow);
        mergeToolbar.appendChild(mergeBottomRow);
        mergeToolbar.appendChild(mergeMeta);

        const mergeContainer = document.createElement('div');
        mergeContainer.className = 'mc-merge-list-scroll';
        panelMerge.appendChild(mergeToolbar);
        panelMerge.appendChild(mergeContainer);
        installKonfigTabHelp('merge', 'mc-konfig-help-merge', 'Hilfe zum Tab Merge-Gruppen', 'Hilfe zu Merge-Gruppen', mergeToolbar, mergeMeta, panelMerge, mergeContainer);

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

        function bulkMergeSichtbar(flag) {
            const vis = getVisibleMergeIndices();
            if (!vis.length) {
                showToast('Keine sichtbaren Merge-Gruppen', 'warn');
                return;
            }
            pushUndo({ kind: 'merge', data: snapshotMerge() });
            vis.forEach(ix => { aktuelleMergeGruppen[ix].aktiv = flag; });
            markDirty();
            renderMergeConfig();
            showToast('Sichtbare Merge-Gruppen ' + (flag ? 'aktiviert' : 'deaktiviert'), 'success');
        }

        function cardIssuesMerge(g) {
            const errs = [];
            if (!(g.basis || '').trim()) errs.push('Basis fehlt');
            if (!Array.isArray(g.order) || !g.order.length) errs.push('Reihenfolge leer');
            return errs;
        }

        function renderMergeConfig() {
            mergeContainer.innerHTML = '';
            const vis = getVisibleMergeIndices();
            const total = aktuelleMergeGruppen.length;
            const act = aktuelleMergeGruppen.filter(g => g.aktiv !== false).length;
            const sortedVis = sortIndices(vis, aktuelleMergeGruppen, mergeSort.key, mergeSort.dir, mergeCompareValue);
            mergeMeta.textContent = 'Bulk auf ' + vis.length + ' von ' + total + ' sichtbare Gruppen · ' + act + ' aktiv. Spaltenköpfe sortieren die Anzeige · Speichern nach Basis.';
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
                inputBasis.style.width = '100%';
                inputBasis.style.minWidth = '0';
                inputBasis.value = group.basis || '';
                inputBasis.placeholder = 'Basis (z. B. außenspiegel)';
                inputBasis.addEventListener('input', () => {
                    group.basis = inputBasis.value;
                    markDirty();
                    refreshValidationUI();
                });

                const orderWrap = document.createElement('div');
                orderWrap.style.minWidth = '0';
                const lb = document.createElement('div');
                lb.className = 'mc-label-sm';
                lb.textContent = 'Modifier (Komma-getrennt)';
                const inputOrder = document.createElement('input');
                inputOrder.type = 'text';
                inputOrder.className = 'mc-input';
                inputOrder.style.width = '100%';
                inputOrder.value = (group.order || []).join(', ');
                inputOrder.addEventListener('input', () => {
                    group.order = inputOrder.value.split(',').map(s => s.trim()).filter(Boolean);
                    markDirty();
                    refreshValidationUI();
                });
                orderWrap.appendChild(lb);
                orderWrap.appendChild(inputOrder);
                rowTop.appendChild(inputBasis);
                rowTop.appendChild(orderWrap);

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

        /** --- Import / Export --- */
        const ieToolbar = document.createElement('div');
        ieToolbar.className = 'mc-toolbar';
        const ieRow = document.createElement('div');
        ieRow.className = 'mc-row-ie';

        const cardEx = document.createElement('div');
        cardEx.className = 'mc-ie-card';
        const exTitle = document.createElement('div');
        exTitle.style.fontWeight = '600';
        exTitle.style.marginBottom = '6px';
        exTitle.textContent = 'Export';
        const exportArea = document.createElement('textarea');
        exportArea.className = 'mc-textarea';
        exportArea.readOnly = true;
        exportArea.rows = 8;
        exportArea.style.width = '100%';
        exportArea.style.marginTop = '6px';

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
        cardEx.appendChild(exTitle);
        cardEx.appendChild(btnGenerateExport);
        cardEx.appendChild(btnCopyExport);
        cardEx.appendChild(btnDownloadExport);
        cardEx.appendChild(exportArea);

        const cardIm = document.createElement('div');
        cardIm.className = 'mc-ie-card';
        const imTitle = document.createElement('div');
        imTitle.style.fontWeight = '600';
        imTitle.style.marginBottom = '6px';
        imTitle.textContent = 'Import';
        const drop = document.createElement('div');
        drop.className = 'mc-dropzone';
        drop.textContent = 'JSON-Datei hierher ziehen oder klicken';
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
        importArea.className = 'mc-textarea';
        importArea.rows = 8;
        importArea.style.width = '100%';
        importArea.style.marginTop = '6px';
        importArea.placeholder = 'JSON einfügen…';

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
                    aktuelleFeatureFlags = { ...featureFlagsDefault(), ...obj.featureFlags };
                }
                markDirty();
                renderAusstattung();
                renderTechData();
                renderMergeConfig();
                renderConfig();
                refreshExportArea();
                showToast('Import angewendet. Backup-Zeitstempel: ' + ts + '. Bitte Speichern klicken.', 'success');
            } catch (e2) {
                showToast('Fehler beim Import: ' + e2, 'error');
            }
        });

        cardIm.appendChild(imTitle);
        cardIm.appendChild(drop);
        cardIm.appendChild(fileInp);
        cardIm.appendChild(importArea);
        cardIm.appendChild(btnImport);

        ieRow.appendChild(cardEx);
        ieRow.appendChild(cardIm);
        panelIE.appendChild(ieToolbar);
        panelIE.appendChild(ieRow);
        installKonfigTabHelp('ie', 'mc-konfig-help-ie', 'Hilfe zum Tab Import / Export', 'Hilfe zu Import und Export', ieToolbar, null, panelIE, ieRow);

        /** --- Config (Feature-Flags) --- */
        const configToolbar = document.createElement('div');
        configToolbar.className = 'mc-toolbar';
        const configTopRow = document.createElement('div');
        configTopRow.className = 'mc-toolbar__row mc-toolbar__row--top mc-toolbar__row--config';
        const btnResetFlags = mkBtn('danger', 'Reset Defaults', async () => {
            const ok = await confirmAsync('Alle Feature-Flags auf Standard zurücksetzen?');
            if (!ok) return;
            aktuelleFeatureFlags = featureFlagsDefault();
            markDirty();
            renderConfig();
            showToast('Feature-Flags zurückgesetzt', 'success');
        });
        configTopRow.appendChild(btnResetFlags);
        configToolbar.appendChild(configTopRow);

        const configContainer = document.createElement('div');
        panelConfig.appendChild(configToolbar);
        panelConfig.appendChild(configContainer);
        installKonfigTabHelp('config', 'mc-konfig-help-config', 'Hilfe zum Tab Config', 'Hilfe zu Config', configTopRow, null, panelConfig, configContainer);

        function renderConfig() {
            configContainer.innerHTML = '';
            if (!FEATURE_FLAG_DEFINITIONS.length) {
                configContainer.appendChild(mkEmptyState('Aktuell sind keine Feature-Flags definiert.'));
                return;
            }
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

                const tw = document.createElement('div');
                tw.className = 'mc-toggle-wrap';
                const current = aktuelleFeatureFlags[def.key];
                const toggleEl = mkToggle(current !== false, v => {
                    aktuelleFeatureFlags[def.key] = v;
                    markDirty();
                    statusLbl.textContent = v ? 'Aktiv' : 'Aus';
                    statusLbl.classList.toggle('mc-feature-status--on', v);
                    updateTabBadges();
                });
                const statusLbl = document.createElement('span');
                statusLbl.className = 'mc-feature-status' + ((current !== false) ? ' mc-feature-status--on' : '');
                statusLbl.textContent = (current !== false) ? 'Aktiv' : 'Aus';
                tw.appendChild(statusLbl);
                tw.appendChild(toggleEl);

                row.appendChild(txtCol);
                row.appendChild(tw);
                card.appendChild(row);
                configContainer.appendChild(card);
            });
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
                const fOn = FEATURE_FLAG_DEFINITIONS.filter(d => aktuelleFeatureFlags[d.key] !== false).length;
                const fAll = FEATURE_FLAG_DEFINITIONS.length;
                tabButtons[4].labelSpan.textContent = 'Config';
                tabButtons[4].badge.textContent = '[' + fOn + ' / ' + fAll + ']';
            }
        }

        /** Save */
        saveBtn.addEventListener('click', async () => {
            const issuesTxt = collectValidation();
            if (issuesTxt.length > 0) {
                const preview = issuesTxt.slice(0, 10).join('\n') + (issuesTxt.length > 10 ? '\n…und ' + (issuesTxt.length - 10) + ' weitere' : '');
                const okSave = await confirmAsync('Es gibt Hinweise:\n\n' + preview + '\n\nTrotzdem speichern?');
                if (!okSave) {
                    refreshValidationUI();
                    return;
                }
            }
            aktuelleAusstattungsKonfig.sort((a, b) => (a.anzeige || '').trim().localeCompare((b.anzeige || '').trim()));
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

            saveBtn.disabled = true;
            saveBtn.textContent = '✔ Gespeichert';
            setTimeout(() => {
                removeOverlay();
                clearResults();
                trigger();
            }, 800);
        });

        refreshExportArea();
        renderAusstattung();
        renderTechData();
        renderMergeConfig();
        renderConfig();
        updateTabBadges();
        refreshValidationUI();
        syncUndoBtn();

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
