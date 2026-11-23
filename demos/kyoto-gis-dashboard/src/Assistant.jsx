// The atlas assistant's chat panel. The conversation goes to Google's Gemini through the relay on this
// computer (lib/assistant.js), and Gemini answers from the project's data with the tools in
// assistantTools.js, some of which operate the dashboard. Every answer carries a small "AI" tag and lists
// what the assistant did (searched, opened a place, changed the trip), so nothing happens unseen.
import { useEffect, useRef, useState } from 'react';
import { askAssistant, assistantStatus, thinkingFor } from './lib/assistant.js';
import { DECLARATIONS, makeHandlers, actionLabel } from './assistantTools.js';
import { tokyoDate } from './lib/trip.js';
import './assistant.css';

const PREVIEW = import.meta.env.VITE_TARGET === 'artifact';
const SUGGEST = [
  'Show me the walking routes from Kiyomizu-dera',
  'Add Fushimi Inari Taisha to Day 1',
  'Which buses go from Kyoto Station to Ginkaku-ji?',
  'What will the weather be in Uji tomorrow?',
];
const SHOW_ACTS = 3;
// tools that change what the dashboard shows: on a phone the chat folds away afterwards so the result is visible
const OPERATE = new Set(['show_place', 'show_map_layer', 'open_trip', 'open_section']);
const isPhone = () => matchMedia('(max-width: 640px)').matches;
const THINK_KEY = 'kyoto-assistant-thinking';
const THINK_MODES = [['auto', 'Auto', 'Medium, or High for multi-day itineraries and route planning'], ['medium', 'Medium', 'Medium thinking for every question'], ['high', 'High', 'High thinking for every question (slower, more output tokens)']];
const n0 = (v) => Math.round(v || 0).toLocaleString('en-US');
const usd = (v) => `≈ $${(v || 0) < 0.01 ? (v || 0).toFixed(4) : (v || 0).toFixed(3)}`;
// what one answer cost: the thinking level, the Gemini calls, the tokens and the estimated price
const usageLine = (u) => (u && u.calls ? `${u.thinking} thinking · ${u.calls} call${u.calls > 1 ? 's' : ''} · ${n0(u.total)} tokens (${n0(u.input)} in, ${n0(u.output)} out, ${n0(u.thinking_tokens)} thinking) · ${usd(u.usd)}` : '');
const plain = (t) => (t || '').replace(/[*`#]/g, '').replace(/\s+/g, ' ').trim();

// a small, safe subset of Markdown: paragraphs, lists, **bold** and `code` (no HTML is ever injected)
function inline(s, key) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b> : <code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function Rich({ text }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw, n) => {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = !!li[1];
      if (!list || list.ordered !== ordered) { list = { ordered, items: [] }; blocks.push(list); }
      list.items.push(li[2]);
      return;
    }
    list = null;
    if (line.trim()) blocks.push({ p: line.replace(/^#+\s*/, '') });
  });
  return blocks.map((b, k) => (b.items
    ? (b.ordered ? <ol key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ol> : <ul key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ul>)
    : <p key={k}>{inline(b.p, k)}</p>));
}

function Actions({ acts }) {
  const [all, setAll] = useState(false);
  if (!acts.length) return null;
  const shown = all ? acts : acts.slice(0, SHOW_ACTS);
  return (
    <ul className="as-acts" aria-label="What the assistant did">
      {shown.map((a, i) => <li key={i} className={a.result?.error ? 'err' : ''}>{actionLabel(a)}</li>)}
      {acts.length > SHOW_ACTS && <li className="more"><button type="button" onClick={() => setAll(!all)}>{all ? 'Less' : `+${acts.length - SHOW_ACTS} more`}</button></li>}
    </ul>
  );
}

// side: 'left' on the map (the information panel the assistant opens is on the right), 'right' over the trip planner
export default function Assistant({ open, onClose, getCtx, side = 'right' }) {
  const [status, setStatus] = useState(PREVIEW ? { reachable: false, preview: true } : null);
  const [msgs, setMsgs] = useState([]);           // { role: 'me' | 'ai', text, actions, error }
  const [live, setLive] = useState(null);         // actions of the answer being prepared
  const [text, setText] = useState('');
  const contents = useRef([]);
  const ctl = useRef(null);
  const body = useRef(null);
  const input = useRef(null);
  const busy = live != null;
  const [min, setMin] = useState(false);           // folded to its header
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem(THINK_KEY) || 'auto'; } catch { return 'auto'; } });
  const setMode = (m) => { setModeState(m); try { localStorage.setItem(THINK_KEY, m); } catch { /* not kept */ } };
  const [off, setOff] = useState(null);           // where it was dragged to: { x, y } from its place
  const root = useRef(null);
  useEffect(() => { setOff(null); }, [side]);
  useEffect(() => { if (open) setMin(false); }, [open]);
  // drag by the header (not on a phone); it stays on screen
  const onGrab = (e) => {
    if (e.button !== 0 || e.target.closest('button') || isPhone()) return;
    const r = root.current.getBoundingClientRect(), o = off || { x: 0, y: 0 }, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev) => {
      const dx = Math.min(innerWidth - 8 - r.right, Math.max(8 - r.left, ev.clientX - x0));
      const dy = Math.min(innerHeight - 8 - r.top - 52, Math.max(8 - r.top, ev.clientY - y0));
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setOff({ x: o.x + dx, y: o.y + dy });
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!moved && min) setMin(false); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };

  const check = () => { if (!PREVIEW) { setStatus(null); assistantStatus().then(setStatus); } };
  useEffect(() => { if (open && !status) check(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && status?.configured) input.current?.focus(); }, [open, status?.configured]);
  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs, live]);
  useEffect(() => () => ctl.current?.abort(), []);

  const send = async (q) => {
    q = (q ?? text).trim();
    if (!q || busy) return;
    setText('');
    setMsgs((m) => [...m, { role: 'me', text: q }]);
    setLive([]);
    const ac = new AbortController();
    ctl.current = ac;
    const ctx = getCtx();
    const acts = [];
    const thinking = thinkingFor(q, mode, status?.thinking);
    const today = (u) => { if (u?.today) setStatus((s) => (s ? { ...s, today: u.today } : s)); };
    try {
      const r = await askAssistant({
        history: contents.current, text: q, note: `Today in Kyoto: ${tokyoDate()}. ${ctx.note()}`, thinking, limits: status?.limits,
        declarations: DECLARATIONS, handlers: makeHandlers(ctx), signal: ac.signal,
        onAction: (a) => { acts.push(a); setLive([...acts]); },
      });
      contents.current = r.contents;
      today(r.usage);
      setMsgs((m) => [...m, { role: 'ai', text: r.text, actions: r.actions, usage: r.usage }]);
      if (isPhone() && r.actions.some((a) => OPERATE.has(a.name) && !a.result?.error)) setMin(true);
    } catch (e) {
      const stopped = e?.name === 'AbortError';
      today(e?.usage);
      setMsgs((m) => [...m, { role: 'ai', text: '', actions: acts, usage: e?.usage, error: stopped ? 'Stopped.' : e.message, retry: stopped ? null : q }]);
    } finally {
      ctl.current = null;
      setLive(null);
    }
  };
  const fresh = () => { ctl.current?.abort(); contents.current = []; setMsgs([]); setText(''); };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  };

  const ready = status?.configured;
  return (
    <section ref={root} className={'as ' + side + (open ? ' on' : '') + (min ? ' min' : '')} role="dialog" aria-label="Atlas assistant" aria-hidden={!open} inert={open ? undefined : ''}
      style={off ? { '--dx': `${off.x}px`, '--dy': `${off.y}px` } : undefined}>
      <header className="as-h" onPointerDown={onGrab}>
        <span className="as-mark" aria-hidden="true">問</span>
        <div className="as-title">
          <h4>Atlas assistant</h4>
          <p>{min ? (busy ? 'Working…' : plain([...msgs].reverse().find((m) => m.role === 'ai')?.text) || 'Tap to open') : status?.model ? `Gemini · ${status.model}${status.service_tier ? ` · ${status.service_tier}` : ''}` : 'Gemini'}</p>
        </div>
        <button type="button" className="as-ic" onClick={() => setMin(!min)} aria-expanded={!min} aria-label={min ? 'Open the chat' : 'Fold the chat'} title={min ? 'Open the chat' : 'Fold the chat'}>
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" style={{ transform: min ? 'rotate(180deg)' : undefined }}><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {msgs.length > 0 && !min && <button type="button" className="as-ic" onClick={fresh} title="New conversation" aria-label="New conversation">
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>}
        <button type="button" className="as-ic" onClick={onClose} aria-label="Close the assistant">
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="as-body" ref={body} aria-live="polite">
        {status == null && <p className="as-note">Checking the assistant’s connection…</p>}
        {status?.preview && (
          <div className="as-setup">
            <h5>Not available in the online preview</h5>
            <p>The assistant talks to Google’s Gemini through the small server that comes with the atlas, which keeps your Gemini API key on your own computer. This online preview has no such server.</p>
            <p>Open the Windows ZIP with <b>Start-Dashboard.bat</b> (or run the dev server) to use it.</p>
          </div>
        )}
        {status && !status.preview && !status.reachable && (
          <div className="as-setup">
            <h5>The assistant’s server did not answer</h5>
            <p>Start the atlas with <b>Start-Dashboard.bat</b> from the Windows ZIP, or with <code>npm run dev</code>. A page opened straight from a file, or from another web server, cannot reach Gemini.</p>
            <button type="button" className="as-btn" onClick={check}>Check again</button>
          </div>
        )}
        {status?.reachable && !status.configured && (
          <div className="as-setup">
            <h5>Connect Gemini</h5>
            <ol>
              <li>Open <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>, choose <b>Get API key</b>, then <b>Create API key</b>.</li>
              <li>Open PowerShell on this computer and run:<code className="as-cmd">setx GEMINI_API_KEY "your key"</code></li>
              <li>Press <b>Check again</b>. If it still says this, close the atlas window and start it again.</li>
            </ol>
            <p className="as-small">The key stays on this computer. The atlas’s server adds it when it passes your question to Google; it is never in the page or the project files. Never paste the key into this chat.</p>
            <button type="button" className="as-btn" onClick={check}>Check again</button>
          </div>
        )}
        {ready && msgs.length === 0 && !busy && (
          <div className="as-hello">
            <p>Ask about places, weather, buses and fares, or have me plan your days. I can also open the right panel on the map for you.</p>
            <div className="as-sugs">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (m.role === 'me'
          ? <div key={i} className="as-msg me"><p>{m.text}</p></div>
          : (
            <div key={i} className="as-msg ai">
              <span className="as-tag" title="Written by Google's Gemini from this atlas's data">AI</span>
              <Actions acts={m.actions || []} />
              {m.text && <div className="as-txt"><Rich text={m.text} /></div>}
              {m.error && <p className="as-err" role="alert">{m.error}{m.retry && <button type="button" onClick={() => send(m.retry)} disabled={busy}>Try again</button>}</p>}
              {usageLine(m.usage) && <p className="as-use" title="Token counts from Gemini; the price is an estimate at the Standard rates in assistant-config.json">{usageLine(m.usage)}</p>}
            </div>
          )))}
        {busy && (
          <div className="as-msg ai live">
            <span className="as-tag">AI</span>
            <Actions acts={live} />
            <span className="as-dots" aria-label="Working"><i /><i /><i /></span>
          </div>
        )}
      </div>

      <form className="as-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={input} rows={1} value={text} disabled={!ready} placeholder={ready ? 'Ask about Kyoto…' : 'The assistant is not connected'} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Your question" />
        {busy
          ? <button type="button" className="as-send stop" onClick={() => ctl.current?.abort()} aria-label="Stop"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" /></svg></button>
          : <button type="submit" className="as-send" disabled={!ready || !text.trim()} aria-label="Send"><svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      </form>
      {ready && (
        <div className="as-meta">
          <div className="as-think" role="radiogroup" aria-label="Thinking level">
            {THINK_MODES.map(([k, l, t]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} title={t} onClick={() => setMode(k)}>{l}</button>)}
          </div>
          {status?.today && <span className="as-today" title={`Daily limits: ${status.limits?.max_requests_per_day} requests, $${status.limits?.max_usd_per_day} (assistant-config.json)`}>Today {status.today.requests} call{status.today.requests === 1 ? '' : 's'} · {usd(status.today.usd)} of ${status.limits?.max_usd_per_day}</span>}
        </div>
      )}
      <p className="as-foot">Answers are AI-generated from this atlas’s data and can be wrong. Check what matters.</p>
    </section>
  );
}
