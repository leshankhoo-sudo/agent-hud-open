// Browser test against the built site: node tests/e2e.mjs [url] [outdir]
// Needs Playwright with Chromium. Uses the real data files, real tiles and the real Open-Meteo API.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'test-output';
mkdirSync(out, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tiles = { ok: 0, fail: 0 };
const weatherCalls = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('cyberjapandata.gsi.go.jp') || u.includes('tile.openstreetmap.org')) r.ok() ? tiles.ok++ : tiles.fail++;
  if (u.includes('api.open-meteo.com')) weatherCalls.push({ status: r.status(), url: u });
});
page.on('requestfailed', (r) => { if (r.url().includes('api.open-meteo.com')) weatherCalls.push({ status: 'failed', error: r.failure()?.errorText, url: r.url() }); });

await page.goto(url);
await page.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.getLayer('attractions-pt') && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-initial.png` });

// 1. data loading
const fileStatus = await page.evaluate(async () => {
  const names = ['attractions.geojson', 'transport.geojson', 'municipalities_display.geojson', 'prefecture_outline.geojson', 'sample_journeys_display.json', 'walking_routes.geojson', 'manifest.json', 'point_municipality.json', 'analysis/density_kde.geojson', 'analysis/density_kde_meta.json'];
  const r = {};
  for (const n of names) { const x = await fetch('data/' + n); r[n] = x.status; }
  return r;
});
check('all 10 data files load (HTTP 200)', Object.values(fileStatus).every((s) => s === 200), JSON.stringify(fileStatus));
const srcCounts = await page.evaluate(() => {
  const m = window.__kyotoMap;
  return { a: m.getSource('attractions')._data.features.length, t: m.getSource('transport')._data.features.length };
});
check('map sources hold 523 attractions and 5,479 stops', srcCounts.a === 523 && srcCounts.t === 5479, JSON.stringify(srcCounts));
check('basemap tiles load', tiles.ok > 0 && tiles.fail === 0, `${tiles.ok} ok, ${tiles.fail} failed`);

const counts = async () => page.evaluate(() => [...document.querySelectorAll('.count .v')].map((e) => e.textContent.replace(/\s/g, '')));
await page.waitForTimeout(700);
let c = await counts();
check('top counts at start', c[0] === '523/523' && c[1] === '5,479/5,479', c.join(' | '));

// 2. map position: known points render where their coordinates are
const pos = await page.evaluate(async () => {
  const m = window.__kyotoMap;
  m.jumpTo({ center: [135.758, 34.985], zoom: 15 });
  await new Promise((r) => m.once('idle', r));
  const p = m.project([135.7588, 34.9853]);
  const hit = m.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ['transport-pt'] }).map((f) => f.properties.id);
  m.jumpTo({ center: [135.7284537, 35.0395179], zoom: 15 });
  await new Promise((r) => m.once('idle', r));
  const q = m.project([135.7284537, 35.0395179]);
  const hit2 = m.queryRenderedFeatures([[q.x - 4, q.y - 4], [q.x + 4, q.y + 4]], { layers: ['attractions-pt'] }).map((f) => f.properties.id);
  return { kyotoStation: hit, kinkaku: hit2 };
});
check('京都 station S00019 renders at 34.9853 N, 135.7588 E', pos.kyotoStation.includes('S00019'), JSON.stringify(pos.kyotoStation));
check('金閣 A00265 renders at 35.0395 N, 135.7285 E', pos.kinkaku.includes('A00265'), JSON.stringify(pos.kinkaku));

// 3. filters
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { duration: 0 }));
await page.getByLabel('Viewpoint').uncheck();
await page.waitForTimeout(800);
c = await counts();
check('uncheck Viewpoint → 277 attractions', c[0] === '277/523', c[0]);
await page.getByLabel('Bus').uncheck();
await page.waitForTimeout(800);
c = await counts();
check('uncheck Bus → 250 stops (248 rail + 2 tram)', c[1] === '250/5,479', c[1]);
const rendered = await page.evaluate(async () => {
  const m = window.__kyotoMap;
  await new Promise((r) => (m.loaded() ? r() : m.once('idle', r)));
  const f = m.queryRenderedFeatures({ layers: ['transport-pt'] });
  return { types: [...new Set(f.map((x) => x.properties.transport_type))].sort(), viewpoints: m.queryRenderedFeatures({ layers: ['attractions-pt'] }).filter((x) => x.properties.category === 'viewpoint').length };
});
check('map shows no bus stops and no viewpoints after filtering', !rendered.types.includes('bus') && rendered.viewpoints === 0, JSON.stringify(rendered));
await page.screenshot({ path: `${out}/02-filtered.png` });
await page.getByLabel('Viewpoint').check();
await page.getByLabel('Bus').check();

// 4. density modes
await page.getByRole('radio', { name: 'KDE result' }).click();
await page.waitForTimeout(1200);
const kdeVis = await page.evaluate(() => window.__kyotoMap.getLayoutProperty('kde-fill', 'visibility'));
check('KDE layer turns on with documented legend', kdeVis === 'visible' && (await page.locator('.legend').innerText()).includes('2 km'), kdeVis);
await page.screenshot({ path: `${out}/03-kde.png` });
await page.getByRole('radio', { name: 'Visual heatmap' }).click();
await page.waitForTimeout(600);
check('heatmap is labelled as display only', (await page.locator('.warnline').first().innerText()).includes('not a Kernel Density result'));
await page.getByRole('radio', { name: 'Off' }).click();

// 5. walking not available
await page.locator('#q').fill('A00265');
await page.locator('.results button').first().click();
await page.waitForTimeout(1800);
const walkText = await page.locator('.walk-na').innerText();
check('walking panel says "Walking analysis not yet available"', walkText.includes('Walking analysis not yet available'));
check('walking card marked as pilot only', (await page.locator('aside.left').innerText()).includes('Pilot area only'));
const detail = await page.locator('.detail').innerText();
check('detail shows name, ID, category, municipality', detail.includes('金閣') && detail.includes('A00265') && detail.includes('Attraction') && detail.includes('京都市 北区'), detail.replace(/\n/g, ' / ').slice(0, 160));

// 6. weather
await page.waitForSelector('.wx-body, .alert', { timeout: 30000 });
const wxOk = await page.locator('.wx-body').count();
const wxText = (await page.locator('.wx').innerText()).replace(/\n/g, ' / ');
check('weather request sent for the selected point with Asia/Tokyo', weatherCalls.some((w) => w.url.includes('latitude=35.03952') && w.url.includes('timezone=Asia%2FTokyo')), JSON.stringify(weatherCalls.map((w) => w.status)));
if (wxOk) {
  check('weather shows forecast, valid time and retrieval time', /Forecast valid for/.test(wxText) && /Retrieved/.test(wxText), wxText.slice(0, 200));
  const opts = await page.locator('#wx-day option').count();
  check('date selector offers 7 forecast days', opts === 7, String(opts));
} else {
  check('weather failure is shown as an error, with no invented values', /Weather unavailable/.test(wxText) && !/Forecast valid for/.test(wxText), wxText.slice(0, 200));
}
await page.screenshot({ path: `${out}/04-selected-weather.png` });

// 7. weather failure path, using a blocked request
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p2.route('**/api.open-meteo.com/**', (r) => r.abort('internetdisconnected'));
await p2.goto(url);
await p2.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await p2.locator('#q').fill('S00019');
await p2.locator('.results button').first().click();
await p2.waitForSelector('.alert', { timeout: 15000 });
const failText = await p2.locator('.wx').innerText();
check('offline: weather error shown, no temperature displayed', /Weather unavailable/.test(failText) && !/°C/.test(failText), failText.replace(/\n/g, ' / ').slice(0, 160));
await p2.screenshot({ path: `${out}/05-weather-offline.png` });
await p2.close();

// 7b. walking pilot: real routes for a pilot record, separate bus and rail, unreachable shown as such
await page.locator('#q').fill('A00230');
await page.locator('.results button').first().click();
await page.waitForTimeout(2200);
const wt = await page.locator('.walk').innerText();
await page.waitForTimeout(1500);
const routesOnMap = await page.evaluate(() => window.__kyotoMap.getSource('walk')._data.features.map((f) => f.properties.stop_type).sort());
const litStops = await page.evaluate(() => [...document.querySelectorAll('.stop-tag.on')].map((e) => e.innerText.replace(/\n/g, ' ')));
check('pilot record A00230: bus and rail network distances shown', wt.includes('S00602') && wt.includes('74.7') === false && /75 m/.test(wt) && wt.includes('S01877'), wt.replace(/\n/g, ' / ').slice(0, 220));
check('route lines drawn on map for both stop types', JSON.stringify(routesOnMap) === '["bus","rail"]', JSON.stringify(routesOnMap));
check('at 500 m only the bus stop (75 m) lights up; rail (749 m) stays dim', litStops.length === 1 && litStops[0].includes('五条坂'), JSON.stringify(litStops));
await page.screenshot({ path: `${out}/04b-walking-route.png` });
await page.locator('#q').fill('A00172');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const ut = await page.locator('.walk').innerText();
check('A00172 shows unreachable with no distance', ut.includes('unreachable') && ut.includes('distance not available') && !/\d+ m ·/.test(ut));
await page.getByRole('radio', { name: 'Off' }).click();
const cov = await page.locator('.cov').innerText();
check('coverage panel uses the 19 pilot records as denominator', cov.includes('of 19 pilot records'), cov.replace(/\n/g, ' / '));

// 8. journeys panel
await page.getByRole('button', { name: 'Sample journeys & fares' }).click();
await page.waitForTimeout(900);
const jt = await page.locator('.sheet').innerText();
check('journeys panel: 9 journeys, 0 linked, fares and sources visible', jt.includes('9 journeys') && jt.includes('Linked to map: 0') && jt.includes('¥230') && jt.includes('¥500') && jt.includes('Weekends / holidays') && jt.includes('Fare source'));
await page.screenshot({ path: `${out}/06-journeys.png` });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Data & sources' }).click();
await page.waitForTimeout(900);
const st = await page.locator('.sheet').innerText();
check('sources panel: OSM, N03, Open-Meteo, hash check, quality notes', st.includes('ODbL') && st.includes('N03') && st.includes('Open-Meteo') && st.includes('all match') && st.includes('2771085349'));
await page.screenshot({ path: `${out}/07-sources.png` });

// 9. phone layout
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ph.goto(url);
await ph.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await ph.waitForTimeout(1500);
const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
check('phone 390 px: no horizontal page scroll', sw <= 390, `scrollWidth ${sw}`);
await ph.screenshot({ path: `${out}/08-phone.png`, fullPage: false });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
