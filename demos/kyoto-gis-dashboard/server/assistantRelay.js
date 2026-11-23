// The assistant's relay for the dev and preview servers (vite.config.js). The Windows ZIP has the same relay
// in windows/serve.ps1. The browser never sees the Gemini API key: it posts the conversation to
// /api/assistant on this computer, and the relay adds the key from this computer's environment and
// passes the request on to Google's Gemini API. The answer comes back unchanged.
//
//   GEMINI_API_KEY   the key from Google AI Studio (required; never put it in the code or the repository)
//   GEMINI_MODEL     optional, default gemini-4-hydrogen
//   GEMINI_API_BASE  optional, only for tests (a stand-in server)
import { execFileSync } from 'node:child_process';

export const DEFAULT_MODEL = 'gemini-4-hydrogen';
const MAX_BODY = 2 * 1024 * 1024;

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

export function relayConfig() {
  return {
    key: userEnv('GEMINI_API_KEY'),
    model: userEnv('GEMINI_MODEL') || DEFAULT_MODEL,
    base: (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  };
}

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

// config is a function so tests can give their own key, model and stand-in server
export function assistantMiddleware(fetchImpl = globalThis.fetch, config = relayConfig) {
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.endsWith('/api/assistant') && !path.endsWith('/api/assistant/status')) return next();
    const cfg = config();
    if (path.endsWith('/status')) return send(res, 200, { configured: !!cfg.key, model: cfg.model });
    if (req.method !== 'POST') return send(res, 405, { error: { message: 'Use POST.' } });
    let size = 0;
    const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, { error: { message: 'The conversation is too long.' } }); chunks.push(c); }
    if (!cfg.key) return send(res, 503, { error: { message: 'GEMINI_API_KEY is not set on this computer. See Support for how to add it.' } });
    try {
      const r = await fetchImpl(`${cfg.base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key }, body: Buffer.concat(chunks),
      });
      return send(res, r.status, await r.text());
    } catch (e) {
      return send(res, 502, { error: { message: `Could not reach the Gemini API (${e.message || 'network error'}).` } });
    }
  };
}

export function assistantRelay() {
  return {
    name: 'assistant-relay',
    configureServer(server) { server.middlewares.use(assistantMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(assistantMiddleware()); },
  };
}
