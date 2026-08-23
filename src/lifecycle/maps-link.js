import { runtimeState } from '../config/runtime-state.js';
import { requestIdle } from '../core/util/request-idle.js';

const STANDORT_RE = /^[A-Z]{2}-\d{4,5}\s+\S.*$/;
const EXCLUDE_SELECTOR =
    '#mobilede-config-popup, #mobilede-config-overlay, .mobilede-result-article, .mobilede-tech-article, #mobilede-srp-debug-card';
const MAPS_SCAN_DEBOUNCE_MS = 400;

let mapsMo = null;
let mapsDebounceTimer = null;
let mapsIdlePending = false;
const pendingScanRoots = new Set();

function isMapsEnabled() {
    return !!(runtimeState.featureFlags && runtimeState.featureFlags.mapsLink !== false);
}

function isExcluded(el) {
    return !!(el && el.closest && el.closest(EXCLUDE_SELECTOR));
}

export function removeAllMapsLinks() {
    document.querySelectorAll('[data-mobilede-standort="1"]').forEach(unlinkStandortElement);
}

function unlinkStandortElement(el) {
    const ctl = el._mobileDeMapsCtl;
    if (ctl && typeof ctl.abort === 'function') {
        try { ctl.abort(); } catch (_) { /* noop */ }
    }
    el._mobileDeMapsCtl = null;
    el.style.cursor = '';
    el.style.textDecoration = '';
    el.style.textDecorationStyle = '';
    el.style.textUnderlineOffset = '';
    el.style.opacity = '';
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('title');
    delete el.dataset.mobiledeStandort;
}

function linkStandortElement(el, txt) {
    el.style.cursor = 'pointer';
    el.style.textDecoration = 'underline';
    el.style.textDecorationStyle = 'dotted';
    el.style.textUnderlineOffset = '3px';
    el.title = 'In Google Maps öffnen: ' + txt;
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '0');

    const existing = el._mobileDeMapsCtl;
    if (el.dataset.mobiledeStandort === '1' && existing && !existing.signal.aborted) return;

    if (existing && typeof existing.abort === 'function') {
        try { existing.abort(); } catch (_) { /* noop */ }
    }

    el.dataset.mobiledeStandort = '1';
    const ac = new AbortController();
    el._mobileDeMapsCtl = ac;
    const opts = { signal: ac.signal };
    el.addEventListener('mouseenter', () => {
        if (!isMapsEnabled()) return;
        el.style.textDecorationStyle = 'solid';
        el.style.opacity = '0.85';
    }, opts);
    el.addEventListener('mouseleave', () => {
        el.style.textDecorationStyle = 'dotted';
        el.style.opacity = '';
    }, opts);
    const open = () => {
        const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(txt);
        window.open(url, '_blank', 'noopener,noreferrer');
    };
    el.addEventListener(
        'click',
        e => {
            if (!isMapsEnabled()) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            open();
        },
        { capture: true, signal: ac.signal }
    );
    el.addEventListener('keydown', e => {
        if (!isMapsEnabled()) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    }, opts);
}

function scanStandortInRoot(root) {
    if (!root || root.nodeType !== 1 || !isMapsEnabled()) return;
    if (isExcluded(root)) return;

    const nodes = root === document.body
        ? root.querySelectorAll('div, span, p, address')
        : collectElementsUnderRoot(root);

    for (const el of nodes) {
        if (!el || !el.dataset) continue;
        if (el.children && el.children.length > 0) continue;
        if (isExcluded(el)) continue;
        if (el.dataset.mobiledeStandort === '1') continue;
        const txt = (el.textContent || '').trim();
        if (txt.length < 6 || txt.length > 80) continue;
        if (!STANDORT_RE.test(txt)) continue;
        linkStandortElement(el, txt);
    }
}

function collectElementsUnderRoot(root) {
    const out = [];
    if (matchesStandortCandidate(root)) out.push(root);
    root.querySelectorAll('div, span, p, address').forEach(el => out.push(el));
    return out;
}

function matchesStandortCandidate(el) {
    return el && (el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'P' || el.tagName === 'ADDRESS');
}

function enqueueMapsScanRoot(node) {
    if (!node || node.nodeType !== 1 || isExcluded(node)) return;
    pendingScanRoots.add(node);
}

function flushPendingScans() {
    mapsIdlePending = false;
    if (!isMapsEnabled() || !pendingScanRoots.size) return;
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    for (const root of roots) scanStandortInRoot(root);
}

function scheduleIncrementalScan() {
    if (!isMapsEnabled()) return;
    clearTimeout(mapsDebounceTimer);
    mapsDebounceTimer = setTimeout(() => {
        if (mapsIdlePending) return;
        mapsIdlePending = true;
        requestIdle(flushPendingScans, 350);
    }, MAPS_SCAN_DEBOUNCE_MS);
}

function onMapsDomMutation(mutations) {
    if (!isMapsEnabled()) return;
    for (const m of mutations) {
        if (m.type === 'characterData') {
            const parent = m.target.parentElement;
            if (parent) enqueueMapsScanRoot(parent.closest('main, article') || parent);
            continue;
        }
        for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            enqueueMapsScanRoot(node);
        }
    }
    if (pendingScanRoots.size) scheduleIncrementalScan();
}

function stopMapsLinkObserver() {
    if (mapsMo) {
        mapsMo.disconnect();
        mapsMo = null;
    }
    clearTimeout(mapsDebounceTimer);
    mapsDebounceTimer = null;
    mapsIdlePending = false;
    pendingScanRoots.clear();
}

function startMapsLinkObserver() {
    stopMapsLinkObserver();
    mapsMo = new MutationObserver(onMapsDomMutation);
    mapsMo.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** Vollständiger Erst-Scan wie zuvor — danach inkrementell bei DOM-/Textänderungen. */
export function verlinkeStandortAufGoogleMaps() {
    if (!isMapsEnabled()) {
        removeAllMapsLinks();
        return;
    }
    scanStandortInRoot(document.body);
}

export function refreshMapsLinkBehavior() {
    stopMapsLinkObserver();
    if (!isMapsEnabled()) {
        removeAllMapsLinks();
        return;
    }
    startMapsLinkObserver();
    requestIdle(() => verlinkeStandortAufGoogleMaps(), 200);
}
