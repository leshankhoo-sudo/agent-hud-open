// The assistant's relay for the dev and preview servers (vite.config.js). The Windows ZIP has the same relay
// in windows/serve.ps1, with the same rules. The browser never sees the Gemini API key: it posts the
// conversation to /api/assistant on this computer, and the relay adds the key from this computer's
// environment and passes the request on to Google's Gemini API.
//
// What the relay enforces (server/assistant-config.json; the ZIP has a copy next to serve.ps1):
//   - the model: the one the person chose in the page (X-Atlas-Preferred, one of selectable_models; else
//     gemini-4-hydrogen unless GEMINI_MODEL is set); with automatic fallback on (the default; the page sends
//     X-Atlas-Fallback: off to turn it off), when it is overloaded, rate-limited or failing, the other models in
//     order (a model that fails is skipped for a few minutes, so later questions go straight to one that answers)
//   - the service tier: Standard by default. Priority (about 1.8 times the price) only when the request says
//     so AND carries X-Atlas-Priority-Confirmed: yes, which the page sends only after the person has seen
//     and accepted the Priority prices; the cost is estimated at the tier Google reports it served
//   - the thinking level: one of the allowed levels (medium by default, high for planning), and an output cap
//   - daily limits on requests and estimated cost (in the billing currency, RM by default), and a guard
//     against the same request sent twice
//   - a timeout per attempt and at most 3 retries with exponential backoff (1 s, 2 s, 4 s), never more;
//     a billing (402), key (401/403) or request (400) error is not retried
//   - a usage log (logs/assistant-usage.jsonl): for each call the token counts (input, cached, output,
//     thinking) and the estimated cost in US dollars and the billing currency. No question, answer or key
//     is written there.
//
//   GEMINI_API_KEY   the key from Google AI Studio (required; never put it in the code or the repository)
//   GEMINI_MODEL     optional, another model id
//   GEMINI_API_BASE  optional, only for tests (a stand-in server)
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = join(HERE, 'assistant-config.json');
export const LOG_FILE = join(HERE, '..', 'logs', 'assistant-usage.jsonl');
export const DEFAULT_MODEL = 'gemini-4-hydrogen';
const MAX_BODY = 2 * 1024 * 1024;
// Gemini attaches thought signatures to its turns; another model rejects them ("Corrupted thought
// signature"), so when the conversation moves to another model they are replaced by the placeholder Google
// documents for conversations carried over from another model.
export const SIGNATURE_PLACEHOLDER = 'skip_thought_signature_validator';
// what went wrong, from the status of an attempt
export function errorKind(status, err) {
  if (!status) return err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network';
  if (status < 300) return 'ok';
  return { 402: 'billing', 429: 'rate_limit', 503: 'overloaded', 400: 'bad_request', 401: 'auth', 403: 'auth', 404: 'not_found' }[status] || (status >= 500 ? 'server' : 'error');
}
const RETRY_KINDS = new Set(['overloaded', 'rate_limit', 'server', 'timeout', 'network', 'not_found']);
const COOL_KINDS = new Set(['overloaded', 'rate_limit', 'server', 'timeout']);
export function failMessage(kind, status, google, tried, conf) {
  const why = {
    billing: 'Billing: the Google project has no prepaid credit left (HTTP 402). Add credit in AI Studio > Billing.',
    rate_limit: 'Rate limit or quota reached (HTTP 429). Wait a minute and ask again.',
    overloaded: 'Gemini is overloaded right now (HTTP 503). This is on Google\'s side; try again in a few minutes.',
    server: `The Gemini service had an error (HTTP ${status}). Try again in a few minutes.`,
    timeout: `Gemini did not answer within ${conf.limits.timeout_seconds} s.`,
    network: 'This computer could not reach the Gemini API (network error). Check the internet connection or a firewall.',
    auth: `Google refused the API key (HTTP ${status}). Check GEMINI_API_KEY on this computer.`,
    not_found: 'The model was not found (HTTP 404). Check the model names in assistant-config.json.',
    bad_request: 'Gemini could not read the request (HTTP 400).',
  }[kind] || `Gemini answered HTTP ${status}.`;
  return `${why} Models tried: ${tried}.${google ? ` Google said: ${google}` : ''}`;
}
export function withPlaceholderSignatures(body) {
  return { ...body, contents: body.contents.map((c) => ({ ...c, parts: (c.parts || []).map((p) => (p.thoughtSignature ? { ...p, thoughtSignature: SIGNATURE_PLACEHOLDER } : p)) })) };
}
export const DEFAULTS = {
  model: DEFAULT_MODEL,
  thinking: { default: 'medium', planning: 'high', allowed: ['medium', 'high'] },
  service_tier: 'standard',
  service_tiers: ['standard'],
  fallback_models: [],
  selectable_models: [],
  price_usd_per_million_tokens: { 'gemini-4-hydrogen': { input: 1.5, cached_input: 0.075, output_including_thinking: 7.5 } },
  price_usd_per_million_tokens_priority: {},
  billing_currency: { code: 'USD', symbol: '$', per_usd: 1 },
  limits: { max_requests_per_day: 200, max_cost_per_day: 1, max_tool_rounds_per_question: 6, max_tool_calls_per_question: 12, max_history_turns: 6, max_output_tokens: 8192, timeout_seconds: 45, retries: 3, backoff_seconds: 1, max_total_seconds: 100, cooldown_seconds: 180, duplicate_window_seconds: 5 },
};

