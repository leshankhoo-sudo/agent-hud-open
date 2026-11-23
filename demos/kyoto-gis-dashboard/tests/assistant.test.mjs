// The atlas assistant: the relay that holds the Gemini key, the conversation loop, and the tools it uses.
// No real Gemini call is made here: the relay and the loop are tested against stand-ins, and the tools run
// on the real files in public/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantMiddleware, loadConfig, usageOf, shapeRequest, localDay, DEFAULTS } from '../server/assistantRelay.js';
import { askAssistant, SYSTEM, thinkingFor, isPlanning, trimHistory } from '../src/lib/assistant.js';
import { DECLARATIONS, makeHandlers, actionLabel } from '../src/assistantTools.js';
import { loadAll } from '../src/lib/data.js';
import { indexWalking } from '../src/lib/walking.js';
import * as TP from '../src/lib/trip.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---------- relay ----------
function call(mw, { url = '/api/assistant', method = 'POST', body = '', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { url, method, headers, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } };
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { resolve({ status: this.statusCode, body: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }); } };
    mw(req, res, () => resolve({ next: true }));
  });
}
const conf = (over = {}) => ({ ...structuredClone(DEFAULTS), ...over, limits: { ...DEFAULTS.limits, ...over.limits } });
const KEY = 'SECRET-KEY-123';
const pageBody = (text = 'Where is Kiyomizu-dera?', extra = {}) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { thinkingConfig: { thinkingLevel: 'medium' }, maxOutputTokens: 8192 }, serviceTier: 'standard', ...extra });
const gemini = (status = 200, usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 1500 }) =>
  new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }], usageMetadata: usage, modelVersion: 'gemini-4-hydrogen' } : { error: { message: `stand-in error ${status}` } }), { status, headers: { 'Content-Type': 'application/json' } });
