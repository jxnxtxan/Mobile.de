# Offene Punkte

Sammlung möglicher Verbesserungen, die bewusst noch nicht umgesetzt sind.

## Preisbewertung: Ausstattungsaufschlag relativ statt in festen Euro

**Stand:** 2026-10-01 · v2.16.37 · **Status:** eventuell offen, erst bei Bedarf angehen

**Beobachtung:** Der Aufschlag für Ausstattung wird mit einem festen Betrag pro Punkt gerechnet (`punktZuEuro`, Standard 800 €) und danach auf `maxAdjustPct` (Standard 20 %) vom Basispreis gekappt (`computePriceRating` in `src/features/price-rating/index.js`).

**Folge:** Bei günstigen Fahrzeugen reicht schon eine mittlere Ausstattung, um sofort die Kappung zu erreichen — gute und sehr gute Ausstattung sind dann nicht mehr unterscheidbar. Bei teuren Fahrzeugen bewirken dieselben Punkte dagegen kaum etwas.

Beispiel Audi A6 3.0 BiTDI (16.800 €, Basis 15.500 €): 15,3 Punkte gegen einen Median von 1,5 Punkten ergeben rechnerisch 11.040 € Aufschlag, angerechnet werden nur 3.100 € (20 %). Schon 4 Punkte Differenz hätten die Kappung erreicht.

**Idee:** Aufschlag pro Punkt als Prozentsatz des Basispreises (z. B. 1 % je Punkt), Kappung bleibt als Obergrenze. Migration: `punktZuEuro` durch einen Prozentwert ersetzen oder beide Modi in der Konfiguration anbieten.

**Angehen, wenn:** Bewertungen bei deutlich günstigeren oder teureren Fahrzeugen auffällig danebenliegen.
