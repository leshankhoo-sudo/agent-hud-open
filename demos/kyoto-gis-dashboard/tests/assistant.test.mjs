// The atlas assistant: the relay that holds the Gemini key, the conversation loop, and the tools it uses.
// No real Gemini call is made here: the relay and the loop are tested against stand-ins, and the tools run
// on the real files in public/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assistantMiddleware, DEFAULT_MODEL } from '../server/assistantRelay.js';
import { askAssistant, MAX_STEPS, SYSTEM } from '../src/lib/assistant.js';
import { DECLARATIONS, makeHandlers, actionLabel } from '../src/assistantTools.js';
import { loadAll } from '../src/lib/data.js';
import { indexWalking } from '../src/lib/walking.js';
import * as TP from '../src/lib/trip.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---------- relay ----------
function call(mw, { url = '/api/assistant', method = 'POST', body = '' } = {}) {
  return new Promise((resolve) => {
    const req = { url, method, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } };
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { resolve({ status: this.statusCode, body: t, next: false }); } };
    mw(req, res, () => resolve({ next: true }));
  });
}
const cfg = (key) => () => ({ key, model: DEFAULT_MODEL, base: 'https://stand-in.test' });

test('relay: status says whether a key is set and which model, and never shows the key', async () => {
  const off = await call(assistantMiddleware(null, cfg('')), { url: '/api/assistant/status', method: 'GET' });
  assert.deepEqual(JSON.parse(off.body), { configured: false, model: 'gemini-4-hydrogen' });
  const on = await call(assistantMiddleware(null, cfg('SECRET-KEY-123')), { url: '/api/assistant/status', method: 'GET' });
  assert.deepEqual(JSON.parse(on.body), { configured: true, model: 'gemini-4-hydrogen' });
  assert.ok(!on.body.includes('SECRET'));
});

test('relay: without a key it answers 503 and sends nothing; other paths pass through; only POST', async () => {
  let sent = 0;
  const f = async () => { sent++; return new Response('{}'); };
  const r = await call(assistantMiddleware(f, cfg('')), { body: '{"contents":[]}' });
  assert.equal(r.status, 503);
  assert.match(JSON.parse(r.body).error.message, /GEMINI_API_KEY/);
  assert.equal(sent, 0);
  assert.deepEqual(await call(assistantMiddleware(f, cfg('k')), { url: '/data/photos.json', method: 'GET' }), { next: true });
  assert.equal((await call(assistantMiddleware(f, cfg('k')), { method: 'GET' })).status, 405);
});

test('relay: adds the key as a header (never in the URL), forwards the body unchanged and returns Google\'s answer as it is', async () => {
  let seen;
  const f = async (u, o) => { seen = { u, o }; return new Response('{"error":{"message":"quota"}}', { status: 429 }); };
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '清水寺' }] }] });
  const r = await call(assistantMiddleware(f, cfg('SECRET-KEY-123')), { body });
  assert.equal(seen.u, 'https://stand-in.test/v1beta/models/gemini-4-hydrogen:generateContent');
  assert.ok(!seen.u.includes('SECRET'));
  assert.equal(seen.o.headers['x-goog-api-key'], 'SECRET-KEY-123');
  assert.equal(Buffer.from(seen.o.body).toString(), body);
  assert.equal(r.status, 429);
  assert.equal(r.body, '{"error":{"message":"quota"}}');
  const down = await call(assistantMiddleware(async () => { throw new Error('offline'); }, cfg('k')), { body });
  assert.equal(down.status, 502);
});

test('no API key is written in the code or the data', async () => {
  const hits = [];
  const walk = async (dir) => {
    for (const n of await readdir(dir)) {
      const p = `${dir}/${n}`;
      if ((await stat(p)).isDirectory()) { await walk(p); continue; }
      if (!/\.(js|jsx|mjs|json|ps1|bat|txt|html|css|md)$/.test(n)) continue;
      const t = await readFile(p, 'utf8');
      if (/AIza[0-9A-Za-z_-]{30,}/.test(t)) hits.push(p);
    }
  };
  for (const d of ['src', 'server', 'windows', 'public/data', 'tests']) await walk(`${root}${d}`);
  assert.deepEqual(hits, []);
});

// ---------- the conversation loop ----------
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const modelCall = (name, args, id) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id }, thoughtSignature: 'opaque-signature' }] } }] });
const modelText = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] });