async function relay({ over = {}, fetchImpl, key = KEY, clock } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-relay-'));
  const logFile = join(dir, 'usage.jsonl');
  const sent = [], waits = [];
  const t = clock || { now: Date.parse('2026-11-23T12:00:00Z') };
  const f = fetchImpl || (async (u, o) => { sent.push({ u, o, body: JSON.parse(o.body) }); return gemini(); });
  const mw = assistantMiddleware({ fetchImpl: async (u, o) => { if (fetchImpl) sent.push({ u, o, body: JSON.parse(o.body) }); return f(u, o); }, config: () => conf(over), key: () => key, logFile, base: () => 'https://stand-in.test', now: () => t.now, sleep: async (ms) => { waits.push(ms); } });
  return { mw, logFile, sent, t, waits, log: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

test('config: gemini-4-hydrogen, medium thinking (high for planning), Standard tier, Standard prices, a daily cap of RM3 and limits', () => {
  const c = loadConfig(undefined, () => '');
  assert.equal(c.model, 'gemini-4-hydrogen');
  assert.deepEqual(c.thinking, { default: 'medium', planning: 'high', allowed: ['medium', 'high'] });
  assert.equal(c.service_tier, 'standard');
  const pr = (m) => [c.price_usd_per_million_tokens[m].input, c.price_usd_per_million_tokens[m].cached_input, c.price_usd_per_million_tokens[m].output_including_thinking];
  assert.deepEqual(pr('gemini-4-hydrogen'), [1.5, 0.075, 7.5]);
  assert.deepEqual(c.fallback_models, ['gemini-3.8-flash', 'gemini-3.6-flash']);
  assert.deepEqual([pr('gemini-3.8-flash'), pr('gemini-3.6-flash')], [[0.75, 0.075, 3.75], [0.75, 0.075, 3.75]]);
  assert.deepEqual([c.limits.retries, c.limits.backoff_seconds, c.limits.cooldown_seconds], [3, 1, 180]);
  assert.deepEqual([c.billing_currency.code, c.billing_currency.symbol, c.billing_currency.per_usd, c.limits.max_cost_per_day], ['MYR', 'RM', 4.122961, 3]);
  assert.ok(c.limits.max_requests_per_day > 0 && c.limits.max_tool_rounds_per_question > 0 && c.limits.timeout_seconds > 0);
  assert.equal(loadConfig(undefined, (n) => (n === 'GEMINI_MODEL' ? 'gemini-3.8-flash' : '')).model, 'gemini-3.8-flash');
});

test('relay: status tells the page the model, thinking, tier, limits and today\'s use, and never the key', async () => {
  const off = await call((await relay({ key: '' })).mw, { url: '/api/assistant/status', method: 'GET' });
  assert.equal(off.json.configured, false);
  const { mw } = await relay();
  const on = await call(mw, { url: '/api/assistant/status', method: 'GET' });
  assert.equal(on.json.configured, true);
  assert.equal(on.json.model, 'gemini-4-hydrogen');
  assert.equal(on.json.thinking.default, 'medium');
  assert.equal(on.json.service_tier, 'standard');
  assert.deepEqual(on.json.today, { requests: 0, usd: 0, cost: 0 });
  assert.ok(!on.body.includes('SECRET'));
});

test('relay: without a key it answers 503 and sends nothing; other paths pass through; only POST', async () => {
  const r0 = await relay({ key: '' });
  const r = await call(r0.mw, { body: pageBody() });
  assert.equal(r.status, 503);
  assert.match(r.json.error.message, /GEMINI_API_KEY/);
  assert.equal(r0.sent.length, 0);
  const { mw } = await relay();
  assert.deepEqual(await call(mw, { url: '/data/photos.json', method: 'GET' }), { next: true });
  assert.equal((await call(mw, { method: 'GET' })).status, 405);
});

test('relay: the key goes only in a header; Standard tier and thinking go to Google; usage and cost come back and are logged without the text or key', async () => {
  const r0 = await relay();
  const r = await call(r0.mw, { body: pageBody('清水寺はどこ？') });
  assert.equal(r.status, 200);
  const s = r0.sent[0];
  assert.equal(s.u, 'https://stand-in.test/v1beta/models/gemini-4-hydrogen:generateContent');
  assert.equal(s.o.headers['x-goog-api-key'], KEY);
  assert.ok(!s.u.includes('SECRET'));
  assert.equal(s.body.serviceTier, 'standard');
  assert.deepEqual(s.body.generationConfig, { thinkingConfig: { thinkingLevel: 'medium' }, maxOutputTokens: 8192 });
  assert.equal(s.body.contents[0].parts[0].text, '清水寺はどこ？');
  // 1,000 input at $1.50/M + (200 output + 300 thinking) at $7.50/M = $0.00525
  const u = r.json.atlasUsage;
  assert.deepEqual([u.input, u.output, u.thinking_tokens, u.total, u.usd, u.thinking, u.tier, u.attempts], [1000, 200, 300, 1500, 0.00525, 'medium', 'standard', 1]);
  assert.deepEqual([u.cost, u.currency], [0.00525, 'USD']);
  assert.deepEqual(u.today, { requests: 1, usd: 0.00525, cost: 0.00525 });
  const log = r0.log();
  assert.equal(log.length, 1);
  const raw = readFileSync(r0.logFile, 'utf8');
  assert.ok(!raw.includes('清水寺') && !raw.includes('SECRET'));
  // a request with no generationConfig gets the defaults
  const r1 = await relay();
  await call(r1.mw, { body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }) });
  assert.deepEqual([r1.sent[0].body.serviceTier, r1.sent[0].body.generationConfig.thinkingConfig.thinkingLevel, r1.sent[0].body.generationConfig.maxOutputTokens], ['standard', 'medium', 8192]);
});

