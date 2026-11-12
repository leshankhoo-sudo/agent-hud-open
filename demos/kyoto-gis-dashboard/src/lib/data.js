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
  photos: 'photos.json',
  namesEn: 'names_en.json',
  tourism: 'tourism_stats.json',
  explore: 'explore_places.json',
  bus: 'bus/index.json',
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
  applyEnglishNames(out);
  return { data: out, status };
}

// English names: adds name_en / name_en_source (new fields) next to the original name fields,
// which stay unchanged. Only verified names from names_en.json are used.
export function applyEnglishNames(data) {
  const en = data?.namesEn;
  if (!en) return data;
  for (const key of ['attractions', 'transport']) {
    const m = en[key] || {};
    for (const f of data[key]?.features || []) {
      const e = m[f.properties.id];
      if (e && englishPart(f.properties.name, e.en)) {
        f.properties.name_en = e.en;
        f.properties.name_en_source = e.source;
        if (e.osm) f.properties.osm_element = e.osm;
      }
    }
  }
  if (data.pointMuni?.names) {
    data.pointMuni.names_en = {};
    for (const [code, v] of Object.entries(en.municipalities || {})) if (data.pointMuni.names[code]) data.pointMuni.names_en[code] = v.en;
  }
  return data;
}

// 「日文名称 (English name)」; the original alone when no verified English name exists.
// Skipped when the original already contains that English (e.g. "兜台三丁目 (Kabutodai 3-chōme)")
// or is itself written in Latin letters.
const fold = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hasJapanese = (t) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(t);
export const englishPart = (ja, en) => (ja && en && en !== ja && hasJapanese(ja) && !fold(ja).includes(fold(en)) ? en : '');
export const withEnglish = (ja, en) => {
  const e = englishPart(ja, en);
  return e ? `${ja} (${e})` : ja || en || '';
};
export const recordLabel = (p) => (p.name ? withEnglish(p.name, p.name_en) : p.display_name);
export const muniLabel = (pm, code) => (code && pm?.names?.[code] ? withEnglish(pm.names[code], pm.names_en?.[code]) : '');

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
  return (p.name || '').toLowerCase().includes(q) || (p.display_name || '').toLowerCase().includes(q) || (p.name_en || '').toLowerCase().includes(q) || p.id.toLowerCase() === q || p.osm_id === q;
}

// Published tourism count for the municipality a point falls in. These are municipal totals
// (for a Kyoto City ward: the whole city), never an attendance figure for one attraction.
export function muniTourism(tourism, pm, code) {
  const en = code && pm?.names_en?.[code];
  const counts = tourism?.municipalities?.counts;
  if (!en || !counts) return null;
  const part = en.split(', ').find((x) => counts[x]);
  return part ? { name: part, wholeCity: part !== en, ...counts[part] } : null;
}
