import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { getResultEntries, openLearnConfig } from '../../core/search/pipeline.js';
import { injectResultStyles } from '../styles/inject-result-styles.js';
import { technischeDatenHinzufuegen } from './tech.js';
import { runtimeState } from '../../config/runtime-state.js';
import { isAutoModeEnabled } from '../../config/ordering.js';

export function appendResultRow(columns, item, autoMode) {
    const el = document.createElement('div');
    el.className = 'mobilede-result-row';
    const isLow = item.confidence === 'low';
    const isHighlight = autoMode ? item.highlighted !== false : true;

    const span = document.createElement('span');
    span.className = 'mobilede-result-hit';
    const inactiveSuffix = item.configInactive ? ' (inaktiv)' : '';
    span.textContent = `- ${item.anzeige}${inactiveSuffix}${isLow ? ' *' : ''}`;
    span.style.color = item.farbe || '#66ff66';
    if (isHighlight) span.classList.add('mobilede-result-hit--help');

    if (item.configInactive) {
        span.style.fontStyle = 'italic';
        span.style.opacity = '0.75';
    }

    if (autoMode && !isHighlight) {
        span.title = `Quelle: ${item.source || 'unbekannt'}`;
        span.style.opacity = '0.92';
    } else {
        const sourceLabel = isLow
            ? `Nur in Beschreibung gefunden (Quelle: ${item.source})`
            : `Quelle: ${item.source}`;
        const inactiveNote = item.configInactive
            ? '\nIn deiner Konfiguration, aber deaktiviert – aktivieren zum Highlighten per Suchbegriff.'
            : '';
        const trigger = item.begriff ? `\nTrigger: "${item.begriff}"` : '';
        const snippet = item.snippet ? `\nKontext: …${item.snippet}…` : '';
        span.title = sourceLabel + inactiveNote + trigger + snippet;
        if (isLow) {
            span.style.fontStyle = 'italic';
            span.style.opacity = '0.85';
        }
    }
    el.appendChild(span);

    if (autoMode && item.learnable && !isHighlight) {
        const learnBtn = document.createElement('button');
        learnBtn.type = 'button';
        learnBtn.className = 'mobilede-learn-btn';
        learnBtn.textContent = '+ Konfig';
        learnBtn.title = 'Neuen Eintrag in der Konfiguration anlegen';
        learnBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            openLearnConfig(item.rawLabel || item.anzeige, item.source);
        });
        el.appendChild(learnBtn);
    }

    columns.appendChild(el);
}

export function ergebnisHinzufuegen() {
    document.querySelectorAll('.mobilede-result-article, .mobilede-tech-article').forEach(el => el.remove());
    const zielBereich = document.querySelector("article[data-testid='vip-key-features-box']");
    if (!zielBereich) return;

    injectResultStyles();
    const autoMode = isAutoModeEnabled();
    const gefundeneTexte = getResultEntries();

    const article = document.createElement('article');
    article.className = 'A3G6X lAeeF vTKPY HaBLt ku0Os mobilede-result-article';
    const ergebnisBereich = document.createElement('div');
    ergebnisBereich.id = 'ergebnisBereich';
    ergebnisBereich.className = 'mobilede-result-card';
    article.appendChild(ergebnisBereich);

    const title = document.createElement('div');
    title.className = 'mobilede-section-title';
    title.textContent = autoMode ? 'Ausstattung (vollständig):' : 'Gefundene Begriffe:';
    ergebnisBereich.appendChild(title);

    if (gefundeneTexte.length > 0) {
        const favKeys = getFavoriteAnzeigeKeys(runtimeState.suchKonfigurationen);
        const favCount = gefundeneTexte.filter(i =>
            favKeys.has((i.anzeige || '').trim().toLowerCase())).length;
        const columns = document.createElement('div');
        columns.className = 'mobilede-result-grid';

        gefundeneTexte.forEach((item, index) => {
            if (index === 0 && favCount > 0) {
                const favTitle = document.createElement('div');
                favTitle.className = 'mobilede-subsection-title';
                favTitle.textContent = 'Favoriten';
                columns.appendChild(favTitle);
            }
            if (favCount > 0 && favCount < gefundeneTexte.length && index === favCount) {
                const divider = document.createElement('div');
                divider.className = 'mobilede-result-fav-divider';
                divider.setAttribute('aria-hidden', 'true');
                columns.appendChild(divider);
            }
            appendResultRow(columns, item, autoMode);
        });
        ergebnisBereich.appendChild(columns);

        const legendParts = [];
        if (autoMode) {
            legendParts.push('Grau = nur auf der Seite gefunden · Farbig = in deiner Konfiguration erkannt · (inaktiv) = Eintrag vorhanden, aber deaktiviert');
        }
        const hasLow = gefundeneTexte.some(i => i.confidence === 'low');
        if (hasLow) {
            legendParts.push('* = nur in Beschreibungstext gefunden (geringere Sicherheit)');
        }
        if (legendParts.length > 0) {
            const legend = document.createElement('div');
            legend.className = 'mobilede-result-legend';
            legend.textContent = legendParts.join(' · ');
            ergebnisBereich.appendChild(legend);
        }
    } else {
        const keine = document.createElement('div');
        keine.className = 'mobilede-result-empty';
        keine.textContent = autoMode
            ? 'Keine Ausstattungseinträge auf der Seite gefunden.'
            : 'Keine der gesuchten Begriffe gefunden.';
        ergebnisBereich.appendChild(keine);
    }

    zielBereich.parentNode.insertBefore(article, zielBereich.nextSibling);
    technischeDatenHinzufuegen(article);
}

export function clearResults() {
    document.querySelectorAll('.mobilede-result-article, .mobilede-tech-article').forEach(el => el.remove());
}

// ============================================================