test('relay: Priority, a thinking level that is not allowed, or a missing or too large output cap are refused and nothing is sent', async () => {
  const r0 = await relay();
  const bad = [
    pageBody('a', { serviceTier: 'priority' }), pageBody('b', { service_tier: 'priority' }),
    pageBody('c', { generationConfig: { thinkingConfig: { thinkingLevel: 'xhigh' }, maxOutputTokens: 100 } }),
    pageBody('d', { generationConfig: { thinkingConfig: {}, maxOutputTokens: 100 } }),
    pageBody('e', { generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } }),
    pageBody('f', { generationConfig: { thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 60000 } }),
    '{"contents":[]}', 'not json',
  ];
  for (const b of bad) assert.equal((await call(r0.mw, { body: b })).status, 400, b);
  assert.equal(r0.sent.length, 0);
  assert.equal(shapeRequest(JSON.parse(pageBody('g', { generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' }, maxOutputTokens: 4000 } })), conf()).thinking, 'high');
});

test('relay: the same request twice within the window is sent once; after the window it is sent again', async () => {
  const r0 = await relay();
  assert.equal((await call(r0.mw, { body: pageBody() })).status, 200);
  const dup = await call(r0.mw, { body: pageBody() });
  assert.equal(dup.status, 409);
  assert.equal(r0.sent.length, 1);
  r0.t.now += 6000;
  assert.equal((await call(r0.mw, { body: pageBody() })).status, 200);
  assert.equal(r0.sent.length, 2);
});

test('relay: busy answers are retried with exponential backoff (1 s, 2 s, 4 s), at most 3 times; billing and request errors are not retried', async () => {
  let n = 0;
  const busy = await relay({ fetchImpl: async () => (++n < 4 ? gemini(503) : gemini()) });
  const ok = await call(busy.mw, { body: pageBody() });
  assert.deepEqual([ok.status, ok.json.atlasUsage.attempts, busy.sent.length, busy.waits], [200, 4, 4, [1000, 2000, 4000]]);
  const always = await relay({ fetchImpl: async () => gemini(503) });
  const a = await call(always.mw, { body: pageBody() });
  assert.deepEqual([a.status, a.json.error.kind, always.sent.length], [503, 'overloaded', 4]);
  assert.match(a.json.error.message, /^Gemini is overloaded right now \(HTTP 503\)\. .* Models tried: gemini-4-hydrogen 503 > gemini-4-hydrogen 503 > gemini-4-hydrogen 503 > gemini-4-hydrogen 503\. Google said: stand-in error 503$/);
  const pay = await relay({ fetchImpl: async () => gemini(402) });
  const p = await call(pay.mw, { body: pageBody() });
  assert.deepEqual([p.status, pay.sent.length, p.json.error.kind], [402, 1, 'billing']);
  assert.match(p.json.error.message, /^Billing: the Google project has no prepaid credit left \(HTTP 402\)/);
  assert.equal(pay.log()[0].error, 'stand-in error 402');
  const bad = await relay({ fetchImpl: async () => gemini(400) });
  assert.deepEqual([(await call(bad.mw, { body: pageBody() })).json.error.kind, bad.sent.length], ['bad_request', 1]);
});

test('relay: 429, network errors and timeouts are told apart', async () => {
  const rl = await relay({ fetchImpl: async () => gemini(429) });
  const r = await call(rl.mw, { body: pageBody() });
  assert.deepEqual([r.status, r.json.error.kind], [429, 'rate_limit']);
  assert.match(r.json.error.message, /^Rate limit or quota reached \(HTTP 429\)/);
  const down = await relay({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const d = await call(down.mw, { body: pageBody() });
  assert.deepEqual([d.status, d.json.error.kind, down.sent.length], [502, 'network', 4]);
  assert.match(d.json.error.message, /could not reach the Gemini API \(network error\)/);
  const slow = await relay({ fetchImpl: async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); } });
  const s1 = await call(slow.mw, { body: pageBody() });
  assert.deepEqual([s1.status, s1.json.error.kind], [504, 'timeout']);
  assert.match(s1.json.error.message, /did not answer within 45 s/);
});

const FALLBACK = { fallback_models: ['gemini-3.8-flash', 'gemini-3.6-flash'], price_usd_per_million_tokens: { ...DEFAULTS.price_usd_per_million_tokens, 'gemini-3.8-flash': { input: 0.75, cached_input: 0.075, output_including_thinking: 3.75 }, 'gemini-3.6-flash': { input: 0.75, cached_input: 0.075, output_including_thinking: 3.75 } } };
const modelOf = (u) => u.match(/models\/(.+):generateContent/)[1];

test('fallback: when the main model is overloaded the next model answers; failing models are skipped for 3 minutes, then tried again', async () => {
  const down = new Set(['gemini-4-hydrogen', 'gemini-3.8-flash']);
  const r0 = await relay({ over: FALLBACK, fetchImpl: async (u) => (down.has(modelOf(u)) ? gemini(503) : gemini()) });
  const a = await call(r0.mw, { body: pageBody('one') });
  const u = a.json.atlasUsage;
  assert.deepEqual([a.status, u.model, u.fallback, u.attempts, u.tried, r0.waits], [200, 'gemini-3.6-flash', true, 3, 'gemini-4-hydrogen 503 > gemini-3.8-flash 503 > gemini-3.6-flash 200', [1000, 2000]]);
  // priced at gemini-3.6-flash's rates: 1,000 in at $0.75/M + 500 out and thinking at $3.75/M
  assert.equal(u.usd, 0.002625);
  // the next question goes straight to the model that answered
  await call(r0.mw, { body: pageBody('two') });
  assert.deepEqual(r0.sent.slice(3).map((x) => modelOf(x.u)), ['gemini-3.6-flash']);
  // after the cooldown the main model is tried first again
  r0.t.now += 181_000; down.clear();
  const c = await call(r0.mw, { body: pageBody('three') });
  assert.deepEqual([c.json.atlasUsage.model, c.json.atlasUsage.fallback], ['gemini-4-hydrogen', false]);
  const st = await call(r0.mw, { url: '/api/assistant/status', method: 'GET' });
  assert.deepEqual(st.json.fallback_models, ['gemini-3.8-flash', 'gemini-3.6-flash']);
});

test('fallback: a model that does not exist (404) is passed over at once', async () => {
  const r0 = await relay({ over: FALLBACK, fetchImpl: async (u) => (modelOf(u) === 'gemini-4-hydrogen' ? gemini(404) : gemini()) });
  const a = await call(r0.mw, { body: pageBody() });
  assert.deepEqual([a.json.atlasUsage.model, a.json.atlasUsage.tried, r0.waits], ['gemini-3.8-flash', 'gemini-4-hydrogen 404 > gemini-3.8-flash 200', []]);
});

test('fallback: a conversation stays on its model; when it has to move, earlier thought signatures become Google\'s placeholder', async () => {
  const withSig = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'q' }] }, { role: 'model', parts: [{ functionCall: { name: 'get_trip', args: {}, id: 'c1' }, thoughtSignature: 'SIG-FROM-3.6' }] }, { role: 'user', parts: [{ functionResponse: { name: 'get_trip', id: 'c1', response: { result: {} } } }] }], generationConfig: { thinkingConfig: { thinkingLevel: 'medium' }, maxOutputTokens: 8192 }, serviceTier: 'standard' });
  const ok = await relay({ over: FALLBACK });
  await call(ok.mw, { body: withSig, headers: { 'x-atlas-model': 'gemini-3.6-flash' } });
  assert.deepEqual([modelOf(ok.sent[0].u), ok.sent[0].body.contents[1].parts[0].thoughtSignature], ['gemini-3.6-flash', 'SIG-FROM-3.6']);
  const moved = await relay({ over: FALLBACK, fetchImpl: async (u) => (modelOf(u) === 'gemini-3.6-flash' ? gemini(503) : gemini()) });
  const m = await call(moved.mw, { body: withSig, headers: { 'x-atlas-model': 'gemini-3.6-flash' } });
  assert.equal(m.json.atlasUsage.model, 'gemini-4-hydrogen');
  assert.equal(moved.sent[1].body.contents[1].parts[0].thoughtSignature, 'skip_thought_signature_validator');
});

