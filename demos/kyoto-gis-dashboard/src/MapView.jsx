import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ATTRACTION_CATS, TRANSPORT_TYPES } from './lib/data.js';
import { addTransitIcons } from './lib/icons.js';
import { addLandmarkImages } from './lib/landmarks.js';
import { themeOf } from './lib/theme.js';

// Basemaps, no API key. See README for usage terms.
// "night" is a vector basemap (OpenFreeMap, OSM data) drawn in our own style, with only a few town names so
// the project data stays readable. Dark theme: near-black land, cyan water, green parks, thin road lines.
// Light theme: warm paper land, soft grey-blue water, pale green parks, brown-grey roads.
const OFM_ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const BASEMAPS = {
  night: { label: 'Styled', vector: 'https://tiles.openfreemap.org/planet', attribution: OFM_ATTR },
  gsi: {
    label: 'GSI pale',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
    maxzoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル (GSI Japan)</a>',
  },
  osm: {
    label: 'OSM raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  },
};
const DATA_ATTR = 'Points © OpenStreetMap contributors (ODbL) via Geofabrik · Boundary: MLIT N03 (2026)';

const catExpr = (cats) => ['in', ['get', 'category'], ['literal', cats]];
const typeExpr = (types) => ['in', ['get', 'transport_type'], ['literal', types]];
const sumExpr = (cats) => (cats.length ? ['+', 0, ...cats.map((c) => ['get', c])] : 0);
export const KDE_BREAKS = [0.05, 0.5, 1, 2, 4, 8];
export const kdeColors = (theme) => themeOf(theme).kde;

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Offline preview build (claude.ai viewer blocks external tiles): background only, no fake basemap.
export const OFFLINE_PREVIEW = import.meta.env.VITE_TARGET === 'artifact';
const lineW = (z0, w0, z1, w1) => ['interpolate', ['linear'], ['zoom'], z0, w0, z1, w1];
const placeName = ['upcase', ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]];
const placeLayer = (id, cls, minzoom, size, B) => ({
  id, type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom, filter: ['==', ['get', 'class'], cls],
  layout: { 'text-field': placeName, 'text-font': ['Noto Sans Regular'], 'text-size': size, 'text-letter-spacing': 0.14, 'text-max-width': 9, 'text-padding': 30, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] },
  paint: { 'text-color': B.label, 'text-opacity': B.labelOp, 'text-halo-color': B.halo, 'text-halo-width': 1.4 },
});
// Culverted rivers and road/rail tunnels are hidden: they are underground and only add clutter.
const NO_TUNNEL = ['!=', ['get', 'brunnel'], 'tunnel'];
const BIG = ['motorway', 'trunk'];
const vectorLayers = (B) => [
  { id: 'bm-landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]], paint: { 'fill-color': B.landuse, 'fill-opacity': 0.9 } },
  { id: 'bm-landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': ['match', ['get', 'class'], 'wood', B.wood, B.grass], 'fill-opacity': B.coverOp } },
  { id: 'bm-park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': B.park, 'fill-opacity': B.parkOp } },
  { id: 'bm-water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': ['match', ['get', 'class'], 'ocean', B.ocean, B.water], 'fill-opacity': ['match', ['get', 'class'], 'ocean', 1, B.waterOp] } },
  { id: 'bm-waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: NO_TUNNEL, paint: { 'line-color': B.waterway, 'line-opacity': ['match', ['get', 'class'], 'river', B.riverOp, B.streamOp], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'class'], 'river', 0.4, 0.15], 14, ['match', ['get', 'class'], 'river', 1.6, 0.7]] } },
  { id: 'bm-building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': B.building, 'fill-opacity': 0.9 } },
  { id: 'bm-road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ['all', NO_TUNNEL, ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]]], paint: { 'line-color': B.roadMinor, 'line-opacity': B.roadMinorOp, 'line-width': lineW(11, 0.3, 16, 1.4) } },
  { id: 'bm-road', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', NO_TUNNEL, ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]]], paint: { 'line-color': B.road, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'class'], BIG, B.roadOp[0], B.roadOp[1]], 13, ['match', ['get', 'class'], [...BIG, 'primary'], B.roadOp[2], B.roadOp[3]]], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'class'], BIG, 0.6, 0.25], 14, ['match', ['get', 'class'], BIG, 1.6, 1]], 'line-blur': 0.3 } },
  { id: 'bm-rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', NO_TUNNEL, ['in', ['get', 'class'], ['literal', ['rail', 'transit']]]], paint: { 'line-color': B.rail, 'line-opacity': B.railOp, 'line-width': lineW(8, 0.6, 14, 1.4), 'line-dasharray': [3, 2] } },
  placeLayer('bm-place-city', 'city', 7, lineW(7, 10, 13, 14), B),
  placeLayer('bm-place-town', 'town', 10.5, lineW(10.5, 9.5, 14, 12), B),
];
// Basemap sources and layers (ids start with "bm-"; all sit under the project data).
function baseParts(key, theme) {
  const b = BASEMAPS[key] || BASEMAPS.night;
  const B = themeOf(theme).base;
  if (b.vector) return { bg: B.bg, sources: { omt: { type: 'vector', url: b.vector, attribution: b.attribution } }, layers: vectorLayers(B) };
  return {
    bg: B.rasterBg,
    sources: { base: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution } },
    layers: [{ id: 'bm-raster', type: 'raster', source: 'base', paint: { ...B.raster } }],
  };
}
function styleFor(basemap, theme) {
  if (OFFLINE_PREVIEW) return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': themeOf(theme).offlineBg } }] };
  const p = baseParts(basemap, theme);
  return { version: 8, glyphs: GLYPHS, sources: p.sources, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': p.bg } }, ...p.layers] };
}
const TRANSIT_LAYERS = ['transport-pt', 'transport-sym-rail', 'transport-sym-bus'];
// Landmark symbols (lib/landmarks.js). Three levels drawn by the map engine from cached images:
//   lm-iconic  the 15 places with their own silhouette: any zoom, lowest rank wins where they would overlap
//   lm-major   places with a verified item or photo, and castles: category plate from zoom 10.5
//   lm-minor   everything else: category plate from zoom 14.5 (below that, its dot)
//   lm-search  while a search is typed: a symbol for every match at any zoom
//   lm-hover / lm-sel  the hovered and the selected place, enlarged, at any zoom, never hidden by collision
// The dots (attractions-pt) always hold every record, so a hidden symbol never hides a place.
const LM_BASE = ['lm-minor', 'lm-major', 'lm-iconic'];
const LM_LAYERS = [...LM_BASE, 'lm-search', 'lm-hover', 'lm-sel'];
const LM_PICK = ['attractions-pt', ...LM_LAYERS];
const NONE = ['==', ['get', 'id'], '__none__'];
const TIER = (n) => ['==', ['get', 'lm_tier'], n];
const isIconic = TIER(1);
const lmSize = (k = 1) => ['interpolate', ['linear'], ['zoom'],
  7, ['*', k, ['match', ['get', 'lm_tier'], 1, 0.56, 0.5]],
  10.5, ['*', k, ['match', ['get', 'lm_tier'], 1, 0.68, 0.56]],
  13, ['*', k, ['match', ['get', 'lm_tier'], 1, 0.84, 0.8]],
  16, ['*', k, ['match', ['get', 'lm_tier'], 1, 1.12, ['match', ['get', 'lm_tier'], 2, 1, 0.86]]]];
// attraction dots: ordinary records start smaller, so the well-known places lead when zoomed out
// (an iconic place keeps a small dot: the exact point its building stands on)
// graded by level so the whole-prefecture view stays legible: ordinary records start small
const PT_RADIUS = ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'lm_tier'], 3, 1.7, 2, 2.4, 3], 10, ['match', ['get', 'lm_tier'], 3, 2.6, 3.4], 12, ['match', ['get', 'lm_tier'], 3, 4.4, 1, 3.2, 5.2], 16, ['match', ['get', 'lm_tier'], 1, 3.6, 8]];
// the soft halo under the points: faint, tight, and absent in the whole-prefecture view (dark theme);
// hover and selection have their own stronger rings
const GLOW_R = ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 8, 16, 12];
const glowOp = (T) => (T.ptCore ? ['interpolate', ['linear'], ['zoom'], 8, 0, 10.5, 0.08, 14, 0.14] : 0.45);
const ptStroke = (T) => (T.ptCore ? ['interpolate', ['linear'], ['zoom'], 7, 0.9, 12, 1.7] : 1.2);
const lmText = (T) => ({ 'text-color': T.base.label, 'text-halo-color': T.base.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.4 });
// name under the symbol: Japanese from `from`, with the English name on a second line from `en`
const lmLabel = (from, en) => ({
  'text-field': ['step', ['zoom'], '', from, ['coalesce', ['get', 'name_full'], ['get', 'name'], ''],
    en, ['case', ['has', 'name_en'], ['format', ['coalesce', ['get', 'name_full'], ['get', 'name'], ''], {}, '\n', {}, ['get', 'name_en'], { 'font-scale': 0.82 }], ['coalesce', ['get', 'name_full'], ['get', 'name'], '']]],
  'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 15, 12.5], 'text-anchor': 'top', 'text-max-width': 9, 'text-line-height': 1.25,
  'text-offset': ['case', isIconic, ['literal', [0, 0.35]], ['literal', [0, 1.05]]], 'text-optional': true, 'text-padding': 3,
});
function lmLayer(id, filter, T, { minzoom = 0, k = 1, overlap = false, label = null } = {}) {
  return {
    id, type: 'symbol', source: 'attractions', minzoom, filter,
    layout: {
      'icon-image': ['get', 'lm_icon'], 'icon-size': lmSize(k),
      'icon-anchor': ['case', isIconic, 'bottom', 'center'], 'icon-offset': ['case', isIconic, ['literal', [0, 9]], ['literal', [0, 0]]],   // an iconic building stands on its point
      'icon-padding': 1, 'symbol-sort-key': ['get', 'lm_rank'], 'symbol-z-order': 'source',
      'icon-allow-overlap': overlap, 'icon-ignore-placement': overlap,
      ...(label && !OFFLINE_PREVIEW ? lmLabel(...label) : {}),
    },
    paint: { 'icon-opacity': 1, ...(label && !OFFLINE_PREVIEW ? lmText(T) : {}) },
  };
}

