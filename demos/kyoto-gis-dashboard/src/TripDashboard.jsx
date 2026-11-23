import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as TP from './lib/trip.js';
import { fetchRoute, fetchTable, fmtDuration, fmtDistance, ROUTE_SERVICE } from './lib/route.js';
import { getWeather, describeCode } from './lib/weather.js';
import { CATEGORY_LABEL, ATTRACTION_CATS, recordLabel } from './lib/data.js';
import { ICONIC } from './lib/landmarks.js';
import { OFFLINE_PREVIEW, basemapStyle } from './MapView.jsx';
import PixelTree from './PixelTree.jsx';
import './trip.css';

// "Plan your trip": a second dashboard for the visitor's own plan. It covers the GIS dashboard (the
// header, map and panel stay where they were underneath) and returns to it with the Dashboard button.
// Layout after the reference the project owner chose: a rail, a big scene with ema (one per day), the
// trip card, weather at the planned times, the day's map, the next stop, places worth adding and a dock.
// Data rules as in lib/trip.js: routed legs only, bus legs without ride times, no invented values.

const BASE = import.meta.env.BASE_URL;
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// The scene: AI-generated illustrations (Figma image generation), one per season, day and night, all
// mirrored so the sky sits behind the trip card. The season follows the date of the day being planned
// (JMA months), day or night follows the light or dark theme. The blank notice board is where the ema
// hang before anything is planned (its face in image pixels, measured on each picture).
const SCENE_BOARD = {
  'spring-day': [1200, 280, 1414, 468], 'spring-night': [1177, 322, 1414, 488],
  'summer-day': [1257, 330, 1468, 508], 'summer-night': [1180, 352, 1430, 545],
  'autumn-day': [1203, 254, 1416, 444], 'autumn-night': [1212, 312, 1442, 500],
  'winter-day': [1192, 285, 1413, 468], 'winter-night': [1232, 302, 1424, 492],
};
const SCENE = { w: 1536, h: 864, focusX: 0.62 };
const sceneFor = (iso, theme, pick) => { const k = `${pick || seasonWord(iso)}-${theme === 'light' ? 'day' : 'night'}`; return { key: k, src: `${BASE}trip/hero-${k}.webp`, board: SCENE_BOARD[k] }; }
const MODE_TEXT = { foot: 'Walk', bike: 'Cycle', car: 'Drive', bus: 'Bus' };
const NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
const seasonWord = (iso) => { const m = +iso.slice(5, 7); return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'; };
const PHOTO_BADGE = { 'site-contains': 'Photo of the site', 'viewpoint-here': 'Taken here', 'nearby-checked': 'Taken nearby', 'wikidata-related': 'Related place', 'commons-geo': 'Nearby photo', 'commons-near': 'Nearby photo', 'commons-search': 'Nearby photo' };
const nowTokyoMin = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return +p.hour * 60 + +p.minute; };

// ---------- small icons (stroke icons drawn here; no icon font) ----------
const I = {
  home: <path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" />,
  agenda: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></>,
  map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  back: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  support: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="13" width="4" height="6" rx="1.5" /><rect x="17" y="13" width="4" height="6" rx="1.5" /><path d="M19 19c0 1.5-2 2.5-5 2.5" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none" /></>,
  stop: <><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  order: <><path d="M4 7h11l-3-3M20 17H9l3 3" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="17" r="2" /></>,
  ics: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5 12 18l2.5-2.5" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pin: <><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11Z" /><circle cx="12" cy="10" r="2" /></>,
  bus: <><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 11h14M8 21l1-3M16 21l-1-3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  bell: <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  chev: <path d="m9 6 6 6-6 6" />,
  house: <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />,
};
const Ic = ({ k, s = 20, ...p }) => <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{I[k]}</svg>;
function WxIcon({ icon, night, s = 30 }) {
  const sun = <g><circle cx="20" cy="20" r="7.5" fill="#f7c53b" /><g stroke="#f7c53b" strokeWidth="3" strokeLinecap="round"><path d="M20 4v5M20 31v5M4 20h5M31 20h5M8.7 8.7l3.5 3.5M27.8 27.8l3.5 3.5M8.7 31.3l3.5-3.5M27.8 12.2l3.5-3.5" /></g></g>;
  const moon = <path d="M25 7a12 12 0 1 0 9 16A10 10 0 0 1 25 7z" fill="#f4e6a6" />;
  const cloud = (y = 0, c = '#e8f0ef') => <path d={`M11 ${30 + y}h18a6 6 0 0 0 0-12 8 8 0 0 0-15-2 6 6 0 0 0-3 14z`} fill={c} />;
  const drops = <g stroke="#8fd0ff" strokeWidth="2.4" strokeLinecap="round"><path d="M14 33l-2 4M20 33l-2 4M26 33l-2 4" /></g>;
  const flakes = <g fill="#fff"><circle cx="13" cy="35" r="1.8" /><circle cx="20" cy="37" r="1.8" /><circle cx="27" cy="35" r="1.8" /></g>;
  const body = { sun: night ? moon : sun, partly: <>{night ? moon : <g transform="translate(-4 -4) scale(.8)">{sun}</g>}{cloud(2)}</>, cloud: cloud(-3), fog: <>{cloud(-6)}<path d="M8 32h24M11 36h18" stroke="#e8f0ef" strokeWidth="2.4" strokeLinecap="round" /></>, drizzle: <>{cloud(-6)}{drops}</>, rain: <>{cloud(-6)}{drops}</>, snow: <>{cloud(-6)}{flakes}</>, storm: <>{cloud(-6)}<path d="M21 27l-4 7h5l-3 6" stroke="#f7c53b" strokeWidth="2.4" fill="none" strokeLinejoin="round" /></> }[icon];
  return <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">{body || <circle cx="20" cy="20" r="3" fill="currentColor" opacity=".5" />}</svg>;
}

// A soft mist of light inside the glass cards that drifts toward the pointer and fades when it leaves
// (stronger in the dark theme, see trip.css). Only custom properties are written; the loop runs only
// while something is still moving, and not at all with "reduce motion".
function useMist(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root || reduce()) return undefined;
    let ptr = null, raf = 0, last = 0;
    const st = new WeakMap();
    const frame = (now) => {
      raf = 0;
      const dt = last ? Math.min(80, now - last) : 16;
      last = now;
      const kp = 1 - Math.exp(-dt / 140), ko = 1 - Math.exp(-dt / 320);
      let moving = false;
      for (const c of root.querySelectorAll('.tp-card, .tp-strip')) {
        const r = c.getBoundingClientRect();
        if (r.width < 2) continue;
        let s = st.get(c);
        if (!s) { s = { x: r.width / 2, y: r.height / 2, o: 0 }; st.set(c, s); }
        let want = 0;
        if (ptr) {
          const dx = Math.max(r.left - ptr.x, 0, ptr.x - r.right), dy = Math.max(r.top - ptr.y, 0, ptr.y - r.bottom);
          want = Math.max(0, 1 - Math.hypot(dx, dy) / 160);
          if (want > 0) {
            const tx = ptr.x - r.left, ty = ptr.y - r.top;
            if (s.o < 0.02) { s.x = tx; s.y = ty; } else { const ex = tx - s.x, ey = ty - s.y; s.x += ex * kp; s.y += ey * kp; if (Math.hypot(ex, ey) > 0.5) moving = true; }
          }
        }
        const d = want - s.o;
        if (Math.abs(d) > 0.004) { s.o += d * ko; moving = true; } else if (!want && s.o) s.o = 0;
        c.style.setProperty('--mx', `${s.x.toFixed(1)}px`);
        c.style.setProperty('--my', `${s.y.toFixed(1)}px`);
        c.style.setProperty('--mo', s.o.toFixed(3));
      }
      if (moving) raf = requestAnimationFrame(frame); else last = 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const mv = (e) => { if (e.pointerType === 'touch') return; ptr = { x: e.clientX, y: e.clientY }; kick(); };
    const lv = () => { ptr = null; kick(); };
    root.addEventListener('pointermove', mv, { passive: true });
    root.addEventListener('pointerleave', lv);
    return () => { root.removeEventListener('pointermove', mv); root.removeEventListener('pointerleave', lv); cancelAnimationFrame(raf); };
  }, [ref]);
}

// ---------- the scene ----------
// Where the image's pixels land in a box of w x h with object-fit: cover at focus x.
function coverRect(w, h, fx = 0.5) {
  const s = Math.max(w / SCENE.w, h / SCENE.h), dw = SCENE.w * s, dh = SCENE.h * s;
  return { s, ox: (w - dw) * fx, oy: (h - dh) / 2 };
}
function useBox(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}
// A photo for the scene: the same Commons file at 1920 px when it can be reached, else the local copy.
function useScenePhoto(ph) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    setUrl(null);
    if (!ph) return undefined;
    const local = `${BASE}${ph.src}`;
    setUrl(local);   // the local copy at once; the sharper Commons file replaces it when it arrives
    if (!ph.file || OFFLINE_PREVIEW) return undefined;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setUrl(img.src); };
    img.src = TP.commonsUrl(ph.file, 1920);
    return () => { live = false; };
  }, [ph?.file, ph?.src]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function Ema({ day, i, active, style, kind, onPick, dragging }) {
  const [over, setOver] = useState(false);
  const setOverFalse = () => setOver(false);
  useEffect(() => { if (!dragging) setOverFalse(); }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" className={'ema ' + kind + (active ? ' on' : '') + (over ? ' over' : '') + (dragging ? ' wants' : '')} style={style} data-day={day ? i : undefined}
      onClick={() => onPick(i)} onPointerEnter={() => dragging && setOver(true)} onPointerLeave={() => setOver(false)}
      aria-label={day ? `Day ${i + 1}, ${TP.dateLong(day.date)}, ${day.stops.length} places. Open its plan.` : 'Add a day'} aria-pressed={day ? active : undefined}>
      <i className="peg" aria-hidden="true" />
      <b>{day ? <>Day {i + 1}<small>{TP.dayLabel(day.date)}</small></> : '+'}</b>
    </button>
  );
}