test('relay: daily limits on requests and on the estimated cost in the billing currency (RM) stop further calls', async () => {
  const r0 = await relay({ over: { limits: { max_requests_per_day: 2 } } });
  assert.equal((await call(r0.mw, { body: pageBody('1') })).status, 200);
  assert.equal((await call(r0.mw, { body: pageBody('2') })).status, 200);
  const third = await call(r0.mw, { body: pageBody('3') });
  assert.equal(third.status, 429);
  assert.match(third.json.error.message, /Daily limit reached: 2 Gemini requests today/);
  assert.equal(r0.sent.length, 2);
  const r1 = await relay({ over: { billing_currency: { code: 'MYR', symbol: 'RM', per_usd: 4 }, limits: { max_cost_per_day: 0.04 } } });
  await writeFile(r1.logFile, JSON.stringify({ day: localDay(r1.t.now), usd: 0.0101 }) + '\n' + JSON.stringify({ day: '2026-11-22', usd: 5 }) + '\n');
  const over = await call(r1.mw, { body: pageBody() });
  assert.equal(over.status, 429);
  assert.match(over.json.error.message, /about RM0\.0404 \(US\$0\.0101\) spent today; max_cost_per_day is RM0\.04/);
  assert.equal(r1.sent.length, 0);
});

test('cost: thinking tokens are billed as output, cached input at the cached price', () => {
  assert.deepEqual(usageOf({ promptTokenCount: 2_000_000, cachedContentTokenCount: 1_000_000, candidatesTokenCount: 100_000, thoughtsTokenCount: 100_000 }), { input: 2_000_000, cached: 1_000_000, output: 100_000, thinking_tokens: 100_000, total: 2_200_000, usd: 1.5 + 0.075 + 1.5 });
  assert.equal(usageOf(undefined).usd, 0);
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
const use = { input: 1000, output: 100, thinking_tokens: 50, total: 1150, usd: 0.002, today: { requests: 1, usd: 0.002 } };
const modelCall = (name, args, id) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id }, thoughtSignature: 'opaque-signature' }] } }], atlasUsage: use });
const modelText = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }], atlasUsage: use });