test('loop: runs the tool Gemini asks for, sends the result back with the call\'s id and the model turn unchanged, then returns the text', async () => {
  const bodies = [];
  const script = [modelCall('search_places', { query: 'Kiyomizu' }, 'c1'), modelText('Found it.')];
  const f = async (u, o) => { bodies.push(JSON.parse(o.body)); return reply(script.shift()); };
  const ran = [];
  const seen = [];
  const r = await askAssistant({ text: 'Where is Kiyomizu-dera?', note: 'Today in Kyoto: 2026-11-23.', declarations: DECLARATIONS,
    handlers: { search_places: (a) => { ran.push(a); return { count: 1 }; } }, onAction: (a) => seen.push(a.name), fetchImpl: f });
  assert.equal(r.text, 'Found it.');
  assert.deepEqual(ran, [{ query: 'Kiyomizu' }]);
  assert.deepEqual(seen, ['search_places']);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].systemInstruction.parts[0].text, SYSTEM);
  assert.equal(bodies[0].tools[0].functionDeclarations.length, DECLARATIONS.length);
  assert.equal(bodies[0].contents[0].parts[0].text, 'Where is Kiyomizu-dera?');
  assert.match(bodies[0].contents[0].parts[1].text, /Context, not from the user: Today in Kyoto: 2026-11-23/);
  assert.deepEqual(bodies[1].contents[1].parts[0].thoughtSignature, 'opaque-signature');
  assert.deepEqual(bodies[1].contents[2], { role: 'user', parts: [{ functionResponse: { name: 'search_places', id: 'c1', response: { result: { count: 1 } } } }] });
  assert.equal(r.contents.length, 4);   // question, call, result, answer: the next question continues from here
});

test('loop: a failing or unknown tool goes back to Gemini as an error; HTTP errors and blocked answers are reported', async () => {
  const script = [modelCall('get_place', { id: 'X' }, 'a'), modelCall('no_such_tool', {}, 'b'), modelText('Sorry.')];
  const bodies = [];
  const r = await askAssistant({ text: 'q', declarations: DECLARATIONS, handlers: { get_place: () => { throw new Error('No record X.'); } },
    fetchImpl: async (u, o) => { bodies.push(JSON.parse(o.body)); return reply(script.shift()); } });
  assert.deepEqual(r.actions.map((a) => a.result.error), ['No record X.', 'Unknown tool no_such_tool']);
  assert.deepEqual(bodies[1].contents[2].parts[0].functionResponse.response, { result: { error: 'No record X.' } });
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => reply({ error: { message: 'API key not valid.' } }, 400) }), /API key not valid/);
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => reply({ promptFeedback: { blockReason: 'SAFETY' } }) }), /no answer \(SAFETY\)/);
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /could not be reached/);
});

test(`loop: stops after ${MAX_STEPS} rounds of tools`, async () => {
  let n = 0;
  const r = await askAssistant({ text: 'q', declarations: DECLARATIONS, handlers: { get_trip: () => ({ days: [] }) }, fetchImpl: async () => { n++; return reply(modelCall('get_trip', {}, 'g' + n)); } });
  assert.equal(n, MAX_STEPS + 1);
  assert.equal(r.actions.length, MAX_STEPS);
  assert.match(r.text, /stopped/);
});

test('the rules tell Gemini to answer only from the data and never to give a bus ride time', () => {
  assert.match(SYSTEM, /Answer only from what the tools return/);
  assert.match(SYSTEM, /never state a bus ride time/);
  assert.match(SYSTEM, /Never guess or invent/);
});

// ---------- the tools, on the real data ----------
globalThis.fetch = async (u) => { try { const t = await readFile(`${root}public/${u}`, 'utf8'); return { ok: true, json: async () => JSON.parse(t) }; } catch { return { ok: false, status: 404 }; } };
const { data: d } = await loadAll('');
const A = d.attractions.features, Tr = d.transport.features;
const byId = new Map();
A.forEach((f) => byId.set(f.properties.id, { f, layer: 'attraction' }));
Tr.forEach((f) => byId.set(f.properties.id, { f, layer: 'transport' }));
const walkIndex = indexWalking(d.walking);
const did = [];
const tools = makeHandlers({ A, Tr, byId, d, walkIndex, showPlace: (...a) => did.push(['showPlace', ...a]), showLayer: (...a) => did.push(['showLayer', ...a]), openTrip: (a) => did.push(['openTrip', a]), openSection: (a) => did.push(['openSection', a]) });

test('tools: every declared tool has a handler, and the other way round; required fields are declared', () => {
  assert.deepEqual(DECLARATIONS.map((x) => x.name).sort(), Object.keys(tools).sort());
  for (const x of DECLARATIONS) for (const r of x.parameters.required || []) assert.ok(x.parameters.properties[r], `${x.name}.${r}`);
});

