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
// the panel shows Explore or Place; search, filters and analysis live in Explore
const placeTab = async (pg) => { const t = pg.locator('#ptab-place'); if (await t.isVisible() && (await t.getAttribute('aria-selected')) !== 'true') await t.click(); await openFold(pg, 'More about this place'); };
// closed folds (Analysis, Additional layers, More about this place) are opened before their contents are used
const openFold = async (pg, title) => { const h = pg.locator('.fold-h', { has: pg.locator('h3', { hasText: title }) }).first(); if (await h.isVisible() && (await h.getAttribute('aria-expanded')) !== 'true') await h.click(); };
const exploreTab = async (pg) => { const t = pg.locator('#ptab-explore'); if (await t.isVisible() && (await t.getAttribute('aria-selected')) !== 'true') await t.click(); };
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
check('page 1: title, menu, two water buttons, video credit; the counts and team line are no longer repeated here', op.title.includes('Travel Atlas') && op.menu === 'Seasons,Places,Map,Data,Team' && op.stats === '' && !op.team && op.btns === 2 && op.credit.includes('Pixabay'), op.menu);
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
check('page 2: story lines appear with the scroll, counts roll up to the data totals', story.lines0 < 0.2 && story.lines1 > 0.9 && story.nums.join('|') === '626|5,479', JSON.stringify({ l0: story.lines0, l1: story.lines1, nums: story.nums }));
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
check('explore: 15 city photos, one per city of the study area, each with author, licence, source and a location check', ex.n === 15 && ex.allCredited && ex.licences.every((l) => /^(CC0|Public domain|CC BY)/.test(l)), ex.licences.join(', '));
check('page order: video, seasons, explore, features, dashboard, credits; front photo loaded', ex.order.join('>') === 'top>seasons>explore>features>dashboard>credits' && ex.thumbs === 15 && ex.imgOk, ex.order.join('>'));
await page.locator('.ex-dot').nth(3).click();
await page.waitForTimeout(2500); // the deck glides to its place
await page.waitForFunction(() => { const c = [...document.querySelectorAll('.ex-card')].find((e) => e.classList.contains('front')); return c && Math.abs(+c.style.getPropertyValue('--o')) < 0.02; }, null, { timeout: 15000 }).catch(() => {});   // until the deck has settled
const exText = await page.locator('#explore').innerText();
check('picking a city shows its name, what the photo shows, its facts and the photo credit', exText.includes('舞鶴市') && exText.includes('Maizuru City') && exText.includes('赤れんが博物館') && exText.includes('663highland') && exText.includes('CC BY 2.5') && /\d+ attractions? on the map/.test(exText) && /km²/.test(exText) && /M visits \(20\d\d\)/.test(exText), exText.slice(0, 300));
const ringA = await page.evaluate(() => ({ rot: +document.querySelectorAll('.ex-card')[3].style.getPropertyValue('--o'), side: +document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--o'), front: document.querySelector('.ex-card.front .ex-cap strong').innerText, bg: [...document.querySelectorAll('.ex-bg i')].findIndex((e) => e.classList.contains('on')), h: document.getElementById('explore').offsetHeight }));
check('picking a place glides the card deck there and swaps the blurred backdrop; the section is one screen tall', Math.abs(ringA.rot) < 0.06 && Math.abs(ringA.side - 1) < 0.06 && ringA.front === '舞鶴市' && ringA.bg === 3 && ringA.h <= 920, JSON.stringify(ringA));
// the cards stand on a ring: neighbours are further back and turned away, the ring is endless, quick choices never queue
await page.evaluate(() => document.getElementById('explore').dispatchEvent(new PointerEvent('pointerleave'))); await page.waitForTimeout(1800);   // pointer orbit back to centre
const ringB = await page.evaluate(() => { const c = [...document.querySelectorAll('.ex-card')].map((e) => ({ z: parseFloat(e.style.getPropertyValue('--z')), ry: parseFloat(e.style.getPropertyValue('--ry')), op: +e.style.getPropertyValue('--op') })); return { front: c[3], side: c[4], far: c[6], persp: getComputedStyle(document.querySelector('.ex-deck')).perspective }; });
check('explore scene: the chosen card faces the viewer in the middle; the others stand behind it, leaning and darker; all inside one perspective panel', Math.abs(ringB.front.z) < 1 && Math.abs(ringB.front.ry) < 1 && ringB.side.z < -20 && Math.abs(ringB.side.ry) > 8 && ringB.far.z < ringB.side.z - 150 && ringB.persp !== 'none', JSON.stringify(ringB));
const ring7 = await page.evaluate(() => { const c = [...document.querySelectorAll('.ex-card')].map((e) => ({ o: +e.style.getPropertyValue('--o'), op: +e.style.getPropertyValue('--op') })); return { v: c.filter((x) => x.op > 0.95).map((x) => Math.round(x.o)).sort((a, b) => a - b), hidden: c.filter((x) => x.op < 0.05).length, n: c.length }; });
check('explore ring: fifteen cities, seven at a time on the ring, evenly spaced all the way round (no gap at the back); the others wait out of sight', ring7.n === 15 && JSON.stringify(ring7.v) === '[-3,-2,-1,0,1,2,3]' && ring7.hidden === 8, JSON.stringify(ring7));
await page.locator('.ex-seg button').nth(0).click(); await page.evaluate(() => document.getElementById('explore').dispatchEvent(new PointerEvent('pointerleave')));
await page.waitForFunction(() => Math.abs(parseFloat(document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--rz')) - 10.5) < 0.6, null, { timeout: 12000 }).catch(() => {});   // the switch is slower when frames are slow (software rendering)
const fanA = await page.evaluate(() => ({ rz: parseFloat(document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--rz')), ry: parseFloat(document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--ry')), on: document.querySelector('.ex-seg .on').innerText }));
await page.locator('.ex-seg button').nth(1).click(); await page.waitForTimeout(1800); await page.waitForFunction(() => Math.abs(parseFloat(document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--ry'))) > 8, null, { timeout: 12000 }).catch(() => {});
check('explore scene: Fan holds the cards like a hand of cards, Orbit spreads them out again', fanA.on === 'Fan' && Math.abs(fanA.rz - 10.5) < 0.6 && Math.abs(fanA.ry) < 0.6 && (await page.evaluate(() => Math.abs(parseFloat(document.querySelectorAll('.ex-card')[4].style.getPropertyValue('--ry'))))) > 8, JSON.stringify(fanA));
// pointer orbit: moving the pointer turns the ring in depth, near cards more than far ones; it returns to centre on leave
const dkb = await page.locator('.ex-deck').boundingBox();
await page.mouse.move(dkb.x + dkb.width * 0.9, dkb.y + dkb.height * 0.2, { steps: 10 }); await page.waitForTimeout(1600);
const orb = await page.evaluate(() => { const c = [...document.querySelectorAll('.ex-card')]; const f = c.findIndex((e) => e.classList.contains('front')); const g = (e, k) => parseFloat(e.style.getPropertyValue(k)); const back = c[(f + 3) % c.length]; return { fry: g(c[f], '--ry'), frx: g(c[f], '--rx'), bry: g(back, '--ry') - 0, dimF: +c[f].style.getPropertyValue('--dim'), filt: getComputedStyle(c[f]).filter.includes('blur') }; });
await page.evaluate(() => document.getElementById('explore').dispatchEvent(new PointerEvent('pointerleave'))); await page.waitForTimeout(3200);
const orb0 = await page.evaluate(() => { const c = [...document.querySelectorAll('.ex-card')]; const f = c.findIndex((e) => e.classList.contains('front')); return Math.abs(parseFloat(c[f].style.getPropertyValue('--ry'))) + Math.abs(parseFloat(c[f].style.getPropertyValue('--rx'))); });
check('explore scene: the pointer turns the ring in depth (the front card yaws and pitches), with no blur at rest, and it returns to centre when the pointer leaves', Math.abs(orb.fry) > 2 && orb.frx > 0.5 && orb.dimF < 0.1 && !orb.filt && orb0 < 0.4, JSON.stringify({ orb, orb0 }));
for (let i = 0; i < 5; i++) { await page.locator('.ex-arrow').nth(1).click(); await page.waitForTimeout(50); }
await page.waitForTimeout(2600); await page.waitForFunction(() => { const c = [...document.querySelectorAll('.ex-card')].find((e) => e.classList.contains('front')); return c && Math.abs(+c.style.getPropertyValue('--o')) < 0.02; }, null, { timeout: 15000 }).catch(() => {});   // until the deck has settled
const ringC = await page.evaluate(() => { const cs = [...document.querySelectorAll('.ex-card')]; const f = cs.findIndex((e) => e.classList.contains('front')); return { f, o: +cs[f].style.getPropertyValue('--o'), card: cs[f].querySelector('.ex-cap span').innerText, bar: document.querySelector('.ex-place h3 span').innerText, dot: [...document.querySelectorAll('.ex-dot')].findIndex((d) => d.classList.contains('on')), bg: [...document.querySelectorAll('.ex-bg i')].findIndex((e) => e.classList.contains('on')), cta: document.querySelector('.ex-cta small').textContent }; });
check('explore scene: five quick clicks from city 4 go to city 9; card, text, dot, backdrop and map button agree', ringC.f === 8 && Math.abs(ringC.o) < 0.06 && ringC.bar.includes(ringC.card) && ringC.dot === 8 && ringC.bg === 8 && ringC.cta.includes(ringC.card), JSON.stringify(ringC));
await page.locator('.ex-dot').nth(3).click();
await page.waitForTimeout(2500); await page.waitForFunction(() => { const c = [...document.querySelectorAll('.ex-card')].find((e) => e.classList.contains('front')); return c && Math.abs(+c.style.getPropertyValue('--o')) < 0.02; }, null, { timeout: 15000 }).catch(() => {});   // until the deck has settled
const dk = await page.locator('.ex-deck').boundingBox();
await page.mouse.move(dk.x + dk.width / 2, dk.y + dk.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(dk.x + dk.width / 2 + i * 22, dk.y + dk.height / 2); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(1500);
check('dragging the deck sideways moves to the previous card', (await page.locator('.ex-card.front .ex-cap strong').innerText()) === '宮津市');
await page.locator('.ex-dot').nth(3).click();
await page.waitForTimeout(1800);
await page.locator('.ex-card.front .ex-flip').click();
await page.waitForTimeout(1100);
check('the front card flips to its photo credit', await page.evaluate(() => document.querySelector('.ex-card.front .ex-flip').classList.contains('flipped') && document.querySelector('.ex-card.front .ex-back').innerText.includes('663highland')));
await page.getByRole('button', { name: /Explore Kyoto/ }).click();
await page.waitForTimeout(7000);
const exGo = await page.evaluate(() => { const m = window.__kyotoMap; const c = m.getCenter(); return { top: Math.round(document.getElementById('dashboard').getBoundingClientRect().top), lon: c.lng, lat: c.lat, z: m.getZoom() }; });
check('"Explore Kyoto" opens the dashboard with the map framed on the chosen city (Maizuru)', Math.abs(exGo.top) < 3 && Math.abs(exGo.lon - (135.15926 + 135.48686) / 2) < 0.02 && Math.abs(exGo.lat - (35.38003 + 35.71441) / 2) < 0.02 && exGo.z > 9 && exGo.z < 12.5, JSON.stringify(exGo));
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
check('music: the volume moves the story; near the top it is at the miracle or the serenity chapter, and the caption names it', /^0[67] .+ · \d+%$/.test(lit.cap) && lit.w > 280, lit.cap);
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
check('music: pausing from the keyboard stops it; the story stays where the volume is', /Slide to play/.test(pausedCap) && Math.abs((await dome()).vol - d2.vol) < 0.001, pausedCap);
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
check('map sources hold 626 attractions (523 raw - 5 merged duplicates - 13 not sights + 121 verified CSV sites) and 5,479 stops', srcCounts.a === 626 && srcCounts.t === 5479, JSON.stringify(srcCounts));
const ns = await page.evaluate(async () => {
  const f = window.__kyotoMap.getSource('attractions')._data.features.map((x) => x.properties);
  const rel = await (await fetch('data/poi_relations.json')).json(); const w = await (await fetch('data/walking_routes_prefecture.geojson')).json();
  const kde = await (await fetch('data/analysis/density_kde_meta.json')).json(); const ids = Object.keys(rel.not_sights || {});
  const ten = f.find((p) => p.id === 'A00303');
  return { n: ids.length, offMap: ids.every((id) => !f.some((p) => p.id === id)), offWalk: ids.every((id) => !w.attraction_ids.includes(id) && !w.features.some((x) => x.properties.attraction_id === id)),
    evidence: ids.every((id) => rel.not_sights[id].evidence && rel.not_sights[id].kind), kde: JSON.stringify(kde).includes('626 records'), ten: ten && ten.name === '天' && ten.name_full === '天鷲絨美術館' };
});
check('13 records whose own OSM tags show a business or service counter are left out of the map, walking results and density (each with its evidence); a cut-short name shows the full name:ja of the same record, the name field unchanged',
  ns.n === 13 && ns.offMap && ns.offWalk && ns.evidence && ns.kde && ns.ten, JSON.stringify(ns));
const lab = await page.evaluate(() => { const f = window.__kyotoMap.getSource('attractions')._data.features.map((x) => x.properties); const un = f.filter((p) => !p.name);
  return { unnamed: un.length, en: un.filter((p) => p.name_en).length, labelled: un.filter((p) => p.label_kind).length, bare: un.filter((p) => !p.name_en && !p.label_kind).length, kinds: [...new Set(un.map((p) => p.label_kind).filter(Boolean))].sort().join(','), nameKept: un.every((p) => p.name === '' || p.name == null) }; });
check('every attraction shows a name: 218 with no OSM name get the English name of the same record (46) or a label with its basis (172; the only name tag of A00329, name:en "Hhhh", is a placeholder); the name field stays empty', lab.unnamed === 218 && lab.en === 46 && lab.labelled === 172 && lab.bare === 0 && lab.kinds === 'address,desc,muni,name,place' && lab.nameKept, JSON.stringify(lab));
const xc = await page.evaluate(async () => {
  const c = await (await fetch('data/name_checks.json')).json(); const ph = await (await fetch('data/photos.json')).json();
  const r = Object.values(c.records), here = Object.values(ph.photos).filter((v) => v.match === 'viewpoint-here'), near = Object.values(ph.photos).filter((v) => v.match === 'nearby-checked');
  const sample = here.slice(0, 6); const ok = await Promise.all(sample.map((v) => fetch(v.src).then((x) => x.ok && (x.headers.get('content-type') || '').includes('image'))));
  return { n: r.length, confirmed: c.meta.counts.confirmed, unnamedClean: r.filter((x) => x.status === 'unnamed').every((x) => !x.by && !x.wikidata), statuses: [...new Set(r.map((x) => x.status))].sort().join(','),
    photos: Object.keys(ph.photos).length, here: here.length, hereOk: here.every((v) => v.m <= 40 && v.shows && v.license && v.artist), near: near.length, nearOk: near.every((v) => v.m <= 80 && v.shows && v.license && v.artist), files: ok.every(Boolean) };
});
check('names cross-checked for all 626 (Wikidata, the OSM link, the Kyoto City list; nearby items never used as a name), and viewpoint photos taken within 40 m, each with what it shows, credit and licence',
  xc.n === 626 && xc.confirmed >= 170 && xc.unnamedClean && xc.statuses === 'confirmed,osm-only,related,unnamed' && xc.photos >= 280 && xc.here >= 100 && xc.hereOk && xc.near >= 40 && xc.nearOk && xc.photos >= 325 && xc.files, JSON.stringify(xc));
check('basemap tiles load', tiles.ok > 0 && tiles.fail === 0, `${tiles.ok} ok, ${tiles.fail} failed`);

const counts = async () => page.evaluate(() => [...document.querySelectorAll('.count .v')].map((e) => e.textContent.replace(/\s/g, '')));
await page.waitForTimeout(700);
let c = await counts();
check('top counts at start', c[0] === '626/626' && c[1] === '5,479/5,479', c.join(' | '));

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
await exploreTab(page); await page.getByLabel('Viewpoint').uncheck();
await page.waitForTimeout(800);
c = await counts();
check('uncheck Viewpoint → 383 attractions', c[0] === '383/626', c[0]);
await exploreTab(page); await page.getByLabel('Bus').uncheck();
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
await exploreTab(page); await page.getByLabel('Viewpoint').check();
await exploreTab(page); await page.getByLabel('Bus').check();

// 4. density modes (the analysis panels are closed until opened)
await exploreTab(page); await openFold(page, 'Analysis'); await page.locator('.entry', { hasText: 'Attraction Density' }).click();
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
await exploreTab(page); await page.locator('#q').fill('A00265');
await page.locator('.results button').first().click();
await page.waitForTimeout(1800);
await placeTab(page); await page.getByRole('tab', { name: 'Walking Routes' }).click();
const walkText = await page.locator('.walk').innerText();
check('Kinkaku-ji (outside the old pilot) now shows network walking distances', /\d+ m · ≈[\d.]+ min walk/.test(walkText) && !walkText.includes('Pilot result'), walkText.replace(/\n/g, ' / ').slice(0, 200));
check('walking entry shows the prefecture record count', (await exploreTab(page), await openFold(page, 'Analysis'), await page.locator('#explore-panel').innerText()).includes('626 records'));
await placeTab(page); await page.getByRole('tab', { name: 'Overview' }).click();
await page.locator('.tech summary').click();
const ovText = await page.locator('#pane-overview').innerText();
check('overview shows the municipal tourism count with year, unit and source', ovText.includes('62,787,000') && ovText.includes('2025') && ovText.includes('not this ward and not this place') && ovText.includes('Tourism Report'), ovText.replace(/\n/g, ' / ').slice(0, 200));
const detail = await page.locator('aside.right').innerText();
check('detail shows name, ID, category, municipality', detail.includes('金閣') && detail.includes('A00265') && detail.includes('Attraction') && detail.includes('京都市 北区'), detail.replace(/\n/g, ' / ').slice(0, 160));
// its photo comes from the wikidata tag on the record's own OSM node, and says so, with author and licence
const kin = await page.evaluate(() => { const img = document.querySelector('aside.right .hero.photo img'); return { src: img?.getAttribute('src') || '', ok: !!img && img.complete && img.naturalWidth > 0, badge: document.querySelector('aside.right .ph-badge')?.textContent, text: document.querySelector('aside.right').innerText }; });
check('Kinkaku shows the photo linked from its own OSM record, with author and licence', /photos\/A00265\.jpg$/.test(kin.src) && kin.ok && kin.badge === 'Linked in OSM' && /OpenStreetMap record links to Wikidata Q126391445/.test(kin.text) && /CC BY-SA 3\.0/.test(kin.text), JSON.stringify({ src: kin.src, ok: kin.ok, badge: kin.badge }));

// 5c. POI audit: Nanzen-ji, added from DSIGHT_1.csv with its location confirmed by OSM + Wikidata, is found by its
// English name, shows what the CSV lists at the site, and says where its point comes from
await exploreTab(page); await page.locator('#q').fill('Nanzen-ji');
await page.waitForTimeout(400);
const nzList = await page.locator('.results').innerText();
await page.locator('.results button').filter({ hasText: '南禅寺' }).first().click();
await page.waitForTimeout(1600);
await placeTab(page); await page.getByRole('tab', { name: 'Overview' }).click();
await page.locator('.tech summary').click();
const nz = await page.locator('aside.right').innerText();
check('search "Nanzen-ji" finds 南禅寺; its card lists the CSV buildings and the two-source location check', nzList.includes('南禅寺') && nz.includes('南禅寺') && nz.includes('三門') && nz.includes('方丈') && nz.includes('1000024') && nz.includes('Kyoto City sightseeing list') && /OSM way\/352013907 and Wikidata Q1089767/.test(nz) && nz.includes('京都市 左京区'), nz.replace(/\n/g, ' / ').slice(0, 260));
const nzOnMap = await page.evaluate(() => window.__kyotoMap.querySourceFeatures('attractions').filter((f) => f.properties.name === '南禅寺').length);
check('南禅寺 is a point of the map\'s attraction layer', nzOnMap >= 1, String(nzOnMap));
// a merged duplicate's ID opens the record that keeps the place
await exploreTab(page); await page.locator('#q').fill('A00224');
await page.waitForTimeout(400);
check('the ID of a merged duplicate finds the record that keeps it', (await page.locator('.results').innerText()).includes('A00222'));
// Kyoto City records: categories, the library of all 648 records, and the places-and-landscape layer
await exploreTab(page); await page.locator('#q').fill('');
const leftText = await page.locator('#explore-panel').innerText();
check('filters list Temple and Shrine with counts; Nanzen-ji is a temple', /Temple\s*\d{2,}/.test(leftText) && /Shrine\s*\d{2,}/.test(leftText) && nz.includes('Temple'), leftText.replace(/\n/g, ' ').slice(0, 200));
await page.locator('.status').getByRole('button', { name: 'Data & Sources' }).click(); await page.getByRole('button', { name: 'Open the record library' }).click();
await page.waitForSelector('.rec-list li');
const lib0 = await page.locator('.sheet').innerText();
await page.locator('.rec-q').fill('三門');
await page.waitForTimeout(300);
const libHit = await page.locator('.rec-list').innerText();
check('record library: all 648 Kyoto City records with source and licence; search finds 南禅寺 三門 as part of a site', lib0.includes('All 648') && lib0.includes('CC BY 4.0') && lib0.includes('Not placed') && libHit.includes('南禅寺') && libHit.includes('Part of a site'), libHit.replace(/\n/g, ' ').slice(0, 160));
await page.keyboard.press('Escape');
await exploreTab(page); await openFold(page, 'Additional layers'); await page.locator('#explore-panel label.chk', { hasText: 'Places and landscape' }).locator('input').check();
await page.waitForTimeout(600);
const geoVis = await page.evaluate(() => ({ vis: window.__kyotoMap.getLayoutProperty('geo-pt', 'visibility'), n: window.__kyotoMap.getSource('geography')._data.features.length, lines: window.__kyotoMap.getSource('geography')._data.features.filter((f) => f.geometry.type === 'LineString').length }));
check('places and landscape layer switches on: points and river lines from the Kyoto City records', geoVis.vis === 'visible' && geoVis.n >= 30 && geoVis.lines >= 5, JSON.stringify(geoVis));
await exploreTab(page); await openFold(page, 'Additional layers'); await page.locator('#explore-panel label.chk', { hasText: 'Places and landscape' }).locator('input').uncheck();
// back to Kinkaku-ji for the weather checks below
await exploreTab(page); await page.locator('#q').fill('A00265');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);

// 6. weather
await placeTab(page); await page.getByRole('tab', { name: 'Weather' }).click();
await page.waitForSelector('.wx-body, .alert', { timeout: 30000 });
const wxOk = await page.locator('.wx-body').count();
const wxText = (await page.locator('.wx').innerText()).replace(/\n/g, ' / ');
check('weather request sent for the selected point with Asia/Tokyo', weatherCalls.some((w) => w.url.includes('latitude=35.03952') && w.url.includes('timezone=Asia%2FTokyo')), JSON.stringify(weatherCalls.map((w) => w.status)));
if (wxOk) {
  check('weather shows forecast, valid time and retrieval time', /Forecast valid for/.test(wxText) && /Retrieved/.test(wxText), wxText.slice(0, 200));
  const opts = await page.locator('#wx-day option').count();
  check('date selector offers 7 forecast days', opts === 7, String(opts));
  const tree = await page.evaluate(() => { const c = document.querySelector('.wx .pixel-tree'); if (!c) return null; const r = c.getBoundingClientRect(), ov = (q) => { const e = document.querySelector(q)?.getBoundingClientRect(); return !!e && !(r.left >= e.right || r.right <= e.left || r.top >= e.bottom || r.bottom <= e.top); }; return { w: r.width, temp: ov('.wx-temp'), valid: ov('.wx-valid'), aria: c.getAttribute('aria-label'), season: document.documentElement.dataset.season }; });
  check('weather: a pixel tree for the season of the site stands beside the current values, not over them', !!tree && tree.w > 90 && !tree.temp && !tree.valid && tree.aria.includes(`for ${tree.season}`), JSON.stringify(tree));
} else {
  check('weather failure is shown as an error, with no invented values', /Weather unavailable/.test(wxText) && !/Forecast valid for/.test(wxText), wxText.slice(0, 200));
}
await page.screenshot({ path: `${out}/04-selected-weather.png` });

// 7. weather failure path, using a blocked request
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p2.route('**/api.open-meteo.com/**', (r) => r.abort('internetdisconnected'));
await p2.goto(url);
await p2.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await exploreTab(p2); await p2.locator('#q').fill('S00019');
await p2.locator('.results button').first().click();
await placeTab(p2); await p2.getByRole('tab', { name: 'Weather' }).click();
await p2.waitForSelector('.alert', { timeout: 15000 });
const failText = await p2.locator('.wx').innerText();
check('offline: weather error shown, no temperature displayed', /Weather unavailable/.test(failText) && !/°C/.test(failText), failText.replace(/\n/g, ' / ').slice(0, 160));
await p2.screenshot({ path: `${out}/05-weather-offline.png` });
await p2.close();

// 7b. walking pilot: real routes for a pilot record, separate bus and rail, unreachable shown as such
await exploreTab(page); await page.locator('#q').fill('A00230');
await page.locator('.results button').first().click();
await page.waitForTimeout(2200);
await placeTab(page); await page.getByRole('tab', { name: 'Walking Routes' }).click();
const wt = await page.locator('.walk').innerText();
await page.waitForTimeout(1500);
const routesOnMap = await page.evaluate(() => window.__kyotoMap.getSource('walk')._data.features.map((f) => f.properties.stop_type).sort());
const litStops = await page.evaluate(() => [...document.querySelectorAll('.stop-tag.on')].map((e) => e.innerText.replace(/\n/g, ' ')));
check('within / beyond the chosen distance are labelled separately', wt.includes('Within 500 m') && wt.includes('Beyond 500 m'));
check('pilot record A00230: bus and rail network distances shown', wt.includes('S00602') && wt.includes('74.7') === false && /75 m/.test(wt) && wt.includes('S01877'), wt.replace(/\n/g, ' / ').slice(0, 220));
check('route lines drawn on map for both stop types', JSON.stringify(routesOnMap) === '["bus","rail"]', JSON.stringify(routesOnMap));
check('at 500 m only the bus stop (75 m) lights up; rail (749 m) stays dim', litStops.length === 1 && litStops[0].includes('五条坂'), JSON.stringify(litStops));
await page.screenshot({ path: `${out}/04b-walking-route.png` });
await exploreTab(page); await page.locator('#q').fill('A00119');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const ut = await page.locator('.walk').innerText();
check('A00119 (hilltop paths not joined to the streets) says so, with no distance', ut.includes('Not connected to the street network') && ut.includes('unreachable') && ut.includes('distance not available') && !/\d+ m ·/.test(ut));
await exploreTab(page); await page.locator('#q').fill('A00401');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const nt = await page.locator('.walk').innerText();
check('A00401 says no bus stop within 3 km on foot, kept apart from "not connected"', nt.includes('No bus stop within 3 km on foot') && !nt.includes('Not connected'), nt.replace(/\n/g, ' / ').slice(0, 200));
await exploreTab(page); await page.locator('#q').fill('A00453');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
const zt = await page.locator('.walk').innerText();
check('A00453 and its station share a street point: shown as "Next to this place", not as 0 m', zt.includes('Next to this place') && !/\b0 m\b/.test(zt), zt.replace(/\n/g, ' / ').slice(0, 220));
await exploreTab(page); await openFold(page, 'Analysis'); await page.locator('.entry', { hasText: 'Walking Access' }).click();
const cov = await page.locator('.cov').innerText();
check('coverage counts named + OSM-tagged records by default (460 = 408 named + 52 OSM-tagged), five states listed', cov.includes('of 460 records') && cov.includes('within 3 km on foot') && cov.includes('Not connected to the street network'), cov.replace(/\n/g, ' / '));
await page.getByRole('button', { name: /^Unverified/ }).click();
check('including unverified records raises the denominator to 626', (await page.locator('.cov').innerText()).includes('of 626 records'));
await page.getByRole('button', { name: /^Unverified/ }).click();
await exploreTab(page); await page.locator('#q').fill('');
await page.getByRole('button', { name: 'Show routes on map' }).click();
await page.waitForTimeout(2500);
const bulk = await page.evaluate(() => ({ lines: window.__kyotoMap.getSource('walk')._data.features.length, rings: window.__kyotoMap.getSource('walk-stops')._data.features.length, tags: document.querySelectorAll('.stop-tag').length }));
check('prefecture view draws hundreds of routes with ring markers instead of DOM labels', bulk.lines > 300 && bulk.rings > 100 && bulk.tags === 0, JSON.stringify(bulk));
await page.getByRole('button', { name: 'Hide routes on map' }).click();

// 8. journeys panel
// 7b2. bus routes (Kyoto City Bus): pick a route, the line grows along the supplied geometry and stops light up in order
await page.evaluate(() => window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 }));
await exploreTab(page); await openFold(page, 'Analysis'); await page.locator('.entry', { hasText: 'Bus Routes' }).click();
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
await exploreTab(page); await page.locator('#q').fill('四条河原町');
await page.locator('.results button').first().click();
await page.waitForTimeout(1500);
await placeTab(page); await page.getByRole('tab', { name: 'Bus Routes' }).click();
const busAt = await page.evaluate(() => ({ routes: [...document.querySelectorAll('.bus-list .bus-no')].map((e) => e.innerText), first: document.querySelector('.bus-list .bus-dir').innerText, fare: document.querySelector('.bus-list .bus-fare').innerText }));
check('a bus stop lists the routes serving it, each direction with its next stop, and the separate fare', busAt.routes.includes('205') && /next stop/.test(busAt.first) && busAt.fare.includes('¥230'), `${busAt.routes.length} routes · ${busAt.first.replace(/\n/g, ' / ')}`);
await page.locator('.bus-list .bus-dir').first().click();
await page.waitForFunction(() => document.querySelectorAll('.bus-stop.passed').length >= 2, null, { timeout: 20000 });
const busFrom = await page.evaluate(() => { const st = [...document.querySelectorAll('.bus-stop')]; const before = st.filter((e) => e.classList.contains('before')).length; const firstLit = st.findIndex((e) => e.classList.contains('passed')); return { before, firstLit, name: st[firstLit].querySelector('b').innerText, bar: document.querySelector('.bus-bar b').innerText }; });
check('from a stop, the animation starts at that stop and runs towards the terminal; earlier stops stay quiet', busFrom.firstLit === busFrom.before && busFrom.name === '四条河原町' && busFrom.bar.startsWith('四条河原町 →'), JSON.stringify(busFrom));
await page.locator('.bus-bar').getByRole('button', { name: 'Close route' }).click();
await exploreTab(page); await page.locator('#q').fill('A00230');
await page.locator('.results button').first().click();
await page.waitForTimeout(2200);
await placeTab(page); await page.getByRole('tab', { name: 'Walking Routes' }).click();
await exploreTab(page); await openFold(page, 'Analysis'); await page.locator('.entry', { hasText: 'Bus Routes' }).click();

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
check('sources panel holds the status chips and visitor statistics', st.includes('Map data loaded') && st.includes('Walking: prefecture (626 records)') && st.includes('Visitor statistics'));
check('sources panel: OSM, N03, Open-Meteo, hash check, quality notes, the 13 records left out of the map', st.includes('ODbL') && st.includes('N03') && st.includes('Open-Meteo') && st.includes('all match') && st.includes('2771085349') && st.includes('Left out of the map: 13 records'));
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

await exploreTab(page); await page.locator('#q').fill('A00265');
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
await placeTab(page); await page.getByRole('tab', { name: 'Overview' }).click();
await page.waitForTimeout(300);
const seal = await page.locator('.detail .kind .hanko').innerText();
const hrW = await page.evaluate(() => document.querySelector('hr.mizuhiki')?.getBoundingClientRect().width || 0);
const band = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wa-band')); return (s.maskImage || s.webkitMaskImage || '').includes('svg'); });
const serif = await page.evaluate(() => getComputedStyle(document.querySelector('.detail h2')).fontFamily);
check('wa details: seal 名, mizuhiki divider, asanoha band, mincho heading', seal === '名' && hrW > 100 && band && serif.includes('Shippori'), `${seal} · ${hrW} · ${band} · ${serif.slice(0, 30)}`);
await exploreTab(page); await page.locator('#q').fill('A00110');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
await placeTab(page); await page.getByRole('tab', { name: 'Overview' }).click();
const ctxText = await page.locator('#pane-overview').innerText();
check('unnamed viewpoint: located inside 金閣寺 (Kinkaku-ji), stated as a location, marked unverified', ctxText.includes('Inside the grounds of 金閣寺 (Kinkaku-ji)') && ctxText.includes('not what it is') && ctxText.includes('Unverified'), ctxText.replace(/\n/g, ' / ').slice(0, 220));
await exploreTab(page); await page.locator('#q').fill('A00191');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
const a191 = await page.locator('aside.right').innerText();
check('A00191 shows the English name of its own OSM record and says there is no Japanese name', a191.includes('Daiun-in') && a191.includes('No Japanese name in the source'));
await exploreTab(page); await page.locator('#q').fill('金閣寺道');
await page.locator('.results button').first().click();
await page.waitForTimeout(1200);
const terms = await page.locator('#pane-overview').innerText();
check('bus stop 金閣寺道: name words explained (寺 temple, 道 road leading to), not translated', terms.includes('Buddhist temple') && terms.includes('road leading to') && terms.includes('not a translation'), terms.replace(/\n/g, ' / ').slice(0, 160));
await page.screenshot({ path: `${out}/07b-season-english.png` });

const rm = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
await rm.goto(url);
await rm.waitForSelector('#explore .season-drift', { state: 'attached', timeout: 30000 });
check('reduced motion: no seasonal drift', await rm.evaluate(() => getComputedStyle(document.querySelector('#explore .season-drift')).display === 'none'));
await rm.evaluate(() => document.getElementById('credits').scrollIntoView({ block: 'center' })); await rm.waitForTimeout(900);
const rmBox = await rm.evaluate(() => { const r = document.querySelector('.outro-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.25 }; });
await rm.mouse.click(rmBox.x, rmBox.y); await rm.waitForTimeout(500);
const rmFog = await rm.evaluate(() => ({ flipped: document.querySelector('.outro-card').classList.contains('flipped'), anims: document.querySelector('.oc-turn').getAnimations().length, pen: document.querySelector('.fm-glass').dataset.pen, phase: document.querySelector('.fm-glass').dataset.phase }));
check('reduced motion: the closing card turns over at once (no turning animation) and "Group 4" is already written on the fogged glass', rmFog.flipped && rmFog.anims === 0 && rmFog.pen === '1.00' && rmFog.phase === 'written', JSON.stringify(rmFog));
await rm.close();

// 8z. landmark symbols: three levels by zoom, hover, selection and search break the zoom limits, both themes
const lp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const lpErr = []; lp.on('pageerror', (e) => lpErr.push(e.message));
await lp.goto(url);
await lp.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.getLayer('lm-iconic') && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await lp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await lp.waitForTimeout(5000);
const lmSeen = () => lp.evaluate(() => { const m = window.__kyotoMap; const o = {}; for (const l of ['lm-iconic', 'lm-major', 'lm-minor', 'lm-search', 'lm-sel', 'lm-hover', 'attractions-pt']) o[l] = [...new Set(m.queryRenderedFeatures({ layers: [l] }).map((f) => f.properties.id))]; return o; });
const lmGo = async (c, z) => { await lp.evaluate(([c, z]) => (c ? window.__kyotoMap.jumpTo({ center: c, zoom: z }) : window.__kyotoMap.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: 0 })), [c, z]); await lp.waitForTimeout(3000); };
const lmImg = await lp.evaluate(() => { const m = window.__kyotoMap; const fs = m.querySourceFeatures('attractions'); const icons = [...new Set(fs.map((f) => f.properties.lm_icon))]; return { icons: icons.length, missing: icons.filter((i) => !i || !m.hasImage(i)), lm: m.listImages().filter((i) => i.startsWith('lm-')).length, cat: m.listImages().filter((i) => i.startsWith('cat-')).length, t3: fs.find((f) => f.properties.lm_tier === 3 && f.properties.name)?.properties.id }; });
check('landmark symbols: 15 building symbols and 7 category symbols are registered once as map images; no record points at a missing one', lmImg.lm === 15 && lmImg.cat === 7 && lmImg.missing.length === 0, JSON.stringify(lmImg));
await lmGo(null);
let ls = await lmSeen();
check('whole prefecture: only iconic symbols are drawn (the rest collide away), yet every record keeps its dot', ls['lm-iconic'].length >= 3 && ls['lm-major'].length === 0 && ls['lm-minor'].length === 0 && ls['attractions-pt'].length === 626, JSON.stringify({ i: ls['lm-iconic'].length, pt: ls['attractions-pt'].length }));
await lmGo([135.78, 35.0], 12.6);
ls = await lmSeen();
check('city zoom: more iconic symbols and the major places as category symbols; ordinary places stay dots', ls['lm-iconic'].length >= 8 && ls['lm-major'].length >= 20 && ls['lm-minor'].length === 0, JSON.stringify({ i: ls['lm-iconic'].length, M: ls['lm-major'].length }));
await lmGo([135.781, 34.998], 14.8);
ls = await lmSeen();
check('street zoom: ordinary places get their category symbol too', ls['lm-minor'].length >= 10 && ls['lm-major'].length >= 5, JSON.stringify({ M: ls['lm-major'].length, m: ls['lm-minor'].length }));
// hover and click on a building symbol (above its point), not on the dot
await lmGo([135.7292, 35.0394], 13.2);
const kp = await lp.evaluate(() => { const m = window.__kyotoMap; const f = m.querySourceFeatures('attractions').find((x) => x.properties.id === 'A00265'); const p = m.project(f.geometry.coordinates); const r = m.getContainer().getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y - 22 }; });
await lp.mouse.move(kp.x - 2, kp.y);
await lp.mouse.move(kp.x, kp.y, { steps: 3 });
await lp.waitForFunction(() => window.__kyotoMap.queryRenderedFeatures({ layers: ['lm-hover'] }).length > 0, null, { timeout: 3000 }).catch(() => {});
await lp.waitForTimeout(900);
ls = await lmSeen();
const tipTxt = await lp.locator('.tip').innerText().catch(() => '');
check('hover on the Kinkaku symbol: enlarged symbol on a soft ring, tooltip with the Japanese and English name', ls['lm-hover'].join() === 'A00265' && tipTxt.includes('金閣') && /Kinkaku|Golden/i.test(tipTxt), JSON.stringify({ h: ls['lm-hover'], tipTxt }));
await lp.mouse.click(kp.x, kp.y);
await lp.waitForTimeout(2600);
const lmDetail = await lp.locator('aside.right').innerText();
await lmGo(null);
await lp.mouse.move(5, 5);
ls = await lmSeen();
check('click on the symbol selects the record (details panel), and the selected symbol stays at any zoom', lmDetail.includes('金閣') && ls['lm-sel'].join() === 'A00265', JSON.stringify(ls['lm-sel']) + lmDetail.slice(0, 80));
// search: an ordinary record gets its symbol even at prefecture zoom
await exploreTab(lp); await lp.locator('#q').fill(lmImg.t3);
await lp.waitForTimeout(1500);
ls = await lmSeen();
check('search: the match shows its symbol at prefecture zoom, where ordinary places are otherwise dots', ls['lm-search'].join() === lmImg.t3 && ls['attractions-pt'].join() === lmImg.t3, JSON.stringify(ls['lm-search']));
await exploreTab(lp); await lp.locator('#q').fill('');
await exploreTab(lp); await lp.getByLabel('Temple').first().uncheck();
await lmGo([135.78, 35.0], 12.6);
const lmCats = await lp.evaluate(() => [...new Set(window.__kyotoMap.queryRenderedFeatures({ layers: ['lm-iconic', 'lm-major'] }).map((f) => f.properties.category))]);
check('category filter also hides the symbols of that category', lmCats.length > 0 && !lmCats.includes('temple'), lmCats.join());
await exploreTab(lp); await lp.getByLabel('Temple').first().check();
const lmHash = () => lp.evaluate(() => { const d = window.__kyotoMap.getImage('cat-temple').data.data; let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0; return h; });
const h1 = await lmHash();
await lp.locator('.theme-toggle').first().click();
await lp.waitForTimeout(2500);
await lmGo([135.78, 35.0], 12.6);
ls = await lmSeen();
check('theme switch repaints the same symbols (no layer rebuilt, nothing blank)', (await lmHash()) !== h1 && ls['lm-iconic'].length >= 8 && ls['lm-major'].length >= 20 && lpErr.length === 0, JSON.stringify({ i: ls['lm-iconic'].length, M: ls['lm-major'].length, lpErr }));
await lp.screenshot({ path: `${out}/26-landmarks.png` });
await lp.close();

// 8y. layout, study area coverage, routes and the dark theme
const rp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const rpErr = []; rp.on('pageerror', (e) => rpErr.push(e.message));
await rp.addInitScript(() => { try { localStorage.setItem('kyoto-gis-theme', 'dark'); if (!sessionStorage.getItem('fresh')) { sessionStorage.setItem('fresh', '1'); localStorage.removeItem('kyoto-gis-panel-v2'); localStorage.removeItem('kyoto-gis-cinematic'); } } catch { /* */ } });
await rp.goto(url);
await rp.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.getLayer('route-line') && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await rp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await rp.waitForTimeout(4000);
const y_lay = () => rp.evaluate(() => { const m = window.__kyotoMap; const c = document.querySelector('.center').getBoundingClientRect(); const r = document.querySelector('aside.right').getBoundingClientRect(); return { map: Math.round(c.width), panel: Math.round(r.width), canvas: Math.round(m.getCanvas().getBoundingClientRect().width), center: m.getCenter().toArray().map((v) => +v.toFixed(5)).join(), z: +m.getZoom().toFixed(3) }; });
const y_l0 = await y_lay();
const y_darkBg = await rp.evaluate(() => [getComputedStyle(document.getElementById('dashboard')).backgroundColor, getComputedStyle(document.querySelector('.right .card')).backgroundColor, getComputedStyle(document.querySelector('.right .card')).boxShadow.includes('rgba(121, 215, 218')]);
check('dark theme: charcoal page (#101416) and glass cards in a slightly lighter charcoal tint, cards do not glow', y_darkBg[0] === 'rgb(16, 20, 22)' && /^rgba\(20, 27, 32, 0\.5\d*\)$/.test(y_darkBg[1]) && !y_darkBg[2], JSON.stringify(y_darkBg));
check('layout: map and one information panel side by side (no left sidebar); canvas matches the map width', y_l0.map > 780 && y_l0.panel >= 360 && Math.abs(y_l0.canvas - y_l0.map) <= 2 && !(await rp.locator('aside.left').count()), JSON.stringify(y_l0));
const y_sb = await rp.locator('.splitter').boundingBox();
await rp.mouse.move(y_sb.x + 6, y_sb.y + y_sb.height * 0.7);
await rp.mouse.down();
const y_mids = [];
for (let i = 1; i <= 12; i++) { await rp.mouse.move(y_sb.x + 6 - i * 15, y_sb.y + y_sb.height * 0.7); await rp.waitForTimeout(20); y_mids.push(await y_lay()); }
await rp.mouse.up();
await rp.waitForTimeout(300);
const y_l1 = await y_lay();
check('splitter drag: widths change continuously with the pointer, the canvas follows every step, the view does not move', new Set(y_mids.map((x) => x.panel)).size >= 8 && y_mids.every((x) => Math.abs(x.canvas - x.map) <= 2) && y_l1.panel - y_l0.panel > 150 && y_l1.center === y_l0.center && y_l1.z === y_l0.z, JSON.stringify({ y_l0, y_l1, steps: y_mids.map((x) => x.panel).join(',') }));
const y_sb2 = await rp.locator('.splitter').boundingBox();
await rp.mouse.move(y_sb2.x + 6, y_sb2.y + y_sb2.height * 0.7); await rp.mouse.down(); await rp.mouse.move(y_sb2.x - 900, y_sb2.y + y_sb2.height * 0.7, { steps: 6 }); await rp.mouse.up();
check('splitter drag keeps the map where it was', (await y_lay()).center === y_l0.center);
const y_lmin = await y_lay();
check('splitter limits: the map keeps at least 360 px when the panel is dragged wide', y_lmin.map >= 359, JSON.stringify(y_lmin));
await rp.locator('.splitter').focus();
await rp.keyboard.press('ArrowRight'); await rp.keyboard.press('ArrowRight');
const y_lk = await y_lay();
check('splitter keyboard: arrow keys resize; it is a focusable separator with a value', y_lk.panel < y_lmin.panel && (await rp.locator('.splitter').getAttribute('role')) === 'separator' && Number(await rp.locator('.splitter').getAttribute('aria-valuenow')) > 0, JSON.stringify(y_lk));
const y_saved = await rp.evaluate(() => localStorage.getItem('kyoto-gis-panel-v2'));
await rp.reload();
await rp.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await rp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
await rp.waitForTimeout(2500);
const y_lr = await y_lay();
check('the split is remembered after a reload', y_saved && Math.abs(y_lr.panel - y_lk.panel) <= 2, JSON.stringify({ y_saved, y_lr, y_lk }));
await rp.getByRole('button', { name: 'Expand the map' }).click(); await rp.waitForTimeout(500);
const y_lc = await y_lay();
await rp.getByRole('button', { name: 'Show the panel' }).first().click(); await rp.waitForTimeout(500);
const y_lo = await y_lay();
await rp.getByRole('button', { name: 'Reset the layout' }).click(); await rp.waitForTimeout(900);
const y_ld = await y_lay();
check('expand map / show panel / reset: map takes the width, panel comes back, default split restored', y_lc.panel === 0 && y_lc.map > 1400 && Math.abs(y_lc.canvas - y_lc.map) <= 2 && y_lo.panel === y_lr.panel && Math.abs(y_ld.panel - 504) <= 2, JSON.stringify({ y_lc, y_lo, y_ld }));

// study area coverage
const y_saText = await rp.locator('.study').innerText();
check('study area: 26 municipalities covered (15 cities, 10 towns, 1 village), all full; "Municipalities", not "Cities"', /26\s*Municipalities covered/.test(y_saText) && y_saText.includes('15 cities · 10 towns · 1 village') && !/Cities covered/.test(y_saText), y_saText.replace(/\n/g, ' / ').slice(0, 160));
await rp.getByRole('button', { name: 'Show coverage' }).click();
await rp.waitForTimeout(700);
const y_cg1 = await rp.evaluate(() => JSON.stringify(window.__kyotoMap.getPaintProperty('cov-line', 'line-gradient')));
await rp.waitForTimeout(4600);
const y_cov = await rp.evaluate(() => { const m = window.__kyotoMap; return { vis: m.getLayoutProperty('cov-line', 'visibility'), g: JSON.stringify(m.getPaintProperty('cov-line', 'line-gradient') || null), col: m.getPaintProperty('cov-line', 'line-color'), n: m.querySourceFeatures('coverage').length, multi: m.querySourceFeatures('coverage').every((f) => f.geometry.type === 'LineString'), study: m.getPaintProperty('outline-line', 'line-color'), admin: m.getPaintProperty('cov-line', 'line-color') }; });
check('Show coverage: municipal boundaries are drawn progressively (step on line-progress), then held static', y_cov.vis === 'visible' && y_cg1.includes('step') && y_cov.g === 'null' && /f2f6f7/i.test(y_cov.col) && y_cov.n > 20, JSON.stringify({ y_cg1: y_cg1.slice(0, 60), g: y_cov.g.slice(0, 60), n: y_cov.n }));
check('study area boundary (teal accent) and municipal boundaries (white) differ', /79d7da/i.test(y_cov.study) && /f2f6f7/i.test(JSON.stringify(y_cov.admin)), JSON.stringify({ study: y_cov.study }));
await rp.screenshot({ path: `${out}/27-coverage-dark.png` });
await rp.locator('.theme-toggle').first().click(); await rp.waitForTimeout(2500);
check('theme switch recolours the finished municipal boundary (plain line colour, not a cached gradient)', (await rp.evaluate(() => window.__kyotoMap.getPaintProperty('cov-line', 'line-color'))) === '#2f2924' && !(await rp.evaluate(() => window.__kyotoMap.getPaintProperty('cov-line', 'line-gradient'))));
await rp.locator('.theme-toggle').first().click(); await rp.waitForTimeout(2500);
await rp.getByRole('button', { name: 'Hide coverage' }).click();
check('Hide coverage hides the layers', (await rp.evaluate(() => window.__kyotoMap.getLayoutProperty('cov-line', 'visibility'))) === 'none');

// routes: nothing without a start; then a real route; failure; rapid changes; cinematic
await exploreTab(rp); await rp.locator('#q').fill('A00265'); await rp.locator('.results button').first().click();
await rp.waitForTimeout(1500);
const y_rc0 = await rp.locator('.route-card').innerText();
const y_r0 = await rp.evaluate(() => window.__kyotoMap.querySourceFeatures('route').length);
check('route: with no start chosen the card asks for one and nothing is drawn', y_rc0.includes('No start chosen') && y_rc0.includes('Choose a start') && y_r0 === 0, y_rc0.replace(/\n/g, ' / ').slice(0, 120));
await rp.getByRole('button', { name: 'Pick start on map' }).click();
check('route: picking mode shows a prompt on the map', await rp.locator('.pick-bar').isVisible());
await rp.keyboard.press('Escape');
await rp.waitForTimeout(200);
check('route: Esc cancels picking', !(await rp.locator('.pick-bar').count()));
// start: Kyoto Station (picked from search via "Start from here")
await exploreTab(rp); await rp.locator('#q').fill('S00019'); await rp.locator('.results button').first().click(); await rp.waitForTimeout(800);
await rp.getByRole('button', { name: 'Start from here' }).click();
const y_routeReqs = [];
rp.on('request', (r) => { if (r.url().includes('routing.openstreetmap.de')) y_routeReqs.push(r.url()); });
await exploreTab(rp); await rp.locator('#q').fill('A00560'); await rp.locator('.results button').first().click();
await rp.waitForFunction(() => /Route distance|routing service|could not/i.test(document.querySelector('.route-card')?.innerText || ''), null, { timeout: 25000 });
await rp.waitForTimeout(8500);
const y_rc1 = await rp.locator('.route-card').innerText();
const y_rmap = await rp.evaluate(() => { const m = window.__kyotoMap; const f = m.querySourceFeatures('route')[0]; return { n: f?.geometry.coordinates.length || (f ? 1 : 0), ends: [...new Set(m.querySourceFeatures('route-ends').map((x) => x.properties.kind))].sort().join(), tag: document.querySelector('.route-tag')?.innerText.replace(/\n/g, ' '), g: JSON.stringify(m.getPaintProperty('route-line', 'line-gradient') || null).includes('step'), col: m.getPaintProperty('route-line', 'line-color'), pitch: m.getPitch(), callout: !!document.querySelector('.sel-callout') }; });
const y_live = y_rc1.includes('Route distance');
check('route: real service result — start and end named, mode, estimated travel time and route distance from the service, line drawn with both ends and a time tag', y_live ? (y_rc1.includes('京都') && y_rc1.includes('清水寺') && /\d+ min/.test(y_rc1) && /\d[\d.]* (km|m)/.test(y_rc1) && y_rc1.includes('Not a live ETA') && y_rmap.n > 10 && y_rmap.ends === 'end,start' && /min/.test(y_rmap.tag || '') && !y_rmap.g) : y_rc1.includes('No route is drawn'), JSON.stringify({ y_live, y_rmap, y_rc1: y_rc1.replace(/\n/g, ' / ').slice(0, 260), reqs: y_routeReqs.length }));
check('route: plain view stays top-down; no photo callout covers the route', y_rmap.pitch === 0 && !y_rmap.callout, JSON.stringify(y_rmap));
check('route: transit is offered only as unavailable, with the reason', (await rp.getByRole('button', { name: /^Transit/ }).isDisabled()) && (await rp.getByRole('button', { name: /^Transit/ }).getAttribute('title')).includes('no timetable'));
await rp.screenshot({ path: `${out}/28-route-dark.png` });
// failure: the service answers 503; no line, no straight-line figure
await rp.route('**/routing.openstreetmap.de/**', (r) => r.fulfill({ status: 503, body: 'down' }));
await rp.getByRole('radio', { name: 'Cycle' }).click();
await rp.waitForTimeout(1200);
const y_rc2 = await rp.locator('.route-card').innerText();
const y_r2 = await rp.evaluate(() => window.__kyotoMap.querySourceFeatures('route').length);
check('route failure: clear error, nothing drawn, no straight-line distance', y_rc2.includes('HTTP 503') && y_rc2.includes('no straight-line distance') && y_r2 === 0 && !/\d+(\.\d+)? km/.test(y_rc2), y_rc2.replace(/\n/g, ' / ').slice(0, 200));
// rapid changes: a slow answer for the first place must not replace the later one
let y_n = 0;
await rp.route('**/routing.openstreetmap.de/**', async (r) => {
  const slow = y_n++ === 0;
  const to = r.request().url().split(';')[1].split('?')[0].split(',').map(Number);
  const body = JSON.stringify({ code: 'Ok', routes: [{ distance: slow ? 1111 : 2222, duration: slow ? 600 : 1200, geometry: { type: 'LineString', coordinates: [[135.7588, 34.9858], [(135.7588 + to[0]) / 2, 34.99], to] } }], waypoints: [{ distance: 1 }, { distance: 1 }] });
  if (slow) await new Promise((res) => setTimeout(res, 2500));
  try { await r.fulfill({ status: 200, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } }); } catch { /* aborted by the app */ }
});
await rp.getByRole('radio', { name: 'Walk' }).click();
await exploreTab(rp); await rp.locator('#q').fill('A00563'); await rp.locator('.results button').first().click();
await rp.waitForTimeout(150);
await exploreTab(rp); await rp.locator('#q').fill('A00540'); await rp.locator('.results button').first().click();
await rp.waitForTimeout(4200);
const y_rc3 = await rp.locator('.route-card').innerText();
check('rapid clicks: the older, slower request is dropped; the card and the map show the latest place', y_rc3.includes('銀閣寺') && y_rc3.includes('2.22 km') && !y_rc3.includes('1.11 km'), y_rc3.replace(/\n/g, ' / ').slice(0, 160));
// cinematic: real tilt (MapLibre pitch), remembered; Top-down returns to 2D
await rp.locator('.map-tools .cine:not(.d3t)').click();
await exploreTab(rp); await rp.locator('#q').fill('A00182'); await rp.locator('.results button').first().click();
await rp.waitForTimeout(7000);
const y_cine = await rp.evaluate(() => ({ pitch: window.__kyotoMap.getPitch(), bearing: window.__kyotoMap.getBearing(), saved: localStorage.getItem('kyoto-gis-cinematic') }));
check('Cinematic view: the camera tilts after framing the route (real pitch, no CSS transform); the choice is remembered', y_cine.pitch > 30 && y_cine.saved === '1', JSON.stringify(y_cine));
await rp.screenshot({ path: `${out}/29-cinematic.png` });
await rp.getByRole('button', { name: 'Top-down' }).click();
await rp.waitForTimeout(900);
check('Top-down returns to a flat view', (await rp.evaluate(() => window.__kyotoMap.getPitch())) === 0);
await rp.locator('.map-tools .cine:not(.d3t)').click();
await rp.unroute('**/routing.openstreetmap.de/**');
await rp.getByRole('button', { name: 'Clear start' }).click();
await rp.waitForTimeout(1500);
check('Clear start removes the route', (await rp.evaluate(() => window.__kyotoMap.queryRenderedFeatures({ layers: ['route-line', 'route-ends'] }).length)) === 0 && (await rp.locator('.route-card').innerText()).includes('No start chosen'));
// points off: the density layer stays
await exploreTab(rp);
await rp.locator('label.switch', { hasText: 'Points' }).click();
await openFold(rp, 'Analysis'); await rp.locator('.entry', { hasText: 'Attraction Density' }).click();
await rp.getByRole('radio', { name: 'KDE result' }).click();
await rp.waitForTimeout(1200);
const y_pts = await rp.evaluate(() => { const m = window.__kyotoMap; return { pt: m.getLayoutProperty('attractions-pt', 'visibility'), sym: m.getLayoutProperty('lm-iconic', 'visibility'), kde: m.getLayoutProperty('kde-fill', 'visibility'), cells: m.queryRenderedFeatures({ layers: ['kde-fill'] }).length }; });
check('Points switch off: attraction points and symbols hidden, KDE density still shown', y_pts.pt === 'none' && y_pts.sym === 'none' && y_pts.kde === 'visible' && y_pts.cells > 0, JSON.stringify(y_pts));
check('Analysis fold shows the active tool on its header', (await rp.locator('.analysis .fold-s').innerText()).includes('KDE on'));
await rp.getByRole('radio', { name: 'Off' }).click();
await rp.locator('label.switch', { hasText: 'Points' }).click();
// dark map symbols: white core with a category ring; transit icons repainted per theme
const y_sym = await rp.evaluate(() => { const m = window.__kyotoMap; return { core: m.getPaintProperty('attractions-pt', 'circle-color'), ring: JSON.stringify(m.getPaintProperty('attractions-pt', 'circle-stroke-color')).slice(0, 40) }; });
check('dark map: ordinary attraction dots have a white core and a category-coloured ring', /eef4f6/i.test(y_sym.core) && y_sym.ring.includes('match'), JSON.stringify(y_sym));
// bento: drag a tile by its grip onto another; the others glide, it snaps into the slot, the order is kept
await exploreTab(rp);
const bOrder = () => rp.evaluate(() => [...document.querySelectorAll('#explore-panel .tile')].map((t) => t.dataset.tile).join());
await rp.evaluate(() => { document.getElementById('dashboard').scrollIntoView(); document.querySelector('aside.right').scrollTop = 0; }); await rp.waitForTimeout(300);
const bo0 = await bOrder();
await rp.locator('[data-tile="study"] .tile-grip').hover(); await rp.waitForTimeout(300); await rp.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await rp.waitForTimeout(200);
const bg = await rp.locator('[data-tile="study"] .tile-grip').boundingBox();
const bHit = await rp.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return (e.closest('.tile-grip') ? 'grip' : '') + ' ' + (e.className?.baseVal ?? e.className) + ' ' + Math.round(document.getElementById('dashboard').getBoundingClientRect().top); }, [bg.x + 5, bg.y + 8]);
const bt = await rp.locator('[data-tile="transit"]').boundingBox();
await rp.mouse.move(bg.x + 5, bg.y + 8); await rp.mouse.down();
let bGlide = false;
for (let i = 1; i <= 20; i++) {
  await rp.mouse.move(bg.x + 5 + (bt.x + bt.width / 2 - bg.x - 5) * i / 20, bg.y + 8 + (bt.y + bt.height / 2 - bg.y - 8) * i / 20); await rp.waitForTimeout(30);
  if (!bGlide) bGlide = await rp.evaluate(() => [...document.querySelectorAll('#explore-panel .tile:not(.dragging)')].some((t) => t.getAnimations().length > 0));
}
const bFollow = await rp.evaluate(() => document.querySelector('[data-tile="study"]').style.transform);
await rp.waitForTimeout(300); await rp.mouse.up(); await rp.waitForTimeout(500);
const bo1 = await bOrder();
check('bento: dragged tile follows the pointer, the others glide aside, on release it takes the new slot and keeps no offset', bo1 !== bo0 && bo1.split(',').indexOf('study') > bo0.split(',').indexOf('study') && bGlide && /translate/.test(bFollow) && !(await rp.evaluate(() => document.querySelector('[data-tile="study"]').style.transform)), JSON.stringify({ bo0, bo1, bGlide, bHit }));
await rp.locator('[data-tile="transit"] .tile-grip').focus(); await rp.keyboard.press('ArrowUp'); await rp.waitForTimeout(400);
const bo2 = await bOrder();
check('bento: keyboard moves a tile with the arrow keys', bo2.split(',').indexOf('transit') === bo1.split(',').indexOf('transit') - 1, bo2);
check('bento: the order is remembered', (await rp.evaluate(() => localStorage.getItem('kyoto-gis-bento-explore-v2'))) === JSON.stringify(bo2.split(',')));
const bCols = await rp.evaluate(() => getComputedStyle(document.querySelector('#explore-panel .bento')).gridTemplateColumns.split(' ').length);
check('bento: uneven grid — two columns in the default panel, wide tiles span both', bCols === 2 && (await rp.evaluate(() => getComputedStyle(document.querySelector('[data-tile="analysis"]')).gridColumnStart)) === 'span 2', String(bCols));
const koi = await rp.evaluate(() => { const c = document.querySelector('.koi-layer canvas'); const l = document.querySelector('.koi-layer'); const card = document.querySelector('#explore-panel .card'); return { ok: !!c && c.width > 100, pe: getComputedStyle(l).pointerEvents, op: +getComputedStyle(c).opacity, under: +getComputedStyle(l).zIndex < +getComputedStyle(document.querySelector('#explore-panel')).zIndex, engine: !!window.AsciiKoi, fish: window.__koi ? window.__koi.fish.filter((f) => f.seen > 0).length : 0 }; });
check('koi pond: drawn behind the panel cards, several small koi, takes no clicks', koi.ok && koi.engine && koi.pe === 'none' && koi.fish >= 6 && koi.under, JSON.stringify(koi));
// liquid glass (dark only), pointer glow and feeding ripples
await rp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
const glass = await rp.evaluate(() => { const c = document.querySelector('#explore-panel .card'), s = getComputedStyle(c), l = getComputedStyle(document.querySelector('#explore-panel')); return { bf: s.backdropFilter || s.webkitBackdropFilter, bg: s.backgroundColor, fill: l.backgroundColor, theme: document.documentElement.dataset.theme || 'dark' }; });
check('glass: dark panel cards blur only their backdrop and the pond is not covered', glass.theme === 'light' || (/blur\(/.test(glass.bf) && /rgba\(.*0\.5\d*\)/.test(glass.bg) && glass.fill === 'rgba(0, 0, 0, 0)'), JSON.stringify(glass));
if (glass.theme !== 'light') {
  const gb = await rp.locator('[data-tile="cats"] .card').boundingBox();
  await rp.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 8 });
  await rp.waitForFunction(() => +document.querySelector('[data-tile="cats"] .card').style.getPropertyValue('--gp') > 0.3, null, { timeout: 8000 }).catch(() => {});
  const gpOn = await rp.evaluate(() => +document.querySelector('[data-tile="cats"] .card').style.getPropertyValue('--gp'));
  await rp.mouse.move(200, 400, { steps: 4 });
  await rp.waitForFunction(() => !document.querySelector('[data-tile="cats"] .card').style.getPropertyValue('--gp'), null, { timeout: 20000 }).catch(() => {});
  const gpOff = await rp.evaluate(() => document.querySelector('[data-tile="cats"] .card').style.getPropertyValue('--gp'));
  check('glass: the card light answers to the pointer and settles back afterwards', gpOn > 0.3 && gpOff === '', `${gpOn} -> "${gpOff}"`);
}
const fa = await rp.locator('aside.right').boundingBox();
await rp.mouse.click(fa.x + 5, fa.y + fa.height - 60); await rp.waitForTimeout(150); await rp.mouse.click(fa.x + 5, fa.y + fa.height - 140);
const rip1 = await rp.evaluate(() => window.__koiRipples());
await rp.waitForFunction(() => window.__koiRipples() === 0, null, { timeout: 15000 }).catch(() => {});
const rip2 = await rp.evaluate(() => ({ n: window.__koiRipples(), pe: getComputedStyle(document.querySelector('.koi-ripples')).pointerEvents, z: +getComputedStyle(document.querySelector('.koi-layer')).zIndex < +getComputedStyle(document.querySelector('#explore-panel')).zIndex }));
check('koi pond: thrown food sends ripples that overlap, fade away and stay under the cards', rip1 === 6 && rip2.n === 0 && rip2.pe === 'none' && rip2.z, `${rip1} ${JSON.stringify(rip2)}`);
// site-wide pointer light and the closing scene
const CL = (k) => rp.evaluate((k) => window.__cursorLight[k], k);
const cur = await rp.evaluate(() => ({ n: document.querySelectorAll('.cursor-light').length, pe: getComputedStyle(document.querySelector('.cursor-light')).pointerEvents, pos: getComputedStyle(document.querySelector('.cursor-light')).position, hit: document.elementFromPoint(640, 470)?.className !== 'cursor-light', count: window.__cursorLight.count, pressed: document.querySelector('.fx-toggle').getAttribute('aria-pressed'), title: document.querySelector('.fx-toggle').title }));
// slow: 300 px over ~1.2 s; fast: 700 px in a few events
await rp.mouse.move(400, 470); await rp.waitForTimeout(400);
for (let i = 1; i <= 40; i++) { await rp.mouse.move(400 + i * 7.5, 470); await rp.waitForTimeout(30); }
cur.slow = { tail: Math.round(await CL('maxTail')), spread: Math.round(await CL('spread')), drawn: await CL('drawn') };
await rp.waitForTimeout(500); await rp.mouse.move(1400, 300, { steps: 6 }); await rp.waitForTimeout(16);
cur.fast = { tail: Math.round(await CL('maxTail')) };
// rest: the flock keeps drifting round the pointer, with short tails, every particle still drawn
await rp.waitForTimeout(2200); const fh1 = await CL('heads'); await rp.waitForTimeout(3200); const fh2 = await CL('heads');
cur.rest = { rest: +(await CL('rest')).toFixed(2), spread: Math.round(await CL('spread')), tail: Math.round(await CL('maxTail')), drawn: await CL('drawn'), drift: Math.round(fh1.reduce((a, q, k) => a + Math.hypot(q[0] - fh2[k][0], q[1] - fh2[k][1]), 0) / fh1.length) };
check('pointer light: one fixed canvas that takes no clicks; every particle has its own tail, long when the hand is fast, short when slow; resting, the flock keeps drifting round the pointer',
  cur.n === 1 && cur.pe === 'none' && cur.pos === 'fixed' && cur.hit && cur.count >= 40 && cur.slow.drawn === cur.count && cur.slow.spread < 95 && cur.fast.tail > cur.slow.tail * 2 && cur.fast.tail <= 280
  && cur.rest.rest > 0.9 && cur.rest.drawn === cur.count && cur.rest.drift > 8 && cur.rest.spread > 25 && cur.rest.spread < 140 && cur.rest.tail < 140, JSON.stringify(cur));
// theme: the colours ease across without resetting the flock
const th0 = await rp.evaluate(() => document.documentElement.dataset.theme);
await rp.locator('.theme-toggle').first().click(); await rp.waitForFunction((t) => document.documentElement.dataset.theme !== t, th0, { timeout: 8000 }).catch(() => {}); await rp.waitForTimeout(1500);
const thm = { from: th0, to: await rp.evaluate(() => document.documentElement.dataset.theme), mix: +(await CL('theme')).toFixed(2), spread: Math.round(await CL('spread')), drawn: await CL('drawn') };
await rp.locator('.theme-toggle').first().click(); await rp.waitForFunction((t) => document.documentElement.dataset.theme === t, th0, { timeout: 8000 }).catch(() => {}); await rp.waitForTimeout(1500);
check('pointer light: follows the theme switch (blended for dark, painted for light) and keeps the flock going through the change', thm.from !== thm.to && Math.abs(thm.mix - (thm.to === 'light' ? 1 : 0)) < 0.05 && thm.spread > 15 && thm.drawn >= cur.count, JSON.stringify(thm));
// the toggle: off clears and stops it (also by keyboard), the choice is remembered on the next visit, and turning it on again binds nothing twice
await rp.locator('.fx-toggle').click(); await rp.waitForTimeout(300);
const fxOff = await rp.evaluate(() => { const c = document.querySelector('.cursor-light'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i]; return { on: window.__cursorLight.on, running: window.__cursorLight.running, alpha: a, pressed: document.querySelector('.fx-toggle').getAttribute('aria-pressed'), title: document.querySelector('.fx-toggle').title, stored: localStorage.getItem('kyoto.cursorFx') }; });
const npx = await browser.newContext({ viewport: { width: 1200, height: 800 }, storageState: await rp.context().storageState() }); const np = await npx.newPage(); await np.goto(url); await np.waitForSelector('.fx-toggle', { timeout: 30000 });
const fxNext = await np.evaluate(() => ({ pressed: document.querySelector('.fx-toggle').getAttribute('aria-pressed'), on: !!window.__cursorLight?.on })); await npx.close();
await rp.locator('.fx-toggle').focus(); await rp.keyboard.press('Enter'); await rp.waitForTimeout(200);
await rp.mouse.move(700, 450, { steps: 5 }); await rp.waitForTimeout(400);
const fxOn = await rp.evaluate(() => ({ on: window.__cursorLight.on, running: window.__cursorLight.running, drawn: window.__cursorLight.drawn, pressed: document.querySelector('.fx-toggle').getAttribute('aria-pressed'), stored: localStorage.getItem('kyoto.cursorFx') }));
check('pointer light: the small toggle shows its state ("Cursor light: On/Off"), works by keyboard, clears the canvas when off, and is remembered',
  cur.pressed === 'true' && cur.title === 'Cursor light: On' && fxOff.on === false && !fxOff.running && fxOff.alpha === 0 && fxOff.pressed === 'false' && fxOff.title === 'Cursor light: Off' && fxOff.stored === 'off'
  && fxNext.pressed === 'false' && !fxNext.on && fxOn.on && fxOn.running && fxOn.drawn > 0 && fxOn.pressed === 'true' && fxOn.stored === 'on', JSON.stringify({ fxOff, fxNext, fxOn }));
// an open popup is cut out of what it draws
await rp.locator('.season-badge summary').click(); await rp.waitForTimeout(400); await rp.mouse.move(160, 170, { steps: 5 }); await rp.waitForTimeout(400);
const fxCut = await CL('cut'); await rp.keyboard.press('Escape'); await rp.locator('.season-badge summary').click(); await rp.waitForTimeout(400);
const fxCut0 = await CL('cut');
check('pointer light: an open popup is cut out of the drawing, and nothing is cut once it closes', fxCut >= 1 && fxCut0 === 0, `${fxCut} ${fxCut0}`);
// start from the top, so the closing is taken apart whatever an earlier step left it as
await rp.evaluate(() => scrollTo(0, 0)); await rp.waitForFunction(() => document.querySelector('.outro.st0'), null, { timeout: 6000 }).catch(() => {});
await rp.evaluate(() => document.getElementById('credits').scrollIntoView({ block: 'center' }));
await rp.waitForTimeout(400);
const ob0 = await rp.evaluate(() => ({ panels: document.querySelectorAll('.op.on').length, card: getComputedStyle(document.querySelector('.outro-card')).opacity }));
await rp.waitForFunction(() => document.querySelector('.outro.st5'), null, { timeout: 15000 }).catch(() => {});
await rp.waitForTimeout(700);
const ob1 = await rp.evaluate(() => ({ ptrs: document.querySelectorAll('.swarm .sw-ptr').length, cols: document.querySelectorAll('.sw-col').length, boxes: [...document.querySelectorAll('.sw-ph em')].map((e) => e.textContent), cross: document.querySelectorAll('.sw-ph svg line').length, bars: document.querySelectorAll('.sw-bars').length, gaps: [...document.querySelectorAll('.sw-gap em')].map((e) => e.textContent), panels: document.querySelectorAll('.op.on').length, pe: document.querySelector('.swarm') ? getComputedStyle(document.querySelector('.swarm')).pointerEvents : 'missing', st: (document.querySelector('.outro').className.match(/st(\d+)/) || [])[1] }));
await rp.waitForFunction(() => document.querySelector('.outro.st9 .sw-snap'), null, { timeout: 15000 }).catch(() => {});
const ob1c = await rp.evaluate(() => ({ box: document.querySelector('.sw-box em')?.textContent || '', snaps: document.querySelectorAll('.sw-snap').length, sketch: document.querySelectorAll('.sw-sketch i.chip').length, typed: [...document.querySelectorAll('.op.txt')].length }));
await rp.waitForFunction(() => document.querySelector('.outro.st12'), null, { timeout: 20000 }).catch(() => {});
await rp.waitForTimeout(1500);
const ob2 = await rp.evaluate(() => ({ swarm: !!document.querySelector('.swarm'), panels: document.querySelectorAll('.op.on').length, card: getComputedStyle(document.querySelector('.outro-card')).opacity, chips: [...document.querySelectorAll('.oc-team li')].every((l) => getComputedStyle(l).opacity === '1'), btn: getComputedStyle(document.querySelector('.outro-card .ist-skip')).visibility }));
await rp.evaluate(() => scrollBy(0, -1600)); await rp.waitForTimeout(2000);
const ob3 = await rp.evaluate(() => ({ st: (document.querySelector('.outro').className.match(/st(\d+)/) || [])[1], panels: document.querySelectorAll('.op.on').length }));
await rp.evaluate(() => document.getElementById('credits').scrollIntoView({ block: 'center' })); await rp.waitForTimeout(2600);
const ob4 = await rp.evaluate(() => ({ swarm: !!document.querySelector('.swarm'), st: +(document.querySelector('.outro').className.match(/st(\d+)/) || [])[1] }));
const wh = (t) => /^\d+ × \d+$/.test(t);
check('closing page: starts empty; pointers pull a column grid, drag out sized placeholders, sketch text bars and measure the gaps; snap guides frame the card; the finished page stays; scrolled back up it is taken apart and built again',
  ob0.panels === 0 && +ob0.card === 0 && ob1.ptrs === 14 && ob1.cols === 4 && ob1.boxes.length === 4 && ob1.boxes.every(wh) && ob1.cross === 8 && ob1.bars === 4 && ob1.gaps.length === 3 && ob1.gaps.every((g) => +g > 0) && ob1.panels === 0 && ob1.pe === 'none'
  && wh(ob1c.box) && ob1c.snaps === 2 && ob1c.sketch === 4 && ob1c.typed === 4
  && !ob2.swarm && ob2.panels === 4 && +ob2.card === 1 && ob2.chips && ob2.btn === 'visible' && ob3.st === '0' && ob3.panels === 0 && ob4.swarm && ob4.st >= 2 && ob4.st < 12,
  JSON.stringify({ ob0, ob1, ob1c, ob2, ob3, ob4 }));
// the fog mirror: a click turns the card over; the back is fogged glass where "Group 4" is written by hand
await rp.waitForFunction(() => document.querySelector('.outro.st12'), null, { timeout: 20000 }).catch(() => {});
await rp.waitForTimeout(600);
const cardAt = async () => rp.evaluate(() => { const r = document.querySelector('.outro-card').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const fogState = () => rp.evaluate(() => { const c = document.querySelector('.fm-glass'), card = document.querySelector('.outro-card'); return { flipped: card.classList.contains('flipped'), back: getComputedStyle(document.querySelector('.oc-back')).visibility, front: +getComputedStyle(document.querySelector('.oc-front')).opacity, frontInert: document.querySelector('.oc-front').hasAttribute('inert'), backInert: document.querySelector('.oc-back').hasAttribute('inert'), pen: +(c.dataset.pen || 0), phase: c.dataset.phase || '', wipes: +(c.dataset.wipes || 0), w: c.width, h: c.height, visibleBtn: [...document.querySelectorAll('.outro-card button')].filter((b) => +getComputedStyle(b).opacity > 0.5 && getComputedStyle(b).visibility === 'visible' && !b.closest('[inert]')).map((b) => b.textContent.trim()) }; });
const fg0 = await fogState();
let cb = await cardAt();
await rp.mouse.click(cb.x + cb.w / 2, cb.y + cb.h * 0.25); await rp.waitForTimeout(1300);
const fg1 = await fogState();
await rp.waitForTimeout(1600);
const fg2 = await fogState();
await rp.waitForTimeout(1200);
const fg3 = await fogState();
// the glass: bright fog (blurred and washed out) with the sharp picture through the letters
const fgGlass = await rp.evaluate(() => { const c = document.querySelector('.fm-glass'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; } return { mean: Math.round(s / n) }; });
check('fog mirror: a click on the closing card (no button shown) turns it over; the back is fogged glass and "Group 4" is written into it stroke by stroke over a few seconds',
  !fg0.flipped && fg0.visibleBtn.length === 1 && fg1.flipped && fg1.back === 'visible' && fg1.front === 0 && fg1.frontInert && !fg1.backInert && fg1.w > 300 && fg1.h > 150
  && fg2.phase === 'writing' && fg2.pen > 0.05 && fg2.pen < 0.9 && fg3.pen > fg2.pen && fgGlass.mean > 140 && fg1.visibleBtn.length === 0,
  JSON.stringify({ fg0, fg1: { ...fg1, visibleBtn: undefined }, fg2: [fg2.phase, fg2.pen], fg3: [fg3.phase, fg3.pen], fgGlass }));
await rp.waitForFunction(() => document.querySelector('.fm-glass').dataset.phase === 'written', null, { timeout: 12000 }).catch(() => {});
const fg4 = await fogState();
// wiping the glass with the mouse (the cursor light keeps off the glass)
cb = await cardAt();
await rp.mouse.move(cb.x + 30, cb.y + cb.h * 0.86); await rp.mouse.move(cb.x + cb.w - 30, cb.y + cb.h * 0.88, { steps: 18 }); await rp.waitForTimeout(200);
const fg5 = await fogState(); const fogCut = await rp.evaluate(() => (window.__cursorLight?.on ? window.__cursorLight.cut : -1));
check('fog mirror: the writing finishes, and moving the mouse over the glass wipes it (no cursor light drawn over the glass)', fg4.phase === 'written' && fg4.pen === 1 && fg5.wipes >= 10 && fogCut !== 0, JSON.stringify({ fg4: [fg4.phase, fg4.pen], wipes: fg5.wipes, fogCut }));
// a click on the glass turns it back; a drag (wiping) does not
await rp.mouse.move(cb.x + cb.w * 0.3, cb.y + cb.h * 0.3); await rp.mouse.down(); await rp.mouse.move(cb.x + cb.w * 0.6, cb.y + cb.h * 0.35, { steps: 6 }); await rp.mouse.up(); await rp.waitForTimeout(900);
const fg6 = await fogState();
await rp.mouse.click(cb.x + cb.w / 2, cb.y + cb.h * 0.3); await rp.waitForTimeout(1300);
const fg7 = await fogState();
// from the keyboard: a turn button that shows only when focused, and the focus follows to the other side
await rp.locator('.oc-front .ist-skip').focus(); await rp.keyboard.press('Tab'); await rp.waitForTimeout(100); const kbShown = await rp.evaluate(() => document.activeElement?.classList.contains('oc-flip') ? +getComputedStyle(document.activeElement).opacity : -1);
await rp.keyboard.press('Enter'); await rp.waitForTimeout(1300);
const fg8 = await fogState(); const kbFocus = await rp.evaluate(() => document.activeElement?.textContent || '');
await rp.keyboard.press('Enter'); await rp.waitForTimeout(1300);
const fg9 = await fogState();
check('fog mirror: a drag on the glass does not turn it, a click turns it back; from the keyboard a turn button shows when focused and works both ways',
  fg6.flipped && !fg7.flipped && fg7.backInert && kbShown === 1 && fg8.flipped && kbFocus === 'Turn the card back' && !fg9.flipped,
  JSON.stringify({ fg6: fg6.flipped, fg7: fg7.flipped, kbShown, fg8: fg8.flipped, kbFocus, fg9: fg9.flipped }));
// scrolled away while turned over: it is turned back when the page is taken apart
await rp.mouse.click(cb.x + cb.w / 2, cb.y + cb.h * 0.25); await rp.waitForTimeout(1200);
const fgA = (await fogState()).flipped;
await rp.evaluate(() => scrollBy(0, -1600)); await rp.waitForTimeout(1500);
const fgB = await fogState();
check('fog mirror: scrolled back up while turned over, the card is back on its front for the next build', fgA && !fgB.flipped && fgB.frontInert === false, JSON.stringify({ fgA, fgB: fgB.flipped }));
await rp.screenshot({ path: `${out}/09f-fog-mirror.png` }).catch(() => {});
// 3D density: switched on next to Cinematic view, the surface rises from the project's density grid; a click on it opens a card with the data for that spot
await rp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
const d3before = await rp.evaluate(() => ({ pts: window.__kyotoMap.getLayoutProperty('attractions-pt', 'visibility') }));
await rp.locator('.d3t').click();
await rp.waitForFunction(() => document.querySelector('.d3.ready'), null, { timeout: 40000 }).catch(() => {});
await rp.waitForTimeout(1200);
const d3a = await rp.evaluate(() => ({ layer: !!window.__kyotoMap.getLayer('density-3d'), pitch: window.__kyotoMap.getPitch(), labels: [...document.querySelectorAll('.d3-lab span')].map((e) => e.textContent), views: document.querySelectorAll('.d3-views button:not(.ico):not([aria-pressed][title])').length, turnBtns: document.querySelectorAll('.d3-views button.ico').length, rot: window.__kyotoMap.dragRotate.isEnabled(), heat: window.__kyotoMap.getLayoutProperty('heat', 'visibility'), kde: window.__kyotoMap.getLayer('kde-fill') ? window.__kyotoMap.getLayoutProperty('kde-fill', 'visibility') : 'none', key: document.querySelector('.d3-key')?.innerText || '' }));
const d3pt = await rp.evaluate(() => { const r = document.querySelector('.d3-lab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 10 }; });
await rp.mouse.click(d3pt.x, d3pt.y); await rp.waitForTimeout(2600);
const d3c = await rp.evaluate(() => { const c = document.querySelector('.d3-card'); return c ? { text: c.innerText, line: document.querySelector('.d3-line path').getAttribute('d') } : null; });
check('3D density: the surface rises with view presets and short peak labels, the 2D density layers are off, and a click opens a glass card with the data for that spot',
  d3a.layer && d3a.pitch > 40 && d3a.views === 3 && d3a.turnBtns === 2 && d3a.rot && d3a.labels.length >= 3 && d3a.labels.includes('Higashiyama') && d3a.heat === 'none' && d3a.kde === 'none' && /records \/ km²/.test(d3a.key)
  && d3c && /records \/ km²/.test(d3c.text) && /denser than [\d.]+% of the prefecture/.test(d3c.text) && /attraction records? within 1 km/.test(d3c.text) && /transit stops? within 1 km/.test(d3c.text) && /^M/.test(d3c.line),
  JSON.stringify({ d3a, card: d3c && d3c.text.slice(0, 160) }));
const b0 = await rp.evaluate(() => window.__kyotoMap.getBearing());
await rp.locator('.d3-views button.ico').nth(1).click(); await rp.waitForTimeout(1400);
const turned = await rp.evaluate((b0) => Math.round(((window.__kyotoMap.getBearing() - b0) % 360 + 540) % 360 - 180), b0);
check('3D density: the camera turns (the turn button swings it 45°, and drag-rotate is on while the surface is up)', turned === 45 && d3a.rot, JSON.stringify({ b0, turned }));
// the cross-section is a koto string: drag bends it from the point held, letting go makes it ring, then it rests
await rp.waitForTimeout(1500);
const kd = () => rp.evaluate(() => document.querySelector('.koto-string .ln')?.getAttribute('d') || '');
const ksb = await rp.locator('.koto-string').boundingBox();
// wait until the string is still (its own hint shiver has ended) before taking its resting shape
let kRest = await kd();
for (let k = 0; k < 30; k++) { await rp.waitForTimeout(200); const d = await kd(); if (d === kRest) break; kRest = d; }
if (ksb) { await rp.mouse.move(ksb.x + ksb.width * 0.3, ksb.y + ksb.height * 0.5); await rp.mouse.down(); await rp.mouse.move(ksb.x + ksb.width * 0.3, ksb.y + ksb.height * 0.5 + 14, { steps: 4 }); }
const kBent = await kd();
await rp.mouse.up(); await rp.waitForTimeout(110);
const kR1 = await kd(); let kR2 = kR1;
for (let k = 0; k < 8 && kR2 === kR1; k++) { await rp.waitForTimeout(60); kR2 = await kd(); }   // slow frames: sample until one changes
await rp.waitForTimeout(3500); const kAfter = await kd();
check('3D density card: the cross-section is a string; dragging bends it, letting go makes it ring, then it comes to rest', !!ksb && kBent !== kRest && kR1 !== kR2 && kR1 !== kRest && kAfter === kRest, JSON.stringify({ ok: !!ksb, bent: kBent !== kRest, ring: kR1 !== kR2, rest: kAfter === kRest }));
await rp.locator('.d3-card .x').click().catch(() => {}); await rp.waitForTimeout(300);
// hold the middle mouse button and drag to orbit; the page does not auto-scroll
const mOrb0 = await rp.evaluate(() => ({ b: window.__kyotoMap.getBearing(), y: scrollY }));
const cbox = await rp.locator('#dashboard > .center').boundingBox();
await rp.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.2); await rp.mouse.down({ button: 'middle' });
await rp.mouse.move(cbox.x + cbox.width * 0.5 + 120, cbox.y + cbox.height * 0.2, { steps: 10 }); await rp.mouse.up({ button: 'middle' }); await rp.waitForTimeout(600);
const mOrb1 = await rp.evaluate(() => ({ b: window.__kyotoMap.getBearing(), y: scrollY }));
const mOrbTurn = Math.round(((mOrb1.b - mOrb0.b) % 360 + 540) % 360 - 180);
check('3D density: holding the middle mouse button and dragging orbits the view (no auto-scroll)', mOrbTurn >= 35 && mOrb1.y === mOrb0.y, JSON.stringify({ mOrbTurn, y0: mOrb0.y, y1: mOrb1.y }));
await rp.locator('.d3t').click(); await rp.waitForFunction(() => !document.querySelector('.d3'), null, { timeout: 8000 }).catch(() => {}); await rp.waitForTimeout(1300);
const d3off = await rp.evaluate(() => ({ bearing: Math.round(window.__kyotoMap.getBearing()), rot: window.__kyotoMap.dragRotate.isEnabled(), layer: !!window.__kyotoMap.getLayer('density-3d'), pts: window.__kyotoMap.getLayoutProperty('attractions-pt', 'visibility'), overlay: !!document.querySelector('.d3') }));
check('3D density: switching it off sinks the surface, removes the layer and puts the points back', !d3off.layer && !d3off.overlay && d3off.pts === d3before.pts && d3off.bearing === 0 && !d3off.rot, JSON.stringify({ d3before, d3off }));
check('no page errors on the layout / route page', rpErr.length === 0, rpErr.join(' | '));
await rp.close();

// 9. phone layout
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ph.goto(url);
await ph.waitForFunction(() => window.__kyotoMap && window.__kyotoMap.loaded(), null, { timeout: 30000 });
await ph.waitForTimeout(1500);
const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
check('phone 390 px: no horizontal page scroll', sw <= 390, `scrollWidth ${sw}`);
await ph.evaluate(() => document.getElementById('dashboard').scrollIntoView());
check('phone: explore panel starts closed and the map fills the width', (await ph.locator('#explore-panel').isVisible()) === false && (await ph.evaluate(() => document.querySelector('.center').offsetWidth)) === 390);
await ph.locator('.nav-btn').click();
await exploreTab(ph); await ph.locator('#q').fill('A00230');
await ph.locator('.results button').first().click();
await ph.waitForTimeout(1500);
const phs = await ph.evaluate(() => { const r = document.querySelector('aside.right').getBoundingClientRect(); const t = document.querySelector('.theme-toggle').getBoundingClientRect(); const x = document.querySelector('.detail .x:not(.hide-btn)').getBoundingClientRect(); const d = document.getElementById('dashboard').getBoundingClientRect(); return { sheetTop: r.top - d.top, sheetBottom: r.bottom - d.top, vh: d.height, leftShown: getComputedStyle(document.querySelector('#explore-panel')).display !== 'none', overlap: !(t.right < x.left || t.left > x.right || t.bottom < x.top || t.top > x.bottom), sw: document.documentElement.scrollWidth }; });
check('phone: picking a result closes the drawer and opens a bottom sheet', !phs.leftShown && phs.sheetTop > phs.vh * 0.25 && Math.abs(phs.sheetBottom - phs.vh) < 2, JSON.stringify(phs));
check('phone: theme switch does not cover the close button; still no horizontal scroll', !phs.overlap && phs.sw <= 390);
const sbFree = await ph.evaluate(() => { const b = document.querySelector('.season-badge summary').getBoundingClientRect(); const ov = (r) => !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom); return { nav: ov(document.querySelector('.nav-btn').getBoundingClientRect()), toggle: ov(document.querySelector('.theme-toggle').getBoundingClientRect()), inView: b.left >= 0 && b.top >= 0 }; });
check('phone: season button sits top left without covering Explore or the theme switch', !sbFree.nav && !sbFree.toggle && sbFree.inView, JSON.stringify(sbFree));
const muFree = await ph.evaluate(() => { const m = document.querySelector('.koto-stage').getBoundingClientRect(); const ov = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return !(r.right <= m.left || r.left >= m.right || r.bottom <= m.top || r.top >= m.bottom); }; return { toggle: ov('.theme-toggle'), badge: ov('.season-badge summary'), nav: ov('.nav-btn'), w: Math.round(m.width), right: Math.round(m.right) }; });
check('phone: the music control sits beside the theme switch without covering it, the season button or Explore', !muFree.toggle && !muFree.badge && !muFree.nav && muFree.w < 100, JSON.stringify(muFree));
const tp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });   // a real touch phone
await tp.goto(url); await tp.waitForSelector('.fx-toggle', { state: 'attached', timeout: 30000 }); await tp.touchscreen.tap(200, 400); await tp.waitForTimeout(400);
const phFx = await tp.evaluate(() => ({ toggle: getComputedStyle(document.querySelector('.fx-toggle')).display, running: !!window.__cursorLight?.running })); await tp.close();
check('phone: no pointer light on a touch screen, and its toggle is not shown', phFx.toggle === 'none' && !phFx.running, JSON.stringify(phFx));
// opened on the phone (keyboard focus keeps it open; the longest chapter name), the control and its caption stay on screen
await ph.evaluate(() => { const i = document.querySelector('.koto-range input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '0.46'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await ph.locator('.koto-range input').focus(); await ph.waitForTimeout(900);
const muOpen = await ph.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const s = r('.koto-stage'), c = r('.koto-cap'); return { stage: [Math.round(s.left), Math.round(s.right)], cap: [Math.round(c.left), Math.round(c.right)], vw: innerWidth, text: document.querySelector('.koto-cap').textContent }; });
check('phone: opened, the music control and its caption fit on the screen', muOpen.stage[0] >= 0 && muOpen.stage[1] <= muOpen.vw && muOpen.cap[0] >= 0 && muOpen.cap[1] <= muOpen.vw, JSON.stringify(muOpen));
await ph.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
await ph.waitForTimeout(700);
await ph.screenshot({ path: `${out}/08-phone.png`, fullPage: false });

// ---------- map tools rail, and "Sort the data" on the back of the dashboard ----------
{
  const sp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const spErr = []; sp.on('pageerror', (e) => spErr.push(e.message));
  const u = new URL(url); u.searchParams.set('sortspeed', '3');   // the 15 s sort runs in 5 s here
  await sp.goto(u.href);
  await sp.waitForSelector('.sort-btn', { timeout: 60000 });
  await sp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
  // record whether the corner turns up by itself (it does so once, a moment after the dashboard is first seen)
  await sp.evaluate(() => { window.__peeked = false; const t = setInterval(() => { if (document.querySelector('.curl.front.peek')) { window.__peeked = true; clearInterval(t); } }, 80); setTimeout(() => clearInterval(t), 9000); });
  await sp.waitForTimeout(2500);
  // rail: a slim column on the map's left edge that unfolds on hover with its labels
  const rail0 = await sp.evaluate(() => { const r = document.querySelector('.map-tools.rail').getBoundingClientRect(), m = document.querySelector('.center').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left - m.left, top: r.top - m.top, n: document.querySelectorAll('.map-tools.rail button').length }; });
  await sp.locator('.map-tools.rail button').nth(1).hover(); await sp.waitForTimeout(800);
  const rail1 = await sp.evaluate(() => { const r = document.querySelector('.map-tools.rail').getBoundingClientRect(); const s = [...document.querySelectorAll('.map-tools.rail button > span')].map((x) => +getComputedStyle(x).opacity); return { w: r.width, labels: s, ink: !document.querySelector('.rail-ink') }; });
  check('map tools: a slim rail on the map edge (not a row across the top) that unfolds with labels on hover', rail0.w < 60 && rail0.h > rail0.w * 3 && rail0.left < 30 && rail0.n >= 4 && rail1.w > 150 && rail1.labels.every((o) => o > 0.9) && rail1.ink, JSON.stringify({ rail0, rail1 }));
  await sp.locator('.map-tools.rail button', { hasText: 'Legend' }).click(); await sp.waitForTimeout(500);
  const lg = await sp.evaluate(() => { const a = document.querySelector('.map-tools.rail').getBoundingClientRect(), b = document.querySelector('.map-legend').getBoundingClientRect(); return { gap: b.left - a.left, overlapX: b.left < a.left + 46 }; });
  check('map tools: the legend opens beside the rail, not under it', !lg.overlapX, JSON.stringify(lg));
  await sp.locator('.map-legend .x').click();
  await sp.mouse.move(700, 500);
  // the corner turned up once by itself, and it turns the dashboard over
  await sp.waitForFunction(() => window.__peeked, null, { timeout: 6000 }).catch(() => {});
  const peeked = await sp.evaluate(() => window.__peeked);
  const curlPos = await sp.evaluate(() => { const c = document.querySelector('.curl.front').getBoundingClientRect(), d = document.getElementById('dashboard').getBoundingClientRect(); return { right: Math.round(d.right - c.right), bottom: Math.round(d.bottom - c.bottom) }; });
  check('flip: the bottom-right corner turns up once to show the dashboard can be turned over', peeked && curlPos.right <= 1 && curlPos.bottom <= 1, JSON.stringify({ peeked, curlPos }));
  // turn over: the map and the panel turn as one; the header stays and shows rolling counters
  await sp.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await sp.waitForTimeout(500);   // earlier steps can leave the page elsewhere
  const before = await sp.evaluate(() => ({ top: document.querySelector('#dashboard .top').getBoundingClientRect().top, y: scrollY }));
  await sp.locator('.sort-btn').click();
  const mid = await sp.evaluate(() => new Promise((res) => setTimeout(() => res(['.center', '.right', '.sort-back'].map((s) => { const el = document.querySelector('#dashboard > ' + s); return { s, t: getComputedStyle(el).transform !== 'none', anims: el.getAnimations().length }; })), 250)));
  await sp.waitForTimeout(1400);
  const back = await sp.evaluate(() => {
    const app = document.getElementById('dashboard'), e = window.__kyotoSort;
    const vis = (s) => getComputedStyle(app.querySelector(':scope > ' + s)).visibility;
    const ins = document.querySelector('.sort-in').getBoundingClientRect(), md = document.querySelector('.sc-mid').getBoundingClientRect();
    return { cls: app.className, center: vis('.center'), right: vis('.right'), back: vis('.sort-back'), top: app.querySelector('.top').getBoundingClientRect().top, y: scrollY,
      counters: [...document.querySelectorAll('.sort-counts .count')].map((c) => c.dataset.k), ghost: [...document.querySelectorAll('.top .status .btn.ghost')].filter((b) => b.offsetParent).length,
      tiles: e.tiles.length, alive: e.tiles.filter((t) => t.alive).length, inMid: e.geo.cx > md.left - ins.left && e.geo.cx < md.right - ins.left, R: e.geo.R, cards: getComputedStyle(document.querySelector('.sc-card')).visibility, hint: !!document.querySelector('.sc-hint') };
  });
  check('flip: the map and the panel turn over together (3D, both halves animated); the header stays where it was', mid.filter((x) => x.s !== '.sort-back').every((x) => x.t || x.anims) && back.cls.includes('face-back') && back.center === 'hidden' && back.right === 'hidden' && back.back === 'visible' && Math.abs(back.top - before.top) < 2 && back.y === before.y, JSON.stringify({ mid, back, before }));
  check('sort: the back shows all 644 records as one floating sphere, no slots yet, a double-click hint, and 6 counters in the header', back.tiles === 644 && back.alive === 644 && back.inMid && back.R > 120 && back.cards === 'hidden' && back.hint && back.counters.join() === 'checked,merged,leftOut,sorted,withPhoto,cats' && back.ghost === 0, JSON.stringify(back));
  // the pointer steers and magnifies the sphere
  await sp.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await sp.waitForTimeout(400);
  const g = await sp.evaluate(() => window.__kyotoSort.geo), box = await sp.locator('.sort-in').boundingBox();
  await sp.mouse.move(box.x + g.cx, box.y + g.cy + g.R * 0.8, { steps: 6 }); await sp.waitForTimeout(1800);
  const steer = await sp.evaluate(() => { const e = window.__kyotoSort; return { tilt: e.tilt, lens: Math.max(...e.tiles.map((t) => t.lens)) }; });
  check('sort: the sphere follows the pointer (tilts toward it) and swells the tiles under it', steer.tilt > 0.2 && steer.lens > 0.3, JSON.stringify(steer));
  // one click does nothing; a double-click starts the sort, the slots spring out of the sphere
  await sp.mouse.click(box.x + g.cx, box.y + g.cy); await sp.waitForTimeout(500);
  const single = await sp.evaluate(() => window.__kyotoSort.mode);
  await sp.mouse.dblclick(box.x + g.cx, box.y + g.cy);
  const pop = await sp.evaluate(() => new Promise((res) => setTimeout(() => res({ mode: window.__kyotoSort.mode, anims: [...document.querySelectorAll('.sc-card')].filter((c) => c.getAnimations().length).length, cards: document.querySelectorAll('.sc-card').length }), 120)));
  check('sort: a single click does not start it; a double-click on the sphere does, and the 8 slots spring out of it', single === 'idle' && pop.mode === 'run' && pop.cards === 8 && pop.anims >= 6, JSON.stringify({ single, pop }));
  // counters roll while records land
  const rolling = await sp.evaluate(() => new Promise((res) => setTimeout(() => { const strips = [...document.querySelectorAll('.sort-counts [data-k=checked] .odo-strip')].map((s) => s.style.transform); res({ c: { ...window.__kyotoSort.counts }, strips }); }, 2400)));
  check('sort: header counters roll digit by digit while the records fly', rolling.c.checked > 0 && rolling.c.checked < 644 && rolling.strips.length === 3 && rolling.strips.some((t) => /translateY\(-\d/.test(t)), JSON.stringify(rolling));
  await sp.waitForFunction(() => window.__kyotoSort.mode === 'done', null, { timeout: 15000 });
  await sp.waitForTimeout(300);
  const fin = await sp.evaluate(() => ({ seal: !!document.querySelector('.sc-done.anim .hanko-big'), petals: window.__kyotoSort.petals.length, replay: !document.querySelector('.sc-bar .btn.ghost').disabled, slots30: document.querySelectorAll('.sc-card[data-k=viewpoint] .slot').length }));
  // the full lists replace the 30 slots once the petals have fallen
  await sp.waitForFunction(() => document.querySelectorAll('.sc-grid.all').length === 8, null, { timeout: 9000 }).catch(() => {});
  const done = await sp.evaluate(() => {
    const e = window.__kyotoSort, cnt = (k) => document.querySelectorAll(`.sc-card[data-k=${k}] .slot:not(.empty)`).length;
    const st = {}; for (const k of ['viewpoint', 'attraction', 'museum', 'temple', 'shrine', 'castle', 'merged', 'left_out']) st[k] = cnt(k);
    return { counts: e.counts, st, hdr: [...document.querySelectorAll('.sort-counts .count .sr-only')].map((s) => s.textContent).join(), cardN: document.querySelector('.sc-card[data-k=viewpoint] .sc-n .sr-only').textContent };
  });
  Object.assign(done, fin);
  check('sort: ends with the real counts (644 checked, 5 merged, 13 left out, 626 sorted, 330 with a photo, 6 categories) and every record in its slot', JSON.stringify(done.counts) === JSON.stringify({ checked: 644, merged: 5, leftOut: 13, sorted: 626, withPhoto: 330, cats: 6 }) && JSON.stringify(done.st) === JSON.stringify({ viewpoint: 243, attraction: 146, museum: 101, temple: 89, shrine: 27, castle: 20, merged: 5, left_out: 13 }) && done.hdr === '644,5,13,626,330,6' && done.cardN === '243', JSON.stringify(done));
  check('sort: the finish is a vermilion 済 seal with petals; Replay becomes available; cards hold 30 slots while sorting, then every record', done.seal && done.petals > 50 && done.replay && done.slots30 === 30, JSON.stringify(done));
  await sp.screenshot({ path: `${out}/14-sort-done.png` });
  // a slot opens its place: area, nearest stop, source; Show on map turns back and selects it
  const sid = await sp.evaluate(() => document.querySelector('.sc-card[data-k=temple] .slot').dataset.id);
  await sp.locator('.sc-card[data-k=temple] .slot').first().click(); await sp.waitForTimeout(500);
  const card = await sp.evaluate(() => { const c = document.querySelector('.sort-card'); return c && { name: c.querySelector('h3').textContent, dts: [...c.querySelectorAll('dt')].map((d) => d.textContent), photo: !!c.querySelector('img'), credit: c.querySelector('figcaption')?.textContent || '' }; });
  check('sort: a tile opens its place with the area, nearest bus stop and station, source, and the photo credit', card && card.dts.includes('Area') && card.dts.includes('Nearest bus stop') && card.dts.includes('Source') && (!card.photo || /Photo: .+ · /.test(card.credit)), JSON.stringify(card));
  await sp.locator('.sort-card .btn', { hasText: 'Show on map' }).click();
  await sp.waitForFunction(() => !document.getElementById('dashboard').className.includes('face-back'), null, { timeout: 5000 }).catch(() => {});
  await sp.waitForTimeout(1500);
  const shown = await sp.evaluate(() => ({ cls: document.getElementById('dashboard').className, center: getComputedStyle(document.querySelector('#dashboard > .center')).visibility, title: document.querySelector('.detail .place-h h2, .detail h2')?.textContent || '', counts: !!document.querySelector('.top .counts:not(.sort-counts)') }));
  check('sort: Show on map turns the dashboard back and selects that place', !shown.cls.includes('face-back') && shown.center === 'visible' && shown.title.includes(card.name.split(' (')[0]) && shown.counts, JSON.stringify({ sid, shown, name: card.name }));
  // back again: the result is still there; Replay runs it again from the sphere
  await sp.locator('.curl.front').click(); await sp.waitForTimeout(1500);
  const kept = await sp.evaluate(() => window.__kyotoSort.mode);
  await sp.locator('.sc-bar .btn.ghost', { hasText: 'Replay' }).click(); await sp.waitForTimeout(300);
  const again = await sp.evaluate(() => ({ mode: window.__kyotoSort.mode, alive: window.__kyotoSort.tiles.filter((t) => t.alive).length }));
  await sp.waitForFunction(() => window.__kyotoSort.mode === 'done', null, { timeout: 15000 }).catch(() => {});
  const again2 = await sp.evaluate(() => ({ ...window.__kyotoSort.counts }));
  check('sort: turning over again keeps the result; Replay sorts all 644 again', kept === 'done' && again.mode === 'run' && again.alive > 600 && again2.sorted === 626 && again2.checked === 644, JSON.stringify({ kept, again, again2 }));
  // a sheet from the header belongs to the map: it turns the dashboard back
  await sp.locator('.sc-bar .btn:not(.ghost)').click(); await sp.waitForTimeout(1500);
  const front = await sp.evaluate(() => document.getElementById('dashboard').className.includes('face-back'));
  check('sort: Back to the map turns it back; no page errors on the way', !front && spErr.length === 0, spErr.join(' | '));
  // feature buttons ask for the map: from a flipped dashboard they turn it back first; the panel light follows the pointer
  await sp.locator('.sort-btn').click(); await sp.waitForTimeout(1500);
  await sp.evaluate(() => document.getElementById('features').scrollIntoView()); await sp.waitForTimeout(1200);
  const wxp = sp.locator('.ft-panel').nth(3); await wxp.hover(); await sp.waitForTimeout(900);
  const wb = await wxp.boundingBox();
  await sp.evaluate(() => addEventListener('pointermove', (e) => { window.__ptr = [e.clientX, e.clientY]; }, { passive: true }));
  await sp.mouse.move(wb.x + wb.width * 0.3, wb.y + wb.height * 0.3, { steps: 3 }); await sp.waitForTimeout(400);
  // the light against where the pointer is in the panel now (the panel may still be widening)
  const lt1 = await sp.evaluate(() => { const el = document.querySelectorAll('.ft-panel')[3], r = el.getBoundingClientRect(); return [parseFloat(el.style.getPropertyValue('--lx')) - (window.__ptr[0] - r.left), parseFloat(el.style.getPropertyValue('--ly')) - (window.__ptr[1] - r.top), +el.style.getPropertyValue('--lo')]; });
  await wxp.locator('.ft-go').click(); await sp.waitForTimeout(2600);
  const wxs = await sp.evaluate(() => ({ back: document.getElementById('dashboard').className.includes('face-back'), place: document.querySelector('.detail h2')?.textContent || '' }));
  check('feature cards: the light follows the pointer; See a forecast turns a flipped dashboard back and opens Kyoto Station', Math.abs(lt1[0]) < 12 && Math.abs(lt1[1]) < 12 && lt1[2] > 0.8 && !wxs.back && /京都|Kyoto/.test(wxs.place), JSON.stringify({ lt1, w: wb.width, wxs }));
  // light theme: the back follows it
  const th0 = await sp.evaluate(() => document.documentElement.dataset.theme);
  await sp.locator('.theme-toggle').first().click(); await sp.waitForFunction((t) => document.documentElement.dataset.theme !== t, th0, { timeout: 8000 }).catch(() => {}); await sp.waitForTimeout(1500);
  if ((await sp.evaluate(() => document.documentElement.dataset.theme)) !== 'light') { await sp.locator('.theme-toggle').first().click(); await sp.waitForTimeout(2500); }
  await sp.locator('.sort-btn').click(); await sp.waitForTimeout(1500);
  const lt = await sp.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.querySelector('.sort-back')).backgroundColor }));
  await sp.screenshot({ path: `${out}/15-sort-light.png` });
  check('sort: the back follows the light theme', lt.theme === 'light' && /rgb\(2[2-5]\d, 2[2-5]\d, 2[0-5]\d\)/.test(lt.bg), JSON.stringify(lt));
  await sp.close();

  // reduced motion: no turning or flying; a double-click shows the sorted result at once
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rm = await rctx.newPage();
  await rm.goto(url); await rm.waitForSelector('.sort-btn', { timeout: 60000 });
  await rm.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await rm.waitForTimeout(1500);
  await rm.locator('.sort-btn').click(); await rm.waitForTimeout(700);
  const rg = await rm.evaluate(() => window.__kyotoSort.geo), rb = await rm.locator('.sort-in').boundingBox();
  await rm.mouse.dblclick(rb.x + rg.cx, rb.y + rg.cy); await rm.waitForTimeout(400);
  const rmd = await rm.evaluate(() => ({ mode: window.__kyotoSort.mode, sorted: window.__kyotoSort.counts.sorted, anim: !!document.querySelector('.sc-done.anim'), seal: !!document.querySelector('.hanko-big'), petals: window.__kyotoSort.petals.length }));
  check('sort, reduced motion: the result appears at once with the seal, no flying and no petals', rmd.mode === 'done' && rmd.sorted === 626 && rmd.seal && !rmd.anim && rmd.petals === 0, JSON.stringify(rmd));
  await rctx.close();

  // phone: the back stacks (sphere above, slots below), no sideways scroll, double-tap works
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await pctx.newPage();
  const pu = new URL(url); pu.searchParams.set('sortspeed', '4');
  await pp.goto(pu.href); await pp.waitForSelector('.sort-btn', { timeout: 60000 });
  await pp.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await pp.waitForTimeout(1500);
  await pp.locator('.sort-btn').tap(); await pp.waitForTimeout(1500);
  const hint0 = await pp.evaluate(() => document.querySelector('.sc-hint')?.textContent || '');
  const pg = await pp.evaluate(() => window.__kyotoSort.geo), pbx = await pp.locator('.sort-in').boundingBox();
  await pp.evaluate(() => { window.__taps = []; const el = document.querySelector('.sort-in'); for (const t of ['pointerdown', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => window.__taps.push(`${t}:${Math.round(e.timeStamp)}`), true); });
  // two touch taps 150 ms apart, sent inside the page: the test driver alone can take over 600 ms between taps on a loaded machine
  await pp.evaluate(async ({ x, y }) => {
    const el = document.querySelector('.sort-in'), o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y };
    const tap = () => { el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); };
    tap(); await new Promise((r) => setTimeout(r, 150)); tap();
  }, { x: pbx.x + pg.cx, y: pbx.y + pg.cy });
  await pp.waitForTimeout(700);
  const pl = await pp.evaluate(() => { const m = document.querySelector('.sc-mid').getBoundingClientRect(), l = document.querySelector('.sc-col.l').getBoundingClientRect(); return { mode: window.__kyotoSort.mode, stacked: l.top >= m.bottom - 1, sw: document.documentElement.scrollWidth, back: getComputedStyle(document.querySelector('.sort-back')).visibility, counters: getComputedStyle(document.querySelector('.sort-counts')).display, hint: document.querySelector('.sc-hint')?.textContent || '' }; });
  await pp.screenshot({ path: `${out}/16-sort-phone.png` });
  check('sort, phone: the back stacks the sphere above the slots, the counters show, a double-tap starts it, no sideways scroll', pl.back === 'visible' && pl.stacked && pl.mode !== 'idle' && pl.sw <= 390 && pl.counters === 'flex' && /Double-tap/.test(hint0), JSON.stringify({ pl, hint0, taps: await pp.evaluate(() => window.__taps) }));
  await pctx.close();
}

