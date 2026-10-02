## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Versionierung

- Nach jeder Änderung am Skript-Code immer zuerst die Versionsnummer hochzählen, dann bauen: in `package.json` (`version`) UND in `vite.config.js` (`USERSCRIPT_VERSION`) — beide müssen übereinstimmen. Kein Ausnahmefall, auch nicht bei kleinen Fixes.
- Danach `npm run build` laufen lassen, damit die neue Version in `mobile-ausstattungssuche.js` landet (die Datei wird von `scripts/postbuild-copy.js` aus `dist/mobile-ausstattungssuche.user.js` kopiert). Der Nutzer spielt diese Datei selbst in Tampermonkey ein und braucht dafür immer den aktuellen, versionierten Build.
- Reine Doku-/Meta-Änderungen ohne jede Änderung am Skript-Code (z. B. README, graphify-Ausschluss) brauchen keinen Versions-Bump und kein Build.

## Testen

- Soll etwas getestet oder live nachvollzogen werden (DOM-Struktur, Layout-Bug, ob ein Fix wirklich greift), das im echten Chrome-Browser des Nutzers tun (`claude-in-chrome`-Tools), nicht im eingebauten Browser-Pane. Der Nutzer testet das Tampermonkey-Skript in seinem echten Chrome, und Selektoren/Layout von mobile.de sind dort am verlässlichsten zu prüfen.
- Node-Tests (`npm test`) bleiben für reine Parsing-/Logik-Funktionen zuständig, die ohne echtes DOM auskommen (kein jsdom im Projekt). Für alles, was echtes DOM/CSS/Layout auf mobile.de braucht, den Chrome-Browser nutzen.

## Releases

- Releases legt die GitHub Action `.github/workflows/release.yml` automatisch an, sobald eine neue Version aus `package.json` auf `main` gepusht wird (Tag `vX.Y.Z`, Release mit `mobile-ausstattungssuche.user.js`, Notizen aus den Commits seit dem letzten Tag). Nicht von Hand taggen.
- Die Action bricht ab, wenn `@version` in `mobile-ausstattungssuche.js` nicht zu `package.json` passt — also vor dem Push immer `npm run build`.
- Die Projektseite liegt in `site/` (nicht in `docs/`, das ist gitignored) und wird per `.github/workflows/pages.yml` veröffentlicht.