export default function MapView({ theme = 'dark', active = true, focus = null, data, cats, types, query, densityMode, basemap, selected, onSelect, onHover, onGeo, geoOn = false, mapRef: externalRef, walkSet, maxWalk, busRun, busHighlight, onBusProgress, busCtl, route = null, origin = null, cinematic = false, coverage = null, pointsOn = true, padding = null, pickOff = false }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const marker = useRef(null);
  const callout = useRef(null);
  const latest = useRef({});
  latest.current = { onSelect, onHover, onGeo, cats, types, query, densityMode, active, theme, onBusProgress, cinematic, padding, pointsOn, pickOff };
  const introPending = useRef(false);
  useEffect(() => {
    if (active && introPending.current && mapRef.current) { introPending.current = false; mapRef.current.resize(); intro(mapRef.current); }
  }, [active]);

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current,
      style: styleFor(basemap, theme),
      bounds: [[134.85, 34.7], [136.06, 35.79]],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      maxPitch: 60,        // only the Cinematic view tilts the camera; people cannot tilt or rotate it by hand
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: prefersReducedMotion() ? 0 : 320,   // symbols fade in and out as zoom and collisions change
    });
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: innerWidth <= 760, customAttribution: DATA_ATTR }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    if (externalRef) externalRef.current = map;
    window.__kyotoMap = map; // used by the automated tests

    map.on('load', () => {
      // style.load can fire first and add the layers already (vector style)
      if (!map.getSource('attractions')) addDataLayers(map, data, latest.current.theme);
      if (latest.current.active) intro(map);
      else introPending.current = true;
    });
    map.on('style.load', () => {
      if (!map.getSource('attractions')) addDataLayers(map, data, latest.current.theme);
      applyFilters(map, latest.current);
    });

    const interactive = [...LM_PICK, ...TRANSIT_LAYERS, 'geo-pt'];
    // the hovered place gets its symbol, a little larger, on a soft ring; the filter only changes when the place does
    let hoverId = null;
    const setHoverId = (id, src) => {
      if (id === hoverId || !map.getLayer('lm-hover')) return;
      hoverId = id;
      const f = id && src === 'attractions' ? ['==', ['get', 'id'], id] : NONE;
      map.setFilter('lm-hover', f); map.setFilter('lm-hover-ring', f);
      if (map.getLayer('transport-hover')) map.setFilter('transport-hover', id && src === 'transport' ? ['==', ['get', 'id'], id] : NONE);
    };
    map.on('mousemove', (e) => {
      if (latest.current.pickOff) return;   // no hover cards over the 3D surface (it sets its own cursor)
      const f = map.getLayer('attractions-pt') ? map.queryRenderedFeatures(e.point, { layers: interactive.filter((l) => map.getLayer(l)) }) : [];
      map.getCanvas().style.cursor = f.length ? 'pointer' : '';
      setHoverId(f.length && (f[0].source === 'attractions' || f[0].source === 'transport') ? f[0].properties.id : null, f[0]?.source);
      latest.current.onHover(f.length ? { feature: f[0], x: e.point.x, y: e.point.y } : null);
    });
    map.on('mouseout', () => { setHoverId(null); latest.current.onHover(null); });
    map.on('click', (e) => {
      if (latest.current.pickOff) return;   // the 3D density surface handles clicks while it is on
      const pad = 4;
      const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      const a = map.queryRenderedFeatures(box, { layers: LM_PICK.filter((l) => map.getLayer(l)) });
      const s = a.length ? [] : map.queryRenderedFeatures(box, { layers: TRANSIT_LAYERS.filter((l) => map.getLayer(l)) });
      const f = a[0] || s[0];
      // a place name, mountain or river of the Kyoto City records: opens that record in the library
      const g = f || !map.getLayer('geo-pt') ? [] : map.queryRenderedFeatures(box, { layers: ['geo-pt'] });
      if (g.length) { latest.current.onGeo?.(g[0].properties.csv_id); return; }
      latest.current.onSelect(f ? { layer: a[0] ? 'attraction' : 'transport', id: f.properties.id } : null);
    });
    // Moving the map by hand ends any camera sequence and route drawing that is still running.
    const userMove = (e) => { if (e.originalEvent) camCtl.current.cancel?.(); };
    for (const ev of ['dragstart', 'wheel', 'touchstart', 'boxzoomstart']) map.on(ev, userMove);
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- point-to-point route: camera first, then the line grows from start to end ----------
  const camCtl = useRef({ token: 0, raf: 0, label: null, cancel: null });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const C = camCtl.current;
    const run = () => {
      cancelAnimationFrame(C.raf);
      const token = ++C.token;
      C.label?.remove(); C.label = null;
      const T = themeOf(latest.current.theme);
      const ends = [];
      if (origin) ends.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: route ? route.coords[0] : origin.coords } });
      if (route) ends.push({ type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: route.coords[route.coords.length - 1] } });
      map.getSource('route-ends')?.setData({ type: 'FeatureCollection', features: ends });
      map.getSource('route')?.setData(route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } } : EMPTY);
      map.getSource('route-head')?.setData(EMPTY);
      setRouteProgress(map, T, route ? 0 : 1);
      if (!route) { C.cancel = null; return; }
      const reduce = prefersReducedMotion();
      const cum = cumulative(route.coords);
      let drawing = false, finished = false;
      const finish = () => {
        if (finished || token !== C.token) return;
        finished = true;
        cancelAnimationFrame(C.raf);
        setRouteProgress(map, themeOf(latest.current.theme), 1);
        map.getSource('route-head')?.setData(EMPTY);
        C.label = routeLabel(map, route, cum);
        pulseEnds(map, reduce, () => token === C.token);
        C.cancel = null;
      };
      const draw = () => {
        if (token !== C.token || drawing) return;
        drawing = true;
        if (reduce) return finish();
        const dur = Math.max(2600, Math.min(6000, cum[cum.length - 1] * 1.4));   // calm pace: about 0.7 m of route per ms, within 2.6–6 s
        const t0 = performance.now();
        const frame = (now) => {
          if (token !== C.token) return;
          const k = Math.max(0, Math.min(1, (now - t0) / dur));
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in and out (cubic)
          setRouteProgress(map, themeOf(latest.current.theme), e);
          const [a] = cut(route.coords, cum, e);
          if (a) map.getSource('route-head')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: a[a.length - 1] } });
          if (k < 1) C.raf = requestAnimationFrame(frame); else finish();
        };
        C.raf = requestAnimationFrame(frame);
      };
      // a hand move during the camera sequence or the drawing: stop the camera, show the whole route at once
      C.cancel = () => { if (token !== C.token) return; map.stop(); finish(); };
      routeCamera(map, route.coords, latest.current.cinematic, reduce, latest.current.padding, () => token === C.token).then(draw);
    };
    if (map.getSource('route')) run(); else map.once('idle', run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.key, origin?.key]);
  useEffect(() => () => { camCtl.current.token++; cancelAnimationFrame(camCtl.current.raf); camCtl.current.label?.remove(); }, []);

  // ---------- "Show coverage": municipal boundaries drawn along their real outlines ----------
  const covCtl = useRef({ raf: 0, token: 0 });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const K = covCtl.current;
    const run = () => {
      cancelAnimationFrame(K.raf);
      const token = ++K.token;
      const on = !!coverage?.on;
      for (const l of COV_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
      if (!on || !map.getLayer('cov-line')) return;
      const reduce = prefersReducedMotion();
      const start = () => {
        if (token !== K.token) return;
        if (reduce) { setCoverageProgress(map, themeOf(latest.current.theme), 1); return; }
        const t0 = performance.now(), dur = 3400;
        const frame = (now) => {
          if (token !== K.token) return;
          const k = Math.max(0, Math.min(1, (now - t0) / dur));
          setCoverageProgress(map, themeOf(latest.current.theme), 1 - Math.pow(1 - k, 2.2));
          if (k < 1) K.raf = requestAnimationFrame(frame);
        };
        K.raf = requestAnimationFrame(frame);
      };
      setCoverageProgress(map, themeOf(latest.current.theme), 0);
      // bring the whole covered area into view first when it is not already
      const bb = coverage.bbox;
      const v = map.getBounds();
      const inView = bb && v.getWest() <= bb[0] && v.getSouth() <= bb[1] && v.getEast() >= bb[2] && v.getNorth() >= bb[3];
      if (bb && !inView) {
        map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30, pitch: 0, bearing: 0, duration: reduce ? 0 : 1600, essential: true });
        if (reduce) start(); else map.once('moveend', start);
      } else start();
    };
    if (map.getLayer('cov-line')) run(); else map.once('idle', run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage?.on, coverage?.token]);

  // attraction and stop points on or off; the density layers do not depend on them
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('attractions-pt')) return;
    for (const l of ['attractions-glow', 'attractions-pt', ...LM_BASE, 'lm-search']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', pointsOn ? 'visible' : 'none');
  }, [pointsOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getSource('attractions') && map.getLayer('attractions-pt')) applyFilters(map, { cats, types, query, densityMode, theme });
  }, [cats, types, query, densityMode]);

  // the "Places and landscape" layer (Kyoto City records placed by two sources), off by default
  useEffect(() => {
    const map = mapRef.current;
    for (const id of ['geo-line', 'geo-ring', 'geo-pt']) if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', geoOn ? 'visible' : 'none');
  }, [geoOn]);

  // Linked hover from the earlier dashboard: hovering a category or transit type in the filter
  // list lifts those points and dims the rest.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('attractions-pt')) return;
    const T = { duration: 300, delay: 0 };
    const aMatch = focus?.kind === 'cat' ? ['==', ['get', 'category'], focus.key] : null;
    const tMatch = focus?.kind === 'type' ? ['==', ['get', 'transport_type'], focus.key] : null;
    const aOp = !focus ? 1 : aMatch ? ['case', aMatch, 1, 0.12] : 0.15;
    const tOp = !focus ? ['match', ['get', 'transport_type'], 'bus', 0.75, 1] : tMatch ? ['case', tMatch, 1, 0.08] : 0.1;
    const grow = (base, m) => (m ? ['case', m, ['*', 1.6, base], base] : base);
    for (const [l, p] of [['attractions-pt', 'circle-opacity'], ['attractions-pt', 'circle-stroke-opacity'], ['attractions-glow', 'circle-opacity'], ['transport-pt', 'circle-opacity']]) {
      map.setPaintProperty(l, `${p}-transition`, T);
    }
    map.setPaintProperty('attractions-pt', 'circle-opacity', aOp);
    map.setPaintProperty('attractions-pt', 'circle-stroke-opacity', aOp);
    map.setPaintProperty('attractions-glow', 'circle-opacity', !focus ? glowOp(themeOf(latest.current.theme)) : aMatch ? ['case', aMatch, 0.9, 0.05] : 0.05);
    map.setPaintProperty('transport-pt', 'circle-opacity', tOp);
    const iOp = !focus ? 1 : tMatch ? ['case', tMatch, 1, 0.1] : 0.12;
    for (const l of ['transport-sym-rail', 'transport-sym-bus']) {
      map.setPaintProperty(l, 'icon-opacity-transition', T);
      map.setPaintProperty(l, 'icon-opacity', iOp);
    }
    for (const l of [...LM_BASE, 'lm-search']) {
      if (!map.getLayer(l)) continue;
      map.setPaintProperty(l, 'icon-opacity-transition', T);
      map.setPaintProperty(l, 'icon-opacity', aOp);
      if (!OFFLINE_PREVIEW) map.setPaintProperty(l, 'text-opacity', aOp);
    }
    map.setPaintProperty('attractions-pt', 'circle-radius', grow(PT_RADIUS, aMatch));
    map.setPaintProperty('transport-pt', 'circle-radius', grow(['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'transport_type'], 'bus', 0.9, 2.4], 12, ['match', ['get', 'transport_type'], 'bus', 2.6, 4.5], 16, ['match', ['get', 'transport_type'], 'bus', 5, 7]], tMatch));
  }, [focus]);

  // Swap the basemap or the colour theme without rebuilding the data sources: the camera, filters,
  // selection, walking routes and density layer all stay as they are; only colours change.
  const firstBase = useRef(true);
  const shownBase = useRef(basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (firstBase.current) { firstBase.current = false; return; }
    if (!map) return;
    const apply = () => {
      if (!map.getLayer('bg')) return;
      if (OFFLINE_PREVIEW) map.setPaintProperty('bg', 'background-color', themeOf(theme).offlineBg);
      else if (shownBase.current === basemap && map.getLayer(baseParts(basemap, theme).layers[0].id)) {
        // Theme only: the same layers in new colours. The tile sources stay, so nothing is
        // downloaded, parsed or placed again (that used to cost a few hundred milliseconds).
        const p = baseParts(basemap, theme);
        const other = baseParts(basemap, theme === 'light' ? 'dark' : 'light');
        p.layers.forEach((l, i) => {
          const keys = new Set([...Object.keys(l.paint || {}), ...Object.keys(other.layers[i]?.paint || {})]);
          for (const k of keys) if (k !== 'line-dasharray') map.setPaintProperty(l.id, k, l.paint?.[k]); // undefined = back to the default
        });
        map.setPaintProperty('bg', 'background-color', p.bg);
      } else {
        shownBase.current = basemap;
        const layers = map.getStyle().layers;
        const before = layers.find((l) => l.id !== 'bg' && !l.id.startsWith('bm-'))?.id;
        layers.filter((l) => l.id.startsWith('bm-')).forEach((l) => map.removeLayer(l.id));
        for (const s of ['base', 'omt']) if (map.getSource(s)) map.removeSource(s);
        const p = baseParts(basemap, theme);
        for (const [k, v] of Object.entries(p.sources)) map.addSource(k, v);
        for (const l of p.layers) map.addLayer(l, before);
        map.setPaintProperty('bg', 'background-color', p.bg);
      }
      if (map.getLayer('attractions-pt')) {
        restyleData(map, theme);
        applyFilters(map, { ...latest.current, theme });
      }
    };
    if (map.isStyleLoaded() || map.getLayer('bg')) apply();
    else map.once('style.load', apply);
  }, [basemap, theme]);

  // Walking reach: routes grow out from the attractions at one constant speed (metres per second),
  // stopping at the chosen max distance. A stop lights up the moment its route reaches it.
  // Only real network routes are drawn; nothing is extended or invented.
  const stopMarkers = useRef(new Map());
  const reach = useRef({ key: null, r: 0, raf: 0, items: [] });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const run = () => {
      const st = reach.current;
      const key = walkSet?.key || null;
      let delay = 0;
      if (key !== st.key) {
        delay = prefersReducedMotion() ? 0 : 1000; // let the camera settle before the routes start to grow
        st.key = key;
        st.r = 0;
        st.items = (walkSet?.items || []).map((it) => ({ ...it, cum: cumulative(it.feature.geometry.coordinates) }));
        // Many routes at once (prefecture view): no growing animation and no DOM labels; reached
        // stops are drawn as rings on a map layer instead. The routes themselves are the same.
        st.bulk = walkSet?.mode === 'all' && st.items.length > BULK_ROUTES;
        stopMarkers.current.forEach((m) => m.marker.remove());
        stopMarkers.current = new Map();
        st.stops = new Map();
        for (const it of st.items) {
          const id = it.stop.id;
          const d = it.feature.properties.distance_m;
          const s = st.stops.get(id);
          if (!s || d < s.best) st.stops.set(id, { coords: it.stop.coords, type: it.stop.type, best: d });
          if (st.bulk) continue;
          if (stopMarkers.current.has(id)) { stopMarkers.current.get(id).items.push(it); continue; }
          const el = document.createElement('div');
          el.className = `stop-tag ${it.stop.type}${walkSet.mode === 'all' ? ' compact' : ''}`;
          const ring = document.createElement('i');
          const card = document.createElement('div');
          const kind = document.createElement('em');
          kind.textContent = it.stop.type === 'rail' ? 'Rail station' : 'Bus stop';
          const nm = document.createElement('b');
          nm.lang = 'ja';
          nm.textContent = it.stop.name;
          const meta = document.createElement('span');
          card.append(kind, nm, meta);
          el.append(ring, card);
          el.addEventListener('click', (e) => { e.stopPropagation(); latest.current.onSelect({ layer: 'transport', id }); });
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(it.stop.coords).addTo(map);
          stopMarkers.current.set(id, { marker, el, meta, items: [it] });
        }
        if (st.items.length) {
          const pts = walkSet.mode === 'one' && selected ? [selected.coords, ...st.items.map((x) => x.stop.coords)] : st.items.flatMap((x) => [x.feature.geometry.coordinates[0], x.stop.coords]);
          const b = pts.reduce((bb, [x, y]) => [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)], [180, 90, -180, -90]);
          map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 110, bottom: 80, left: 80, right: 220 }, maxZoom: 16.5, duration: prefersReducedMotion() ? 0 : 1100 });
        }
      }
      paintReach(map, st, maxWalk, walkSet?.mode, stopMarkers.current, delay);
    };
    if (map.getSource('walk')) run();
    else map.once('idle', run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkSet, maxWalk]);

  // Bus route reveal. The whole line is drawn thin and pale first; then a bright line grows along the
  // supplied road geometry from the starting stop to the terminal. When the head reaches a stop, that
  // stop's marker pops (70% -> 115% -> 100%) and shows its name. Passed stops stay lit, the rest stay quiet.
  // This is a presentation of the route, not a live bus position or a real travel speed.
  const bus = useRef({ raf: 0, markers: [] });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const B = bus.current;
    const clear = () => {
      cancelAnimationFrame(B.raf);
      B.markers.forEach((m) => m.marker.remove());
      B.markers = [];
      map.getSource('bus-full')?.setData(EMPTY);
      map.getSource('bus-lit')?.setData(EMPTY);
    };
    const start = () => {
      clear();
      if (!busRun) { if (busCtl) busCtl.current = null; return; }
      const { line, stops, startIdx } = busRun;
      const cum = cumulative(line);
      const p0 = stops[startIdx].p;
      map.getSource('bus-full').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
      B.markers = stops.map((s, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'bus-stop' + (i < startIdx ? ' before' : '') + (i === stops.length - 1 ? ' terminal' : '') + (s.review ? ' review' : '');
        el.setAttribute('aria-label', `Stop ${s.seq}: ${s.ja}${s.en ? ` (${s.en})` : ''}`);
        const dot = document.createElement('i');
        const tag = document.createElement('span');
        const nm = document.createElement('b');
        nm.lang = 'ja';
        nm.textContent = s.ja;
        const sub = document.createElement('small');
        sub.textContent = `${s.en ? s.en + ' · ' : ''}stop ${s.seq} of ${stops.length}`;
        tag.append(nm, sub);
        el.append(dot, tag);
        el.addEventListener('click', (e) => { e.stopPropagation(); B.markers.forEach((m) => m.el !== el && m.el.classList.remove('pinned')); el.classList.toggle('pinned'); });
        return { el, s, i, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(s.xy).addTo(map) };
      });
      // frame the part that will be played
      const [, rest] = cut(line, cum, p0);
      const pts = [...(rest || line), ...stops.slice(startIdx).map((s) => s.xy)];
      const bb = pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
      const narrow = innerWidth <= 760;
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: narrow ? { top: 70, bottom: 150, left: 30, right: 30 } : { top: 80, bottom: 130, left: 70, right: 70 }, maxZoom: 15.5, duration: prefersReducedMotion() ? 0 : 1200 });
      let reached = startIdx - 1;
      const paint = (frac, final) => {
        const [upto] = cut(line, cum, frac);
        const [, lit] = upto ? cut(upto, cumulative(upto), p0 / Math.max(frac, 1e-9)) : [null, null];
        map.getSource('bus-lit')?.setData(lit && lit.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lit } } : EMPTY);
        let changed = false;
        for (const m of B.markers) {
          if (m.i < startIdx || m.i <= reached || m.s.p > frac + 1e-9) continue;
          reached = m.i;
          changed = true;
          B.markers.forEach((o) => o.el.classList.remove('now'));
          m.el.classList.add('passed', 'now');
          if (!final) { m.el.classList.remove('pop'); void m.el.offsetWidth; m.el.classList.add('pop'); }
        }
        if (changed || final) latest.current.onBusProgress?.({ idx: reached, done: !!final });
      };
      const finish = () => { cancelAnimationFrame(B.raf); paint(1, true); };
      if (busCtl) busCtl.current = { skip: finish };
      latest.current.onBusProgress?.({ idx: startIdx - 1, done: false });
      if (prefersReducedMotion()) { finish(); return; }
      const remain = (1 - p0) * cum[cum.length - 1];
      const dur = Math.max(5000, Math.min(22000, remain / 0.9)); // about 900 m of route per second, within 5-22 s
      const t0 = performance.now() + 1300;                        // let the camera settle first
      const frame = (now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / dur));
        if (k >= 1) { finish(); return; }
        if (now >= t0) paint(p0 + (1 - p0) * k, false);
        B.raf = requestAnimationFrame(frame);
      };
      paint(p0, false);
      B.raf = requestAnimationFrame(frame);
    };
    if (map.getSource('bus-full')) start();
    else map.once('idle', start);
    return () => { cancelAnimationFrame(B.raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busRun]);
  useEffect(() => () => { bus.current.markers.forEach((m) => m.marker.remove()); }, []);
  // routes without a usable line: only their associated stop points are highlighted
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => { if (map.getLayer('bus-hl')) map.setFilter('bus-hl', ['in', ['get', 'id'], ['literal', busHighlight || []]]); };
    if (map.getLayer('bus-hl')) apply(); else map.once('idle', apply);
  }, [busHighlight]);

  // Selection marker and camera move.
  const lastSel = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    marker.current?.remove();
    marker.current = null;
    callout.current?.remove();
    callout.current = null;
    // the selected place keeps its symbol at any zoom, enlarged, on a soft vermilion glow
    const selF = selected?.layer === 'attraction' ? ['==', ['get', 'id'], selected.id] : NONE;
    const setSel = () => { for (const l of ['lm-sel', 'lm-sel-glow']) if (map.getLayer(l)) map.setFilter(l, selF); };
    if (map.getLayer('lm-sel')) setSel(); else map.once('idle', setSel);
    if (!selected) { lastSel.current = null; return; }
    const node = document.createElement('div');
    node.className = 'sel-marker' + (selected.layer === 'transport' ? ' is-stop' : '');
    node.innerHTML = '<i></i><i></i><b></b>';
    marker.current = new maplibregl.Marker({ element: node }).setLngLat(selected.coords).addTo(map);
    if (selected.label) {
      const c = document.createElement('div');
      c.className = 'sel-callout';
      const t = document.createElement('div');
      t.className = 'sel-card';
      const sw = document.createElement('i');
      sw.style.background = selected.color || '#7fb3ff';
      const nm = document.createElement('b');
      const m = /^(.*?) \(([^()]*)\)$/.exec(selected.label || '');
      if (selected.en && m) {
        nm.append(m[1]);
        const e = document.createElement('span');
        e.className = 'en';
        e.lang = 'en';
        e.textContent = ` (${m[2]})`;
        nm.append(e);
      } else nm.textContent = selected.label;
      nm.lang = 'ja';
      const sub = document.createElement('span');
      sub.textContent = selected.sub || '';
      t.append(sw, nm, sub);
      if (selected.photo) {
        t.classList.add('has-photo');
        const fig = document.createElement('div');
        fig.className = 'sel-photo';
        const img = document.createElement('img');
        img.alt = '';
        img.src = selected.photo.src;
        img.addEventListener('load', () => fig.classList.add('in'));
        const cap = document.createElement('small');
        cap.textContent = (selected.photo.related ? `Related place: ${selected.photo.related} · ` : '') + selected.photo.credit;
        fig.append(img, cap);
        t.prepend(fig);
      }
      c.append(document.createElement('s'), t);
      callout.current = new maplibregl.Marker({ element: c, anchor: 'bottom-left', offset: [6, -6] }).setLngLat(selected.coords).addTo(map);
    }
    // the same place shown again (theme, panel, route state): no new camera move
    const isNew = lastSel.current !== selected.id;
    lastSel.current = selected.id;
    if (!isNew) return;
    const z = Math.max(map.getZoom(), 13.5);
    if (selected.fly !== false && map.getPitch() > 0) { map.flyTo({ center: selected.coords, zoom: z, pitch: 0, bearing: 0, duration: prefersReducedMotion() ? 0 : 1100, essential: true }); return; }
    if (selected.fly !== false) map.flyTo({ center: selected.coords, zoom: z, duration: prefersReducedMotion() ? 0 : 1100, essential: true, offset: [0, innerWidth <= 760 ? -map.getContainer().clientHeight * 0.27 : 0] }); // on phones the details sheet covers the lower map
  }, [selected]);

  return <div ref={el} className="map" role="region" aria-label="Map of Kyoto Prefecture" />;
}

