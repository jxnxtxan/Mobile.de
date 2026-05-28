'use strict';

export const KONFIG_TAB_HELP_HTML = new Map([
    ['aus', `
<h4>Was macht das?</h4>
<p>Hier konfigurierst du, welche Ausstattungsbegriffe (z.B. „Sitzheizung", „Panoramadach") auf einer mobile.de-Detailseite gesucht und im Ergebnis angezeigt werden.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter (links)</strong>: Eintrag ein-/ausschalten. Inaktive werden ignoriert.</li>
<li><strong>Anzeigetext</strong>: Wie der Treffer im Ergebnisbereich erscheint (z.B. „Sitzheizung").</li>
<li><strong>Farbe</strong>: Hintergrundakzent im Ergebnis. Klick auf das Quadrat öffnet einen Color-Picker; alternativ Hex-Code (<code>#66ff66</code>) oder Schlüsselwort (<code>red</code>, <code>orange</code>).</li>
<li><strong>Nur Ausstattungsliste</strong>: Treffer werden <strong>nur</strong> in der strukturierten Ausstattungsliste / Tech-Daten gezählt. Beschreibungstext wird ignoriert. Empfohlen für sicherheitskritische Begriffe wie „Anhängerkupplung" oder Sound-Systeme.</li>
<li><strong>Wortteil-Suche</strong>: Erlaubt Treffer auch mitten in zusammengesetzten Wörtern (z.B. „heizung" findet „Standheizung"). Vorsicht: kann False-Positives erzeugen.</li>
<li><strong>Details [N]</strong> öffnet erweiterte Optionen mit den eigentlichen Suchbegriffen und Verboten (Komma-getrennt).</li>
<li><strong>Stern (☆/★)</strong>: Favorit markieren. Favoriten erscheinen oben (eigener Block mit Trenner) und im Suchergebnis auf der Fahrzeugseite zuerst.</li>
<li><strong>Listen-Reihenfolge</strong> (Tab Config): Modus <em>Manuell</em> + Bereich „Gesamte Ausstattungsliste“ oder „Favoriten“ aktiviert Drag&amp;Drop (⋮⋮) mit sichtbarer Zeilenbewegung. Modus <em>Alphabetisch</em>: Speichern sortiert nach Anzeigetext.</li>
<li><strong>Spaltenköpfe</strong> sortieren die Anzeige (bei manueller Reihenfolge deaktiviert).</li>
<li><strong>Ziehen</strong> (⋮⋮): ganze Zeile als Vorschau; Live-Platzhalter beim Ziehen.</li>
<li><strong>Filter</strong> „nur aktive“ / „nur Favoriten“ und <strong>Alle Einträge</strong> (Ein/Aus für alle Einträge im Tab) stehen in einer Zeile.</li>
<li><strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong> (mit Trennlinie) – nicht in der Listen-Toolbar.</li>
<li><strong>Listen-Layout</strong> (Tab Config): Umschaltung zwischen diesem klassischen Grid und der Split-View (Liste + Editor).</li>
</ul>`],
    ['aus_split', `
<h4>Was macht das?</h4>
<p>Wie im klassischen Modus — Ausstattungsbegriffe für die mobile.de-Detailseite konfigurieren.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Kompakte Zeilen (Aktiv, Favorit, Name, Farbe, Badges). Eintrag anklicken → Editor rechts.</li>
<li><strong>Editor rechts</strong>: Anzeigetext, Suchbegriffe und Verbote als <strong>Chips</strong> (Enter oder Komma zum Hinzufügen, × zum Entfernen).</li>
<li><strong>Farbe</strong>, <strong>Nur Ausstattungsliste</strong>, <strong>Wortteil-Suche</strong>, <strong>Duplizieren</strong> und <strong>Löschen</strong> im Editor.</li>
<li><strong>Sortierung</strong> über Dropdown in der Toolbar (bei manueller Reihenfolge deaktiviert).</li>
<li><strong>Filter</strong> inkl. „Mit Verboten“; Favoriten-Block und Drag&amp;Drop (⋮⋮) wie bisher.</li>
<li>Auf schmalen Bildschirmen: Editor als Sheet von unten („Fertig“ zum Schließen).</li>
<li>Layout umschalten: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
    ['tech', `
<h4>Was macht das?</h4>
<p>Hier wählst du, welche technischen Datenfelder (aus dem mobile.de-Tech-Daten-Block) zusätzlich im Ergebnis angezeigt werden, z.B. „Erstzulassung" oder „Fahrzeugzustand".</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong> zum Ein-/Ausblenden.</li>
<li><strong>Begriff</strong>: Muss exakt mit dem <code>&lt;dt&gt;</code>-Label aus dem mobile.de-Tech-Daten-Block übereinstimmen (Groß-/Kleinschreibung egal).</li>
<li><strong>Suche</strong>, <strong>Alle Einträge</strong> (Ein/Aus für alle Tech-Einträge) und <strong>Spaltenköpfe</strong> wie auf der Ausstattungs-Seite. <strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Reihenfolge</strong> (Tab Config): Bereich „Tech-Daten“ + Modus Manuell → Drag&amp;Drop; optional Reihenfolge auf der Fahrzeugseite übernehmen.</li>
<li><strong>Reihenfolge</strong> per Drag&amp;Drop (⋮⋮) mit Live-Vorschau in der Liste.</li>
<li><strong>Listen-Layout</strong> (Tab Config): optional Split-View (Liste + Editor).</li>
</ul>`],
    ['tech_split', `
<h4>Was macht das?</h4>
<p>Technische Datenfelder aus dem mobile.de-Tech-Block für die Ergebnisanzeige wählen.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Aktiv-Schalter und gekürzter Begriff — Zeile anklicken für den Editor.</li>
<li><strong>Editor rechts</strong>: Vollständiger Begriff (exakt wie <code>&lt;dt&gt;</code>-Label), Option <strong>Aktiv</strong>, Löschen.</li>
<li><strong>Sortierung</strong> per Dropdown; Drag&amp;Drop bei manueller Tech-Reihenfolge (Config).</li>
<li>Layout: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
    ['merge', `
<h4>Was macht das?</h4>
<p>Mehrere getrennt gefundene Einträge mit gleichem Basis-Wort werden zu <strong>einer</strong> Zeile zusammengefasst. Beispiel: „Außenspiegel beheizbar", „Außenspiegel anklappbar", „Außenspiegel elektr. verstellbar" → eine Zeile <strong>Außenspiegel beheizbar, anklappbar, elektr. verstellbar</strong>.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Aktiv-Schalter</strong>: Inaktive Gruppen werden beim Zusammenfassen auf der Fahrzeugseite ignoriert.</li>
<li><strong>Basis</strong>: Das gemeinsame Wort, nach dem gruppiert wird (z.B. <code>außenspiegel</code>). Klein- und Großschreibung egal.</li>
<li><strong>Reihenfolge</strong>: Komma-getrennte Liste der Modifizierer-Schlüsselwörter in der gewünschten Reihenfolge im zusammengefassten Eintrag (z.B. <code>elektr. verstellbar, beheizbar, anklappbar</code>). Treffer, die in keiner Reihenfolge auftauchen, kommen ans Ende.</li>
<li><strong>Spaltenköpfe</strong> zum Sortieren, <strong>Filter „nur aktive“</strong> und <strong>Alle Einträge</strong> (Ein/Aus) in einer Zeile wie bei Ausstattung. Speichern sortiert alphabetisch nach Basis. <strong>Defaults zurücksetzen</strong> im Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Layout</strong> (Tab Config): optional Split-View.</li>
</ul>`],
    ['merge_split', `
<h4>Was macht das?</h4>
<p>Merge-Gruppen fassen mehrere Treffer mit gleicher Basis zu einer Zeile zusammen.</p>
<h4>Split-View:</h4>
<ul>
<li><strong>Liste links</strong>: Aktiv, Basis (gekürzt), Badge mit Anzahl Modifier.</li>
<li><strong>Editor rechts</strong>: Basis-Feld; Modifier-Reihenfolge als <strong>Chips</strong> (Enter/Komma); Option <strong>Aktiv</strong>, Löschen.</li>
<li><strong>Sortierung</strong> per Dropdown in der Toolbar.</li>
<li>Layout: Tab <strong>Config</strong> → <strong>Listen-Layout</strong>.</li>
</ul>`],
    ['ie', `
<h4>Was macht das?</h4>
<p>Komplette Konfiguration als JSON sichern oder einspielen – praktisch zum Wechsel zwischen Browsern oder zum Verteilen einer Standardkonfiguration.</p>
<h4>So bedienst du es:</h4>
<ul>
<li><strong>Export aktualisieren</strong> generiert das aktuelle JSON. <strong>Kopieren</strong> legt es in die Zwischenablage; <strong>Herunterladen</strong> speichert eine Datei <code>mobilede-config-YYYY-MM-DD.json</code>.</li>
<li><strong>Import</strong>: JSON entweder per <strong>Drag&amp;Drop</strong> der Datei auf die Drop-Zone oder direkt in die Textarea einfügen. <strong>Importieren</strong> überschreibt die aktuelle Konfiguration; ein automatisches Backup wird vorher angelegt und kann per <strong>Rückgängig</strong> im Footer zurückgeholt werden.</li>
</ul>`],
    ['config', `
<h4>Was macht das?</h4>
<p>Hier schaltest du Zusatz-Features des Skripts global ein oder aus. Änderungen werden mit <strong>Speichern</strong> übernommen und greifen sofort – auch ohne Seiten-Reload.</p>
<h4>So bedienst du es:</h4>
<ul>
<li>Jede Karte beschreibt ein Feature und besitzt einen Toggle.</li>
<li><strong>Automodus:</strong> Aus = nur Treffer aus deiner Ausstattungs-Konfiguration (wie bisher). An = vollständige Liste aus Ausstattungsliste und strukturierter Beschreibung; Konfig-Treffer farbig, unbekannte Zeilen mit <strong>+ Konfig</strong> übernehmbar.</li>
<li>Beim Deaktivieren werden bereits aktive Manipulationen (z.B. die Maps-Verlinkung) auf der gerade geöffneten Detailseite optisch zurückgenommen.</li>
<li><strong>Listen-Reihenfolge:</strong> Alphabetisch vs. manuell (Drag&amp;Drop). Bereiche: Favoriten, gesamte Ausstattungsliste, Tech-Daten (mehrfach wählbar). Optional: Reihenfolge in den Ergebnisblöcken auf der Fahrzeugseite.</li>
<li><strong>Suchergebnis-Sortierung:</strong> Standard-Sortierung für die PKW-Suchergebnisseite (z.&nbsp;B. Preis aufsteigend). Beim Öffnen einer neuen Suche wird sie gesetzt; änderst du sie danach im Dropdown von mobile.de, bleibt deine Wahl bis zur nächsten Suche (auch nach Seiten-Reload). Auf der Suchergebnisseite öffnest du dieses Popup über das Tampermonkey-Menü.</li>
<li>Neue Features werden automatisch mit ihren Standardwerten ergänzt; bestehende Einstellungen bleiben erhalten.</li>
<li><strong>Defaults zurücksetzen</strong> für alle Feature-Flags: Footer neben <strong>Rückgängig</strong>.</li>
<li><strong>Listen-Layout:</strong> Schaltet die Tabs Ausstattung, Tech-Daten und Merge-Gruppen zwischen klassischem Grid und Split-View (Liste + Editor) um. Gilt nach <strong>Speichern</strong>.</li>
<li><strong>Preisbewertung:</strong> Vollständig im Tab <strong>Config</strong> — Schwellen, €/Punkt, Vergleichskohorte, Ausstattungs-Gewichte. Änderungen mit starker Auswirkung fragen per Warnung nach.</li>
</ul>`]
]);
