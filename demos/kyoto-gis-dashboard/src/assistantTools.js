// What the atlas assistant can do (lib/assistant.js runs the conversation). Every tool either reads the
// project's own data (the same files the dashboard shows) or operates the dashboard the way a visitor
// would: select a place, open a panel, show a layer, change the trip. Results are plain data; when the data
// has no answer, the tool says so instead of filling one in.
import * as TP from './lib/trip.js';
import { fetchRoute } from './lib/route.js';
import { getWeather, describeCode, dailySummary, tokyoHourKey } from './lib/weather.js';
import { ATTRACTION_CATS, CATEGORY_LABEL, filterAttractions, filterTransport, recordLabel, muniLabel, muniTourism, foldLatin } from './lib/data.js';

const S = (description, properties, required = []) => ({ type: 'object', properties, required, description });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description) => ({ type: 'integer', description });
const WAY = str('How to get there from the place before: foot, bus, bike or car.', { enum: ['foot', 'bus', 'bike', 'car'] });

export const DECLARATIONS = [
  { name: 'search_places', description: 'Find attraction records or transit stops in the atlas by name (Japanese or English), optionally of one kind or in one city or town. Returns ids to use with the other tools. Records keep their OpenStreetMap names: a station is named without "Station" (Kyoto Station is the railway station 京都, "Kyoto"), and some sites are only under their Japanese name (伏見稲荷大社), so if an English name finds nothing useful, search again in Japanese or with kind.',
    parameters: S('', { query: str('Name or part of a name, e.g. 清水寺, Kiyomizu, Ginkaku, Kyoto Station. Can be empty when kind or city is given.'),
      kind: str('Kind of place.', { enum: ['any', 'temple', 'shrine', 'museum', 'castle', 'garden', 'viewpoint', 'attraction', 'station', 'bus_stop'] }),
      city: str('City, town or ward, in Japanese or English, e.g. Uji, 宇治市, Higashiyama.'), limit: int('How many results, 1 to 10 (default 6).') }) },
  { name: 'get_place', description: 'Everything the atlas has on one place: names, kind, city, photo credit, walking route to the nearest bus stop and rail station, bus routes at a stop, the city tourism count, and whether it is in the trip.',
    parameters: S('', { id: str('Record id from search_places, e.g. A00560 or S00019.') }, ['id']) },
  { name: 'show_place', description: 'Operate the dashboard: go to the map, select the place, and open its panel at one section so the user can see it.',
    parameters: S('', { id: str('Record id.'), section: str('Which part of the place panel to open.', { enum: ['overview', 'walking', 'weather', 'bus', 'journeys'] }) }, ['id']) },
  { name: 'show_map_layer', description: 'Operate the dashboard: show an analysis layer on the map (attraction density, heatmap, walking routes to stops, the study area) or turn them off.',
    parameters: S('', { layer: str('Layer to show.', { enum: ['density', 'heatmap', 'walking_routes', 'study_area', 'none'] }) }, ['layer']) },
  { name: 'get_weather', description: 'Open-Meteo forecast for a place (Asia/Tokyo time, up to 7 days ahead): now, a whole day, or one hour.',
    parameters: S('', { id: str('Record id.'), date: str('YYYY-MM-DD, optional.'), hour: int('Hour 0-23, optional (needs date).') }, ['id']) },
  { name: 'route_between', description: 'Route along the road network between two places by walking, cycling or driving (FOSSGIS OSRM): distance and time. Not for buses.',
    parameters: S('', { from_id: str('Start record id.'), to_id: str('End record id.'), way: str('foot, bike or car.', { enum: ['foot', 'bike', 'car'] }) }, ['from_id', 'to_id']) },
  { name: 'bus_between', description: 'Kyoto City bus routes that call near both places in order: route number, boarding and alighting stop, number of stops and official fare. There is no timetable, so no ride time.',
    parameters: S('', { from_id: str('Start record id.'), to_id: str('End record id.') }, ['from_id', 'to_id']) },
  { name: 'get_trip', description: 'The user\'s trip plan as saved in this browser: days, dates, hours, start place and the places of each day.', parameters: S('', {}) },
  { name: 'add_to_trip', description: 'Add a place to a day of the trip (a new day is added if needed, up to 7 days).',
    parameters: S('', { id: str('Record id.'), day: int('Day number, starting at 1.'), way: WAY, stay_minutes: int('How long to stay, optional (default 60).'), arrive: str('Arrival time HH:MM, optional.') }, ['id', 'day']) },
  { name: 'remove_from_trip', description: 'Remove a place from a day of the trip.', parameters: S('', { id: str('Record id.'), day: int('Day number.') }, ['id', 'day']) },
  { name: 'set_trip_day', description: 'Change a day of the trip: its start and end time, its start place, or the trip\'s first date (later days follow).',
    parameters: S('', { day: int('Day number.'), start: str('Start time HH:MM, optional.'), end: str('End time HH:MM, optional.'), start_place_id: str('Record id of the place the day starts from (often a station), optional.'), first_date: str('YYYY-MM-DD for day 1, optional.') }, ['day']) },
  { name: 'open_trip', description: 'Operate the dashboard: open the trip planner, optionally at one day\'s plan, the list of all days, or the map of all days.',
    parameters: S('', { day: int('Day number to open, optional.'), view: str('Which view.', { enum: ['trip', 'agenda', 'map'] }) }) },
  { name: 'open_section', description: 'Operate the dashboard: open the GIS map dashboard, or the Data & Sources or Journeys & Fares sheet.',
    parameters: S('', { name: str('What to open.', { enum: ['map', 'sources', 'journeys'] }) }, ['name']) },
];

