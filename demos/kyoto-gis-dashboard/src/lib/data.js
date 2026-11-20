import { applyLandmarks } from './landmarks.js';
// Loads the prepared files from public/data and exposes counts used by the UI.

export const ATTRACTION_CATS = [
  { key: 'attraction', label: 'Attraction', color: '#ff8a4c' },
  { key: 'viewpoint', label: 'Viewpoint', color: '#3fe0c5' },
  { key: 'museum', label: 'Museum', color: '#b18cff' },
  { key: 'castle', label: 'Castle', color: '#f2c86b' },
  // after the POI audit: temples, shrines and gardens told apart (scripts/poi_reconcile.py, category_basis)
  { key: 'temple', label: 'Temple', color: '#f78fb3' },
  { key: 'shrine', label: 'Shrine', color: '#ff5b4a' },
  { key: 'garden', label: 'Garden', color: '#9bd36a' },
];

export const TRANSPORT_TYPES = [
  { key: 'bus', label: 'Bus', color: '#6f93d6', cats: ['bus_stop', 'bus_station'] },
  { key: 'rail', label: 'Rail', color: '#e6eefc', cats: ['railway_station', 'railway_halt'] },
  { key: 'tram', label: 'Tram', color: '#ff6fae', cats: ['tram_stop'] },
];

export const CATEGORY_LABEL = {
  attraction: 'Attraction', viewpoint: 'Viewpoint', museum: 'Museum', castle: 'Castle', temple: 'Temple', shrine: 'Shrine', garden: 'Garden',
  bus_stop: 'Bus stop', bus_station: 'Bus station', railway_station: 'Railway station', railway_halt: 'Railway halt', tram_stop: 'Tram stop',
};

