// Loads the prepared files from public/data and exposes counts used by the UI.

export const ATTRACTION_CATS = [
  { key: 'attraction', label: 'Attraction', color: '#ff8a4c' },
  { key: 'viewpoint', label: 'Viewpoint', color: '#3fe0c5' },
  { key: 'museum', label: 'Museum', color: '#b18cff' },
  { key: 'castle', label: 'Castle', color: '#f2c86b' },
];

export const TRANSPORT_TYPES = [
  { key: 'bus', label: 'Bus', color: '#6f93d6', cats: ['bus_stop', 'bus_station'] },
  { key: 'rail', label: 'Rail', color: '#e6eefc', cats: ['railway_station', 'railway_halt'] },
  { key: 'tram', label: 'Tram', color: '#ff6fae', cats: ['tram_stop'] },
];

export const CATEGORY_LABEL = {
  attraction: 'Attraction', viewpoint: 'Viewpoint', museum: 'Museum', castle: 'Castle',
  bus_stop: 'Bus stop', bus_station: 'Bus station', railway_station: 'Railway station', railway_halt: 'Railway halt', tram_stop: 'Tram stop',
};

const FILES = {
  attractions: 'attractions.geojson',
  transport: 'transport.geojson',
  municipalities: 'municipalities_display.geojson',
  outline: 'prefecture_outline.geojson',
  journeys: 'sample_journeys_display.json',
  walking: 'walking_routes.geojson',
  manifest: 'manifest.json',
  pointMuni: 'point_municipality.json',
  kde: 'analysis/density_kde.geojson',
  kdeMeta: 'analysis/density_kde_meta.json',
  walkReport: 'analysis/walking_pilot_report.json',
};

// Each file is loaded on its own so one failure is reported without hiding the others.
export async function loadAll(base = import.meta.env.BASE_URL) {
  const out = {};
  const status = {};
  await Promise.all(
    Object.entries(FILES).map(async ([k, f]) => {
      try {
        const r = await fetch(`${base}data/${f}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        out[k] = await r.json();
        status[k] = { ok: true, file: f };
      } catch (e) {
        out[k] = null;
        status[k] = { ok: false, file: f, error: String(e.message || e) };
      }
    }),
  );
  return { data: out, status };
}

export function countBy(features, key) {
  const m = {};
  for (const f of features) m[f.properties[key]] = (m[f.properties[key]] || 0) + 1;
  return m;
}

export function filterAttractions(features, cats, query = '') {
  const q = query.trim().toLowerCase();
  return features.filter((f) => cats.includes(f.properties.category) && (!q || matches(f, q)));
}
export function filterTransport(features, types, query = '') {
  const q = query.trim().toLowerCase();
  return features.filter((f) => types.includes(f.properties.transport_type) && (!q || matches(f, q)));
}
function matches(f, q) {
  const p = f.properties;
  return (p.name || '').toLowerCase().includes(q) || (p.display_name || '').toLowerCase().includes(q) || p.id.toLowerCase() === q || p.osm_id === q;
}
