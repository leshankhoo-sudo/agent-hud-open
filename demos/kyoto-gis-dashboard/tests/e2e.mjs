// Browser test against the built site: node tests/e2e.mjs [url] [outdir]
// Needs Playwright with Chromium. Uses the real data files, real tiles and the real Open-Meteo API.
// Playwright is not a project dependency: install it anywhere and point PW_PATH at its folder,
// e.g. PW_PATH=/path/to/node_modules/playwright node tests/e2e.mjs; without PW_PATH it is imported normally.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = process.env.PW_PATH ? createRequire(import.meta.url)(process.env.PW_PATH) : await import('playwright');

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'test-output';
mkdirSync(out, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
// PW_CHANNEL=msedge runs Microsoft Edge, which can decode the H.264 opening video (Playwright's own Chromium cannot).
const browser = await chromium.launch({ proxy, channel: process.env.PW_CHANNEL || undefined, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tiles = { ok: 0, fail: 0 };
const weatherCalls = [];
let mp3Requests = 0;
page.on('request', (r) => { if (r.url().endsWith('.mp3')) mp3Requests++; });
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

// 0. opening. Page 1: the cherry video loops under the project introduction. Page 2: the season story.
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(600);
const op = await page.evaluate(async () => {
  const v = document.querySelector('.ld-video');
  const t0 = v.currentTime; await new Promise((r) => setTimeout(r, 1500)); const t1 = v.currentTime;
  return { can: !!v.canPlayType('video/mp4; codecs="avc1.640034"'), loop: v.loop, muted: v.muted, w: v.videoWidth, h: v.videoHeight, adv: +((t1 - t0 + (t1 < t0 ? v.duration : 0)).toFixed(2)), title: document.querySelector('.ld-title').innerText, stats: document.querySelector('.ld-stats')?.innerText ?? '', team: !!document.querySelector('.ld-team'), menu: [...document.querySelectorAll('.ld-nav li button')].map((b) => b.textContent).join(','), btns: document.querySelectorAll('.ld-btns .wbtn').length, credit: document.querySelector('.ld-credit').innerText };
});
check('page 1: the cherry video loops, muted, full screen (1920x1080 cut on wide screens) and is playing', op.can ? op.loop && op.muted && op.w === 1920 && op.h === 1080 && op.adv > 0.8 : op.loop && op.muted, JSON.stringify({ ...op, title: undefined, stats: undefined, credit: undefined }) + (op.can ? '' : ' (this browser has no H.264 decoder; run with PW_CHANNEL=msedge)'));
check('page 1: title, menu, two water buttons, video credit; the counts and team line are no longer repeated here', op.title.includes('Tourism GIS') && op.menu === 'Seasons,Places,Map,Data,Team' && op.stats === '' && !op.team && op.btns === 2 && op.credit.includes('Pixabay'), op.menu);
await page.hover('.ld-btns .wbtn');
await page.waitForTimeout(1500);
const water = await page.evaluate(() => +getComputedStyle(document.querySelector('.ld-btns .wbtn')).getPropertyValue('--fill'));
check('page 1: hovering a button fills it with liquid (about 93%)', water > 0.8 && water < 1, String(water));
await page.mouse.move(5, 5);
await page.waitForTimeout(1800);
check('page 1: leaving the button drains it', +(await page.evaluate(() => getComputedStyle(document.querySelector('.ld-btns .wbtn')).getPropertyValue('--fill'))) < 0.05);
await page.screenshot({ path: `${out}/00a-landing.png` });
await page.mouse.move(5, 5);
const story = await page.evaluate(async () => {
  const s = document.getElementById('seasons');
  const at = async (p) => { scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * p); await new Promise((r) => setTimeout(r, 1800)); };
  await at(0.03);
  const cv = [...document.querySelectorAll('.scard canvas')];
  const ok = cv.length === 4 && cv.every((c) => c.width > 0) && !document.querySelector('.story.fallback');
  const lines0 = +getComputedStyle(document.querySelector('.sl.big > span')).opacity;
  await at(0.72);
  const on = [...document.querySelectorAll('.scard.on')].map((c) => c.querySelector('figcaption span').textContent.toLowerCase());
  const now = [...document.querySelectorAll('.scard.now')].length;
  return { ok, lines0, lines1: +getComputedStyle(document.querySelector('.sl.big > span')).opacity, nums: [...document.querySelectorAll('.sl.nums b')].map((b) => b.textContent), season: document.documentElement.dataset.season, pill: document.querySelector('.story-now').innerText, on, now, credit: document.querySelector('.story-credit').innerText };
});
check('page 2: four season cards, each drawn with WebGL (no fallback)', story.ok);
check('page 2: the card of the season it is now is the highlighted one, marked "Now in Kyoto"', story.on.length === 1 && story.on[0] === story.season && story.now === 1, JSON.stringify({ on: story.on, season: story.season }));
check('page 2: story lines appear with the scroll, counts roll up to the data totals', story.lines0 < 0.2 && story.lines1 > 0.9 && story.nums.join('|') === '523|5,479', JSON.stringify({ l0: story.lines0, l1: story.lines1, nums: story.nums }));
check('page 2: "Now in Kyoto" line follows the season; image source stated as unverified', story.pill.toLowerCase().includes(story.season) && story.credit.includes('Pinterest') && story.credit.includes('illustrative'), story.pill.replace(/\n/g, ' '));
const other = story.season === 'winter' ? 'spring' : 'winter';
await page.locator(`.scard-pick[aria-label="Use the ${other} theme"]`).click();
await page.waitForTimeout(500);
const picked = await page.evaluate(() => ({ s: document.documentElement.dataset.season, on: document.querySelector('.scard.on figcaption span').textContent.toLowerCase(), stored: localStorage.getItem('kyoto-gis-season') }));
check('page 2: clicking a card switches the season theme and the highlight', picked.s === other && picked.on === other && picked.stored === other, JSON.stringify(picked));
await page.locator(`.scard-pick[aria-label="Use the ${story.season} theme"]`).click();
await page.waitForTimeout(400);
check('page 2: clicking the card of the current season goes back to Auto', (await page.evaluate(() => localStorage.getItem('kyoto-gis-season'))) === 'auto');
await page.screenshot({ path: `${out}/00b-story.png` });

// 0a. depth: the panorama answers the pointer, near layers more than far ones; joins between sections are sharp
const shift = async (x) => {
  await page.mouse.move(x, 450, { steps: 6 });
  await page.waitForTimeout(1600);
  return page.evaluate(() => Object.fromEntries(['far', 'city', 'fore'].map((k) => [k, document.querySelector('.pano-' + k).getBoundingClientRect().left])));
};
await page.evaluate(() => { const e = document.getElementById('panorama'); const r = e.getBoundingClientRect(); scrollTo(0, r.top + scrollY + r.height / 2 - innerHeight / 2); });
await page.waitForTimeout(900);
const pL = await shift(140), pR = await shift(1300);
const moved = { far: pL.far - pR.far, city: pL.city - pR.city, fore: pL.fore - pR.fore };
check('panorama: layers slide with the pointer, the near ones further than the far ones', moved.far > 4 && moved.city > moved.far * 2 && moved.fore > moved.city * 2, JSON.stringify(moved));
const pano = await page.evaluate(() => ({ note: document.querySelector('.pano-note').textContent, layers: document.querySelectorAll('.pano-l').length, title: document.getElementById('pano-title').textContent }));
check('panorama: stated to be an illustration, not map data', /Illustration/.test(pano.note) && /not map data/.test(pano.note) && pano.layers >= 8, JSON.stringify(pano));
await page.screenshot({ path: `${out}/00c-panorama.png` });
await page.locator('.pano-next').click();
await page.waitForTimeout(1500);
check('panorama: its button leads on to Explore', await page.evaluate(() => Math.abs(document.getElementById('explore').getBoundingClientRect().top) < 4));
const joins = await page.evaluate(() => {
  const cs = (sel) => getComputedStyle(document.querySelector(sel));
  const seams = [...document.querySelectorAll('.seam')];
  const blurred = seams.some((el) => [el, ...el.querySelectorAll('*')].some((n) => /blur/.test(getComputedStyle(n).filter) || /blur/.test(getComputedStyle(n, '::before').filter) || /blur/.test(getComputedStyle(n, '::after').filter)));
  const mask = (sel) => { const c = cs(sel); return c.maskImage && c.maskImage !== 'none' ? c.maskImage : (c.webkitMaskImage && c.webkitMaskImage !== 'none' ? c.webkitMaskImage : 'none'); };
  // a join must not sit on top of the sections on either side of it
  const clear = seams.every((el) => { const r = el.getBoundingClientRect(), a = el.previousElementSibling.getBoundingClientRect(), b = el.nextElementSibling.getBoundingClientRect(); return r.height >= 100 && a.bottom <= r.top + 1 && b.top >= r.bottom - 1; });
  return { n: seams.length, blurred, clear, explore: mask('.explore'), outro: mask('.outro'), marks: seams.map((el) => el.querySelector('.seam-mark').textContent).join('') };
});
check('joins between sections: three, each with its own space, no blur, and no fade laid over a section', joins.n === 3 && !joins.blurred && joins.clear && joins.explore === 'none' && joins.outro === 'none', JSON.stringify(joins));
// page counter on the right: follows the scroll, its faint numbers step to the next part, hidden over the map
const pg = async () => page.evaluate(() => { const n = document.querySelector('.pager'), on = n.querySelector('[aria-current]'); return { now: on.textContent, label: on.getAttribute('aria-label'), off: n.classList.contains('off'), n: n.querySelectorAll('button').length }; });
await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
const pg1 = await pg();
await page.locator('.pager button').nth(1).click(); await page.waitForTimeout(1500);
const pg2 = await pg();
check('page counter: seven numbers, 01 large on the cover; clicking 02 scrolls to the seasons', pg1.n === 7 && pg1.now === '01' && pg2.now === '02' && pg2.label === '02 Seasons' && Math.abs(await page.evaluate(() => document.getElementById('seasons').getBoundingClientRect().top)) < 4, JSON.stringify([pg1, pg2]));
await page.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await page.waitForTimeout(800);
check('dashboard follows the opening', await page.evaluate(() => { const r = document.getElementById('dashboard').getBoundingClientRect(); return Math.abs(r.top) < 2; }));
await page.waitForTimeout(400);
check('page counter hides over the map', (await pg()).off);

// 0b. Explore Kyoto section: verified photos with credits, a place picker, and a button into the dashboard
const ex = await page.evaluate(async () => {
  const d = await (await fetch('data/explore_places.json')).json();
  const sec = document.getElementById('explore');
  sec.scrollIntoView();
  await new Promise((r) => setTimeout(r, 1500));
  const order = [...document.querySelectorAll('#top, #seasons, #explore, #features, #dashboard, #credits')].map((e) => e.id);
  return { n: d.places.length, licences: [...new Set(d.places.map((p) => p.credit.license))], allCredited: d.places.every((p) => p.credit.artist && p.credit.page && p.credit.license_url && p.municipality.code && p.verified.method), thumbs: sec.querySelectorAll('.ex-dot').length, order, imgOk: [...sec.querySelectorAll('.ex-card.front img')].every((i) => i.complete && i.naturalWidth > 0) };
});
check('explore: 7 place photos, each with author, licence, source and a checked municipality', ex.n === 7 && ex.allCredited && ex.licences.every((l) => /^(CC0|Public domain|CC BY)/.test(l)), ex.licences.join(', '));
check('page order: video, seasons, explore, features, dashboard, credits; front photo loaded', ex.order.join('>') === 'top>seasons>explore>features>dashboard>credits' && ex.thumbs === 7 && ex.imgOk, ex.order.join('>'));
await page.locator('.ex-dot').nth(3).click();
await page.waitForTimeout(2500); // the deck glides to its place
const exText = await page.locator('#explore').innerText();
check('picking a place shows its name, municipality and photo credit', exText.includes('平等院') && exText.includes('Uji City') && exText.includes('Martin Falbisoner') && exText.includes('CC BY-SA 4.0') && /\d+ attractions? within 1 km/.test(exText));
const ringA = await page.evaluate(() => ({ rot: +document.querySelectorAll('.ex-card')[3].style.getPropertyValue('--o'), side: +document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--o'), front: document.querySelector('.ex-card.front .ex-cap strong').innerText, bg: [...document.querySelectorAll('.ex-bg i')].findIndex((e) => e.classList.contains('on')), h: document.getElementById('explore').offsetHeight }));
check('picking a place glides the card deck there and swaps the blurred backdrop; the section is one screen tall', Math.abs(ringA.rot) < 0.06 && Math.abs(ringA.side - 1) < 0.06 && ringA.front === '平等院' && ringA.bg === 3 && ringA.h <= 920, JSON.stringify(ringA));
const dk = await page.locator('.ex-deck').boundingBox();
await page.mouse.move(dk.x + dk.width / 2, dk.y + dk.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(dk.x + dk.width / 2 + i * 22, dk.y + dk.height / 2); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(1500);
check('dragging the deck sideways moves to the previous card', (await page.locator('.ex-card.front .ex-cap strong').innerText()) === '嵯峨野 竹林の小径');
await page.locator('.ex-dot').nth(3).click();
await page.waitForTimeout(1800);
await page.locator('.ex-card.front .ex-flip').click();
await page.waitForTimeout(1100);
check('the front card flips to its photo credit', await page.evaluate(() => document.querySelector('.ex-card.front .ex-flip').classList.contains('flipped') && document.querySelector('.ex-card.front .ex-back').innerText.includes('Martin Falbisoner')));
await page.getByRole('button', { name: /Explore Kyoto/ }).click();
await page.waitForTimeout(7000);
const exGo = await page.evaluate(() => { const m = window.__kyotoMap; const c = m.getCenter(); return { top: Math.round(document.getElementById('dashboard').getBoundingClientRect().top), lon: c.lng, lat: c.lat, z: m.getZoom() }; });
check('"Explore Kyoto" opens the dashboard with the map at the chosen place', Math.abs(exGo.top) < 3 && Math.abs(exGo.lon - 135.8077) < 0.01 && Math.abs(exGo.lat - 34.8893) < 0.01 && exGo.z > 14, JSON.stringify(exGo));
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 }));

// 0c. feature strip and music
await page.evaluate(() => document.getElementById('features').scrollIntoView());
await page.waitForTimeout(900);
await page.locator('.ft-panel').nth(4).hover();
await page.waitForTimeout(1100);
const ftw = await page.evaluate(() => [...document.querySelectorAll('.ft-panel')].map((e) => Math.round(e.getBoundingClientRect().width)));
check('feature strip: the hovered panel opens sideways, the others fold', ftw[4] > 4 * ftw[0] && (await page.locator('.ft-panel.open h3').innerText()) === 'Journeys & Fares', ftw.join(','));
await page.locator('.ft-panel.open .ft-go').click();
await page.waitForTimeout(1500);
check('feature panel button opens that part of the dashboard', (await page.locator('.sheet').innerText()).includes('9 journeys'));
await page.keyboard.press('Escape');
const mp3Before = mp3Requests;
await page.locator('.music-btn').click();
await page.waitForFunction(() => /playing|error/.test(document.querySelector('.music').className), null, { timeout: 20000 });
check('music: nothing is downloaded until play is pressed; then it plays and can be paused', mp3Before === 0 && mp3Requests === 1 && (await page.locator('.music').getAttribute('class')).includes('playing'), `${mp3Before} -> ${mp3Requests}`);
await page.locator('.music-btn').click();
// the same control is the volume: dragging the glass dome along the window changes it, and sliding it up starts the music
await page.waitForTimeout(500);
const dome = async () => page.evaluate(() => { const r = document.querySelector('.music-btn').getBoundingClientRect(), s = document.querySelector('.koto-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: s.left, w: s.width, vol: Number(document.querySelector('.koto-range input').value), cls: document.querySelector('.music').className }; });
await page.locator('.music').hover();
await page.waitForTimeout(900);
const d0 = await dome();
await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move(d0.left + d0.w * 0.82, d0.y, { steps: 8 }); await page.mouse.up();
await page.waitForFunction(() => /playing/.test(document.querySelector('.music').className), null, { timeout: 10000 });
await page.waitForTimeout(900);
const d1 = await dome();
check('music: the room opens under the pointer; dragging the glass dome raises the volume and starts the music', d0.w > 250 && !/playing/.test(d0.cls) && d1.vol > d0.vol + 0.2 && d1.vol > 0.85 && d1.x > d0.x + 40 && mp3Requests === 1, JSON.stringify({ w: d0.w, v0: d0.vol, v1: d1.vol }));
const lit = await page.evaluate(() => { const c = document.querySelector('.koto-cv'), g = c.getContext('2d'); const k = c.width / 280; const px = g.getImageData(Math.round(123 * k), Math.round(54 * k), 1, 1).data; return { w: c.width, rgb: [px[0], px[1], px[2]], cap: document.querySelector('.koto-cap').textContent }; });
check('music: the volume moves the story; near the top it is at the miracle or the serenity chapter, and the caption names it', /Kyoto, Slowly · \d+% · 0[67] /.test(lit.cap) && lit.w > 280, lit.cap);
// tapping something in the room (here the wind bell, clear of the lens at this volume) makes it react and does not touch the volume or the music
const tapB = await dome();
await page.locator('.music').hover(); await page.waitForTimeout(700);
const stg = await page.locator('.koto-stage').boundingBox();
await page.mouse.click(stg.x + ((13 + (50 / 192) * 254) / 280) * stg.width, stg.y + ((13 + (21 / 59) * 78) / 108) * stg.height); // the bell is at (50, 21) of the 192 x 59 world
await page.waitForTimeout(300);
const tapA = await dome();
const rung = await page.evaluate(() => document.querySelector('.music').__foley.log.includes('chime'));
check('music: a tap on the wind bell in the room rings it and leaves the volume and the music as they were', tapA.vol === tapB.vol && /playing/.test(tapA.cls) && rung, `${tapB.vol} -> ${tapA.vol}, rung ${rung}`);
// the room keeps time with the music: the beat it reads follows the piece's own tempo (80 BPM, a touch slower in the rubato)
const beatA = await page.evaluate(() => ({ b: document.querySelector('.music').__scene.beat, t: performance.now() }));
await page.waitForTimeout(3000);
const beatB = await page.evaluate(() => ({ b: document.querySelector('.music').__scene.beat, t: performance.now() }));
const bps = ((beatB.b - beatA.b + 192) % 192) / ((beatB.t - beatA.t) / 1000);
check('music: the pixel room follows the beat of the piece (about 80 beats a minute)', bps > 1.25 && bps < 1.36, `${(bps * 60).toFixed(1)} BPM`);
// the picture is pixel art: a small sheet (192 x 59) painted from a fixed palette of 13 hues x 8 tones, no in-between colours
const pix = await page.evaluate(() => {
  const c = document.querySelector(".music").__world, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return { w: c.width, h: c.height, colours: seen.size };
});
check("music: the room is drawn as pixel art from a small fixed palette", pix.w === 192 && pix.h === 59 && pix.colours >= 12 && pix.colours <= 104, JSON.stringify(pix));
await page.locator('.koto-range input').focus();
await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
const d2 = await dome();
check('music: the volume can be set from the keyboard', Math.abs(d1.vol - d2.vol - 0.04) < 0.001, `${d1.vol} -> ${d2.vol}`);
await page.locator('.music-btn').focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => !/playing/.test(document.querySelector('.music').className), null, { timeout: 5000 });
await page.waitForTimeout(2600);
const pausedCap = await page.locator('.koto-cap').textContent();
check('music: pausing from the keyboard stops it; the story stays where the volume is', /Slide the glass to play/.test(pausedCap) && Math.abs((await dome()).vol - d2.vol) < 0.001, pausedCap);
await page.screenshot({ path: `${out}/00d-music.png` });
await page.evaluate(() => document.activeElement?.blur());
await page.mouse.move(400, 500);
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 }));

// 1. data loading
const fileStatus = await page.evaluate(async () => {
  const names = ['attractions.geojson', 'transport.geojson', 'municipalities_display.geojson', 'prefecture_outline.geojson', 'sample_journeys_display.json', 'walking_routes.geojson', 'walking_routes_prefecture.geojson', 'analysis/walking_prefecture_report.json', 'manifest.json', 'point_municipality.json', 'analysis/density_kde.geojson', 'analysis/density_kde_meta.json'];
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
await page.locator('.entry', { hasText: 'Attraction Density' }).click();
await page.getByRole('radio', { name: 'KDE result' }).click();
await page.waitForTimeout(1200);
const kdeVis = await page.evaluate(() => window.__kyotoMap.getLayoutProperty('kde-fill', 'visibility'));
check('KDE layer turns on with documented legend', kdeVis === 'visible' && (await page.locator('.legend').innerText()).includes('2 km'), kdeVis);
await page.screenshot({ path: `${out}/03-kde.png` });
await page.getByRole('radio', { name: 'Visual heatmap' }).click();
await page.waitForTimeout(600);
check('heatmap is labelled as display only', (await page.locator('.warnline').first().innerText()).includes('not a Kernel Density result'));
await page.getByRole('radio', { name: 'Off' }).click();

// 5. walking, prefecture-wide: a record far from the old pilot box has network results
await page.locator('#q').fill('A00265');
await page.locator('.results button').first().click();
await page.waitForTimeout(1800);
await page.getByRole('tab', { name: 'Walking Routes' }).click();
const walkText = await page.locator('.walk').innerText();
check('Kinkaku-ji (outside the old pilot) now shows network walking distances', /\d+ m · ≈[\d.]+ min walk/.test(walkText) && !walkText.includes('Pilot result'), walkText.replace(/\n/g, ' / ').slice(0, 200));
check('walking entry shows the prefecture record count', (await page.locator('aside.left').innerText()).includes('523 records'));
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
await page.locator('#q').fill('A00119');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const ut = await page.locator('.walk').innerText();
check('A00119 (hilltop paths not joined to the streets) says so, with no distance', ut.includes('Not connected to the street network') && ut.includes('unreachable') && ut.includes('distance not available') && !/\d+ m ·/.test(ut));
await page.locator('#q').fill('A00401');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const nt = await page.locator('.walk').innerText();
check('A00401 says no bus stop within 3 km on foot, kept apart from "not connected"', nt.includes('No bus stop within 3 km on foot') && !nt.includes('Not connected'), nt.replace(/\n/g, ' / ').slice(0, 200));
await page.locator('#q').fill('A00453');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const zt = await page.locator('.walk').innerText();
check('A00453 and its station share a street point: shown as "Next to this place", not as 0 m', zt.includes('Next to this place') && !/\b0 m\b/.test(zt), zt.replace(/\n/g, ' / ').slice(0, 220));
await page.locator('.entry', { hasText: 'Walking Access' }).click();
const cov = await page.locator('.cov').innerText();
check('coverage counts named + OSM-tagged records by default (357), five states listed', cov.includes('of 357 records') && cov.includes('within 3 km on foot') && cov.includes('Not connected to the street network'), cov.replace(/\n/g, ' / '));
await page.getByRole('button', { name: /^Unverified/ }).click();
check('including unverified records raises the denominator to 523', (await page.locator('.cov').innerText()).includes('of 523 records'));
await page.getByRole('button', { name: /^Unverified/ }).click();
await page.locator('#q').fill('');
await page.getByRole('button', { name: 'Show routes on map' }).click();
await page.waitForTimeout(2500);
const bulk = await page.evaluate(() => ({ lines: window.__kyotoMap.getSource('walk')._data.features.length, rings: window.__kyotoMap.getSource('walk-stops')._data.features.length, tags: document.querySelectorAll('.stop-tag').length }));
check('prefecture view draws hundreds of routes with ring markers instead of DOM labels', bulk.lines > 300 && bulk.rings > 100 && bulk.tags === 0, JSON.stringify(bulk));
await page.getByRole('button', { name: 'Hide routes on map' }).click();

// 8. journeys panel
// 7b2. bus routes (Kyoto City Bus): pick a route, the line grows along the supplied geometry and stops light up in order
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 }));
await page.locator('.entry', { hasText: 'Bus Routes' }).click();
const busKey = await page.evaluate(() => [...document.querySelectorAll('#bus-route option')].find((o) => o.textContent.startsWith('206 ')).value);
await page.locator('#bus-route').selectOption(busKey);
await page.waitForFunction(() => document.querySelectorAll('.bus-stop.passed').length >= 3, null, { timeout: 20000 });
const bus1 = await page.evaluate(() => { const m = window.__kyotoMap; const st = [...document.querySelectorAll('.bus-stop')]; const passed = st.map((e, i) => (e.classList.contains('passed') ? i : -1)).filter((i) => i >= 0); return { total: st.length, passed: passed.length, contiguous: passed.every((v, i) => v === i), full: m.getSource('bus-full')._data.geometry.coordinates.length, lit: m.getSource('bus-lit')._data.geometry?.coordinates.length || 0, dirs: document.querySelectorAll('#an-bus .bus-dir').length }; });
check('bus route 206: whole line shown thin, bright line partly grown, stops lit in order from the first', bus1.total === 58 && bus1.passed < bus1.total && bus1.contiguous && bus1.lit > 1 && bus1.lit < bus1.full && bus1.dirs === 2, JSON.stringify(bus1));
await page.locator('.bus-bar').getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(500);
const bus2 = await page.evaluate(() => ({ passed: document.querySelectorAll('.bus-stop.passed').length, bar: document.querySelector('.bus-bar').innerText, lit: window.__kyotoMap.getSource('bus-lit')._data.geometry.coordinates.length, full: window.__kyotoMap.getSource('bus-full')._data.geometry.coordinates.length }));
check('skip shows the complete route and all stops; Replay is offered', bus2.passed === 58 && bus2.lit === bus2.full && bus2.bar.includes('end of route') && bus2.bar.includes('Replay'), bus2.bar.replace(/\n/g, ' | '));
await page.locator('.bus-stop').nth(4).click();
check('clicking a route stop shows its name and sequence', (await page.locator('.bus-stop.pinned').innerText()).includes('stop 5 of 58'));
await page.locator('#an-bus .bus-dir').nth(1).click();
await page.waitForFunction(() => document.querySelectorAll('.bus-stop.passed').length >= 1 && document.querySelectorAll('.bus-stop.passed').length < 20, null, { timeout: 20000 });
check('switching direction replaces the previous route and its highlights at once', (await page.locator('.bus-dir.on').count()) === 1 && (await page.locator('.bus-stop').count()) === 58 && (await page.locator('.bus-stop.pinned').count()) === 0);
await page.locator('#bus-route').selectOption({ label: await page.evaluate(() => [...document.querySelectorAll('#bus-route option')].find((o) => o.textContent.includes('(stops only)')).textContent) });
await page.waitForTimeout(800);
const bus3 = await page.evaluate(() => ({ markers: document.querySelectorAll('.bus-stop').length, bar: document.querySelector('.bus-bar').innerText, hl: window.__kyotoMap.getFilter('bus-hl')[2][1].length, lit: window.__kyotoMap.getSource('bus-lit')._data.features?.length }));
check('a route without a verified line draws no line: only its stop points are highlighted, with a notice', bus3.markers === 0 && bus3.hl > 0 && bus3.lit === 0 && bus3.bar.includes('Route animation not available yet'), JSON.stringify(bus3).slice(0, 200));
await page.locator('.bus-bar').getByRole('button', { name: 'Close route' }).click();
await page.locator('#q').fill('四条河原町');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
await page.getByRole('tab', { name: 'Bus Routes' }).click();
const busAt = await page.evaluate(() => ({ routes: [...document.querySelectorAll('.bus-list .bus-no')].map((e) => e.innerText), first: document.querySelector('.bus-list .bus-dir').innerText, fare: document.querySelector('.bus-list .bus-fare').innerText }));
check('a bus stop lists the routes serving it, each direction with its next stop, and the separate fare', busAt.routes.includes('205') && /next stop/.test(busAt.first) && busAt.fare.includes('¥230'), `${busAt.routes.length} routes · ${busAt.first.replace(/\n/g, ' / ')}`);
await page.locator('.bus-list .bus-dir').first().click();
await page.waitForFunction(() => document.querySelectorAll('.bus-stop.passed').length >= 2, null, { timeout: 20000 });
const busFrom = await page.evaluate(() => { const st = [...document.querySelectorAll('.bus-stop')]; const before = st.filter((e) => e.classList.contains('before')).length; const firstLit = st.findIndex((e) => e.classList.contains('passed')); return { before, firstLit, name: st[firstLit].querySelector('b').innerText, bar: document.querySelector('.bus-bar b').innerText }; });
check('from a stop, the animation starts at that stop and runs towards the terminal; earlier stops stay quiet', busFrom.firstLit === busFrom.before && busFrom.name === '四条河原町' && busFrom.bar.startsWith('四条河原町 →'), JSON.stringify(busFrom));
await page.locator('.bus-bar').getByRole('button', { name: 'Close route' }).click();
await page.locator('#q').fill('A00230');
await page.locator('.results button').first().click();
await page.waitForTimeout(2200);
await page.getByRole('tab', { name: 'Walking Routes' }).click();
await page.locator('.entry', { hasText: 'Bus Routes' }).click();

// 7c. theme switch keeps the place, tab, filters, routes and camera; petals appear and are removed
const before = await page.evaluate(() => { const m = window.__kyotoMap; return { theme: document.documentElement.dataset.theme, z: m.getZoom().toFixed(3), c: m.getCenter().toArray().map((v) => v.toFixed(5)).join(), routes: m.getSource('walk')._data.features.length, name: document.querySelector('.detail h2').innerText, tab: document.querySelector('.tabs .on').innerText }; });
const tg = page.getByRole('switch', { name: 'Light theme' });
const tb = await tg.boundingBox();
const fromLeft = before.theme === 'dark';
await page.mouse.move(tb.x + (fromLeft ? 19 : 51), tb.y + 19);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(tb.x + (fromLeft ? 19 + i * 3.4 : 51 - i * 3.4), tb.y + 19); await page.waitForTimeout(80); }
const petalsMid = await page.locator('.petal-layer i').count();
const themeMid = await page.evaluate(() => document.documentElement.dataset.theme);
await page.mouse.up();
await page.waitForTimeout(1500);
const after = await page.evaluate(() => { const m = window.__kyotoMap; return { theme: document.documentElement.dataset.theme, z: m.getZoom().toFixed(3), c: m.getCenter().toArray().map((v) => v.toFixed(5)).join(), routes: m.getSource('walk')._data.features.length, name: document.querySelector('.detail h2').innerText, tab: document.querySelector('.tabs .on').innerText, layers: ['attractions-pt', 'transport-pt', 'kde-fill', 'walk-line-bus', 'outline-glow', 'bm-water'].filter((l) => m.getLayer(l)).length, stored: localStorage.getItem('kyoto-gis-theme'), checked: document.querySelector('.theme-toggle').getAttribute('aria-checked') }; });
check('dragging the switch knob changes the theme and remembers it', after.theme !== before.theme && after.stored === after.theme && after.checked === String(after.theme === 'light'), JSON.stringify(after));
check('theme change keeps camera, selected place, tab and walking routes', after.z === before.z && after.c === before.c && after.name === before.name && after.tab === before.tab && after.routes === before.routes, `${before.name} · ${before.tab} · z${before.z}`);
check('map data, analysis and basemap layers are all present after the change', after.layers === 6, String(after.layers));
check('while the key is held, the page theme does not change (only on release)', themeMid === before.theme, themeMid);
check('a drag releases only a few petals (1 to 5)', petalsMid >= 1 && petalsMid <= 5, String(petalsMid));
await page.screenshot({ path: `${out}/05b-theme-switched.png` });
await page.waitForTimeout(3600);
check('petals are removed when their animation ends', (await page.locator('.petal-layer i').count()) === 0);
check('petal layer cannot take clicks and adds no scrollbars', await page.evaluate(() => { const l = document.querySelector('.petal-layer'); const s = getComputedStyle(l); return s.pointerEvents === 'none' && s.overflow === 'hidden' && document.documentElement.scrollWidth <= innerWidth; }));
await tg.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('keyboard toggles the theme back', (await page.evaluate(() => document.documentElement.dataset.theme)) === before.theme);
const swc = await page.evaluate(() => { const c = document.querySelector('.theme-toggle .tt-canvas'); const s = getComputedStyle(c); return { pe: s.pointerEvents, w: c.width, cw: c.getBoundingClientRect().width, dpr: devicePixelRatio, role: document.querySelector('.theme-toggle').getAttribute('role') }; });
check('the switch is drawn on a high-resolution canvas that takes no pointer events; the button is the switch', swc.pe === 'none' && swc.role === 'switch' && Math.abs(swc.w - swc.cw * Math.min(3, swc.dpr)) <= 2, JSON.stringify(swc));
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(300);
check('switch stays in the viewport when the page is scrolled to the intro', await page.evaluate(() => { const r = document.querySelector('.theme-toggle').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }));
await page.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await page.waitForTimeout(400);

