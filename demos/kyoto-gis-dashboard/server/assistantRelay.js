// The assistant's relay for the dev and preview servers (vite.config.js). The Windows ZIP has the same relay
// in windows/serve.ps1, with the same rules. The browser never sees the Gemini API key: it posts the
// conversation to /api/assistant on this computer, and the relay adds the key from this computer's
// environment and passes the request on to Google's Gemini API.
//
// What the relay enforces (server/assistant-config.json; the ZIP has a copy next to serve.ps1):
//   - the model (gemini-4-hydrogen unless GEMINI_MODEL is set) and the Standard service tier, never Priority
//   - the thinking level: one of the allowed levels (medium by default, high for planning), and an output cap
//   - daily limits on requests and estimated US dollars, and a guard against the same request sent twice
//   - a timeout per request and a few retries when Google is busy or briefly unavailable
//   - a usage log (logs/assistant-usage.jsonl): for each call the token counts (input, cached, output,
//     thinking) and the estimated cost. No question, answer or key is written there.
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
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
export const DEFAULTS = {
  model: DEFAULT_MODEL,
  thinking: { default: 'medium', planning: 'high', allowed: ['medium', 'high'] },
  service_tier: 'standard',
  price_usd_per_million_tokens: { input: 1.5, cached_input: 0.075, output_including_thinking: 7.5 },
  limits: { max_requests_per_day: 200, max_usd_per_day: 1, max_tool_rounds_per_question: 6, max_tool_calls_per_question: 12, max_history_turns: 6, max_output_tokens: 8192, timeout_seconds: 90, retries: 2, duplicate_window_seconds: 5 },
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
  const c = { ...DEFAULTS, ...f, thinking: { ...DEFAULTS.thinking, ...f.thinking }, price_usd_per_million_tokens: { ...DEFAULTS.price_usd_per_million_tokens, ...f.price_usd_per_million_tokens }, limits: { ...DEFAULTS.limits, ...f.limits } };
  const m = env('GEMINI_MODEL');
  if (m) c.model = m;
  c.thinking.allowed = c.thinking.allowed.map((x) => String(x).toLowerCase());
  return c;
}

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (ms) => { const t = new Date(ms); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

// Today's calls and estimated cost, from the usage log.
export function readToday(file, day) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { requests: 0, usd: 0 }; }
  let requests = 0, usd = 0;
  for (const line of text.split('\n')) {
    if (!line.includes(`"day":"${day}"`)) continue;
    try { const e = JSON.parse(line); requests++; usd += e.usd || 0; } catch { /* a broken line is skipped */ }
  }
  return { requests, usd: Math.round(usd * 1e6) / 1e6 };
}

// Token counts from Gemini's usageMetadata and the estimated cost at the configured Standard prices.
// Thinking tokens are billed as output.
export function usageOf(meta, price = DEFAULTS.price_usd_per_million_tokens) {
  const m = meta || {};
  const prompt = m.promptTokenCount || 0, cached = m.cachedContentTokenCount || 0, tool = m.toolUsePromptTokenCount || 0;
  const output = m.candidatesTokenCount || 0, thinking = m.thoughtsTokenCount || 0;
  const usd = ((prompt - cached + tool) * price.input + cached * price.cached_input + (output + thinking) * price.output_including_thinking) / 1e6;
  return { input: prompt + tool, cached, output, thinking_tokens: thinking, total: m.totalTokenCount || prompt + tool + output + thinking, usd: Math.round(usd * 1e6) / 1e6 };
}

// The relay's rules for a request. A request without generationConfig gets the defaults; one that names a
// thinking level, output cap or service tier must stay within the configuration.
export function shapeRequest(body, conf) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || !body.contents.length) return { error: 'The request has no conversation.' };
  for (const tier of [body.serviceTier, body.service_tier]) if (tier != null && String(tier).toLowerCase() !== conf.service_tier) return { error: `Only the ${conf.service_tier} service tier is allowed here (not ${tier}).` };
  const out = { ...body, serviceTier: conf.service_tier };
  delete out.service_tier;
  const g = body.generationConfig;
  if (!g) {
    out.generationConfig = { thinkingConfig: { thinkingLevel: conf.thinking.default }, maxOutputTokens: conf.limits.max_output_tokens };
    return { body: out, thinking: conf.thinking.default };
  }
  const level = String(g.thinkingConfig?.thinkingLevel || '').toLowerCase();
  if (!level) return { error: 'The request has no thinking level.' };
  if (!conf.thinking.allowed.includes(level)) return { error: `Thinking level ${level} is not allowed (allowed: ${conf.thinking.allowed.join(', ')}).` };
  if (!(g.maxOutputTokens > 0)) return { error: 'The request has no output token limit.' };
  if (g.maxOutputTokens > conf.limits.max_output_tokens) return { error: `The output limit is ${conf.limits.max_output_tokens} tokens.` };
  return { body: out, thinking: level };
}

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const fail = (res, code, message) => send(res, code, { error: { message } });