test('thinking: medium by default; high for multi-day itineraries and route planning; a chosen level wins', () => {
  for (const q of ['Plan a 3-day trip in Kyoto', 'Make me a two day itinerary', 'Best route for my day 2', '帮我安排三天行程', '京都 2天 路线规划', '3日間のプランを作って']) assert.equal(thinkingFor(q, 'auto'), 'high', q);
  for (const q of ['What is the weather at Uji tomorrow?', 'Where is Kiyomizu-dera?', 'Add Ginkaku-ji to day 2']) assert.equal(thinkingFor(q, 'auto'), 'medium', q);
  assert.equal(thinkingFor('Plan a 3-day trip', 'medium'), 'medium');
  assert.equal(thinkingFor('Where is it?', 'high'), 'high');
  assert.ok(isPlanning('itinerary') && !isPlanning('weather'));
});

test('loop: runs the tool Gemini asks for, sends the result back with the call\'s id and the model turn unchanged, then returns the text and the summed usage', async () => {
  const bodies = [];
  const script = [modelCall('search_places', { query: 'Kiyomizu' }, 'c1'), modelText('Found it.')];
  const f = async (u, o) => { bodies.push(JSON.parse(o.body)); return reply(script.shift()); };
  const ran = [];
  const seen = [];
  const r = await askAssistant({ text: 'Where is Kiyomizu-dera?', note: 'Today in Kyoto: 2026-11-23.', thinking: 'high', declarations: DECLARATIONS,
    handlers: { search_places: (a) => { ran.push(a); return { count: 1 }; } }, onAction: (a) => seen.push(a.name), fetchImpl: f });
  assert.equal(r.text, 'Found it.');
  assert.deepEqual(ran, [{ query: 'Kiyomizu' }]);
  assert.deepEqual(seen, ['search_places']);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].systemInstruction.parts[0].text, SYSTEM);
  assert.equal(bodies[0].tools[0].functionDeclarations.length, DECLARATIONS.length);
  assert.deepEqual(bodies[0].generationConfig, { thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 8192 });
  assert.equal(bodies[0].serviceTier, 'standard');
  assert.equal(bodies[0].contents[0].parts[0].text, 'Where is Kiyomizu-dera?');
  assert.match(bodies[0].contents[0].parts[1].text, /Context, not from the user: Today in Kyoto: 2026-11-23/);
  assert.deepEqual(bodies[1].contents[1].parts[0].thoughtSignature, 'opaque-signature');
  assert.deepEqual(bodies[1].contents[2], { role: 'user', parts: [{ functionResponse: { name: 'search_places', id: 'c1', response: { result: { count: 1 } } } }] });
  assert.equal(r.contents.length, 4);
  assert.deepEqual([r.usage.calls, r.usage.total, r.usage.thinking_tokens, r.usage.usd, r.usage.thinking], [2, 2300, 100, 0.004, 'high']);
});

test('loop: the page tells the relay which model the conversation is on, and follows a fallback', async () => {
  const heads = [];
  const fb = (o) => ({ ...o, atlasUsage: { ...use, model: 'gemini-3.6-flash', fallback: true, status: 200 } });
  const script = [fb(modelCall('get_trip', {}, 'g1')), fb(modelText('ok'))];
  const r = await askAssistant({ text: 'q', model: '', declarations: DECLARATIONS, handlers: { get_trip: () => ({ days: [] }) },
    fetchImpl: async (u, o) => { heads.push(o.headers['X-Atlas-Model'] || null); return reply(script.shift()); } });
  assert.deepEqual(heads, [null, 'gemini-3.6-flash']);
  assert.deepEqual([r.usage.model, r.usage.fallback], ['gemini-3.6-flash', true]);
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => reply({ error: { message: 'Gemini is overloaded right now (HTTP 503).', kind: 'overloaded', tried: 'gemini-4-hydrogen 503' } }, 503) }), (e) => e.kind === 'overloaded' && e.tried === 'gemini-4-hydrogen 503');
});

