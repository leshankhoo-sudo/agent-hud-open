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
  if (u.includes('cyberjapandata.gsi.go.jp') || u.includes('tile.openstreetmap.org') || u.includes('tiles.openfreemap.org')) r.ok() ? tiles.ok++ : tiles.fail++;
  if (u.includes('api.open-meteo.com')) weatherCalls.push({ status: r.status(), url: u });
});
page.on('requestfailed', (r) => { if (r.url().includes('api.open-meteo.com')) weatherCalls.push({ status: 'failed', error: r.failure()?.errorText, url: r.url() }); });

await page.goto(url);
await page.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.getLayer('attractions-pt') && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await page.waitForTimeout(8000); // vector basemap tiles are parsed after load; slow on software WebGL
await page.screenshot({ path: `${out}/01-initial.png` });

// 0. scroll intro: video scrubs with scroll and ends on the dashboard
const intro0 = await page.evaluate(async () => {
  const v = document.querySelector('.intro-v');
  const span = document.querySelector('.intro-s').offsetHeight - innerHeight;
  scrollTo(0, span * 0.5);
  await new Promise((r) => setTimeout(r, 2500));
  const mid = v.currentTime;
  scrollTo(0, span);
  await new Promise((r) => setTimeout(r, 2500));
  return { mid, end: v.currentTime, duration: v.duration };
});
check('intro video follows the scroll (middle ≈ half, end ≈ end)', Math.abs(intro0.mid - intro0.duration / 2) < 1.2 && intro0.end > intro0.duration - 0.6, JSON.stringify(intro0));
await page.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await page.waitForTimeout(800);
check('dashboard follows the intro', await page.evaluate(() => { const r = document.getElementById('dashboard').getBoundingClientRect(); return Math.abs(r.top) < 2; }));