const WALK_TYPES = ['bus', 'rail'];
const EMPTY = { type: 'FeatureCollection', features: [] };
// Moving dash pattern: stepping through these looks like light travelling along the path.
const DASH_STEPS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

// Cumulative metres along a lon/lat line (equirectangular approximation, fine at route scale).
function cumulative(coords) {
  const out = [0];
  for (let k = 1; k < coords.length; k++) {
    const [x1, y1] = coords[k - 1], [x2, y2] = coords[k];
    const kx = 111320 * Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    out.push(out[k - 1] + Math.hypot((x2 - x1) * kx, (y2 - y1) * 110574));
  }
  return out;
}
// Cut a line at a fraction of its length; returns [reached part, remaining part].
function cut(coords, cum, frac) {
  const total = cum[cum.length - 1] || 1;
  const d = Math.max(0, Math.min(1, frac)) * total;
  if (d <= 0) return [null, coords];
  if (d >= total) return [coords, null];
  let k = 1;
  while (cum[k] < d) k++;
  const t = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
  const [x1, y1] = coords[k - 1], [x2, y2] = coords[k];
  const p = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  return [[...coords.slice(0, k), p], [p, ...coords.slice(k)]];
}

const SPEED = 380; // metres of route revealed per second
const BULK_ROUTES = 150; // above this many routes the map shows them without the growing animation
let flowAnim = 0;
function paintReach(map, st, maxWalk, mode, markers, delay = 0) {
  cancelAnimationFrame(st.raf);
  cancelAnimationFrame(flowAnim);
  const reduce = prefersReducedMotion();
  const from = st.r, to = st.items.length ? maxWalk : 0;
  const dur = reduce || st.bulk ? 0 : Math.max(250, (Math.abs(to - from) / SPEED) * 1000);
  const t0 = performance.now();
  const frame = (now) => {
    const k = dur ? Math.max(0, Math.min(1, (now - t0 - delay) / dur)) : 1;
    const r = from + (to - from) * k;
    st.r = r;
    const lit = [], rest = [];
    for (const it of st.items) {
      const p = it.feature.properties;
      const [a, b] = cut(it.feature.geometry.coordinates, it.cum, r / p.distance_m);
      if (a) lit.push({ type: 'Feature', properties: { stop_type: p.stop_type }, geometry: { type: 'LineString', coordinates: a } });
      if (b) rest.push({ type: 'Feature', properties: { stop_type: p.stop_type }, geometry: { type: 'LineString', coordinates: b } });
    }
    map.getSource('walk')?.setData({ type: 'FeatureCollection', features: lit });
    map.getSource('walk-rest')?.setData({ type: 'FeatureCollection', features: rest });
    map.getSource('walk-stops')?.setData({ type: 'FeatureCollection', features: st.bulk ? [...st.stops.values()].map((s) => ({ type: 'Feature', properties: { stop_type: s.type, on: r >= s.best - 0.5 }, geometry: { type: 'Point', coordinates: s.coords } })) : [] });
    markers.forEach((m) => {
      const best = Math.min(...m.items.map((x) => x.feature.properties.distance_m));
      const on = r >= best - 0.5;
      m.el.classList.toggle('on', on);
      m.el.classList.toggle('far', !on && k >= 1);
      const n = m.items.length;
      m.meta.textContent = mode === 'all'
        ? `${n} attraction${n > 1 ? 's' : ''} · nearest ${Math.round(best).toLocaleString('en-US')} m`
        : on ? `${m.items[0].stop.id} · ${Math.round(best).toLocaleString('en-US')} m walk · ≈${m.items[0].feature.properties.duration_min} min`
          : `${m.items[0].stop.id} · ${Math.round(best).toLocaleString('en-US')} m — beyond ${maxWalk} m`;
    });
    if (k < 1) st.raf = requestAnimationFrame(frame);
    else startFlow(map, reduce || !lit.length);
  };
  st.raf = requestAnimationFrame(frame);
}
function startFlow(map, off) {
  let last = -1;
  for (const t of WALK_TYPES) if (map.getLayer(`walk-flow-${t}`)) map.setLayoutProperty(`walk-flow-${t}`, 'visibility', off ? 'none' : 'visible');
  if (off) return;
  const f = (now) => {
    const step = Math.floor(now / 70) % DASH_STEPS.length;
    if (step !== last) {
      for (const t of WALK_TYPES) map.setPaintProperty(`walk-flow-${t}`, 'line-dasharray', DASH_STEPS[step]);
      last = step;
    }
    flowAnim = requestAnimationFrame(f);
  };
  flowAnim = requestAnimationFrame(f);
}

