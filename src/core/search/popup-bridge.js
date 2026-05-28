let configPopupOpener = null;
let configButtonCreator = null;

export function registerConfigPopupOpener(fn) {
    configPopupOpener = fn;
}

export function openConfigPopup() {
    if (typeof configPopupOpener === 'function') configPopupOpener();
}

export function registerConfigButtonCreator(fn) {
    configButtonCreator = fn;
}

export function ensureConfigButton() {
    if (!document.querySelector('#mobilede-config-btn') && typeof configButtonCreator === 'function') {
        configButtonCreator();
    }
}
