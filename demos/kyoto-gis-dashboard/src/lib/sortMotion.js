// Timing and geometry for the "Sort the data" view (SortStage.jsx), kept free of the DOM so it can be tested.
//
// The sphere layout (golden-angle spiral, depth -> size and opacity) and the three-point arc flight are
// adapted from "Claude photo sorter" by Divy Kairoth (MIT, github.com/kairothq/claude-photo-sorter,
// dashboard/app.js: buildSphere, drawSphere, release). Everything else here is written for this project.
//
// The story follows public/data/sort_story.json, record by record:
//   all records float as one sphere -> duplicates fly into the record they repeat, then to "Merged"
//   -> records that are not places to visit fly to "Left out" -> every record on the map flies to its category.

export const DURATION = 15000;            // ms for the whole sort at speed 1
// Phase marks as fractions of the duration (15 s: slots 0-1.4 s, merges 1.4-3 s, left out 3-4.6 s, sort 4.6-12.8 s)
export const PHASES = { slots: 0, merge: 0.093, leftOut: 0.2, sort: 0.307, sortEnd: 0.853 };
export const FLIGHT = { min: 650, spread: 400, peak: 0.45 };   // ms, as in the original

export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// cubic-bezier(x1, y1, x2, y2) as a function of x in [0, 1] (Newton steps, then bisection)
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-5) return sy(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 24; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
export const flightEase = bezier(0.55, 0, 0.25, 1);

// n points spread evenly over the unit sphere (golden-angle spiral)
export function goldenSphere(n) {
  const golden = Math.PI * (3 - Math.sqrt(5)), out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    out.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return out;
}

// Rotate a unit point by yaw (about y) then tilt (about x); depth is 0 at the back, 1 at the front.
export function project(p, yaw, tilt) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(tilt), sb = Math.sin(tilt);
  const x = p.x * ca + p.z * sa; let z = -p.x * sa + p.z * ca;
  const y = p.y * cb - z * sb; z = p.y * sb + z * cb;
  const depth = (z + 1) / 2;
  return { x, y, depth, scale: 0.45 + depth * 0.75, alpha: 0.2 + depth * 0.8 };
}

// Seeded random numbers, so a replay can be the same or new as wanted and tests are repeatable.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Release times at a steady rate: the rate ramps up over the first 15 % of the sort phase, stays level, and
// ramps down over the last 15 % (a trapezoid). Returns the time (0-1) by which fraction q of the records have left.
// (An ease-in-out over the whole phase made the middle twice as dense as the average, which read as a sudden pour.)
export function steadyTime(q, a = 0.15) {
  const y = Math.min(1, Math.max(0, q)) * (1 - a);
  if (y < a / 2) return Math.sqrt(2 * a * y);
  if (y <= 1 - 1.5 * a) return y + a / 2;
  return 1 - Math.sqrt(Math.max(0, 2 * a * (1 - a - y)));
}

// When each record leaves the sphere. rows: sort_story.json rows [id, category, cell, status, source].
export function buildPlan(rows, duration = DURATION, rand = Math.random) {
  const at = (f) => f * duration;
  const merged = rows.filter((r) => r[3] === 'merged').map((r) => r[0]);
  const out = rows.filter((r) => r[3] === 'left_out').map((r) => r[0]);
  const onMap = shuffle(rows.filter((r) => r[3] === 'map').map((r) => r[0]), rand);
  const span = (a, b, n, i) => at(a) + (n > 1 ? (i / (n - 1)) * (at(b) - at(a)) * 0.82 : 0);
  const events = [
    ...merged.map((id, i) => ({ id, kind: 'merge', t: span(PHASES.merge, PHASES.leftOut, merged.length, i) })),
    ...out.map((id, i) => ({ id, kind: 'leftOut', t: span(PHASES.leftOut, PHASES.sort, out.length, i) })),
    ...onMap.map((id, i) => ({ id, kind: 'sort', t: at(PHASES.sort) + steadyTime(onMap.length > 1 ? i / (onMap.length - 1) : 1) * (at(PHASES.sortEnd) - at(PHASES.sort)) })),
  ];
  events.sort((a, b) => a.t - b.t);
  return { events, merged, leftOut: out, onMap, duration };
}

// Flight duration: as the original (650-1050 ms), shortened only when the whole sort runs faster than 15 s.
export const flightMs = (rand, duration = DURATION) => (FLIGHT.min + rand() * FLIGHT.spread) * Math.min(1, duration / DURATION * 1.2);

// Arc control point: half way, pushed up and sideways at random (original: +-60 px sideways, 60-140 px up)
export const arcMid = (a, b, rand) => ({ x: (a.x + b.x) / 2 + (rand() - 0.5) * 120, y: (a.y + b.y) / 2 - 60 - rand() * 80, rot: (rand() - 0.5) * 50 * Math.PI / 180 });

// Position on a three-point flight at eased progress u (keyframes at 0, peak, 1, linear between them)
export function along(a, mid, b, u) {
  if (u < FLIGHT.peak) { const k = u / FLIGHT.peak; return { x: a.x + (mid.x - a.x) * k, y: a.y + (mid.y - a.y) * k, rot: mid.rot * k, k: 1 + 0.2 * k }; }
  const k = (u - FLIGHT.peak) / (1 - FLIGHT.peak);
  return { x: mid.x + (b.x - mid.x) * k, y: mid.y + (b.y - mid.y) * k, rot: mid.rot * (1 - k), k: 1.2 - 0.2 * k };
}