// Opening sequence: outline appears, then stops, then attractions; afterwards the outline glow breathes slowly.
function intro(map) {
  const reduce = prefersReducedMotion();
  const set = (layer, prop, from, to, duration, delay) => {
    if (!map.getLayer(layer)) return;
    if (reduce) { map.setPaintProperty(layer, prop, to); return; }
    map.setPaintProperty(layer, `${prop}-transition`, { duration: 0, delay: 0 });
    map.setPaintProperty(layer, prop, from);
    requestAnimationFrame(() => {
      map.setPaintProperty(layer, `${prop}-transition`, { duration, delay });
      map.setPaintProperty(layer, prop, to);
    });
  };
  if (!reduce) reveal(map);
  set('outline-line', 'line-opacity', 0, 1, 900, 0);
  const OG = themeOf(document.documentElement.dataset.theme).outline;
  set('outline-glow', 'line-opacity', 0, OG.glowOp, 1400, 200);
  set('outline-fill', 'fill-opacity', 0, 0.1, 1200, 300);
  set('muni-line', 'line-opacity', 0, 0.35, 900, 500);
  set('transport-pt', 'circle-opacity', 0, ['match', ['get', 'transport_type'], 'bus', 0.75, 1], 900, 700);
  set('transport-sym-rail', 'icon-opacity', 0, 1, 900, 800);
  set('transport-sym-bus', 'icon-opacity', 0, 1, 900, 900);
  set('attractions-glow', 'circle-opacity', 0, glowOp(themeOf(document.documentElement.dataset.theme)), 900, 1100);
  set('attractions-pt', 'circle-opacity', 0, 1, 700, 1100);
  set('attractions-pt', 'circle-stroke-opacity', 0, 1, 700, 1100);
  for (const l of LM_BASE) set(l, 'icon-opacity', 0, 1, 800, 1300);
  if (!reduce) {
    const c = map.getCenter(), z = map.getZoom();
    map.jumpTo({ center: [c.lng - 0.08, c.lat + 0.05], zoom: z - 0.45 });
    map.easeTo({ center: c, zoom: z, duration: 2200, easing: (t) => 1 - Math.pow(1 - t, 3), essential: true });
    // slow breathing of the prefecture glow after the intro
    setTimeout(() => {
      if (!map.getLayer('outline-glow')) return;
      map.setPaintProperty('outline-glow', 'line-opacity-transition', { duration: 0, delay: 0 });
      const breathe = () => {
        if (!map.getLayer('outline-glow')) return;
        const t = performance.now() / 1000;
        const o = themeOf(document.documentElement.dataset.theme).outline;   // the study area keeps its slow breathing, gentler in the dark theme
        map.setPaintProperty('outline-glow', 'line-opacity', o.glowOp + o.breathe * Math.sin(t * 1.2));
        setTimeout(breathe, 80);
      };
      breathe();
    }, 1800);
  }
}

