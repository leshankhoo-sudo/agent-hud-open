// Run: npm test   (node --test, no extra packages)
// Uses the real files in public/data. The walking fixture below is a TEST FIXTURE
// that only exercises the parser; it is never loaded by the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWeather, getWeather, weatherUrl, WEATHER_TTL_MS, WeatherError, dailySummary, tokyoHourKey, clearWeatherCache } from '../src/lib/weather.js';
import { walkingAvailability, indexWalking, walkingCoverage } from '../src/lib/walking.js';
import { filterAttractions, filterTransport, countBy, applyEnglishNames, withEnglish, recordLabel, muniLabel } from '../src/lib/data.js';

const J = (p) => JSON.parse(readFileSync(new URL('../public/data/' + p, import.meta.url), 'utf8'));
const A = J('attractions.geojson').features;
const T = J('transport.geojson').features;

test('record counts match data_inventory.json (the raw package; the map layer is checked in the POI audit tests)', () => {
  const inv = JSON.parse(readFileSync(new URL('../data/raw/package_docs/data_inventory.json', import.meta.url), 'utf8'));
  const rawA = JSON.parse(readFileSync(new URL('../data/raw/attractions.geojson', import.meta.url), 'utf8')).features;
  assert.equal(rawA.length, inv.attractions.records);
  assert.equal(T.length, inv.transport.records);
  assert.deepEqual(countBy(rawA, 'category'), inv.attractions.categories);
  assert.deepEqual(countBy(T, 'category'), inv.transport.categories);
});

test('filter counts', () => {
  // 523 raw records - 5 merged duplicates - 13 that are not places to visit + 121 sites added from DSIGHT_1.csv (see data/audit)
  assert.equal(filterAttractions(A, ['attraction', 'viewpoint', 'museum', 'castle', 'temple', 'shrine', 'garden']).length, 626);
  assert.equal(filterAttractions(A, ['museum']).length, 101);
  assert.equal(filterAttractions(A, ['castle', 'museum']).length, 121);
  assert.equal(filterAttractions(A, []).length, 0);
  assert.equal(filterTransport(T, ['bus']).length, 5229);
  assert.equal(filterTransport(T, ['rail']).length, 248);
  assert.equal(filterTransport(T, ['tram']).length, 2);
  assert.equal(filterTransport(T, ['rail', 'tram']).length, 250);
  assert.equal(filterTransport(T, ['bus', 'rail', 'tram']).length, 5479);
  assert.equal(filterAttractions(A, ['attraction', 'viewpoint', 'museum', 'castle'], 'a00265').length, 1);
});

test('IDs are kept and unique, coordinates are [lon, lat] inside Kyoto Prefecture bounds', () => {
  assert.equal(new Set(A.map((f) => f.properties.id)).size, 626);
  assert.equal(new Set(T.map((f) => f.properties.id)).size, 5479);
  for (const f of [...A, ...T]) {
    const [lon, lat] = f.geometry.coordinates;
    assert.ok(lon > 134.8 && lon < 136.1 && lat > 34.7 && lat < 35.8, f.properties.id);
  }
  const kyotoSt = T.find((f) => f.properties.id === 'S00019');
  assert.equal(kyotoSt.properties.name, '京都');
  assert.ok(Math.abs(kyotoSt.geometry.coordinates[0] - 135.7588) < 0.001 && Math.abs(kyotoSt.geometry.coordinates[1] - 34.9853) < 0.001);
  const kinkaku = A.find((f) => f.properties.id === 'A00265');
  assert.equal(kinkaku.properties.name, '金閣');
});

test('municipality join covers every point and places known points correctly', () => {
  const pm = J('point_municipality.json');
  assert.equal(Object.keys(pm.points).length, A.length + T.length);
  assert.equal(pm.names[pm.points.S00019], '京都市 下京区');
  assert.equal(pm.names[pm.points.A00265], '京都市 北区');
});

test('KDE output is documented and consistent', () => {
  const meta = J('analysis/density_kde_meta.json');
  assert.equal(meta.search_radius_m, 2000);
  assert.equal(meta.cell_size_m, 500);
  assert.match(meta.crs, /6674/);
  assert.ok(Math.abs(meta.check_sum_density_x_cell_area - 639) < 48);
  const kde = J('analysis/density_kde.geojson');
  assert.equal(kde.features.length, meta.cells_written);
});

test('sample journeys stay unlinked and keep fares, conditions and sources', () => {
  const js = J('sample_journeys_display.json');
  assert.equal(js.length, 9);
  for (const j of js) {
    assert.equal(j.attraction_id, null);
    assert.equal(j.stop_id, null);
    assert.equal(j.walking_distance_m, null);
    assert.equal(j.origin, 'Kyoto Station');
    assert.ok(Number.isInteger(j.adult_fare_jpy) && Number.isInteger(j.child_fare_jpy));
    assert.ok(j.service_conditions && j.route_status && j.source_edition && j.route_source_url && j.fare_source_url);
    assert.equal(j.workbook?.service_type ? true : false, true);
  }
});

test('walking: the package\'s empty file means "not available"', () => {
  const w = JSON.parse(readFileSync(new URL('../data/raw/walking_routes.geojson', import.meta.url), 'utf8'));
  const a = walkingAvailability(w);
  assert.equal(a.available, false);
  assert.match(a.reason, /NOT_CALCULATED/);
});

