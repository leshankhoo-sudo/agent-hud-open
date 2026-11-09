// Interface for Analysis 2 (walking-network accessibility).
//
// The dashboard reads public/data/walking_routes.geojson. Today that file is the
// package's empty placeholder ({"status": "NOT_CALCULATED", "features": []}), so
// every walking feature stays disabled. When real results exist, write them in
// this shape (see docs/DATA_INTERFACES.md):
//
// {
//   "type": "FeatureCollection",
//   "status": "CALCULATED",
//   "computed_at": "ISO time", "network_version": "...", "method": "...",
//   "features": [
//     { "type": "Feature",
//       "geometry": LineString | MultiLineString | null,   // the routed path along the walk graph; null if no route
//       "properties": {
//         "attraction_id": "A00265",          // existing local ID
//         "stop_id": "S00019" | null,          // existing local ID, null when no route
//         "stop_type": "bus" | "rail" | "tram",// one nearest-stop result per type
//         "route_status": "ok" | "unreachable" | "failed" | "unverified",
//         "distance_m": number | null,         // network length in metres; null unless status is ok
//         "duration_min": number | null,
//         "note": "..." } } ] }
//
// Straight lines must never be written here as routes, and a missing result is
// null, never 0.

export const ROUTE_STATUSES = ['ok', 'unreachable', 'failed', 'unverified'];
export const STOP_TYPES = ['bus', 'rail', 'tram'];

export function walkingAvailability(fc) {
  if (!fc || fc.type !== 'FeatureCollection') return { available: false, reason: 'Walking routes file is missing or not GeoJSON.' };
  if (fc.status !== 'CALCULATED') return { available: false, reason: `Walking routes have not been calculated yet (file status: ${fc.status || 'none'}).` };
  if (!Array.isArray(fc.features) || fc.features.length === 0) return { available: false, reason: 'Walking routes file contains no results.' };
  const pilot = fc.scope === 'pilot';
  return { available: true, reason: null, pilot, scopeIds: new Set(fc.attraction_ids || []), pilotInfo: fc.pilot || null, computedAt: fc.computed_at || null };
}

// Validate and index results by attraction and stop type. Invalid rows are kept aside, not repaired.
export function indexWalking(fc) {
  const byAttraction = new Map();
  const invalid = [];
  for (const f of fc?.features || []) {
    const p = f?.properties || {};
    const problems = [];
    if (!/^A\d{5}$/.test(p.attraction_id || '')) problems.push('attraction_id');
    if (!STOP_TYPES.includes(p.stop_type)) problems.push('stop_type');
    if (!ROUTE_STATUSES.includes(p.route_status)) problems.push('route_status');
    if (p.route_status === 'ok') {
      if (!(typeof p.distance_m === 'number' && p.distance_m > 0)) problems.push('distance_m must be > 0 for ok routes');
      if (!f.geometry || !/LineString$/.test(f.geometry.type)) problems.push('ok routes need a line geometry');
      if (!/^S\d{5}$/.test(p.stop_id || '')) problems.push('stop_id');
    } else if (p.route_status !== 'unverified' && p.distance_m != null) {
      problems.push('distance_m must be null when there is no route');
    }
    if (problems.length) {
      invalid.push({ feature: f, problems });
      continue;
    }
    if (!byAttraction.has(p.attraction_id)) byAttraction.set(p.attraction_id, {});
    byAttraction.get(p.attraction_id)[p.stop_type] = { ...p, geometry: f.geometry };
  }
  return { byAttraction, invalid };
}

// Coverage for the current filter. Denominator: attraction IDs in the current
// category filter. Numerator: distinct IDs whose 'ok' route to a selected stop
// type is within maxDistance. Each attraction is counted once.
export function walkingCoverage(index, attractionIds, stopTypes, maxDistance) {
  let within = 0, beyond = 0, noRoute = 0, notComputed = 0;
  for (const id of attractionIds) {
    const r = index.byAttraction.get(id);
    const rows = r ? stopTypes.map((t) => r[t]).filter(Boolean) : [];
    if (!rows.length) { notComputed++; continue; }
    const ok = rows.filter((x) => x.route_status === 'ok');
    if (!ok.length) { noRoute++; continue; }
    if (Math.min(...ok.map((x) => x.distance_m)) <= maxDistance) within++;
    else beyond++;
  }
  const denominator = attractionIds.length;
  return { denominator, within, beyond, noRoute, notComputed, share: denominator ? within / denominator : null };
}