test('loop: a failing or unknown tool goes back to Gemini as an error; HTTP errors and blocked answers are reported', async () => {
  const script = [modelCall('get_place', { id: 'X' }, 'a'), modelCall('no_such_tool', {}, 'b'), modelText('Sorry.')];
  const bodies = [];
  const r = await askAssistant({ text: 'q', declarations: DECLARATIONS, handlers: { get_place: () => { throw new Error('No record X.'); } },
    fetchImpl: async (u, o) => { bodies.push(JSON.parse(o.body)); return reply(script.shift()); } });
  assert.deepEqual(r.actions.map((a) => a.result.error), ['No record X.', 'Unknown tool no_such_tool']);
  assert.deepEqual(bodies[1].contents[2].parts[0].functionResponse.response, { result: { error: 'No record X.' } });
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => reply({ error: { message: 'Your prepayment credits are depleted.' } }, 402) }), /prepayment credits are depleted/);
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => reply({ promptFeedback: { blockReason: 'SAFETY' } }) }), /no answer \(SAFETY\)/);
  await assert.rejects(askAssistant({ text: 'q', declarations: [], handlers: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /could not be reached/);
});

test('loop: a repeated call is answered from the first result, a round of only repeats ends the answer, and the history stays valid', async () => {
  let n = 0, ran = 0;
  const r = await askAssistant({ text: 'q', declarations: DECLARATIONS, handlers: { get_trip: () => { ran++; return { days: [] }; } },
    fetchImpl: async () => reply(modelCall('get_trip', {}, 'g' + ++n)) });
  assert.equal(ran, 1);
  assert.equal(n, 2);
  assert.deepEqual(r.actions.map((a) => a.repeat), [false, true]);
  assert.match(r.text, /repeating the same steps/);
  assert.deepEqual(r.contents.map((c) => c.role), ['user', 'model']);
  assert.ok(!JSON.stringify(r.contents).includes('functionCall'));
});

test('loop: rounds and calls per question are capped', async () => {
  let n = 0;
  const r = await askAssistant({ text: 'q', limits: { max_tool_rounds_per_question: 3 }, declarations: DECLARATIONS, handlers: { get_place: (a) => ({ id: a.id }) },
    fetchImpl: async () => { n++; return reply(modelCall('get_place', { id: 'A' + n }, 'p' + n)); } });
  assert.equal(n, 4);
  assert.equal(r.actions.length, 3);
  assert.match(r.text, /stopped after 3 rounds/);
  assert.equal(r.contents.at(-1).role, 'model');
  const many = { candidates: [{ content: { role: 'model', parts: Array.from({ length: 13 }, (_, i) => ({ functionCall: { name: 'get_place', args: { id: 'A' + i }, id: 'm' + i } })) } }] };
  let ran = 0;
  const r2 = await askAssistant({ text: 'q', declarations: DECLARATIONS, handlers: { get_place: () => { ran++; return {}; } }, fetchImpl: async () => reply(many) });
  assert.equal(ran, 0);
  assert.match(r2.text, /more than 12 steps/);
});

test('loop: only the last questions are sent again, cut at a question the user typed', () => {
  const q = (t) => ({ role: 'user', parts: [{ text: t }] });
  const h = [q('1'), { role: 'model', parts: [{ functionCall: {} }] }, { role: 'user', parts: [{ functionResponse: {} }] }, { role: 'model', parts: [{ text: 'a1' }] }, q('2'), { role: 'model', parts: [{ text: 'a2' }] }, q('3'), { role: 'model', parts: [{ text: 'a3' }] }];
  assert.deepEqual(trimHistory(h, 2).map((c) => c.parts[0].text), ['2', 'a2', '3', 'a3']);
  assert.equal(trimHistory(h, 5).length, h.length);
});

test('the rules tell Gemini to answer only from the data, never to give a bus ride time, and not to repeat calls', () => {
  assert.match(SYSTEM, /Answer only from what the tools return/);
  assert.match(SYSTEM, /never state a bus ride time/);
  assert.match(SYSTEM, /Never guess or invent/);
  assert.match(SYSTEM, /never repeat a call/);
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

test('search: when one kind finds nothing, records of other kinds with that name come back with a note (the shrine is stored as a viewpoint)', () => {
  const r = tools.search_places({ query: '伏見稲荷大社', kind: 'shrine' });
  assert.equal(r.count, 0);
  assert.equal(r.other_kinds[0].id, 'A00306');
  assert.equal(r.other_kinds[0].kind, 'Viewpoint');
  assert.match(r.note, /OpenStreetMap/);
  // 金閣寺's main record is named 金閣 (Golden Pavilion): the full name only finds the viewpoints that lie in it
  assert.ok(tools.search_places({ query: '金閣寺', kind: 'temple' }).other_kinds.length > 0);
  assert.equal(tools.search_places({ query: '金閣' }).results[0].id, 'A00265');
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
