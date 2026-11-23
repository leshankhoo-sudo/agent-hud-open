// The atlas assistant: a conversation with Google's Gemini (gemini-4-hydrogen by default) through the
// relay on this computer (/api/assistant: server/assistantRelay.js, windows/serve.ps1), which holds the
// API key and enforces the limits in assistant-config.json. Gemini answers in text or asks for one of the
// tools in assistantTools.js; the tool runs here, in the page, on the project's own data or by operating the
// dashboard, and its result goes back to Gemini.
// Cost and loop safety on this side: the thinking level is chosen per question (medium, or high for
// multi-day itineraries and route planning), older turns are dropped from the history, a tool call repeated
// with the same arguments is answered from the first result instead of running again, a round of nothing
// but repeats ends the answer, and the rounds and calls per question are capped.
// Nothing here holds a key, and nothing is sent anywhere but the relay.

export const MAX_STEPS = 6;
export const DEFAULT_LIMITS = { max_tool_rounds_per_question: MAX_STEPS, max_tool_calls_per_question: 12, max_history_turns: 6, max_output_tokens: 8192 };
const url = (p) => `${import.meta.env?.BASE_URL ?? './'}api/assistant${p}`;

export const SYSTEM = `You are the assistant inside "Kyoto Prefecture Travel Atlas", a university GIS dashboard of Kyoto Prefecture (26 municipalities, 626 attraction records, 5,479 transit stops, Kyoto City bus routes, walking routes, weather, and a trip planner).
Rules:
- Answer only from what the tools return. If the data has no answer (opening hours, ticket prices, timetables, crowds, reviews), say plainly that the atlas does not have it. Never guess or invent names, numbers, times or prices.
- Bus legs have stop order and official fares but no timetable, so never state a bus ride time.
- When the user wants to see something, operate the dashboard with the tools (show_place, show_map_layer, open_trip and so on) instead of only describing it.
- When the user asks to change the trip, change it with the trip tools, then say briefly what changed.
- Find a place's id with search_places before using it. If several places match, pick the clearest match or ask.
- Use as few tool calls as you need, and never repeat a call with the same arguments.
- Reply in the language the user writes in. Keep replies short: a few sentences or a short list.`;

// Multi-day itineraries and route planning get the higher thinking level; everything else the default.
const PLANNING = /\b(itinerar(y|ies)|(\d+|two|three|four|five|six|seven|several|multi)[- ]?days?|plan (my|a|the|our) (trip|route|days?|itinerary)|route plan|best (route|order)|optimi[sz]e)\b|行程|日程|几天|幾天|多日|路线规划|路線規劃|规划路线|安排.*天|[二两三四五六七2-7]天|旅程|ルート|プラン/i;
export const isPlanning = (text) => PLANNING.test(text || '');
export function thinkingFor(text, mode, thinking = { default: 'medium', planning: 'high', allowed: ['medium', 'high'] }) {
  if (mode && mode !== 'auto' && thinking.allowed.includes(mode)) return mode;
  return isPlanning(text) ? thinking.planning : thinking.default;
}

export async function assistantStatus(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(url('/status'));
    if (!r.ok) return { reachable: false };
    return { reachable: true, ...(await r.json()) };
  } catch { return { reachable: false }; }
}

// Keep the last `turns` questions and everything after them. A cut never falls between a tool call and its
// result: it always starts at a question the user typed.
export function trimHistory(contents, turns) {
  const starts = contents.map((c, i) => (c.role === 'user' && c.parts?.some((p) => typeof p.text === 'string') ? i : -1)).filter((i) => i >= 0);
  return starts.length > turns ? contents.slice(starts[starts.length - turns]) : contents;
}

