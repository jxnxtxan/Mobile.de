import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCohortSearchUrl,
    extractNativePriceRatingFromScriptText,
    parseEuroAmount,
    parseKm,
    parsePower,
} from '../src/features/price-rating/index.js';
import { mergePriceRating } from '../src/config/feature-flags/index.js';

/**
 * `parseInt(x.replace(/[.,]/g, ''))` entfernte Punkt und Komma gleich und
 * machte aus „150,5 kW“ 1505 kW. Der pw-Filter der Vergleichssuche lag damit
 * um Faktor 10 daneben.
 */
test('parsePower liest deutsche Dezimal- und Tausendertrennung', () => {
    assert.equal(parsePower('150,5 kW').kw, 151);
    assert.equal(parsePower('150 kW').kw, 150);
    assert.equal(parsePower('1.150 kW').kw, 1150);
});

/** Live auf mobile.de gefunden: „736 kW (1.001 PS)“ ergab vorher 1 PS. */
test('parsePower liest vierstellige PS-Werte mit Tausenderpunkt', () => {
    assert.deepEqual(parsePower('736 kW (1.001 PS)'), { kw: 736, ps: 1001 });
    assert.equal(parsePower('1.001 PS').ps, 1001);
});

test('parsePower rechnet zwischen kW und PS um', () => {
    assert.equal(parsePower('110 kW (150 PS)').kw, 110);
    assert.equal(parsePower('110 kW (150 PS)').ps, 150);
    assert.equal(parsePower('150 PS').kw, 110);
    assert.equal(parsePower('204 PS').ps, 204);
});

test('parsePower liefert null bei fehlender Angabe', () => {
    assert.deepEqual(parsePower(''), { kw: null, ps: null });
    assert.deepEqual(parsePower(null), { kw: null, ps: null });
    assert.deepEqual(parsePower('Automatik'), { kw: null, ps: null });
    assert.equal(parsePower('0 kW').kw, null);
});

test('parseEuroAmount und parseKm folgen deutscher Schreibweise', () => {
    assert.equal(parseEuroAmount('12.500 €'), 12500);
    assert.equal(parseEuroAmount('12.500,50 €'), 12500.5);
    assert.equal(parseEuroAmount(12500), 12500);
    assert.equal(parseEuroAmount(null), null);
    assert.equal(parseKm('125.000 km'), 125000);
    assert.equal(parseKm(''), null);
});

const cohortProfile = () => ({
    id: '123',
    make: 'Audi',
    model: 'A4',
    makeId: '1900',
    modelId: '10',
    firstRegistrationYear: 2020,
    mileageKm: 50000,
    powerKw: null,
    powerPs: null,
});

const frParam = (url) => new URL(url).searchParams.get('fr');

/**
 * `prCfg.yearTolerance || 1` baute bei Toleranz 0 eine Suche über ±1 Jahr,
 * während `itemMatchesCohortProfile` anschließend exakt dasselbe Jahr
 * verlangte. Die geholten Vergleichsfahrzeuge fielen dadurch aus der Kohorte.
 */
test('Kohorten-Suche übernimmt die Jahres-Toleranz 0 exakt', () => {
    const url = buildCohortSearchUrl(cohortProfile(), mergePriceRating({ yearTolerance: 0 }));
    assert.equal(frParam(url), '2020:2020');
});

test('Kohorten-Suche weitet den Jahresbereich mit der Toleranz', () => {
    assert.equal(frParam(buildCohortSearchUrl(cohortProfile(), mergePriceRating({ yearTolerance: 1 }))), '2019:2021');
    assert.equal(frParam(buildCohortSearchUrl(cohortProfile(), mergePriceRating({ yearTolerance: 3 }))), '2017:2023');
});

test('Kohorten-Suche übernimmt die Kilometer-Toleranz', () => {
    const url = buildCohortSearchUrl(cohortProfile(), mergePriceRating({ kmToleranceAbs: 0 }));
    assert.equal(new URL(url).searchParams.get('ml'), '50000:50000');
});

test('Kohorten-Suche lässt Jahr und Kilometer weg, wenn das Profil sie nicht kennt', () => {
    const profile = { ...cohortProfile(), firstRegistrationYear: null, mileageKm: null };
    const params = new URL(buildCohortSearchUrl(profile, mergePriceRating({}))).searchParams;
    assert.equal(params.get('fr'), null);
    assert.equal(params.get('ml'), null);
});

/**
 * Live auf mobile.de gefunden: window.__INITIAL_STATE__ liefert die eigene
 * Preisbewertung nicht mehr, sie steckt escapt in den Next.js-Flight-Skripten
 * der Seite. Dieselben Skripte tragen auch die priceRating-Blöcke der
 * "Ähnliche Fahrzeuge"-Karten — nur die folgende Ad-ID entscheidet, welcher
 * Block zur aktuellen Anzeige gehört.
 */
function scriptChunk(adId, ratingLabel, offset) {
    return `1:{...},\\"priceRating\\":{\\"rating\\":\\"GOOD_PRICE\\",\\"ratingLabel\\":\\"${ratingLabel}\\",`
        + `\\"thresholdLabels\\":[\\"39.200 €\\",\\"51.000 €\\",\\"54.900 €\\",\\"61.000 €\\",\\"65.500 €\\",\\"72.800 €\\"],`
        + `\\"vehiclePriceOffset\\":${offset}},\\"segment\\":\\"Car\\",\\"title\\":\\"Audi S6\\",\\"id\\":${adId},\\"price\\":{...`;
}

test('liest die Preisbewertung des passenden Ad-Blocks aus dem Flight-Skript', () => {
    const text = scriptChunk('461888344', 'Guter Preis', 22);
    const rating = extractNativePriceRatingFromScriptText(text, '461888344');
    assert.deepEqual(rating, {
        rating: 'GOOD_PRICE',
        ratingLabel: 'Guter Preis',
        thresholdLabels: ['39.200 €', '51.000 €', '54.900 €', '61.000 €', '65.500 €', '72.800 €'],
        vehiclePriceOffset: 22
    });
});

test('überspringt den priceRating-Block einer Ähnliche-Fahrzeuge-Karte und findet den eigenen', () => {
    const text = scriptChunk('999111', 'Fairer Preis', 55) + scriptChunk('461888344', 'Guter Preis', 22);
    const rating = extractNativePriceRatingFromScriptText(text, '461888344');
    assert.equal(rating.ratingLabel, 'Guter Preis');
    assert.equal(rating.vehiclePriceOffset, 22);
});

test('liefert null ohne Treffer, ohne Ad-ID oder bei fehlenden Schwellenwerten', () => {
    assert.equal(extractNativePriceRatingFromScriptText('', '461888344'), null);
    assert.equal(extractNativePriceRatingFromScriptText(scriptChunk('461888344', 'Guter Preis', 22), ''), null);
    assert.equal(extractNativePriceRatingFromScriptText(scriptChunk('123', 'Guter Preis', 22), '461888344'), null);
    const malformed = '\\"priceRating\\":{\\"ratingLabel\\":\\"Guter Preis\\"},\\"id\\":461888344,';
    assert.equal(extractNativePriceRatingFromScriptText(malformed, '461888344'), null);
});
