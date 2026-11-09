import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ATTRACTION_CATS, TRANSPORT_TYPES } from './lib/data.js';

// Basemaps: raster tiles, no API key. See README for usage terms.
export const BASEMAPS = {
  gsi: {
    label: 'GSI pale (地理院タイル)',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
    maxzoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル (GSI Japan)</a>',
  },
  osm: {
    label: 'OpenStreetMap',
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
export const KDE_COLORS = ['#163a7a', '#1f5bbf', '#2e8cf0', '#3fc4f0', '#9ee8d6', '#f2e28b'];

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The real tiles are restyled for the dark dashboard: inverted, desaturated and tinted blue.
// Only colours change; geometry and labels are the provider's.
const basePaint = () => ({ 'raster-brightness-min': 1, 'raster-brightness-max': 0.06, 'raster-saturation': -0.85, 'raster-contrast': 0.18, 'raster-hue-rotate': 200 });
// Offline preview build (claude.ai viewer blocks external tiles): background only, no fake basemap.
export const OFFLINE_PREVIEW = import.meta.env.VITE_TARGET === 'artifact';
function styleFor(basemap) {
  if (OFFLINE_PREVIEW) return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#071027' } }] };
  const b = BASEMAPS[basemap];
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#071027' } }, { id: 'base', type: 'raster', source: 'base', paint: basePaint() }],
  };
}

export default function MapView({ data, cats, types, query, densityMode, basemap, selected, onSelect, onHover, mapRef: externalRef, routes }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const marker = useRef(null);
  const callout = useRef(null);
  const latest = useRef({});
  latest.current = { onSelect, onHover, cats, types, query, densityMode };

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current,
      style: styleFor(basemap),
      bounds: [[134.85, 34.7], [136.06, 35.79]],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: DATA_ATTR }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    if (externalRef) externalRef.current = map;
    window.__kyotoMap = map; // used by the automated tests

    map.on('load', () => {
      addDataLayers(map, data);
      intro(map);
    });
    map.on('style.load', () => {
      if (!map.getSource('attractions')) addDataLayers(map, data);
      applyFilters(map, latest.current);
    });

    const interactive = ['attractions-pt', 'transport-pt'];
    map.on('mousemove', (e) => {
      const f = map.getLayer('attractions-pt') ? map.queryRenderedFeatures(e.point, { layers: interactive }) : [];
      map.getCanvas().style.cursor = f.length ? 'pointer' : '';
      latest.current.onHover(f.length ? { feature: f[0], x: e.point.x, y: e.point.y } : null);
    });
    map.on('mouseout', () => latest.current.onHover(null));
    map.on('click', (e) => {
      const pad = 4;
      const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      const a = map.queryRenderedFeatures(box, { layers: ['attractions-pt'] });
      const s = a.length ? [] : map.queryRenderedFeatures(box, { layers: ['transport-pt'] });
      const f = a[0] || s[0];
      latest.current.onSelect(f ? { layer: a[0] ? 'attraction' : 'transport', id: f.properties.id } : null);
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getSource('attractions') && map.getLayer('attractions-pt')) applyFilters(map, { cats, types, query, densityMode });
  }, [cats, types, query, densityMode]);

  // Swap the basemap tiles without rebuilding the data layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('base')) return;
    const b = BASEMAPS[basemap];
    const before = map.getStyle().layers[2]?.id;
    map.removeLayer('base');
    map.removeSource('base');
    map.addSource('base', { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution });
    map.addLayer({ id: 'base', type: 'raster', source: 'base', paint: basePaint() }, before);
  }, [basemap]);

  // Walking routes for the selected attraction (real network results only).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const set = () => {
      const src = map.getSource('walk');
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: routes || [] });
      if (routes?.length) drawRoutes(map);
    };
    if (map.getSource('walk')) set();
    else map.once('idle', set);
  }, [routes]);

  // Selection marker and camera move.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    marker.current?.remove();
    marker.current = null;
    callout.current?.remove();
    callout.current = null;
    if (!selected) return;
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
      nm.textContent = selected.label;
      nm.lang = 'ja';
      const sub = document.createElement('span');
      sub.textContent = selected.sub || '';
      t.append(sw, nm, sub);
      c.append(document.createElement('s'), t);
      callout.current = new maplibregl.Marker({ element: c, anchor: 'bottom-left', offset: [6, -6] }).setLngLat(selected.coords).addTo(map);
    }
    const z = Math.max(map.getZoom(), 13.5);
    if (selected.fly !== false) map.flyTo({ center: selected.coords, zoom: z, duration: prefersReducedMotion() ? 0 : 1100, essential: true, offset: [0, 0] });
  }, [selected]);

  return <div ref={el} className="map" role="region" aria-label="Map of Kyoto Prefecture" />;
}

