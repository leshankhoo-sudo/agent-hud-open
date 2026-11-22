// Point-to-point routes from a real routing service. No key is needed.
// Service: FOSSGIS OSRM servers at routing.openstreetmap.de (OpenStreetMap data, one server per
// profile). Distance and duration come from the service's own route result; nothing is computed
// here from a straight line or a fixed speed. When the request fails nothing is drawn.
// Public transport is not offered: there is no timetable-based routing service in this project.
export const ROUTE_SERVICE = { name: 'FOSSGIS OSRM', host: 'routing.openstreetmap.de', url: 'https://routing.openstreetmap.de/about.html' };
export const MODES = [
  { key: 'foot', label: 'Walk', profile: 'routed-foot', note: 'Walking time from the service\'s foot profile (its own walking speed model).' },
  { key: 'bike', label: 'Cycle', profile: 'routed-bike', note: 'Cycling time from the service\'s bicycle profile.' },
  { key: 'car', label: 'Drive', profile: 'routed-car', note: 'Driving time from the service\'s car profile, road speed limits only: no live traffic, parking or signals.' },
];
export const TRANSIT_NOTE = 'Public transport routing is not available: the project has no timetable-based routing service, so no bus or rail travel time is estimated.';
export const modeOf = (k) => MODES.find((m) => m.key === k) || MODES[0];

const MODE_KEY = 'kyoto-gis-route-mode';
export const initialMode = () => { try { const v = localStorage.getItem(MODE_KEY); return MODES.some((m) => m.key === v) ? v : 'foot'; } catch { return 'foot'; } };
export const rememberMode = (k) => { try { localStorage.setItem(MODE_KEY, k); } catch { /* not stored */ } };

// Same result for the same request within a session (the service asks clients not to repeat requests).
const cache = new Map();
export async function fetchRoute(from, to, mode, signal) {
  const m = modeOf(mode);
  const pts = `${from[0].toFixed(6)},${from[1].toFixed(6)};${to[0].toFixed(6)},${to[1].toFixed(6)}`;
  const key = `${m.key}|${pts}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://${ROUTE_SERVICE.host}/${m.profile}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  let r;
  try { r = await fetch(url, { signal }); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('The routing service could not be reached (network or blocked request).');
  }
  if (r.status === 429) throw new Error('The routing service is busy (HTTP 429). Try again in a moment.');
  if (!r.ok) throw new Error(`The routing service answered HTTP ${r.status}.`);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code === 'NoRoute' ? 'The service found no route between these two points.' : `The routing service could not route this (${j.code || 'no result'}).`);
  const rt = j.routes[0];
  const coords = rt.geometry?.coordinates || [];
  if (coords.length < 2) throw new Error('The routing service returned no route line.');
  const out = {
    coords, distance_m: rt.distance, duration_s: rt.duration, mode: m.key,
    // how far each end had to move to reach the road network the service routes on
    snap_m: (j.waypoints || []).map((w) => w.distance ?? null),
  };
  cache.set(key, out);
  return out;
}

// Travel times between every pair of points (the service's table), for ordering a day's stops.
// Returns { durations: [[s]], distances: [[m]] } exactly as the service gives them; a missing pair is null.
export async function fetchTable(points, mode, signal) {
  const m = modeOf(mode);
  if (points.length < 2) return { durations: [[0]], distances: [[0]] };
  const pts = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
  const key = `table|${m.key}|${pts}`;
  if (cache.has(key)) return cache.get(key);
  let r;
  try { r = await fetch(`https://${ROUTE_SERVICE.host}/${m.profile}/table/v1/driving/${pts}?annotations=duration,distance`, { signal }); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('The routing service could not be reached (network or blocked request).');
  }
  if (r.status === 429) throw new Error('The routing service is busy (HTTP 429). Try again in a moment.');
  if (!r.ok) throw new Error(`The routing service answered HTTP ${r.status}.`);
  const j = await r.json();
  if (j.code !== 'Ok' || !Array.isArray(j.durations)) throw new Error(`The routing service could not compare these places (${j.code || 'no result'}).`);
  const out = { durations: j.durations, distances: j.distances || null };
  cache.set(key, out);
  return out;
}

export const fmtDuration = (s) => {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
};
export const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
