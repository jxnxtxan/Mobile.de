export function isSearchResultsPage() {
    return /\/fahrzeuge\/search\.html/.test(location.pathname);
}

export function isVehicleDetailPage() {
    return /\/fahrzeuge\/details\.html/.test(location.pathname)
        || /\/auto-inserat\//.test(location.pathname);
}