const errText = (j, status) => j?.error?.message || `The assistant relay answered HTTP ${status}.`;
const addUsage = (u, a) => {
  if (!a) return u;
  return { ...u, calls: u.calls + 1, input: u.input + (a.input || 0), output: u.output + (a.output || 0), thinking_tokens: u.thinking_tokens + (a.thinking_tokens || 0), total: u.total + (a.total || 0), usd: u.usd + (a.usd || 0), today: a.today || u.today, model: a.model_version || a.model || u.model, tier: a.tier || u.tier };
};
const NO_USAGE = { calls: 0, input: 0, output: 0, thinking_tokens: 0, total: 0, usd: 0, today: null, model: null, tier: null };

// history: Gemini contents so far. note: what the dashboard shows right now and today's date, sent with the
// question so "this place" or "tomorrow" can be understood. thinking: 'medium' | 'high'.
// Returns { text, contents, actions, usage }. onAction({ name, args, result, repeat }) is called after each
// tool, so the chat can show it at once.
export async function askAssistant({ history = [], text, note, thinking = 'medium', limits = DEFAULT_LIMITS, declarations, handlers, onAction, signal, fetchImpl = fetch }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const contents = [...trimHistory(history, Math.max(0, L.max_history_turns - 1)), { role: 'user', parts: [{ text }, ...(note ? [{ text: `(Context, not from the user: ${note})` }] : [])] }];
  const actions = [];
  const done = new Map();   // name + arguments -> result, for repeated calls
  let usage = { ...NO_USAGE, thinking };
  const finish = (t) => ({ text: t, contents, actions, usage });
  // a stop in the middle of tool calls: the history keeps the question and this short answer, and none of the
  // unanswered calls (the next question would otherwise be refused)
  const start = contents.length;
  const stop = (t) => { contents.splice(start); contents.push({ role: 'model', parts: [{ text: t }] }); return finish(t); };
  for (let step = 0; ; step++) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: declarations }],
      generationConfig: { thinkingConfig: { thinkingLevel: thinking }, maxOutputTokens: L.max_output_tokens }, serviceTier: 'standard',
    };
    let r;
    try {
      r = await fetchImpl(url(''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw Object.assign(new Error('The assistant relay on this computer could not be reached.'), { usage });
    }
    let j = null;
    try { j = await r.json(); } catch { /* handled below */ }
    usage = addUsage(usage, j?.atlasUsage);
    if (!r.ok) throw Object.assign(new Error(errText(j, r.status)), { usage, status: r.status });
    const cand = j?.candidates?.[0];
    if (!cand?.content) {
      const why = j?.promptFeedback?.blockReason || cand?.finishReason;
      throw Object.assign(new Error(why ? `Gemini gave no answer (${why}).` : 'Gemini gave no answer.'), { usage });
    }
    contents.push(cand.content);   // unchanged, so thought signatures go back with the calls
    const parts = cand.content.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    const said = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (!calls.length) return finish(said || '(no text in the answer)');
    if (step >= L.max_tool_rounds_per_question) return stop(said || `I stopped after ${L.max_tool_rounds_per_question} rounds of steps for one question. Please ask again more simply.`);
    if (actions.filter((a) => !a.repeat).length + calls.length > L.max_tool_calls_per_question) return stop(said || `I stopped: this question would need more than ${L.max_tool_calls_per_question} steps. Please split it into smaller questions.`);
    const replies = [];
    let fresh = 0;
    for (const { functionCall: fc } of calls) {
      const args = fc.args || {}, k = `${fc.name}|${JSON.stringify(args)}`;
      let result, repeat = false;
      if (done.has(k)) { repeat = true; result = { note: 'Already done earlier in this answer; the same result again.', ...done.get(k) }; }
      else {
        fresh++;
        const h = handlers[fc.name];
        try { result = h ? await h(args) : { error: `Unknown tool ${fc.name}` }; } catch (e) { result = { error: String(e?.message || e) }; }
        done.set(k, result);
      }
      const act = { name: fc.name, args, result, repeat };
      actions.push(act);
      onAction?.(act);
      replies.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { result } } });
    }
    if (!fresh) return stop(said || 'I stopped because I was repeating the same steps. Please ask again in other words.');
    contents.push({ role: 'user', parts: replies });
  }
}