function Scene({ trip, active, onPick, onAddDay, photo, photoInfo, board, hint, dragging, theme, seasonPick, strip = null, children }) {
  const sc = sceneFor(trip.days[Math.min(active, trip.days.length - 1)].date, theme, seasonPick);
  const ref = useRef(null);
  const box = useBox(ref);
  const url = useScenePhoto(board ? null : photo);
  const showPhoto = !board && !!url;
  const fx = box.w && box.w < 700 ? 0.97 : SCENE.focusX;   // narrow screens keep the board in view
  const { s, ox, oy } = coverRect(box.w, box.h, fx);
  const [bx0, by0, bx1, by1] = sc.board;
  const rect = { x: ox + bx0 * s, y: oy + by0 * s, w: (bx1 - bx0) * s, h: (by1 - by0) * s };
  const items = [...trip.days.map((d, i) => ({ d, i })), ...(trip.days.length < TP.MAX_DAYS ? [{ d: null, i: trip.days.length }] : [])];
  const n = items.length;
  let pos, ropeX0 = box.w * 0.5;
  if (board) {
    const cols = n <= 3 ? n : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
    const cw = rect.w / cols, ch = rect.h / rows, ew = Math.min(cw * 0.84, 56), eh = ew * 1.22;
    pos = items.map((_, k) => {
      const r = Math.floor(k / cols), c = k % cols, inRow = Math.min(cols, n - r * cols);
      const x0 = rect.x + (rect.w - inRow * cw) / 2;
      return { left: x0 + c * cw + (cw - ew) / 2, top: rect.y + r * ch + (ch - eh) / 2 + 2, width: ew, '--r': `${((k * 37) % 7) - 3}deg`, '--fs': `${Math.max(8.5, Math.min(12, ew * 0.215)).toFixed(1)}px` };
    });
  } else {
    // the rope starts right of the trip card (its left edge and width follow trip.css)
    const rail = box.w > 760 ? (innerWidth <= 1180 ? 96 : 112) : 0;
    const cardRight = box.w > 760 ? rail + 38 + Math.min(600, box.w * (innerWidth <= 1180 ? 0.66 : 0.58)) : 0;
    const xa = Math.max(box.w * 0.5, cardRight + 18), xb = box.w * 0.985;
    ropeX0 = xa - 30;
    const ew = Math.min(62, ((xb - xa) / n) * 0.82);
    pos = items.map((_, k) => {
      const t = (k + 0.5) / n, x = xa + (xb - xa) * t, u = (x - ropeX0) / (box.w - ropeX0);
      const y = box.h * 0.07 + 2 * u * (1 - u) * box.h * 0.13;   // on the rope drawn below
      return { left: x - ew / 2, top: y - 3, width: ew, '--r': `${((k * 53) % 9) - 4}deg`, '--fs': `${Math.max(8.5, Math.min(13, ew * 0.215)).toFixed(1)}px` };
    });
  }
  return (
    <div className={'tp-scene' + (showPhoto ? ' photo' : '') + (strip != null ? ' planning' : '')} ref={ref}>
      <img key={sc.key} className="tp-illus" src={sc.src} alt="" style={{ objectPosition: `${fx * 100}% 50%` }} draggable="false" data-scene={sc.key} />
      <div className="tp-photo" style={url ? { backgroundImage: `url("${url}")` } : null} aria-hidden="true" />
      {!board && box.w > 0 && (
        <svg className="tp-rope" width={box.w} height={box.h * 0.14} aria-hidden="true">
          <path d={`M${ropeX0} ${box.h * 0.07} Q${(ropeX0 + box.w) / 2} ${box.h * 0.07 + box.h * 0.13} ${box.w} ${box.h * 0.07}`} />
        </svg>
      )}
      {box.w > 0 && items.map(({ d, i }, k) => (
        <Ema key={d ? d.id : 'add'} day={d} i={i} active={d && i === active} kind={(board ? 'pinned' : 'hang') + (d ? '' : ' add')} style={pos[k]}
          onPick={(j) => (d ? onPick(j) : onAddDay())} dragging={dragging && !!d} />
      ))}
      {strip != null && box.w > 760 && pos[strip] && (() => {
        // a thin thread from the open day's ema down to the top of its strip (strip box as in trip.css)
        const rail = innerWidth <= 1180 ? 96 : 112, sw = Math.min(440, box.w * 0.42);
        const x1 = pos[strip].left + pos[strip].width / 2, y1 = pos[strip].top + 3, x2 = rail + 30 + sw - 2, y2 = box.h * 0.1 + 40;
        const sag = Math.max(60, Math.abs(x1 - x2) * 0.25);
        return <svg key={strip} className="tp-thread" width={box.w} height={box.h} aria-hidden="true"><path d={`M${x1} ${y1} C${x1 - 10} ${y1 + sag} ${x2 + 80} ${y2 + sag * 0.6} ${x2} ${y2}`} pathLength="1" /><circle cx={x1} cy={y1} r="2.6" className="knot" /><circle cx={x2} cy={y2} r="4.5" className="ring" /></svg>;
      })()}
      {board && hint && box.w > 0 && <span className="tp-hint" style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h + 10 }}>Click an ema to plan that day</span>}
      {showPhoto && photoInfo && <p className="tp-credit">{photoInfo.badge && <b>{photoInfo.badge} · </b>}Photo: {photoInfo.artist || 'unknown author'} · {photoInfo.license} · Wikimedia Commons</p>}
      {!showPhoto && <p className="tp-credit illus">Illustration: AI-generated scene (Figma), not a real place</p>}
      {children}
    </div>
  );
}

// ---------- the trip map (card and full view) ----------
// The GIS dashboard's own basemap, with the project's data kept quiet underneath (prefecture outline and the
// 626 attractions as faint dots), the day's places as photo markers and the legs drawn on top. New legs
// draw themselves from one place to the next, in order. The map can be dragged and zoomed.
const MAP_PAL = {
  light: { bus: '#c0472a', foot: '#1f6f6b', bike: '#d0861c', car: '#4a6fa5', casing: 'rgba(255,255,255,.85)', outline: '#b4543a' },
  dark: { bus: '#ff8a65', foot: '#8fe3da', bike: '#f2b04a', car: '#8fb0e0', casing: 'rgba(0,0,0,.6)', outline: '#79d7da' },
};
const DAY_HUES = ['#1f6f6b', '#c0472a', '#7b5cc4', '#c08a1a', '#2f7fbf', '#b4457e', '#4b8a3a'];
const CAT_COLOR = ['match', ['get', 'category'], ...ATTRACTION_CATS.flatMap((c) => [c.key, c.color]), '#999'];
const lineLen = (c) => c.reduce((s, p, k) => (k ? s + TP.distM(c[k - 1], p) : 0), 0);
const lineCut = (c, d) => {   // the first d metres of a line
  if (d <= 0) return [c[0], c[0]];
  let acc = 0;
  for (let j = 1; j < c.length; j++) {
    const s = TP.distM(c[j - 1], c[j]);
    if (acc + s >= d) { const f = s ? (d - acc) / s : 0; return [...c.slice(0, j), [c[j - 1][0] + (c[j][0] - c[j - 1][0]) * f, c[j - 1][1] + (c[j][1] - c[j - 1][1]) * f]]; }
    acc += s;
  }
  return c;
};
// legs: [{ mode, coords, day }] in travel order; points: [{ xy, name, photo, n, day, start }]
function TripMap({ theme, points, legs, full = false, playRef, dayColors = false, base }) {
  const el = useRef(null), map = useRef(null), marks = useRef([]), ready = useRef(false), latest = useRef(null), drawn = useRef(new Set()), anim = useRef(0);
  latest.current = { points, legs };
  const P = MAP_PAL[theme === 'light' ? 'light' : 'dark'];
  const ptsSig = points.map((p) => `${p.xy[0].toFixed(5)},${p.xy[1].toFixed(5)},${p.n},${p.day},${p.photo || ''},${p.name}`).join('|');
  const legSig = legs.map((l) => `${l.mode}${l.day}:${l.coords?.length}:${l.coords?.[0]?.join(',')}`).join('|');
  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current, style: basemapStyle(theme), center: [135.768, 35.005], zoom: 11.6, attributionControl: false, fadeDuration: 0, dragRotate: false, pitchWithRotate: false });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.current = m;
    drawn.current = new Set();
    m.on('load', () => {
      if (base?.outline) {
        m.addSource('pref', { type: 'geojson', data: base.outline });
        m.addLayer({ id: 'pref', type: 'line', source: 'pref', paint: { 'line-color': P.outline, 'line-width': 1.2, 'line-opacity': 0.55 } });
      }
      if (base?.attractions) {
        m.addSource('attr', { type: 'geojson', data: base.attractions });
        m.addLayer({ id: 'attr', type: 'circle', source: 'attr', paint: { 'circle-color': CAT_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 12, 2.4, 15, 4], 'circle-opacity': 0.55 } });
      }
      m.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const lo = { 'line-cap': 'round', 'line-join': 'round' };
      m.addLayer({ id: 'legs-c', type: 'line', source: 'legs', paint: { 'line-color': P.casing, 'line-width': full ? 7.5 : 6.5 }, layout: lo });
      m.addLayer({ id: 'legs', type: 'line', source: 'legs', filter: ['in', ['get', 'mode'], ['literal', ['bus', 'car']]], paint: { 'line-color': ['get', 'c'], 'line-width': full ? 4.5 : 4 }, layout: lo });
      m.addLayer({ id: 'legs-d', type: 'line', source: 'legs', filter: ['==', ['get', 'mode'], 'foot'], paint: { 'line-color': ['get', 'c'], 'line-width': 3.6, 'line-dasharray': [1.2, 1.4] }, layout: lo });
      m.addLayer({ id: 'legs-b', type: 'line', source: 'legs', filter: ['==', ['get', 'mode'], 'bike'], paint: { 'line-color': ['get', 'c'], 'line-width': 4, 'line-dasharray': [0.6, 1.6] }, layout: lo });
      ready.current = true;
      m.fire('tp-pts'); m.fire('tp-legs');
    });
    return () => { ready.current = false; cancelAnimationFrame(anim.current); marks.current.forEach((x) => x.remove()); m.remove(); };
  }, [theme, full]); // eslint-disable-line react-hooks/exhaustive-deps
  // the places: photo markers that appear one after another, and the view framed on them
  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const put = () => {
      if (!ready.current) return;
      const { points } = latest.current; // eslint-disable-line no-shadow
      marks.current.forEach((x) => x.remove());
      marks.current = points.map((p, k) => {
        const d = document.createElement('div');
        d.className = 'tp-mk' + (p.start ? ' start' : '');
        d.style.animationDelay = `${k * 140}ms`;
        if (p.photo) { const im = document.createElement('i'); im.className = 'im'; im.style.backgroundImage = `url("${BASE}${p.photo}")`; d.appendChild(im); }
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (p.n != null ? `${p.n}. ` : '') + p.name; d.appendChild(nm);
        if (dayColors) d.style.setProperty('--dc', DAY_HUES[p.day % 7]);
        return new maplibregl.Marker({ element: d, anchor: 'bottom' }).setLngLat(p.xy).addTo(m);
      });
      const all = points.map((p) => p.xy);
      if (all.length === 1) m.jumpTo({ center: all[0], zoom: 14 });
      else if (all.length > 1) {
        const b = all.reduce((bb, c) => [[Math.min(bb[0][0], c[0]), Math.min(bb[0][1], c[1])], [Math.max(bb[1][0], c[0]), Math.max(bb[1][1], c[1])]], [[180, 90], [-180, -90]]);
        m.fitBounds(b, { padding: full ? 90 : { top: 70, bottom: 30, left: 36, right: 50 }, duration: reduce() ? 0 : 700, maxZoom: 15 });
      }
    };
    put();
    m.on('tp-pts', put);
    return () => m.off('tp-pts', put);
  }, [ptsSig, theme, full, dayColors]); // eslint-disable-line react-hooks/exhaustive-deps
  // the legs: those already shown stay, new ones draw from the first place to the next, in order
  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const draw = () => {
      if (!ready.current || !m.getSource('legs')) return;
      cancelAnimationFrame(anim.current);
      const { legs } = latest.current; // eslint-disable-line no-shadow
      const all = legs.filter((l) => l.coords?.length > 1).map((l) => ({ ...l, key: `${l.mode}|${l.day}|${l.coords.length}|${l.coords[0]}|${l.coords[l.coords.length - 1]}`, c: dayColors ? DAY_HUES[l.day % 7] : P[l.mode] || P.foot }));
      const had = drawn.current;
      drawn.current = new Set(all.filter((f) => had.has(f.key)).map((f) => f.key));
      const fresh = all.filter((f) => !drawn.current.has(f.key)).map((f) => ({ ...f, len: lineLen(f.coords) }));
      const total = fresh.reduce((s, f) => s + f.len, 0);
      const D = reduce() || !total ? 0 : Math.min(3200, 700 + total / 5);
      const t0 = performance.now();
      const step = (now) => {
        const k = D ? Math.min(1, (now - t0) / D) : 1, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        let left = total * e;
        const feats = all.map((f) => {
          let c = f.coords;
          if (!drawn.current.has(f.key)) { const g = fresh.find((x) => x.key === f.key); c = lineCut(f.coords, Math.max(0, Math.min(g.len, left))); left -= g.len; }
          return { type: 'Feature', properties: { mode: f.mode, c: f.c }, geometry: { type: 'LineString', coordinates: c } };
        });
        m.getSource('legs')?.setData({ type: 'FeatureCollection', features: feats });
        if (k < 1) anim.current = requestAnimationFrame(step);
        else fresh.forEach((f) => drawn.current.add(f.key));
      };
      anim.current = requestAnimationFrame(step);
    };
    draw();
    m.on('tp-legs', draw);
    return () => { m.off('tp-legs', draw); cancelAnimationFrame(anim.current); };
  }, [legSig, theme, full, dayColors]); // eslint-disable-line react-hooks/exhaustive-deps
  // Play day: a light walks the legs in order (driven from outside through playRef)
  useEffect(() => {
    if (!playRef) return undefined;
    playRef.current = { map: () => map.current };
    return () => { playRef.current = null; };
  }, [playRef]);
  return <div className="tp-map" ref={el} />;
}

