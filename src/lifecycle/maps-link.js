import { runtimeState } from '../config/runtime-state.js';

export function verlinkeStandortAufGoogleMaps() {
    const enabled = !!(runtimeState.featureFlags && runtimeState.featureFlags.mapsLink !== false);
    const re = /^[A-Z]{2}-\d{4,5}\s+\S.*$/;
    const candidates = document.querySelectorAll('div, span, p, address');
    const matched = [];
    for (const el of candidates) {
        if (!el || !el.dataset) continue;
        if (el.children && el.children.length > 0) continue;
        const txt = (el.textContent || '').trim();
        if (txt.length < 6 || txt.length > 80) continue;
        if (!re.test(txt)) continue;
        if (el.closest && el.closest('#mobilede-config-popup')) continue;
        matched.push({ el, txt });
    }

    if (!enabled) {
        matched.forEach(({ el }) => {
            if (el.dataset.mobiledeStandort !== '1') return;
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
        });
        return;
    }

    matched.forEach(({ el, txt }) => {
        el.style.cursor = 'pointer';
        el.style.textDecoration = 'underline';
        el.style.textDecorationStyle = 'dotted';
        el.style.textUnderlineOffset = '3px';
        el.title = 'In Google Maps öffnen: ' + txt;
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');

        const existing = el._mobileDeMapsCtl;
        if (el.dataset.mobiledeStandort === '1' && existing && !existing.signal.aborted) {
            return;
        }
        if (existing && typeof existing.abort === 'function') {
            try { existing.abort(); } catch (_) { /* noop */ }
        }

        el.dataset.mobiledeStandort = '1';
        const ac = new AbortController();
        el._mobileDeMapsCtl = ac;
        const opts = { signal: ac.signal };
        el.addEventListener('mouseenter', () => {
            if (!runtimeState.featureFlags || runtimeState.featureFlags.mapsLink === false) return;
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
                if (!runtimeState.featureFlags || runtimeState.featureFlags.mapsLink === false) return;
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                open();
            },
            { capture: true, signal: ac.signal }
        );
        el.addEventListener('keydown', e => {
            if (!runtimeState.featureFlags || runtimeState.featureFlags.mapsLink === false) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        }, opts);
    });
}

