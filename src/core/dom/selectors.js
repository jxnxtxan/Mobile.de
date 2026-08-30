/**
 * mobile.de rendert Desktop-, Mobil- und Sticky-Varianten derselben Box
 * parallel ins DOM und blendet alle bis auf eine aus. `querySelector` trifft
 * dabei oft die unsichtbare Kopie — deshalb wird hier nach Layout gefiltert.
 */
export function queryVisible(selector, root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
    }
    return null;
}

/**
 * Karten-Optik für eigene Blöcke. mobile.de vergibt seinen Inhaltskarten
 * obfuskierte Hash-Klassen, die sich mit jedem Deploy ändern; früher waren
 * sie hier fest verdrahtet und die Blöcke verloren beim Umbau ihren Rahmen.
 * Jetzt werden sie von einer echten Karte übernommen, mit eigener Notoptik.
 */
export function getCardShellClassName() {
    const ref = queryVisible("article[data-testid='vip-technical-data-box']")
        || queryVisible("article[data-testid='vip-key-features-box']");
    const cls = ref ? String(ref.className || '').trim() : '';
    return cls || 'mobilede-card-shell';
}

export function getFeatureItems() {
    return Array.from(document.querySelectorAll("ul[data-testid='vip-features-list'] li"));
}
export function getDescriptionEl() {
    return document.querySelector("div[data-testid='vip-vehicle-description-text']");
}
export function getTechDataDl() {
    return document.querySelector("article[data-testid='vip-technical-data-box'] dl");
}
/**
 * Heuristik-Fallback für den ehemaligen ".GOIOV fqe3L EevEz"-Block:
 * sucht ein Geschwister-Element zur Beschreibung, das zusätzliche
 * Texte enthält (Verkäufer-Hinweise etc.). Bei Layout-Änderung
 * von mobile.de bleibt das Skript funktional.
 */
export function getZusatzEl() {
    const desc = getDescriptionEl();
    if (!desc) return null;
    const candidate = desc.parentElement && desc.parentElement.nextElementSibling;
    if (candidate && candidate.textContent && candidate.textContent.trim().length > 20) {
        return candidate;
    }
    return null;
}

/**
 * Heuristik: erkennt einen Beschreibungs-Block, der in Wahrheit eine
 * Komma-getrennte Feature-Liste ist (typischer mobile.de-Block). Wenn
 * ja, wird der Block als 'high' confidence eingestuft, sodass auch
 * Einträge mit nurInFeatures: true ihn berücksichtigen.
 */
