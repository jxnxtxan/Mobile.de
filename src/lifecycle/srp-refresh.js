import { requestIdle } from '../core/util/request-idle.js';
import { hashString } from '../core/util/content-signature.js';
import { isSearchResultsPage } from '../core/page-context.js';
import {
    findSrpListingsInState,
    getPageInitialState,
    scanSrpPriceBadgesInRoots,
    syncCohortCacheFromSearchPage,
} from '../features/price-rating/index.js';

const SRP_DEBOUNCE_MS = 450;
const SRP_MAX_WAIT_MS = 1800;
const SRP_THROTTLE_MS = 1200;

let srpDebounceTimer = null;
let srpDebounceDeadline = 0;
let srpThrottleAt = 0;
let srpIdlePending = false;
let pendingSrpForce = false;
let pendingSrpFullScan = false;
const pendingSrpRoots = new Set();

let lastCohortSyncSig = '';

/**
 * Fingerprint direkt auf den Rohdaten aus __INITIAL_STATE__ — bewusst ohne
 * `normalizeComparableAd`, das pro Inserat ein Fahrzeugprofil baut und den
 * VIP-Equipment-Cache aus dem localStorage liest.
 */
function cohortListingFingerprint(rawItems) {
    const sample = (rawItems || []).slice(0, 64).map(raw => {
        const ad = raw?.ad || raw?.data?.ad || raw;
        if (!ad) return '';
        return String(ad.id || '') + ':' + String(ad.price?.grossAmount ?? ad.price?.gross ?? '');
    });
    return hashString(sample.join(','));
}

export function computeCohortSyncSignature() {
    if (!isSearchResultsPage()) return '';
    const state = getPageInitialState();
    if (!state) return location.pathname + location.search;
    const rawItems = findSrpListingsInState(state);
    return [
        location.pathname,
        location.search,
        rawItems.length,
        cohortListingFingerprint(rawItems),
    ].join('|');
}

function hasPendingSrpWork() {
    return pendingSrpForce || pendingSrpFullScan || pendingSrpRoots.size > 0;
}

/**
 * Debounce mit Obergrenze: auf Seiten, die dauernd mutieren, würde ein reiner
 * Debounce den Lauf endlos hinausschieben.
 */
function armSrpTimer() {
    const now = Date.now();
    if (!srpDebounceDeadline) srpDebounceDeadline = now + SRP_MAX_WAIT_MS;
    clearTimeout(srpDebounceTimer);
    const delay = pendingSrpForce
        ? 0
        : Math.max(0, Math.min(SRP_DEBOUNCE_MS, srpDebounceDeadline - now));
    srpDebounceTimer = setTimeout(onSrpTimer, delay);
}

function onSrpTimer() {
    srpDebounceTimer = null;
    srpDebounceDeadline = 0;
    if (srpIdlePending) {
        if (hasPendingSrpWork()) armSrpTimer();
        return;
    }
    if (!pendingSrpForce && Date.now() - srpThrottleAt < SRP_THROTTLE_MS) {
        armSrpTimer();
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
}

/**
 * @param {{force?: boolean, fullScan?: boolean, roots?: Iterable<Element>}} [options]
 *   Ohne konkrete `roots` wird ein Voll-Scan erzwungen — der Aufrufer weiß dann
 *   nicht, was sich geändert hat. Das Flag bleibt bis zum Lauf gesetzt, damit
 *   ein Voll-Scan nicht von zwischenzeitlich eingereihten Roots verdrängt wird.
 */
export function scheduleSrpPageRefresh(options) {
    if (!isSearchResultsPage()) return;
    const opts = options || {};
    if (opts.force) pendingSrpForce = true;

    let added = 0;
    if (opts.roots) {
        for (const node of opts.roots) {
            if (!node || node.nodeType !== 1) continue;
            if (node === document.body) { pendingSrpFullScan = true; continue; }
            pendingSrpRoots.add(node);
            added++;
        }
    }
    if (opts.fullScan || !added) pendingSrpFullScan = true;

    armSrpTimer();
}

function runSrpPageRefresh(force) {
    if (!isSearchResultsPage()) {
        pendingSrpRoots.clear();
        pendingSrpFullScan = false;
        return;
    }

    const cohortSig = computeCohortSyncSignature();
    if (force || cohortSig !== lastCohortSyncSig) {
        lastCohortSyncSig = cohortSig;
        syncCohortCacheFromSearchPage();
    }

    const fullScan = force || pendingSrpFullScan || !pendingSrpRoots.size;
    const roots = fullScan ? [document.body] : [...pendingSrpRoots];
    pendingSrpRoots.clear();
    pendingSrpFullScan = false;
    scanSrpPriceBadgesInRoots(roots);
}

export function resetSrpPageRefreshState() {
    clearTimeout(srpDebounceTimer);
    srpDebounceTimer = null;
    srpDebounceDeadline = 0;
    srpIdlePending = false;
    pendingSrpForce = false;
    pendingSrpFullScan = false;
    pendingSrpRoots.clear();
    lastCohortSyncSig = '';
}
