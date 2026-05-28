export function requestIdle(fn, timeoutMs) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(fn, { timeout: timeoutMs || 350 });
    }
    return setTimeout(fn, Math.min(timeoutMs || 350, 220));
}
