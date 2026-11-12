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

test('record counts match data_inventory.json', () => {
  const inv = JSON.parse(readFileSync(new URL('../data/raw/package_docs/data_inventory.json', import.meta.url), 'utf8'));
  assert.equal(A.length, inv.attractions.records);
  assert.equal(T.length, inv.transport.records);
  assert.deepEqual(countBy(A, 'category'), inv.attractions.categories);
  assert.deepEqual(countBy(T, 'category'), inv.transport.categories);
});

test('filter counts', () => {
  assert.equal(filterAttractions(A, ['attraction', 'viewpoint', 'museum', 'castle']).length, 523);
  assert.equal(filterAttractions(A, ['museum']).length, 102);
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
  assert.equal(new Set(A.map((f) => f.properties.id)).size, 523);
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
  assert.equal(Object.keys(pm.points).length, 6002);
  assert.equal(pm.names[pm.points.S00019], '京都市 下京区');
  assert.equal(pm.names[pm.points.A00265], '京都市 北区');
});

test('KDE output is documented and consistent', () => {
  const meta = J('analysis/density_kde_meta.json');
  assert.equal(meta.search_radius_m, 2000);
  assert.equal(meta.cell_size_m, 500);
  assert.match(meta.crs, /6674/);
  assert.ok(Math.abs(meta.check_sum_density_x_cell_area - 523) < 40);
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

test('walking prefecture: all 523 records, reasons kept apart, pilot rows reproduced, no straight-line substitutes', () => {
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

test('photos: real files, free licences, credits, and only named records within 300 m', async () => {
  const { existsSync } = await import('node:fs');
  const ph = J('photos.json');
  const A = J('attractions.geojson').features;
  const named = new Set(A.filter((f) => (f.properties.name || '').trim()).map((f) => f.properties.id));
  assert.equal(ph.named_records, named.size);
  assert.equal(Object.keys(ph.photos).length, ph.with_photo);
  for (const [id, p] of Object.entries(ph.photos)) {
    assert.ok(named.has(id), `${id} has no name`);
    assert.ok(existsSync(new URL('../public/' + p.src, import.meta.url)), p.src);
    assert.match(p.license, /^(CC0|Public domain|CC BY(-SA)? [\d.]+)$/);
    assert.ok(!/\b(NC|ND)\b/.test(p.license));
    assert.ok(p.artist && p.page.startsWith('https://commons.wikimedia.org/'));
    assert.ok(p.distance_m <= 300);
    assert.ok(['wikidata-exact', 'wikidata-related', 'commons-geo'].includes(p.match));
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