// 0b. Explore Kyoto section: verified photos with credits, a place picker, and a button into the dashboard
const ex = await page.evaluate(async () => {
  const d = await (await fetch('data/explore_places.json')).json();
  const sec = document.getElementById('explore');
  sec.scrollIntoView();
  await new Promise((r) => setTimeout(r, 1500));
  const order = [...document.querySelectorAll('.intro-s, #explore, #dashboard, #credits')].map((e) => e.id || 'intro');
  return { n: d.places.length, licences: [...new Set(d.places.map((p) => p.credit.license))], allCredited: d.places.every((p) => p.credit.artist && p.credit.page && p.credit.license_url && p.municipality.code && p.verified.method), thumbs: sec.querySelectorAll('.ex-thumb').length, order, imgOk: [...sec.querySelectorAll('.ex-card.front img')].every((i) => i.complete && i.naturalWidth > 0) };
});
check('explore: 7 place photos, each with author, licence, source and a checked municipality', ex.n === 7 && ex.allCredited && ex.licences.every((l) => /^(CC0|Public domain|CC BY)/.test(l)), ex.licences.join(', '));
check('explore sits between the original intro and the dashboard; front photo loaded', ex.order.join('>') === 'intro>explore>dashboard>credits' && ex.thumbs === 7 && ex.imgOk, ex.order.join('>'));
await page.locator('.ex-thumb').nth(3).click();
await page.waitForTimeout(4500); // smooth scroll, then the ring eases to its place
const exText = await page.locator('#explore').innerText();
check('picking a place shows its name, municipality and photo credit', exText.includes('平等院') && exText.includes('Uji City') && exText.includes('Martin Falbisoner') && exText.includes('CC BY-SA 4.0'));
const ringA = await page.evaluate(() => ({ rot: +getComputedStyle(document.querySelector('.ex-ring')).getPropertyValue('--rot'), front: document.querySelector('.ex-card.front .ex-cap strong').innerText, pinned: Math.round(document.querySelector('.ex-sticky').getBoundingClientRect().top) }));
check('scrolling turns the photo ring to the chosen card while the section stays pinned', Math.abs(ringA.rot - 3 * 360 / 7) < 4 && ringA.front === '平等院' && ringA.pinned > 0 && ringA.pinned < 80, JSON.stringify(ringA));
await page.locator('.ex-card.front .ex-flip').click();
await page.waitForTimeout(1100);
check('the front card flips to its photo credit', await page.evaluate(() => document.querySelector('.ex-card.front .ex-flip').classList.contains('flipped') && document.querySelector('.ex-card.front .ex-back').innerText.includes('Martin Falbisoner')));
await page.getByRole('button', { name: /Explore Kyoto/ }).click();
await page.waitForTimeout(7000);
const exGo = await page.evaluate(() => { const m = window.__kyotoMap; const c = m.getCenter(); return { top: Math.round(document.getElementById('dashboard').getBoundingClientRect().top), lon: c.lng, lat: c.lat, z: m.getZoom() }; });
check('"Explore Kyoto" opens the dashboard with the map at the chosen place', Math.abs(exGo.top) < 3 && Math.abs(exGo.lon - 135.8077) < 0.01 && Math.abs(exGo.lat - 34.8893) < 0.01 && exGo.z > 14, JSON.stringify(exGo));
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 }));

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
  await new Promise((r) => { m.once('idle', r); setTimeout(r, 6000); }); // the glow animation can keep the map busy
  const p = m.project([135.7588, 34.9853]);
  const hit = m.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ['transport-pt'] }).map((f) => f.properties.id);
  m.jumpTo({ center: [135.7284537, 35.0395179], zoom: 15 });
  await new Promise((r) => { m.once('idle', r); setTimeout(r, 6000); }); // the glow animation can keep the map busy
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
  await new Promise((r) => (m.loaded() ? r() : (m.once('idle', r), setTimeout(r, 6000))));
  const f = m.queryRenderedFeatures({ layers: ['transport-pt'] });
  return { types: [...new Set(f.map((x) => x.properties.transport_type))].sort(), viewpoints: m.queryRenderedFeatures({ layers: ['attractions-pt'] }).filter((x) => x.properties.category === 'viewpoint').length };
});
check('map shows no bus stops and no viewpoints after filtering', !rendered.types.includes('bus') && rendered.viewpoints === 0, JSON.stringify(rendered));
await page.screenshot({ path: `${out}/02-filtered.png` });
await page.getByLabel('Viewpoint').check();
await page.getByLabel('Bus').check();

// 4. density modes (the analysis panels are closed until opened)
await page.getByRole('button', { name: /Attraction Density/ }).click();
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
await page.getByRole('tab', { name: 'Walking Routes' }).click();
const walkText = await page.locator('.walk-na').innerText();
check('outside the pilot the walking tab says "Not calculated yet", with no distance', walkText.includes('Not calculated yet') && !/\d+ m\b/.test(walkText.replace(/\d+ named/, '')), walkText.replace(/\n/g, ' / '));
check('walking entry marked as pilot only', (await page.locator('aside.left').innerText()).includes('Pilot · 19 records'));
await page.getByRole('tab', { name: 'Overview' }).click();
await page.locator('.tech summary').click();
const ovText = await page.locator('#pane-overview').innerText();
check('overview shows the municipal tourism count with year, unit and source', ovText.includes('62,787,000') && ovText.includes('2025') && ovText.includes('not this ward and not this place') && ovText.includes('Tourism Report'), ovText.replace(/\n/g, ' / ').slice(0, 200));
const detail = await page.locator('aside.right').innerText();
check('detail shows name, ID, category, municipality', detail.includes('金閣') && detail.includes('A00265') && detail.includes('Attraction') && detail.includes('京都市 北区'), detail.replace(/\n/g, ' / ').slice(0, 160));

// 6. weather
await page.getByRole('tab', { name: 'Weather' }).click();
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
await p2.getByRole('tab', { name: 'Weather' }).click();
await p2.waitForSelector('.alert', { timeout: 15000 });
const failText = await p2.locator('.wx').innerText();
check('offline: weather error shown, no temperature displayed', /Weather unavailable/.test(failText) && !/°C/.test(failText), failText.replace(/\n/g, ' / ').slice(0, 160));
await p2.screenshot({ path: `${out}/05-weather-offline.png` });
await p2.close();

