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

export default function MapView({ active = true, focus = null, data, cats, types, query, densityMode, basemap, selected, onSelect, onHover, mapRef: externalRef, walkSet, maxWalk }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const marker = useRef(null);
  const callout = useRef(null);
  const latest = useRef({});
  latest.current = { onSelect, onHover, cats, types, query, densityMode, active };
  const introPending = useRef(false);
  useEffect(() => {
    if (active && introPending.current && mapRef.current) { introPending.current = false; mapRef.current.resize(); intro(mapRef.current); }
  }, [active]);

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
      if (latest.current.active) intro(map);
      else introPending.current = true;
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
    map.setPaintProperty('attractions-glow', 'circle-opacity', !focus ? 0.45 : aMatch ? ['case', aMatch, 0.9, 0.05] : 0.05);
    map.setPaintProperty('transport-pt', 'circle-opacity', tOp);
    map.setPaintProperty('attractions-pt', 'circle-radius', grow(['interpolate', ['linear'], ['zoom'], 7, 3, 12, 5.5, 16, 8], aMatch));
    map.setPaintProperty('transport-pt', 'circle-radius', grow(['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'transport_type'], 'bus', 0.9, 2.4], 12, ['match', ['get', 'transport_type'], 'bus', 2.6, 4.5], 16, ['match', ['get', 'transport_type'], 'bus', 5, 7]], tMatch));
  }, [focus]);

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
        stopMarkers.current.forEach((m) => m.marker.remove());
        stopMarkers.current = new Map();
        for (const it of st.items) {
          const id = it.stop.id;
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
    const z = Math.max(map.getZoom(), 13.5);
    if (selected.fly !== false) map.flyTo({ center: selected.coords, zoom: z, duration: prefersReducedMotion() ? 0 : 1100, essential: true, offset: [0, 0] });
  }, [selected]);

  return <div ref={el} className="map" role="region" aria-label="Map of Kyoto Prefecture" />;
}

const WALK_COLORS = [['bus', '#4fc3ff'], ['rail', '#f2c86b']];
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
let flowAnim = 0;
function paintReach(map, st, maxWalk, mode, markers, delay = 0) {
  cancelAnimationFrame(st.raf);
  cancelAnimationFrame(flowAnim);
  const reduce = prefersReducedMotion();
  const from = st.r, to = st.items.length ? maxWalk : 0;
  const dur = reduce ? 0 : Math.max(250, (Math.abs(to - from) / SPEED) * 1000);
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
  for (const [t] of WALK_COLORS) if (map.getLayer(`walk-flow-${t}`)) map.setLayoutProperty(`walk-flow-${t}`, 'visibility', off ? 'none' : 'visible');
  if (off) return;
  const f = (now) => {
    const step = Math.floor(now / 70) % DASH_STEPS.length;
    if (step !== last) {
      for (const [t] of WALK_COLORS) map.setPaintProperty(`walk-flow-${t}`, 'line-dasharray', DASH_STEPS[step]);
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
  map.addSource('walk', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('walk-rest', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'walk-rest', type: 'line', source: 'walk-rest', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'stop_type'], 'rail', '#f2c86b', '#4fc3ff'], 'line-width': 2, 'line-opacity': 0.28, 'line-dasharray': [1, 2] } });
  for (const [t, col] of WALK_COLORS) {
    map.addLayer({ id: `walk-glow-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 11, 'line-blur': 7, 'line-opacity': 0.45 } });
    map.addLayer({ id: `walk-line-${t}`, type: 'line', source: 'walk', filter: ['==', ['get', 'stop_type'], t], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 3.4, 'line-color': col } });
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