const FILES = {
  attractions: 'attractions.geojson',
  transport: 'transport.geojson',
  municipalities: 'municipalities_display.geojson',
  outline: 'prefecture_outline.geojson',
  journeys: 'sample_journeys_display.json',
  walking: 'walking_routes_prefecture.geojson',
  manifest: 'manifest.json',
  pointMuni: 'point_municipality.json',
  kde: 'analysis/density_kde.geojson',
  kdeMeta: 'analysis/density_kde_meta.json',
  walkReport: 'analysis/walking_prefecture_report.json',
  photos: 'photos.json',
  namesEn: 'names_en.json',
  tourism: 'tourism_stats.json',
  explore: 'explore_places.json',
  bus: 'bus/index.json',
  context: 'attraction_context.json',
  labels: 'attraction_labels.json',      // labels for records with no OSM name (scripts/label_unnamed.py)
  checks: 'name_checks.json',            // each name checked against Wikidata and the Kyoto City list (scripts/crosscheck_names.py)
  relations: 'poi_relations.json',
  records: 'dsight_records.json',       // every Kyoto City DSIGHT_1.csv record and what was done with it
  geography: 'dsight_geography.geojson', // its place names, mountains and rivers that two sources place
  coverage: 'study_area_coverage.json',   // municipalities the study area covers (scripts/study_area_coverage.py)
  coverageLines: 'coverage_lines.geojson', // their boundary rings, one line per ring, for drawing
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
  applyContext(out);
  applyLabels(out);
  applyLandmarks(out);
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

// Records with no OSM name: identity level, and an English name only from the name:en tag of the
// SAME OSM record (scripts/prepare_context.py). The containing-site list stays in data.context and is
// not copied into map feature properties.
export function applyContext(data) {
  const recs = data?.context?.records;
  if (!recs) return data;
  for (const f of data.attractions?.features || []) {
    const c = recs[f.properties.id];
    if (!c || f.properties.name) continue;
    f.properties.identity = c.identity;
    if (c.name_en) {
      f.properties.name_en = c.name_en;
      f.properties.name_en_source = c.name_en_source;
    }
  }
  return data;
}

// Records with no OSM name and no English name of their own: a label, and what it rests on
// (attraction_labels.json). The original fields stay as they are; label_* are new fields.
export function applyLabels(data) {
  const L = data?.labels?.labels;
  if (!L) return data;
  for (const f of data.attractions?.features || []) {
    const p = f.properties, l = L[p.id];
    if (!l || p.name || p.name_en) continue;
    p.label_kind = l.kind; p.label_basis = l.basis; p.label_text = l.text || ''; p.label_text_en = l.text_en || '';
    p.label_lang = l.lang || ''; p.label_muni_en = l.muni_en || '';
    p.label = [l.text, l.text_en, l.muni_en].filter(Boolean).join(' ');   // what search looks at
  }
  return data;
}

// Name order: 「日文 (English)」 by default; 「English (日文)」 when the visitor picks English first.
let englishFirst = false;
export const setEnglishFirst = (v) => { englishFirst = !!v; };
export const isEnglishFirst = () => englishFirst;

// 「日文名称 (English name)」; the original alone when no verified English name exists.
// Skipped when the original already contains that English (e.g. "兜台三丁目 (Kabutodai 3-chōme)")
// or is itself written in Latin letters.
const fold = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hasJapanese = (t) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(t);
export const englishPart = (ja, en) => (ja && en && en !== ja && hasJapanese(ja) && !fold(ja).includes(fold(en)) ? en : '');
export const withEnglish = (ja, en) => {
  const e = englishPart(ja, en);
  if (!e) return ja || en || '';
  return englishFirst ? `${e} (${ja})` : `${ja} (${e})`;
};
// A label for a record with no OSM name: its name in another language, its description, the named site it
// lies in, or its town / municipality, always with the category so it never reads as an official name.
export const labelText = (p) => {
  const cat = CATEGORY_LABEL[p.category] || 'Place';
  switch (p.label_kind) {
    case 'name': return p.label_text;
    case 'desc': return `${cat}: ${p.label_text}`;
    case 'place': return `${cat} at ${withEnglish(p.label_text, p.label_text_en)}`;
    case 'address': return `${cat} · ${p.label_text}${p.label_muni_en ? `, ${p.label_muni_en}` : ''}`;
    case 'muni': return `${cat} · ${p.label_muni_en || 'Kyoto Prefecture'}`;
    default: return p.display_name;
  }
};
export const LABEL_NOTE = {
  name: 'No main name in OpenStreetMap. This is its name in another language on the same record.',
  desc: 'No name in OpenStreetMap. This is the description on the same record, not a name.',
  place: 'No name in OpenStreetMap. Labelled by the named site it lies in, which tells where it is, not what it is.',
  address: 'No name in OpenStreetMap. Labelled by its town from the GSI address of the point.',
  muni: 'No name in OpenStreetMap. Labelled by the municipality it lies in.',
};
// A record with no OSM name shows the English name of the same OSM record, else its label.
export const recordLabel = (p) => (p.name ? withEnglish(p.name, p.name_en) : p.name_en || (p.label_kind ? labelText(p) : p.display_name));
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
// 'Nanzen-ji', 'nanzenji' and 'Nanzen ji' all find 南禅寺: Latin letters are also compared without
// hyphens, spaces and accents. search_text holds a site's other names (aliases from DSIGHT_1.csv).
export const foldLatin = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function matches(f, q) {
  const p = f.properties;
  if ((p.name || '').toLowerCase().includes(q) || (p.display_name || '').toLowerCase().includes(q) || (p.name_en || '').toLowerCase().includes(q) || (p.label || '').toLowerCase().includes(q) || p.id.toLowerCase() === q || p.osm_id === q) return true;
  if ((p.search_text || '').toLowerCase().includes(q)) return true;
  if ((p.merged_ids || []).some((x) => x.toLowerCase() === q)) return true;   // a merged duplicate's ID opens the record that keeps it
  const qf = foldLatin(q);
  return qf.length >= 3 && /^[\x00-\x7f]+$/.test(q) && (foldLatin(p.name_en).includes(qf) || foldLatin(p.search_text).includes(qf));
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
