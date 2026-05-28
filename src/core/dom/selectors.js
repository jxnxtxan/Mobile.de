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