const WALK_COLORS = [['bus', '#4fc3ff'], ['rail', '#f2c86b']];
// line-progress gradient that reveals the route from the attraction (start) to the stop.
const gradient = (col, t) => (t >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, col, 1, col]
  : ['step', ['line-progress'], col, Math.max(0.0001, t), 'rgba(0,0,0,0)']);
// Moving dash pattern: stepping through these looks like light travelling along the path.
const DASH_STEPS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

let routeAnim = 0;
function drawRoutes(map) {
  cancelAnimationFrame(routeAnim);
  const reduce = prefersReducedMotion();
  const t0 = performance.now();
  let lastStep = -1;
  const frame = (now) => {
    if (!map.getLayer('walk-line-bus')) return;
    const k = reduce ? 1 : Math.min(1, (now - t0 - 350) / 1300);
    const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3);
    for (const [t, col] of WALK_COLORS) map.setPaintProperty(`walk-line-${t}`, 'line-gradient', gradient(col, e));
    const flowOn = e >= 1 && !reduce;
    for (const [t] of WALK_COLORS) map.setLayoutProperty(`walk-flow-${t}`, 'visibility', flowOn ? 'visible' : 'none');
    if (flowOn) {
      const step = Math.floor(now / 70) % DASH_STEPS.length;
      if (step !== lastStep) {
        for (const [t] of WALK_COLORS) map.setPaintProperty(`walk-flow-${t}`, 'line-dasharray', DASH_STEPS[step]);
        lastStep = step;
      }
    }
    if (!reduce && map.getSource('walk')._data.features?.length) routeAnim = requestAnimationFrame(frame);
  };
  routeAnim = requestAnimationFrame(frame);
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
  set('outline-line', 'line-opacity', 0, 1, 900, 0);
  set('outline-glow', 'line-opacity', 0, 0.55, 1400, 200);
  set('outline-fill', 'fill-opacity', 0, 0.1, 1200, 300);
  set('muni-line', 'line-opacity', 0, 0.35, 900, 500);
  set('transport-pt', 'circle-opacity', 0, ['match', ['get', 'transport_type'], 'bus', 0.75, 1], 900, 700);
  set('attractions-glow', 'circle-opacity', 0, 0.45, 900, 1100);
  set('attractions-pt', 'circle-opacity', 0, 1, 700, 1100);
  set('attractions-pt', 'circle-stroke-opacity', 0, 1, 700, 1100);
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
        map.setPaintProperty('outline-glow', 'line-opacity', 0.42 + 0.16 * Math.sin(t * 1.2));
        setTimeout(breathe, 80);
      };
      breathe();
    }, 1800);
  }
}

