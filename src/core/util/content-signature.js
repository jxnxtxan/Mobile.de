/** Leichter String-Fingerprint (kein Krypto, nur Änderungserkennung). */
export function hashString(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
}

export function fingerprintActiveConfigs(configs) {
    if (!Array.isArray(configs) || !configs.length) return '0';
    const parts = [];
    for (const cfg of configs) {
        if (!cfg || cfg.aktiv === false) continue;
        parts.push((cfg.anzeige || cfg.begriff || '').trim().toLowerCase());
        if (Array.isArray(cfg.begriffe)) {
            parts.push(...cfg.begriffe.map(b => String(b || '').trim().toLowerCase()));
        }
    }
    parts.sort();
    return hashString(parts.join('\x1f'));
}

export function fingerprintMergeGroups(groups) {
    if (!Array.isArray(groups) || !groups.length) return '0';
    const parts = groups
        .filter(g => g && g.aktiv !== false)
        .map(g => {
            const order = Array.isArray(g.order) ? g.order.join(',') : '';
            return `${(g.basis || '').trim().toLowerCase()}\x1e${order}`;
        });
    parts.sort();
    return hashString(parts.join('\x1f'));
}