// 7b. walking pilot: real routes for a pilot record, separate bus and rail, unreachable shown as such
await page.locator('#q').fill('A00230');
await page.locator('.results button').first().click();
await page.waitForTimeout(2200);
await page.getByRole('tab', { name: 'Walking Routes' }).click();
const wt = await page.locator('.walk').innerText();
await page.waitForTimeout(1500);
const routesOnMap = await page.evaluate(() => window.__kyotoMap.getSource('walk')._data.features.map((f) => f.properties.stop_type).sort());
const litStops = await page.evaluate(() => [...document.querySelectorAll('.stop-tag.on')].map((e) => e.innerText.replace(/\n/g, ' ')));
check('within / beyond the chosen distance are labelled separately', wt.includes('Within 500 m') && wt.includes('Beyond 500 m'));
check('pilot record A00230: bus and rail network distances shown', wt.includes('S00602') && wt.includes('74.7') === false && /75 m/.test(wt) && wt.includes('S01877'), wt.replace(/\n/g, ' / ').slice(0, 220));
check('route lines drawn on map for both stop types', JSON.stringify(routesOnMap) === '["bus","rail"]', JSON.stringify(routesOnMap));
check('at 500 m only the bus stop (75 m) lights up; rail (749 m) stays dim', litStops.length === 1 && litStops[0].includes('五条坂'), JSON.stringify(litStops));
await page.screenshot({ path: `${out}/04b-walking-route.png` });
await page.locator('#q').fill('A00172');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const ut = await page.locator('.walk').innerText();
check('A00172 shows unreachable with no distance', ut.includes('No connectable network route') && ut.includes('unreachable') && ut.includes('distance not available') && !/\d+ m ·/.test(ut));
await page.getByRole('button', { name: /Walking Access/ }).click();
const cov = await page.locator('.cov').innerText();
check('coverage panel uses the 19 pilot records as denominator', cov.includes('of 19 pilot records'), cov.replace(/\n/g, ' / '));

