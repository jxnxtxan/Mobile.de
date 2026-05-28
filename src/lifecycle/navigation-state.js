/** SPA-Navigation: letzte URL, damit programmatische Sort-Redirects nicht als Nutzer-Navigation zählen. */
export let lastUrl = location.href;

export function syncLastUrl(href) {
    lastUrl = href || location.href;
}