// ---------- Plan your trip: the second dashboard ----------
{
  const tp = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const tErr = []; tp.on('pageerror', (e) => tErr.push(e.message));
  await tp.goto(url);
  await tp.evaluate(() => localStorage.removeItem('kyoto-gis-trip-v1'));
  await tp.reload();
  await tp.waitForSelector('.plan-entry', { timeout: 60000 });
  await tp.evaluate(() => document.getElementById('dashboard').scrollIntoView());
  await tp.waitForTimeout(1200);
  const store = () => tp.evaluate(() => JSON.parse(localStorage.getItem('kyoto-gis-trip-v1') || 'null'));
  await tp.locator('.plan-entry').click();
  const doors = await tp.evaluate(() => new Promise((r) => { const t0 = performance.now(); const iv = setInterval(() => { if (document.querySelector('.tp-doors.on')) { clearInterval(iv); r(true); } else if (performance.now() - t0 > 1500) { clearInterval(iv); r(false); } }, 20); }));
  await tp.waitForSelector('.trip', { timeout: 10000 });
  await tp.waitForTimeout(1600);
  const e0 = await tp.evaluate(() => ({
    hidden: getComputedStyle(document.querySelector('#dashboard > .top')).visibility, photo: document.querySelector('.tp-scene').classList.contains('photo'),
    pinned: document.querySelectorAll('.ema.pinned').length, add: document.querySelectorAll('.ema.add').length, hint: !!document.querySelector('.tp-hint'),
    sub: document.querySelector('.tp-feat h3').textContent, cards: [...document.querySelectorAll('.tp-worth .pc')].map((c) => !!c.querySelector('.im').style.backgroundImage), title: document.querySelector('.tp-worth h4').textContent,
    rail: [...document.querySelectorAll('.tp-rail button')].map((b) => b.textContent.trim()), dock: [...document.querySelectorAll('.tp-dock button')].map((b) => b.textContent.trim()), support: getComputedStyle(document.querySelector('.tp-support')).visibility, house: !!document.querySelector('.ah-house'),
  }));
  await tp.screenshot({ path: `${out}/20-trip-empty.png` });
  check('trip: "Plan your trip" in the panel switches the whole dashboard behind shoji doors; not planned yet, the ema are pinned on the board with a hint', doors && e0.hidden === 'hidden' && !e0.photo && e0.pinned === 4 && e0.add === 1 && e0.hint && e0.sub === 'Not planned yet', JSON.stringify(e0));
  check('trip: rail is Trip, Agenda, Trip map, Dashboard; dock is Play day, hours, +, Best order, Export; the atlas house at the bottom left in place of Support; popular places have photos', JSON.stringify(e0.rail) === JSON.stringify(['Trip', 'Agenda', 'Trip map', 'Dashboard']) && e0.dock.length === 5 && /Play day/.test(e0.dock[0]) && /Best order/.test(e0.dock[3]) && /Export/.test(e0.dock[4]) && e0.support === 'hidden' && e0.house && e0.cards.length === 4 && e0.cards.every(Boolean) && /Popular in/.test(e0.title), JSON.stringify(e0));

  // an ema opens its day's strip (a thread runs from the ema, the trip card steps aside); the "+" ema adds a day
  await tp.locator('.ema.add').click();
  await tp.locator('.ema[data-day="0"]').click();
  await tp.waitForTimeout(1400);
  const s1 = await tp.evaluate(() => ({ k: document.querySelector('.tp-strip .ds-k')?.textContent, h: document.querySelector('.tp-strip h4')?.textContent, days: document.querySelectorAll('.ema:not(.add)').length, thread: !!document.querySelector('.tp-thread path'), card: getComputedStyle(document.querySelector('.tp-feat')).opacity }));
  check('trip: the "+" ema adds a day; an ema drops that day\'s strip on a thread and the trip card steps aside', s1.days === 4 && /DAY 1$/.test(s1.k || '') && /^\d+ [A-Z][a-z]+$/.test(s1.h || '') && s1.thread && +s1.card < 0.1, JSON.stringify(s1));

  // start place from the station list, then places by search (Japanese name) and by the + button
  await tp.locator('.tp-dock .fab').click();
  await tp.locator('.tp-sheet .kinds button', { hasText: 'Stations' }).click();
  await tp.locator('.tp-sheet input[type=search]').fill('京都');
  await tp.locator('.tp-sheet .res li', { has: tp.locator('b', { hasText: /^Kyoto$/ }) }).first().locator('button', { hasText: 'Start here' }).click();
  await tp.locator('.tp-search input').fill('清水寺');
  await tp.waitForSelector('.tp-sheet .res li');
  await tp.locator('.tp-sheet .kinds button', { hasText: 'Temples' }).click();
  await tp.locator('.tp-sheet .res li', { has: tp.locator('b', { hasText: /^Kiyomizu-dera$/ }) }).locator('button', { hasText: 'Add to Day 1' }).click();
  await tp.locator('.tp-sheet input[type=search]').fill('銀閣');
  await tp.locator('.tp-sheet .res li').first().locator('button', { hasText: 'Add to Day 1' }).click();
  await tp.locator('.tp-sheet input[type=search]').fill('八坂神社');
  await tp.locator('.tp-sheet .kinds button', { hasText: 'Shrines' }).click();
  await tp.locator('.tp-sheet .res li').first().locator('button', { hasText: 'Add to Day 1' }).click();
  await tp.locator('.tp-sheet .x').click();
  let st = await store();
  check('trip: a station can be the start; places are found by Japanese name and added to the day, and the plan is saved in the browser', st?.days[0].from === 'S00019' && JSON.stringify(st.days[0].stops.map((s) => s.id)) === JSON.stringify(['A00560', 'A00540', 'A00559']), JSON.stringify(st?.days[0]));

  // each place is one quiet line; its stay and arrival time open in place
  const rows0 = await tp.evaluate(() => ({ rows: document.querySelectorAll('.tp-strip button.ds-stop').length, edits: document.querySelectorAll('.tp-strip .ds-edit, .tp-strip .ds-pop').length, pills: document.querySelectorAll('.tp-strip .ds-pill').length }));
  await tp.locator('.tp-strip button.ds-stop').nth(0).click();
  await tp.locator('.tp-strip .ds-edit input[type=time]').fill('10:00');
  await tp.locator('.tp-strip .ds-edit .stp button', { hasText: '+' }).click();
  await tp.locator('.tp-strip .ds-edit .stp button', { hasText: '+' }).click();
  const stay = await tp.evaluate(() => document.querySelector('.tp-strip .ds-edit .stp b')?.textContent);
  await tp.locator('.tp-strip button.ds-stop').nth(0).click();
  check('trip: the strip shows one line per place and one pill per leg; a place\'s stay and arrival open only when asked', rows0.rows === 3 && rows0.edits === 0 && rows0.pills === 3 && stay === '1 h 30', JSON.stringify({ rows0, stay }));

  // the leg into Kiyomizu-dera by bus: route, stops and fare from the bus data, no ride time; then a cycle leg
  await tp.locator('.tp-strip .ds-leg').nth(0).locator('.ds-pill').click();
  await tp.locator('.tp-strip .ds-pop .ds-seg button', { hasText: 'Bus' }).click();
  await tp.waitForFunction(() => /^Bus \S+:/.test(document.querySelector('.tp-strip .ds-pop .lt')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const bus = await tp.evaluate(() => ({ lt: document.querySelector('.tp-strip .ds-pop .lt')?.textContent || '', opts: document.querySelectorAll('.tp-strip .ds-pop .buses li').length, xs: document.querySelector('.tp-strip .ds-pop .xs')?.textContent || '' }));
  await tp.screenshot({ path: `${out}/21-trip-strip-bus.png` });
  await tp.locator('.tp-strip .ds-leg').nth(0).locator('.ds-pill').click();
  await tp.locator('.tp-strip .ds-leg').nth(1).locator('.ds-pill').click();
  await tp.locator('.tp-strip .ds-pop .ds-seg button', { hasText: 'Cycle' }).click();
  await tp.locator('.tp-strip .ds-leg').nth(1).locator('.ds-pill').click();
  // the third leg starts as a bus (Ginkaku-ji to Yasaka Shrine is about 3 km); switch it to walking
  await tp.locator('.tp-strip .ds-leg').nth(2).locator('.ds-pill').click();
  await tp.locator('.tp-strip .ds-pop .ds-seg button', { hasText: 'Walk' }).click();
  await tp.locator('.tp-strip .ds-leg').nth(2).locator('.ds-pill').click();
  await tp.waitForFunction(() => { const t = [...document.querySelectorAll('.tp-strip .ds-pill')].map((x) => x.textContent); return t.length === 3 && t.every((x) => !/Finding/.test(x)); }, null, { timeout: 60000 }).catch(() => {});
  const lg = await tp.evaluate(() => ({ pills: [...document.querySelectorAll('.tp-strip .ds-pill')].map((x) => x.textContent), titles: [...document.querySelectorAll('.tp-strip .ds-pill')].map((x) => x.title), nt: document.querySelector('.tp-strip .ds-leg .nt')?.textContent, times: [...document.querySelectorAll('.tp-strip button.ds-stop .t')].map((x) => x.textContent) }));
  check('trip: a bus leg names the route, the stops and the official fare, says the ride time is not known, and states the stop search radius', /^Bus \S+: .+ → .+, \d+ stops?/.test(bus.lt) && /ride time not known/.test(bus.lt) && /¥\d+/.test(bus.lt) && bus.opts >= 1 && /Stops searched within \d+ m/.test(bus.xs) && /^\S+ · \d+ stops? · ¥\d+$/.test(lg.pills[0]) && lg.nt === 'no timetable', JSON.stringify({ bus, lg }));
  check('trip: walking and cycling legs are timed by the routing service; times run on from the arrival time the visitor set (10:00 + 1 h 30 stay + the cycle ride)', /^Cycle \d+ min · [\d.]+ k?m/.test(lg.titles[1]) && /^Walk \d+ min/.test(lg.titles[2]) && lg.times[0] === '10:00' && /^\d\d:\d\d$/.test(lg.times[1]) && lg.times[1] > '11:30' && lg.times[2] > lg.times[1], JSON.stringify(lg));
  await tp.screenshot({ path: `${out}/21-trip-strip.png` });
  await tp.locator('.tp-strip button.ds-stop').nth(2).click(); await tp.waitForTimeout(1500);
  const fo = await tp.evaluate(() => ({ photo: document.querySelector('.tp-scene').classList.contains('photo'), credit: document.querySelector('.tp-credit')?.textContent || '' }));
  await tp.locator('.tp-strip button.ds-stop').nth(2).click();
  check('trip: opening a place in the strip shows that place\'s own photo in the scene', fo.photo && /Zairon/.test(fo.credit), JSON.stringify(fo));
  await tp.locator('.tp-strip .ds-close').click();
  await tp.waitForTimeout(2500);
  const pv = await tp.evaluate(() => ({ photo: document.querySelector('.tp-scene').classList.contains('photo'), credit: document.querySelector('.tp-credit')?.textContent || '', hang: document.querySelectorAll('.ema.hang').length, next: document.querySelector('.tp-next .tx b')?.textContent, wx: document.querySelector('.tp-wx .loc')?.textContent, hours: [...document.querySelectorAll('.tp-wx .hours > div > span')].map((x) => x.textContent), fare: document.querySelector('.tp-feat .stats span:nth-child(3) b')?.textContent, markers: document.querySelectorAll('.tp-mapcard .tp-mk').length }));
  await tp.screenshot({ path: `${out}/22-trip-planned.png` });
  check('trip: planned, the next stop\'s own photo fills the scene with its author and licence; the ema hang on a rope', pv.photo && /Photo: .+ · CC|Public domain/.test(pv.credit) && pv.hang === 5 && /^Kiyomizu-dera · 10:00/.test(pv.next || ''), JSON.stringify(pv));
  check('trip: weather is asked for the next stop at its planned time; the map shows the day\'s places; the bus fare is added up', /Kiyomizu-dera/.test(pv.wx || '') && /10:00/.test(pv.wx || '') && pv.hours[0] === '09:00' && pv.markers === 4 && /^¥\d+/.test(pv.fare || ''), JSON.stringify(pv));

  // the pixel tree in the weather card: beside the numbers, never over them, and it moves when the pointer passes
  const tr0 = await tp.evaluate(() => { const c = document.querySelector('.tp-wx .pixel-tree'); if (!c) return null; const r = c.getBoundingClientRect(), ov = (q) => { const e = document.querySelector(q)?.getBoundingClientRect(); return !!e && !(r.left >= e.right || r.right <= e.left || r.top >= e.bottom || r.bottom <= e.top); }; return { w: r.width, temp: ov('.tp-wx .big b'), label: ov('.tp-wx .big span'), loc: ov('.tp-wx .loc'), hours: ov('.tp-wx .hours'), img: c.toDataURL(), aria: c.getAttribute('aria-label') }; });
  if (tr0) {
    const tb = await tp.locator('.tp-wx .pixel-tree').boundingBox();
    await tp.mouse.move(tb.x + 4, tb.y + tb.height * 0.35); await tp.mouse.move(tb.x + tb.width - 4, tb.y + tb.height * 0.3, { steps: 8 }); await tp.waitForTimeout(250);
    tr0.moved = await tp.evaluate((u) => document.querySelector('.tp-wx .pixel-tree').toDataURL() !== u, tr0.img);
    delete tr0.img;
  }
  check('trip: a pixel tree for the season sits in the weather card beside the numbers, never over them, and moves when the pointer passes', !!tr0 && tr0.w > 100 && !tr0.temp && !tr0.label && !tr0.loc && !tr0.hours && tr0.moved && /Pixel tree for autumn/.test(tr0.aria), JSON.stringify(tr0));
  // a place card dragged onto Day 2's ema
  await tp.evaluate(() => document.getElementById('dashboard').scrollIntoView());   // filling the plan's fields can scroll the page
  await tp.waitForTimeout(400);
  const card = await tp.locator('.tp-worth .pc').first().boundingBox(), ema2 = await tp.locator('.ema[data-day="1"]').boundingBox();
  await tp.mouse.move(card.x + 40, card.y + 40); await tp.mouse.down();
  await tp.mouse.move(card.x + 120, card.y - 60, { steps: 6 }); await tp.mouse.move(ema2.x + ema2.width / 2, ema2.y + ema2.height / 2, { steps: 12 });
  const ghost = await tp.evaluate(() => !!document.querySelector('.tp-ghost') && document.querySelector('.trip').classList.contains('dragging'));
  await tp.mouse.up(); await tp.waitForTimeout(400);
  st = await store();
  check('trip: a place card dragged onto an ema lands on that day', ghost && st.days[1].stops.length === 1, JSON.stringify({ ghost, d2: st.days[1].stops }));

  // Best order, Play day, Export
  await tp.locator('.tp-dock button', { hasText: 'Best order' }).click();
  await tp.waitForFunction(() => document.querySelector('.tp-sheet .cmp, .tp-sheet .warn'), null, { timeout: 45000 }).catch(() => {});
  const bo = await tp.evaluate(() => ({ cmp: [...document.querySelectorAll('.tp-sheet .cmp b')].map((x) => x.textContent), list: [...document.querySelectorAll('.tp-sheet ol li')].map((x) => x.textContent), warn: document.querySelector('.tp-sheet .warn')?.textContent }));
  check('trip: Best order compares travel times from the routing service and keeps the start first', (bo.cmp.length === 2 && bo.list[0] === 'Kyoto' && bo.list.length === 4) || !!bo.warn, JSON.stringify(bo));
  await tp.locator('.tp-sheet .x').click();
  await tp.locator('.tp-dock button', { hasText: 'Play day' }).click();
  await tp.waitForTimeout(1200);
  const pl = await tp.evaluate(() => ({ dot: !!document.querySelector('.tp-mapcard .tp-play'), clock: document.querySelector('.tp-mapcard .tp-clock')?.textContent || '' }));
  await tp.locator('.tp-dock button', { hasText: 'Stop' }).click();
  check('trip: Play day moves a light along the day\'s route with a clock', pl.dot && /\d\d:\d\d|time not known/.test(pl.clock), JSON.stringify(pl));
  const [dl] = await Promise.all([tp.waitForEvent('download', { timeout: 60000 }), tp.locator('.tp-dock button', { hasText: 'Export' }).click()]);
  const { readFileSync } = await import('node:fs');
  const icsPath = await dl.path(), ics = readFileSync(icsPath, 'utf8');
  check('trip: Export saves an .ics calendar with timed stops in UTC and the untimed-bus note', /\.ics$/.test(dl.suggestedFilename()) && ics.startsWith('BEGIN:VCALENDAR') && /DTSTART:20\d{6}T010000Z/.test(ics) && /no timetable/.test(ics.replace(/\r\n /g, '')), dl.suggestedFilename());

  // the other views, Support, and back to the GIS dashboard
  await tp.locator('.tp-rail button', { hasText: 'Agenda' }).click(); await tp.waitForTimeout(800);
  const ag = await tp.evaluate(() => document.querySelectorAll('.tp-agenda .col').length);
  await tp.locator('.tp-rail button', { hasText: 'Trip map' }).click(); await tp.waitForTimeout(2500);
  const fm = await tp.evaluate(() => ({ map: !!document.querySelector('.tp-full .tp-map canvas'), keys: document.querySelectorAll('.tp-daykey span').length }));
  await tp.locator('.tp-rail button', { hasText: 'Trip' }).first().click();
  await tp.evaluate(() => dispatchEvent(new CustomEvent('kyoto-trip-help')));   // the chat's "How the trip planner works" link
  await tp.waitForSelector('.tp-sheet.help', { timeout: 5000 });
  const hp = await tp.evaluate(() => document.querySelector('.tp-sheet.help')?.textContent || '');
  await tp.locator('.tp-sheet .x').click();
  check('trip: Agenda lists every day, Trip map shows them all, the planner help (now opened from the chat) explains the sources and that the plan stays in the browser', ag === 4 && fm.map && fm.keys === 4 && /no timetable/.test(hp) && /saved in this browser only/.test(hp) && /AI-generated illustration/.test(hp), JSON.stringify({ ag, fm }));
  await tp.locator('.tp-rail button', { hasText: 'Dashboard' }).click();
  await tp.waitForFunction(() => !document.querySelector('.trip'), null, { timeout: 5000 }).catch(() => {});
  const back = await tp.evaluate(() => ({ trip: !!document.querySelector('.trip'), top: getComputedStyle(document.querySelector('#dashboard > .top')).visibility }));
  check('trip: Dashboard returns to the GIS dashboard as it was', !back.trip && back.top === 'visible', JSON.stringify(back));

  // "Add to trip" on a place card opens the trip with that place added
  await tp.evaluate(() => { const i = document.querySelector('#q'); i.focus(); });
  await tp.locator('#q').fill('南禅寺');
  await tp.locator('.results button').first().click();
  await tp.locator('.add-trip').click();
  await tp.waitForSelector('.trip', { timeout: 8000 });
  await tp.waitForTimeout(1000);
  st = await store();
  check('trip: "Add to trip" on a place adds it to the open day and switches to the trip dashboard', st.days.some((x) => x.stops.some((s) => s.id === 'A00563')), JSON.stringify(st.days.map((x) => x.stops.map((s) => s.id))));
  check('trip: no page errors', tErr.length === 0, tErr.join(' | '));
  await tp.close();

  // the scene follows the season of the planned day and day or night follows the theme
  {
    const sc = [];
    for (const [date, theme, want] of [['2027-01-15', 'light', 'winter-day'], ['2027-01-15', 'dark', 'winter-night'], ['2026-04-06', 'light', 'spring-day'], ['2026-07-20', 'dark', 'summer-night']]) {
      const sp2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await sp2.addInitScript(([d0, th]) => {
        const days = [0, 1].map((i) => { const x = new Date(d0 + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + i); return { id: 'd' + i, date: x.toISOString().slice(0, 10), start: '09:00', end: '18:00', from: null, stops: [] }; });
        localStorage.setItem('kyoto-gis-trip-v1', JSON.stringify({ v: 1, title: 'Kyoto', hintSeen: true, days }));
        localStorage.setItem('kyoto-gis-theme', th);
      }, [date, theme]);
      await sp2.goto(url); await sp2.waitForSelector('.plan-entry', { timeout: 60000, state: 'attached' });
      await sp2.evaluate(() => { document.getElementById('dashboard').scrollIntoView(); document.querySelector('.plan-entry').click(); });
      await sp2.waitForSelector('.tp-illus', { timeout: 10000 }); await sp2.waitForTimeout(1500);
      sc.push(await sp2.evaluate(() => { const im = document.querySelector('.tp-illus'), em = [...document.querySelectorAll('.ema.pinned')].map((e) => e.getBoundingClientRect()), sr = document.querySelector('.tp-scene').getBoundingClientRect(); return { scene: im.dataset.scene, ok: im.complete && im.naturalWidth > 0, inside: em.length === 3 && em.every((r) => r.left > sr.left && r.right < sr.right && r.top > sr.top && r.bottom < sr.bottom) }; }));
      sc[sc.length - 1].want = want;
      await sp2.close();
    }
    {
      const sp3 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await sp3.addInitScript(() => { localStorage.setItem('kyoto-gis-trip-v1', JSON.stringify({ v: 1, title: 'Kyoto', hintSeen: true, days: [{ id: 'd0', date: '2026-11-23', start: '09:00', end: '18:00', from: null, stops: [] }] })); localStorage.setItem('kyoto-gis-theme', 'light'); localStorage.setItem('kyoto-gis-season', 'spring'); });
      await sp3.goto(url); await sp3.waitForSelector('.plan-entry', { timeout: 60000, state: 'attached' });
      await sp3.evaluate(() => { document.getElementById('dashboard').scrollIntoView(); document.querySelector('.plan-entry').click(); });
      await sp3.waitForSelector('.tp-illus'); await sp3.waitForTimeout(1200);
      sc.push({ scene: await sp3.evaluate(() => document.querySelector('.tp-illus').dataset.scene), want: 'spring-day', ok: true, inside: true, note: 'November trip, spring picked on the site' });
      await sp3.close();
    }
    check('trip: the scene follows the planned day\'s season (or the season picked on the site) and the light or dark theme, and the ema stay on its board', sc.every((x) => x.scene === x.want && x.ok && x.inside), JSON.stringify(sc));
  }

  // phone: the trip dashboard stacks, no sideways scroll, the dock stays on screen
  const tph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp2 = await tph.newPage();
  await pp2.goto(url); await pp2.waitForSelector('.plan-entry', { timeout: 60000, state: 'attached' });
  await pp2.evaluate(() => { document.getElementById('dashboard').scrollIntoView(); document.querySelector('.plan-entry').click(); });
  await pp2.waitForSelector('.trip', { timeout: 10000 }); await pp2.waitForTimeout(1500);
  const ph = await pp2.evaluate(() => { const t = document.querySelector('.trip'), dk = document.querySelector('.tp-dock').getBoundingClientRect(); const em = [...document.querySelectorAll('.ema')].map((e) => e.getBoundingClientRect()); return { sw: t.scrollWidth, cw: t.clientWidth, dock: dk.bottom <= innerHeight && dk.top > innerHeight - 120, emaIn: em.every((r) => r.left >= 0 && r.right <= innerWidth) }; });
  await pp2.screenshot({ path: `${out}/23-trip-phone.png` });
  check('trip, phone: one column, no sideways scroll, the dock stays at the bottom, the ema on the board are on screen', ph.sw <= ph.cw + 1 && ph.dock && ph.emaIn, JSON.stringify(ph));
  await tph.close();
}

// ---------- the atlas house and the girl in a kimono (AtlasHouse.jsx) ----------
{
  const hp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const hErr = []; hp.on('pageerror', (e) => hErr.push(e.message));
  await hp.route('**/api/assistant/status', (r) => r.fulfill({ json: { configured: true, model: 'gemini-4-hydrogen', thinking: { default: 'medium', planning: 'high', allowed: ['medium', 'high'] }, service_tier: 'standard', billing_currency: { code: 'MYR', symbol: 'RM', per_usd: 4.122961 }, limits: { max_cost_per_day: 3 }, today: { requests: 0, usd: 0 } } }));
  await hp.goto(url);
  await hp.waitForSelector('.ah-house', { timeout: 60000, state: 'attached' });
  const where = async () => hp.evaluate(() => { const h = document.querySelector('.ah-house'); if (!h || h.hidden) return null; const r = h.getBoundingClientRect(), m = document.querySelector('#dashboard .center').getBoundingClientRect(); return { w: Math.round(r.width), inMap: r.left >= m.left && r.bottom <= m.bottom - 20 && r.left - m.left < 30 && m.bottom - r.bottom < 40 }; });
  const spots = {};
  for (const id of ['seasons', 'explore', 'dashboard']) { await hp.evaluate((i) => document.getElementById(i).scrollIntoView(), id); await hp.waitForTimeout(900); spots[id] = await where(); }
  check('house: only in the map\'s bottom-left corner (above its credit line), about 96 px; not on the season or Explore pages', !spots.seasons && !spots.explore && spots.dashboard?.inMap && spots.dashboard.w === 96, JSON.stringify(spots));
  await hp.waitForTimeout(1500);
  const hb = await hp.locator('.ah-house').boundingBox();
  await hp.mouse.click(hb.x + hb.width / 2, hb.y + hb.height * 0.75);
  await hp.waitForTimeout(250);
  const hint = await hp.evaluate(() => document.querySelector('.ah-bubble')?.textContent || '');
  await hp.mouse.dblclick(hb.x + hb.width / 2, hb.y + hb.height * 0.75);
  await hp.waitForTimeout(350);
  const k = await hp.evaluate(() => ({ knock: document.querySelector('.ah-house').classList.contains('knock'), kon: document.querySelectorAll('.ah-kon').length, girl: !!document.querySelector('.ah-girl') }));
  await hp.waitForSelector('.ah-girl', { timeout: 5000 });
  await hp.waitForTimeout(1300);
  const o = await hp.evaluate(() => ({ open: document.querySelector('.ah-svg').classList.contains('open'), door: getComputedStyle(document.querySelector('.ah-door.l')).transform, chat: document.querySelector('.as')?.classList.contains('on') || false }));
  await hp.waitForFunction(() => /How can I help/.test(document.querySelector('.ah-bubble')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  const wave = await hp.evaluate(() => ({ bubble: document.querySelector('.ah-bubble')?.textContent || '', arm: !!document.querySelector('.ah-arm.up') }));
  await hp.waitForSelector('.as.on', { timeout: 6000 });
  await hp.waitForTimeout(600);
  const chat = await hp.evaluate(() => { const c = document.querySelector('.as').getBoundingClientRect(), g = document.querySelector('.ah-girl').getBoundingClientRect(); return { on: document.querySelector('.as').classList.contains('on'), beside: c.left >= g.right - 20, bottom: Math.round(innerHeight - c.bottom) }; });
  await hp.screenshot({ path: `${out}/26-house-chat.png` });
  check('house: a click shows "Double-click to knock"; a double-click knocks (the doors shake, コン), they slide open, she steps out, waves "How can I help?" and the chat opens beside her', /Double-click to knock/.test(hint) && k.knock && k.kon === 2 && !k.girl && o.open && o.door !== 'none' && /How can I help/.test(wave.bubble) && wave.arm && chat.on && chat.beside, JSON.stringify({ hint, k, o, wave, chat }));
  // drag her somewhere else; she stays there
  const g0 = await hp.locator('.ah-girl').boundingBox();
  await hp.mouse.move(g0.x + g0.width / 2, g0.y + g0.height * 0.3); await hp.mouse.down();
  await hp.mouse.move(g0.x + g0.width / 2 + 200, g0.y - 150, { steps: 10 });
  const held = await hp.evaluate(() => ({ held: document.querySelector('.ah-girl').classList.contains('held'), wide: !!document.querySelector('.ah-girl-svg circle[r="4.8"]') }));
  await hp.mouse.move(g0.x + g0.width / 2 + 560, g0.y - 260, { steps: 10 });
  await hp.mouse.up(); await hp.waitForTimeout(800);
  const g1 = await hp.locator('.ah-girl').boundingBox();
  check('house: she can be picked up (held pose, surprised face) and put down anywhere; she stays where she was dropped', held.held && held.wide && g1.x > g0.x + 500 && g1.y < g0.y - 200, JSON.stringify({ held, from: [g0.x, g0.y], to: [g1.x, g1.y] }));
  // stroke her head
  const petSeen = hp.waitForFunction(() => document.querySelectorAll('.ah-heart').length >= 3 && [...document.querySelectorAll('.ah-girl-svg path')].some((p) => p.getAttribute('d')?.startsWith('M33.5 59.5')), null, { timeout: 10000 }).then(() => true).catch(() => false);
  for (let i = 0; i < 8; i++) await hp.mouse.move(g1.x + g1.width * (i % 2 ? 0.25 : 0.75), g1.y + g1.height * 0.2, { steps: 3 });
  const pet = { seen: await petSeen };
  check('house: stroking her head makes her smile and hearts rise', pet.seen, JSON.stringify(pet));
  // close the chat: she walks home and the doors close
  await hp.locator('.as-h [aria-label="Close the assistant"]').click();
  await hp.waitForTimeout(400);
  const walking = await hp.evaluate(() => document.querySelector('.ah-girl')?.classList.contains('returning') || false);
  await hp.waitForTimeout(1600);
  const home = await hp.evaluate(() => ({ girl: !!document.querySelector('.ah-girl'), open: document.querySelector('.ah-svg').classList.contains('open') }));
  check('house: closing the chat sends her walking home and the doors close', walking && !home.girl && !home.open, JSON.stringify({ walking, home }));
  // the season dresses her and the branch; Enter on the house knocks too
  await hp.evaluate(() => { document.documentElement.dataset.season = 'winter'; });
  await hp.waitForTimeout(300);
  const winter = await hp.evaluate(() => ({ snow: document.querySelectorAll('.ah-svg use[href="#ah-snow"]').length, roof: !!document.querySelector('.ah-svg path[fill="#fff"]') }));
  await hp.locator('.ah-house').focus(); await hp.keyboard.press('Enter');
  await hp.waitForSelector('.ah-girl', { timeout: 5000 }).catch(() => {});
  const kimono = await hp.evaluate(() => document.querySelector('.ah-girl-svg path[fill]')?.getAttribute('fill'));
  check('house: the season changes the branch (snow in winter) and her kimono; Enter on the house knocks as well', winter.snow > 0 && winter.roof && kimono === '#a796d2', JSON.stringify({ winter, kimono }));
  // tuck it away into a small round badge and bring it back (remembered)
  await hp.locator('.as-h [aria-label="Close the assistant"]').click().catch(() => {}); await hp.waitForTimeout(1600);
  await hp.locator('.ah-house').hover(); await hp.waitForTimeout(250);
  await hp.locator('.ah-tuck').click(); await hp.waitForTimeout(300);
  const tk = await hp.evaluate(() => ({ badge: !!document.querySelector('.ah-badge'), house: !document.querySelector('.ah-house').hidden, kept: localStorage.getItem('kyoto-house-tucked') }));
  await hp.locator('.ah-badge').click(); await hp.waitForTimeout(300);
  const tk2 = await hp.evaluate(() => ({ badge: !!document.querySelector('.ah-badge'), house: !document.querySelector('.ah-house').hidden }));
  check('house: it can be tucked into a small badge and brought back', tk.badge && !tk.house && tk.kept === '1' && !tk2.badge && tk2.house, JSON.stringify({ tk, tk2 }));
  // phone: smaller
  await hp.setViewportSize({ width: 390, height: 844 }); await hp.evaluate(() => document.getElementById('dashboard').scrollIntoView()); await hp.waitForTimeout(900);
  const ph = await where();
  check('house, phone: smaller, still in the map corner', ph && ph.w === 64 && ph.inMap, JSON.stringify(ph));
  check('house: no page errors', hErr.length === 0, hErr.join(' | '));
  await hp.close();
}

// ---------- the atlas assistant: Gemini through the relay on this computer (a scripted stand-in answers here) ----------
{
  const ap = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const aErr = []; ap.on('pageerror', (e) => aErr.push(e.message));
  let configured = false;
  const bodies = [], sentKey = [], script = [], heads = [];
  let calls = 0;
  const LIM = { max_requests_per_day: 200, max_cost_per_day: 3, max_tool_rounds_per_question: 6, max_tool_calls_per_question: 12, max_history_turns: 6, max_output_tokens: 8192, timeout_seconds: 90, retries: 2, duplicate_window_seconds: 5 };
  const PRI = { selectable_models: ['gemini-4-hydrogen', 'gemini-3.6-flash'], service_tiers: ['standard', 'priority'], price_usd_per_million_tokens: { 'gemini-4-hydrogen': { input: 1.5, cached_input: 0.075, output_including_thinking: 7.5 }, 'gemini-3.6-flash': { input: 0.75, cached_input: 0.075, output_including_thinking: 3.75 } }, price_usd_per_million_tokens_priority: { 'gemini-4-hydrogen': { input: 2.7, cached_input: 0.135, output_including_thinking: 13.5 }, 'gemini-3.6-flash': { input: 1.35, cached_input: 0.135, output_including_thinking: 6.75 } } };
  await ap.route('**/api/assistant/status', (r) => r.fulfill({ json: { ...PRI, configured, model: 'gemini-4-hydrogen', thinking: { default: 'medium', planning: 'high', allowed: ['medium', 'high'] }, service_tier: 'standard', limits: LIM, billing_currency: { code: 'MYR', symbol: 'RM', per_usd: 4.122961 }, today: { requests: calls, usd: +(calls * 0.003525).toFixed(6) } } }));
  await ap.route('**/api/assistant', (r) => {
    const b = r.request().postDataJSON(); bodies.push(b); heads.push(r.request().headers());
    sentKey.push(r.request().headers()['x-goog-api-key'] || (r.request().url().includes('key=') ? 'in url' : null));
    let next = script.shift(); if (typeof next === 'function') next = next(b);
    r.fulfill(next.status ? { status: next.status, json: next.json } : { json: next });
  });
  // what the relay adds to each answer: 1,200 input, 80 output and 150 thinking tokens, about $0.003525
  const use = () => { calls++; return { input: 1200, cached: 0, output: 80, thinking_tokens: 150, total: 1430, usd: 0.003525, currency: 'MYR', cost: 0.014533, thinking: 'medium', tier: 'standard', today: { requests: calls, usd: +(calls * 0.003525).toFixed(6) } }; };
  const call = (name, args, id) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id }, thoughtSignature: 'sig-' + id }] } }], atlasUsage: use() });
  const say = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }], atlasUsage: use() });
  const ask = async (q) => { const n = await ap.locator('.as-msg.ai').count(); await ap.locator('.as-in textarea').fill(q); await ap.keyboard.press('Enter'); await ap.waitForFunction((k) => document.querySelectorAll('.as-msg.ai:not(.live)').length > k, n, { timeout: 15000 }); await ap.waitForTimeout(1600); };
  await ap.goto(url);
  await ap.evaluate(() => localStorage.removeItem('kyoto-gis-trip-v1'));
  await ap.waitForSelector('.map-tools .ask-rail', { timeout: 60000 });
  await ap.evaluate(() => document.getElementById('dashboard').scrollIntoView());
  await ap.waitForTimeout(800);
  await ap.locator('.map-tools .ask-rail').click();
  await ap.waitForSelector('.as.on .as-setup', { timeout: 5000 });
  const setup = await ap.evaluate(() => ({ h: document.querySelector('.as-setup h5').textContent, cmd: document.querySelector('.as-cmd')?.textContent, off: document.querySelector('.as-in textarea').disabled }));
  await ap.screenshot({ path: `${out}/24-assistant-setup.png` });
  check('assistant: "Ask the atlas" in the map tools opens it; without a key it shows how to connect Gemini (setx GEMINI_API_KEY) and the box is off', setup.h === 'Connect Gemini' && /setx GEMINI_API_KEY/.test(setup.cmd) && setup.off, JSON.stringify(setup));

  configured = true;
  await ap.locator('.as-setup .as-btn').click();
  await ap.waitForSelector('.as-sugs button', { timeout: 5000 });
  script.push(call('search_places', { query: '清水寺' }, 'c1'),
    (b) => call('show_place', { id: b.contents.at(-1).parts[0].functionResponse.response.result.results[0].id, section: 'walking' }, 'c2'),
    call('add_to_trip', { id: 'A00560', day: 2, way: 'bus', stay_minutes: 90 }, 'c3'),
    say('Opened **Kiyomizu-dera** at its walking routes and added it to Day 2:\n- by bus\n- 90 minutes'));
  await ask('Show me the walking routes from Kiyomizu-dera and add it to day 2');
  const r1 = await ap.evaluate(() => ({
    acts: [...document.querySelectorAll('.as-msg.ai .as-acts li')].map((l) => l.textContent), tag: document.querySelector('.as-msg.ai .as-tag')?.textContent,
    bold: document.querySelector('.as-txt b')?.textContent, items: document.querySelectorAll('.as-txt li').length,
    place: document.querySelector('.place-h')?.textContent || '', fold: document.querySelector('.pmore .fold-h')?.getAttribute('aria-expanded'), tab: document.querySelector('.pmore [role=tab][aria-selected=true]')?.textContent,
    stops: JSON.parse(localStorage.getItem('kyoto-gis-trip-v1') || 'null')?.days[1]?.stops.map((s) => `${s.id}:${s.mode}:${s.stay}`),
    clear: (() => { const c = document.querySelector('.as').getBoundingClientRect(), p = document.querySelector('#details').getBoundingClientRect(), r = document.querySelector('.map-tools.rail').getBoundingClientRect(); return c.right <= p.left && c.top >= r.bottom; })(),
  }));
  await ap.screenshot({ path: `${out}/25-assistant-place.png` });
  check('assistant: it finds the place, opens its panel at Walking Routes (the chat sits on the map, clear of that panel and below the map tools) and adds it to Day 2; the answer has an AI tag and lists the three actions', r1.acts.length === 3 && /Searched/.test(r1.acts[0]) && /Opened .*walking/.test(r1.acts[1]) && /Added .* to Day 2/.test(r1.acts[2]) && r1.tag === 'AI' && r1.bold === 'Kiyomizu-dera' && r1.items === 2 && r1.place.includes('清水寺') && r1.fold === 'true' && r1.tab === 'Walking Routes' && JSON.stringify(r1.stops) === '["A00560:bus:90"]' && r1.clear, JSON.stringify(r1));
  check('assistant: Gemini\'s own turn goes back unchanged (thought signature) with each result under its call id; the page never sends a key', bodies.length === 4 && bodies[1].contents[1].parts[0].thoughtSignature === 'sig-c1' && bodies[1].contents[2].parts[0].functionResponse.id === 'c1' && /Today in Kyoto: \d{4}-\d{2}-\d{2}/.test(bodies[0].contents[0].parts[1].text) && sentKey.every((k) => k == null), JSON.stringify({ n: bodies.length, sentKey }));

  script.push(call('open_trip', { day: 2 }, 'c4'), say('Here is Day 2.'));
  const before2 = bodies.length;
  await ask('Plan a 2-day trip for me and open day 2');
  await ap.waitForSelector('.tp-strip', { timeout: 10000 });
  await ap.waitForTimeout(1200);
  const r2 = await ap.evaluate(() => ({ strip: document.querySelector('.tp-strip')?.textContent || '', on: document.querySelector('.as')?.classList.contains('on'), z: [getComputedStyle(document.querySelector('.as')).zIndex, getComputedStyle(document.querySelector('.trip-root')).zIndex] }));
  check('assistant: it opens Day 2 of the trip planner, which shows the place it added; the chat stays on top', /Kiyomizu/.test(r2.strip) && r2.on && +r2.z[0] > +r2.z[1], JSON.stringify(r2));
  const use1 = await ap.evaluate(() => [...document.querySelectorAll('.as-msg.ai .as-use')].map((e) => e.textContent));
  const today1 = await ap.evaluate(() => document.querySelector('.as-today')?.textContent || '');
  check('assistant: medium thinking for a question, high for a multi-day plan; each answer shows its tokens and estimated cost, and today\'s total is shown', bodies.slice(0, before2).every((b) => b.generationConfig.thinkingConfig.thinkingLevel === 'medium') && bodies.slice(before2).every((b) => b.generationConfig.thinkingConfig.thinkingLevel === 'high') && bodies.every((b) => b.serviceTier === 'standard' && b.generationConfig.maxOutputTokens === 8192) && /medium thinking · 4 calls · 5,720 tokens \(4,800 in, 320 out, 600 thinking\) · ≈ RM0\.058 \(US\$0\.014\)/.test(use1[0]) && /high thinking · 2 calls/.test(use1[1]) && /Today 6 calls · ≈ RM0\.087 of RM3/.test(today1), JSON.stringify({ use1, today1, levels: bodies.map((b) => b.generationConfig.thinkingConfig.thinkingLevel) }));

  script.push({ status: 400, json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } });
  await ask('What is the weather at Kiyomizu-dera?');
  const err = await ap.evaluate(() => [...document.querySelectorAll('.as-err')].map((e) => e.textContent).join(' '));
  check('assistant: an error from Gemini (here a bad key) is shown as it is, with Try again', /API key not valid/.test(err) && /Try again/.test(err), err);

  // the model bar at the top: preferred model, tier, automatic fallback, and what the last request did
  const bar0 = await ap.evaluate(() => ({ sel: document.querySelector('.as-msel select').value, opts: [...document.querySelectorAll('.as-msel option')].map((o) => o.textContent).join(), tier: document.querySelector('.as-tier [aria-checked=true]')?.textContent, fb: document.querySelector('.as-fb input').checked, conn: document.querySelector('.as-conn').textContent, top: document.querySelector('.as-models').getBoundingClientRect().top < document.querySelector('.as-body').getBoundingClientRect().top }));
  const h0 = heads.map((h) => [h['x-atlas-preferred'], h['x-atlas-fallback'] || 'on', h['x-atlas-priority-confirmed'] || '-']);
  check('assistant model bar: at the top, Gemini 4 Hydrogen by default, Standard, Auto fallback on; it shows the preferred model, the model used, the connection (here the last error code) and the cost; every request named the preferred model with fallback on and no Priority',
    bar0.top && bar0.sel === 'gemini-4-hydrogen' && bar0.opts === 'Gemini 4 Hydrogen,Gemini 3.6 Flash' && bar0.tier === 'Standard' && bar0.fb && /Error 400/.test(bar0.conn) && /Preferred: Gemini 4 Hydrogen/.test(bar0.conn) && /Used: — \(no answer\)/.test(bar0.conn)
    && h0.length === bodies.length && h0.every(([p, f, pr]) => p === 'gemini-4-hydrogen' && f === 'on' && pr === '-') && bodies.every((b) => b.serviceTier === 'standard'), JSON.stringify({ bar0, h0: h0.slice(0, 2) }));
  // Priority: the prices first; "Keep Standard" changes nothing; "Use Priority" applies to the next question only after that
  await ap.locator('.as-tier button', { hasText: 'Priority' }).click(); await ap.waitForTimeout(200);
  const pri0 = await ap.evaluate(() => ({ box: document.querySelector('.as-pri')?.textContent || '', tier: document.querySelector('.as-tier [aria-checked=true]').textContent }));
  await ap.locator('.as-pri .as-btn', { hasText: 'Keep Standard' }).click(); await ap.waitForTimeout(150);
  const pri1 = await ap.evaluate(() => ({ box: !!document.querySelector('.as-pri'), tier: document.querySelector('.as-tier [aria-checked=true]').textContent }));
  await ap.locator('.as-tier button', { hasText: 'Priority' }).click(); await ap.locator('.as-pri .as-btn', { hasText: 'Use Priority' }).click();
  await ap.locator('.as-msel select').selectOption('gemini-3.6-flash'); await ap.locator('.as-fb input').uncheck();
  script.push(() => ({ ...say('Ginkaku-ji is in Sakyo.'), atlasUsage: { ...use(), model: 'gemini-3.6-flash', preferred_model: 'gemini-3.6-flash', fallback: false, tier: 'priority', tier_requested: 'priority', status: 200, kind: 'ok', usd: 0.006345 } }));
  const nH = heads.length;
  await ask('Where is Ginkaku-ji?');
  const hP = heads[nH], bP = bodies[nH];
  const bar1 = await ap.evaluate(() => ({ conn: document.querySelector('.as-conn').textContent, sub: document.querySelector('.as-title p').textContent, use: [...document.querySelectorAll('.as-msg.ai .as-use')].at(-1)?.textContent || '' }));
  check('assistant model bar: Priority asks first, showing Standard and Priority prices per 1M tokens and for a typical question; after "Use Priority" the request goes as Priority with the confirmation, to the chosen 3.6 Flash, with fallback off; the bar shows Connected, the model used and the cost',
    /Use Priority for Gemini 4 Hydrogen\?/.test(pri0.box) && /US\$1\.50.*US\$7\.50/.test(pri0.box) && /US\$2\.70.*US\$13\.50/.test(pri0.box) && /RM0\.096/.test(pri0.box) && /RM0\.173/.test(pri0.box) && pri0.tier === 'Standard' && !pri1.box && pri1.tier === 'Standard'
    && bP.serviceTier === 'priority' && hP['x-atlas-priority-confirmed'] === 'yes' && hP['x-atlas-preferred'] === 'gemini-3.6-flash' && hP['x-atlas-fallback'] === 'off'
    && /Connected/.test(bar1.conn) && /Used: Gemini 3\.6 Flash/.test(bar1.conn) && /Priority/.test(bar1.conn) && /Last ≈ RM0\.026/.test(bar1.conn) && /Gemini 3\.6 Flash · Priority/.test(bar1.sub) && /Priority · /.test(bar1.use),
    JSON.stringify({ pri0: pri0.box.slice(0, 200), pri1, hP: [hP['x-atlas-preferred'], hP['x-atlas-fallback'], hP['x-atlas-priority-confirmed'], bP.serviceTier], bar1 }));
  // back to the defaults for the rest of the run
  await ap.locator('.as-tier button', { hasText: 'Standard' }).click(); await ap.locator('.as-msel select').selectOption('gemini-4-hydrogen'); await ap.locator('.as-fb input').check();

  await ap.locator('.as-h [aria-label="Close the assistant"]').click();
  await ap.waitForTimeout(1600);
  await ap.locator('.ah-house').dblclick();
  await ap.waitForSelector('.as.on', { timeout: 8000 });
  const kept = await ap.evaluate(() => document.querySelectorAll('.as-msg').length);
  await ap.locator('.as-help').click();
  await ap.waitForSelector('.tp-sheet.help', { timeout: 5000 });
  const r3 = await ap.evaluate(() => ({ help: document.querySelector('.tp-sheet.help')?.textContent || '', support: getComputedStyle(document.querySelector('.tp-support')).visibility }));
  check('assistant: the house opens the same conversation again; in the trip planner the chat links to the planner\'s help (the old Support button is gone)', kept >= 6 && /saved in this browser only/.test(r3.help) && r3.support === 'hidden', JSON.stringify({ kept, support: r3.support }));
  check('assistant: no page errors', aErr.length === 0, aErr.join(' | '));
  await ap.close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
