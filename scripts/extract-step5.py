#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
lines = (ROOT / 'src/legacy/monolith.js').read_text(encoding='utf-8').splitlines()


def find_line(pattern, start=0):
    for i in range(start, len(lines)):
        if pattern in lines[i]:
            return i
    raise ValueError(pattern)


def extract(start, end):
    out = []
    for line in lines[start:end]:
        out.append(line[4:] if line.startswith('    ') else line)
    return out


def exp(body):
    return [('export ' + L if re.match(r'^(function |const |let |var )', L) else L) for L in body]


def write(path, header, body):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(header + '\n'.join(exp(body)) + '\n', encoding='utf-8')


price_s = find_line('function isPriceRatingDebugEnabled()')
price_e = find_line('// 10) Lifecycle:')
obs_s = find_line('let observer = null')
maps_s = find_line('function verlinkeStandortAufGoogleMaps()')
obs_start_s = find_line('function startObserver()')
srp_s = find_line('// 10b) Suchergebnisse:')
srp_e = find_line('function initSrpSortBehavior()')
# include initSrpSortBehavior body (ends before next section / blank after closing brace)
while srp_e < len(lines) and lines[srp_e].strip() != '}':
    srp_e += 1
srp_e += 1
init_s = find_line('let lastUrl = location.href')
init_e = find_line('// Hilfe-Texte für Konfig-Popup')

write(
    ROOT / 'src/features/price-rating/index.js',
    """import {
    PRICE_RATING_LEVELS, PRICE_RATING_DEFAULT, DEFAULT_PREIS_GEWICHT_BY_ANZEIGE,
    PRICE_COHORT_CACHE_PREFIX, PRICE_RATING_CACHE_PREFIX, PRICE_RATING_UI_CACHE_PREFIX,
    PRICE_VIP_EQUIP_CACHE_PREFIX, PRICE_DATA_STORE_KEY, PRICE_DATA_STORE_VERSION,
    PRICE_DATA_STORE_MAX_ADS, PRICE_DATA_STORE_MAX_COHORTS, MAKE_MODEL_CACHE_PREFIX,
    MAKE_MODEL_AD_CACHE_PREFIX, PRICE_COHORT_CACHE_TTL_MS, PRICE_RATING_UI_CACHE_TTL_MS,
    DEBUG_SCOPE_PREFIX,
} from '../../config/constants.js';
import { getUnsafeWindow } from '../../platform/page-window.js';
import { cleanText, tokenize, escapeRegex } from '../../core/text/normalize.js';
import { collectConfigMatches } from '../../core/search/config-matches.js';
import { extractSources, classifyDescription } from '../../core/dom/sources.js';
import { getDescriptionEl } from '../../core/dom/selectors.js';
import { runtimeState } from '../../config/runtime-state.js';
import { debugLog, getDebugConfig, isDebugEnabled, getPriceRating, isPriceRatingEnabled, getSrpSort, mergePriceRating } from '../../config/feature-flags/index.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';

""",
    extract(price_s, price_e),
)

write(
    ROOT / 'src/lifecycle/scheduler.js',
    """import { pricePerfMarkEnd, pricePerfMarkStart } from '../features/price-rating/index.js';

""",
    extract(obs_s, maps_s),
)

write(
    ROOT / 'src/lifecycle/maps-link.js',
    """import { runtimeState } from '../config/runtime-state.js';

""",
    extract(maps_s, obs_start_s),
)

write(
    ROOT / 'src/lifecycle/observer.js',
    """import { clearResults, ergebnisHinzufuegen } from '../ui/results/render.js';
import {
    isVehicleDetailPage, preisBewertungAktualisieren, scanSrpPriceBadges,
    syncCohortCacheFromSearchPage, ensureSrpDebugLogCard, ensureDetailDebugLogCard,
} from '../features/price-rating/index.js';
import { scheduleTask } from './scheduler.js';
import { verlinkeStandortAufGoogleMaps } from './maps-link.js';

""",
    extract(obs_start_s, srp_s),
)

write(
    ROOT / 'src/features/srp-sort/index.js',
    """import { SRP_SORT_OPTIONS } from '../../config/constants.js';
import { runtimeState } from '../../config/runtime-state.js';
import {
    getDebugConfig, getSrpSort, findSrpSortOption, hasSrpSortUserOverride,
    markSrpSortUserOverride, clearSrpSortUserOverride, clearSrpSortSessionState,
    getStoredSrpUserChoice, setStoredSrpUserChoice, clearStoredSrpUserChoice,
    getStoredSrpSortApplied, markSrpSortApplied, clearStoredSrpSortApplied,
    srpSortParamsEqual,
} from '../../config/feature-flags/index.js';

const SRP_DEBUG_LOG_MAX_ENTRIES = 100;

""",
    extract(srp_s, srp_e),
)

init_body = exp(extract(init_s, init_e))
init_src = '\n'.join(init_body)
init_src = init_src.replace('priceRatingFetchToken++;', 'priceRatingFetchTokenIncrement();')
init_src = re.sub(
    r'window\.addEventListener\(\'storage\', e => \{',
    'function onStorageCohortUpdate(e) {',
    init_src,
    count=1,
)
# close storage handler - replace matching `});` before startObserver comment - fragile
# Keep storage inline in initApp export