function addDataLayers(map, data) {
  if (data.municipalities) {
    map.addSource('muni', { type: 'geojson', data: data.municipalities });
    map.addLayer({ id: 'muni-line', type: 'line', source: 'muni', paint: { 'line-color': '#7fb3ff', 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.2], 'line-dasharray': [2, 2] } });
  }
  if (data.outline) {
    map.addSource('outline', { type: 'geojson', data: data.outline });
    map.addLayer({ id: 'outline-fill', type: 'fill', source: 'outline', paint: { 'fill-color': '#2e6bff', 'fill-opacity': 0.1 } }, 'muni-line');
    map.addLayer({ id: 'outline-glow', type: 'line', source: 'outline', paint: { 'line-color': '#3d8bff', 'line-width': 14, 'line-blur': 12, 'line-opacity': 0.55 } });
    map.addLayer({ id: 'outline-line', type: 'line', source: 'outline', paint: { 'line-color': '#9fd0ff', 'line-width': 1.8 } });
  }
  if (data.kde) {
    map.addSource('kde', { type: 'geojson', data: data.kde });
    map.addLayer({ id: 'kde-fill', type: 'fill', source: 'kde', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0, 'fill-opacity-transition': { duration: 700, delay: 0 }, 'fill-outline-color': 'rgba(0,0,0,0)' } });
  }
  if (data.walking?.pilot?.bbox) {
    const [x0, y0, x1, y1] = data.walking.pilot.bbox;
    map.addSource('pilot', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } } });
    map.addLayer({ id: 'pilot-line', type: 'line', source: 'pilot', paint: { 'line-color': '#f2c86b', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } });
  }
  map.addSource('walk', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
  for (const [t, col] of WALK_COLORS) {
    map.addLayer({ id: `walk-glow-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 11, 'line-blur': 7, 'line-opacity': 0.45 } });
    map.addLayer({ id: `walk-line-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 3.4, 'line-gradient': gradient(col, 1) } });
    map.addLayer({ id: `walk-flow-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': DASH_STEPS[0] } });
  }
  map.addSource('attractions', { type: 'geojson', data: data.attractions });
  map.addSource('transport', { type: 'geojson', data: data.transport });
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'attractions', layout: { visibility: 'none' },
    paint: {
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 10, 11, 22, 14, 40],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 13, 1.6],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, '#1f4fae', 0.45, '#2e9bf0', 0.7, '#7fe3e0', 1, '#fff2a8'],
    },
  });
  map.addLayer({
    id: 'transport-pt', type: 'circle', source: 'transport',
    paint: {
      'circle-color': ['match', ['get', 'transport_type'], ...TRANSPORT_TYPES.flatMap((t) => [t.key, t.color]), '#888'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'transport_type'], 'bus', 0.9, 2.4], 12, ['match', ['get', 'transport_type'], 'bus', 2.6, 4.5], 16, ['match', ['get', 'transport_type'], 'bus', 5, 7]],
      'circle-opacity': ['match', ['get', 'transport_type'], 'bus', 0.75, 1],
      'circle-stroke-color': '#071027',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 11, ['match', ['get', 'transport_type'], 'bus', 0.5, 1.2]],
    },
  });
  map.addLayer({
    id: 'attractions-glow', type: 'circle', source: 'attractions',
    paint: { 'circle-color': ['match', ['get', 'category'], ...ATTRACTION_CATS.flatMap((c) => [c.key, c.color]), '#888'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 7, 12, 12, 16, 16], 'circle-blur': 1, 'circle-opacity': 0.45 },
  });
  map.addLayer({
    id: 'attractions-pt', type: 'circle', source: 'attractions',
    paint: {
      'circle-color': ['match', ['get', 'category'], ...ATTRACTION_CATS.flatMap((c) => [c.key, c.color]), '#888'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 5.5, 16, 8],
      'circle-stroke-color': '#071027',
      'circle-stroke-width': 1.2,
    },
  });
}

function applyFilters(map, { cats, types, query, densityMode }) {
  const q = (query || '').trim().toLowerCase();
  const qExpr = q
    ? ['any', ['in', q, ['downcase', ['coalesce', ['get', 'name'], '']]], ['in', q, ['downcase', ['get', 'display_name']]], ['==', ['downcase', ['get', 'id']], q], ['==', ['get', 'osm_id'], q]]
    : true;
  map.setFilter('attractions-pt', ['all', catExpr(cats), qExpr]);
  map.setFilter('attractions-glow', ['all', catExpr(cats), qExpr]);
  map.setFilter('transport-pt', ['all', typeExpr(types), qExpr]);
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
