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
    syncDebugLogCardsOnPage,
} from '../features/srp-sort/index.js';
import { PRICE_COHORT_CACHE_PREFIX } from '../config/constants.js';
import { ensureConfigButton } from '../core/search/popup-bridge.js';
import { lastUrl, syncLastUrl } from './navigation-state.js';
import { resetTriggerState, startObserver, trigger } from './observer.js';
import { refreshMapsLinkBehavior } from './maps-link.js';
import { resetSrpPageRefreshState, scheduleSrpPageRefresh } from './srp-refresh.js';
import { resetVehicleResultsRefreshState } from '../ui/results/refresh.js';
import { scheduleTask } from './scheduler.js';

export { lastUrl, syncLastUrl };

export function onUrlChange() {
    if (location.href === lastUrl) return;
    syncLastUrl(location.href);
    resetVipRatingUiOnNavigation();
    clearResults();
    priceRatingFetchTokenIncrement();
    clearPriceRatingUi();
    startObserver();
    resetTriggerState();
    resetSrpPageRefreshState();
    resetVehicleResultsRefreshState();
    trigger(true);
    refreshMapsLinkBehavior();
    if (isSearchResultsPage()) {
        ensureSrpSortBehavior();
        handleSrpUrlChange();
        ensureSrpPriceRatingObserver();
        scheduleSrpPageRefresh({ force: true, fullScan: true });
        syncDebugLogCardsOnPage();
    } else {
        destroySrpSortBehavior();
        disconnectSrpPriceRatingObserver();
        syncDebugLogCardsOnPage();
        scheduleTask('rating:vip-after-nav', 'rating', () => {
            preisBewertungAktualisieren({ force: true });
        });
    }
    setTimeout(ensureConfigButton, 600);
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
    if (isVehicleDetailPage()) invalidateVipRatingCacheForReload();
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);
    setInterval(onUrlChange, 1000);
    window.addEventListener('scroll', markSrpInteraction, { passive: true });
    window.addEventListener('pointermove', markSrpInteraction, { passive: true });
    window.addEventListener('storage', onStorageCohortUpdate);
    startObserver();
    trigger(true);
    refreshMapsLinkBehavior();
    scheduleTask('rating:vip-initial-detail', 'rating', () => {
        preisBewertungAktualisieren({ force: true });
    });
    initSrpSortBehavior();
    scheduleTask('rating:srp-observer-init', 'rating', () => ensureSrpPriceRatingObserver());
    scheduleTask('ui:debug-log-cards-init', 'ui', () => syncDebugLogCardsOnPage());
}
