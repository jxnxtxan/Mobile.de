import { ergebnisHinzufuegen } from '../ui/results/render.js';
import {
    preisBewertungAktualisieren,
    scanSrpPriceBadges,
    syncCohortCacheFromSearchPage,
} from '../features/price-rating/index.js';
import { syncDebugLogCardsOnPage } from '../features/srp-sort/index.js';
import { isVehicleDetailPage } from '../core/page-context.js';
import { scheduleTask } from './scheduler.js';
import { verlinkeStandortAufGoogleMaps } from './maps-link.js';

export let observer = null;
export let triggerTimer = null;

export function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => trigger());
    observer.observe(document.body, { childList: true, subtree: true });
}

export function trigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(() => {
        if (hasActiveSelectionInsideResults()) return;
        scheduleTask('ui:results', 'ui', () => {
            ergebnisHinzufuegen();
            verlinkeStandortAufGoogleMaps();
            syncDebugLogCardsOnPage();
        });
        scheduleTask('network:cohort-sync', 'network', () => syncCohortCacheFromSearchPage());
        if (!isVehicleDetailPage()) {
            scheduleTask('rating:vip-refresh', 'rating', () => {
                preisBewertungAktualisieren();
            });
        }
        scheduleTask('rating:srp-scan', 'rating', () => scanSrpPriceBadges());
    }, 300);
}

export function hasActiveSelectionInsideResults() {
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
