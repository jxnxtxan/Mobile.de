export function getFavoriteAnzeigeKeys(config) {
    const keys = new Set();
    if (!Array.isArray(config)) return keys;
    config.forEach(item => {
        if (item && item.favorit === true && item.anzeige) {
            keys.add(String(item.anzeige).trim().toLowerCase());
        }
    });
    return keys;
}

export function partitionEntriesByFavorites(entries, favoriteKeys) {
    if (!favoriteKeys || favoriteKeys.size === 0) return entries;
    const fav = [];
    const rest = [];
    entries.forEach(e => {
        const key = (e.anzeige || '').trim().toLowerCase();
        if (favoriteKeys.has(key)) fav.push(e);
        else rest.push(e);
    });
    return fav.concat(rest);
}
