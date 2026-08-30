/**
 * Der CamelCase-Split muss VOR der Umlaut-Ersetzung laufen: sonst trennt er
 * im künstlich erzeugten „Ae“/„Oe“/„Ue“ und zerlegt großgeschriebene Wörter
 * („ANHÄNGERKUPPLUNG“ -> „anhae ngerkupplung“), die dann nie einen
 * Konfig-Begriff treffen. NFC davor, damit dekomponierte Umlaute
 * (a + U+0308) von den Ersetzungen erfasst werden.
 */
export function cleanText(text) {
    if (!text) return '';
    return String(text)
        .normalize('NFC')
        .replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
        .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
        .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
        .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[–—\-]+/g, ' ')
        .replace(/[\n\r\t]+/g, ' ')
        .replace(/[,;:|()\[\]"'\/+]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .toLowerCase();
}

export function tokenize(text) {
    const cleaned = cleanText(text);
    if (!cleaned) return [];
    return cleaned.split(/\s+/).filter(Boolean);
}

export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