const RAIL_F = ['!=', ['get', 'transport_type'], 'bus'];
const BUS_F = ['==', ['get', 'transport_type'], 'bus'];
// Opening reveal: the map grows out of the Kyoto City centre as a widening circle until it fills
// the frame with a soft edge. Only a CSS mask on the canvas, data unchanged.
const REVEAL_FROM = [135.7595, 35.0107]; // Karasuma-Oike, centre of Kyoto City
function reveal(map) {
  const box = map.getContainer();
  const canvas = map.getCanvas();
  const { width: W, height: H } = box.getBoundingClientRect();
  const c = map.project(REVEAL_FROM);
  const x = Math.max(0, Math.min(W, c.x)), y = Math.max(0, Math.min(H, c.y));
  const far = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y)) + 140;
  const dur = 2600, t0 = performance.now();
  box.classList.add('revealing');
  canvas.style.setProperty('--rx', `${x}px`);
  canvas.style.setProperty('--ry', `${y}px`);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const r = 20 + (far - 20) * ease(t);
    canvas.style.setProperty('--rr', `${r}px`);
    if (t < 1) requestAnimationFrame(frame);
    else box.classList.remove('revealing');
  };
  requestAnimationFrame(frame);
}

const catColorExpr = (T) => ['match', ['get', 'category'], ...ATTRACTION_CATS.flatMap((c) => [c.key, T.cat[c.key]]), '#888'];
const transitColorExpr = (T) => ['match', ['get', 'transport_type'], ...TRANSPORT_TYPES.flatMap((t) => [t.key, T.transit[t.key]]), '#888'];
const heatExpr = (T) => ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, T.heat[0], 0.45, T.heat[1], 0.7, T.heat[2], 1, T.heat[3]];
const walkRestExpr = (T) => ['match', ['get', 'stop_type'], 'rail', T.walk.rail, T.walk.bus];
// Recolour the project layers for a theme. Sources, filters and visibility are left alone.
function restyleData(map, theme) {
  const T = themeOf(theme);
  const set = (l, p, v) => { if (map.getLayer(l)) map.setPaintProperty(l, p, v); };
  set('muni-line', 'line-color', T.muni);
  set('outline-fill', 'fill-color', T.outline.fill);
  set('outline-glow', 'line-color', T.outline.glow);
  set('outline-line', 'line-color', T.outline.line);
  set('pilot-line', 'line-color', T.pilot);
  set('walk-rest', 'line-color', walkRestExpr(T));
  for (const t of WALK_TYPES) { set(`walk-glow-${t}`, 'line-color', T.walk[t]); set(`walk-line-${t}`, 'line-color', T.walk[t]); }
  set('walk-stops', 'circle-stroke-color', walkRestExpr(T));
  set('bus-full', 'line-color', T.busPale);
  set('bus-glow', 'line-color', T.busLine);
  set('bus-lit', 'line-color', T.busLine);
  set('bus-hl', 'circle-stroke-color', T.busLine);
  set('heat', 'heatmap-color', heatExpr(T));
  set('transport-pt', 'circle-color', transitColorExpr(T));
  set('transport-pt', 'circle-stroke-color', T.stroke);
  set('attractions-glow', 'circle-color', catColorExpr(T));
  set('attractions-glow', 'circle-opacity', glowOp(T));
  set('attractions-glow', 'circle-radius', T.ptCore ? GLOW_R : ['interpolate', ['linear'], ['zoom'], 7, 7, 12, 12, 16, 16]);
  set('outline-glow', 'line-width', T.outline.glowW);
  set('outline-glow', 'line-blur', T.outline.glowW * 0.85);
  set('attractions-pt', 'circle-color', T.ptCore || catColorExpr(T));
  set('attractions-pt', 'circle-stroke-width', ptStroke(T));
  set('transport-hover', 'circle-stroke-color', transitColorExpr(T));
  addTransitIcons(map, theme);
  set('cov-fill', 'fill-color', T.coverage.fill);
  set('route-ends', 'circle-stroke-color', ['match', ['get', 'kind'], 'start', T.route.start, T.route.end]);
  set('route-head', 'circle-color', T.route.core);
  setRouteProgress(map, T, routeP);
  setCoverageProgress(map, T, covP);
  const geoCol = ['match', ['get', 'kind'], ['river', 'pond', 'spring or well', 'waterfall', 'river basin', 'gorge'], T.geo.water, ['area', 'street'], T.geo.area, T.geo.land];
  set('geo-ring', 'circle-stroke-color', geoCol);
  set('geo-line', 'line-color', geoCol);
  set('geo-pt', 'circle-color', geoCol);
  set('attractions-pt', 'circle-stroke-color', T.ptCore ? catColorExpr(T) : T.stroke);
  // landmark symbols: the same images repainted for the theme (no layer is rebuilt)
  addLandmarkImages(map, theme, T.cat);
  if (!OFFLINE_PREVIEW) for (const l of [...LM_BASE, 'lm-search']) for (const [k, v] of Object.entries(lmText(T))) set(l, k, v);
  for (const l of ['lm-sel-glow', 'lm-hover-ring']) set(l, 'circle-color', T.landmark);
}

