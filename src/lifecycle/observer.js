import { preisBewertungAktualisieren } from '../features/price-rating/index.js';
import { syncDebugLogCardsOnPage } from '../features/srp-sort/index.js';
import { isSearchResultsPage, isVehicleDetailPage } from '../core/page-context.js';
import { ensureConfigButton } from '../core/search/popup-bridge.js';
import { scheduleTask } from './scheduler.js';
import { collectRelevantAddedRoots, mutationAffectsPageContent } from './results-mutations.js';
import { scheduleSrpPageRefresh } from './srp-refresh.js';
import { scheduleVehicleResultsRefresh } from '../ui/results/refresh.js';

export let observer = null;
export let triggerTimer = null;

export function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(mutations => {
        if (!mutations.some(mutationAffectsPageContent)) return;
        const srpRoots = isSearchResultsPage() ? collectRelevantAddedRoots(mutations) : [];
        trigger(false, srpRoots);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function trigger(immediate, srpRoots) {
    clearTimeout(triggerTimer);
    const run = () => {
        if (hasActiveSelectionInsideResults()) return;
        if (isVehicleDetailPage()) {
            scheduleVehicleResultsRefresh(!!immediate);
            scheduleTask('rating:vip-refresh', 'rating', () => {
                preisBewertungAktualisieren();
            });
        }
        if (isSearchResultsPage()) {
            for (const root of srpRoots || []) scheduleSrpPageRefresh(false, root);
            scheduleSrpPageRefresh(!!immediate);
        }
        scheduleTask('ui:page-chrome', 'ui', () => {
            syncDebugLogCardsOnPage();
            ensureConfigButton();
        });
    };
    if (immediate) run();
    else triggerTimer = setTimeout(() => run(), 300);
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