// what the chat shows for each action
export function actionLabel({ name, args, result }) {
  const n = result?.name || args.id || '';
  if (result?.error) return `${name.replace(/_/g, ' ')}: ${result.error}`;
  switch (name) {
    case 'search_places': return `Searched “${args.query || args.kind || args.city || ''}” · ${result?.count ?? 0} found`;
    case 'get_place': return `Read ${n}`;
    case 'show_place': return `Opened ${n}${args.section && args.section !== 'overview' ? ` · ${args.section}` : ''}`;
    case 'show_map_layer': return args.layer === 'none' ? 'Turned map layers off' : `Showed ${args.layer.replace('_', ' ')}`;
    case 'get_weather': return `Weather at ${n}`;
    case 'route_between': return `${args.way || 'foot'} route ${result?.from} → ${result?.to}`;
    case 'bus_between': return `Buses ${result?.from} → ${result?.to}`;
    case 'get_trip': return 'Read the trip';
    case 'add_to_trip': return `Added ${n} to Day ${args.day}`;
    case 'remove_from_trip': return `Removed ${n} from Day ${args.day}`;
    case 'set_trip_day': return `Changed Day ${args.day}`;
    case 'open_trip': return `Opened the trip${args.day ? ` · Day ${args.day}` : ''}`;
    case 'open_section': return `Opened ${args.name}`;
    default: return name;
  }
}