test('walking pilot results: 19 records, bus and rail separate, no zero or straight-line substitutes', () => {
  const w = J('walking_routes.geojson');
  const a = walkingAvailability(w);
  assert.equal(a.available, true);
  assert.equal(a.pilot, true);
  assert.equal(a.scopeIds.size, 19);
  const idx = indexWalking(w);
  assert.equal(idx.invalid.length, 0);
  assert.equal(w.features.length, 38);
  const toM = ([x1, y1], [x2, y2]) => Math.hypot((x2 - x1) * 91290, (y2 - y1) * 111000); // rough metres at 35°N
  for (const f of w.features) {
    const p = f.properties;
    assert.ok(['bus', 'rail'].includes(p.stop_type));
    if (p.route_status === 'ok') {
      assert.ok(p.distance_m > 0);
      const c = f.geometry.coordinates;
      const straight = toM(c[0], c[c.length - 1]);
      assert.ok(p.distance_m >= straight * 0.97, `${p.attraction_id} network ${p.distance_m} < straight ${straight}`);
      const stop = T.find((t) => t.properties.id === p.stop_id);
      assert.equal(stop.properties.transport_type, p.stop_type);
    } else {
      assert.equal(p.distance_m, null);
      assert.equal(f.geometry, null);
    }
  }
  const unreachable = w.features.filter((f) => f.properties.route_status !== 'ok').map((f) => f.properties.attraction_id);
  assert.deepEqual([...new Set(unreachable)], ['A00172']);
  const cov = walkingCoverage(idx, [...a.scopeIds], ['bus'], 500);
  assert.equal(cov.denominator, 19);
  assert.equal(cov.within + cov.beyond + cov.noRoute + cov.notComputed, 19);
});

test('walking prefecture: all 626 records on the map, reasons kept apart, pilot rows reproduced, no straight-line substitutes', () => {
  const w = J('walking_routes_prefecture.geojson');
  const a = walkingAvailability(w);
  assert.equal(a.available, true);
  assert.equal(a.pilot, false);
  assert.equal(a.scopeIds.size, A.length);
  const idx = indexWalking(w);
  assert.equal(idx.invalid.length, 0);
  assert.equal(w.features.length, A.length * 2);
  const toM = ([x1, y1], [x2, y2]) => Math.hypot((x2 - x1) * 91290, (y2 - y1) * 111000);
  const reasons = new Set();
  for (const f of w.features) {
    const p = f.properties;
    assert.ok(['bus', 'rail'].includes(p.stop_type));
    assert.ok(['named', 'osm_tags', 'unverified'].includes(p.identity));
    const rec = A.find((x) => x.properties.id === p.attraction_id).properties;
    assert.equal(p.identity === 'named', !!(rec.name || '').trim(), `${p.attraction_id} identity`);
    if (p.route_status === 'ok' && p.reason === 'same_access_point') {
      assert.equal(p.distance_m, 0);
      assert.equal(f.geometry, null);
    } else if (p.route_status === 'ok') {
      const c = f.geometry.coordinates;
      assert.ok(p.distance_m >= toM(c[0], c[c.length - 1]) * 0.97, `${p.attraction_id} shorter than a straight line`);
      assert.ok(p.distance_m <= 3000);
      assert.equal(T.find((t) => t.properties.id === p.stop_id).properties.transport_type, p.stop_type);
    } else {
      assert.equal(p.distance_m, null);
      assert.equal(f.geometry, null);
      assert.ok(['no_stop_within_cutoff', 'isolated_network', 'attraction_too_far_from_network'].includes(p.reason));
      reasons.add(p.reason);
    }
  }
  assert.equal(reasons.size, 3);
  // The pilot rows come out the same, except A00172, which now attaches to the street instead of a fragment.
  const pilot = J('walking_routes.geojson');
  for (const f of pilot.features) {
    const p = f.properties;
    if (p.attraction_id === 'A00172') continue;
    // a pilot record that later left the map (not a place to visit) has no prefecture row any more
    if (!idx.byAttraction.has(p.attraction_id)) { assert.ok(J('poi_relations.json').not_sights[p.attraction_id], p.attraction_id); continue; }
    const q = idx.byAttraction.get(p.attraction_id)[p.stop_type];
    assert.equal(q.stop_id, p.stop_id);
    assert.ok(Math.abs(q.distance_m - p.distance_m) < 0.5, `${p.attraction_id} ${p.stop_type}`);
  }
  const cov = walkingCoverage(idx, [...a.scopeIds], ['bus', 'rail'], 800);
  assert.equal(cov.within + cov.beyond + cov.noStop + cov.notConnected + cov.notComputed, A.length);
  assert.equal(cov.notComputed, 0);
});

test('walking: parser keeps bus and rail apart, rejects zero and straight-line shortcuts (TEST FIXTURE)', () => {
  const line = { type: 'LineString', coordinates: [[135.7, 35], [135.701, 35.001], [135.702, 35.001]] };
  const fc = {
    type: 'FeatureCollection', status: 'CALCULATED', features: [
      { type: 'Feature', geometry: line, properties: { attraction_id: 'A00001', stop_id: 'S00001', stop_type: 'bus', route_status: 'ok', distance_m: 320 } },
      { type: 'Feature', geometry: line, properties: { attraction_id: 'A00001', stop_id: 'S00002', stop_type: 'rail', route_status: 'ok', distance_m: 1400 } },
      { type: 'Feature', geometry: null, properties: { attraction_id: 'A00002', stop_id: null, stop_type: 'bus', route_status: 'unreachable', distance_m: null } },
      { type: 'Feature', geometry: null, properties: { attraction_id: 'A00003', stop_id: 'S00003', stop_type: 'bus', route_status: 'ok', distance_m: 0 } },
      { type: 'Feature', geometry: null, properties: { attraction_id: 'A00004', stop_id: null, stop_type: 'bus', route_status: 'failed', distance_m: 0 } },
    ],
  };
  assert.equal(walkingAvailability(fc).available, true);
  const idx = indexWalking(fc);
  assert.equal(idx.invalid.length, 2);
  const cov = walkingCoverage(idx, ['A00001', 'A00002', 'A00003', 'A00005'], ['bus'], 500);
  assert.deepEqual(cov, { denominator: 4, within: 1, beyond: 0, noStop: 0, notConnected: 1, noRoute: 1, notComputed: 2, share: 0.25 });
  const rail = walkingCoverage(idx, ['A00001'], ['rail'], 500);
  assert.equal(rail.within, 0);
  assert.equal(rail.beyond, 1);
});

test('weather URL asks for the required variables in Asia/Tokyo', () => {
  const u = new URL(weatherUrl(35.0395179, 135.7284537));
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(u.searchParams.get('forecast_days'), '7');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,weather_code');
  assert.equal(u.searchParams.get('hourly'), 'temperature_2m,weather_code,precipitation_probability,precipitation');
  assert.equal(u.searchParams.get('latitude'), '35.03952');
});