await page.locator('.status').getByRole('button', { name: 'Journeys & Fares' }).click();
await page.waitForTimeout(900);
const jt = await page.locator('.sheet').innerText();
check('journeys panel: 9 journeys, 0 linked, fares and sources visible', jt.includes('9 journeys') && jt.includes('Linked to map: 0') && jt.includes('¥230') && jt.includes('¥500') && jt.includes('Weekends / holidays') && jt.includes('Fare source'));
await page.screenshot({ path: `${out}/06-journeys.png` });
await page.keyboard.press('Escape');
await page.locator('.status').getByRole('button', { name: 'Data & Sources' }).click();
await page.waitForTimeout(900);
const st = await page.locator('.sheet').innerText();
check('sources panel holds the status chips and visitor statistics', st.includes('Map data loaded') && st.includes('Walking: prefecture (523 records)') && st.includes('Visitor statistics'));
check('sources panel: OSM, N03, Open-Meteo, hash check, quality notes', st.includes('ODbL') && st.includes('N03') && st.includes('Open-Meteo') && st.includes('all match') && st.includes('2771085349'));
await page.screenshot({ path: `${out}/07-sources.png` });
await page.keyboard.press('Escape');

// 7d. season from Kyoto's date, English first, site context, name terms, wa details
const { seasonFor } = await import('../src/lib/season.js');
const seasonRef = await (await fetch(new URL('data/season_kyoto.json', url))).json();
const expSeason = seasonFor(new Date(), seasonRef);
const seasonNow = await page.evaluate(() => document.documentElement.dataset.season);
check('season theme follows Kyoto\'s date and the JMA windows', seasonNow === expSeason.visual, `${seasonNow} vs ${JSON.stringify(expSeason)}`);
await page.locator('.season-badge summary').click();
const sb = await page.locator('.season-pop').innerText();
check('season badge explains the date, the JMA calendar and links the source', sb.includes('Japan time') && sb.includes('JMA') && (await page.locator('.season-pop a[href*="jma.go.jp"]').count()) === 1, sb.replace(/\n/g, ' / ').slice(0, 200));
await page.locator('.season-pick select').selectOption('winter');
await page.waitForTimeout(300);
const wint = await page.evaluate(() => ({ s: document.documentElement.dataset.season, stored: localStorage.getItem('kyoto-gis-season'), routes: window.__kyotoMap.getSource('walk')._data.features.length, outline: window.__kyotoMap.getPaintProperty('outline-glow', 'line-color') }));
check('season can be picked by hand and is remembered; map layers untouched', wint.s === 'winter' && wint.stored === 'winter' && wint.routes === after.routes, JSON.stringify(wint));
await page.locator('.season-pick select').selectOption('autumn');
await page.keyboard.press('Escape');
await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
await tg.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(450);
const leaf = await page.evaluate(() => { const i = document.querySelector('.petal-layer i'); return i ? getComputedStyle(i).clipPath : 'none-found'; });
check('autumn: the theme switch drops maple leaves, not petals', leaf.startsWith('polygon'), leaf.slice(0, 40));
await page.waitForTimeout(3600);
await tg.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await page.locator('.season-badge summary').click();
await page.locator('.season-pick select').selectOption('auto');
await page.locator('.season-badge summary').click();
check('back to Auto restores the season of Kyoto\'s date', (await page.evaluate(() => document.documentElement.dataset.season)) === expSeason.visual);
const drift = await page.evaluate(() => document.querySelectorAll('#explore .season-drift i').length);
check('Explore has a light seasonal drift (12 pieces)', drift === 12, String(drift));

