import { pricePerfMarkEnd, pricePerfMarkStart } from '../features/price-rating/index.js';

export const scheduledJobs = new Map();
export let schedulerTickPending = false;
export const taskPriority = { ui: 0, network: 1, rating: 2 };

export function requestIdle(fn, timeoutMs) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(fn, { timeout: timeoutMs || 350 });
    }
    return setTimeout(fn, Math.min(timeoutMs || 350, 220));
}

export function scheduleTask(key, type, job) {
    if (!key || typeof job !== 'function') return;
    const existing = scheduledJobs.get(key);
    if (existing && existing.type === type) return;
    scheduledJobs.set(key, { type: type || 'ui', job });
    if (schedulerTickPending) return;
    schedulerTickPending = true;
    requestIdle(runScheduledTasks, 220);
}

export function runScheduledTasks() {
    schedulerTickPending = false;
    if (!scheduledJobs.size) return;
    const popupOpen = isConfigPopupOpen();
    const items = [...scheduledJobs.entries()]
        .sort((a, b) => (taskPriority[a[1].type] ?? 99) - (taskPriority[b[1].type] ?? 99));
    scheduledJobs.clear();
    let deferredCount = 0;
    items.forEach(([key, task]) => {
        if (popupOpen && task.type !== 'ui') {
            scheduledJobs.set(key, task);
            deferredCount++;
            return;
        }
        const t0 = pricePerfMarkStart();
        try {
            task.job();
        } catch (e) {
            console.error(e);
        }
        pricePerfMarkEnd('task:' + task.type, t0, 16);
    });
    if (deferredCount > 0 && !schedulerTickPending) {
        schedulerTickPending = true;
        requestIdle(runScheduledTasks, 400);
    }
}

export function isConfigPopupOpen() {
    const overlay = document.querySelector('#mobilede-config-overlay');
    return !!(overlay && overlay.querySelector('.mc-popup'));
}
