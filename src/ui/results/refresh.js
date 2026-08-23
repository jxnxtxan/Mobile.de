import { requestIdle } from '../../core/util/request-idle.js';
import { isVehicleDetailPage } from '../../core/page-context.js';
import { invalidateResultsCache } from './cache.js';
import { ergebnisHinzufuegen } from './render.js';

const RESULTS_DEBOUNCE_MS = 400;
const RESULTS_THROTTLE_MS = 900;

let resultsDebounceTimer = null;
let resultsThrottleAt = 0;
let resultsIdlePending = false;
let pendingResultsForce = false;

export function invalidateAndRefreshVehicleResults() {
    invalidateResultsCache();
    scheduleVehicleResultsRefresh(true);
}

export function scheduleVehicleResultsRefresh(force) {
    if (!isVehicleDetailPage()) return;
    if (force) pendingResultsForce = true;

    clearTimeout(resultsDebounceTimer);
    const delay = pendingResultsForce ? 0 : RESULTS_DEBOUNCE_MS;
    resultsDebounceTimer = setTimeout(() => {
        const now = Date.now();
        if (!pendingResultsForce && now - resultsThrottleAt < RESULTS_THROTTLE_MS) {
            scheduleVehicleResultsRefresh(false);
            return;
        }
        if (resultsIdlePending) {
            if (force) pendingResultsForce = true;
            return;
        }
        resultsIdlePending = true;
        requestIdle(() => {
            resultsIdlePending = false;
            resultsThrottleAt = Date.now();
            const runForce = pendingResultsForce;
            pendingResultsForce = false;
            ergebnisHinzufuegen(runForce);
        }, 320);
    }, delay);
}