test('weather: API error and HTTP error throw, nothing is invented', async () => {
  assert.throws(() => parseWeather({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }), (e) => e instanceof WeatherError && e.kind === 'api');
  assert.throws(() => parseWeather({ hourly: { time: [] } }), WeatherError);
  clearWeatherCache();
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }) });
  await assert.rejects(getWeather(35, 135.7, { fetchImpl, storage: null }), /HTTP 429: Daily API request limit/);
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getWeather(35, 135.7, { fetchImpl: down, storage: null }), (e) => e.kind === 'network');
});

test('weather: nulls stay null, cache lasts 30 minutes, force refresh bypasses it', async () => {
  clearWeatherCache();
  const body = { latitude: 35.04, longitude: 135.73, elevation: 80, timezone: 'Asia/Tokyo', current: { time: '2026-11-10T14:00', interval: 900, temperature_2m: 15.2, weather_code: 3 }, hourly_units: { temperature_2m: '°C', precipitation: 'mm' }, hourly: { time: ['2026-11-10T00:00', '2026-11-10T01:00'], temperature_2m: [10.1, null], weather_code: [0, 61], precipitation_probability: [5, null], precipitation: [0, 0.4] } };
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => body }; };
  let t = 1_000_000;
  const now = () => t;
  const r1 = await getWeather(35.04, 135.73, { fetchImpl, now, storage: null });
  assert.equal(r1.fromCache, false);
  assert.equal(r1.data.hourly[1].temperature, null);
  assert.equal(r1.data.hourly[1].precipProb, null);
  t += WEATHER_TTL_MS - 1;
  assert.equal((await getWeather(35.04, 135.73, { fetchImpl, now, storage: null })).fromCache, true);
  t += 2;
  assert.equal((await getWeather(35.04, 135.73, { fetchImpl, now, storage: null })).fromCache, false);
  await getWeather(35.04, 135.73, { fetchImpl, now, storage: null, force: true });
  assert.equal(calls, 3);
  assert.deepEqual(dailySummary(r1.data.hourly)[0], { date: '2026-11-10', hours: 2, min: 10.1, max: 10.1, maxProb: 5, total: 0.4 });
});

test('Tokyo hour key', () => {
  assert.equal(tokyoHourKey(new Date('2026-11-09T19:30:00Z')), '2026-11-10T04:00');
});

test('photos: real files, free licences, credits; name matches only for named records, own OSM links for any', async () => {
  const { existsSync } = await import('node:fs');
  const ph = J('photos.json');
  const A = J('attractions.geojson').features;
  const named = new Set(A.filter((f) => (f.properties.name || '').trim()).map((f) => f.properties.id));
  // the photo search ran before 13 records left the map (not places to visit); none of them has a photo
  const out = J('poi_relations.json').not_sights;
  assert.equal(ph.named_records, named.size + Object.keys(out).length);
  for (const id of Object.keys(out)) assert.ok(!ph.photos[id], `${id} left the map but has a photo`);
  assert.equal(Object.keys(ph.photos).length, ph.with_photo);
  const osm = J('../../data/cache/osm_attraction_nodes.json').nodes;
  const byId = Object.fromEntries(A.map((f) => [f.properties.id, f.properties]));
  for (const [id, p] of Object.entries(ph.photos)) {
    // a photo found by name needs a name; one linked from the record's own OSM node needs that link
    if (p.match.startsWith('osm-')) {
      const t = osm[byId[id].osm_id].tags;
      for (const [k, v] of Object.entries(p.osm_tags)) assert.equal(t[k], v, `${id} ${k}`);
      if (p.match === 'osm-wikidata') assert.equal((t.wikidata || '').split(';')[0] || p.wikidata, p.wikidata);
    } else if (p.match === 'viewpoint-here') {      // taken within 40 m of a viewpoint, checked by eye
      assert.equal(byId[id].category, 'viewpoint', id); assert.ok(p.m <= 40 && p.shows, id);
    } else if (p.match === 'nearby-checked') {      // taken within 60 m (80 m for a viewpoint) and shows this place, checked by eye
      assert.ok(p.m <= (byId[id].category === 'viewpoint' ? 80 : 60) && p.shows, id);
    } else if (p.match === 'site-contains') {       // no name: the photo of the named OSM site it lies in, by the site's own Wikidata link
      assert.ok(!(byId[id].name || '').trim() && p.site && /^Q\d+$/.test(p.wikidata), id);
    } else assert.ok(named.has(id), `${id} has no name`);
    assert.ok(existsSync(new URL('../public/' + p.src, import.meta.url)), p.src);
    assert.match(p.license, /^(CC0|Public domain|CC BY(-SA)? [\d.]+)$/);
    assert.ok(!/\b(NC|ND)\b/.test(p.license));
    assert.ok(p.artist && p.page.startsWith('https://commons.wikimedia.org/'));
    if (!['viewpoint-here', 'nearby-checked', 'site-contains', 'wikidata-checked'].includes(p.match)) assert.ok(p.distance_m == null ? p.match.startsWith('osm-') : p.distance_m <= (['osm-wikidata', 'site-wikidata'].includes(p.match) ? 1000 : p.match === 'commons-near' ? 150 : 300), id);
    assert.ok(['wikidata-exact', 'wikidata-related', 'commons-geo', 'osm-wikidata', 'osm-image', 'osm-commons', 'commons-near', 'site-wikidata', 'commons-search', 'viewpoint-here', 'nearby-checked', 'site-contains', 'wikidata-checked'].includes(p.match), p.match);
    if (p.match === 'commons-search') assert.ok(p.matched_text && p.distance_m <= 300, id);   // names the place AND was taken near it
    if (p.match === 'site-wikidata') assert.equal(byId[id].wikidata, p.wikidata);
  }
});

