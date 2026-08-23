import { requestIdle } from '../core/util/request-idle.js';
import { hashString } from '../core/util/content-signature.js';
import { isSearchResultsPage } from '../core/page-context.js';
import {
    getPageInitialState,
    parseCohortItemsFromState,
    scanSrpPriceBadgesInRoots,
    syncCohortCacheFromSearchPage,
} from '../features/price-rating/index.js';

const SRP_DEBOUNCE_MS = 450;
const SRP_THROTTLE_MS = 1200;

let srpDebounceTimer = null;
let srpThrottleAt = 0;
let srpIdlePending = false;
let pendingSrpForce = false;
const pendingSrpRoots = new Set();

let lastCohortSyncSig = '';

function cohortListingFingerprint(items) {
    const sample = (items || []).slice(0, 32).map(raw => {
        const ad = raw?.ad || raw?.data?.ad || raw;
        return String(ad?.id || ad?.price?.grossAmount || '').trim();
    });
    return hashString(sample.join(','));
}

export function computeCohortSyncSignature() {
    if (!isSearchResultsPage()) return '';
    const state = getPageInitialState();
    if (!state) return location.pathname + location.search;
    const items = parseCohortItemsFromState(state, null);
    return [
        location.pathname,
        location.search,
        items.length,
        cohortListingFingerprint(items),
    ].join('|');
}

export function scheduleSrpPageRefresh(force, addedRoot) {
    if (!isSearchResultsPage()) return;
    if (force) pendingSrpForce = true;
    if (addedRoot && addedRoot.nodeType === 1 && addedRoot !== document.body) {
        pendingSrpRoots.add(addedRoot);
    }

    clearTimeout(srpDebounceTimer);
    const delay = pendingSrpForce ? 0 : SRP_DEBOUNCE_MS;
    srpDebounceTimer = setTimeout(() => {
        const now = Date.now();
        if (!pendingSrpForce && now - srpThrottleAt < SRP_THROTTLE_MS) {
            scheduleSrpPageRefresh(false);
            return;
        }
        if (srpIdlePending) {
            if (force) pendingSrpForce = true;
            return;
        }
        srpIdlePending = true;
        requestIdle(() => {
            srpIdlePending = false;
            srpThrottleAt = Date.now();
            const runForce = pendingSrpForce;
            pendingSrpForce = false;
            runSrpPageRefresh(runForce);
        }, 360);
    }, delay);
}

function runSrpPageRefresh(force) {
    if (!isSearchResultsPage()) return;

    const cohortSig = computeCohortSyncSignature();
    if (force || cohortSig !== lastCohortSyncSig) {
        lastCohortSyncSig = cohortSig;
        syncCohortCacheFromSearchPage();
    }

    const roots = pendingSrpRoots.size ? [...pendingSrpRoots] : [document.body];
    pendingSrpRoots.clear();
    scanSrpPriceBadgesInRoots(roots);
}

export function resetSrpPageRefreshState() {
    clearTimeout(srpDebounceTimer);
    srpDebounceTimer = null;
    srpIdlePending = false;
    pendingSrpForce = false;
    pendingSrpRoots.clear();
    lastCohortSyncSig = '';
}
