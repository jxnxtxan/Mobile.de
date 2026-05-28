import { clearResults } from '../ui/results/render.js';
import {
    clearPriceRatingUi,
    ensureSrpPriceRatingObserver,
    preisBewertungAktualisieren,
    priceRatingFetchTokenIncrement,
    markSrpInteraction,
    isVehicleDetailPage,
    invalidateVipRatingCacheForReload,
    resetVipRatingUiOnNavigation,
    disconnectSrpPriceRatingObserver,
} from '../features/price-rating/index.js';
import {
    initSrpSortBehavior,
    ensureSrpSortBehavior,
    handleSrpUrlChange,
    destroySrpSortBehavior,
    isSearchResultsPage,
    ensureSrpDebugLogCard,
    removeSrpDebugLogCard,
    ensureDetailDebugLogCard,
    removeDetailDebugLogCard,
} from '../features/srp-sort/index.js';
import { PRICE_COHORT_CACHE_PREFIX } from '../config/constants.js';
import { ensureConfigButton } from '../core/search/popup-bridge.js';
import { startObserver, trigger } from './observer.js';
import { scheduleTask } from './scheduler.js';

export let lastUrl = location.href;

export function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    resetVipRatingUiOnNavigation();
    clearResults();
    priceRatingFetchTokenIncrement();
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
        disconnectSrpPriceRatingObserver();
        removeSrpDebugLogCard();
        ensureDetailDebugLogCard();
    }
    setTimeout(ensureConfigButton, 1500);
}

function onStorageCohortUpdate(e) {
    if (e.key !== PRICE_COHORT_CACHE_PREFIX + '_updated') return;
    if (!isVehicleDetailPage()) return;
    invalidateVipRatingCacheForReload();
    priceRatingFetchTokenIncrement();
    scheduleTask('rating:vip-storage-refresh', 'rating', () => {
        preisBewertungAktualisieren({ force: true });
    });
}

export function initApp() {
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);
    setInterval(onUrlChange, 1000);
    window.addEventListener('scroll', markSrpInteraction, { passive: true });
    window.addEventListener('pointermove', markSrpInteraction, { passive: true });
    window.addEventListener('storage', onStorageCohortUpdate);
    startObserver();
    trigger();
    scheduleTask('rating:vip-initial-detail', 'rating', () => {
        preisBewertungAktualisieren({ force: true });
    });
    initSrpSortBehavior();
    scheduleTask('rating:srp-observer-init', 'rating', () => ensureSrpPriceRatingObserver());
    scheduleTask('ui:srp-debug-card-init', 'ui', () => ensureSrpDebugLogCard());
    scheduleTask('ui:detail-debug-card-init', 'ui', () => ensureDetailDebugLogCard());
}
