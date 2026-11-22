// Plan your trip: the visitor's own plan, kept in this browser only (localStorage), plus the pure logic
// the trip dashboard needs: the day's timeline, bus options between two places, the best order of the
// day's stops and an .ics calendar file.
//
// Data rules (README 1.1): nothing here invents a value.
// - Walking, cycling and driving legs come from the routing service (lib/route.js); a leg that has not
//   been routed has no duration.
// - Bus legs come from the bus data in this project: the route variants' stop order (from OpenStreetMap)
//   and the official fare. There is no timetable, so the ride itself has no duration; the times after a
//   bus ride are only known when the visitor sets an arrival time.
// - Stay lengths and arrival times are the visitor's own planning values.
// - The search radius for bus stops near a place is a straight-line search radius only; the walk to the
//   stop is routed by the service, never drawn or timed as a straight line.

export const TRIP_KEY = 'kyoto-gis-trip-v1';
export const MAX_DAYS = 7;
export const DEFAULT_STAY = 60;          // minutes; the visitor's estimate, shown as such and editable
export const BUS_RADIUS_M = 500;         // straight-line radius used only to find candidate stops
export const LEG_MODES = [
  { key: 'foot', label: 'Walk' },
  { key: 'bus', label: 'Bus' },
  { key: 'bike', label: 'Cycle' },
  { key: 'car', label: 'Drive' },
];

// ---- dates and times (Asia/Tokyo; Japan has no daylight saving, so JST is always UTC+9) ----
export const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};
export const fmtHM = (min) => (min == null ? '' : `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}${min >= 1440 ? ' +1d' : ''}`);   // past midnight: next day
export const tokyoDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dayLabel = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));
export const dateLong = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));

