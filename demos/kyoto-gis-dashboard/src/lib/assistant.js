// The atlas assistant: a conversation with Google's Gemini (default model gemini-4-hydrogen) through the
// relay on this computer (/api/assistant: server/assistantRelay.js, windows/serve.ps1), which holds the
// API key. Gemini answers in text or asks for one of the tools in assistantTools.js; the tool runs here,
// in the page, on the project's own data or by operating the dashboard, and its result goes back to
// Gemini. The loop stops when Gemini answers in text, or after MAX_STEPS tool rounds.
// Nothing here holds a key, and nothing is sent anywhere but the relay.

export const MAX_STEPS = 8;
const url = (p) => `${import.meta.env?.BASE_URL ?? './'}api/assistant${p}`;

export const SYSTEM = `You are the assistant inside "Kyoto Prefecture Travel Atlas", a university GIS dashboard of Kyoto Prefecture (26 municipalities, 626 attraction records, 5,479 transit stops, Kyoto City bus routes, walking routes, weather, and a trip planner).
Rules:
- Answer only from what the tools return. If the data has no answer (opening hours, ticket prices, timetables, crowds, reviews), say plainly that the atlas does not have it. Never guess or invent names, numbers, times or prices.
- Bus legs have stop order and official fares but no timetable, so never state a bus ride time.
- When the user wants to see something, operate the dashboard with the tools (show_place, show_map_layer, open_trip and so on) instead of only describing it.
- When the user asks to change the trip, change it with the trip tools, then say briefly what changed.
- Find a place's id with search_places before using it. If several places match, pick the clearest match or ask.
- Reply in the language the user writes in. Keep replies short: a few sentences or a short list.`;

export async function assistantStatus(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(url('/status'));
    if (!r.ok) return { reachable: false };
    return { reachable: true, ...(await r.json()) };
  } catch { return { reachable: false }; }
}

const errText = (j, status) => j?.error?.message || `The assistant relay answered HTTP ${status}.`;

// history: Gemini contents so far. note: what the dashboard shows right now and today's date, sent with the
// question so "this place" or "tomorrow" can be understood. Returns { text, contents, actions }.
// onAction({ name, args, result }) is called after each tool runs, so the chat can show it at once.
export async function askAssistant({ history = [], text, note, declarations, handlers, onAction, signal, fetchImpl = fetch }) {
  const contents = [...history, { role: 'user', parts: [{ text }, ...(note ? [{ text: `(Context, not from the user: ${note})` }] : [])] }];
  const actions = [];
  for (let step = 0; step <= MAX_STEPS; step++) {
    const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: declarations }] };
    let r;
    try {
      r = await fetchImpl(url(''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new Error('The assistant relay on this computer could not be reached.');
    }
    let j = null;
    try { j = await r.json(); } catch { /* handled below */ }
    if (!r.ok) throw new Error(errText(j, r.status));
    const cand = j?.candidates?.[0];
    if (!cand?.content) {
      const why = j?.promptFeedback?.blockReason || cand?.finishReason;
      throw new Error(why ? `Gemini gave no answer (${why}).` : 'Gemini gave no answer.');
    }
    contents.push(cand.content);   // unchanged, so thought signatures go back with the calls
    const parts = cand.content.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length || step === MAX_STEPS) {
      const out = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
      return { text: out || (calls.length ? 'I stopped after too many steps. Please ask again more simply.' : '(no text in the answer)'), contents, actions };
    }
    const replies = [];
    for (const { functionCall: fc } of calls) {
      let result;
      const h = handlers[fc.name];
      try { result = h ? await h(fc.args || {}) : { error: `Unknown tool ${fc.name}` }; } catch (e) { result = { error: String(e?.message || e) }; }
      const act = { name: fc.name, args: fc.args || {}, result };
      actions.push(act);
      onAction?.(act);
      replies.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { result } } });
    }
    contents.push({ role: 'user', parts: replies });
  }
  return { text: '', contents, actions };
}