await page.locator('#q').fill('A00265');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const h2ja = await page.locator('.detail h2').innerText();
await page.locator('.lang-order').click();
await page.waitForTimeout(1200);
const h2en = await page.locator('.detail h2').innerText();
const enStored = await page.evaluate(() => localStorage.getItem('kyoto-gis-en-first'));
check('English first: 金閣 (Golden Pavilion) becomes Golden Pavilion (金閣), remembered', h2ja.startsWith('金閣') && h2en.startsWith('Golden Pavilion') && h2en.includes('金閣') && enStored === '1', `${h2ja} -> ${h2en}`);
await page.locator('.lang-order').click();
await page.waitForTimeout(400);
await page.getByRole('tab', { name: 'Overview' }).click();
await page.waitForTimeout(300);
const seal = await page.locator('.detail .kind .hanko').innerText();
const hrW = await page.evaluate(() => document.querySelector('hr.mizuhiki')?.getBoundingClientRect().width || 0);
const band = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wa-band')); return (s.maskImage || s.webkitMaskImage || '').includes('svg'); });
const serif = await page.evaluate(() => getComputedStyle(document.querySelector('.detail h2')).fontFamily);
check('wa details: seal 名, mizuhiki divider, asanoha band, mincho heading', seal === '名' && hrW > 100 && band && serif.includes('Shippori'), `${seal} · ${hrW} · ${band} · ${serif.slice(0, 30)}`);
await page.locator('#q').fill('A00110');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: 'Overview' }).click();
const ctxText = await page.locator('#pane-overview').innerText();
check('unnamed viewpoint: located inside 金閣寺 (Kinkaku-ji), stated as a location, marked unverified', ctxText.includes('Inside the grounds of 金閣寺 (Kinkaku-ji)') && ctxText.includes('not what it is') && ctxText.includes('Unverified'), ctxText.replace(/\n/g, ' / ').slice(0, 220));
await page.locator('#q').fill('A00191');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
const a191 = await page.locator('aside.right').innerText();
check('A00191 shows the English name of its own OSM record and says there is no Japanese name', a191.includes('Daiun-in') && a191.includes('No Japanese name in the source'));
await page.locator('#q').fill('金閣寺道');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
const terms = await page.locator('#pane-overview').innerText();
check('bus stop 金閣寺道: name words explained (寺 temple, 道 road leading to), not translated', terms.includes('Buddhist temple') && terms.includes('road leading to') && terms.includes('not a translation'), terms.replace(/\n/g, ' / ').slice(0, 160));
await page.screenshot({ path: `${out}/07b-season-english.png` });