test('English names: added as new fields, originals unchanged, shown as 日文 (English)', () => {
  const en = J('names_en.json');
  const data = { attractions: J('attractions.geojson'), transport: J('transport.geojson'), pointMuni: J('point_municipality.json'), namesEn: en };
  const before = data.attractions.features.map((f) => [f.properties.id, f.properties.name, f.properties.display_name]);
  applyEnglishNames(data);
  assert.deepEqual(data.attractions.features.map((f) => [f.properties.id, f.properties.name, f.properties.display_name]), before);
  const ids = new Set([...data.attractions.features, ...data.transport.features].map((f) => f.properties.id));
  for (const k of ['attractions', 'transport']) for (const [id, v] of Object.entries(en[k])) { assert.ok(ids.has(id), id); assert.ok(v.en && v.source, id); }
  const withEn = data.transport.features.filter((f) => f.properties.name_en);
  assert.ok(withEn.length > 1000);
  for (const f of withEn) assert.equal(recordLabel(f.properties), `${f.properties.name} (${f.properties.name_en})`);
  assert.equal(withEnglish('清水寺', 'Kiyomizu-dera'), '清水寺 (Kiyomizu-dera)');
  assert.equal(withEnglish('上川口', undefined), '上川口');
  assert.equal(withEnglish('兜台三丁目 (Kabutodai 3-chōme)', 'Kabutodai 3-chome'), '兜台三丁目 (Kabutodai 3-chōme)');
  const unnamed = data.attractions.features.find((f) => !f.properties.name);
  assert.equal(recordLabel(unnamed.properties), unnamed.properties.display_name);
  assert.equal(Object.keys(data.pointMuni.names_en).length, 36);
  assert.equal(muniLabel(data.pointMuni, '26105'), '京都市 東山区 (Higashiyama Ward, Kyoto City)');
});

test('bus routes: one operator, directions kept apart, stop order and positions consistent', () => {
  const idx = J('bus/index.json');
  assert.match(idx.operator, /Kyoto Municipal Transportation Bureau/);
  assert.equal(idx.routes.length, 105);
  const withLine = idx.routes.filter((r) => r.variants.length);
  assert.equal(withLine.length, 89);
  assert.equal(withLine.reduce((n, r) => n + r.variants.length, 0), 175);
  assert.equal(idx.coverage.route_numbers_without_animation.length, 16);
  assert.equal(new Set(idx.routes.flatMap((r) => r.variants.map((v) => v.id))).size, 175); // no variant shared between routes
  let calls = 0;
  for (const r of withLine) for (const v of r.variants) {
    const d = J(`bus/variants/${v.id}.json`);
    assert.equal(d.route_key, r.key);
    assert.ok(d.line.length >= 2 && d.stops.length >= 2, v.id);
    assert.deepEqual(d.stops.map((s) => s.key), v.order);
    d.stops.forEach((s, i) => {
      assert.equal(s.seq, i + 1, `${v.id} sequence`);
      assert.ok(s.p >= 0 && s.p <= 1 && (i === 0 || s.p >= d.stops[i - 1].p - 1e-6), `${v.id} stop ${s.seq} position along the line`);
      assert.ok(idx.stops[s.key], `${v.id} unknown stop key ${s.key}`);
      assert.ok(r.stop_keys.includes(s.key), `${v.id}: ${s.key} is not in the operator's stop list of route ${r.number}`);
    });
    calls += d.stops.length;
  }
  assert.equal(calls, idx.coverage.stop_occurrences);
  for (const r of idx.routes) assert.ok(r.fare && ['standard_flat', 'stop_pair', 'sightseeing_express_flat'].includes(r.fare.type), r.number);
  const ex = idx.routes.find((r) => r.number === 'EX100');
  assert.equal(ex.fare.adult, 500);
  assert.equal(idx.routes.find((r) => r.fare.type === 'stop_pair').fare.adult, null); // not filled in
});

test('context for unnamed records: same-record English names only, containing areas are locations', async () => {
  const { applyContext, applyEnglishNames, recordLabel } = await import('../src/lib/data.js');
  const ctx = J('attraction_context.json');
  const unnamed = A.filter((f) => !(f.properties.name || '').trim());
  assert.equal(Object.keys(ctx.records).length, unnamed.length);
  const tags = JSON.parse(readFileSync(new URL('../data/cache/osm_elements.json', import.meta.url), 'utf8'));
  for (const [id, c] of Object.entries(ctx.records)) {
    assert.ok(['osm_tags', 'unverified'].includes(c.identity), id);
    const t = tags[c.osm_element] || {};
    if (c.name_en) assert.equal(c.name_en, t['name:en'].split(';')[0].trim(), `${id} English name must be the record's own name:en`);
    else assert.ok(!t['name:en'], `${id} has name:en but none was taken`);
    for (const s of c.inside || []) assert.ok(s.name && s.kind && !/administrative|island/.test(s.kind), id);
  }
  assert.equal(ctx.meta.counts.osm_tags + ctx.meta.counts.unverified, unnamed.length);
  // applied to a copy of the data: original name fields untouched, English label shown
  const data = { attractions: J('attractions.geojson'), transport: J('transport.geojson'), namesEn: J('names_en.json'), context: ctx };
  applyEnglishNames(data);
  applyContext(data);
  const a191 = data.attractions.features.find((f) => f.properties.id === 'A00191').properties;
  assert.equal(a191.name, '');
  assert.equal(a191.name_en, 'Daiun-in');
  assert.equal(recordLabel(a191), 'Daiun-in');
  const a110 = data.attractions.features.find((f) => f.properties.id === 'A00110').properties;
  assert.equal(a110.name_en, undefined);
  assert.equal(recordLabel(a110), a110.display_name);
  assert.equal(ctx.records.A00110.inside[0].name, '金閣寺');
});

test('name terms explain words, longest match first, stop-only words only for stops', async () => {
  const { nameTerms } = await import('../src/lib/terms.js');
  const t = (n, s) => nameTerms(n, s).map((x) => x.t).join(',');
  assert.equal(t('伏見稲荷大社'), '大社');
  assert.equal(t('金閣寺道', true), '寺,道');
  assert.equal(t('金閣寺道', false), '寺');
  assert.equal(t('京都駅前', true), '駅前');
  assert.equal(t('城陽市'), '');
  assert.equal(t(''), '');
});