export function assistantMiddleware({
  fetchImpl = globalThis.fetch, config = () => loadConfig(), key = () => userEnv('GEMINI_API_KEY'), logFile = LOG_FILE,
  base = () => (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const recent = new Map();   // request hash -> when it was sent (duplicate guard)
  const log = (entry) => { try { mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify(entry) + '\n'); } catch { /* the answer still goes back */ } };
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.endsWith('/api/assistant') && !path.endsWith('/api/assistant/status')) return next();
    const conf = config(), k = key();
    const day = localDay(now());
    if (path.endsWith('/status')) {
      return send(res, 200, { configured: !!k, model: conf.model, thinking: conf.thinking, service_tier: conf.service_tier, limits: conf.limits, price_usd_per_million_tokens: conf.price_usd_per_million_tokens, today: readToday(logFile, day) });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
    let size = 0;
    const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return fail(res, 413, 'The conversation is too long.'); chunks.push(c); }
    if (!k) return fail(res, 503, 'GEMINI_API_KEY is not set on this computer. See Support for how to add it.');
    const raw = Buffer.concat(chunks);
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'The request is not JSON.'); }
    const shaped = shapeRequest(parsed, conf);
    if (shaped.error) return fail(res, 400, shaped.error);

    // the same request twice in a few seconds (a double click, a loop) is not sent again
    const hash = createHash('sha256').update(raw).digest('hex');
    const t = now();
    for (const [h, at] of recent) if (t - at > conf.limits.duplicate_window_seconds * 1000) recent.delete(h);
    if (recent.has(hash)) return fail(res, 409, `The same request arrived twice within ${conf.limits.duplicate_window_seconds} s; the second one was not sent to Gemini.`);

    const today = readToday(logFile, day);
    if (today.requests >= conf.limits.max_requests_per_day) return fail(res, 429, `Daily limit reached: ${today.requests} Gemini requests today (max_requests_per_day in assistant-config.json).`);
    if (today.usd >= conf.limits.max_usd_per_day) return fail(res, 429, `Daily limit reached: about $${today.usd.toFixed(4)} spent today (max_usd_per_day is $${conf.limits.max_usd_per_day} in assistant-config.json).`);
    recent.set(hash, t);

    const url = `${base()}/v1beta/models/${encodeURIComponent(conf.model)}:generateContent`;
    const body = JSON.stringify(shaped.body);
    const clean = (s) => String(s || '').split(k).join('[key]');
    let attempts = 0, r = null, text = '', err = null;
    while (true) {
      attempts++;
      err = null;
      try {
        r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, body, signal: AbortSignal.timeout(conf.limits.timeout_seconds * 1000) });
        text = await r.text();
      } catch (e) { r = null; err = e; }
      const retry = err || RETRY_STATUS.has(r.status);
      if (!retry || attempts > conf.limits.retries) break;
      const after = Number(r?.headers?.get?.('retry-after'));
      await sleep(after > 0 ? Math.min(after, 10) * 1000 : 1500 * attempts);
    }
    let j = null;
    try { j = r ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const entry = {
      time: new Date(t).toISOString(), day, model: conf.model, model_version: j?.modelVersion || null, thinking: shaped.thinking,
      tier: r?.headers?.get?.('x-gemini-service-tier') || conf.service_tier, status: r ? r.status : 0, attempts, ms: now() - t,
      ...usageOf(j?.usageMetadata, conf.price_usd_per_million_tokens),
      error: err ? clean(timedOut ? `Gemini did not answer within ${conf.limits.timeout_seconds} s.` : err.message) : (r.ok ? null : clean(j?.error?.message || `HTTP ${r.status}`)),
    };
    log(entry);
    if (!r) return fail(res, timedOut ? 504 : 502, timedOut ? `${entry.error} Tried ${attempts} times.` : `Could not reach the Gemini API (${entry.error}). Tried ${attempts} times.`);
    if (!j) return send(res, r.status, text);
    j.atlasUsage = { ...entry, today: readToday(logFile, day) };
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