const rm = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
await rm.goto(url);
await rm.waitForSelector('#explore .season-drift', { state: 'attached', timeout: 30000 });
check('reduced motion: no seasonal drift', await rm.evaluate(() => getComputedStyle(document.querySelector('#explore .season-drift')).display === 'none'));
await rm.close();

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
const sbFree = await ph.evaluate(() => { const b = document.querySelector('.season-badge summary').getBoundingClientRect(); const ov = (r) => !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom); return { nav: ov(document.querySelector('.nav-btn').getBoundingClientRect()), toggle: ov(document.querySelector('.theme-toggle').getBoundingClientRect()), inView: b.left >= 0 && b.top >= 0 }; });
check('phone: season button sits top left without covering Explore or the theme switch', !sbFree.nav && !sbFree.toggle && sbFree.inView, JSON.stringify(sbFree));
const muFree = await ph.evaluate(() => { const m = document.querySelector('.koto-stage').getBoundingClientRect(); const ov = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return !(r.right <= m.left || r.left >= m.right || r.bottom <= m.top || r.top >= m.bottom); }; return { toggle: ov('.theme-toggle'), badge: ov('.season-badge summary'), nav: ov('.nav-btn'), w: Math.round(m.width), right: Math.round(m.right) }; });
check('phone: the music control sits beside the theme switch without covering it, the season button or Explore', !muFree.toggle && !muFree.badge && !muFree.nav && muFree.w < 100, JSON.stringify(muFree));
await ph.screenshot({ path: `${out}/08-phone.png`, fullPage: false });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