test('English-first name order is a display choice only', async () => {
  const { withEnglish, setEnglishFirst } = await import('../src/lib/data.js');
  assert.equal(withEnglish('金閣', 'Golden Pavilion'), '金閣 (Golden Pavilion)');
  setEnglishFirst(true);
  assert.equal(withEnglish('金閣', 'Golden Pavilion'), 'Golden Pavilion (金閣)');
  assert.equal(withEnglish('祇園', ''), '祇園');
  setEnglishFirst(false);
});

test('season: Kyoto date (JST), JMA months, sakura and autumn-leaves windows from the JMA normals', async () => {
  const { seasonFor, monthSeason, kyotoDate } = await import('../src/lib/season.js');
  const ref = J('season_kyoto.json');
  assert.equal(ref.normals.sakura_flowering, '03-26');
  assert.equal(ref.normals.maple_red, '12-05');
  // window rule written in the file: flowering - 7 d .. full bloom + 7 d; ginkgo - 14 d .. maple + 7 d
  const shift = (md, d) => { const t = new Date(Date.UTC(2021, Number(md.slice(0, 2)) - 1, Number(md.slice(3)) + d)); return t.toISOString().slice(5, 10); };
  assert.equal(ref.windows.sakura.from, shift(ref.normals.sakura_flowering, -7));
  assert.equal(ref.windows.sakura.to, shift(ref.normals.sakura_full_bloom, 7));
  assert.equal(ref.windows.koyo.from, shift(ref.normals.ginkgo_yellow, -14));
  assert.equal(ref.windows.koyo.to, shift(ref.normals.maple_red, 7));
  assert.deepEqual(['02-28', '03-01', '06-01', '09-01', '12-01'].map(monthSeason), ['winter', 'spring', 'summer', 'autumn', 'winter']);
  // 2026-11-12 15:00 UTC is already 13 Nov in Kyoto
  assert.equal(kyotoDate(new Date('2026-11-12T15:00:00Z')).md, '11-13');
  const at = (iso) => seasonFor(new Date(iso), ref);
  assert.deepEqual(at('2026-11-12T03:00:00Z'), { y: 2026, md: '11-12', calendar: 'autumn', highlight: 'koyo', visual: 'autumn' });
  assert.equal(at('2026-12-08T03:00:00Z').calendar, 'winter');
  assert.equal(at('2026-12-08T03:00:00Z').visual, 'autumn'); // leaves still in season
  assert.equal(at('2026-12-20T03:00:00Z').visual, 'winter');
  assert.equal(at('2026-03-20T03:00:00Z').highlight, 'sakura');
  assert.equal(at('2026-03-10T03:00:00Z').visual, 'spring');
  assert.equal(seasonFor(new Date('2026-12-08T03:00:00Z'), null).visual, 'winter'); // without the file: months only
});

// ---------- the tea-room story in the music control ----------
import { traveller, cat, leaf, crane, door, steam, chapterOf, lights, pourPose, PLACES, W as TEA_W, H as TEA_H } from '../src/lib/pixelTea.js';
import { beatMap, beatAt } from '../src/lib/beatClock.js';
test('tea story: the same volume always gives the same picture, whichever way it was reached', () => {
  const snap = (p) => JSON.stringify([traveller(p), cat(p), leaf(p), crane(p), door(p), steam(p), lights(p), pourPose(p)]);
  const ps = Array.from({ length: 101 }, (_, i) => i / 100);
  const forward = ps.map(snap), backward = [...ps].reverse().map(snap).reverse();
  assert.deepEqual(forward, backward);
  assert.equal(snap(0.4372), snap(0.4372));
});
test('tea story: chapters and the main moments sit where the brief puts them', () => {
  assert.equal(chapterOf(0.1), '01 Silence'); assert.equal(chapterOf(0.2), '02 Arrival'); assert.equal(chapterOf(0.4), '03 An unexpected guest');
  assert.equal(chapterOf(0.55), '04 Playful wind'); assert.equal(chapterOf(0.7), '05 The warmth of tea'); assert.equal(chapterOf(0.9), '06 The little miracle'); assert.equal(chapterOf(1), '07 Serenity');
  assert.equal(traveller(0.1).shown, 0); assert.ok(traveller(0.3).shown === 1 && traveller(0.3).walking);
  assert.equal(cat(0.3).visible, false); assert.ok(cat(0.36).ears > 0 && cat(0.36).eyes === 0); assert.ok(cat(0.45).eyes === 1);
  // the leaf rests in the garden, then on the table in the room (world pixels)
  assert.deepEqual([leaf(0.3).x, leaf(0.3).y], PLACES.leafRest); assert.deepEqual([leaf(0.7).x, leaf(0.7).y], PLACES.leafRoom);
  assert.ok(PLACES.leafRest[1] < 43 && PLACES.leafRoom[0] > PLACES.table[0] && PLACES.leafRoom[0] < PLACES.table[1]);
  assert.ok(traveller(0.75).sit === 1 && traveller(0.75).pour > 0);
  assert.equal(crane(0.8), null); assert.ok(crane(0.9).form === 1); assert.ok(crane(1).leafK === 1 && crane(1).y > 35);
  assert.ok(pourPose(0.6).hold === 0 && pourPose(0.75).hold === 1 && pourPose(0.75).flow === 1 && pourPose(0.9).hold === 0);
  assert.ok(traveller(0.75).grip === 1 && traveller(0.9).grip === 0 && traveller(1).cup === 1);
});
test('tea story: everything stays inside the pixel world, and the lights come on in order as the volume rises', () => {
  for (let i = 0; i <= 200; i++) {
    const p = i / 200, T = traveller(p), C = cat(p), L = leaf(p), K = crane(p);
    for (const [x, y] of [[T.x, PLACES.floor], [C.x, C.y], [L.x, L.y], ...(K ? [[K.x, K.y]] : [])]) assert.ok(x >= 0 && x < TEA_W && y >= 0 && y < TEA_H, `p=${p}: ${x},${y}`);
  }
  let last = lights(0);
  assert.deepEqual([last.candle, last.windows, last.door, last.hang, last.lantern], [0, 0, 0, 0, 0]); // volume 0: moonlight only
  for (let i = 1; i <= 200; i++) {
    const g = lights(i / 200);
    for (const k of ['candle', 'windows', 'paper', 'door', 'hang', 'lantern']) assert.ok(g[k] >= last[k], `${k} goes down at ${i / 200}`);
    last = g;
  }
  assert.deepEqual([last.candle, last.windows, last.door, last.hang, last.lantern], [1, 7, 1, 1, 1]);
  // order: candle, the house's windows, the door, the hanging lantern, the stone lantern
  const first = (k, v) => { for (let i = 0; i <= 1000; i++) if (lights(i / 1000)[k] >= v) return i / 1000; };
  assert.ok(first('candle', 1) < first('windows', 1) && first('windows', 7) < first('hang', 1) && first('door', 1) < first('hang', 1) && first('hang', 1) < first('lantern', 1));
});
test('beat clock: the tempo map adds up to the loop in music.json and gives whole numbers on the beats', () => {
  const m = JSON.parse(readFileSync(new URL('../public/data/music.json', import.meta.url)));
  const T = beatMap(m.bpm, m.bars);
  assert.equal(T.length, m.bars * 4 + 1);
  assert.ok(Math.abs(T[m.bars * 4] - (m.loop_end - m.loop_start)) < 0.002, `${T[m.bars * 4]} vs ${m.loop_end - m.loop_start}`);
  for (let i = 1; i < T.length; i++) assert.ok(T[i] - T[i - 1] >= 60 / m.bpm - 1e-9 && T[i] - T[i - 1] < (60 / m.bpm) * 1.04); // only ever a touch slower than 80 BPM
  assert.ok(Math.abs(beatAt(T, T[57]) - 57) < 1e-9 && Math.abs(beatAt(T, (T[10] + T[11]) / 2) - 10.5) < 1e-9);
  assert.ok(Math.abs(beatAt(T, T[m.bars * 4] + T[3]) - 3) < 1e-6 && beatAt(T, -0.01) > m.bars * 4 - 1); // wraps with the loop
});

