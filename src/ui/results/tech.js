import { debugLog } from '../../config/feature-flags/index.js';
import { isManualScope, shouldApplyOrderToVehicleResults } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import { getTechDataDl } from '../../core/dom/selectors.js';
import { injectResultStyles } from '../styles/inject-result-styles.js';

export function sucheTechnischeDaten() {
    const techDataBereich = getTechDataDl();
    if (!techDataBereich) return [];
    const dtElements = techDataBereich.querySelectorAll('dt');
    const daten = [];
    const useManualOrder = isManualScope('tech') && shouldApplyOrderToVehicleResults();
    const configs = useManualOrder
        ? runtimeState.techDataKonfigurationen
        : [...techDataKonfigurationen].sort((a, b) =>
            (a.begriff || '').trim().localeCompare((b.begriff || '').trim(), 'de'));
    configs.forEach(cfg => {
        if (!cfg.aktiv) return;
        for (const dt of dtElements) {
            if (dt.textContent.trim().toLowerCase() === cfg.begriff.toLowerCase()) {
                const dd = dt.nextElementSibling;
                if (dd && dd.tagName.toLowerCase() === 'dd') {
                    daten.push({ title: cfg.begriff, value: dd.textContent.trim() });
                }
                break;
            }
        }
    });
    return daten;
}

export function technischeDatenHinzufuegen(parentElement) {
    const technischeDaten = sucheTechnischeDaten();
    if (technischeDaten.length === 0) {
        debugLog('tech', 'Keine konfigurierten technischen Daten gefunden');
        return;
    }
    debugLog('tech', 'Technische Daten gerendert', { count: technischeDaten.length });
    injectResultStyles();
    const techArticle = document.createElement('article');
    techArticle.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-tech-article';
    const techContainer = document.createElement('div');
    techContainer.className = 'mobilede-tech-card';
    const title = document.createElement('div');
    title.className = 'mobilede-section-title';
    title.textContent = 'Technische Daten:';
    techContainer.appendChild(title);
    const list = document.createElement('div');
    list.className = 'mobilede-tech-list';
    technischeDaten.forEach(d => {
        const row = document.createElement('div');
        row.className = 'mobilede-tech-row';
        const label = document.createElement('div');
        label.className = 'mobilede-tech-label';
        label.textContent = d.title + ':';
        const value = document.createElement('div');
        value.className = 'mobilede-tech-value';
        value.textContent = d.value;
        row.appendChild(label);
        row.appendChild(value);
        list.appendChild(row);
    });
    techContainer.appendChild(list);
    techArticle.appendChild(techContainer);
    parentElement.parentNode.insertBefore(techArticle, parentElement);
}

// ============================================================
