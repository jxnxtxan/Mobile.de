import { requestIdle } from '../../core/util/request-idle.js';
import { isVehicleDetailPage } from '../../core/page-context.js';
import { invalidateResultsCache } from './cache.js';
import { ergebnisHinzufuegen } from './render.js';

const RESULTS_DEBOUNCE_MS = 400;
const RESULTS_MAX_WAIT_MS = 1500;
const RESULTS_THROTTLE_MS = 900;

let resultsDebounceTimer = null;
let resultsDebounceDeadline = 0;
let resultsThrottleAt = 0;
let resultsIdlePending = false;
let pendingResultsForce = false;
let pendingResultsRefresh = false;

export function invalidateAndRefreshVehicleResults() {
    invalidateResultsCache();
    scheduleVehicleResultsRefresh(true);
}

/**
 * Debounce mit Obergrenze: die VIP-Seite mutiert durch Lazy-Loading und
 * Tracking laufend, ein reiner Debounce würde den Render endlos verschieben.
 */
function armResultsTimer() {
    const now = Date.now();
    if (!resultsDebounceDeadline) resultsDebounceDeadline = now + RESULTS_MAX_WAIT_MS;
    clearTimeout(resultsDebounceTimer);
    const delay = pendingResultsForce
        ? 0
        : Math.max(0, Math.min(RESULTS_DEBOUNCE_MS, resultsDebounceDeadline - now));
    resultsDebounceTimer = setTimeout(onResultsTimer, delay);
}

function onResultsTimer() {
    resultsDebounceTimer = null;
    resultsDebounceDeadline = 0;
    if (resultsIdlePending) {
        if (pendingResultsRefresh) armResultsTimer();
        return;
    }
    if (!pendingResultsForce && Date.now() - resultsThrottleAt < RESULTS_THROTTLE_MS) {
        armResultsTimer();
        return;
    }
    resultsIdlePending = true;
    requestIdle(() => {
        resultsIdlePending = false;
        resultsThrottleAt = Date.now();
        const runForce = pendingResultsForce;
        pendingResultsForce = false;
        pendingResultsRefresh = false;
        ergebnisHinzufuegen(runForce);
    }, 320);
}

export function scheduleVehicleResultsRefresh(force) {
    if (!isVehicleDetailPage()) return;
    if (force) pendingResultsForce = true;
    pendingResultsRefresh = true;
    armResultsTimer();
}

export function resetVehicleResultsRefreshState() {
    clearTimeout(resultsDebounceTimer);
    resultsDebounceTimer = null;
    resultsDebounceDeadline = 0;
    resultsIdlePending = false;
    pendingResultsForce = false;
    pendingResultsRefresh = false;
}