// On Windows, `setx GEMINI_API_KEY ...` writes the user's environment; a terminal opened earlier does not
// see it yet, so the relay also reads it from there.
function userEnv(name) {
  if (process.env[name]) return process.env[name];
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(new RegExp(`${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

export function loadConfig(file = CONFIG_FILE, env = userEnv) {
  let f = {};
  try { f = JSON.parse(readFileSync(file, 'utf8')); } catch { /* the defaults below */ }
  const c = { ...DEFAULTS, ...f, thinking: { ...DEFAULTS.thinking, ...f.thinking }, price_usd_per_million_tokens: { ...DEFAULTS.price_usd_per_million_tokens, ...f.price_usd_per_million_tokens }, price_usd_per_million_tokens_priority: { ...DEFAULTS.price_usd_per_million_tokens_priority, ...f.price_usd_per_million_tokens_priority }, billing_currency: { ...DEFAULTS.billing_currency, ...f.billing_currency }, limits: { ...DEFAULTS.limits, ...f.limits } };
  const m = env('GEMINI_MODEL');
  if (m) c.model = m;
  c.thinking.allowed = c.thinking.allowed.map((x) => String(x).toLowerCase());
  c.service_tier = String(c.service_tier || 'standard').toLowerCase();
  c.service_tiers = [...new Set([c.service_tier, ...(c.service_tiers || []).map((x) => String(x).toLowerCase())])];
  c.fallback_models = (c.fallback_models || []).filter((x) => x && x !== c.model);
  c.selectable_models = [...new Set([c.model, ...(c.selectable_models || [])])].filter(Boolean);
  return c;
}
// every model the relay may call: the main one, the fallbacks and the ones the person can choose
export const knownModels = (conf) => [...new Set([conf.model, ...conf.fallback_models, ...(conf.selectable_models || [])])];
// the order to try models in: the person's choice (or, without one, the model the conversation is on), then,
// with automatic fallback, the conversation's model, the main model and the fallbacks
export function modelOrder(conf, { preferred = '', hint = '', fallback = true } = {}) {
  const known = knownModels(conf);
  const first = known.includes(preferred) ? preferred : known.includes(hint) ? hint : conf.model;
  if (!fallback) return [first];
  return [...new Set([first, ...(known.includes(hint) ? [hint] : []), conf.model, ...conf.fallback_models])];
}

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (ms) => { const t = new Date(ms); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

// Today's calls and estimated cost (US dollars, and the billing currency at per_usd), from the usage log.
export function readToday(file, day, perUsd = 1) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { requests: 0, usd: 0, cost: 0 }; }
  let requests = 0, usd = 0;
  for (const line of text.split('\n')) {
    if (!line.includes(`"day":"${day}"`)) continue;
    try { const e = JSON.parse(line); requests++; usd += e.usd || 0; } catch { /* a broken line is skipped */ }
  }
  return { requests, usd: Math.round(usd * 1e6) / 1e6, cost: Math.round(usd * perUsd * 1e6) / 1e6 };
}

// Token counts from Gemini's usageMetadata and the estimated cost at the model's prices for the tier that
// served the request (Priority prices when Google reports Priority). Thinking tokens are billed as output.
export const priceOf = (conf, model, tier = 'standard') => (tier === 'priority' && conf.price_usd_per_million_tokens_priority?.[model]) || conf.price_usd_per_million_tokens[model] || conf.price_usd_per_million_tokens[conf.model] || DEFAULTS.price_usd_per_million_tokens[DEFAULT_MODEL];
export function usageOf(meta, price = DEFAULTS.price_usd_per_million_tokens[DEFAULT_MODEL]) {
  const m = meta || {};
  const prompt = m.promptTokenCount || 0, cached = m.cachedContentTokenCount || 0, tool = m.toolUsePromptTokenCount || 0;
  const output = m.candidatesTokenCount || 0, thinking = m.thoughtsTokenCount || 0;
  const usd = ((prompt - cached + tool) * price.input + cached * price.cached_input + (output + thinking) * price.output_including_thinking) / 1e6;
  return { input: prompt + tool, cached, output, thinking_tokens: thinking, total: m.totalTokenCount || prompt + tool + output + thinking, usd: Math.round(usd * 1e6) / 1e6 };
}

// The relay's rules for a request. A request without generationConfig gets the defaults; one that names a
// thinking level, output cap or service tier must stay within the configuration. Priority needs the
// person's confirmation of its price (priorityConfirmed: the page's X-Atlas-Priority-Confirmed header).
export function shapeRequest(body, conf, { priorityConfirmed = false } = {}) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || !body.contents.length) return { error: 'The request has no conversation.' };
  const asked = [body.serviceTier, body.service_tier].filter((x) => x != null).map((x) => String(x).toLowerCase());
  if (new Set(asked).size > 1) return { error: 'The request names two different service tiers.' };
  const tier = asked[0] || conf.service_tier;
  if (!conf.service_tiers.includes(tier)) return { error: `The ${tier} service tier is not allowed here (allowed: ${conf.service_tiers.join(', ')}).` };
  if (tier === 'priority' && !priorityConfirmed) return { error: 'Priority costs more than Standard: it is used only after you confirm its price in the assistant.', kind: 'priority_unconfirmed' };
  const out = { ...body, serviceTier: tier };
  delete out.service_tier;
  const g = body.generationConfig;
  if (!g) {
    out.generationConfig = { thinkingConfig: { thinkingLevel: conf.thinking.default }, maxOutputTokens: conf.limits.max_output_tokens };
    return { body: out, thinking: conf.thinking.default, tier };
  }
  const level = String(g.thinkingConfig?.thinkingLevel || '').toLowerCase();
  if (!level) return { error: 'The request has no thinking level.' };
  if (!conf.thinking.allowed.includes(level)) return { error: `Thinking level ${level} is not allowed (allowed: ${conf.thinking.allowed.join(', ')}).` };
  if (!(g.maxOutputTokens > 0)) return { error: 'The request has no output token limit.' };
  if (g.maxOutputTokens > conf.limits.max_output_tokens) return { error: `The output limit is ${conf.limits.max_output_tokens} tokens.` };
  return { body: out, thinking: level, tier };
}

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const fail = (res, code, message, kind, extra = {}) => send(res, code, { error: { message, ...(kind ? { kind } : {}), ...extra } });

export function assistantMiddleware({
  fetchImpl = globalThis.fetch, config = () => loadConfig(), key = () => userEnv('GEMINI_API_KEY'), logFile = LOG_FILE,
  base = () => (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const recent = new Map();   // request hash -> when it was sent (duplicate guard)
  const cooling = new Map();  // model -> until when it is skipped (it was overloaded or failing)
  const log = (entry) => { try { mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify(entry) + '\n'); } catch { /* the answer still goes back */ } };
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.endsWith('/api/assistant') && !path.endsWith('/api/assistant/status')) return next();
    const conf = config(), k = key();
    const day = localDay(now());
    const cur = conf.billing_currency, today0 = () => readToday(logFile, day, cur.per_usd);
    if (path.endsWith('/status')) {
      const t0 = now(), cool = Object.fromEntries([...cooling].filter(([, u]) => u > t0).map(([m, u]) => [m, Math.round((u - t0) / 1000)]));
      return send(res, 200, { configured: !!k, model: conf.model, fallback_models: conf.fallback_models, selectable_models: conf.selectable_models, cooling: cool, thinking: conf.thinking, service_tier: conf.service_tier, service_tiers: conf.service_tiers, limits: conf.limits, price_usd_per_million_tokens: conf.price_usd_per_million_tokens, price_usd_per_million_tokens_priority: conf.price_usd_per_million_tokens_priority, billing_currency: cur, today: today0() });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
    let size = 0;
    const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return fail(res, 413, 'The conversation is too long.'); chunks.push(c); }
    if (!k) return fail(res, 503, 'GEMINI_API_KEY is not set on this computer. See Support for how to add it.', 'no_key');
    const raw = Buffer.concat(chunks);
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'The request is not JSON.'); }
    const head = (n) => String(req.headers?.[n] || '');
    const shaped = shapeRequest(parsed, conf, { priorityConfirmed: head('x-atlas-priority-confirmed').toLowerCase() === 'yes' });
    if (shaped.error) return fail(res, 400, shaped.error, shaped.kind);

    // the same request twice in a few seconds (a double click, a loop) is not sent again
    const hash = createHash('sha256').update(raw).digest('hex');
    const t = now();
    for (const [h, at] of recent) if (t - at > conf.limits.duplicate_window_seconds * 1000) recent.delete(h);
    if (recent.has(hash)) return fail(res, 409, `The same request arrived twice within ${conf.limits.duplicate_window_seconds} s; the second one was not sent to Gemini.`, 'duplicate');

    const today = today0();
    if (today.requests >= conf.limits.max_requests_per_day) return fail(res, 429, `Daily limit reached: ${today.requests} Gemini requests today (max_requests_per_day in assistant-config.json).`, 'daily_limit');
    if (today.cost >= conf.limits.max_cost_per_day) return fail(res, 429, `Daily limit reached: about ${cur.symbol}${today.cost.toFixed(4)} (US$${today.usd.toFixed(4)}) spent today; max_cost_per_day is ${cur.symbol}${conf.limits.max_cost_per_day} in assistant-config.json.`, 'daily_limit');
    recent.set(hash, t);

    // which models to try: the person's choice (else the one this conversation is on), then, with automatic
    // fallback, the others; a model that recently failed is tried after the others (unless every model has)
    const hint = head('x-atlas-model'), preferred = knownModels(conf).includes(head('x-atlas-preferred')) ? head('x-atlas-preferred') : '';
    const autoFallback = head('x-atlas-fallback').toLowerCase() !== 'off';
    const order = modelOrder(conf, { preferred, hint, fallback: autoFallback });
    const wanted = order[0];
    // the models that have not failed lately first, then the ones that have (still better than trying one model 4 times)
    const cands = [...order.filter((m) => !(cooling.get(m) > t)), ...order.filter((m) => cooling.get(m) > t)];
    const clean = (s) => String(s || '').split(k).join('[key]');
    const tries = [];
    let r = null, text = '', err = null, used = null, kind = null, google = null, j = null;
    for (let i = 0; i <= conf.limits.retries; i++) {
      const model = cands[i % cands.length];
      const body = JSON.stringify(hint && model !== hint ? withPlaceholderSignatures(shaped.body) : shaped.body);
      err = null; r = null; text = ''; j = null;
      try {
        // an attempt never runs past the time left for the whole question
        const left = conf.limits.max_total_seconds * 1000 - (now() - t);
        if (i > 0 && left < 5000) break;
        r = await fetchImpl(`${base()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, body, signal: AbortSignal.timeout(Math.max(5000, Math.min(conf.limits.timeout_seconds * 1000, left))) });
        text = await r.text();
      } catch (e) { r = null; err = e; }
      try { j = r ? JSON.parse(text) : null; } catch { /* not JSON */ }
      kind = errorKind(r?.status, err);
      tries.push({ model, status: r ? r.status : 0, kind });
      if (kind === 'ok') { used = model; break; }
      google = clean(j?.error?.message || err?.message || '');
      if (COOL_KINDS.has(kind)) cooling.set(model, now() + conf.limits.cooldown_seconds * 1000);
      if (kind === 'not_found') cooling.set(model, now() + 86400e3);
      if (!RETRY_KINDS.has(kind) || i >= conf.limits.retries) break;
      const after = Number(r?.headers?.get?.('retry-after'));
      const wait = kind === 'not_found' ? 0 : after > 0 ? Math.min(after, 10) * 1000 : conf.limits.backoff_seconds * 1000 * 2 ** i;
      if (now() - t + wait > conf.limits.max_total_seconds * 1000) break;
      if (wait) await sleep(wait);
    }
    // a billing error on any model means the whole account: report that, not the last model's error
    const billing = tries.find((x) => x.kind === 'billing');
    if (billing && !used) kind = 'billing';
    const model = used || tries[tries.length - 1].model;
    const tried = tries.map((x) => `${x.model} ${x.status || x.kind}`).join(' > ');
    // the tier Google says it served (a Priority request can be served, and billed, as Standard)
    const tier = String(r?.headers?.get?.('x-gemini-service-tier') || shaped.tier).toLowerCase();
    const entry = {
      time: new Date(t).toISOString(), day, model, preferred_model: wanted, requested_model: conf.model, fallback: model !== wanted, auto_fallback: autoFallback, tried,
      model_version: j?.modelVersion || null, thinking: shaped.thinking,
      tier_requested: shaped.tier, tier, status: used ? r.status : (billing ? 402 : r ? r.status : 0), kind: used ? 'ok' : kind,
      attempts: tries.length, ms: now() - t,
      ...usageOf(used ? j?.usageMetadata : null, priceOf(conf, model, tier)),
      currency: cur.code,
      error: used ? null : google || null,
    };
    entry.cost = Math.round(entry.usd * cur.per_usd * 1e6) / 1e6;
    log(entry);
    if (!used) {
      const code = { billing: 402, rate_limit: 429, overloaded: 503, timeout: 504, network: 502 }[kind] || (r ? r.status : 502);
      return send(res, code, { error: { message: failMessage(kind, entry.status, google, tried, conf), kind, status: entry.status, tried }, atlasUsage: { ...entry, today: today0() } });
    }
    if (!j) return send(res, r.status, text);
    j.atlasUsage = { ...entry, today: today0() };
    return send(res, r.status, j);
  };
}

export function assistantRelay() {
  const mw = assistantMiddleware();
  return {
    name: 'assistant-relay',
    configureServer(server) { server.middlewares.use(mw); },
    configurePreviewServer(server) { server.middlewares.use(mw); },
  };
}