test('search: the clearest match comes first, and one bus stop\'s platforms are listed once', () => {
  const st = tools.search_places({ query: 'Kyoto', kind: 'station' });
  assert.equal(st.results[0].id, 'S00019');
  assert.equal(st.results[0].kind, 'Railway station');
  assert.equal(tools.search_places({ query: 'Ginkaku' }).results[0].id, 'A00540');
  assert.equal(tools.search_places({ query: '清水寺' }).results[0].id, 'A00560');
  const ks = tools.search_places({ query: 'Kyoto Station' }).results;
  assert.equal(new Set(ks.map((r) => r.name + r.city)).size, ks.length);
  assert.ok(ks[0].records_with_this_name > 1);
  // a city in English matches whole words: Uji is 宇治市, not 宇治田原町 (Ujitawara Town)
  const uji = tools.search_places({ query: '', kind: 'museum', city: 'Uji', limit: 10 });
  assert.equal(uji.count, 5);
  assert.ok(uji.results.every((r) => r.kind === 'Museum' && r.city === '宇治市 (Uji City)'));
  assert.equal(tools.search_places({ query: '', kind: 'any', city: '宇治' }).count, 20);
  assert.equal(tools.search_places({ query: '', kind: 'any', city: 'Uji' }).count, 19);
});

test('get_place: names, city, and the walking route to the nearest stop exactly as in the walking file', () => {
  const p = tools.get_place({ id: 'A00560' });
  assert.equal(p.name_ja, '清水寺');
  assert.match(p.city, /Higashiyama/);
  const w = walkIndex.byAttraction.get('A00560').bus;
  assert.equal(p.walking.nearest_bus_stop.stop_id, w.stop_id);
  assert.equal(p.walking.nearest_bus_stop.walk_m, w.distance_m);
  assert.match(p.not_in_atlas, /opening hours/);
  assert.throws(() => tools.get_place({ id: 'A99999' }), /search_places/);
  const bs = tools.get_place({ id: 'S00424' });
  assert.ok(Array.isArray(bs.bus_routes_here) && bs.bus_routes_here.length > 0);
});

test('bus_between: route numbers, stops and fares from the bus data, and no ride time', () => {
  const r = tools.bus_between({ from_id: 'S00424', to_id: 'A00540' });
  assert.ok(r.options.length > 0);
  for (const o of r.options) {
    assert.deepEqual(Object.keys(o).sort(), ['adult_fare_yen', 'alight', 'board', 'bus', 'stops']);
    assert.ok(o.stops > 0);
  }
  assert.match(r.note, /ride times are not known/);
});

test('trip tools: add to a day (new days as needed, at most 7), no duplicates, remove, hours and dates; each change is announced', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  let events = 0;
  globalThis.dispatchEvent = (e) => { if (e.type === 'kyoto-trip-changed') events++; return true; };
  try {
    const a = tools.add_to_trip({ id: 'A00560', day: 2, way: 'bus', stay_minutes: 90, arrive: '10:30' });
    assert.equal(a.day, 2);
    let t = TP.loadTrip();
    assert.deepEqual(t.days[1].stops.map((s) => [s.id, s.mode, s.stay, s.at]), [['A00560', 'bus', 90, '10:30']]);
    assert.match(tools.add_to_trip({ id: 'A00560', day: 2 }).note, /Already/);
    tools.add_to_trip({ id: 'A00540', day: 5 });
    t = TP.loadTrip();
    assert.equal(t.days.length, 5);
    assert.throws(() => tools.add_to_trip({ id: 'A00540', day: 8 }), /at most 7/);
    assert.throws(() => tools.add_to_trip({ id: 'NOPE', day: 1 }), /No record/);
    tools.set_trip_day({ day: 1, start: '08:00', end: '20:00', start_place_id: 'S00019', first_date: '2026-12-01' });
    t = TP.loadTrip();
    assert.deepEqual([t.days[0].start, t.days[0].end, t.days[0].from, t.days[0].date, t.days[4].date], ['08:00', '20:00', 'S00019', '2026-12-01', '2026-12-05']);
    tools.remove_from_trip({ id: 'A00560', day: 2 });
    assert.equal(TP.loadTrip().days[1].stops.length, 0);
    assert.deepEqual(tools.get_trip().days[4].places.map((p) => p.id), ['A00540']);
    assert.equal(events, 4);
  } finally { delete globalThis.localStorage; delete globalThis.dispatchEvent; }
});

test('dashboard tools only ask the page to act, and each action has a label for the chat', () => {
  did.length = 0;
  tools.show_place({ id: 'A00560', section: 'walking' });
  tools.show_map_layer({ layer: 'density' });
  tools.open_trip({ day: 2 });
  tools.open_section({ name: 'sources' });
  assert.deepEqual(did, [['showPlace', 'A00560', 'walking'], ['showLayer', 'density'], ['openTrip', { day: 2, view: 'trip' }], ['openSection', 'sources']]);
  assert.equal(actionLabel({ name: 'show_place', args: { id: 'A00560', section: 'walking' }, result: { name: 'Kiyomizu-dera' } }), 'Opened Kiyomizu-dera · walking');
  assert.equal(actionLabel({ name: 'add_to_trip', args: { id: 'A00560', day: 2 }, result: { name: 'Kiyomizu-dera' } }), 'Added Kiyomizu-dera to Day 2');
  assert.match(actionLabel({ name: 'get_place', args: { id: 'X' }, result: { error: 'No record X.' } }), /No record X/);
});