(ROOT / 'src/lifecycle/init.js').write_text(
    """import { clearResults } from '../ui/results/render.js';
import {
    clearPriceRatingUi, ensureSrpPriceRatingObserver, ensureSrpDebugLogCard,
    removeSrpDebugLogCard, ensureDetailDebugLogCard, removeDetailDebugLogCard,
    preisBewertungAktualisieren, priceRatingFetchTokenIncrement, markSrpInteraction,
    isVehicleDetailPage, invalidateVipRatingCacheForReload,
} from '../features/price-rating/index.js';
import {
    initSrpSortBehavior, ensureSrpSortBehavior, handleSrpUrlChange,
    destroySrpSortBehavior, isSearchResultsPage,
} from '../features/srp-sort/index.js';
import { PRICE_COHORT_CACHE_PREFIX } from '../config/constants.js';
import { startObserver, trigger } from './observer.js';
import { scheduleTask } from './scheduler.js';

"""
    + init_src
    + """

export function initApp() {
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);
    setInterval(onUrlChange, 1000);
    window.addEventListener('scroll', markSrpInteraction, { passive: true });
    window.addEventListener('pointermove', markSrpInteraction, { passive: true });
    window.addEventListener('storage', onStorageCohortUpdate);
    startObserver();
    trigger();
    scheduleTask('rating:vip-initial-detail', 'rating', () => { preisBewertungAktualisieren({ force: true }); });
    initSrpSortBehavior();
    scheduleTask('rating:srp-observer-init', 'rating', () => ensureSrpPriceRatingObserver());
    scheduleTask('ui:srp-debug-card-init', 'ui', () => ensureSrpDebugLogCard());
    scheduleTask('ui:detail-debug-card-init', 'ui', () => ensureDetailDebugLogCard());
}
""",
    encoding='utf-8',
)

# price token increment
pr_path = ROOT / 'src/features/price-rating/index.js'
pr = pr_path.read_text(encoding='utf-8')
if 'priceRatingFetchTokenIncrement' not in pr:
    pr = pr.replace(
        'let priceRatingFetchToken = 0;',
        'let priceRatingFetchToken = 0;\n\nexport function priceRatingFetchTokenIncrement() { priceRatingFetchToken++; }\n',
    )
    pr_path.write_text(pr, encoding='utf-8')

# Remove from monolith
for start, end in sorted(
    [(init_s, init_e), (srp_s, srp_e), (obs_s, srp_s), (price_s, price_e)],
    reverse=True,
):
    del lines[start:end]

# strip orphan comments after bootstrap
bi = find_line('bootstrapConfig();')
while bi + 1 < len(lines) and lines[bi + 1].strip().startswith('//'):
    del lines[bi + 1]

# insert imports after bootstrap
ins = """import {
    pricePerfMarkStart, pricePerfMarkEnd, getPriceRating, mergePriceRating, isPriceRatingEnabled,
    applyPreisGewichtDefaults, clearAllPreisGewichte, runManualCohortLog, runManualSrpStatusLog,
    runManualPriceRatingUiLog, exportPriceDataStore, importPriceDataStore,
    persistPriceRatingDebug, persistPriceRatingPerfDebug,
} from '../features/price-rating/index.js';
import { resetSrpSortOverrideAndApply, isSearchResultsPage } from '../features/srp-sort/index.js';
import { initApp } from '../lifecycle/init.js';

initApp();
"""
bi = find_line('bootstrapConfig();')
lines[bi + 1:bi + 1] = ins.splitlines()

# remove duplicate init at end if present
lines = [L for L in lines if 'registerConfigPopupOpener(oeffneKonfigPopup)' in L or 'gmRegisterMenuCommand' in L or 'setTimeout(erstelleKonfigButton' in L or not L.strip().startswith('startObserver();')]

# remove trailing bootstrap duplicates - grep startObserver in tail
out = []
skip_init_block = False
for L in lines:
    if L.strip() == 'startObserver();' and 'initApp' in '\n'.join(lines):
        continue
    if L.strip() == 'trigger();' and 'initApp' in ins:
        continue
    if 'initSrpSortBehavior();' in L and L.strip() == 'initSrpSortBehavior();':
        continue
    if L.strip().startswith('scheduleTask(') and 'vip-initial' in L:
        continue
    if 'window.addEventListener(\'popstate\'' in L:
        continue
    if 'window.addEventListener(\'hashchange\'' in L:
        continue
    if 'setInterval(onUrlChange' in L:
        continue
    if 'window.addEventListener(\'scroll\', markSrpInteraction' in L:
        continue
    if 'window.addEventListener(\'pointermove\', markSrpInteraction' in L:
        continue
    if 'window.addEventListener(\'storage\'' in L:
        continue
    out.append(L)

(ROOT / 'src/legacy/monolith.js').write_text('\n'.join(out) + '\n', encoding='utf-8')
print('done', len(out))