// ---------- legs: routed by the service, bus from the project's bus data ----------
function useLegs(day, ctx, enabled = true) {
  const [, bump] = useState(0);
  const cache = ctx.legCache;
  const pts = day ? TP.dayPoints(day) : [];
  const keys = pts.map((p, i) => (i === 0 ? null : `${pts[i - 1].id}>${p.id}|${p.mode}|${p.bus ? `${p.bus.variant}:${p.bus.boardSeq}:${p.bus.alightSeq}` : ''}`));
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    (async () => {
      for (let i = 1; i < pts.length; i++) {
        const k = keys[i];
        if (!k || cache.has(k)) continue;
        cache.set(k, { pending: true });
        if (live) bump((x) => x + 1);
        const res = await resolveLeg(ctx, pts[i - 1], pts[i]).catch((e) => ({ error: String(e.message || e) }));
        cache.set(k, res);
        if (live) bump((x) => x + 1);
      }
    })();
    return () => { live = false; };
  }, [keys.join(','), enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return keys.map((k) => (k ? cache.get(k) || { pending: true } : null));
}
async function resolveLeg(ctx, a, b) {
  const A = ctx.xy(a.id), B = ctx.xy(b.id);
  if (!A || !B) return { error: 'This place has no position.' };
  if (b.mode !== 'bus') {
    const r = await fetchRoute(A, B, b.mode);
    return { mode: b.mode, coords: r.coords, duration_s: r.duration_s, distance_m: r.distance_m, parts: [{ mode: b.mode, coords: r.coords }] };
  }
  const found = TP.busOptions(ctx.bus, ctx.xy, A, B);
  if (!found.options.length) return { mode: 'bus', duration_s: null, options: [], found, error: found.nearA && found.nearB ? 'No bus route in this project calls near both places in this order.' : `No bus stop within ${(!found.nearA ? found.radiusA : found.radiusB)} m of ${!found.nearA ? 'the previous place' : 'this place'}.` };
  const opt = (b.bus && found.options.find((o) => o.variant === b.bus.variant && o.boardSeq === b.bus.boardSeq && o.alightSeq === b.bus.alightSeq)) || found.options[0];
  const v = await ctx.fetchBusVariant(opt.variant);
  const ride = TP.rideLine(v, opt.boardSeq, opt.alightSeq);
  const bxy = v.stops?.[opt.boardSeq]?.xy, axy = v.stops?.[opt.alightSeq]?.xy;
  const [w1, w2] = await Promise.all([bxy ? fetchRoute(A, bxy, 'foot').catch(() => null) : null, axy ? fetchRoute(axy, B, 'foot').catch(() => null) : null]);
  return {
    mode: 'bus', option: opt, options: found.options, found, duration_s: null,
    walk_s: (w1?.duration_s || 0) + (w2?.duration_s || 0), walkKnown: !!(w1 && w2), w1, w2,
    parts: [w1 && { mode: 'foot', coords: w1.coords }, ride && { mode: 'bus', coords: ride.coords }, w2 && { mode: 'foot', coords: w2.coords }].filter(Boolean),
  };
}
const legText = (leg, short = false) => {
  if (!leg) return '';
  if (leg.pending) return 'Finding the route…';
  if (leg.error && !leg.option) return leg.error;
  if (leg.mode === 'bus') {
    const o = leg.option, f = o.fare?.adult != null ? ` · ¥${o.fare.adult}` : '';
    return short ? `Bus ${o.number} · ${o.stops} stop${o.stops > 1 ? 's' : ''}${f}` : `Bus ${o.number}: ${o.boardName} → ${o.alightName}, ${o.stops} stop${o.stops > 1 ? 's' : ''}${f} · ride time not known${leg.walkKnown ? ` · walking ${fmtDuration(leg.walk_s)}` : ''}`;
  }
  return `${MODE_TEXT[leg.mode]} ${fmtDuration(leg.duration_s)}${short ? '' : ` · ${fmtDistance(leg.distance_m)}`}`;
};