function addDataLayers(map, data, theme) {
  const T = themeOf(theme);
  if (data.municipalities) {
    map.addSource('muni', { type: 'geojson', data: data.municipalities });
    map.addLayer({ id: 'muni-line', type: 'line', source: 'muni', paint: { 'line-color': T.muni, 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.2], 'line-dasharray': [2, 2] } });
  }
  if (data.outline) {
    map.addSource('outline', { type: 'geojson', data: data.outline });
    map.addLayer({ id: 'outline-fill', type: 'fill', source: 'outline', paint: { 'fill-color': T.outline.fill, 'fill-opacity': 0.1 } }, 'muni-line');
    map.addLayer({ id: 'outline-glow', type: 'line', source: 'outline', paint: { 'line-color': T.outline.glow, 'line-width': T.outline.glowW, 'line-blur': T.outline.glowW * 0.85, 'line-opacity': T.outline.glowOp } });
    map.addLayer({ id: 'outline-line', type: 'line', source: 'outline', paint: { 'line-color': T.outline.line, 'line-width': 1.8 } });
  }
  if (data.kde) {
    map.addSource('kde', { type: 'geojson', data: data.kde });
    map.addLayer({ id: 'kde-fill', type: 'fill', source: 'kde', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0, 'fill-opacity-transition': { duration: 700, delay: 0 }, 'fill-outline-color': 'rgba(0,0,0,0)' } });
  }
  if (data.walking?.pilot?.bbox) {
    const [x0, y0, x1, y1] = data.walking.pilot.bbox;
    map.addSource('pilot', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } } });
    map.addLayer({ id: 'pilot-line', type: 'line', source: 'pilot', paint: { 'line-color': T.pilot, 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } });
  }
  map.addSource('walk', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('walk-rest', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'walk-rest', type: 'line', source: 'walk-rest', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': walkRestExpr(T), 'line-width': 2, 'line-opacity': 0.28, 'line-dasharray': [1, 2] } });
  for (const t of WALK_TYPES) {
    const col = T.walk[t];
    map.addLayer({ id: `walk-glow-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 11, 'line-blur': 7, 'line-opacity': 0.45 } });
    map.addLayer({ id: `walk-line-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 3.4, 'line-color': col } });
    map.addLayer({ id: `walk-flow-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': DASH_STEPS[0] } });
  }
  map.addSource('walk-stops', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'walk-stops', type: 'circle', source: 'walk-stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 7], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': ['case', ['get', 'on'], 2, 1], 'circle-stroke-color': walkRestExpr(T), 'circle-stroke-opacity': ['case', ['get', 'on'], 1, 0.3] } });
  map.addSource('bus-full', { type: 'geojson', data: EMPTY });
  map.addSource('bus-lit', { type: 'geojson', data: EMPTY });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'bus-full', type: 'line', source: 'bus-full', layout: round, paint: { 'line-color': T.busPale, 'line-width': 2, 'line-opacity': 0.4 } });
  map.addLayer({ id: 'bus-glow', type: 'line', source: 'bus-lit', layout: round, paint: { 'line-color': T.busLine, 'line-width': 12, 'line-blur': 8, 'line-opacity': 0.4 } });
  map.addLayer({ id: 'bus-lit', type: 'line', source: 'bus-lit', layout: round, paint: { 'line-color': T.busLine, 'line-width': 4 } });
  map.addSource('attractions', { type: 'geojson', data: data.attractions });
  map.addSource('transport', { type: 'geojson', data: data.transport });
  // place names, mountains, rivers and springs from the Kyoto City records: a ring with a dot, under the
  // attractions, coloured by kind (land, water, area); hidden until switched on
  map.addSource('geography', { type: 'geojson', data: data.geography || EMPTY });
  const geoCol = ['match', ['get', 'kind'], ['river', 'pond', 'spring or well', 'waterfall', 'river basin', 'gorge'], T.geo.water, ['area', 'street'], T.geo.area, T.geo.land];
  const isPt = ['==', ['geometry-type'], 'Point'];
  // rivers and streets that OSM maps as lines are drawn as lines (the matched way), with their label point on it
  map.addLayer({ id: 'geo-line', type: 'line', source: 'geography', filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': geoCol, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 4], 'line-opacity': 0.75 } });
  map.addLayer({ id: 'geo-ring', type: 'circle', source: 'geography', filter: isPt, layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 12], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': geoCol, 'circle-stroke-width': 1.6, 'circle-stroke-opacity': 0.85 } });
  map.addLayer({ id: 'geo-pt', type: 'circle', source: 'geography', filter: isPt, layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 3.5], 'circle-color': geoCol } });
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'attractions', layout: { visibility: 'none' },
    paint: {
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 10, 11, 22, 14, 40],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 13, 1.6],
      'heatmap-opacity': 0.75,
      'heatmap-color': heatExpr(T),
    },
  });
  map.addLayer({
    id: 'transport-pt', type: 'circle', source: 'transport',
    paint: {
      'circle-color': transitColorExpr(T),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'transport_type'], 'bus', 0.9, 2.4], 12, ['match', ['get', 'transport_type'], 'bus', 2.6, 4.5], 16, ['match', ['get', 'transport_type'], 'bus', 5, 7]],
      'circle-opacity': ['match', ['get', 'transport_type'], 'bus', 0.75, 1],
      'circle-stroke-color': T.stroke,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 11, ['match', ['get', 'transport_type'], 'bus', 0.5, 1.2]],
    },
  });
  map.addLayer({ id: 'bus-hl', type: 'circle', source: 'transport', filter: ['in', ['get', 'id'], ['literal', []]],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 6, 16, 9], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': T.busLine, 'circle-stroke-width': 2 } });
  // Stations and stops as pictograms once zoomed in (rail from z9, bus from z13); below that, and where
  // icons would overlap, the small dots above still mark every record.
  addTransitIcons(map, theme);
  const iconSize = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 9, a, 13, b, 17, c];
  map.addLayer({
    id: 'transport-sym-bus', type: 'symbol', source: 'transport', minzoom: 13, filter: BUS_F,
    layout: { 'icon-image': 'ic-bus', 'icon-size': iconSize(0.5, 0.6, 0.85), 'icon-padding': 2 },
  });
  map.addLayer({
    id: 'transport-sym-rail', type: 'symbol', source: 'transport', minzoom: 9, filter: RAIL_F,
    layout: { 'icon-image': ['match', ['get', 'transport_type'], 'tram', 'ic-tram', 'ic-rail'], 'icon-size': iconSize(0.5, 0.75, 1), 'icon-padding': 1, 'symbol-sort-key': ['match', ['get', 'transport_type'], 'rail', 0, 1] },
  });
  map.addLayer({
    id: 'attractions-glow', type: 'circle', source: 'attractions',
    paint: { 'circle-color': catColorExpr(T), 'circle-radius': T.ptCore ? GLOW_R : ['interpolate', ['linear'], ['zoom'], 7, 7, 12, 12, 16, 16], 'circle-blur': 1, 'circle-opacity': glowOp(T) },
  });
  // dark theme: white core, category ring; light theme: filled category dot (unchanged)
  map.addLayer({
    id: 'attractions-pt', type: 'circle', source: 'attractions',
    paint: {
      'circle-color': T.ptCore || catColorExpr(T),
      'circle-radius': PT_RADIUS,
      'circle-stroke-color': T.ptCore ? catColorExpr(T) : T.stroke,
      'circle-stroke-width': ptStroke(T),
    },
  });
  // landmark symbols above the dots (see LM_LAYERS)
  addLandmarkImages(map, theme, T.cat);
  const glow = (id, r, op) => ({ id, type: 'circle', source: 'attractions', filter: NONE,
    paint: { 'circle-color': T.landmark, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, r * 0.7, 14, r], 'circle-blur': 0.85, 'circle-opacity': op, 'circle-translate': [0, -4] } });
  map.addLayer(lmLayer('lm-minor', TIER(3), T, { minzoom: 14.5, label: [15.6, 17] }));
  map.addLayer(lmLayer('lm-major', TIER(2), T, { minzoom: 10.5, label: [13.4, 15] }));
  map.addLayer(lmLayer('lm-iconic', isIconic, T, { label: [9.6, 12] }));
  map.addLayer(lmLayer('lm-search', NONE, T, { label: [11, 13.5] }));
  map.addLayer(glow('lm-hover-ring', 24, 0.34));
  map.addLayer(lmLayer('lm-hover', NONE, T, { k: 1.22, overlap: true }));
  map.addLayer(glow('lm-sel-glow', 34, 0.6));
  map.addLayer(lmLayer('lm-sel', NONE, T, { k: 1.34, overlap: true }));
  // hovered stop: a ring in its type colour
  map.addLayer({ id: 'transport-hover', type: 'circle', source: 'transport', filter: NONE,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 14, 13], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': transitColorExpr(T), 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.9 } }, 'transport-sym-bus');
  // municipal boundaries for "Show coverage" (hidden until asked): faint fill, white glow, thin white line.
  // One line per ring, so islands and holes are drawn separately and never joined.
  map.addSource('coverage', { type: 'geojson', data: data.coverageLines || EMPTY, lineMetrics: true });
  if (data.municipalities) map.addLayer({ id: 'cov-fill', type: 'fill', source: 'muni', layout: { visibility: 'none' }, paint: { 'fill-color': T.coverage.fill, 'fill-opacity': 0 } }, map.getLayer('outline-fill') ? 'outline-fill' : undefined);
  map.addLayer({ id: 'cov-glow', type: 'line', source: 'coverage', layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': 4, 'line-blur': 3.5, 'line-gradient': CLEAR } }, map.getLayer('outline-glow') ? 'outline-glow' : undefined);
  map.addLayer({ id: 'cov-line', type: 'line', source: 'coverage', layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.9, 12, 1.4], 'line-gradient': CLEAR } }, map.getLayer('outline-glow') ? 'outline-glow' : undefined);
  // the route sits above the points and symbols but under the map's own labels and controls
  map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('route-ends', { type: 'geojson', data: EMPTY });
  map.addSource('route-head', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: round, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 15, 12], 'line-blur': 6, 'line-gradient': CLEAR } }, 'lm-minor');
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: round, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 15, 3.2], 'line-gradient': CLEAR } }, 'lm-minor');
  map.addLayer({ id: 'route-head', type: 'circle', source: 'route-head', paint: { 'circle-radius': 4, 'circle-color': T.route.core, 'circle-blur': 0.4 } });
  map.addLayer({ id: 'route-pulse', type: 'circle', source: 'route-ends', paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 1.5, 'circle-stroke-color': ['match', ['get', 'kind'], 'start', T.route.start, T.route.end], 'circle-stroke-opacity': 0 } });
  map.addLayer({ id: 'route-ends', type: 'circle', source: 'route-ends',
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'start', 6, 5], 'circle-color': ['match', ['get', 'kind'], 'start', T.stroke, T.route.end], 'circle-stroke-width': ['match', ['get', 'kind'], 'start', 3, 2], 'circle-stroke-color': ['match', ['get', 'kind'], 'start', T.route.start, T.route.end] } });
}

// ---------- route and coverage drawing helpers ----------
const CLEAR = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
const COV_LAYERS = ['cov-fill', 'cov-glow', 'cov-line'];
let routeP = 1, covP = 1;
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
// visible up to p of each line's own length (line-progress runs 0..1 along every feature)
const grown = (col, p) => (p >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, col, 1, col] : ['step', ['line-progress'], col, Math.max(p, 1e-6), 'rgba(0,0,0,0)']);
// While a line grows it is drawn with a line-gradient cut at p. Once complete it switches to a plain line
// colour: a later theme change then recolours every tile at once (a changed gradient was only picked up
// by some tiles).
function drawn(map, id, col, op, p) {
  if (p >= 1) {
    map.setPaintProperty(id, 'line-gradient', undefined);
    map.setPaintProperty(id, 'line-color', col);
    map.setPaintProperty(id, 'line-opacity', op);
  } else {
    map.setPaintProperty(id, 'line-opacity', 1);
    map.setPaintProperty(id, 'line-gradient', grown(op < 1 ? rgba(col, op) : col, p));
  }
}
function setRouteProgress(map, T, p) {
  routeP = p;
  if (!map.getLayer('route-line')) return;
  drawn(map, 'route-line', T.route.core, 1, p);
  drawn(map, 'route-glow', T.route.glow, 0.32, p);
}
function setCoverageProgress(map, T, p) {
  covP = p;
  if (!map.getLayer('cov-line')) return;
  drawn(map, 'cov-line', T.coverage.line, 1, p);
  drawn(map, 'cov-glow', T.coverage.glow, T.coverage.glowOp, p);
  if (map.getLayer('cov-fill')) map.setPaintProperty('cov-fill', 'fill-opacity', T.coverage.fillOp * p);
}
// Endpoints pulse twice, gently, then stay still.
function pulseEnds(map, reduce, alive) {
  if (reduce || !map.getLayer('route-pulse')) return;
  const t0 = performance.now();
  const f = (now) => {
    if (!alive() || !map.getLayer('route-pulse')) return;
    const k = (now - t0) / 2000;
    if (k >= 2) { map.setPaintProperty('route-pulse', 'circle-stroke-opacity', 0); return; }
    const q = k % 1;
    map.setPaintProperty('route-pulse', 'circle-radius', 6 + 14 * q);
    map.setPaintProperty('route-pulse', 'circle-stroke-opacity', 0.7 * (1 - q));
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
// Compact time and distance tag at the middle of the route, lifted off the line.
function routeLabel(map, route, cum) {
  const [a] = cut(route.coords, cum, 0.5);
  const at = a ? a[a.length - 1] : route.coords[0];
  const el = document.createElement('div');
  el.className = 'route-tag';
  const b = document.createElement('b'); b.textContent = route.timeText;
  const s = document.createElement('span'); s.textContent = `${route.distText} · ${route.modeLabel}`;
  el.append(b, s);
  return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -12] }).setLngLat(at).addTo(map);
}
const wait = (map, alive) => new Promise((res) => { if (!map.isMoving()) return res(); map.once('moveend', () => res()); }).then(() => alive());
// Camera for a route: the whole path in view with room for the controls and the tag; never closer than
// needed. Cinematic: fly to it, then tilt a little once it has settled. Plain: top-down, no tilt or turn.
async function routeCamera(map, coords, cinematic, reduce, pad, alive) {
  const bb = coords.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
  const P = { top: 96, bottom: 56, left: 56, right: 56, ...(pad || {}) };
  const cam = map.cameraForBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: P, bearing: 0, maxZoom: 16.5 });
  if (!cam) return;
  const d = reduce ? 0 : 1;
  map.flyTo({ center: cam.center, zoom: cam.zoom, pitch: 0, bearing: 0, duration: 1800 * d, curve: 1.2, essential: true });
  if (!(await wait(map, alive))) return;
  if (!cinematic) return;
  map.easeTo({ pitch: 45, zoom: cam.zoom - 0.15, duration: 1500 * d, easing: (t) => 1 - Math.pow(1 - t, 3), essential: true });
  if (!(await wait(map, alive))) return;
  // tilting makes the far side smaller and the near side larger: back off until every point fits
  for (let i = 0; i < 4; i++) {
    const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight;
    const step = Math.max(1, Math.floor(coords.length / 300));
    const out = coords.some(([x, y], k) => { if (k % step && k !== coords.length - 1) return false; const p = map.project([x, y]); return p.x < P.left * 0.6 || p.x > W - P.right * 0.6 || p.y < P.top * 0.6 || p.y > H - P.bottom * 0.6; });
    if (!out) break;
    map.easeTo({ zoom: map.getZoom() - 0.35, duration: 600 * d, essential: true });
    if (!(await wait(map, alive))) return;
  }
}

function applyFilters(map, { cats, types, query, densityMode, theme }) {
  const KDE_COLORS = kdeColors(theme);
  const q = (query || '').trim().toLowerCase();
  // the same matching as the result list (lib/data.js): names, English name, other names, IDs
  const qf = /^[\x00-\x7f]+$/.test(q) ? q.normalize('NFKD').replace(/[^a-z0-9]/g, '') : '';
  const qExpr = q
    ? ['any', ['in', q, ['downcase', ['coalesce', ['get', 'name'], '']]], ['in', q, ['downcase', ['get', 'display_name']]], ['in', q, ['downcase', ['coalesce', ['get', 'label'], '']]], ['in', q, ['coalesce', ['get', 'name_full'], '']], ['in', q, ['downcase', ['coalesce', ['get', 'name_en'], '']]], ['==', ['downcase', ['get', 'id']], q], ['==', ['get', 'osm_id'], q],
      ['in', q, ['downcase', ['coalesce', ['get', 'search_text'], '']]],
      ...(qf.length >= 3 ? [['in', qf, ['downcase', ['coalesce', ['get', 'search_text'], '']]]] : [])]
    : true;
  map.setFilter('attractions-pt', ['all', catExpr(cats), qExpr]);
  // symbols follow the same category filter; while a search is typed the matches get their symbols at any zoom
  if (map.getLayer('lm-iconic')) {
    LM_BASE.forEach((l, i) => map.setFilter(l, q ? NONE : ['all', TIER(3 - i), catExpr(cats)]));
    map.setFilter('lm-search', q ? ['all', catExpr(cats), qExpr] : NONE);
  }
  map.setFilter('attractions-glow', ['all', catExpr(cats), qExpr]);
  map.setFilter('transport-pt', ['all', typeExpr(types), qExpr]);
  map.setFilter('transport-sym-rail', ['all', RAIL_F, typeExpr(types), qExpr]);
  map.setFilter('transport-sym-bus', ['all', BUS_F, typeExpr(types), qExpr]);
  map.setFilter('heat', catExpr(cats));
  map.setLayoutProperty('heat', 'visibility', densityMode === 'heat' ? 'visible' : 'none');
  if (map.getLayer('kde-fill')) {
    const s = sumExpr(cats);
    const kdeOn = densityMode === 'kde' && cats.length > 0;
    if (kdeOn) {
      if (map.getLayoutProperty('kde-fill', 'visibility') !== 'visible') {
        map.setPaintProperty('kde-fill', 'fill-opacity', 0);
        map.setLayoutProperty('kde-fill', 'visibility', 'visible');
        requestAnimationFrame(() => map.setPaintProperty('kde-fill', 'fill-opacity', 0.62));
      }
    } else map.setLayoutProperty('kde-fill', 'visibility', 'none');
    if (cats.length) {
      map.setFilter('kde-fill', ['>=', s, KDE_BREAKS[0]]);
      map.setPaintProperty('kde-fill', 'fill-color', ['step', s, KDE_COLORS[0], ...KDE_BREAKS.slice(1).flatMap((b, i) => [b, KDE_COLORS[i + 1]])]);
    }
  }
}