// ctx: { A, Tr, byId, d, walkIndex, showPlace, showLayer, openTrip, openSection }
export function makeHandlers(ctx) {
  const { A, Tr, byId, d } = ctx;
  const pm = d.pointMuni, photos = d.photos?.photos || {};
  const xy = (id) => byId.get(id)?.f.geometry.coordinates || null;
  const nameOf = (id) => { const h = byId.get(id); return h ? (h.f.properties.name_en || recordLabel(h.f.properties)) : id; };
  const need = (id) => { const h = byId.get(id); if (!h) throw new Error(`No record ${id}. Use search_places to find the id.`); return h; };
  const cityOf = (id) => muniLabel(pm, pm?.points?.[id]) || null;
  const saveTrip = (t) => { TP.saveTrip(t); globalThis.dispatchEvent?.(new CustomEvent('kyoto-trip-changed')); };
  const dayIndex = (t, day) => {
    const i = Math.round(day) - 1;
    if (!(i >= 0)) throw new Error('Day numbers start at 1.');
    if (i >= TP.MAX_DAYS) throw new Error(`A trip has at most ${TP.MAX_DAYS} days.`);
    while (t.days.length <= i) t = TP.addDay(t);
    return [t, i];
  };
  const tripSummary = (t) => t.days.map((x, i) => ({ day: i + 1, date: x.date, start: x.start, end: x.end, start_place: x.from ? nameOf(x.from) : null,
    places: x.stops.map((s) => ({ id: s.id, name: nameOf(s.id), way_there: s.mode, stay_minutes: s.stay, arrive: s.at || null })) }));

  return {
    search_places({ query = '', kind = 'any', city = '', limit = 6 }) {
      const n = Math.max(1, Math.min(10, limit || 6));
      let pool;
      if (kind === 'station') pool = filterTransport(Tr, ['rail', 'tram'], query);
      else if (kind === 'bus_stop') pool = filterTransport(Tr, ['bus'], query);
      else {
        const cats = kind && kind !== 'any' ? [kind] : ATTRACTION_CATS.map((c) => c.key);
        pool = filterAttractions(A, cats, query);
        if (kind === 'any' && query.trim()) pool = [...pool, ...filterTransport(Tr, ['rail', 'tram', 'bus'], query)];
      }
      if (city.trim()) {
        // Japanese: part of the name (宇治 finds 宇治市); English: whole words, so Uji is not Ujitawara
        const c = city.trim(), latin = /^[\x00-\x7f]+$/.test(c);
        const re = latin ? new RegExp(`\\b${c.replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, '\\s+')}\\b`, 'i') : null;
        pool = pool.filter((f) => { const l = cityOf(f.properties.id) || ''; return latin ? re.test(l.normalize('NFKD').replace(/[̀-ͯ]/g, '')) : l.includes(c); });
      }
      // the clearest match first: the exact name, then a name that starts with the query, named records
      // before records labelled by the site they lie in, stations before bus stops
      const qj = query.trim(), qf = foldLatin(qj);
      const rank = (f) => {
        const p = f.properties, en = foldLatin(p.name_en);
        const exact = (qj && p.name === qj) || (qf && (en === qf || foldLatin(p.name) === qf));
        const starts = (qj && (p.name || '').startsWith(qj)) || (qf && en.startsWith(qf));
        return (exact ? -4 : starts ? -2 : 0) + (p.name ? 0 : 2) + (p.transport_type === 'bus' ? 1 : p.transport_type ? 0.5 : 0) - (photos[p.id] ? 0.5 : 0);
      };
      // one bus stop has a record per platform: list the name once, with how many records share it
      const out = [], seenBus = new Map();
      for (const f of [...pool].sort((a, b) => rank(a) - rank(b))) {
        const p = f.properties, label = recordLabel(p);
        if (p.transport_type === 'bus') {
          const k = `${label}|${cityOf(p.id)}`;
          if (seenBus.has(k)) { seenBus.get(k).records_with_this_name++; continue; }
        }
        if (out.length >= n) continue;
        const row = { id: p.id, name: label, kind: CATEGORY_LABEL[p.category] || p.category, city: cityOf(p.id), has_photo: !!photos[p.id] };
        if (p.transport_type === 'bus') { row.records_with_this_name = 1; seenBus.set(`${label}|${cityOf(p.id)}`, row); }
        out.push(row);
      }
      return { count: pool.length, results: out };
    },
    get_place({ id }) {
      const h = need(id), p = h.f.properties, ph = photos[id];
      const w = ctx.walkIndex?.byAttraction.get(id);
      const walkTo = (r) => (!r ? null : r.route_status === 'ok' ? { stop: nameOf(r.stop_id), stop_id: r.stop_id, walk_m: r.distance_m, walk_min: r.duration_min } : { status: r.route_status });
      const busKeys = d.bus?.point_stops?.[id] || [];
      const routes = [...new Set(busKeys.flatMap((k) => d.bus.stops[k]?.routes || []))].map((k) => d.bus.routes.find((r) => r.key === k)?.number).filter(Boolean);
      const t = muniTourism(d.tourism, pm, pm?.points?.[id]);
      const trip = TP.loadTrip();
      return {
        id, name: recordLabel(p), name_ja: p.name || null, name_en: p.name_en || null, kind: CATEGORY_LABEL[p.category] || p.category, city: cityOf(id), coordinates: h.f.geometry.coordinates,
        photo: ph ? { author: ph.artist, licence: ph.license } : null,
        walking: w ? { nearest_bus_stop: walkTo(w.bus), nearest_rail_station: walkTo(w.rail) } : (h.layer === 'attraction' ? 'no walking route computed for this record' : undefined),
        bus_routes_here: h.layer === 'transport' ? (routes.length ? routes : 'no Kyoto City bus route in the atlas calls here') : undefined,
        city_tourism: t ? { city: t.name, ...t } : null,
        in_trip_days: trip.days.map((x, i) => (x.stops.some((s) => s.id === id) || x.from === id ? i + 1 : 0)).filter(Boolean),
        not_in_atlas: 'opening hours, ticket prices, timetables',
      };
    },
    show_place({ id, section = 'overview' }) { need(id); ctx.showPlace(id, section); return { name: nameOf(id), shown: true, section }; },
    show_map_layer({ layer }) { ctx.showLayer(layer); return { shown: layer }; },
    async get_weather({ id, date, hour }) {
      const c = xy(id) || need(id).f.geometry.coordinates;
      const { data } = await getWeather(c[1], c[0]);
      const hourly = data.hourly;
      const fmt = (h) => ({ time: h.time, conditions: describeCode(h.code).label, temperature_c: h.temperature, rain_chance_pct: h.precipProb, rain_mm: h.precip, wind_kmh: h.wind });
      const out = { name: nameOf(id), source: 'Open-Meteo forecast, Asia/Tokyo', forecast_until: hourly[hourly.length - 1]?.time };
      if (date && hour != null) {
        const h = hourly.find((x) => x.time === `${date}T${String(hour).padStart(2, '0')}:00`);
        return h ? { ...out, hour: fmt(h) } : { ...out, error: 'That hour is outside the 7-day forecast.' };
      }
      if (date) {
        const day = dailySummary(hourly).find((x) => x.date === date);
        if (!day) return { ...out, error: 'That date is outside the 7-day forecast.' };
        return { ...out, day: { date, min_c: day.min, max_c: day.max, highest_rain_chance_pct: day.maxProb, rain_mm: day.total }, hours: hourly.filter((x) => x.time.startsWith(date) && +x.time.slice(11, 13) % 3 === 0).map(fmt) };
      }
      const now = hourly.find((x) => x.time === tokyoHourKey()) || hourly[0];
      return { ...out, now: fmt(now), current_temperature_c: data.current?.temperature ?? null };
    },
    async route_between({ from_id, to_id, way = 'foot' }) {
      const a = need(from_id).f.geometry.coordinates, b = need(to_id).f.geometry.coordinates;
      const r = await fetchRoute(a, b, way);
      return { from: nameOf(from_id), to: nameOf(to_id), way, distance_km: +(r.distance_m / 1000).toFixed(2), duration_min: Math.round(r.duration_s / 60), service: 'FOSSGIS OSRM (OpenStreetMap)' };
    },
    bus_between({ from_id, to_id }) {
      const a = need(from_id).f.geometry.coordinates, b = need(to_id).f.geometry.coordinates;
      const r = TP.busOptions(d.bus, xy, a, b);
      return { from: nameOf(from_id), to: nameOf(to_id), stop_search_radius_m: [r.radiusA, r.radiusB],
        options: r.options.map((o) => ({ bus: o.number, board: o.boardName, alight: o.alightName, stops: o.stops, adult_fare_yen: o.fare?.adult ?? null })),
        note: r.options.length ? 'No timetable in the atlas: ride times are not known.' : 'No Kyoto City bus route in the atlas calls near both places in this order.' };
    },
    get_trip() { return { days: tripSummary(TP.loadTrip()) }; },
    add_to_trip({ id, day, way, stay_minutes, arrive }) {
      need(id);
      let [t, i] = dayIndex(TP.loadTrip(), day);
      if (t.days[i].stops.some((s) => s.id === id)) return { name: nameOf(id), note: `Already on Day ${i + 1}.` };
      t = TP.addStop(t, i, id, { mode: way || 'foot' });
      const si = t.days[i].stops.length - 1, patch = {};
      if (stay_minutes != null) patch.stay = Math.max(0, Math.min(600, Math.round(stay_minutes)));
      if (arrive && TP.parseHM(arrive) != null) patch.at = arrive;
      if (Object.keys(patch).length) t = TP.patchStop(t, i, si, patch);
      saveTrip(t);
      return { name: nameOf(id), day: i + 1, date: t.days[i].date, days: tripSummary(t)[i] };
    },
    remove_from_trip({ id, day }) {
      const t0 = TP.loadTrip(), i = Math.round(day) - 1, si = t0.days[i]?.stops.findIndex((s) => s.id === id);
      if (si == null || si < 0) return { name: nameOf(id), note: `Not on Day ${day}.` };
      const t = TP.removeStop(t0, i, si);
      saveTrip(t);
      return { name: nameOf(id), day: i + 1, days: tripSummary(t)[i] };
    },
    set_trip_day({ day, start, end, start_place_id, first_date }) {
      let [t, i] = dayIndex(TP.loadTrip(), day);
      if (first_date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(first_date)) throw new Error('first_date must be YYYY-MM-DD.'); t = TP.setStartDate(t, first_date); }
      if (start || end) t = TP.setHours(t, i, start || t.days[i].start, end || t.days[i].end);
      if (start_place_id) { need(start_place_id); t = TP.setFrom(t, i, start_place_id); }
      saveTrip(t);
      return { day: i + 1, ...tripSummary(t)[i] };
    },
    open_trip({ day, view = 'trip' }) { ctx.openTrip({ day: day ? Math.round(day) : null, view }); return { opened: view, day: day || null }; },
    open_section({ name }) { ctx.openSection(name); return { opened: name }; },
  };
}