// ---- the plan ----
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newDay = (date) => ({ id: uid('d'), date, start: '09:00', end: '18:00', from: null, stops: [] });
export function emptyTrip(today = tokyoDate(), days = 3) {
  const first = addDays(today, 1);
  return { v: 1, title: 'Kyoto', days: Array.from({ length: days }, (_, i) => newDay(addDays(first, i))), hintSeen: false };
}
const okDay = (d) => d && typeof d.date === 'string' && Array.isArray(d.stops);
export function loadTrip(storage = globalThis.localStorage, today) {
  try {
    const t = JSON.parse(storage?.getItem(TRIP_KEY) || 'null');
    if (t && t.v === 1 && Array.isArray(t.days) && t.days.length && t.days.every(okDay)) return t;
  } catch { /* unreadable: start a new plan */ }
  return emptyTrip(today);
}
export function saveTrip(trip, storage = globalThis.localStorage) {
  try { storage?.setItem(TRIP_KEY, JSON.stringify(trip)); return true; } catch { return false; }
}
const mapDay = (trip, di, f) => ({ ...trip, days: trip.days.map((d, i) => (i === di ? f(d) : d)) });
export const planned = (trip) => trip.days.some((d) => d.stops.length > 0);
export function addDay(trip) {
  if (trip.days.length >= MAX_DAYS) return trip;
  const last = trip.days[trip.days.length - 1];
  return { ...trip, days: [...trip.days, newDay(addDays(last.date, 1))] };
}
export function removeDay(trip, di) {
  if (trip.days.length <= 1) return trip;
  const days = trip.days.filter((_, i) => i !== di);
  // dates stay consecutive from the first day
  return { ...trip, days: days.map((d, i) => ({ ...d, date: addDays(days[0].date, i) })) };
}
export const setStartDate = (trip, iso) => ({ ...trip, days: trip.days.map((d, i) => ({ ...d, date: addDays(iso, i) })) });
export const setHours = (trip, di, start, end) => mapDay(trip, di, (d) => ({ ...d, start: parseHM(start) != null ? start : d.start, end: parseHM(end) != null ? end : d.end }));
export const setFrom = (trip, di, id) => mapDay(trip, di, (d) => ({ ...d, from: id || null }));
export function addStop(trip, di, id, { mode = 'foot' } = {}) {
  return mapDay(trip, di, (d) => (d.stops.some((s) => s.id === id) ? d : { ...d, stops: [...d.stops, { id, stay: DEFAULT_STAY, at: null, mode, bus: null }] }));
}
export const removeStop = (trip, di, si) => mapDay(trip, di, (d) => ({ ...d, stops: d.stops.filter((_, i) => i !== si) }));
export const patchStop = (trip, di, si, patch) => mapDay(trip, di, (d) => ({ ...d, stops: d.stops.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
// a stop moved within the day keeps its own settings, but the bus picked for the leg into it no longer
// fits once the place before it changes, so that choice is cleared (the mode stays)
export function moveStop(trip, di, from, to) {
  return mapDay(trip, di, (d) => {
    const st = [...d.stops];
    const [s] = st.splice(from, 1);
    st.splice(to, 0, s);
    return { ...d, stops: st.map((x, i) => (i === to || i === to + 1 || i === from || i === from + 1 ? { ...x, bus: null } : x)) };
  });
}
export function moveStopToDay(trip, di, si, dj) {
  if (di === dj) return trip;
  const s = trip.days[di].stops[si];
  if (!s) return trip;
  let t = removeStop(trip, di, si);
  if (t.days[dj].stops.some((x) => x.id === s.id)) return t;
  t = mapDay(t, dj, (d) => ({ ...d, stops: [...d.stops, { ...s, bus: null, at: null }] }));
  return t;
}

// The points a day visits in order: its start place (if any) then its stops. Leg i goes to point i.
export const dayPoints = (day) => [...(day.from ? [{ id: day.from, start: true }] : []), ...day.stops];

// ---- timeline ----
// legs[i] = { duration_s } for the leg into point i (i >= 1), or null / { duration_s: null } when unknown.
// Returns per point { arrive, leave, known, late, wait } in minutes from midnight, plus the end and overrun.
export function timeline(day, legs = []) {
  const pts = dayPoints(day);
  const start = parseHM(day.start) ?? 540, end = parseHM(day.end);
  const out = [];
  let t = start;   // null when the clock is lost (an unknown leg with no arrival time set after it)
  pts.forEach((p, i) => {
    const fixed = parseHM(p.at);
    let reach = i === 0 ? start : (t == null || legs[i]?.duration_s == null ? null : t + legs[i].duration_s / 60);
    let arrive = reach, late = false, wait = 0;
    if (fixed != null) {
      if (reach != null && reach > fixed + 0.5) late = true;
      else if (reach != null) wait = fixed - reach;
      arrive = fixed;
    }
    const stay = p.start ? 0 : (Number.isFinite(p.stay) ? p.stay : DEFAULT_STAY);
    const leave = arrive == null ? null : Math.max(arrive, reach ?? arrive) + stay;
    out.push({ arrive: arrive == null ? null : Math.round(arrive), leave: leave == null ? null : Math.round(leave), known: arrive != null, late, wait: Math.round(wait), reach: reach == null ? null : Math.round(reach) });
    t = leave;
  });
  const last = out[out.length - 1];
  const finish = last ? last.leave : null;
  return { points: out, finish, overrun: finish != null && end != null && finish > end ? finish - end : 0, end };
}

// ---- bus options between two places ----
const R = 6371008.8, rad = Math.PI / 180;
export function distM(a, b) {   // great-circle metres; used only for the stop search radius
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// stops (bus index keys) with a mapped point within the radius of a place, nearest first
export function stopsNear(index, pointXY, at, radius = BUS_RADIUS_M) {
  const out = [];
  for (const [key, s] of Object.entries(index?.stops || {})) {
    let best = Infinity;
    for (const pid of s.points || []) { const xy = pointXY(pid); if (xy) best = Math.min(best, distM(at, xy)); }
    if (best <= radius) out.push({ key, d: best });
  }
  return out.sort((a, b) => a.d - b.d);
}
// Routes that call at a stop near A and, later on the same variant, at a stop near B.
// One option per route number and direction: fewest stops, then the nearest stops.
// The search widens step by step (BUS_RADII) at each end until it finds stops; the radius used is reported.
export const BUS_RADII = [BUS_RADIUS_M, 800, 1000];
const nearWidening = (index, pointXY, at, radii) => {
  for (const r of radii) { const s = stopsNear(index, pointXY, at, r); if (s.length) return { stops: s, radius: r }; }
  return { stops: [], radius: radii[radii.length - 1] };
};
export function busOptions(index, pointXY, a, b, { radii = BUS_RADII, limit = 6 } = {}) {
  const A = nearWidening(index, pointXY, a, radii), B = nearWidening(index, pointXY, b, radii);
  const nearA = new Map(A.stops.map((s) => [s.key, s.d])), nearB = new Map(B.stops.map((s) => [s.key, s.d]));
  const meta = { nearA: nearA.size, nearB: nearB.size, radiusA: A.radius, radiusB: B.radius };
  if (!nearA.size || !nearB.size) return { options: [], ...meta };
  const opts = [];
  for (const route of index.routes || []) {
    for (const v of route.variants || []) {
      const ord = v.order || [];
      let best = null;
      for (let i = 0; i < ord.length; i++) {
        if (!nearA.has(ord[i])) continue;
        for (let j = i + 1; j < ord.length; j++) {
          if (!nearB.has(ord[j]) || ord[j] === ord[i]) continue;
          const c = { stops: j - i, walk: nearA.get(ord[i]) + nearB.get(ord[j]), i, j };
          if (!best || c.stops < best.stops || (c.stops === best.stops && c.walk < best.walk)) best = c;
          break;   // the first later call at a stop near B is the one to get off at
        }
      }
      if (best) {
        const board = ord[best.i], alight = ord[best.j];
        opts.push({ route: route.key, number: route.number, variant: v.id, board, alight, boardSeq: best.i, alightSeq: best.j, stops: best.stops,
          boardName: index.stops[board]?.en || index.stops[board]?.ja, alightName: index.stops[alight]?.en || index.stops[alight]?.ja,
          boardJa: index.stops[board]?.ja, alightJa: index.stops[alight]?.ja, fare: route.fare || null, orderChecked: !!v.official_order_checked, walkSearch: best.walk });
      }
    }
  }
  // the same route number in the same direction can appear on two variants: keep the better one
  const seen = new Map();
  for (const o of opts.sort((x, y) => x.stops - y.stops || x.walkSearch - y.walkSearch)) {
    const k = `${o.number}|${o.board}|${o.alight}`;
    if (!seen.has(k)) seen.set(k, o);
  }
  return { options: [...seen.values()].slice(0, limit), ...meta };
}
// The ridden part of a variant's line: from the vertex nearest the boarding stop to the one nearest the
// alighting stop (the variant's own stop positions), in travel order.
export function rideLine(variant, boardSeq, alightSeq) {
  const L = variant?.line || [], S = variant?.stops || [];
  const a = S[boardSeq]?.xy, b = S[alightSeq]?.xy;
  if (!a || !b || L.length < 2) return null;
  const near = (p, from = 0) => { let bi = from, bd = Infinity; for (let i = from; i < L.length; i++) { const d = (L[i][0] - p[0]) ** 2 + (L[i][1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const ia = near(a), ib = near(b, ia);
  return ib > ia ? { coords: L.slice(ia, ib + 1), from: a, to: b } : null;
}

// ---- best order of a day's stops ----
// m[i][j] = travel seconds from point i to point j (routing service table). Point 0 stays first.
// Exact for up to 8 points; beyond that, nearest neighbour then 2-opt.
export const orderCost = (m, ord) => ord.reduce((s, x, k) => (k ? s + m[ord[k - 1]][x] : 0), 0);
export function bestOrder(m) {
  const n = m.length;
  if (n <= 2) return [...Array(n).keys()];
  const rest = [...Array(n).keys()].slice(1);
  if (n <= 8) {
    let best = null, bestC = Infinity;
    const perm = (arr, l) => {
      if (l === arr.length) { const o = [0, ...arr]; const c = orderCost(m, o); if (c < bestC) { bestC = c; best = o; } return; }
      for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; perm(arr, l + 1); [arr[l], arr[i]] = [arr[i], arr[l]]; }
    };
    perm(rest, 0);
    return best;
  }
  const ord = [0], left = new Set(rest);
  while (left.size) { const last = ord[ord.length - 1]; let bi = null; for (const j of left) if (bi == null || m[last][j] < m[last][bi]) bi = j; ord.push(bi); left.delete(bi); }
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 1; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
      const o = [...ord.slice(0, i), ...ord.slice(i, k + 1).reverse(), ...ord.slice(k + 1)];
      if (orderCost(m, o) + 1e-6 < orderCost(m, ord)) { ord.splice(0, n, ...o); improved = true; }
    }
  }
  return ord;
}

// ---- hero: which place the trip dashboard shows ----
// The next stop: on the trip's own day, the first stop not yet left (Asia/Tokyo clock); otherwise the
// first stop of the chosen day.
export function nextStopIndex(day, tl, today = tokyoDate(), nowMin = null) {
  if (!day.stops.length) return -1;
  const off = day.from ? 1 : 0;
  if (day.date === today && nowMin != null) {
    for (let i = 0; i < day.stops.length; i++) { const p = tl?.points?.[i + off]; if (!p || p.leave == null || p.leave > nowMin) return i; }
    return day.stops.length - 1;
  }
  return 0;
}
// A Commons file at a chosen width, through Special:FilePath (same file, same licence as the local copy).
export const commonsUrl = (file, width = 1920) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file || '').replace(/^File:/, '').replace(/ /g, '_'))}?width=${width}`;

// ---- calendar file ----
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = (iso, min) => {   // JST wall time -> UTC basic format
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + Math.round(min) - 9 * 60);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};
// lines longer than 75 octets are folded (RFC 5545); counted in UTF-8 bytes so Japanese names fold correctly
const enc = new TextEncoder();
const fold = (line) => {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
};
// days: [{ day, tl, names: [name per point], legText: [text per point] }]
export function toICS(trip, days, { stamp = new Date() } = {}) {
  const now = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kyoto Prefecture Tourism GIS//Plan your trip//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(trip.title || 'Kyoto trip')}`];
  days.forEach(({ day, tl, names, legText }, di) => {
    const pts = dayPoints(day);
    if (!pts.length) return;
    const lines = pts.map((p, i) => `${tl.points[i]?.arrive != null ? fmtHM(tl.points[i].arrive) + ' ' : ''}${names[i]}${legText[i] ? ` (${legText[i]})` : ''}`);
    L.push('BEGIN:VEVENT', `UID:${day.id}-day@kyoto-gis`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${day.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(day.date, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsEsc(`Day ${di + 1}: ${names.filter((_, i) => !pts[i].start).join(' → ')}`)}`, `DESCRIPTION:${icsEsc(`Plan ${day.start}–${day.end}\n${lines.join('\n')}\nBus rides have no timetable here: check times locally.`)}`, 'END:VEVENT');
    pts.forEach((p, i) => {
      const t = tl.points[i];
      if (p.start || t?.arrive == null) return;
      L.push('BEGIN:VEVENT', `UID:${day.id}-${i}@kyoto-gis`, `DTSTAMP:${now}`, `DTSTART:${icsUtc(day.date, t.arrive)}`, `DTEND:${icsUtc(day.date, t.leave ?? t.arrive)}`,
        `SUMMARY:${icsEsc(names[i])}`, ...(legText[i] ? [`DESCRIPTION:${icsEsc(`Getting there: ${legText[i]}`)}`] : []), 'END:VEVENT');
    });
  });
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
