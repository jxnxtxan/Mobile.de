import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const USERSCRIPT_VERSION = '2.16.55';
const RAW_BASE =
  'https://raw.githubusercontent.com/jxnxtxan/Mobile.de/main/mobile-ausstattungssuche.js';

export default defineConfig({
  define: {
    __USERSCRIPT_VERSION__: JSON.stringify(USERSCRIPT_VERSION),
  },
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'Mobile.de Ausstattungssuche mit modernem Popup & Import/Export (Generalisiertes Merging mit Merge-Konfiguration)',
        namespace: 'https://github.com/jxnxtxan/Mobile.de',
        version: USERSCRIPT_VERSION,
        author: 'jxnxtxan',
        description: {
          '': 'Sucht bestimmte Ausstattungen & Technische Daten auf mobile.de. Preisbewertung mit Ausstattungs-Korrektur (VIP + SRP). Token-basierte Match-Engine, SPA-Robustheit, Konfig-Popup mit Filter, Drag&Drop, Reset, Backup und Schema-Versionierung.',
          en: 'Highlights chosen equipment and technical data on mobile.de listings and rates used-car prices adjusted for equipment (detail and search result pages). Config popup with import/export.',
        },
        license: 'MIT',
        homepageURL: 'https://github.com/jxnxtxan/Mobile.de',
        supportURL: 'https://github.com/jxnxtxan/Mobile.de/issues',
        updateURL: RAW_BASE,
        downloadURL: RAW_BASE,
        icon: 'https://www.google.com/s2/favicons?sz=64&domain=mobile.de',
        match: [
          'http://suchen.mobile.de/fahrzeuge/details.html*',
          'https://suchen.mobile.de/fahrzeuge/details.html*',
          'http://suchen.mobile.de/auto-inserat/*',
          'https://suchen.mobile.de/auto-inserat/*',
          'http://suchen.mobile.de/fahrzeuge/search.html*',
          'https://suchen.mobile.de/fahrzeuge/search.html*',
        ],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
          'unsafeWindow',
        ],
        'run-at': 'document-idle',
        noframes: true,
      },
      build: {
        fileName: 'mobile-ausstattungssuche.user.js',
        autoGrant: true,
      },
    }),
  ],
  build: {
    minify: false,
    emptyOutDir: true,
  },
});
