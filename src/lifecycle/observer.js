import { preisBewertungAktualisieren } from '../features/price-rating/index.js';
import { syncDebugLogCardsOnPage } from '../features/srp-sort/index.js';
import { isSearchResultsPage, isVehicleDetailPage } from '../core/page-context.js';
import { ensureConfigButton } from '../core/search/popup-bridge.js';
import { scheduleTask } from './scheduler.js';
import { collectRelevantAddedRoots, mutationAffectsPageContent } from './results-mutations.js';
import { scheduleSrpPageRefresh } from './srp-refresh.js';
import { scheduleVehicleResultsRefresh } from '../ui/results/refresh.js';

const TRIGGER_DEBOUNCE_MS = 300;
const TRIGGER_MAX_WAIT_MS = 1200;

export let observer = null;
export let triggerTimer = null;

let triggerDeadline = 0;
/**
 * Modul-global, nicht in der Closure des Timers: `trigger` verwirft bei jedem
 * Aufruf den laufenden Timeout. Lägen die Roots in der Closure, gingen bei
 * dichter Mutationsfolge ganze Batches verloren und die zugehörigen
 * SRP-Karten bekämen nie ein Preis-Badge.
 */
const pendingSrpRootQueue = new Set();

export function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(mutations => {
        if (!mutations.some(mutationAffectsPageContent)) return;
        if (isSearchResultsPage()) {
            for (const root of collectRelevantAddedRoots(mutations)) pendingSrpRootQueue.add(root);
        }
        trigger(false);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function trigger(immediate, srpRoots) {
    if (srpRoots) {
        for (const root of srpRoots) pendingSrpRootQueue.add(root);
    }
    if (immediate) {
        clearTimeout(triggerTimer);
        triggerTimer = null;
        triggerDeadline = 0;
        runTrigger(true);
        return;
    }
    const now = Date.now();
    if (!triggerDeadline) triggerDeadline = now + TRIGGER_MAX_WAIT_MS;
    clearTimeout(triggerTimer);
    const delay = Math.max(0, Math.min(TRIGGER_DEBOUNCE_MS, triggerDeadline - now));
    triggerTimer = setTimeout(() => runTrigger(false), delay);
}

function runTrigger(immediate) {
    triggerTimer = null;
    triggerDeadline = 0;

    if (isVehicleDetailPage()) {
        // Eine aktive Textauswahl im Ergebnisblock nicht durch Re-Render zerstören.
        if (!hasActiveSelectionInsideResults()) {
            scheduleVehicleResultsRefresh(immediate);
            scheduleTask('rating:vip-refresh', 'rating', () => {
                preisBewertungAktualisieren();
            });
        }
    }

    if (isSearchResultsPage()) {
        const roots = pendingSrpRootQueue.size ? [...pendingSrpRootQueue] : null;
        pendingSrpRootQueue.clear();
        scheduleSrpPageRefresh({ force: immediate, fullScan: immediate, roots });
    } else {
        pendingSrpRootQueue.clear();
    }

    scheduleTask('ui:page-chrome', 'ui', () => {
        syncDebugLogCardsOnPage();
        ensureConfigButton();
    });
}

export function resetTriggerState() {
    clearTimeout(triggerTimer);
    triggerTimer = null;
    triggerDeadline = 0;
    pendingSrpRootQueue.clear();
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