// ---------- weather at the planned times ----------
function useForecast(spots) {
  const [res, setRes] = useState({});
  const sig = spots.map((s) => `${s.xy[0].toFixed(3)},${s.xy[1].toFixed(3)}`).join('|');
  useEffect(() => {
    let live = true;
    const uniq = [...new Set(sig.split('|').filter(Boolean))];
    Promise.all(uniq.map((k) => { const [lon, lat] = k.split(',').map(Number); return getWeather(lat, lon).then((r) => [k, r.data]).catch((e) => [k, { error: String(e.message || e) }]); }))
      .then((rows) => { if (live) setRes(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [sig]);
  return (xy, iso, min) => {
    const w = res[`${xy[0].toFixed(3)},${xy[1].toFixed(3)}`];
    if (!w) return { pending: true };
    if (w.error) return { error: w.error };
    const key = `${iso}T${String(Math.floor(Math.round(min) / 60) % 24).padStart(2, '0')}:00`;
    const h = w.hourly.find((x) => x.time === key);
    return h ? { ...h, ...describeCode(h.code), night: +key.slice(11, 13) < 6 || +key.slice(11, 13) >= 18 } : { none: true, last: w.hourly[w.hourly.length - 1]?.time };
  };
}

// ---------- the dashboard ----------
export default function TripDashboard({ open, onShown, onClose, d, byId, A, Tr, theme, seasonPick, fetchBusVariant, addRequest, goRequest, onAsk }) {
  const [vis, setVis] = useState(false);
  const doors = useRef(null);
  const busy = useRef(false);
  const usedAdd = useRef(0);   // an "Add to trip" request is used once
  const usedGo = useRef(0);    // so is a request from the assistant to open a day or a view
  // shoji doors: they slide shut over whichever side is showing, the sides swap, and they slide open.
  // One run at a time; if the wish changes while the doors move (a quick second click), the same run
  // goes round again for the latest wish, so the two sides never end up out of step.
  const want = useRef(open), shown = useRef(false);
  want.current = open;
  useEffect(() => {
    if (busy.current || shown.current === want.current) return;
    busy.current = true;
    (async () => {
      const D = doors.current;
      const go = (kf, ms) => Promise.all([...D.children].map((p, i) => p.animate(kf(i), { duration: ms, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).finished));
      let closed = false;
      while (shown.current !== want.current) {
        const target = want.current;
        if (!reduce() && D && !closed) {
          closed = true;
          D.classList.add('on');
          await go((i) => [{ transform: `translateX(${i ? 101 : -101}%)` }, { transform: 'translateX(0)' }], 460);
          await new Promise((r) => setTimeout(r, 90));
        }
        shown.current = target;
        setVis(target);
        onShown(target);
        if (!reduce() && D) {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (want.current === target) { await go((i) => [{ transform: 'translateX(0)' }, { transform: `translateX(${i ? 101 : -101}%)` }], 620); closed = false; }
          if (want.current === target) D.classList.remove('on');
        }
      }
      busy.current = false;
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="trip-root">
      {vis && <Trip d={d} byId={byId} A={A} Tr={Tr} theme={theme} seasonPick={seasonPick} fetchBusVariant={fetchBusVariant} onClose={onClose} addRequest={addRequest && addRequest.n !== usedAdd.current ? addRequest : null} onUsed={(n) => { usedAdd.current = n; }}
        goRequest={goRequest && goRequest.n !== usedGo.current ? goRequest : null} onGoUsed={(n) => { usedGo.current = n; }} onAsk={onAsk} />}
      <div className="tp-doors" ref={doors} aria-hidden="true"><i /><i /></div>
    </div>
  );
}

function Trip({ d, byId, A, Tr, theme, seasonPick, fetchBusVariant, onClose, addRequest, onUsed, goRequest, onGoUsed, onAsk }) {
  const rootRef = useRef(null);
  useMist(rootRef);
  const base = useMemo(() => ({ outline: d.outline, attractions: d.attractions }), [d.outline, d.attractions]);
  const [focus, setFocus] = useState(null);         // a place opened in the day's strip: the scene shows it
  const [trip, setTripState] = useState(() => TP.loadTrip());
  const setTrip = (f) => setTripState((t) => { const n = typeof f === 'function' ? f(t) : f; TP.saveTrip(n); return n; });
  const [active, setActive] = useState(0);
  const [view, setView] = useState('trip');          // 'trip' | 'agenda' | 'map'
  const [planner, setPlanner] = useState(null);      // day index whose scroll is open
  const [sheet, setSheet] = useState(null);          // 'add' | 'help' | 'order' | 'hours' | 'notes'
  const [addKind, setAddKind] = useState('all');     // the add sheet opens on stations when choosing a start
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [drag, setDrag] = useState(null);            // { id, x, y } while a place card is dragged
  const [playing, setPlaying] = useState(false);
  const [pageAt, setPageAt] = useState(0);
  const legCache = useRef(new Map()).current;
  const playRef = useRef(null);
  const today = TP.tokyoDate();
  const day = trip.days[Math.min(active, trip.days.length - 1)];
  const di = Math.min(active, trip.days.length - 1);

  // ---- record access ----
  const pm = d.pointMuni, photos = d.photos?.photos || {};
  const info = useMemo(() => (id) => {
    const h = byId.get(id);
    if (!h) return null;
    const p = h.f.properties, code = pm?.points?.[id];
    const en = p.name_en || null;
    return { id, p, layer: h.layer, xy: h.f.geometry.coordinates, name: en || recordLabel(p), ja: en ? (p.name || '') : '', cat: CATEGORY_LABEL[p.category] || p.category, area: code ? (pm.names_en?.[code] || pm.names?.[code] || '').replace(/^Kyoto City,?\s*/, '') : '', photo: photos[id] || null };
  }, [byId, pm, photos]);
  const ctx = useMemo(() => ({ xy: (id) => byId.get(id)?.f.geometry.coordinates || null, bus: d.bus, fetchBusVariant, legCache }), [byId, d.bus, fetchBusVariant, legCache]);
  useEffect(() => { if (addRequest?.id) { onUsed(addRequest.n); addPlace(addRequest.id, addRequest.day ?? di); } }, [addRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the planner's help now opens from the assistant's chat (the house took the Support button's place)
  useEffect(() => { const f = () => setSheet('help'); addEventListener('kyoto-trip-help', f); return () => removeEventListener('kyoto-trip-help', f); }, []);
  // the assistant changes the saved plan (assistantTools.js) and says so: read it again
  useEffect(() => {
    const f = () => setTripState(TP.loadTrip());
    addEventListener('kyoto-trip-changed', f);
    return () => removeEventListener('kyoto-trip-changed', f);
  }, []);
  // the assistant asks to show one day's plan, the list of days or the map of all days
  useEffect(() => {
    if (!goRequest) return;
    onGoUsed(goRequest.n);
    setSheet(null);
    if (goRequest.view === 'agenda' || goRequest.view === 'map') { setPlanner(null); setFocus(null); setView(goRequest.view); return; }
    setView('trip');
    if (goRequest.day) { const i = Math.max(0, Math.min(TP.loadTrip().days.length - 1, goRequest.day - 1)); setActive(i); setFocus(null); setPlanner(i); }
  }, [goRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the active day ----
  const legs = useLegs(day, ctx);
  const tl = TP.timeline(day, legs.map((l) => (l && !l.pending ? { duration_s: l.duration_s } : null)));
  const pts = TP.dayPoints(day);
  const off = day.from ? 1 : 0;
  const isPlanned = TP.planned(trip);
  const nIdx = TP.nextStopIndex(day, tl, today, nowTokyoMin());
  const next = nIdx >= 0 ? info(day.stops[nIdx].id) : null;
  const nextT = nIdx >= 0 ? tl.points[nIdx + off] : null;
  const after = nIdx >= 0 && nIdx + 1 < day.stops.length ? info(day.stops[nIdx + 1].id) : null;
  const afterT = after ? tl.points[nIdx + 1 + off] : null;
  // the scene shows the place opened in the strip, otherwise the next stop
  const shown = planner != null && focus && focus.day === di && day.stops[focus.si] ? info(day.stops[focus.si].id) : next;
  const board = !isPlanned || !shown?.photo;   // the illustration and the board, unless that place has a photo
  const toastT = useRef(0);
  const say = (msg) => { setToast(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 2600); };

  function addPlace(id, dj = di) {
    const pl = info(id);
    if (!pl) return;
    if (trip.days[dj]?.stops.some((s) => s.id === id)) { say(`${pl.name} is already on Day ${dj + 1}.`); return; }
    setTrip((t) => {
      const dd = t.days[dj], prev = dd.stops.length ? dd.stops[dd.stops.length - 1].id : dd.from;
      const a = prev && info(prev)?.xy, km = a ? TP.distM(a, pl.xy) / 1000 : 0;
      return TP.addStop(t, dj, id, { mode: km > 8 ? 'car' : km > 1.5 ? 'bus' : 'foot' });   // a starting choice only; it can be changed
    });
    setTrip((t) => ({ ...t, hintSeen: true }));
    say(`Added ${pl.name} to Day ${dj + 1}.`);
  }
  const openDay = (i) => { setActive(i); setPlanner(i); setTrip((t) => (t.hintSeen ? t : { ...t, hintSeen: true })); };

  // Escape closes the open sheet first, then the day's scroll
  useEffect(() => {
    const k = (e) => { if (e.key !== 'Escape') return; if (sheet) { setSheet(null); setQuery(''); } else if (planner != null) setPlanner(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [sheet, planner]);

  // ---- drag a place card onto an ema or the + button ----
  const dragRef = useRef(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return undefined;
    const mv = (e) => setDrag((g) => g && { ...g, x: e.clientX, y: e.clientY, moved: g.moved || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 6 });
    const up = (e) => {
      const g = dragRef.current;
      setDrag(null);
      if (!g) return;
      if (!g.moved) { addPlace(g.id); return; }
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-day],[data-fab]');
      if (t?.dataset.day != null) addPlace(g.id, +t.dataset.day);
      else if (t?.dataset.fab != null) addPlace(g.id);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up, { once: true });
    return () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- weather ----
  const station = info('S00019');
  const wxSpots = isPlanned ? pts.map((p) => ({ xy: info(p.id)?.xy })).filter((s) => s.xy) : station ? [{ xy: station.xy }] : [];
  const fc = useForecast(wxSpots);
  const wxCols = isPlanned
    ? pts.map((p, i) => ({ p: info(p.id), t: tl.points[i]?.arrive, label: i === 0 && p.start ? 'Start' : (info(p.id)?.name || '').split(/[\s(（-]/)[0] })).filter((c) => c.p && c.t != null).slice(0, 5)
    : station ? [540, 600, 720, 900, 1080].map((t) => ({ p: station, t, label: '' })) : [];
  const wxMain = isPlanned && next && nextT?.arrive != null ? { p: next, t: nextT.arrive } : wxCols[0] || null;
  const wxNow = wxMain ? fc(wxMain.p.xy, day.date, wxMain.t) : null;

  // ---- map data for the active day ----
  const mapPoints = pts.map((p, i) => { const x = info(p.id); return x && { xy: x.xy, name: x.name, photo: x.photo?.src, n: p.start ? null : i + 1 - off, start: !!p.start, day: di }; }).filter(Boolean);
  const mapLegs = legs.flatMap((l) => (l?.parts ? l.parts.map((q) => ({ ...q, day: di })) : []));
  // all days for the full map
  const allLegs = useAllLegs(trip, ctx, view === 'map' || view === 'agenda');

  // ---- places worth adding: near the day's stops, or the city's best-known places ----
  const worth = useMemo(() => {
    const inTrip = new Set(trip.days.flatMap((x) => x.stops.map((s) => s.id)));
    const here = pts.map((p) => info(p.id)?.xy).filter(Boolean);
    let list;
    if (here.length) {
      list = A.filter((f) => !inTrip.has(f.properties.id)).map((f) => ({ f, dist: Math.min(...here.map((h) => TP.distM(h, f.geometry.coordinates))) }))
        .filter((x) => x.dist <= 1000).sort((a, b) => (!!photos[b.f.properties.id] - !!photos[a.f.properties.id]) || ((ICONIC[a.f.properties.id]?.rank ?? 99) - (ICONIC[b.f.properties.id]?.rank ?? 99)) || a.dist - b.dist);
    } else {
      list = Object.entries(ICONIC).sort((a, b) => a[1].rank - b[1].rank).map(([id]) => ({ f: byId.get(id)?.f })).filter((x) => x.f && !inTrip.has(x.f.properties.id) && photos[x.f.properties.id]);
    }
    return list.map((x) => info(x.f.properties.id)).filter(Boolean);
  }, [trip, di, A, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const perPage = 4, pages = Math.max(1, Math.ceil(worth.length / perPage)), page = Math.min(pageAt, pages - 1);

  // ---- bus fares (flat fares only; distance fares are pointed to the official chart) ----
  const fareInfo = (() => {
    let sum = 0, n = 0, other = 0;
    for (const x of trip.days) for (const s of x.stops) {
      if (s.mode !== 'bus') continue;
      const k = [...legCache.keys()].find((kk) => kk.includes(`>${s.id}|bus`));
      const o = k && legCache.get(k)?.option;
      if (o?.fare?.adult != null) { sum += o.fare.adult; n++; } else if (o) other++;
    }
    return { sum, n, other };
  })();

  // ---- notes for the bell ----
  const notes = [];
  if (tl.overrun > 0) notes.push(`Day ${di + 1} runs ${fmtDuration(tl.overrun * 60)} past ${day.end}.`);
  pts.forEach((p, i) => {
    const t = tl.points[i], x = info(p.id);
    if (!x || p.start) return;
    if (t.late) notes.push(`${x.name}: the planned ${p.at} cannot be reached from the stop before.`);
    if (i > 0 && legs[i]?.mode === 'bus' && legs[i]?.option && !p.at) notes.push(`${x.name}: the bus ride has no timetable here. Set an arrival time to keep the clock.`);
    if (legs[i]?.error && !legs[i]?.option) notes.push(`${x.name}: ${legs[i].error}`);
    const w = t.arrive != null ? fc(x.xy, day.date, t.arrive) : null;
    if (w?.precipProb >= 50) notes.push(`${x.name}: ${w.precipProb}% chance of rain around ${TP.fmtHM(t.arrive)}.`);
  });

  // ---- Play day ----
  const playStop = useRef(null);
  useEffect(() => () => playStop.current?.(), []);   // leaving the trip dashboard stops Play day
  const play = async () => {
    if (playing) { playStop.current?.(); return; }
    const m = playRef.current?.map?.();
    const parts = legs.map((l, i) => ({ l, i })).filter((x) => x.l?.parts?.length);
    if (!m || !parts.length) { say('Add two places with a route between them to play the day.'); return; }
    setPlaying(true);
    let stop = false;
    playStop.current = () => { stop = true; };
    const dot = document.createElement('div'); dot.className = 'tp-play';
    const clock = document.createElement('div'); clock.className = 'tp-clock';
    const mk = new maplibregl.Marker({ element: dot }).setLngLat(parts[0].l.parts[0].coords[0]).addTo(m);
    m.getContainer().appendChild(clock);
    const segLen = (c) => c.reduce((s, p, k) => (k ? s + TP.distM(c[k - 1], p) : 0), 0);
    for (const { l, i } of parts) {
      const t0 = tl.points[i - 1]?.leave, t1 = tl.points[i]?.arrive;
      const coords = l.parts.flatMap((q) => q.coords);
      const total = segLen(coords) || 1;
      const ms = reduce() ? 0 : Math.min(3200, 900 + total / 3);
      clock.textContent = `${t0 != null ? TP.fmtHM(t0) : '–'} · ${MODE_TEXT[l.mode]}`;
      await new Promise((res) => {
        const start = performance.now();
        const step = (now) => {
          if (stop) return res();
          const k = ms ? Math.min(1, (now - start) / ms) : 1;
          let want = total * k, acc = 0, at = coords[coords.length - 1];
          for (let j = 1; j < coords.length; j++) { const dd = TP.distM(coords[j - 1], coords[j]); if (acc + dd >= want) { const f = dd ? (want - acc) / dd : 0; at = [coords[j - 1][0] + (coords[j][0] - coords[j - 1][0]) * f, coords[j - 1][1] + (coords[j][1] - coords[j - 1][1]) * f]; break; } acc += dd; }
          mk.setLngLat(at);
          if (t0 != null && t1 != null) clock.textContent = `${TP.fmtHM(t0 + (t1 - t0) * k)} · ${MODE_TEXT[l.mode]}`;
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      if (stop) break;
      const x = info(pts[i].id);
      clock.textContent = `${t1 != null ? TP.fmtHM(t1) : 'time not known'} · ${x?.name || ''}`;
      dot.classList.remove('ring'); void dot.offsetWidth; dot.classList.add('ring');
      await new Promise((r) => setTimeout(r, reduce() ? 0 : 900));
    }
    await new Promise((r) => setTimeout(r, stop ? 0 : 900));
    mk.remove(); clock.remove();
    setPlaying(false);
  };

  // ---- Best order ----
  const [order, setOrder] = useState(null);
  const findOrder = async () => {
    if (day.stops.length < 2 + (day.from ? 0 : 1)) { say('Best order needs at least three places on the day (or a start and two places).'); return; }
    const modes = day.stops.map((s) => s.mode).filter((m) => m !== 'bus');
    const prof = ['foot', 'bike', 'car'].sort((a, b) => modes.filter((m) => m === b).length - modes.filter((m) => m === a).length)[0];
    setOrder({ pending: true, prof });
    setSheet('order');
    try {
      const xs = pts.map((p) => info(p.id).xy);
      const t = await fetchTable(xs, prof);
      if (t.durations.some((r) => r.some((v) => v == null))) throw new Error('The routing service could not connect some of these places.');
      const best = TP.bestOrder(t.durations);
      setOrder({ prof, best, now: TP.orderCost(t.durations, [...xs.keys()]), then: TP.orderCost(t.durations, best) });
    } catch (e) { setOrder({ prof, error: String(e.message || e) }); }
  };
  const applyOrder = () => {
    const ids = order.best.map((k) => pts[k]).filter((p) => !p.start);
    setTrip((t) => ({ ...t, days: t.days.map((x, i) => (i === di ? { ...x, stops: ids.map((p) => ({ ...p, bus: null })) } : x)) }));
    setSheet(null);
    say('New order applied. Bus legs are looked up again for the new order.');
  };

  // ---- export ----
  const exportIcs = async () => {
    say('Preparing the calendar file…');
    const days = [];
    for (const x of trip.days) {
      const ps = TP.dayPoints(x);
      const ls = [null];
      for (let i = 1; i < ps.length; i++) {
        const k = `${ps[i - 1].id}>${ps[i].id}|${ps[i].mode}|${ps[i].bus ? `${ps[i].bus.variant}:${ps[i].bus.boardSeq}:${ps[i].bus.alightSeq}` : ''}`;
        let leg = legCache.get(k);
        if (!leg || leg.pending) { leg = await resolveLeg(ctx, ps[i - 1], ps[i]).catch((e) => ({ error: String(e.message || e) })); legCache.set(k, leg); }
        ls.push(leg);
      }
      days.push({ day: x, tl: TP.timeline(x, ls.map((l) => (l ? { duration_s: l.duration_s } : null))), names: ps.map((p) => info(p.id)?.name || p.id), legText: ls.map((l) => legText(l)) });
    }
    const blob = new Blob([TP.toICS(trip, days)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kyoto-trip-${trip.days[0].date}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('Calendar file saved (kyoto-trip.ics).');
  };

  const placesN = trip.days.reduce((s, x) => s + x.stops.length, 0);
  const sub = isPlanned ? `${NUM[trip.days.length] || trip.days.length} ${seasonWord(trip.days[0].date)} day${trip.days.length > 1 ? 's' : ''}` : 'Not planned yet';
  const hour = Math.floor(nowTokyoMin() / 60);
  const greet = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <section ref={rootRef} className={'trip' + (drag?.moved ? ' dragging' : '') + ` v-${view}`} aria-label="Plan your trip">
      <svg className="tp-logo" viewBox="0 0 84 40" aria-hidden="true"><path d="M4 22c14-14 30-14 44-4 10 7 20 6 30-2" /><path d="M10 33c12-9 24-9 36-2 9 5 18 5 28 0" /></svg>
      <header className="tp-head">
        <h2>Hello, Explorer <span className="wave" aria-hidden="true">👋</span></h2>
        <p>{greet}. Ready for your Kyoto days?</p>
      </header>
      <div className="tp-tools">
        <label className="tp-search"><Ic k="search" /><span className="sr-only">Search places to add</span>
          <input type="search" placeholder="Search places…" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setSheet('add'); }} onFocus={() => query && setSheet('add')} />
        </label>
        <button type="button" className="tp-bell" onClick={() => setSheet(sheet === 'notes' ? null : 'notes')} aria-expanded={sheet === 'notes'} aria-label={`Plan notes (${notes.length})`}><Ic k="bell" s={22} />{notes.length > 0 && <i />}</button>
      </div>

      <nav className="tp-rail" aria-label="Trip views">
        {[['trip', 'home', 'Trip'], ['agenda', 'agenda', 'Agenda'], ['map', 'map', 'Trip map']].map(([k, ic, lb]) => (
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}><Ic k={ic} s={28} />{lb}</button>
        ))}
        <button type="button" onClick={onClose}><Ic k="back" s={28} />Dashboard</button>
      </nav>

      {view === 'trip' && (
        <Scene trip={trip} active={di} theme={theme} seasonPick={seasonPick} strip={planner} onPick={openDay} onAddDay={() => { setTrip((t) => TP.addDay(t)); say('Day added.'); }} board={board} hint={!trip.hintSeen && !isPlanned}
          photo={shown?.photo} photoInfo={shown?.photo && { artist: shown.photo.artist, license: shown.photo.license, badge: PHOTO_BADGE[shown.photo.match] }} dragging={!!drag?.moved}>
          <article className="tp-card tp-feat">
            <div className="txt">
              <p className="lbl">YOUR TRIP</p>
              <input className="title" value={trip.title} aria-label="Trip name" maxLength={28} onChange={(e) => setTrip((t) => ({ ...t, title: e.target.value }))} />
              <h3>{sub}</h3>
              <div className="stats">
                <span><Ic k="cal" s={22} /><b>{trip.days.length} Day{trip.days.length > 1 ? 's' : ''}<small>{TP.dateLong(trip.days[0].date)}</small></b></span>
                <span><Ic k="pin" s={22} /><b>{placesN} Place{placesN === 1 ? '' : 's'}<small>{placesN ? 'On your list' : 'Add a few'}</small></b></span>
                <span><Ic k="bus" s={22} /><b>{fareInfo.n ? `¥${fareInfo.sum.toLocaleString('en-US')}` : '—'}<small>{fareInfo.n ? `Bus fares${fareInfo.other ? ' + more' : ''}` : 'No bus yet'}</small></b></span>
              </div>
              <button type="button" className="tp-btn" onClick={() => (isPlanned ? setView('agenda') : openDay(0))}>{isPlanned ? 'Open itinerary' : 'Start planning'} <span aria-hidden="true">→</span></button>
            </div>
            {after?.photo && <div className="ph" style={{ backgroundImage: `url("${BASE}${after.photo.src}")` }}><span className="pin">Then: {after.name}{afterT?.arrive != null ? `, ${TP.fmtHM(afterT.arrive)}` : ''}</span></div>}
          </article>
          {planner != null && trip.days[planner] && (
            <Planner key={planner} trip={trip} di={planner} setTrip={setTrip} info={info} ctx={ctx} onFocus={(si) => setFocus(si == null ? null : { day: planner, si })} onClose={() => { setPlanner(null); setFocus(null); }} onAdd={() => { setActive(planner); setAddKind('all'); setSheet('add'); }} onStart={() => { setActive(planner); setAddKind('station'); setSheet('add'); }} say={say} />
          )}
        </Scene>
      )}
      {view === 'agenda' && <Agenda trip={trip} info={info} ctx={ctx} allLegs={allLegs} onOpen={(i) => { setView('trip'); openDay(i); }} />}
      {view === 'map' && (
        <div className="tp-full">
          <TripMap theme={theme} full dayColors base={base} points={trip.days.flatMap((x, j) => TP.dayPoints(x).map((p, i) => { const q = info(p.id); return q && { xy: q.xy, name: q.name, photo: q.photo?.src, n: p.start ? null : i + 1 - (x.from ? 1 : 0), start: !!p.start, day: j }; }).filter(Boolean))}
            legs={allLegs.flatMap((ls, j) => ls.flatMap((l) => (l?.parts ? l.parts.map((q) => ({ ...q, day: j })) : [])))} />
          <div className="tp-daykey">{trip.days.map((x, j) => <span key={x.id} style={{ '--dc': DAY_HUES[j % 7] }}>Day {j + 1} · {TP.dayLabel(x.date)}</span>)}</div>
        </div>
      )}

      <aside className="tp-side">
        <div className="tp-card tp-wx">
          {wxMain ? (
            <>
              <div className="big">
                <WxIcon icon={wxNow?.icon} night={wxNow?.night} s={60} />
                <div><b>{wxNow?.temperature != null ? `${Math.round(wxNow.temperature)}°` : '–'}</b><span>{wxNow?.pending ? 'Loading…' : wxNow?.error ? 'Forecast not available' : wxNow?.none ? 'No forecast yet' : wxNow?.label}</span></div>
              </div>
              <p className="loc">{wxMain.p.name}<small>{TP.dateLong(day.date)} · {TP.fmtHM(wxMain.t)}</small></p>
              <div className="tp-tree"><PixelTree season={seasonPick || seasonWord(day.date)} theme={theme} wind={wxNow?.wind} windDir={wxNow?.windDir} gust={wxNow?.gust} code={wxNow?.code} precip={wxNow?.precip} night={!!wxNow?.night} width={150} height={112}
                label={`Pixel tree for ${seasonPick || seasonWord(day.date)}, moving with the forecast wind${wxNow?.wind != null ? ` of ${Math.round(wxNow.wind)} km/h` : ''} at ${wxMain.p.name}`} /></div>
              {wxNow?.none && <p className="wx-note">Open-Meteo forecasts 7 days ahead; this date is beyond it.</p>}
              {wxNow?.error && <p className="wx-note">{wxNow.error}</p>}
              <div className="hours">
                {wxCols.map((c, k) => { const w = fc(c.p.xy, day.date, c.t); return <div key={k}><span>{TP.fmtHM(c.t)}</span><WxIcon icon={w.icon} night={w.night} s={26} /><b>{w.temperature != null ? `${Math.round(w.temperature)}°` : '–'}</b>{c.label && <em>{c.label}</em>}</div>; })}
              </div>
            </>
          ) : <p className="wx-note">Add a place to see the weather at your planned times.</p>}
        </div>
        <div className="tp-card tp-mapcard">
          <div className="hd"><h4>{isPlanned ? `Day ${di + 1} Map` : 'Kyoto Map'}</h4><button type="button" className="lnk" onClick={() => setView('map')}>Open full map ›</button></div>
          <TripMap theme={theme} points={mapPoints} legs={mapLegs} playRef={playRef} base={base} />
        </div>
        <div className="tp-card tp-next">
          <div className="hd"><h4>Next Stop</h4>{next && <button type="button" className="lnk" onClick={() => openDay(di)}>See all ›</button>}</div>
          {next ? (
            <div className="row">
              {next.photo ? <div className="im" style={{ backgroundImage: `url("${BASE}${next.photo.src}")` }} /> : <div className="im none"><Ic k="house" s={34} />No photo</div>}
              <div className="tx">
                <b>{next.name}{nextT?.arrive != null ? ` · ${TP.fmtHM(nextT.arrive)}` : ''}</b>
                <span><Ic k="cal" s={18} />{TP.dateLong(day.date)} · stay {fmtDuration((day.stops[nIdx].stay ?? TP.DEFAULT_STAY) * 60)}</span>
                {legs[nIdx + off] && <span><Ic k={day.stops[nIdx].mode === 'bus' ? 'bus' : 'pin'} s={18} />{legText(legs[nIdx + off], true) || 'First place of the day'}</span>}
                <span><Ic k="pin" s={18} />{[next.cat, next.area].filter(Boolean).join(' · ')}</span>
              </div>
              <button type="button" className="go" onClick={() => openDay(di)} aria-label="Open the day's plan"><Ic k="chev" /></button>
            </div>
          ) : (
            <div className="empty"><p>Nothing planned yet. Pick a place below or search for one, then drop it on an ema.</p><button type="button" className="tp-btn sm" onClick={() => setSheet('add')}>+ Add a place</button></div>
          )}
        </div>
      </aside>

      {view === 'trip' && (
        <section className="tp-card tp-worth" aria-label="Places worth adding">
          <div className="hd"><h4>{pts.length ? <>Worth adding near <em>Day {di + 1}</em></> : <>Popular in <em>Kyoto</em></>}</h4>
            <span className="pg">{pages > 1 && <><button type="button" onClick={() => setPageAt((p) => (p - 1 + pages) % pages)} aria-label="Previous places">‹</button><button type="button" onClick={() => setPageAt((p) => (p + 1) % pages)} aria-label="More places">›</button></>}<button type="button" className="lnk" onClick={() => setSheet('add')}>View all</button></span></div>
          <div className="cards">
            {worth.slice(page * perPage, page * perPage + perPage).map((x) => (
              <div key={x.id} className="pc" onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); setDrag({ id: x.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }); } }}
                role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') addPlace(x.id); }} aria-label={`Add ${x.name} to Day ${di + 1}`} title="Click to add to the day, or drag onto an ema">
                <div className={'im' + (x.photo ? '' : ' none')} style={x.photo ? { backgroundImage: `url("${BASE}${x.photo.src}")` } : null}>{!x.photo && <Ic k="house" s={30} />}</div>
                <span className="add" aria-hidden="true"><Ic k="plus" s={16} /></span>
                <div className="tx"><b>{x.name}</b><small>{[x.cat, x.area].filter(Boolean).join(' · ')}</small><em>{x.photo ? `Photo: ${x.photo.artist || 'unknown'} · ${x.photo.license}` : 'No photo'} · click to add, or drag onto an ema</em></div>
              </div>
            ))}
            {!worth.length && <p className="muted">No other places with records within 1 km of this day's stops.</p>}
          </div>
        </section>
      )}

      <button type="button" className="tp-support" onClick={() => setSheet('help')}><Ic k="support" s={26} />Support</button>
      <nav className="tp-dock" aria-label="Day tools">
        <button type="button" className={'act' + (playing ? ' on' : '')} onClick={play} aria-pressed={playing}><Ic k={playing ? 'stop' : 'play'} s={24} />{playing ? 'Stop' : 'Play day'}</button>
        <button type="button" onClick={() => setSheet(sheet === 'hours' ? null : 'hours')} aria-expanded={sheet === 'hours'}><Ic k="clock" s={24} />{day.start} – {day.end}</button>
        <button type="button" className="fab" data-fab="" onClick={() => setSheet('add')} aria-label={`Add a place to Day ${di + 1}`}><Ic k="plus" s={34} strokeWidth="2.6" /></button>
        <button type="button" onClick={findOrder}><Ic k="order" s={24} />Best order</button>
        <button type="button" onClick={exportIcs}><Ic k="ics" s={24} />Export .ics</button>
      </nav>
      <p className="tp-foot">Your plan stays in this browser. Routes: {ROUTE_SERVICE.name}. Bus: Kyoto City Bus data in this project, no timetable. Weather: Open-Meteo. Photos: Wikimedia Commons.</p>

      {sheet === 'hours' && (
        <div className="tp-pop hours" role="dialog" aria-label={`Day ${di + 1} hours`}>
          <p>Day {di + 1} · {TP.dateLong(day.date)}</p>
          <label>Start <input type="time" step="300" value={day.start} onChange={(e) => setTrip((t) => TP.setHours(t, di, e.target.value, t.days[di].end))} /></label>
          <label>End <input type="time" step="300" value={day.end} onChange={(e) => setTrip((t) => TP.setHours(t, di, t.days[di].start, e.target.value))} /></label>
          <button type="button" className="tp-btn sm" onClick={() => setSheet(null)}>Done</button>
        </div>
      )}
      {sheet === 'notes' && (
        <div className="tp-pop notes" role="dialog" aria-label="Plan notes">
          <p><b>Plan notes · Day {di + 1}</b></p>
          {notes.length ? <ul>{notes.map((n, k) => <li key={k}>{n}</li>)}</ul> : <p className="muted">Nothing to check on this day.</p>}
        </div>
      )}
      {sheet === 'add' && <AddSheet kind0={addKind} A={A} Tr={Tr} info={info} trip={trip} di={di} query={query} setQuery={setQuery} onAdd={addPlace} onFrom={(id) => { setTrip((t) => TP.setFrom(t, di, id)); say('Start place set.'); }} onClose={() => { setSheet(null); setQuery(''); setAddKind('all'); }} />}
      {sheet === 'order' && order && (
        <div className="tp-modal" role="dialog" aria-label="Best order"><div className="tp-sheet small">
          <header><h4>Best order · Day {di + 1}</h4><button type="button" className="x" onClick={() => setSheet(null)} aria-label="Close"><Ic k="x" /></button></header>
          {order.pending && <p>Asking the routing service for {MODE_TEXT[order.prof].toLowerCase()} times between every pair of places…</p>}
          {order.error && <p className="warn">{order.error}</p>}
          {order.best && (
            <>
              <p>{MODE_TEXT[order.prof]} time between your places, from the routing service. Your start stays first; bus rides are not counted (no timetable).</p>
              <div className="cmp"><span>Now<b>{fmtDuration(order.now)}</b></span><span>Best order<b>{fmtDuration(order.then)}</b></span></div>
              <ol>{order.best.map((k) => <li key={k}>{info(pts[k].id)?.name}</li>)}</ol>
              <div className="row"><button type="button" className="tp-btn" onClick={applyOrder} disabled={order.then >= order.now - 30}>{order.then >= order.now - 30 ? 'Already the best order' : 'Use this order'}</button><button type="button" className="tp-btn ghost" onClick={() => setSheet(null)}>Keep mine</button></div>
            </>
          )}
        </div></div>
      )}
      {sheet === 'help' && <Help onClose={() => setSheet(null)} onAsk={onAsk} onReset={() => { setTrip(TP.emptyTrip()); legCache.clear(); setActive(0); setPlanner(null); setSheet(null); say('Your plan was cleared.'); }} />}
      {drag?.moved && <div className="tp-ghost" style={{ left: drag.x, top: drag.y }}>{info(drag.id)?.name}</div>}
      {toast && <p className="tp-toast" role="status">{toast}</p>}
    </section>
  );
}

function useAllLegs(trip, ctx, enabled) {
  const [, bump] = useState(0);
  const all = trip.days.map((x) => { const ps = TP.dayPoints(x); return ps.map((p, i) => (i ? `${ps[i - 1].id}>${p.id}|${p.mode}|${p.bus ? `${p.bus.variant}:${p.bus.boardSeq}:${p.bus.alightSeq}` : ''}` : null)); });
  const sig = all.map((x) => x.join(',')).join(';');
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    (async () => {
      for (const [j, keys] of all.entries()) {
        const ps = TP.dayPoints(trip.days[j]);
        for (let i = 1; i < keys.length; i++) {
          if (ctx.legCache.has(keys[i])) continue;
          ctx.legCache.set(keys[i], { pending: true });
          const r = await resolveLeg(ctx, ps[i - 1], ps[i]).catch((e) => ({ error: String(e.message || e) }));
          ctx.legCache.set(keys[i], r);
          if (live) bump((n) => n + 1);
        }
      }
    })();
    return () => { live = false; };
  }, [sig, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return all.map((keys) => keys.map((k) => (k ? ctx.legCache.get(k) || { pending: true } : null)));
}

// ---------- the day's strip: a calm timeline that hangs from its ema ----------
// One line per place (time, photo, name, one quiet detail); between places, one small pill for the way
// there. Everything else waits until asked for: the hours, a place's stay and arrival time, the way of
// travel and the bus to take open in place, one at a time.
const fmtStay = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);
const legShort = (leg, mode) => {
  if (!leg || leg.pending) return { t: 'Finding the way…', k: 'wait' };
  if (leg.error && !leg.option) return { t: mode === 'bus' ? 'No bus found' : 'No route found', k: 'warn' };
  if (leg.mode === 'bus') { const o = leg.option; return { t: `${o.number} · ${o.stops} stop${o.stops > 1 ? 's' : ''}${o.fare?.adult != null ? ` · ¥${o.fare.adult}` : ''}`, k: 'bus' }; }
  const far = (leg.mode === 'foot' && leg.duration_s > 7200) || (leg.mode === 'bike' && leg.duration_s > 10800);
  return { t: `${MODE_TEXT[leg.mode]} ${fmtDuration(leg.duration_s)}${far ? ' · far, try bus or drive' : ''}`, k: far ? 'warn' : leg.mode };
};
function Planner({ trip, di, setTrip, info, ctx, onClose, onAdd, onStart, onFocus, say }) {
  const day = trip.days[di];
  const legs = useLegs(day, ctx);
  const tl = TP.timeline(day, legs.map((l) => (l && !l.pending ? { duration_s: l.duration_s } : null)));
  const off = day.from ? 1 : 0;
  const from = day.from ? info(day.from) : null;
  const [open, setOpen] = useState(null);       // 'hours' | 'stop:i' | 'leg:i'
  const tog = (k) => setOpen((o) => (o === k ? null : k));
  useEffect(() => { const m = /^stop:(\d+)$/.exec(open || ''); onFocus?.(m ? +m[1] : null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const dd = new Date(`${day.date}T00:00:00Z`);
  const wk = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(dd).toUpperCase();
  const big = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(dd);
  const patch = (si, p) => setTrip((t) => TP.patchStop(t, di, si, p));
  return (
    <div className="tp-strip" role="dialog" aria-label={`Day ${di + 1} plan`}>
      <header className="ds-h">
        <div><p className="ds-k">{wk} · DAY {di + 1}</p><h4>{big}</h4></div>
        <span className="ds-acts">
          <button type="button" onClick={onAdd} aria-label="Add a place to this day"><Ic k="plus" s={18} /></button>
          <button type="button" className="ds-close" onClick={onClose} aria-label="Roll the day up"><Ic k="up" s={18} /></button>
        </span>
      </header>
      <button type="button" className={'ds-hours' + (open === 'hours' ? ' on' : '')} onClick={() => tog('hours')} aria-expanded={open === 'hours'}>
        <Ic k="clock" s={15} /> {day.start} – {day.end}
        <span className={tl.overrun ? 'warn' : ''}>{tl.overrun ? ` · runs ${fmtDuration(tl.overrun * 60)} over` : tl.finish != null && day.stops.length ? ` · ends about ${TP.fmtHM(tl.finish)}` : ''}</span>
      </button>
      {open === 'hours' && (
        <div className="ds-edit">
          <label>Start <input type="time" step="300" value={day.start} onChange={(e) => setTrip((t) => TP.setHours(t, di, e.target.value, t.days[di].end))} /></label>
          <label>End <input type="time" step="300" value={day.end} onChange={(e) => setTrip((t) => TP.setHours(t, di, t.days[di].start, e.target.value))} /></label>
          {trip.days.length > 1 && <button type="button" className="lnk warn" onClick={() => { setTrip((t) => TP.removeDay(t, di)); onClose(); say(`Day ${di + 1} removed.`); }}>Remove this day</button>}
        </div>
      )}
      <ol className="ds-tl">
        <li className="ds-row start" style={{ '--i': 0 }}>
          <div className="ds-stop static">
            <span className="t">{day.start}</span><i className="ds-dot" />
            {from ? <span className="nm"><b>{from.name}</b><small>Start · {from.cat}</small></span> : <button type="button" className="lnk nm" onClick={onStart}>Set where the day starts</button>}
            {from && <button type="button" className="ic ghost" onClick={() => setTrip((t) => TP.setFrom(t, di, null))} aria-label="Remove the start place"><Ic k="x" s={14} /></button>}
          </div>
        </li>
        {day.stops.map((s, si) => {
          const x = info(s.id), t = tl.points[si + off], leg = legs[si + off], hasLeg = si > 0 || !!from;
          const L = legShort(leg, s.mode), kl = `leg:${si}`, ks = `stop:${si}`;
          return [
            hasLeg && (
              <li key={`l${s.id}`} className="ds-leg" style={{ '--i': si * 2 + 1 }}>
                <button type="button" className={'ds-pill ' + L.k + (open === kl ? ' on' : '')} onClick={() => tog(kl)} aria-expanded={open === kl} title={legText(leg)}>
                  <i className={'mi ' + s.mode} aria-hidden="true" />{L.t}
                </button>
                {s.mode === 'bus' && leg?.option && <span className="nt">no timetable</span>}
                {open === kl && (
                  <div className="ds-pop">
                    <div className="ds-seg" role="group" aria-label={`How to get to ${x?.name}`}>
                      {TP.LEG_MODES.map((m) => <button key={m.key} type="button" className={'m ' + m.key + (s.mode === m.key ? ' on' : '')} aria-pressed={s.mode === m.key} onClick={() => patch(si, { mode: m.key, bus: null })}>{m.label}</button>)}
                    </div>
                    <p className="lt">{legText(leg)}</p>
                    {leg?.mode === 'bus' && leg.options?.length > 0 && (
                      <ul className="buses">
                        {leg.options.map((o) => {
                          const on = o.variant === leg.option.variant && o.boardSeq === leg.option.boardSeq;
                          return (
                            <li key={`${o.variant}:${o.boardSeq}`}><button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => patch(si, { bus: { variant: o.variant, boardSeq: o.boardSeq, alightSeq: o.alightSeq } })}>
                              <b>{o.number}</b><span>{o.boardName} → {o.alightName}</span><em>{o.stops} stop{o.stops > 1 ? 's' : ''}{o.fare?.adult != null ? ` · ¥${o.fare.adult}` : ''}</em>
                            </button></li>
                          );
                        })}
                      </ul>
                    )}
                    {leg?.mode === 'bus' && leg.option && <p className="xs muted">Stops searched within {leg.found.radiusA} m and {leg.found.radiusB} m. Stop order from OpenStreetMap{leg.option.orderChecked ? '' : ', not yet checked against the official list'}. No timetable: set an arrival time for the next place.</p>}
                  </div>
                )}
              </li>
            ),
            <li key={s.id} className={'ds-row' + (open === ks ? ' open' : '') + (t?.late ? ' late' : '')} style={{ '--i': si * 2 + 2 }}>
              <button type="button" className="ds-stop" onClick={() => tog(ks)} aria-expanded={open === ks}>
                <span className="t">{t?.arrive != null ? TP.fmtHM(t.arrive) : '––:––'}</span><i className="ds-dot" />
                {x?.photo ? <i className="th" style={{ backgroundImage: `url("${BASE}${x.photo.src}")` }} /> : <i className="th none"><Ic k="house" s={16} /></i>}
                <span className="nm"><b>{x?.name || s.id}</b><small>{x?.cat} · stay {fmtStay(s.stay ?? TP.DEFAULT_STAY)}{s.at ? ` · arrive ${s.at}` : ''}{t?.late ? ' · too late for the set time' : ''}</small></span>
              </button>
              {open === ks && (
                <div className="ds-edit">
                  <span className="stp">Stay <button type="button" onClick={() => patch(si, { stay: Math.max(0, (s.stay ?? TP.DEFAULT_STAY) - 15) })} aria-label="Stay 15 minutes less">−</button><b>{fmtStay(s.stay ?? TP.DEFAULT_STAY)}</b><button type="button" onClick={() => patch(si, { stay: Math.min(600, (s.stay ?? TP.DEFAULT_STAY) + 15) })} aria-label="Stay 15 minutes more">+</button></span>
                  <label>Arrive <input type="time" step="300" value={s.at || ''} onChange={(e) => patch(si, { at: e.target.value || null })} /></label>
                  <span className="mv">
                    <button type="button" className="ic" disabled={si === 0} onClick={() => { setTrip((tt) => TP.moveStop(tt, di, si, si - 1)); setOpen(`stop:${si - 1}`); }} aria-label="Earlier"><Ic k="up" s={15} /></button>
                    <button type="button" className="ic" disabled={si === day.stops.length - 1} onClick={() => { setTrip((tt) => TP.moveStop(tt, di, si, si + 1)); setOpen(`stop:${si + 1}`); }} aria-label="Later"><Ic k="down" s={15} /></button>
                    {trip.days.length > 1 && (
                      <select value="" onChange={(e) => { if (e.target.value !== '') { setTrip((tt) => TP.moveStopToDay(tt, di, si, +e.target.value)); setOpen(null); say(`Moved to Day ${+e.target.value + 1}.`); } }} aria-label="Move to another day">
                        <option value="">Move to…</option>{trip.days.map((_, j) => j !== di && <option key={j} value={j}>Day {j + 1}</option>)}
                      </select>
                    )}
                    <button type="button" className="ic" onClick={() => { setTrip((tt) => TP.removeStop(tt, di, si)); setOpen(null); }} aria-label={`Remove ${x?.name}`}><Ic k="trash" s={15} /></button>
                  </span>
                </div>
              )}
            </li>,
          ];
        })}
      </ol>
      {!day.stops.length && <p className="ds-empty">Nothing on this day yet.</p>}
      <footer className="ds-f">
        <button type="button" className="lnk" onClick={onAdd}><Ic k="plus" s={15} /> Add a place</button>
        <em>one place at a time.</em>
      </footer>
    </div>
  );
}

// ---------- add a place ----------
function AddSheet({ kind0 = 'all', A, Tr, info, trip, di, query, setQuery, onAdd, onFrom, onClose }) {
  const [kind, setKind] = useState(kind0);
  const [target, setTarget] = useState(di);
  const q = query.trim().toLowerCase();
  const KINDS = [['all', 'All'], ['temple', 'Temples'], ['shrine', 'Shrines'], ['museum', 'Museums'], ['garden', 'Gardens'], ['viewpoint', 'Viewpoints'], ['station', 'Stations']];
  const list = useMemo(() => {
    const pool = kind === 'station' ? Tr.filter((f) => f.properties.transport_type === 'rail') : A.filter((f) => kind === 'all' || f.properties.category === kind);
    const hit = (f) => { const p = f.properties; return !q || [p.name, p.name_en, p.display_name, p.search_text, p.id].some((v) => v && String(v).toLowerCase().includes(q)); };
    return pool.filter(hit).map((f) => info(f.properties.id)).filter(Boolean).sort((a, b) => (!!b.photo - !!a.photo) || ((ICONIC[a.id]?.rank ?? 99) - (ICONIC[b.id]?.rank ?? 99)) || a.name.localeCompare(b.name)).slice(0, 60);
  }, [kind, q, A, Tr]); // eslint-disable-line react-hooks/exhaustive-deps
  const inDay = new Set(trip.days[target]?.stops.map((s) => s.id));
  return (
    <div className="tp-modal" role="dialog" aria-label="Add a place" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tp-sheet">
        <header><h4>Add a place</h4>
          <label className="to">to <select value={target} onChange={(e) => setTarget(+e.target.value)}>{trip.days.map((x, j) => <option key={x.id} value={j}>Day {j + 1} · {TP.dayLabel(x.date)}</option>)}</select></label>
          <button type="button" className="x" onClick={onClose} aria-label="Close"><Ic k="x" /></button></header>
        <label className="tp-search in"><Ic k="search" /><input autoFocus type="search" placeholder="Name in English or Japanese" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search places" /></label>
        <div className="kinds">{KINDS.map(([k, l]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>{l}</button>)}</div>
        <ul className="res">
          {list.map((x) => (
            <li key={x.id}>
              {x.photo ? <i className="th" style={{ backgroundImage: `url("${BASE}${x.photo.src}")` }} /> : <i className="th none"><Ic k="house" s={18} /></i>}
              <span className="nm"><b>{x.name}</b><small>{x.ja && <span lang="ja">{x.ja} · </span>}{[x.cat, x.area].filter(Boolean).join(' · ')}</small></span>
              {x.layer === 'transport' && <button type="button" className="tp-btn ghost sm" onClick={() => { onFrom(x.id); onClose(); }}>Start here</button>}
              <button type="button" className="tp-btn sm" disabled={inDay.has(x.id)} onClick={() => onAdd(x.id, target)}>{inDay.has(x.id) ? 'Added' : `Add to Day ${target + 1}`}</button>
            </li>
          ))}
          {!list.length && <li className="muted">No records match.</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------- all days as a list ----------
function Agenda({ trip, info, allLegs, onOpen }) {
  return (
    <div className="tp-agenda">
      {trip.days.map((x, j) => {
        const ls = allLegs[j] || [];
        const tl = TP.timeline(x, ls.map((l) => (l && !l.pending ? { duration_s: l.duration_s } : null)));
        const ps = TP.dayPoints(x);
        return (
          <section key={x.id} className="tp-card col" style={{ '--dc': DAY_HUES[j % 7] }}>
            <header><b>Day {j + 1}</b><span>{TP.dateLong(x.date)} · {x.start}–{x.end}</span><button type="button" className="lnk" onClick={() => onOpen(j)}>Edit ›</button></header>
            {ps.length ? (
              <ol>{ps.map((p, i) => { const q = info(p.id); return (
                <li key={p.id + i}>
                  {i > 0 && <span className="lg">{legText(ls[i], true)}</span>}
                  <span className="t">{tl.points[i]?.arrive != null ? TP.fmtHM(tl.points[i].arrive) : '–:–'}</span><b>{p.start ? 'Start · ' : ''}{q?.name || p.id}</b>
                </li>); })}</ol>
            ) : <p className="muted">Nothing planned. <button type="button" className="lnk" onClick={() => onOpen(j)}>Plan this day</button></p>}
            {tl.overrun > 0 && <p className="warn">Runs {fmtDuration(tl.overrun * 60)} past {x.end}.</p>}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Support ----------
function Help({ onClose, onReset, onAsk }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="tp-modal" role="dialog" aria-label="Support" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tp-sheet help">
        <header><h4>Support</h4><button type="button" className="x" onClick={onClose} aria-label="Close"><Ic k="x" /></button></header>
        {onAsk && (
          <div className="tp-ask">
            <div>
              <h5>Ask the assistant</h5>
              <p>Ask about places, weather, buses and fares, or have it add places to a day for you. It uses Google’s Gemini with this atlas’s data, and shows everything it does.</p>
            </div>
            <button type="button" className="tp-btn sm" onClick={() => { onClose(); onAsk(); }}>Ask</button>
          </div>
        )}
        <h5>Planning</h5>
        <ol>
          <li>Click an ema (or the board) to open that day's plan. The “+” ema adds a day (up to {TP.MAX_DAYS}).</li>
          <li>Add places with the round + button, the search box, or the cards at the bottom: click a card, or drag it onto an ema.</li>
          <li>For each place, choose how to get there: walk, bus, cycle or drive. Set how long you stay and, if you like, a time to arrive.</li>
          <li>Play day walks the day's route on the map. Best order puts your places in the order with the least travel. Export .ics saves the plan for your calendar.</li>
        </ol>
        <h5>Where the numbers come from</h5>
        <ul>
          <li>Walking, cycling and driving routes and times: {ROUTE_SERVICE.name} ({ROUTE_SERVICE.host}), OpenStreetMap data.</li>
          <li>Bus: the Kyoto City Bus routes in this project, their stop order (OpenStreetMap) and official fares. There is no timetable, so a bus ride has no time: set an arrival time after it. Other operators are not included.</li>
          <li>Bus stops are searched within 500 m of a place, widened to 800 m and 1 km when none is found. The walk to the stop is routed.</li>
          <li>Weather: Open-Meteo forecast at the hour you plan to arrive, 7 days ahead.</li>
          <li>Photos: Wikimedia Commons, with author and licence. The scene with the notice board is an AI-generated illustration, not a photo.</li>
          <li>Stay lengths start at {TP.DEFAULT_STAY} minutes: that is a planning estimate for you to change, not a fact about the place.</li>
        </ul>
        <h5>Your plan</h5>
        <p>The plan is saved in this browser only. It is not sent anywhere.</p>
        {sure ? <p className="row"><span className="warn">Clear every day of this plan?</span><button type="button" className="tp-btn sm" onClick={onReset}>Clear the plan</button><button type="button" className="tp-btn ghost sm" onClick={() => setSure(false)}>Keep it</button></p>
          : <button type="button" className="tp-btn ghost sm" onClick={() => setSure(true)}>Clear the plan…</button>}
      </div>
    </div>
  );
}
