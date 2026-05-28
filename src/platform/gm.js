/** Tampermonkey-Speicher-APIs (Globals, nicht bundeln). */
export function gmGetValue(key, defaultValue) {
    return GM_getValue(key, defaultValue);
}

export function gmSetValue(key, value) {
    GM_setValue(key, value);
}

export function gmRegisterMenuCommand(caption, onClick) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
        GM_registerMenuCommand(caption, onClick);
    } catch (e) { /* ignore */ }
}
