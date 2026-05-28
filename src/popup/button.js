'use strict';

import { PAGE_UI_Z_INDEX } from '../config/constants.js';
import { oeffneKonfigPopup } from './open.js';

export function erstelleKonfigButton() {
    if (document.querySelector('#mobilede-config-btn')) return;
    // Verwaiste Wrapper aus altem Render entfernen, damit kein doppelter
    // Wrapper ohne Button stehen bleibt (z.B. nach SPA-Re-Render).
    const orphanWrap = document.querySelector('#mobilede-config-btn-wrap');
    if (orphanWrap && !orphanWrap.querySelector('#mobilede-config-btn')) orphanWrap.remove();
    const targetDiv = document.querySelector('.Va7Gr')
        || document.querySelector("article[data-testid='vip-key-features-box']");
    if (!targetDiv) return;

    // Wrapper sorgt dafür, dass der Button in jedem Parent-Layout
    // (flex row/column, grid) als eigene Zeile in voller Breite sitzt.
    const wrap = document.createElement('div');
    wrap.id = 'mobilede-config-btn-wrap';
    Object.assign(wrap.style, {
        position: 'relative',
        zIndex: String(PAGE_UI_Z_INDEX),
        display: 'block',
        width: '100%',
        flex: '1 1 100%',
        flexBasis: '100%',
        gridColumn: '1 / -1',
        marginTop: '8px',
        boxSizing: 'border-box'
    });

    const button = document.createElement('button');
    button.id = 'mobilede-config-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Ausstattungssuche konfigurieren');
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px;margin-right:6px"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg><span>Konfiguration</span>';
    Object.assign(button.style, {
        cursor: 'pointer',
        padding: '11px 14px',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: '8px',
        background: 'linear-gradient(180deg,#3a3d46,#2e3138)',
        color: '#f0f1f3',
        fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        transition: 'filter .15s, box-shadow .15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        boxSizing: 'border-box'
    });
    button.addEventListener('mouseenter', () => {
        button.style.filter = 'brightness(1.08)';
        button.style.boxShadow = '0 4px 14px rgba(0,0,0,.35)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.filter = '';
        button.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
    });
    button.addEventListener('click', oeffneKonfigPopup);
    wrap.appendChild(button);
    targetDiv.appendChild(wrap);
}