// ---------- POI audit: DSIGHT_1.csv cross-check, duplicates, added sites ----------
test('POI audit: raw records untouched; confirmed duplicates merged with a pointer; added sites carry two-source evidence', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/raw/attractions.geojson', import.meta.url), 'utf8')).features;
  const rel = J('poi_relations.json');
  const pm = J('point_municipality.json');
  assert.equal(raw.length, 523);
  const ids = new Set(A.map((f) => f.properties.id));
  // every raw record is on the map, merged into one that is, or left out as not a place to visit (with evidence)
  for (const f of raw) {
    const id = f.properties.id;
    if (rel.merged[id]) { assert.ok(!ids.has(id), id); assert.ok(ids.has(rel.merged[id].into), id); assert.ok(rel.merged[id].evidence.length > 40); }
    else if (rel.not_sights[id]) { assert.ok(!ids.has(id), id); assert.ok(rel.not_sights[id].evidence.length > 20, id); }
    else assert.ok(ids.has(id), `${id} missing`);
  }
  assert.equal(Object.keys(rel.not_sights).length, 13);
  assert.deepEqual(Object.keys(rel.merged).sort(), ['A00223', 'A00224', 'A00225', 'A00296', 'A00459']);
  const added = A.filter((f) => f.properties.dsight_ids);
  assert.equal(added.length, 121);
  for (const f of added) {
    const p = f.properties;
    assert.match(p.id, /^A\d{5}$/);
    assert.ok(Number(p.id.slice(1)) > 523, p.id);
    // two sources agree (OSM, Wikidata, the official address placed by GSI), or a reviewed match that quotes
    // the official description, or the official address itself at block level
    assert.match(p.location_evidence, /agree within \d+ m|^Reviewed: the DSIGHT_1\.csv description|^Reviewed: the official Kyoto City address of \d+ is .* lies |placed at its official Kyoto City address, which the GSI address search finds at block level/);
    if (p.wikidata) assert.match(p.wikidata, /^Q\d+$/);
    assert.ok(p.osm_element || p.wikidata || /official Kyoto City address/.test(p.location_evidence), p.id);
    assert.ok(pm.points[p.id], `${p.id} outside the N03 polygons`);
    assert.ok(['attraction', 'museum', 'castle', 'temple', 'shrine', 'garden'].includes(p.category));
    assert.ok(p.category_basis, p.id);
    // no added site repeats a raw record: none has the same name within 700 m
    const [x, y] = f.geometry.coordinates;
    for (const g of raw) {
      const [u, v] = g.geometry.coordinates;
      if (g.properties.name && g.properties.name === p.name) assert.ok(Math.hypot((u - x) * 91290, (v - y) * 111000) > 700, `${p.id} repeats ${g.properties.id}`);
    }
  }
  // CSV records hang under their site; children of an added site point back to it
  for (const [pid, v] of Object.entries(rel.parents)) { assert.ok(ids.has(pid), pid); for (const c of v.children) assert.equal(rel.child_of[c], pid); }
});

test('POI audit: Nanzen-ji is on the map and found by 南禅寺, Nanzen-ji and nanzenji', () => {
  const all = ['attraction', 'viewpoint', 'museum', 'castle', 'temple', 'shrine', 'garden'];
  const data = { attractions: J('attractions.geojson'), transport: J('transport.geojson'), namesEn: J('names_en.json') };
  applyEnglishNames(data);
  const F = data.attractions.features;
  for (const q of ['南禅寺', 'Nanzen-ji', 'nanzenji', 'NANZEN JI']) {
    const hit = filterAttractions(F, all, q).map((f) => f.properties.name);
    assert.ok(hit.includes('南禅寺'), `${q}: ${hit.join(', ')}`);
  }
  const n = F.find((f) => f.properties.name === '南禅寺');
  assert.equal(n.properties.wikidata, 'Q1089767');
  assert.equal(J('point_municipality.json').names[J('point_municipality.json').points[n.properties.id]], '京都市 左京区');
  const kids = J('poi_relations.json').parents[n.properties.id].dsight.map((x) => x.part);
  assert.deepEqual(kids.sort(), ['三門', '方丈', '白檀'].sort());
  // a merged duplicate's ID still finds the record that keeps it
  assert.deepEqual(filterAttractions(F, all, 'A00224').map((f) => f.properties.id), ['A00222']);
});

