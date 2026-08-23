/** Verdrahtung des Userscripts: Konfiguration laden, Lifecycle starten, Popup registrieren. */
import { bootstrapConfig } from './config/bootstrap.js';
import { gmRegisterMenuCommand } from './platform/gm.js';
import { registerConfigPopupOpener, registerConfigButtonCreator } from './core/search/popup-bridge.js';
import { initApp } from './lifecycle/init.js';
import { oeffneKonfigPopup } from './popup/open.js';
import { erstelleKonfigButton } from './popup/button.js';

bootstrapConfig();
initApp();

setTimeout(erstelleKonfigButton, 3000);
registerConfigPopupOpener(oeffneKonfigPopup);
registerConfigButtonCreator(erstelleKonfigButton);
gmRegisterMenuCommand('Mobile.de Ausstattungssuche – Konfiguration', oeffneKonfigPopup);
