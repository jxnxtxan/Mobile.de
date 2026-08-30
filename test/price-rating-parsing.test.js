import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCohortSearchUrl,
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