// 8. journeys panel
// 7c. theme switch keeps the place, tab, filters, routes and camera; petals appear and are removed
const before = await page.evaluate(() => { const m = window.__kyotoMap; return { theme: document.documentElement.dataset.theme, z: m.getZoom().toFixed(3), c: m.getCenter().toArray().map((v) => v.toFixed(5)).join(), routes: m.getSource('walk')._data.features.length, name: document.querySelector('.detail h2').innerText, tab: document.querySelector('.tabs .on').innerText }; });
const tg = page.getByRole('switch', { name: 'Light theme' });
const tb = await tg.boundingBox();
const fromLeft = before.theme === 'dark';
await page.mouse.move(tb.x + (fromLeft ? 19 : 51), tb.y + 19);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(tb.x + (fromLeft ? 19 + i * 3.4 : 51 - i * 3.4), tb.y + 19); await page.waitForTimeout(80); }
const petalsMid = await page.locator('.petal-layer i').count();
await page.mouse.up();
await page.waitForTimeout(1500);
const after = await page.evaluate(() => { const m = window.__kyotoMap; return { theme: document.documentElement.dataset.theme, z: m.getZoom().toFixed(3), c: m.getCenter().toArray().map((v) => v.toFixed(5)).join(), routes: m.getSource('walk')._data.features.length, name: document.querySelector('.detail h2').innerText, tab: document.querySelector('.tabs .on').innerText, layers: ['attractions-pt', 'transport-pt', 'kde-fill', 'walk-line-bus', 'outline-glow', 'bm-water'].filter((l) => m.getLayer(l)).length, stored: localStorage.getItem('kyoto-gis-theme'), checked: document.querySelector('.theme-toggle').getAttribute('aria-checked') }; });
check('dragging the switch knob changes the theme and remembers it', after.theme !== before.theme && after.stored === after.theme && after.checked === String(after.theme === 'light'), JSON.stringify(after));
check('theme change keeps camera, selected place, tab and walking routes', after.z === before.z && after.c === before.c && after.name === before.name && after.tab === before.tab && after.routes === before.routes, `${before.name} · ${before.tab} · z${before.z}`);
check('map data, analysis and basemap layers are all present after the change', after.layers === 6, String(after.layers));
check('a drag releases only a few petals (1 to 5)', petalsMid >= 1 && petalsMid <= 5, String(petalsMid));
await page.screenshot({ path: `${out}/05b-theme-switched.png` });
await page.waitForTimeout(3600);
check('petals are removed when their animation ends', (await page.locator('.petal-layer i').count()) === 0);
check('petal layer cannot take clicks and adds no scrollbars', await page.evaluate(() => { const l = document.querySelector('.petal-layer'); const s = getComputedStyle(l); return s.pointerEvents === 'none' && s.overflow === 'hidden' && document.documentElement.scrollWidth <= innerWidth; }));
await tg.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('keyboard toggles the theme back', (await page.evaluate(() => document.documentElement.dataset.theme)) === before.theme);
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(300);
check('switch stays in the viewport when the page is scrolled to the intro', await page.evaluate(() => { const r = document.querySelector('.theme-toggle').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }));
await page.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Journeys & Fares' }).click();
await page.waitForTimeout(900);
const jt = await page.locator('.sheet').innerText();
check('journeys panel: 9 journeys, 0 linked, fares and sources visible', jt.includes('9 journeys') && jt.includes('Linked to map: 0') && jt.includes('¥230') && jt.includes('¥500') && jt.includes('Weekends / holidays') && jt.includes('Fare source'));
await page.screenshot({ path: `${out}/06-journeys.png` });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Data & Sources' }).click();
await page.waitForTimeout(900);
const st = await page.locator('.sheet').innerText();
check('sources panel holds the status chips and visitor statistics', st.includes('Map data loaded') && st.includes('Walking: pilot only') && st.includes('Visitor statistics'));
check('sources panel: OSM, N03, Open-Meteo, hash check, quality notes', st.includes('ODbL') && st.includes('N03') && st.includes('Open-Meteo') && st.includes('all match') && st.includes('2771085349'));
await page.screenshot({ path: `${out}/07-sources.png` });

// 9. phone layout
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ph.goto(url);
await ph.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await ph.waitForTimeout(1500);
const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
check('phone 390 px: no horizontal page scroll', sw <= 390, `scrollWidth ${sw}`);
await ph.evaluate(() => document.getElementById('dashboard').scrollIntoView());
check('phone: explore panel starts closed and the map fills the width', (await ph.locator('aside.left').isVisible()) === false && (await ph.evaluate(() => document.querySelector('.center').offsetWidth)) === 390);
await ph.locator('.nav-btn').click();
await ph.locator('#q').fill('A00230');
await ph.locator('.results button').first().click();
await ph.waitForTimeout(1500);
const phs = await ph.evaluate(() => { const r = document.querySelector('aside.right').getBoundingClientRect(); const t = document.querySelector('.theme-toggle').getBoundingClientRect(); const x = document.querySelector('.detail .x:not(.hide-btn)').getBoundingClientRect(); const d = document.getElementById('dashboard').getBoundingClientRect(); return { sheetTop: r.top - d.top, sheetBottom: r.bottom - d.top, vh: d.height, leftShown: getComputedStyle(document.querySelector('aside.left')).display !== 'none', overlap: !(t.right < x.left || t.left > x.right || t.bottom < x.top || t.top > x.bottom), sw: document.documentElement.scrollWidth }; });
check('phone: picking a result closes the drawer and opens a bottom sheet', !phs.leftShown && phs.sheetTop > phs.vh * 0.25 && Math.abs(phs.sheetBottom - phs.vh) < 2, JSON.stringify(phs));
check('phone: theme switch does not cover the close button; still no horizontal scroll', !phs.overlap && phs.sw <= 390);
await ph.screenshot({ path: `${out}/08-phone.png`, fullPage: false });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
