export function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
        .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
        .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[–—\-]+/g, ' ')
        .replace(/[\n\r\t]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[,;:|()\[\]"']/g, ' ')
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
