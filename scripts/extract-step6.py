#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
mono_path = ROOT / 'src/legacy/monolith.js'
lines = mono_path.read_text(encoding='utf-8').splitlines()


def find_line(pattern, start=0):
    for i in range(start, len(lines)):
        if pattern in lines[i]:
            return i
    raise ValueError(pattern)


def extract(start, end):
    out = []
    for line in lines[start:end]:
        if line.startswith('    '):
            out.append(line[4:])
        elif line.strip() == '':
            out.append('')
        else:
            out.append(line)
    return out


def export_functions(body_lines):
    return [
        ('export ' + line if re.match(r'^(function |const )', line) else line)
        for line in body_lines
    ]


POPUP_HEADER = """'use strict';

import {
    SCHEMA_VERSION,
    STORAGE_KEYS,
    FEATURE_FLAG_DEFINITIONS,
    LIST_ORDER_DEFAULT,
    SRP_SORT_OPTIONS,
    SRP_SORT_DEFAULT,
    PRICE_RATING_LEVELS,
    PRICE_RATING_DEFAULT,
    DEFAULT_PREIS_GEWICHT_BY_ANZEIGE,
    PRICE_DATA_STORE_KEY,
    PRICE_DATA_STORE_VERSION,
    PRICE_DATA_STORE_MAX_ADS,
    PRICE_DATA_STORE_MAX_COHORTS,
    DEBUG_SCOPE_DEFINITIONS,
    DEBUG_SCOPE_PREFIX,
} from '../config/constants.js';
import { gmGetValue, gmSetValue } from '../platform/gm.js';
import { getUnsafeWindow } from '../platform/page-window.js';
import { cleanText } from '../core/text/normalize.js';
import { runtimeState } from '../config/runtime-state.js';
import { speichereConfig } from '../config/persistence.js';
import { suchKonfigurationenDefault } from '../config/defaults/ausstattung.js';
import { techDataKonfigurationenDefault } from '../config/defaults/tech.js';
import { mergeGruppenConfigDefault } from '../config/defaults/merge-groups.js';
import {
    applyPreisGewichtDefaults,
    clearAllPreisGewichte,
} from '../config/migration/index.js';
import {
    countConfigTabSettings,
    listOrderDefault,
    mergeListOrder,
    getConfigListUi,
    mergeConfigListUi,
    getDebugConfig,
    debugLog,
    persistDebugConfig,
    persistDebugMaster,
    persistDebugScope,
    featureFlagsDefault,
    ladeFeatureFlags,
    persistPriceRatingPerfDebug,
    srpSortDefault,
    findSrpSortOption,
    mergeSrpSort,
    priceRatingDefault,
    mergePriceRating,
    getPriceRating,
    isPriceRatingEnabled,
    getSrpSort,
} from '../config/feature-flags/index.js';
import {
    getListOrder,
    isManualScope,
    hasAnyManualListScope,
    shouldApplyOrderToVehicleResults,
    applySaveOrdering,
    orderIndicesByArrayPosition,
} from '../config/ordering.js';
import { clearResults } from '../ui/results/render.js';
import {
    pricePerfMarkStart,
    pricePerfMarkEnd,
    readPriceDataStore,
    mergePriceDataStoreImport,
    notifyCohortCacheUpdated,
} from '../features/price-rating/index.js';
import {
    resetSrpSortOverrideAndApply,
    isSearchResultsPage,
    runManualCohortLog,
    runManualSrpStatusLog,
} from '../features/srp-sort/index.js';
import { KONFIG_TAB_HELP_HTML } from './help/tabs.js';

"""

BUTTON_HEADER = """'use strict';

import { oeffneKonfigPopup } from './open.js';

"""

help_s = find_line('const KONFIG_TAB_HELP_HTML = new Map')
help_e = find_line(']);', help_s) + 1
popup_s = find_line('function oeffneKonfigPopup()')
popup_e = find_line('// 12) Konfig-Button')
btn_s = find_line('function erstelleKonfigButton()')
btn_e = find_line('setTimeout(erstelleKonfigButton')

help_body = extract(help_s, help_e)
help_body[0] = 'export ' + help_body[0]

Path(ROOT / 'src/popup/help/tabs.js').parent.mkdir(parents=True, exist_ok=True)
Path(ROOT / 'src/popup/help/tabs.js').write_text(
    "'use strict';\n\n" + '\n'.join(help_body) + '\n',
    encoding='utf-8',
)

Path(ROOT / 'src/popup/open.js').write_text(
    POPUP_HEADER + '\n'.join(export_functions(extract(popup_s, popup_e))) + '\n',
    encoding='utf-8',
)

Path(ROOT / 'src/popup/button.js').write_text(
    BUTTON_HEADER + '\n'.join(export_functions(extract(btn_s, btn_e))) + '\n',
    encoding='utf-8',
)

MONOLITH = """'use strict';

import { bootstrapConfig } from '../config/bootstrap.js';
import { gmRegisterMenuCommand } from '../platform/gm.js';
import { registerConfigPopupOpener, registerConfigButtonCreator } from '../core/search/popup-bridge.js';
import { initApp } from '../lifecycle/init.js';
import { oeffneKonfigPopup } from '../popup/open.js';
import { erstelleKonfigButton } from '../popup/button.js';

bootstrapConfig();
initApp();

setTimeout(erstelleKonfigButton, 3000);
registerConfigPopupOpener(oeffneKonfigPopup);
registerConfigButtonCreator(erstelleKonfigButton);
gmRegisterMenuCommand('Mobile.de Ausstattungssuche – Konfiguration', oeffneKonfigPopup);
"""

mono_path.write_text(MONOLITH, encoding='utf-8')
print('extracted help', help_e - help_s, 'popup', popup_e - popup_s, 'button', btn_e - btn_s)