// ---------- Kyoto City records (DSIGHT_1.csv): every record has an outcome; categories; geography ----------
test('Kyoto City records: all 648 kept with ID, name, source and one of five outcomes; links point at map records', () => {
  const R = J('dsight_records.json');
  assert.equal(R.records.length, 648);
  assert.equal(new Set(R.records.map((r) => r.id)).size, 648);
  assert.equal(R.source.licence, 'CC BY 4.0');
  assert.match(R.source.url, /data\.city\.kyoto\.lg\.jp\/resource\/\?id=7052/);
  const ids = new Set(A.map((f) => f.properties.id));
  const geo = new Set(J('dsight_geography.geojson').features.map((f) => f.properties.csv_id));
  const n = {};
  for (const r of R.records) {
    assert.ok(['attraction', 'sub', 'culture', 'geography', 'unverified'].includes(r.outcome), r.id);
    assert.ok(r.name && r.series, r.id);
    n[r.outcome] = (n[r.outcome] || 0) + 1;
    if (r.site_id) assert.ok(ids.has(r.site_id), `${r.id} -> ${r.site_id}`);
    if (r.outcome === 'sub' || r.outcome === 'attraction') assert.ok(r.site_id, r.id);
    if (r.outcome === 'geography') assert.ok(geo.has(r.id) || r.site_id, r.id);
    if (r.outcome === 'unverified') { assert.ok(!r.site_id && !geo.has(r.id), r.id); assert.ok(r.evidence, r.id); }   // kept, never placed
    for (const m of r.mentions || []) assert.ok(ids.has(m), `${r.id} mentions ${m}`);
  }
  assert.deepEqual(n, R.outcomes);
  // the original text is kept as published
  const raw = readFileSync(new URL('../data/raw/dsight/DSIGHT_1.csv', import.meta.url), 'utf8');
  for (const r of R.records.slice(0, 40)) assert.ok(raw.includes(r.name), r.name);
});

test('categories: temples and shrines told apart with a stated basis; the source category is kept', () => {
  const by = countBy(A, 'category');
  assert.ok(by.temple > 80 && by.shrine > 20 && by.viewpoint === 243 && by.museum === 101 && by.castle === 20, JSON.stringify(by));
  for (const f of A) {
    const p = f.properties;
    assert.ok(p.category_basis, p.id);
    if (!p.dsight_ids) { assert.ok(p.source_category, p.id); if (p.source_category !== 'attraction') assert.equal(p.category, p.source_category); }
    if (p.category === 'shrine') assert.ok(!/株式会社|本社$/.test(p.name || ''), p.name);
  }
  const g = J('dsight_geography.geojson').features;
  assert.ok(g.filter((f) => f.geometry.type === 'Point').length >= 25);
  for (const f of g) if (f.geometry.type === 'Point') assert.match(f.properties.evidence, /agree within \d+ m/);
  assert.ok(g.some((f) => f.geometry.type === 'LineString' && f.properties.kind === 'river'));
});

// ---------- landmark symbols: three levels from the data, a symbol for every record ----------
test('landmark symbols: 15 iconic records exist, levels come from data fields, every record has a symbol to fall back on', async () => {
  const { applyLandmarks, ICONIC, CAT_ICONS } = await import('../src/lib/landmarks.js');
  const data = { attractions: { features: structuredClone(A) }, photos: J('photos.json') };
  applyLandmarks(data);
  const F = data.attractions.features;
  assert.equal(F.length, 626);                                   // nothing is dropped
  const byId = new Map(F.map((f) => [f.properties.id, f.properties]));
  assert.equal(Object.keys(ICONIC).length, 15);
  assert.equal(new Set(Object.values(ICONIC).map((v) => v.icon)).size, 15);
  // the listed IDs are the records they claim to be (checked against the record's own name)
  const NAME = { A00265: '金閣', A00560: '清水寺', A00306: '伏見稲荷大社', A00579: '二条城', A00564: '東寺', A00540: '銀閣寺', A00182: '平等院', A00563: '南禅寺', A00011: '天橋立ビューランド', A00014: '福知山城', A00582: '平安神宮', A00559: '八坂神社', A00553: '三十三間堂', A00566: '法観寺', A00074: '京都タワー' };
  for (const [id, v] of Object.entries(ICONIC)) {
    const q = byId.get(id);
    assert.ok(q, id); assert.equal(q.name, NAME[id]); assert.equal(q.lm_tier, 1); assert.equal(q.lm_icon, 'lm-' + v.icon);
  }
  const names = new Set([...Object.values(ICONIC).map((v) => 'lm-' + v.icon), ...CAT_ICONS.map((c) => 'cat-' + c)]);
  const n = { 1: 0, 2: 0, 3: 0 };
  for (const f of F) {
    const q = f.properties;
    n[q.lm_tier]++;
    assert.ok(names.has(q.lm_icon) && names.has(q.lm_cat), q.id);   // never a blank symbol
    assert.equal(q.lm_cat, 'cat-' + q.category);                    // the fallback is the record's own category
    if (q.lm_tier === 2) assert.ok(q.wikidata || data.photos.photos[q.id] || q.category === 'castle', q.id);
    if (q.lm_tier === 3) assert.ok(!q.wikidata && !data.photos.photos[q.id], q.id);
  }
  assert.equal(n[1], 15);
  // level 2 needs a Wikidata link or a photo, so it grows as photos are added (330 photos: 15 / 332 / 279)
  assert.equal(n[1] + n[2] + n[3], F.length);
  assert.ok(n[2] > 100 && n[3] > 200, JSON.stringify(n));
});

// ---------- study area coverage: polygon intersection, one level, rings drawn separately ----------
test('study area coverage: municipalities only (wards listed under Kyoto City), counted by intersection with a stated tolerance', () => {
  const C = J('study_area_coverage.json');
  assert.equal(C.level, 'municipality');
  assert.equal(C.label, 'Municipalities covered');               // cities, towns and a village: not "Cities"
  assert.equal(C.municipalities.length, 26);
  assert.deepEqual(C.counts.by_type, { city: 15, town: 10, village: 1 });
  assert.equal(C.counts.covered, C.counts.full + C.counts.partial);
  assert.ok(C.tolerance.min_area_m2 > 0 && C.tolerance.full_share < 1);
  const kyoto = C.municipalities.find((m) => m.name === '京都市');
  assert.equal(kyoto.wards.length, 11);
  assert.equal(new Set(C.municipalities.map((m) => m.code)).size, 26);   // no duplicates
  assert.ok(Math.abs(C.study_area.area_km2 - 4612) < 5);                 // Kyoto Prefecture is about 4,612 km²
  const L = J('coverage_lines.geojson').features;
  for (const f of L) {
    assert.equal(f.geometry.type, 'LineString');                          // one ring per line, never joined to another
    const c = f.geometry.coordinates;
    assert.deepEqual(c[0], c[c.length - 1], f.properties.name);           // each ring closes on itself
  }
  assert.equal(new Set(L.map((f) => f.properties.code)).size, 26);
});

test('route: only the service result is used; failures raise, nothing is estimated from a straight line', async () => {
  const { fetchRoute, fmtDuration, fmtDistance, MODES } = await import('../src/lib/route.js');
  assert.deepEqual(MODES.map((m) => m.key), ['foot', 'bike', 'car']);
  assert.equal(fmtDuration(43 * 60), '43 min');
  assert.equal(fmtDuration(107 * 60), '1 h 47 min');
  assert.equal(fmtDistance(3204), '3.20 km');
  assert.equal(fmtDistance(480), '480 m');
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }) });
    await assert.rejects(fetchRoute([135.1, 35.1], [135.2, 35.2], 'foot'), /no route/i);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(fetchRoute([135.1, 35.3], [135.2, 35.2], 'car'), /HTTP 503/);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 1234, duration: 900, geometry: { coordinates: [[135.1, 35.0], [135.15, 35.05], [135.2, 35.1]] } }], waypoints: [{ distance: 3 }, { distance: 120 }] }) });
    const r = await fetchRoute([135.1, 35.0], [135.2, 35.1], 'bike');
    assert.equal(r.distance_m, 1234); assert.equal(r.duration_s, 900); assert.deepEqual(r.snap_m, [3, 120]);
  } finally { globalThis.fetch = real; }
});

test('sort the data: every record once, real counts, the timeline stays inside 15 s', async () => {
  const { buildPlan, goldenSphere, project, rng, along, arcMid, flightEase, DURATION, PHASES } = await import('../src/lib/sortMotion.js');
  const st = J('sort_story.json');
  const raw = JSON.parse(readFileSync(new URL('../data/raw/attractions.geojson', import.meta.url), 'utf8')).features;
  const rel = J('poi_relations.json');
  const ph = J('photos.json').photos;
  // 523 OSM + 121 city sites = 644; 5 merged, 13 left out, 626 on the map, in 6 categories
  assert.equal(st.rows.length, 644);
  assert.equal(new Set(st.rows.map((r) => r[0])).size, 644);
  assert.deepEqual([st.counts.osm_records, st.counts.city_list_added, st.counts.start, st.counts.merged, st.counts.left_out, st.counts.on_map], [523, 121, 644, 5, 13, 626]);
  const byCat = {};
  for (const r of st.rows) if (r[3] === 'map') byCat[r[1]] = (byCat[r[1]] || 0) + 1;
  assert.deepEqual(byCat, Object.fromEntries(Object.entries(countBy(A, 'category'))));
  assert.equal(Object.values(st.counts.by_category).reduce((a, b) => a + b, 0), A.length);
  for (const r of st.rows) {
    const [id, , cell, status, source] = r;
    if (status === 'map') assert.ok(A.some((f) => f.properties.id === id), id);
    if (status === 'merged') assert.ok(rel.merged[id], id);
    if (status === 'left_out') assert.ok(rel.not_sights[id], id);
    assert.equal(source === 'osm', raw.some((f) => f.properties.id === id), id);
    assert.equal(cell >= 0, !!ph[id], `${id} photo cell`);
  }
  assert.equal(st.counts.with_photo, Object.keys(ph).length);
  assert.equal(st.atlas.count, st.rows.filter((r) => r[2] >= 0).length);
  // plan: each record leaves the sphere exactly once, in story order, before the end of the sort phase
  const plan = buildPlan(st.rows, DURATION, rng(3));
  assert.equal(plan.events.length, 644);
  assert.equal(new Set(plan.events.map((e) => e.id)).size, 644);
  const last = (k) => Math.max(...plan.events.filter((e) => e.kind === k).map((e) => e.t));
  const first = (k) => Math.min(...plan.events.filter((e) => e.kind === k).map((e) => e.t));
  assert.ok(last('merge') < first('leftOut') && last('leftOut') < first('sort'));
  assert.ok(last('sort') <= PHASES.sortEnd * DURATION + 1 && last('sort') + 1050 < DURATION);
  // geometry: points on the unit sphere; depth maps to size and opacity; the arc lands on its target
  for (const p of goldenSphere(644)) assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-9);
  const q = project({ x: 0, y: 0, z: 1 }, 0, 0);
  assert.ok(Math.abs(q.depth - 1) < 1e-9 && Math.abs(q.scale - 1.2) < 1e-9);
  const a = { x: 0, y: 0 }, b = { x: 300, y: 120 }, m = arcMid(a, b, rng(9));
  const end = along(a, m, b, flightEase(1));
  assert.ok(Math.abs(end.x - b.x) < 1e-6 && Math.abs(end.y - b.y) < 1e-6 && Math.abs(end.rot) < 1e-9);
});
