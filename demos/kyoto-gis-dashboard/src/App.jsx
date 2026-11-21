import { useEffect, useMemo, useRef, useState } from 'react';
import { iconURL } from './lib/icons.js';
import { landmarkURL, ICONIC } from './lib/landmarks.js';
import { MODES, TRANSIT_NOTE, ROUTE_SERVICE, modeOf, fetchRoute, fmtDuration, fmtDistance, initialMode, rememberMode } from './lib/route.js';
import MapView, { BASEMAPS, KDE_BREAKS, kdeColors, OFFLINE_PREVIEW } from './MapView.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import Weather from './Weather.jsx';
import Landing from './Landing.jsx';
import SeasonStory from './SeasonStory.jsx';
import Outro from './Outro.jsx';
import Explore from './Explore.jsx';
import Features from './Features.jsx';
import MusicPlayer from './MusicPlayer.jsx';
import Panorama from './Panorama.jsx';
import Seam from './Seam.jsx';
import Pager from './Pager.jsx';
import Bento, { Tile, resetBento } from './Bento.jsx';
import Koi from './Koi.jsx';
import CursorLight, { CursorFxToggle, cursorFxInitial, saveCursorFx } from './CursorLight.jsx';
import Density3D from './Density3D.jsx';
import { installGlassGlow } from './lib/glassGlow.js';
import { SeasonBadge } from './Season.jsx';
import { seasonFor, initialSeasonMode, rememberSeasonMode } from './lib/season.js';
import { loadAll, ATTRACTION_CATS, TRANSPORT_TYPES, CATEGORY_LABEL, countBy, filterAttractions, filterTransport, recordLabel, labelText, LABEL_NOTE, muniLabel, englishPart, muniTourism, setEnglishFirst, isEnglishFirst } from './lib/data.js';
import { nameTerms } from './lib/terms.js';
import { themeOf, pointColor, initialTheme, rememberTheme } from './lib/theme.js';
import { walkingAvailability, indexWalking, walkingCoverage, IDENTITIES, CUTOFF_M } from './lib/walking.js';

// 「日文名称 (English name)」 with the English part styled lighter; original alone if none is verified.
// With "English first" on: English (日文). A record with no OSM name shows the English name of the same
// OSM record if there is one, otherwise its fallback label.
function NameEn({ p }) {
  if (!p.name) return <>{p.name_en || (p.label_kind ? labelText(p) : p.display_name)}</>;
  const en = englishPart(p.name, p.name_en);
  if (en && isEnglishFirst()) return <><span lang="en">{en}</span><span className="en" lang="ja"> ({p.name})</span></>;
  return <>{p.name}{en && <span className="en" lang="en"> ({en})</span>}</>;
}

// "English first" name order, remembered per browser (storage may be unavailable).
const EN_KEY = 'kyoto-gis-en-first';
const initialEnFirst = () => { try { return localStorage.getItem(EN_KEY) === '1'; } catch { return false; } };
setEnglishFirst(initialEnFirst());

// English name "decodes" into place: random Latin letters settle left to right (~0.7 s).
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function Decode({ text, className, lang }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(text); return; }
    let raf;
    const t0 = performance.now(), dur = 700;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const n = Math.floor(text.length * k);
      setShown(text.slice(0, n) + [...text.slice(n)].map((ch) => (/[A-Za-z]/.test(ch) ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : ch)).join(''));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <span className={className} lang={lang} aria-label={text}><span aria-hidden="true">{shown}</span></span>;
}

// Number that rolls to its new value (respects reduced motion).
function Rolling({ value }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShown(value); from.current = value; return; }
    const a = from.current, t0 = performance.now();
    let raf;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 520), e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString('en-US')}</>;
}

const isPhone = () => typeof innerWidth === 'number' && innerWidth <= 760;
// Map and side panel share the width; the panel's share is remembered. Limits keep both usable.
const PANEL_KEY = 'kyoto-gis-panel-v2', CINE_KEY = 'kyoto-gis-cinematic';
// about 65 % map and 35 % panel; the panel never gets narrower than 360 px (below that the layout stacks)
const PANEL_DEFAULT = 0.35, MIN_PANEL = 360, MIN_MAP = 370, SPLIT = 12;   // the map column includes its 10 px frame
// layouts saved by earlier versions do not fit the new panel: drop them once, so it opens in the default order
try { ['kyoto-gis-panel', 'kyoto-gis-bento-explore', 'kyoto-gis-bento-place'].forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
const readNum = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* not stored */ } };
const bboxCache = new WeakMap();
const bboxOf = (fc) => {
  if (!fc?.features?.length) return null;
  if (!bboxCache.has(fc)) bboxCache.set(fc, fc.features.reduce((b, f) => f.geometry.coordinates.reduce((q, [x, y]) => [Math.min(q[0], x), Math.min(q[1], y), Math.max(q[2], x), Math.max(q[3], y)], b), [180, 90, -180, -90]));
  return bboxCache.get(fc);
};
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));

export default function App() {
  const [loaded, setLoaded] = useState(null);
  const [theme, setThemeState] = useState(initialTheme);
  const [cursorFx, setCursorFxState] = useState(cursorFxInitial);   // pointer light on/off, remembered
  const setCursorFx = (on) => { setCursorFxState(on); saveCursorFx(on); };
  const [cats, setCats] = useState(ATTRACTION_CATS.map((c) => c.key));
  const [types, setTypes] = useState(TRANSPORT_TYPES.map((t) => t.key));
  const [query, setQuery] = useState('');
  const [densityMode, setDensityMode] = useState('off');
  const [basemap, setBasemap] = useState('night');
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [sheet, setSheet] = useState(null); // 'journeys' | 'sources' | 'records' | null
  const [geoOn, setGeoOn] = useState(false);   // the Places and landscape layer
  const [recFocus, setRecFocus] = useState(null); // a Kyoto City record to open in the library
  const [maxWalk, setMaxWalk] = useState(500);
  const [walkTypes, setWalkTypes] = useState(['bus', 'rail']);
  const [walkShow, setWalkShow] = useState(false);
  const [enFirst, setEnFirstState] = useState(isEnglishFirst);
  const toggleEnFirst = () => { const v = !enFirst; setEnglishFirst(v); setEnFirstState(v); try { localStorage.setItem(EN_KEY, v ? '1' : '0'); } catch { /* not stored */ } };
  // Which attraction records the walking summary and map include (unverified ones are off by default).
  const [walkIdent, setWalkIdent] = useState(['named', 'osm_tags']);
  const [focus, setFocus] = useState(null); // hovered category / transit type in the filter list
  // one information panel beside the map: Explore (search, filters, analysis) and Place (the selected record)
  const [rightOpen, setRightOpen] = useState(() => !isPhone());
  const [ptab, setPtab] = useState('explore');
  const panelRef = useRef(null);
  const scrollPos = useRef({});
  // switching Explore / Place keeps each tab's own scroll position (search, filters and map are state)
  const switchTab = (t) => {
    if (t === ptab) return;
    if (panelRef.current) scrollPos.current[ptab] = panelRef.current.scrollTop;
    setPtab(t);
    requestAnimationFrame(() => { if (panelRef.current) panelRef.current.scrollTop = scrollPos.current[t] || 0; });
  };
  const [anOpen, setAnOpen] = useState(false);      // Analysis fold
  const [layersOpen, setLayersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);  // "More about this place"
  const [bentoReset, setBentoReset] = useState(0);
  const [panelFrac, setPanelFrac] = useState(() => Math.min(0.9, Math.max(0.1, readNum(PANEL_KEY, PANEL_DEFAULT))));
  const appRef = useRef(null);
  // routes: an explicit start (never assumed), the selected place as the end
  const [origin, setOrigin] = useState(null);
  const [picking, setPicking] = useState(false);
  const [routeMode, setRouteModeState] = useState(initialMode);
  const setRouteMode = (m) => { setRouteModeState(m); rememberMode(m); };
  const [routeRes, setRouteRes] = useState(null);
  const [routeTry, setRouteTry] = useState(0);
  const [locErr, setLocErr] = useState(null);
  const [cinematic, setCinematicState] = useState(() => readNum(CINE_KEY, 0) === 1);
  const setCinematic = (v) => { setCinematicState(v); store(CINE_KEY, v ? 1 : 0); };
  const [tilted, setTilted] = useState(false);
  const [covShow, setCovShow] = useState({ on: false, token: 0 });
  const [pointsOn, setPointsOn] = useState(true);
  // 3D density: while it is on, the 2D density layers and the points are switched off, and put back after
  const [d3, setD3] = useState(false);
  const d3prev = useRef(null);
  const toggle3d = () => {
    if (!d3) { d3prev.current = { densityMode, pointsOn }; setDensityMode('off'); setPointsOn(false); setD3(true); }
    else { setD3(false); if (d3prev.current) { setDensityMode(d3prev.current.densityMode); setPointsOn(d3prev.current.pointsOn); } }
  };
  const [panel, setPanel] = useState(null); // which analysis is expanded: 'density' | 'walk' | null
  const [tab, setTab] = useState('overview');
  const [legend, setLegend] = useState(false);
  const [visit, setVisit] = useState({ day: null, hour: null }); // planned visit, shared by every place
  // Bus routes (Kyoto City Bus only). busRun: one direction being shown; busHl: stop points of a route without a usable line.
  const [busRoute, setBusRoute] = useState('');
  const [busRun, setBusRun] = useState(null);
  const [busHl, setBusHl] = useState(null);
  const [busProg, setBusProg] = useState({ idx: -1, done: false });
  const [busErr, setBusErr] = useState(null);
  const busCache = useRef(new Map());
  const busCtl = useRef(null);
  const busToken = useRef(0);
  const mapRef = useRef(null);
  const resetViewRef = useRef(null);
  const [introDone, setIntroDone] = useState(false);
  // The dashboard's own entrance plays when it first scrolls into view (it sits below the intro).
  const [dashSeen, setDashSeen] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const el = document.getElementById('dashboard');
    if (location.hash === '#dashboard') el?.scrollIntoView();
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.intersectionRatio > 0.55 || e.intersectionRect.height > innerHeight * 0.5)) { setDashSeen(true); io.disconnect(); } }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.55, 0.7, 1] });
    if (el) io.observe(el);
    return () => io.disconnect();
  }, [loaded]);
  useEffect(() => { if (dashSeen) { const t = setTimeout(() => setIntroDone(true), 2400); return () => clearTimeout(t); } }, [dashSeen]);

  useEffect(() => { loadAll().then(setLoaded); }, []);
  // Season of the visual theme: Kyoto's date (JST) by default, or a season picked by the viewer.
  // Loaded on its own so the intro already shows it; without the file the JMA month season is used.
  const [seasonInfo, setSeasonInfo] = useState(null);
  const [seasonMode, setSeasonModeState] = useState(initialSeasonMode);
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/season_kyoto.json`).then((r) => (r.ok ? r.json() : null)).then(setSeasonInfo).catch(() => {}); }, []);
  const seasonAuto = useMemo(() => seasonFor(new Date(), seasonInfo), [seasonInfo]);
  const visualSeason = seasonMode === 'auto' ? seasonAuto.visual : seasonMode;
  useEffect(() => { document.documentElement.dataset.season = visualSeason; }, [visualSeason]);
  const setSeasonMode = (m) => { setSeasonModeState(m); rememberSeasonMode(m); };
  // Theme: only colours change. Filters, selection, analysis state and the planned visit are untouched.
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const setTheme = (t) => { document.documentElement.dataset.theme = t; setThemeState(t); rememberTheme(t); };
  const T = themeOf(theme);
  const dotColor = (f) => pointColor(f.properties, theme);

  const d = loaded?.data;
  const A = d?.attractions?.features || [];
  const Tr = d?.transport?.features || [];
  const byId = useMemo(() => {
    const m = new Map();
    A.forEach((f) => m.set(f.properties.id, { f, layer: 'attraction' }));
    Tr.forEach((f) => m.set(f.properties.id, { f, layer: 'transport' }));
    return m;
  }, [A, Tr]);
  const fa = useMemo(() => filterAttractions(A, cats, query), [A, cats, query]);
  const ft = useMemo(() => filterTransport(Tr, types, query), [Tr, types, query]);
  const catCount = useMemo(() => countBy(A, 'category'), [A]);
  // Kyoto City records by ID, and the records whose text names each map record
  const recById = useMemo(() => {
    const m = new Map((d?.records?.records || []).map((r) => [r.id, r]));
    m.mentions = new Map();
    for (const r of d?.records?.records || []) for (const id of r.mentions || []) { if (!m.mentions.has(id)) m.mentions.set(id, []); m.mentions.get(id).push(r); }
    return m;
  }, [d?.records]);
  const typeCount = useMemo(() => countBy(Tr, 'transport_type'), [Tr]);
  const subCount = useMemo(() => countBy(Tr, 'category'), [Tr]);
  const walk = useMemo(() => walkingAvailability(d?.walking), [d]);
  const walkIndex = useMemo(() => (walk.available ? indexWalking(d.walking) : null), [walk, d]);
  // Records without an identity level (pilot file) always count.
  const identOk = (id) => { const v = walkIndex?.identity.get(id); return !v || walkIdent.includes(v); };
  const coverage = useMemo(() => {
    if (!walkIndex) return null;
    const ids = A.filter((f) => cats.includes(f.properties.category) && walk.scopeIds.has(f.properties.id) && identOk(f.properties.id)).map((f) => f.properties.id);
    return walkingCoverage(walkIndex, ids, walkTypes, maxWalk);
  }, [walkIndex, walk, A, cats, walkTypes, maxWalk, walkIdent]); // eslint-disable-line react-hooks/exhaustive-deps
  const identCount = useMemo(() => {
    const c = {};
    walkIndex?.identity.forEach((v) => { c[v] = (c[v] || 0) + 1; });
    return c;
  }, [walkIndex]);
  // What the map shows: the selected attraction's routes, or (after the walking controls are
  // used) every route for the chosen stop types, categories and identity levels.
  const walkSet = useMemo(() => {
    if (!walk.available) return null;
    const ok = (f) => f.geometry && f.properties.route_status === 'ok' && walkTypes.includes(f.properties.stop_type);
    const item = (f) => {
      const st = byId.get(f.properties.stop_id)?.f;
      return st ? { feature: f, stop: { id: st.properties.id, name: recordLabel(st.properties), coords: st.geometry.coordinates, type: f.properties.stop_type } } : null;
    };
    let mode = null, feats = [];
    // a point-to-point route is on screen: the nearest-stop walking routes would compete with it
    if (origin && sel && origin.id !== sel.id) return null;
    if (sel && sel.layer === 'attraction' && walk.scopeIds.has(sel.id)) {
      mode = 'one';
      feats = d.walking.features.filter((f) => f.properties.attraction_id === sel.id && ok(f));
    } else if (walkShow && !(sel && sel.layer === 'attraction')) {
      mode = 'all';
      const inCats = new Set(A.filter((f) => cats.includes(f.properties.category)).map((f) => f.properties.id));
      feats = d.walking.features.filter((f) => ok(f) && inCats.has(f.properties.attraction_id) && identOk(f.properties.attraction_id));
    }
    if (!mode) return null;
    return { mode, key: `${mode}|${sel?.id || ''}|${walkTypes.join()}|${cats.join()}|${walkIdent.join()}`, items: feats.map(item).filter(Boolean) };
  }, [walk, d, sel, walkShow, walkTypes, cats, A, byId, walkIdent, origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupOsm = useMemo(() => {
    const m = {};
    (d?.manifest?.transport?.duplicate_osm_ids || []).forEach((x) => x.ids.forEach((id) => (m[id] = x)));
    return m;
  }, [d]);

  const closeBus = () => { busToken.current++; setBusRun(null); setBusHl(null); setBusErr(null); };
  // Show one direction of a route, from a given stop (or from its first stop). Starting a new one replaces the old one at once.
  const startBus = async (route, variantId, stopKey = null, fromPoint = null) => {
    const token = ++busToken.current;
    setBusHl(null);
    setBusErr(null);
    setBusRoute(route.key);
    try {
      let v = busCache.current.get(variantId);
      if (!v) {
        const r = await fetch(`${import.meta.env.BASE_URL}data/bus/variants/${variantId}.json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        v = await r.json();
        busCache.current.set(variantId, v);
      }
      if (token !== busToken.current) return; // a newer choice was made meanwhile
      let startIdx = 0;
      if (stopKey) {
        const i = v.stops.findIndex((x, k) => x.key === stopKey && k < v.stops.length - 1);
        startIdx = i >= 0 ? i : 0;
      }
      setBusProg({ idx: startIdx - 1, done: false });
      setBusRun({ key: `${variantId}|${startIdx}|${token}`, route, variant: v, line: v.line, stops: v.stops, startIdx, stopKey, fromPoint });
    } catch (e) {
      if (token === busToken.current) { setBusRun(null); setBusErr(`Route data could not be loaded (${e.message}). Nothing is drawn instead.`); }
    }
  };
  // A route with no verified line or stop order: only its associated stop points are highlighted.
  const highlightBus = (route) => {
    busToken.current++;
    const ids = [...new Set(route.stop_keys.flatMap((k) => d.bus.stops[k]?.points || []))];
    setBusRun(null);
    setBusErr(null);
    setBusRoute(route.key);
    setBusHl({ route, ids });
    const pts = ids.map((id) => byId.get(id)?.f.geometry.coordinates).filter(Boolean);
    if (pts.length) {
      const bb = pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
      mapRef.current?.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 70, maxZoom: 15, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000 });
    }
  };
  const pickBusRoute = (key) => {
    setBusRoute(key);
    const route = d.bus.routes.find((r) => r.key === key);
    if (!route) return closeBus();
    if (route.variants.length) startBus(route, route.variants[0].id); else highlightBus(route);
  };
  const replayBus = () => { if (busRun) { const token = ++busToken.current; setBusProg({ idx: busRun.startIdx - 1, done: false }); setBusRun({ ...busRun, key: `${busRun.variant.id}|${busRun.startIdx}|${token}` }); } };

  const select = (s, fly = true) => {
    if (picking && s) {   // choosing the start of a route: the clicked place becomes the start
      const hit = byId.get(s.id);
      if (hit) setOrigin({ key: s.id, id: s.id, coords: hit.f.geometry.coordinates, label: recordLabel(hit.f.properties), kind: hit.layer });
      setPicking(false);
      return;
    }
    if (!s) return setSel(null);
    const hit = byId.get(s.id);
    if (!hit) return;
    if (origin && origin.id !== s.id) fly = false;
    // choosing another stop ends the route that was started from the previous stop
    if (hit.layer === 'transport' && busRun?.fromPoint && busRun.fromPoint !== s.id) closeBus();
    const [lon, lat] = hit.f.geometry.coordinates;
    const p = hit.f.properties;
    const ph = d?.photos?.photos?.[s.id];
    setSel({ id: s.id, layer: hit.layer, coords: [lon, lat], fly, label: recordLabel(p), en: !!(p.name && englishPart(p.name, p.name_en)), sub: CATEGORY_LABEL[p.category],
      photo: ph ? { src: `${import.meta.env.BASE_URL}${ph.src}`, related: ph.match === 'wikidata-related' ? ph.matched_label : ph.match === 'site-contains' ? ph.site : null, credit: `${ph.artist} · ${ph.license}` } : null });
    openPanel('place');
    if (hit.layer !== 'attraction') setTab((t) => (t === 'walk' ? 'overview' : t));
    if (!d?.bus?.point_stops?.[s.id]) setTab((t) => (t === 'bus' ? 'overview' : t));
  };
  // ---------- map | panel split ----------
  const resizeMap = () => mapRef.current?.resize();
  // a short eased change (open, close, reset); dragging itself follows the pointer with no transition
  const animateLayout = (fn) => {
    const el = appRef.current;
    if (!el || reduceMotion()) { fn(); requestAnimationFrame(resizeMap); return; }
    el.classList.add('anim');
    fn();
    // follow the eased width every frame; drop the transition only after it has surely ended
    let live = true;
    const f = () => { resizeMap(); if (live) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    setTimeout(() => { live = false; el.classList.remove('anim'); requestAnimationFrame(resizeMap); }, 420);
  };
  const openPanel = (which) => { if (which) switchTab(which); if (!rightOpen) animateLayout(() => setRightOpen(true)); };
  const fracLimits = () => { const w = appRef.current?.clientWidth || innerWidth; return [MIN_PANEL / w, Math.max(MIN_PANEL / w, (w - MIN_MAP - SPLIT) / w)]; };
  const setFrac = (v, commit = true) => {
    const [lo, hi] = fracLimits();
    const f = Math.min(hi, Math.max(lo, v));
    appRef.current?.style.setProperty('--pf', f);
    resizeMap();
    if (commit) { setPanelFrac(f); store(PANEL_KEY, f.toFixed(4)); }
    return f;
  };
  const startDrag = (e) => {
    if (e.button !== 0 || !rightOpen) return;
    const el = appRef.current, bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    let last = panelFrac, raf = 0, x = e.clientX;
    const move = (ev) => {
      x = ev.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; const r = el.getBoundingClientRect(); last = setFrac((r.right - x - SPLIT / 2) / r.width, false); });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      setFrac(last);
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  };
  const splitKey = (e) => {
    const step = e.shiftKey ? 0.06 : 0.02;
    const [lo, hi] = fracLimits();
    const k = { ArrowLeft: panelFrac + step, ArrowRight: panelFrac - step, Home: hi, End: lo }[e.key];
    if (k != null) { e.preventDefault(); if (!rightOpen) animateLayout(() => setRightOpen(true)); else setFrac(k); }
    else if (e.key === 'Enter') { e.preventDefault(); resetLayout(); }
  };
  const resetLayout = () => { resetBento('explore-v2'); setBentoReset((n) => n + 1); animateLayout(() => { setRightOpen(true); setFrac(PANEL_DEFAULT); }); };
  const togglePanel = () => animateLayout(() => setRightOpen(!rightOpen));
  // keep the map the right size when the window changes (the grid recomputes; the map follows)
  useEffect(() => { const r = () => requestAnimationFrame(resizeMap); addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);

  // ---------- route from the chosen start to the selected place (real routing service only) ----------
  useEffect(() => {
    if (!origin || !sel || origin.id === sel.id) { setRouteRes(null); return; }
    const ac = new AbortController();
    const key = `${origin.key}>${sel.id}|${routeMode}|${routeTry}`;
    setRouteRes({ status: 'loading', key });
    fetchRoute(origin.coords, sel.coords, routeMode, ac.signal)
      .then((r) => setRouteRes({ status: 'ok', key, ...r }))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setRouteRes({ status: 'error', key, error: e.message });
        // no route to frame: show the place itself
        mapRef.current?.flyTo({ center: sel.coords, zoom: Math.max(mapRef.current.getZoom(), 13.5), pitch: 0, duration: reduceMotion() ? 0 : 900, essential: true });
      });
    return () => ac.abort();   // a newer click, mode change or closing the details drops this request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.key, sel?.id, routeMode, routeTry]);
  const routeForMap = useMemo(() => (routeRes?.status === 'ok'
    ? { key: routeRes.key, coords: routeRes.coords, timeText: fmtDuration(routeRes.duration_s), distText: fmtDistance(routeRes.distance_m), modeLabel: modeOf(routeRes.mode).label }
    : null), [routeRes]);
  const useMyLocation = () => {
    setLocErr(null);
    if (!navigator.geolocation) { setLocErr('This browser cannot share a location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setOrigin({ key: `loc:${p.coords.longitude.toFixed(5)},${p.coords.latitude.toFixed(5)}`, id: null, coords: [p.coords.longitude, p.coords.latitude], label: 'Your location', kind: 'location', acc: p.coords.accuracy }),
      (e) => setLocErr(e.code === 1 ? 'Location permission was not given. Pick a start on the map instead.' : 'Your location could not be found. Pick a start on the map instead.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const f = () => setTilted(map.getPitch() > 0.5);
    map.on('pitchend', f);
    return () => map.off('pitchend', f);
  }, [mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const topDown = () => mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: reduceMotion() ? 0 : 600 });
  // the callout swatch follows the theme without re-running the camera move
  const routing = !!(origin && sel && origin.id !== sel.id);
  const selForMap = useMemo(() => (sel ? { ...sel, color: pointColor(byId.get(sel.id)?.f.properties || {}, theme), ...(routing ? { label: null, fly: false } : {}), ...(rightOpen && ptab === 'place' ? (isPhone() ? { label: null } : { photo: null }) : {}) } : null), [sel, byId, routing, rightOpen, ptab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Press feedback from the Smart Build chapter: sink on press, squash and spring back on release.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const SEL = '.btn, .seg button, .wx-day, .toc button, .ist-go, .ist-skip, .x, .results button, .entry, .tabs button';
    const down = (e) => {
      const el = e.target.closest?.(SEL);
      if (!el || el.disabled) return;
      el.animate([{ transform: 'none' }, { transform: 'translateY(2px) scale(.94)' }], { duration: 110, fill: 'forwards', easing: 'cubic-bezier(.3,0,.3,1)' });
      const up = () => {
        el.getAnimations().forEach((a) => a.cancel());
        el.animate([{ transform: 'translateY(2px) scale(.94)' }, { transform: 'translateY(2px) scale(1.05,.9)', offset: 0.25 }, { transform: 'translateY(-3px) scale(.98,1.04)', offset: 0.6 }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.3,.7,.3,1)' });
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    addEventListener('pointerdown', down, true);
    return () => removeEventListener('pointerdown', down, true);
  }, []);
  // Soft pointer-following light in the glass cards of the panel (dark theme).
  useEffect(() => installGlassGlow(), []);
  // Cursor spotlight on the side cards.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0, last = null;
    const move = (e) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const c = last.target.closest?.('.card');
        if (!c) return;
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', `${last.clientX - r.left}px`);
        c.style.setProperty('--my', `${last.clientY - r.top}px`);
      });
    };
    addEventListener('pointermove', move, { passive: true });
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { setSheet(null); setLegend(false); setPicking(false); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  // "Explore Kyoto": go to the dashboard; with a place, move the map there once its own opening has played.
  const enter = (place) => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('dashboard')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    if (!place) return;
    const [lon, lat, zoom] = place.view;
    setTimeout(() => mapRef.current?.flyTo({ center: [lon, lat], zoom, duration: reduce ? 0 : 1800, essential: true }), reduce ? 300 : dashSeen ? 900 : 3300);
  };
  // Counts of our own records within 1 km of a place shown in the Explore section (plain great-circle distance).
  const nearPlace = (pl) => {
    const [lon, lat] = pl.view, kx = 111320 * Math.cos(lat * Math.PI / 180);
    const within = (f) => Math.hypot((f.geometry.coordinates[0] - lon) * kx, (f.geometry.coordinates[1] - lat) * 110574) <= 1000;
    const bb = d?.walking?.pilot?.bbox;
    return { a: A.filter(within).length, s: Tr.filter(within).length, pilot: !!bb && lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3] };
  };
  // Feature strip: each panel opens its part of the dashboard.
  const features = [
    { key: 'map', hue: 232, title: 'Map & filters', action: 'Open the map', text: `${A.length.toLocaleString('en-US')} attraction records and ${Tr.length.toLocaleString('en-US')} transit stops across Kyoto Prefecture. Search by Japanese or English name and filter by category or transit type.`, note: 'Preliminary OpenStreetMap records, not official counts.' },
    { key: 'density', hue: 268, title: 'Attraction Density', action: 'Show the density layer', text: 'A kernel density surface shows where attraction records cluster, and follows the category filter.', note: 'It shows concentration of records, not visitor numbers or crowding.' },
    { key: 'walk', hue: 196, title: 'Walking Access', action: 'Show the walking routes', text: 'Routes along the road network from each attraction to its nearest bus stop and rail station, across the whole prefecture. Drag the distance slider to see which places are within reach.', note: walk.available && !walk.pilot ? `${walk.scopeIds.size} attraction records. Walkability is assumed from road class. No straight-line distances.` : `Pilot only: ${walk.available ? walk.scopeIds.size : 0} records in Gion–Kiyomizu. No straight-line distances.` },
    { key: 'weather', hue: 28, title: 'Weather', action: 'See a forecast', text: 'A 7-day hourly forecast for any place you select, with a planned visit date and hour. Times are Asia/Tokyo.', note: 'Open-Meteo model estimate. If it cannot load, no values are shown.' },
    { key: 'fares', hue: 340, title: 'Journeys & Fares', action: 'Open the fare table', text: 'Published sample journeys from Kyoto Station with reference adult and child fares, service conditions and source links.', note: 'Not yet linked to map records; shown as a separate list.' },
    { key: 'sources', hue: 150, title: 'Data & Sources', action: 'Open the sources', text: 'Where every layer comes from, its licence and update time, the visitor statistics tables and the data-quality notes.' },
  ];
  const openFeature = (key) => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('dashboard')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    setSheet(key === 'fares' ? 'journeys' : key === 'sources' ? 'sources' : null);
    if (key === 'density' || key === 'walk') { if (!isPhone()) openPanel('explore'); else switchTab('explore'); setAnOpen(true); setPanel(key); }
    if (key === 'density' && d?.kde) setDensityMode('kde');
    if (key === 'walk' && walk.available) { setSel(null); setWalkShow(true); }
    if (key === 'weather') { select({ id: 'S00019' }); setTab('weather'); } // Kyoto Station
    if (key === 'map') resetViewRef.current?.();
  };
  const toggleUi = <><CursorLight on={cursorFx} /><CursorFxToggle on={cursorFx} onChange={setCursorFx} /><SeasonBadge auto={seasonAuto} mode={seasonMode} onMode={setSeasonMode} info={seasonInfo} /><MusicPlayer /><ThemeToggle theme={theme} onChange={setTheme} /><Pager theme={theme} /></>;
  // Opening: page 1 is the looping cherry video with the project introduction; page 2 is the season
  // story (depth parallax, KYOTO, the counts). Both are on screen before the data has loaded.
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const openCounts = { attractions: A.length || null, stops: Tr.length || null, areas: d?.municipalities?.features?.length || null };
  const onNav = (k) => { if (k === 'sources') { go('dashboard'); if (loaded) setTimeout(() => setSheet('sources'), 700); } else go(k); };
  const intro = (
    <>
      <Landing counts={openCounts} onOpenMap={() => go('dashboard')} onStory={() => go('seasons')} onNav={onNav} />
      <SeasonStory season={visualSeason} autoSeason={seasonAuto.visual} theme={theme} counts={openCounts} onExplore={() => go('explore')} onPick={(k) => setSeasonMode(k === seasonAuto.visual ? 'auto' : k)} />
      <Panorama onNext={() => go(loaded && d?.explore?.places?.length ? 'explore' : 'dashboard')} />
    </>
  );
  if (!loaded) return <>{toggleUi}{intro}<div className="boot" id="dashboard"><div className="boot-mark" /><p>Loading Kyoto Prefecture data…</p></div></>;
  const failed = Object.entries(loaded.status).filter(([, v]) => !v.ok);
  const core = d.attractions && d.transport;
  const selHit = sel ? byId.get(sel.id) : null;
  const toggle = (arr, set, k) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  // records with a name come first; a record only labelled by the site it lies in comes after the site itself
  const nameRank = (p) => (p.name ? 0 : p.name_en ? 1 : 2);
  const matches = query.trim() ? [...[...fa].sort((a, b) => nameRank(a.properties) - nameRank(b.properties)).slice(0, 40), ...ft.slice(0, 40)] : [];
  const resetView = () => mapRef.current?.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
  resetViewRef.current = resetView;
  const isAttr = selHit?.layer === 'attraction';
  const selStopKeys = (sel && d.bus?.point_stops?.[sel.id]) || null;
  const tabs = selHit ? [['overview', 'Overview'], ...(selStopKeys ? [['bus', 'Bus Routes']] : []), ...(isAttr ? [['walk', 'Walking Routes']] : []), ['weather', 'Weather'], ['journeys', 'Journeys & Fares']] : [];
  const busRouteObj = d.bus?.routes.find((r) => r.key === busRoute) || null;
  const curTab = tabs.some(([k]) => k === tab) ? tab : 'overview';
  const densityLabel = densityMode === 'kde' ? 'KDE layer on' : densityMode === 'heat' ? 'Heatmap on' : 'Off';
  const anStatus = [densityMode === 'kde' && 'KDE on', densityMode === 'heat' && 'Heatmap on', walkShow && 'Walking routes shown', busRun && `Bus ${busRun.route.number} shown`, busHl && `Bus ${busHl.route.number} stops`].filter(Boolean);
  const pilotName = walk.pilotInfo?.name;
  const cls = 'app' + (introDone ? '' : dashSeen ? ' intro' : ' waiting') + (rightOpen ? '' : ' no-right') + (selHit ? ' has-sel' : '') + (picking ? ' picking' : '');
  const cov = d.coverage;
  const covBbox = bboxOf(d.coverageLines);
  const toggleCoverage = () => setCovShow((c) => ({ on: !c.on, token: c.token + 1 }));
  const replayCoverage = () => setCovShow((c) => ({ on: true, token: c.token + 1 }));
  const routePad = null;

  return (
    <>
    {toggleUi}
    {intro}
    {d.explore?.places?.length > 0 && <Explore places={d.explore.places} attractions={A.length} stops={Tr.length} near={nearPlace} onEnter={enter} />}
    <Seam mark="読" ja="地図を読む" en="Reading the map" />
    <Features items={features} onOpen={openFeature} />
    <Seam mark="図" ja="地図" en="The dashboard" />
    <div id="dashboard" className={cls} ref={appRef} style={{ '--pf': panelFrac }}>
      <header className="top">
        <span className="wa-band" aria-hidden="true" />
        <button type="button" className="nav-btn" onClick={() => { if (rightOpen && ptab === 'explore') animateLayout(() => setRightOpen(false)); else { switchTab('explore'); if (!rightOpen) animateLayout(() => setRightOpen(true)); } }} aria-expanded={rightOpen && ptab === 'explore'} aria-controls="explore-panel">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
          <span>Explore</span>
        </button>
        <div className="brand">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect x="3" y="7" width="26" height="3.4" rx="1.4" fill="#ff7a45" /><rect x="6" y="12.5" width="20" height="2.4" rx="1" fill="#ff7a45" /><rect x="8.4" y="10" width="2.6" height="18" rx="1" fill="#ff7a45" /><rect x="21" y="10" width="2.6" height="18" rx="1" fill="#ff7a45" /></svg>
          <div>
            <h1>Kyoto Prefecture Tourism GIS</h1>
            <p>京都府 · university GIS prototype</p>
          </div>
        </div>
        <div className="counts" aria-live="polite">
          <div className="count" title="Preliminary OpenStreetMap records, not official counts">
            <span className="v"><Rolling value={fa.length} /><small> / {A.length.toLocaleString('en-US')}</small></span>
            <span className="k">attractions shown</span>
          </div>
          <div className="count" title="Preliminary OpenStreetMap records, not official counts">
            <span className="v"><Rolling value={ft.length} /><small> / {Tr.length.toLocaleString('en-US')}</small></span>
            <span className="k">transit stops shown</span>
          </div>
        </div>
        <nav className="status" aria-label="Panels">
          {failed.length > 0 && <Chip label={`${failed.length} data file(s) failed to load`} />}
          <button className={'btn ghost lang-order' + (enFirst ? ' on' : '')} type="button" onClick={toggleEnFirst} aria-pressed={enFirst} title="Name order: English first, Japanese in brackets"><span aria-hidden="true">{enFirst ? 'EN' : '日'}</span>English first</button>
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'journeys' ? null : 'journeys')} aria-expanded={sheet === 'journeys'}><span className="full">Journeys & Fares</span><span className="short" aria-hidden="true">Fares</span></button>
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'sources' ? null : 'sources')} aria-expanded={sheet === 'sources'}><span className="full">Data & Sources</span><span className="short" aria-hidden="true">Sources</span></button>
        </nav>
      </header>

      <aside className="right panel" id="details" aria-label="Information panel" ref={panelRef}>
        <Koi theme={theme} scroller={panelRef} />
        <div className="phead">
          <div className="ptabs" role="tablist" aria-label="Panel">
            <button type="button" role="tab" id="ptab-explore" aria-selected={ptab === 'explore'} aria-controls="explore-panel" className={ptab === 'explore' ? 'on' : ''} onClick={() => switchTab('explore')}>Explore</button>
            <button type="button" role="tab" id="ptab-place" aria-selected={ptab === 'place'} aria-controls="place-panel" className={ptab === 'place' ? 'on' : ''} onClick={() => switchTab('place')}>
              <span>Place</span>{selHit && <small lang="ja">{recordLabel(selHit.f.properties)}</small>}
            </button>
            <button type="button" className="x ptabs-x" onClick={togglePanel} aria-label="Hide the panel">×</button>
          </div>
          {ptab === 'explore' && (
            <div className="psearch">
              <label htmlFor="q" className="sr-only">Search places or transport stops (Japanese, English or record ID)</label>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
              <input id="q" type="search" placeholder="Search places or transport stops" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
        </div>
      <div className="left" id="explore-panel" role="tabpanel" aria-labelledby="ptab-explore" hidden={ptab !== 'explore'}>
        {query.trim() && (
          <ul className="results card" aria-label="Search results">
            {matches.length === 0 && <li className="muted">No records match.</li>}
            {matches.slice(0, 8).map((f, i) => (
              <li key={f.properties.id} style={{ '--i': i }}>
                <button type="button" onClick={() => select({ id: f.properties.id })}>
                  <span className="dot" style={{ background: dotColor(f) }} />
                  <span className="nm" lang="ja"><NameEn p={f.properties} /></span>
                  <span className="id">{f.properties.id}</span>
                </button>
              </li>
            ))}
            {matches.length > 8 && <li className="muted xs more">Showing 8 of {matches.length >= 80 ? '80+' : matches.length} matches. Type more to narrow the list.</li>}
          </ul>
        )}
        <Bento id="explore-v2" resetToken={bentoReset}>
          <Tile k="study" w={2} label="Study area"><StudyArea cov={cov} on={covShow.on} onToggle={toggleCoverage} onReplay={replayCoverage} /></Tile>

          <Tile k="cats" label="Attraction categories">
          <section className="card filt">
            <div className="card-h"><h3>Attraction categories</h3>
              <span className="mini-acts"><button className="link" type="button" onClick={() => setCats(ATTRACTION_CATS.map((c) => c.key))}>All</button><button className="link" type="button" onClick={() => setCats([])}>None</button></span>
            </div>
            {ATTRACTION_CATS.filter((c) => catCount[c.key] > 0).map((c) => (
              <label className="chk" key={c.key} onMouseEnter={() => setFocus({ kind: 'cat', key: c.key })} onMouseLeave={() => setFocus(null)}>
                <input type="checkbox" checked={cats.includes(c.key)} onChange={() => toggle(cats, setCats, c.key)} />
                <span className="sw" style={{ background: T.cat[c.key] }} />
                <span>{c.label}</span>
                <span className="n">{catCount[c.key] || 0}</span>
              </label>
            ))}
          </section></Tile>

          <Tile k="transit" label="Public transport and layers">
          <div className="tcol">
          <section className="card filt">
            <div className="card-h"><h3>Public transport</h3>
              <span className="mini-acts"><button className="link" type="button" onClick={() => setTypes(TRANSPORT_TYPES.map((t) => t.key))}>All</button><button className="link" type="button" onClick={() => setTypes([])}>None</button></span>
            </div>
            {TRANSPORT_TYPES.map((t) => (
              <label className="chk" key={t.key} title={t.cats.map((c) => `${subCount[c] || 0} ${CATEGORY_LABEL[c].toLowerCase()}${(subCount[c] || 0) === 1 ? '' : 's'}`).join(' + ')} onMouseEnter={() => setFocus({ kind: 'type', key: t.key })} onMouseLeave={() => setFocus(null)}>
                <input type="checkbox" checked={types.includes(t.key)} onChange={() => toggle(types, setTypes, t.key)} />
                <img className="sw ico" src={iconURL(t.key, theme)} alt="" />
                <span>{t.label}</span>
                <span className="n">{(typeCount[t.key] || 0).toLocaleString('en-US')}</span>
              </label>
            ))}
          </section>
          <section className="card mapdisp">
            <label className="switch pts" title="Hide the attraction points and symbols; density layers stay on">
                          <input type="checkbox" checked={pointsOn} onChange={() => setPointsOn(!pointsOn)} /><i aria-hidden="true" /><span>Points on map</span>
                        </label>
                        {!pointsOn && <p className="xs muted pts-off">Points hidden. Search and density still work.</p>}
          </section>
          {d.geography && (
            <section className={'card fold' + (layersOpen ? ' open' : '')}>
              <button type="button" className="fold-h" aria-expanded={layersOpen} aria-controls="layers-body" onClick={() => setLayersOpen(!layersOpen)}>
                <h3>Additional layers</h3>
                <span className="fold-s">{geoOn ? <span className="st-on">Places and landscape on</span> : <span className="muted">Kyoto City places and landscape</span>}</span>
                <i aria-hidden="true" />
              </button>
              {layersOpen && (
                <div id="layers-body">
                  <label className="chk">
                    <input type="checkbox" checked={geoOn} onChange={() => setGeoOn(!geoOn)} />
                    <span className="sw ring" style={{ borderColor: T.geo.land }} />
                    <span>Places and landscape</span>
                    <span className="n">{d.geography.features.filter((g) => g.geometry.type === 'Point').length}</span>
                  </label>
                  <p className="xs muted">Place names, mountains, rivers and springs from the Kyoto City sightseeing list, placed where two sources agree. The full record list is under Data &amp; Sources.</p>
                </div>
              )}
            </section>
          )}
          </div></Tile>

          <Tile k="analysis" w={2} label="Analysis">
          <section className={'card fold analysis' + (anOpen ? ' open' : '')}>
            <button type="button" className="fold-h" aria-expanded={anOpen} aria-controls="an-body" onClick={() => setAnOpen(!anOpen)}>
              <h3>Analysis</h3>
              <span className="fold-s">{anStatus.length ? anStatus.map((s) => <span key={s} className="st-on">{s}</span>) : <span className="muted">Density, walking access, bus routes</span>}</span>
              <i aria-hidden="true" />
            </button>
            {anOpen && (
            <div id="an-body">
            <button type="button" className={'entry' + (panel === 'density' ? ' open' : '')} aria-expanded={panel === 'density'} aria-controls="an-density" onClick={() => setPanel(panel === 'density' ? null : 'density')}>
              <span className="entry-t">Attraction Density</span>
              <span className={'entry-s' + (densityMode !== 'off' ? ' on' : '')}>{densityLabel}</span>
              <i aria-hidden="true" />
            </button>
            {panel === 'density' && (
              <div className="entry-body" id="an-density">
                <div className="seg" role="radiogroup" aria-label="Density layer">
                  {[['off', 'Off'], ['kde', 'KDE result'], ['heat', 'Visual heatmap']].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={densityMode === k} className={densityMode === k ? 'on' : ''} onClick={() => setDensityMode(k)} disabled={k === 'kde' && !d.kde}>{l}</button>
                  ))}
                </div>
                {densityMode === 'kde' && d.kdeMeta && (
                  <div className="legend">
                    <div className="ramp">{kdeColors(theme).map((c, i) => <span key={c} style={{ background: c }} title={`${KDE_BREAKS[i]}+`} />)}</div>
                    <div className="ramp-l">{KDE_BREAKS.map((b) => <span key={b}>{b}</span>)}</div>
                    <p className="xs">Records per km² · {d.kdeMeta.search_radius_m / 1000} km search radius · {d.kdeMeta.cell_size_m} m cells. Follows the category filter.</p>
                  </div>
                )}
                {densityMode === 'heat' && <p className="xs warnline">Visual heatmap for display only. Its radius changes with zoom, so it is not a Kernel Density result.</p>}
                <p className="xs limit">Shows where attraction records concentrate. It does not measure visitor numbers or crowding.</p>
              </div>
            )}

            <button type="button" className={'entry' + (panel === 'walk' ? ' open' : '')} aria-expanded={panel === 'walk'} aria-controls="an-walk" onClick={() => setPanel(panel === 'walk' ? null : 'walk')}>
              <span className="entry-t">Walking Access</span>
              <span className={'entry-s' + (walkShow ? ' on' : '')}>{!walk.available ? 'Not calculated' : walk.pilot ? `Pilot · ${walk.scopeIds.size} records` : `${walk.scopeIds.size} records`}</span>
              <i aria-hidden="true" />
            </button>
            {panel === 'walk' && (
              <div className="entry-body" id="an-walk" aria-disabled={!walk.available}>
                {!walk.available && <p className="xs limit">Walking analysis not yet available. These controls stay disabled until real network results are loaded.</p>}
                {walk.pilot && <p className="xs limit">Pilot area only: {pilotName}, {walk.scopeIds.size} named attraction records (dashed box on the map). Not a Kyoto Prefecture result.</p>}
                {walk.available && !walk.pilot && <p className="xs limit">All {walk.scopeIds.size} attraction records in Kyoto Prefecture. Walkability is assumed from road class, and results are not checked one by one.</p>}
                <label className="xs" htmlFor="walkmax">Max walking distance along roads: <b className="mono">{maxWalk} m</b></label>
                <input id="walkmax" type="range" min="100" max="2000" step="50" value={maxWalk} onChange={(e) => { setMaxWalk(Number(e.target.value)); setWalkShow(true); }} disabled={!walk.available} />
                <div className="seg sm">
                  {[['bus', 'Nearest bus'], ['rail', 'Nearest rail']].map(([k, l]) => (
                    <button key={k} type="button" disabled={!walk.available} className={walkTypes.includes(k) ? 'on' : ''} aria-pressed={walkTypes.includes(k)} onClick={() => { setWalkTypes(walkTypes.includes(k) ? (walkTypes.length > 1 ? walkTypes.filter((x) => x !== k) : walkTypes) : [...walkTypes, k]); setWalkShow(true); }}>{l}</button>
                  ))}
                </div>
                {walk.available && !walk.pilot && (
                  <>
                    <p className="xs ident-h" id="walk-ident-h">Include records</p>
                    <div className="seg sm ident" role="group" aria-labelledby="walk-ident-h">
                      {IDENTITIES.map(({ key, label, hint }) => (
                        <button key={key} type="button" title={hint} className={walkIdent.includes(key) ? 'on' : ''} aria-pressed={walkIdent.includes(key)} onClick={() => { setWalkIdent(walkIdent.includes(key) ? (walkIdent.length > 1 ? walkIdent.filter((x) => x !== key) : walkIdent) : [...walkIdent, key]); setWalkShow(true); }}>
                          {label} <span className="mono">{identCount[key] ?? 0}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {walk.available && (
                  <div className="walk-map">
                    <button type="button" className={'btn sm' + (walkShow ? '' : ' ghost')} onClick={() => { if (sel?.layer === 'attraction') setSel(null); setWalkShow(!walkShow || sel?.layer === 'attraction'); }}>
                      {walkShow && !(sel?.layer === 'attraction') ? 'Hide routes on map' : walk.pilot ? 'Show pilot routes on map' : 'Show routes on map'}
                    </button>
                  </div>
                )}
                {coverage && (
                  <div className="cov">
                    <div className="cov-big"><b className="mono"><Rolling value={coverage.within} /></b><span>of {coverage.denominator} {walk.pilot ? 'pilot ' : ''}records within {maxWalk} m of a {walkTypes.join(' or ')} stop</span></div>
                    <ul className="xs states">
                      <li><i className="st far" />Beyond {maxWalk} m: {coverage.beyond}</li>
                      <li><i className="st none" />No {walkTypes.join(' or ')} stop within {(CUTOFF_M / 1000).toFixed(0)} km on foot: {coverage.noStop}</li>
                      <li><i className="st cut" />Not connected to the street network: {coverage.notConnected}</li>
                      <li><i className="st nc" />Not calculated: {coverage.notComputed}{walk.pilot ? ` in the pilot · ${(A.length - walk.scopeIds.size).toLocaleString('en-US')} records outside it` : ''}</li>
                    </ul>
                    <details className="more-d"><summary>How this is counted</summary>
                      <p className="xs">Routes follow the road network; no straight lines are used. Counted over records in the current category and record filters, each attraction once, using its nearer selected stop type. "No stop within 3 km" can also mean the stop is missing from OpenStreetMap. Stops in neighbouring prefectures are not in the data; affected results are flagged. Click an attraction to see only its routes.</p>
                    </details>
                  </div>
                )}
              </div>
            )}

            {d.bus && (
              <>
                <button type="button" className={'entry' + (panel === 'bus' ? ' open' : '')} aria-expanded={panel === 'bus'} aria-controls="an-bus" onClick={() => setPanel(panel === 'bus' ? null : 'bus')}>
                  <span className="entry-t">Bus Routes</span>
                  <span className={'entry-s' + (busRun || busHl ? ' on' : '')}>{busRun ? `Route ${busRun.route.number} shown` : busHl ? `Route ${busHl.route.number} stops` : `${d.bus.coverage.routes} routes`}</span>
                  <i aria-hidden="true" />
                </button>
                {panel === 'bus' && (
                  <div className="entry-body" id="an-bus">
                    <p className="xs limit">Kyoto City Bus only (one operator), not every bus route in the prefecture. Line and stop order from OpenStreetMap; not live positions.</p>
                    <label className="xs" htmlFor="bus-route">Route</label>
                    <select id="bus-route" className="sel" value={busRoute} onChange={(e) => pickBusRoute(e.target.value)}>
                      <option value="">Choose a route…</option>
                      {d.bus.routes.map((r) => <option key={r.key} value={r.key}>{r.number}{r.variants.length ? '' : ' (stops only)'} · {r.via_ja}</option>)}
                    </select>
                    {busRouteObj && <BusVariants route={busRouteObj} active={busRun?.variant.id} onPick={(v) => startBus(busRouteObj, v.id)} />}
                    {busRouteObj && <BusFare route={busRouteObj} />}
                    {busErr && <p className="xs warnline" role="alert">{busErr}</p>}
                  </div>
                )}
              </>
            )}
            </div>
            )}
          </section></Tile>

        </Bento>
        <p className="explore-foot xs">
          <button className="link" type="button" onClick={() => setSheet('sources')}>Data &amp; Sources{d.records ? ` · ${d.records.records.length} Kyoto City records` : ''}</button>
          <button className="link" type="button" onClick={resetLayout} title="Default split and card order">Reset layout</button>
        </p>
      </div>
      <div className="place" id="place-panel" role="tabpanel" aria-labelledby="ptab-place" hidden={ptab !== 'place'}>
        {!selHit ? (
          <section className="card empty">
            <h3>Select a place</h3>
            <p>Click an attraction or a stop on the map, or search for one in Explore.</p>
            {origin && <p className="xs">Route start: <b lang="ja">{origin.label}</b>. Select a destination to get a route.</p>}
          </section>
        ) : (
          <div className="pstack" key={sel.id}>
            <Summary hit={selHit} pm={d.pointMuni} photos={d.photos} color={dotColor(selHit.f)} onClose={() => setSel(null)} onBack={() => switchTab('explore')} />
            <RouteCard sel={sel} origin={origin} res={routeRes} mode={routeMode} picking={picking} locErr={locErr}
              onMode={setRouteMode} onPick={() => setPicking(!picking)} onHere={() => setOrigin({ key: sel.id, id: sel.id, coords: sel.coords, label: sel.label, kind: sel.layer })}
              onLocate={useMyLocation} onClear={() => { setOrigin(null); setPicking(false); }} onRetry={() => setRouteTry((n) => n + 1)} />
            <section className={'card fold pmore' + (moreOpen ? ' open' : '')}>
              <button type="button" className="fold-h" aria-expanded={moreOpen} aria-controls="pmore-body" onClick={() => setMoreOpen(!moreOpen)}>
                <h3>More about this place</h3>
                <span className="fold-s muted">Record, history, weather, journeys</span>
                <i aria-hidden="true" />
              </button>
              {moreOpen && (
              <div id="pmore-body" className="stack">
              <div className="tabs" role="tablist" aria-label="Details">
                {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={curTab === k} aria-controls={`pane-${k}`} className={curTab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
              </div>
              <div className="pane" role="tabpanel" id="pane-overview" aria-labelledby="tab-overview" hidden={curTab !== 'overview'}>
                <Overview hit={selHit} pm={d.pointMuni} photos={d.photos} tourism={d.tourism} dup={dupOsm[sel.id]} walk={walk} ctx={d.context?.records?.[sel.id]} check={d.checks?.records?.[sel.id]} onWalk={() => setTab('walk')} rel={d.relations} byId={byId} onOpen={(id) => select({ id })} recs={recById} onRecord={(id) => { setRecFocus(id); setSheet('records'); }} />
              </div>
              {selStopKeys && (
                <div className="pane" role="tabpanel" id="pane-bus" aria-labelledby="tab-bus" hidden={curTab !== 'bus'}>
                  <BusAtStop bus={d.bus} stopKeys={selStopKeys} active={busRun?.variant.id} hlKey={busHl?.route.key} onStart={(route, v, key) => startBus(route, v.id, key, sel.id)} onHighlight={highlightBus} err={busErr} />
                </div>
              )}
              {isAttr && (
                <div className="pane" role="tabpanel" id="pane-walk" aria-labelledby="tab-walk" hidden={curTab !== 'walk'}>
                  <Walking available={walk} index={walkIndex} id={sel.id} byId={byId} maxWalk={maxWalk} />
                </div>
              )}
              <div className="pane" role="tabpanel" id="pane-weather" aria-labelledby="tab-weather" hidden={curTab !== 'weather'}>
                <Weather target={{ id: sel.id, lat: sel.coords[1], lon: sel.coords[0] }} visit={visit} onVisit={setVisit} />
              </div>
              <div className="pane" role="tabpanel" id="pane-journeys" aria-labelledby="tab-journeys" hidden={curTab !== 'journeys'}>
                <PlaceJourneys journeys={d.journeys} id={sel.id} onOpen={() => setSheet('journeys')} />
              </div>
              </div>
              )}
            </section>
          </div>
        )}
      </div>
      </aside>
      <div className="splitter" role="separator" aria-orientation="vertical" aria-controls="details" tabIndex={0}
        aria-label="Resize the map and the panel. Arrow keys resize, Enter resets."
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={rightOpen ? Math.round((1 - panelFrac) * 100) : 100} aria-valuetext={rightOpen ? `Map ${Math.round((1 - panelFrac) * 100)}%, panel ${Math.round(panelFrac * 100)}%` : 'Panel hidden'}
        onPointerDown={startDrag} onKeyDown={splitKey} onDoubleClick={resetLayout}>
        <span className="grip" aria-hidden="true" />
        <span className="split-tip" aria-hidden="true">Drag to resize · double-click to reset</span>
        <div className="split-btns">
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={togglePanel} aria-expanded={rightOpen} aria-controls="details" title={rightOpen ? 'Expand the map (hide the panel)' : 'Show the panel'} aria-label={rightOpen ? 'Expand the map' : 'Show the panel'}><i className={rightOpen ? 'r' : 'l'} /></button>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={resetLayout} title="Reset to the default split" aria-label="Reset the layout"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
      </div>

      <main className="center">
        <i className="corner c1" /><i className="corner c2" /><i className="corner c3" /><i className="corner c4" />
        {core ? (
          <MapView theme={theme} data={d} cats={cats} types={types} query={query} densityMode={densityMode} basemap={basemap} selected={selForMap} active={dashSeen} focus={focus} onSelect={(s) => select(s, false)} onHover={setHover} onGeo={(id) => { setRecFocus(id); setSheet('records'); }} geoOn={geoOn} mapRef={mapRef} walkSet={walkSet} maxWalk={maxWalk} busRun={busRun} busHighlight={busHl?.ids} onBusProgress={setBusProg} busCtl={busCtl}
            route={routeForMap} origin={origin} cinematic={cinematic} coverage={covBbox ? { ...covShow, bbox: covBbox } : null} pointsOn={pointsOn} padding={routePad} pickOff={d3} />
        ) : (
          <div className="alert big" role="alert"><b>Map data could not be loaded.</b>{failed.map(([k, v]) => <span key={k}>{v.file}: {v.error}</span>)}</div>
        )}
        <div className="map-tools">
          <button type="button" onClick={resetView} title="Back to the whole study area">
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
            <span>Study area</span>
          </button>
          <button type="button" onClick={() => setLegend(!legend)} aria-expanded={legend} aria-controls="map-legend">
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="5" cy="5" r="2" fill="currentColor" /><circle cx="5" cy="10" r="2" fill="currentColor" opacity=".6" /><circle cx="5" cy="15" r="2" fill="currentColor" opacity=".35" /><path d="M10 5h7M10 10h7M10 15h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span>Legend</span>
          </button>
          <button type="button" className={'cine' + (cinematic ? ' on' : '')} aria-pressed={cinematic} onClick={() => setCinematic(!cinematic)} title="Cinematic view: routes are framed with a gentle tilt. Off: top-down, no tilt or turn.">
            <i className="tg" aria-hidden="true" /><span>Cinematic view</span>
          </button>
          <button type="button" className={'cine d3t' + (d3 ? ' on' : '')} aria-pressed={d3} onClick={toggle3d} title="3D density: raise the attraction kernel density out of the map. Click the surface to read a spot.">
            <i className="tg" aria-hidden="true" /><span>3D density</span>
          </button>
          {tilted && <button type="button" onClick={topDown} title="Back to a top-down view"><span>Top-down</span></button>}
        </div>
        {core && <Density3D mapRef={mapRef} on={d3} theme={theme} d={d} />}
        {picking && <div className="pick-bar" role="status">Click a place on the map to set the route start. <button type="button" className="link" onClick={() => setPicking(false)}>Cancel</button></div>}
        {legend && (
          <div className="map-legend" id="map-legend" role="region" aria-label="Map legend">
            <header><b>Legend</b><button className="x" type="button" onClick={() => setLegend(false)} aria-label="Close legend">×</button></header>
            <ul>
              <li className="lm-key"><img src={landmarkURL('lm-kinkaku', theme)} alt="" width="30" height="30" /><span>Iconic landmark <span className="muted">({Object.keys(ICONIC).length} places, each with its own symbol)</span></span></li>
              {ATTRACTION_CATS.filter((c) => catCount[c.key] > 0).map((c) => <li key={c.key}><img src={landmarkURL('cat-' + c.key, theme, T.cat[c.key])} alt="" width="20" height="20" /><span className="dot" style={{ background: T.cat[c.key] }} />{c.label}</li>)}
              <li className="muted xs">Symbol: major place, or any place when zoomed in. Dot: every record, at any zoom.</li>
              {TRANSPORT_TYPES.map((t) => <li key={t.key}><img src={iconURL(t.key, theme)} alt="" width="16" height="16" /><span className="dot" style={{ background: T.transit[t.key] }} />{t.label} stop <span className="muted">({t.key === 'bus' ? 'square' : t.key === 'tram' ? 'diamond' : 'circle'}; dot when zoomed out)</span></li>)}
              <li><span className="ln study" style={{ borderColor: T.outline.line }} />Study area: Kyoto Prefecture</li>
              {covShow.on && <li><span className="ln thin" style={{ borderColor: T.coverage.line }} />Municipal boundary (coverage)</li>}
              {routeForMap && <li><span className="ln" style={{ borderColor: T.route.core }} />Route · <span className="end-dot s" style={{ borderColor: T.route.start }} />start · <span className="end-dot" style={{ background: T.route.end }} />end</li>}
              {walk.pilot && <li><span className="ln dash" style={{ borderColor: T.pilot }} />Walking pilot area</li>}
              {(busRun || busHl) && <li><span className="ln" style={{ borderColor: T.busLine }} />Kyoto City Bus route {(busRun || busHl).route.number}{busHl ? ' (stops only)' : ''}</li>}
              {walkSet && <li><span className="ln" style={{ borderColor: T.walk.bus }} />Walk to bus stop · <span className="ln" style={{ borderColor: T.walk.rail }} />to rail</li>}
              {densityMode === 'kde' && <li className="col"><span>Density, records per km²</span><span className="ramp">{kdeColors(theme).map((c) => <span key={c} style={{ background: c }} />)}</span><span className="ramp-l">{KDE_BREAKS.map((b) => <span key={b}>{b}</span>)}</span></li>}
              {densityMode === 'heat' && <li className="muted">Heatmap: display only</li>}
            </ul>
            {OFFLINE_PREVIEW ? <p className="xs muted">Online preview: basemap tiles are blocked by the viewer, so only the project data is drawn. Run or deploy the project for the full basemap.</p> : (
              <>
                <span className="xs muted">Map style</span>
                <div className="seg">
                  {Object.entries(BASEMAPS).map(([k, b]) => <button key={k} type="button" className={basemap === k ? 'on' : ''} aria-pressed={basemap === k} onClick={() => setBasemap(k)}>{b.label}</button>)}
                </div>
              </>
            )}
          </div>
        )}
        <button type="button" className="edge-btn r" onClick={() => openPanel(selHit ? 'place' : 'explore')} aria-expanded={rightOpen} aria-controls="details" aria-label="Show the panel"><i /><span>{selHit ? 'Details' : 'Explore'}</span></button>
        {(busRun || busHl) && (
          <div className="bus-bar" role="region" aria-label="Bus route on the map">
            <span className="bus-no">{(busRun || busHl).route.number}</span>
            {busRun ? (
              <div className="bus-info">
                <b lang="ja">{busRun.stops[busRun.startIdx].ja} → {busRun.variant.terminal_ja}</b>
                <span aria-live="polite">{busProg.idx >= busRun.startIdx ? <>Stop {busRun.stops[busProg.idx].seq} of {busRun.stops.length} · <span lang="ja">{busRun.stops[busProg.idx].ja}</span>{busProg.done ? ' · end of route' : ''}</> : 'Whole line shown; starting…'}</span>
              </div>
            ) : (
              <div className="bus-info">
                <b>Route animation not available yet</b>
                <span>{busHl.ids.length} associated stop points are highlighted. No verified line or stop order for this route.</span>
              </div>
            )}
            <div className="bus-btns">
              {busRun && <button type="button" className="btn ghost sm" onClick={replayBus}>Replay</button>}
              {busRun && !busProg.done && <button type="button" className="btn ghost sm" onClick={() => busCtl.current?.skip()}>Skip</button>}
              <button type="button" className="btn ghost sm" onClick={closeBus}>Close route</button>
            </div>
          </div>
        )}
        {hover && (
          <div className="tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
            <b lang="ja"><NameEn p={hover.feature.properties} /></b>
            <span>{CATEGORY_LABEL[hover.feature.properties.category] || (hover.feature.properties.kind ? `${hover.feature.properties.kind[0].toUpperCase()}${hover.feature.properties.kind.slice(1)} · Kyoto City record` : '')}</span>
          </div>
        )}
        {failed.length > 0 && core && <div className="toast" role="alert">Some files failed to load: {failed.map(([, v]) => v.file).join(', ')}</div>}

        {sheet === 'journeys' && <Journeys journeys={d.journeys} onClose={() => setSheet(null)} />}
        {sheet === 'sources' && <Sources d={d} status={loaded.status} walk={walk} failed={failed} onClose={() => setSheet(null)} onRecords={() => { setRecFocus(null); setSheet('records'); }} />}
        {sheet === 'records' && d.records && <Records data={d.records} geo={d.geography} byId={byId} focus={recFocus}
          onOpen={(id) => { setSheet(null); select({ id }); }}
          onShow={(f) => { setSheet(null); setGeoOn(true); mapRef.current?.flyTo({ center: f.geometry.coordinates, zoom: 14, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200, essential: true }); }}
          onClose={() => setSheet(null)} />}
      </main>

    </div>
    <Seam mark="結" ja="結び" en="Closing" />
    <Outro manifest={d.manifest} />
    </>
  );
}

const BUS_NA = 'Route animation not available yet';
// Fare from the separate fare package, joined by the official route key.
function BusFare({ route }) {
  const f = route.fare;
  if (!f) return <p className="xs muted">No fare record for this route.</p>;
  if (f.adult != null) return <p className="xs bus-fare">Fare: <b className="mono">¥{f.adult}</b> adult · <b className="mono">¥{f.child}</b> child <span className="muted">({f.type === 'sightseeing_express_flat' ? 'sightseeing express, flat' : 'flat'}; checked {f.checked_on})</span></p>;
  return <p className="xs bus-fare">Fare depends on the boarding and alighting stops. {f.chart_url && <a href={f.chart_url} target="_blank" rel="noreferrer">Official fare chart{f.chart_page ? `, p.${f.chart_page}` : ''}</a>}{f.planner_url && <> · <a href={f.planner_url} target="_blank" rel="noreferrer">trip fare lookup</a></>}</p>;
}
const dirLabel = (v) => <><span lang="ja">{v.origin_ja} → {v.terminal_ja}</span>{v.loop ? <small> via <span lang="ja">{v.via_ja}</span></small> : null}</>;
function BusVariants({ route, active, onPick }) {
  if (!route.variants.length) return <p className="xs limit">{BUS_NA}. Only the stop points linked to this route are highlighted; no line is drawn.</p>;
  return (
    <div className="bus-dirs" role="group" aria-label={`Directions and service patterns of route ${route.number}`}>
      {route.variants.map((v) => (
        <button key={v.id} type="button" className={'bus-dir' + (active === v.id ? ' on' : '')} aria-pressed={active === v.id} onClick={() => onPick(v)}>
          <span>{dirLabel(v)}</span><small>{v.stops} stops · {(v.length_m / 1000).toFixed(1)} km</small>
        </button>
      ))}
    </div>
  );
}
// Details tab for a bus stop point: which Kyoto City Bus routes list this stop, and which way they go from here.
function BusAtStop({ bus, stopKeys, active, hlKey, onStart, onHighlight, err }) {
  const rows = [];
  for (const key of stopKeys) for (const rk of bus.stops[key].routes) if (!rows.some((r) => r.route.key === rk)) rows.push({ route: bus.routes.find((r) => r.key === rk), key });
  rows.sort((a, b) => bus.routes.indexOf(a.route) - bus.routes.indexOf(b.route));
  const st = bus.stops[stopKeys[0]];
  return (
    <section className="bus-at">
      <h4>Kyoto City Bus at <span lang="ja">{st.ja}</span>{st.en ? ` (${st.en})` : ''}</h4>
      <p className="xs limit">Matched to the operator's stop list by stop name. Stops with the same name can be separate platforms, so check the direction before boarding. One operator only.</p>
      {err && <p className="xs warnline" role="alert">{err}</p>}
      <ul className="bus-list">
        {rows.map(({ route, key }) => {
          const here = route.variants.filter((v) => v.order.slice(0, -1).includes(key)); // the stop must have somewhere left to go
          return (
            <li key={route.key}>
              <div className="bus-row-h"><span className="bus-no">{route.number}</span><span className="xs muted" lang="ja">{route.via_ja}</span></div>
              {here.length ? (
                <div className="bus-dirs">
                  {here.map((v) => (
                    <button key={v.id} type="button" className={'bus-dir' + (active === v.id ? ' on' : '')} aria-pressed={active === v.id} onClick={() => onStart(route, v, key)}>
                      <span><span lang="ja">→ {v.terminal_ja}</span></span><small>next stop <span lang="ja">{bus.stops[v.order[v.order.indexOf(key) + 1]]?.ja || '—'}</span> · play from here</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="xs">{BUS_NA}{route.variants.length ? ' from this stop' : ''}. <button type="button" className="link" aria-pressed={hlKey === route.key} onClick={() => onHighlight(route)}>Highlight this route's stops</button></p>
              )}
              <BusFare route={route} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Clock() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(t);
  return <span className="clock" title="Current time in Kyoto">{s} JST</span>;
}

// One kanji per record type for the seal on the details card (decoration; the English label is the text).
const SEAL = { attraction: '名', viewpoint: '景', museum: '館', castle: '城', temple: '寺', shrine: '社', garden: '庭', bus_stop: '停', bus_station: '停', railway_station: '駅', railway_halt: '駅', tram_stop: '停' };

function Chip({ ok, warn, label }) {
  return <span className={'chip ' + (ok ? 'ok' : warn ? 'warn' : 'bad')}><i />{label}</span>;
}

const MATCH_TEXT = {
  'wikidata-exact': (p) => `Wikidata item with the same name, ${p.distance_m} m from this point`,
  'wikidata-related': (p) => `Photo of a related place: ${p.matched_label} (Wikidata, ${p.distance_m} m away). It may not show this exact record.`,
  'commons-geo': (p) => `Commons photo whose file name matches and which was taken ${p.distance_m} m from this point`,
  // the record's own OpenStreetMap node links to the photo (its wikidata, image or wikimedia_commons tag)
  'osm-wikidata': (p) => `This place's own OpenStreetMap record links to Wikidata ${p.wikidata}${p.matched_label ? ` (${p.matched_label})` : ''}; this is that item's photo`,
  'osm-image': () => "Photo named in this place's own OpenStreetMap record",
  'osm-commons': (p) => `Commons photo linked from this place's own OpenStreetMap record${p.distance_m != null ? `, taken ${p.distance_m} m from this point` : ''}`,
  'commons-near': (p) => `Commons photo taken ${p.distance_m} m from this point whose ${p.matched_label ? `category (${p.matched_label.slice(9)})` : 'file name'} names this place`,
  // a site added by the POI audit: the Wikidata item that, with OpenStreetMap, confirmed where it is
  'site-wikidata': (p) => `Photo of Wikidata ${p.wikidata}${p.matched_label ? ` (${p.matched_label})` : ''}, the item that confirmed this site's location with OpenStreetMap`,
  // Commons search: the file names the place (title or category) AND was taken near the point
  'site-contains': (p) => `Photo of ${p.site}${p.site_en ? ` (${p.site_en})` : ''}, the site this point lies in (Wikidata ${p.wikidata}, linked from that site's OpenStreetMap record). It shows the site, not this exact spot`,
  'wikidata-checked': (p) => `Photo of Wikidata ${p.wikidata}, the item whose name and place confirm this record's name`,
  'nearby-checked': (p) => `Commons photo taken ${p.m} m from this point${p.shows ? `, showing ${p.shows}` : ''}; checked by eye`,
  'viewpoint-here': (p) => `Commons photo taken ${p.m} m from this viewpoint${p.shows ? `: ${p.shows}` : ''}; checked by eye`,
  'commons-search': (p) => `Commons photo taken ${p.distance_m} m from this point whose ${p.matched_label ? `category (${p.matched_label.slice(9)})` : 'file name'} names this place ("${p.matched_text}")`,
};
const BADGE = { 'site-contains': 'Photo of the site', 'viewpoint-here': 'Taken here', 'nearby-checked': 'Taken nearby', 'wikidata-related': 'Related place', 'commons-geo': 'Nearby photo', 'commons-near': 'Nearby photo', 'osm-wikidata': 'Linked in OSM', 'osm-image': 'Linked in OSM', 'osm-commons': 'Linked in OSM', 'commons-search': 'Nearby photo' };

// Which independent sources agree with the name (name_checks.json). For a record with no name, Wikidata
// items close by are shown as what is near it, never as its name.
const CHECK_BY = { wikidata: 'Wikidata', 'osm-wikidata': 'Wikidata link in OSM', 'kyoto-city': 'Kyoto City sightseeing list' };
function NameCheck({ c }) {
  const wd = (w) => <a href={`https://www.wikidata.org/wiki/${w.q}`} target="_blank" rel="noreferrer" lang="ja">{w.ja}</a>;
  if (c.status === 'confirmed') return (
    <div><dt>Name check</dt><dd>Confirmed by {c.by.map((b) => CHECK_BY[b]).join(' · ')}{c.wikidata && <> · {wd(c.wikidata)} <small className="muted">{c.wikidata.m} m</small></>}</dd></div>);
  if (c.status === 'related') return (
    <div><dt>Name check</dt><dd>A similar name on Wikidata: {wd(c.related)} <small className="muted">{c.related.m} m</small><small className="muted">Probably the same place under a fuller or shorter name; not confirmed.</small></dd></div>);
  if (c.status === 'osm-only') return (
    <div><dt>Name check</dt><dd>Only in OpenStreetMap so far<small className="muted">Not found on Wikidata or in the Kyoto City list; the name is as mapped in OpenStreetMap.</small></dd></div>);
  if (c.candidates?.length) return (
    <div><dt>Nearby</dt><dd>{c.candidates.map((w, i) => <span key={w.q}>{i > 0 && ' · '}{wd(w)} <small className="muted">{w.m} m</small></span>)}<small className="muted">Wikidata items close to this point. They tell what is nearby, not what this point is.</small></dd></div>);
  return null;
}

// Top of the details panel: reliable photo (if any), name, category and where it is.
// Study area summary: how many municipalities the study area covers, from a polygon intersection made by
// scripts/study_area_coverage.py. Kyoto City's wards are a lower level and are listed, not counted.
const TYPE_PL = { city: ['city', 'cities'], town: ['town', 'towns'], village: ['village', 'villages'] };
function StudyArea({ cov, on, onToggle, onReplay }) {
  const [open, setOpen] = useState(false);
  if (!cov) {
    return (
      <section className="card study">
        <div className="sa-h"><h3>Study area</h3></div>
        <p className="xs warnline">Coverage not available: study_area_coverage.json did not load. It needs the MLIT N03 municipal boundaries (scripts/study_area_coverage.py).</p>
      </section>
    );
  }
  const c = cov.counts;
  const types = Object.entries(c.by_type).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${TYPE_PL[t][n === 1 ? 0 : 1]}`).join(' · ');
  return (
    <section className="card study">
      <div className="sa-h"><h3>Study area</h3><b>{cov.study_area.name}</b></div>
      <div className="sa-nums">
        <div className="sa-n"><b className="mono">{c.covered}</b><span>{cov.label}</span></div>
        <div className="sa-a"><b className="mono">{cov.study_area.area_km2.toLocaleString('en-US')}</b><span>km² area</span></div>
      </div>
      <p className="sa-types">{types}{c.partial ? ` · ${c.full} full, ${c.partial} partial` : ' · all fully covered'}</p>
      <div className="sa-acts">
        <button type="button" className={'btn sm' + (on ? '' : ' ghost')} aria-pressed={on} onClick={onToggle}>{on ? 'Hide coverage' : 'Show coverage'}</button>
        {on && <button type="button" className="link" onClick={onReplay}>Replay</button>}
        <button type="button" className="link sa-more" aria-expanded={open} aria-controls="sa-details" onClick={() => setOpen(!open)}>Coverage details<i aria-hidden="true" /></button>
      </div>
      {open && (
        <div id="sa-details" className="sa-details">
          <ul className="sa-list">
            {cov.municipalities.map((m) => (
              <li key={m.code}>
                <span lang="ja">{m.name}</span>
                <span className="xs muted">{m.type}{m.wards ? ` · ${m.wards.length} wards` : ''}</span>
                <span className={'sa-st ' + m.status.replace(' ', '-')}>{m.status === 'full' ? 'Full' : m.status === 'partial' ? `Partial ${(m.share * 100).toFixed(1)}%` : 'Not counted'}</span>
              </li>
            ))}
          </ul>
          <p className="xs">{cov.method}</p>
          <p className="xs muted">Source: {cov.source}. The study area is {cov.study_area.definition}, so every municipality is inside it. The lines on the map are simplified for drawing (about 15 m); the counts use the full-precision polygons.</p>
        </div>
      )}
    </section>
  );
}

// Route from an explicit start to the selected place. Times and distances come only from the routing
// service's result; without a start nothing is requested or drawn.
function RouteCard({ sel, origin, res, mode, picking, locErr, onMode, onPick, onHere, onLocate, onClear, onRetry }) {
  const isStart = origin && origin.id === sel.id;
  const m = modeOf(mode);
  return (
    <section className="card route-card" aria-live="polite">
      <div className="card-h">
        <h3>Route</h3>
        <div className="seg sm modes" role="radiogroup" aria-label="Travel mode">
          {MODES.map((x) => <button key={x.key} type="button" role="radio" aria-checked={mode === x.key} className={mode === x.key ? 'on' : ''} onClick={() => onMode(x.key)}>{x.label}</button>)}
          <button type="button" disabled title={TRANSIT_NOTE} aria-label={`Transit: ${TRANSIT_NOTE}`}>Transit</button>
        </div>
      </div>
      <ol className="rt-ends">
        <li className="s"><i aria-hidden="true" /><span className="k">From</span>{origin ? <b lang="ja">{origin.label}</b> : <span className="muted">No start chosen</span>}</li>
        <li className="e"><i aria-hidden="true" /><span className="k">To</span><b lang="ja">{isStart ? '—' : sel.label}</b></li>
      </ol>
      {!origin && <p className="xs">Choose a start to draw the route.</p>}
      {isStart && <p className="xs">This place is the start. Select a destination on the map or in Explore.</p>}
      {res?.status === 'loading' && <p className="xs rt-load"><span className="spin" aria-hidden="true" />Getting the route from {ROUTE_SERVICE.host}…</p>}
      {res?.status === 'error' && (
        <div className="rt-err" role="alert">
          <p className="xs warnline">{res.error}</p>
          <p className="xs muted">No route is drawn, and no straight-line distance is shown instead.</p>
          <button type="button" className="btn ghost sm" onClick={onRetry}>Try again</button>
        </div>
      )}
      {res?.status === 'ok' && (
        <div className="rt-sum">
          <div><b className="mono">{fmtDuration(res.duration_s)}</b><span>Estimated travel time · {m.label.toLowerCase()}</span></div>
          <div><b className="mono">{fmtDistance(res.distance_m)}</b><span>Route distance</span></div>
          <p className="xs muted">{m.note} Not a live ETA.{(res.snap_m || []).some((x) => x > 50) ? ` The ${res.snap_m[0] > 50 ? 'start' : 'end'} was moved ${Math.round(Math.max(...res.snap_m))} m to the nearest routable road.` : ''} Route: <a href={ROUTE_SERVICE.url} target="_blank" rel="noreferrer">{ROUTE_SERVICE.name}</a>, © OpenStreetMap contributors.</p>
        </div>
      )}
      <div className="row-btns rt-btns">
        {!isStart && <button type="button" className={'btn sm' + (picking ? '' : ' ghost')} aria-pressed={picking} onClick={onPick}>{picking ? 'Cancel picking' : origin ? 'Change start' : 'Pick start on map'}</button>}
        {!isStart && <button type="button" className="btn ghost sm" onClick={onLocate} title="Asks for your permission; your position is sent to the routing service only to compute this route">Use my location</button>}
        {!isStart && <button type="button" className="btn ghost sm" onClick={onHere}>Start from here</button>}
        {origin && <button type="button" className="link" onClick={onClear}>Clear start</button>}
      </div>
      {locErr && <p className="xs warnline" role="alert">{locErr}</p>}
    </section>
  );
}

function Summary({ hit, pm, photos, color, onClose, onBack }) {
  const p = hit.f.properties;
  const [imgOk, setImgOk] = useState(false);
  const ph = hit.layer === 'attraction' ? photos?.photos?.[p.id] : null;
  const muniCode = pm?.points?.[p.id];
  return (
    <section className={'card detail' + (ph ? ' with-photo' : '')}>
      <header className="place-h">
        <button className="back" type="button" onClick={onBack} aria-label="Back to Explore"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Explore</span></button>
        <h2 lang={p.name ? 'ja' : 'en'} key={p.id + (isEnglishFirst() ? 'en' : 'ja')}>
          {p.name ? (englishPart(p.name, p.name_en) && isEnglishFirst()
            ? <><Decode lang="en" text={p.name_en} /> <span className="en" lang="ja">({p.name})</span></>
            : <>{p.name}{p.name_en && englishPart(p.name, p.name_en) && <> <Decode className="en" lang="en" text={`(${p.name_en})`} /></>}</>)
            : p.name_en ? <span lang="en">{p.name_en}</span> : p.label_kind ? <span lang={p.label_kind === 'name' ? (p.label_lang || 'und') : undefined}>{labelText(p)}</span> : <span className="muted">{p.display_name}</span>}
        </h2>
        <button className="x" type="button" onClick={onClose} aria-label="Clear selection">×</button>
      </header>
      {ph ? (
        <figure className={'hero photo' + (imgOk ? ' loaded' : '')}>
          <div className="ph-frame">
            <img src={`${import.meta.env.BASE_URL}${ph.src}`} alt={ph.description || ph.title} width={ph.width} height={ph.height} onLoad={() => setImgOk(true)} />
            <span className={'ph-badge ' + ph.match}>{BADGE[ph.match] || 'Verified match'}</span>
          </div>
          <figcaption className="ph-credit">Photo: {ph.artist} · {ph.license_url ? <a href={ph.license_url} target="_blank" rel="noreferrer">{ph.license}</a> : ph.license} · <a href={ph.page} target="_blank" rel="noreferrer">Wikimedia Commons</a></figcaption>
        </figure>
      ) : hit.layer === 'attraction' && photos ? (
        <div className="ph-none" role="img" aria-label="No verified photo"><span className="ph-ico" aria-hidden="true" /><span>No verified photo for this place</span></div>
      ) : null}
      <div className="place-meta">
        <span className="kind"><i className="hanko" style={{ '--c': color }} aria-hidden="true" lang="ja">{SEAL[p.category] || '印'}</i>{CATEGORY_LABEL[p.category]}</span>
        {!p.name && !p.name_en && p.label_kind && <span className="noname" title={LABEL_NOTE[p.label_kind]}>No name in OpenStreetMap</span>}
        <p className="where" lang="ja">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8A4.5 4.5 0 0 0 3.500 6.5c0 3.800 4.500 8 4.500 8z" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="6.4" r="1.6" fill="currentColor" /></svg>
          {muniCode ? muniLabel(pm, muniCode) : 'Outside the prefecture boundary polygons'}
        </p>
      </div>
    </section>
  );
}

// How a containing OSM area is described: a location, never an identification of the point.
const insidePhrase = (k) => (/temple|shrine|place of worship|church/.test(k) ? 'Inside the grounds of' : k === 'building' ? 'At' : 'Inside');

function Overview({ hit, pm, photos, tourism, dup, walk, ctx, check, onWalk, rel, byId, onOpen, recs, onRecord }) {
  const p = hit.f.properties;
  const [lon, lat] = hit.f.geometry.coordinates;
  const muniCode = pm?.points?.[p.id];
  const ph = hit.layer === 'attraction' ? photos?.photos?.[p.id] : null;
  const tc = muniTourism(tourism, pm, muniCode);
  const tm = tourism?.municipalities;
  const inPilot = walk.available && (!walk.pilot || walk.scopeIds.has(p.id));
  return (
    <div className="ov">
      {!p.name && (p.name_en
        ? <p className="xs limit">No Japanese name in the source. The English name comes from the same OpenStreetMap record (name:en).</p>
        : <p className="xs limit">{LABEL_NOTE[p.label_kind] || 'This record has no name in the source. The label above is a fallback, not an official name.'}{p.label_basis && <span className="muted"> Source: {p.label_basis}.</span>}</p>)}
      <dl className="kv">
        <div><dt>Category</dt><dd>{CATEGORY_LABEL[p.category]}</dd></div>
        {ctx?.inside?.length > 0 && (
          <div><dt>Location</dt><dd>
            {ctx.inside.slice(0, 2).map((s, i) => <span key={i} className="inside">{insidePhrase(s.kind)} <b lang="ja">{s.name_en ? (isEnglishFirst() ? `${s.name_en} (${s.name})` : `${s.name} (${s.name_en})`) : s.name}</b> <small className="muted">· {s.kind}</small></span>)}
            <small className="muted">OpenStreetMap area that contains this point. It tells where the point is, not what it is.</small>
          </dd></div>
        )}
        {hit.layer === 'attraction' && check && <NameCheck c={check} />}
        {!p.name && ctx && (
          <div><dt>Record</dt><dd>{ctx.identity === 'osm_tags' ? <>OSM-tagged: {Object.keys(ctx.tags || {}).join(', ')}</> : 'Unverified: only a category tag in OpenStreetMap'}</dd></div>
        )}
        {(() => { const terms = nameTerms(p.name, hit.layer === 'transport'); return terms.length > 0 && (
          <div><dt>In the name</dt><dd className="terms">{terms.map((x) => <span key={x.t}><b lang="ja">{x.t}</b> {x.m}</span>)}<small className="muted">Meaning of common words in the name, not a translation.</small></dd></div>
        ); })()}
        <div><dt>Area</dt><dd lang="ja">{muniCode ? muniLabel(pm, muniCode) : 'outside all boundary polygons'}</dd></div>
        {hit.layer === 'attraction' && <SiteLinks p={p} rel={rel} byId={byId} onOpen={onOpen} recs={recs} onRecord={onRecord} />}
        {hit.layer === 'attraction' && (
          <div><dt>Walking access</dt><dd>{inPilot ? <button className="link" type="button" onClick={onWalk}>Network routes available · open Walking Routes</button> : walk.available ? `Not calculated yet (pilot covers ${walk.scopeIds.size} records in ${walk.pilotInfo?.name})` : 'Not calculated yet'}</dd></div>
        )}
      </dl>

      <hr className="mizuhiki" aria-hidden="true" />
      <section className="stat" aria-label="Tourism count for this municipality">
        <h4>Tourism count · {tc ? tc.name : 'municipality'}</h4>
        {tc ? (
          <>
            <div className="stat-row">
              <div><b className="mono">{n0(tc['2025'])}</b><span>2025</span></div>
              <div><b className="mono">{n0(tc['2024'])}</b><span>2024</span></div>
            </div>
            <p className="xs limit">{tc.wholeCity ? `Total for the whole of ${tc.name}, not this ward and not this place.` : 'Municipal total, not visits to this place.'} No count is published per attraction here.</p>
            <p className="xs muted">Unit: {tm.unit}, calendar years. Source: Kyoto Prefecture 2025 Tourism Report, Table 1 · <a href={tm.source_url} target="_blank" rel="noreferrer">PDF</a> · {tm.accessed?.split('.')[0]}.</p>
          </>
        ) : <p className="xs muted">No published visitor count is available for this place. None is estimated.</p>}
      </section>

      {ph && (
        <p className="xs muted credit">
          {MATCH_TEXT[ph.match](ph)}. Photo: {ph.artist} · {ph.license_url ? <a href={ph.license_url} target="_blank" rel="noreferrer">{ph.license}</a> : ph.license} ·{' '}
          <a href={ph.page} target="_blank" rel="noreferrer">Wikimedia Commons</a>
        </p>
      )}

      <details className="tech">
        <summary>Technical Details</summary>
        <dl className="kv">
          <div><dt>Record ID</dt><dd className="mono">{p.id}</dd></div>
          <div><dt>OSM ID</dt><dd className="mono"><a href={`https://www.openstreetmap.org/${p.osm_element || `node/${p.osm_id}`}`} target="_blank" rel="noreferrer">{p.osm_id}</a></dd></div>
          <div><dt>Source category</dt><dd className="mono">{p.category}{p.transport_type ? ` · ${p.transport_type}` : ''}</dd></div>
          <div><dt>Coordinates</dt><dd className="mono">{lat.toFixed(5)}, {lon.toFixed(5)}</dd></div>
          <div><dt>Municipality join</dt><dd>N03 spatial join{muniCode ? ` · code ${muniCode}` : ''}</dd></div>
          <div><dt>English name</dt><dd>{p.name_en ? `${p.name_en_source}${p.osm_element ? ` (${p.osm_element})` : ''}` : p.name ? 'no verified English name; original shown' : 'no name in source'}</dd></div>
          <div><dt>Status</dt><dd>{p.validation_status} · {p.source}</dd></div>
          {hit.layer === 'attraction' && <div><dt>Location check</dt><dd>{p.location_evidence ? `${p.location_evidence}. Point: ${p.point_is}.` : rel?.location_check?.raw || 'OpenStreetMap point as supplied'}</dd></div>}
          {p.wikidata && <div><dt>Wikidata</dt><dd className="mono"><a href={`https://www.wikidata.org/wiki/${p.wikidata}`} target="_blank" rel="noreferrer">{p.wikidata}</a></dd></div>}
          {p.dsight_ids && <div><dt>DSIGHT_1.csv</dt><dd className="mono">{p.dsight_ids.join(', ')}</dd></div>}
          {ph?.wikidata && <div><dt>Photo item</dt><dd className="mono"><a href={`https://www.wikidata.org/wiki/${ph.wikidata}`} target="_blank" rel="noreferrer">{ph.wikidata}</a></dd></div>}
        </dl>
        {dup && <p className="xs warnline">Shares OSM ID {dup.osm_id} with {dup.ids.filter((x) => x !== p.id).join(', ')}. Both records are kept as supplied.</p>}
      </details>
    </div>
  );
}

// How a record relates to others after the POI audit (public/data/poi_relations.json): the site it
// belongs to, what belongs to it (dashboard records, and DSIGHT_1.csv buildings, objects and trees,
// which have no point of their own), duplicates merged into it, and separate features of one place.
const KIND_EN = { building: 'building', object: 'cultural object', 'guardian figure': 'guardian figure', 'named tree': 'named tree', 'burial mound': 'burial mound', 'cultural property': 'cultural property' };
function SiteLinks({ p, rel, byId, onOpen, recs, onRecord }) {
  if (!rel) return null;
  const name = (id) => { const h = byId.get(id); return h ? recordLabel(h.f.properties) : id; };
  const parent = rel.child_of?.[p.id];
  const here = rel.parents?.[p.id];
  const group = rel.groups?.find((g) => g.ids.includes(p.id));
  const maybe = rel.possible_duplicates?.find((g) => g.ids.includes(p.id));
  const distinct = rel.distinct?.find((g) => g.ids.includes(p.id));
  return (
    <>
      {parent && <div><dt>Part of</dt><dd><button className="link" type="button" onClick={() => onOpen(parent)} lang="ja">{name(parent)}</button> <small className="muted">· {parent}</small></dd></div>}
      {here && (here.children.length > 0 || here.dsight.length > 0) && (
        <div><dt>At this site</dt><dd className="site-parts">
          {here.children.map((id) => <span key={id}><button className="link" type="button" onClick={() => onOpen(id)} lang="ja">{name(id)}</button> <small className="muted">· on the map</small></span>)}
          {here.dsight.map((x) => {
            const r = recs?.get(x.csv_id);
            return r?.description
              ? <details key={x.csv_id} className="rec-d"><summary><b lang="ja">{x.part || x.name}</b> <small className="muted">· {KIND_EN[x.kind] || x.kind} · {x.csv_id}</small></summary><p lang="ja">{r.description}</p></details>
              : <span key={x.csv_id}><b lang="ja">{x.part || x.name}</b> <small className="muted">· {KIND_EN[x.kind] || x.kind} · {x.csv_id}</small></span>;
          })}
          {here.dsight.length > 0 && <small className="muted">From the Kyoto City sightseeing list (DSIGHT_1.csv, © Kyoto City, CC BY 4.0), as published; no points of their own.</small>}
        </dd></div>
      )}
      {p.merged_ids && <div><dt>Merged</dt><dd>{p.merged_ids.join(', ')} <small className="muted">· the same place entered more than once in OpenStreetMap. {rel.merged?.[p.merged_ids[0]]?.evidence}</small></dd></div>}
      {group && <div><dt>Group</dt><dd>One of {group.ids.length} separate features: <span lang="ja">{group.name}</span> <small className="muted">· {group.note}</small></dd></div>}
      {maybe && <div><dt>Check</dt><dd>Possible duplicate of {maybe.ids.filter((x) => x !== p.id).join(', ')}, kept until checked. <small className="muted">{maybe.note}</small></dd></div>}
      {distinct && <div><dt>Note</dt><dd><small className="muted">{distinct.note}</small></dd></div>}
      {(() => { const m = recs?.mentions?.get(p.id) || []; return m.length > 0 && (
        <div><dt>Mentioned in</dt><dd className="site-parts">
          {m.slice(0, 6).map((r) => <span key={r.id}><button className="link" type="button" onClick={() => onRecord(r.id)} lang="ja">{r.name}</button> <small className="muted">· {r.series}</small></span>)}
          {m.length > 6 && <small className="muted">and {m.length - 6} more</small>}
          <small className="muted">Kyoto City records whose text names this place. They are not filed under it.</small>
        </dd></div>
      ); })()}
    </>
  );
}

// Walking results for one attraction. Three different states are kept apart:
// not calculated yet / no connectable network route / route found (within or beyond the chosen distance).
function Walking({ available, index, id, byId, maxWalk }) {
  if (!available.available || (available.pilot && !available.scopeIds.has(id))) {
    return (
      <section className="walk-na">
        <p className="state"><i className="st nc" /><b>Not calculated yet</b></p>
        <p className="xs">{available.pilot ? `Walking routes exist only for the ${available.scopeIds.size} named attraction records in the ${available.pilotInfo?.name} pilot area. This place is outside it.` : available.reason} No straight-line distance is shown instead.</p>
      </section>
    );
  }
  const r = index.byAttraction.get(id) || {};
  const identity = index.identity.get(id);
  const row = (t, label) => {
    const x = r[t];
    if (!x) return <div className="wrow"><dt>{label}</dt><dd><span className="state"><i className="st nc" />Not calculated yet</span></dd></div>;
    if (x.route_status !== 'ok') {
      const head = x.reason === 'no_stop_within_cutoff' ? `No ${t === 'rail' ? 'rail station' : 'bus stop'} within ${(CUTOFF_M / 1000).toFixed(0)} km on foot`
        : x.reason === 'isolated_network' ? 'Not connected to the street network'
          : x.reason === 'attraction_too_far_from_network' ? 'Too far from any mapped path' : 'No connectable network route';
      return <div className="wrow"><dt>{label}</dt><dd><span className="state"><i className={'st ' + (x.reason === 'no_stop_within_cutoff' ? 'none' : 'cut')} /><b>{head}</b></span><small>Result: {x.route_status} · distance not available</small>{x.note && <small>{x.note}</small>}</dd></div>;
    }
    const s = byId.get(x.stop_id)?.f.properties;
    if (x.reason === 'same_access_point') return <div className="wrow"><dt><i className={'wkey ' + t} />{label}</dt><dd><b lang="ja">{s ? <NameEn p={s} /> : x.stop_id}</b><span className="state"><i className="st ok" />Next to this place</span><small className="warnline">{x.note}</small></dd></div>;
    const within = x.distance_m <= maxWalk;
    return (
      <div className="wrow">
        <dt><i className={'wkey ' + t} />{label}</dt>
        <dd>
          <b lang="ja">{s ? <NameEn p={s} /> : x.stop_id}</b>
          <span className="wdist"><b className="mono"><Rolling value={Math.round(x.distance_m)} /> m</b> · ≈{x.duration_min} min walk</span>
          <span className="state"><i className={'st ' + (within ? 'ok' : 'far')} />{within ? `Within ${maxWalk} m` : `Beyond ${maxWalk} m (selected distance)`}</span>
          {x.steps_m > 0 && <span className="chip steps">Includes steps · about {x.steps_m} m</span>}
          {x.note && <small className="warnline">{x.note}</small>}
          <small className="mono muted">{x.stop_id} · 80 m/min · access gaps not added: {x.attraction_snap_gap_m} m + {x.stop_snap_gap_m} m</small>
        </dd>
      </div>
    );
  };
  return (
    <section className="walk">
      <p className="xs limit">{available.pilot ? `Pilot result (${available.pilotInfo?.name || 'pilot area'}): routes` : 'Routes'} follow the road network, never a straight line.</p>
      {identity === 'unverified' && <p className="xs warnline">This record only carries a category tag in OpenStreetMap. What it is has not been checked.</p>}
      <dl className="kv">{row('bus', 'Nearest bus stop')}{row('rail', 'Nearest rail station')}</dl>
      <details className="more-d"><summary>Method and limits</summary>
        <p className="xs">Shortest path on OSM road segments joined at shared vertices. Walkability is assumed from road class (no foot/access tags). Points are not verified entrances. No verified sample journey links this record to an alighting stop.</p>
      </details>
    </section>
  );
}

// Journeys tab: journeys verified for this place first; everything else in its own list.
function PlaceJourneys({ journeys, id, onOpen }) {
  const list = journeys || [];
  const mine = list.filter((j) => j.attraction_id === id || j.stop_id === id);
  const rest = list.filter((j) => !(j.attraction_id === id || j.stop_id === id));
  const item = (j) => (
    <li key={j.journey_id}>
      <span className={'route ' + (String(j.route_number).startsWith('EX') ? 'ex' : '')}>{j.route_number}</span>
      <span className="pj-main"><b>{j.destination_name}</b><small>Alight at {j.alighting_stop} · {j.service_conditions}</small></span>
      <span className="pj-fare mono">¥{j.adult_fare_jpy}<small>child ¥{j.child_fare_jpy}</small></span>
    </li>
  );
  return (
    <section className="pj">
      <h4>For this place</h4>
      {mine.length ? <ul className="pj-list">{mine.map(item)}</ul> : <p className="xs muted">No sample journey has been verified for this place yet.</p>}
      <h4>Other published samples <span className="muted">· not matched to this place ({rest.length})</span></h4>
      <p className="xs limit">From Kyoto Station, no transfer. One-way reference fares in JPY; check the operator before travel.</p>
      <ul className="pj-list">{rest.map(item)}</ul>
      <button className="btn ghost sm" type="button" onClick={onOpen}>Full table with sources</button>
    </section>
  );
}

function Journeys({ journeys, onClose }) {
  const list = journeys || [];
  const linked = list.filter((j) => j.attraction_id && j.stop_id);
  const unlinked = list.filter((j) => !(j.attraction_id && j.stop_id));
  return (
    <div className="sheet" role="dialog" aria-label="Sample journeys and reference fares">
      <header className="sheet-h">
        <div>
          <h2>Sample journeys & reference fares</h2>
          <p>Published examples from <b>Kyoto Station</b> with no vehicle transfer. Not a route planner and not the fastest or cheapest options. One-way fares in JPY, excluding admission; no passes applied.</p>
        </div>
        <button className="x" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="sheet-meta">
        <span className="chip ok"><i />{list.length} journeys</span>
        <span className="chip warn"><i />Linked to map: {linked.length}</span>
        <span className="chip warn"><i />Not yet linked: {unlinked.length}</span>
      </div>
      <h3 className="sub-h">Not yet linked to map records ({unlinked.length})</h3>
      <p className="xs muted">attraction_id and stop_id are null in sample_journeys.json until verified matches exist. They are not joined by similar names. The alighting stop below is the published stop name, which is separate from the nearest stop along walkable roads (not yet calculated).</p>
      <div className="jtable" role="table">
        <div className="jrow jhead" role="row">
          <span role="columnheader">ID</span><span role="columnheader">Destination (published label)</span><span role="columnheader">Route</span><span role="columnheader">Sample-journey alighting stop</span><span role="columnheader" className="r">Adult</span><span role="columnheader" className="r">Child</span><span role="columnheader">Service conditions</span><span role="columnheader">Evidence</span>
        </div>
        {unlinked.map((j, i) => (
          <div className="jrow" role="row" key={j.journey_id} style={{ '--i': i }}>
            <span className="mono">{j.journey_id}</span>
            <span><b>{j.destination_name}</b><small className="muted">{j.operator}</small></span>
            <span><span className={'route ' + (String(j.route_number).startsWith('EX') ? 'ex' : '')}>{j.route_number}</span><small className="muted">{j.workbook?.service_type || ''}</small></span>
            <span>{j.alighting_stop}<small className="muted">stop_id: not verified</small></span>
            <span className="r mono">¥{j.adult_fare_jpy}</span>
            <span className="r mono">¥{j.child_fare_jpy}</span>
            <span>{j.service_conditions}<small className="muted">{j.route_status}</small></span>
            <span className="links">
              <small>{j.source_edition} · accessed {j.accessed_date}</small>
              <a href={j.route_source_url} target="_blank" rel="noreferrer">Route source</a>
              <a href={j.fare_source_url} target="_blank" rel="noreferrer">Fare source</a>
              <a href={j.days_source_url} target="_blank" rel="noreferrer">Operating days</a>
            </span>
          </div>
        ))}
      </div>
      {list[0]?.workbook && <p className="xs muted">Fare basis: {list[0].workbook.fare_basis}. {list[0].workbook.conditions} Weekend and holiday express services must be checked for the travel date. The accessed date is when the source was read, not when a fare took effect.</p>}
    </div>
  );
}

// The Kyoto City sightseeing list (DSIGHT_1.csv, 648 records): every record with what was done with it.
const OUTCOME = {
  attraction: ['On the map', 'A place of its own on the map'],
  sub: ['Part of a site', 'A building, tree or feature of a site on the map'],
  culture: ['Culture & history', 'Objects kept at a site, performing arts, literature, food and local history'],
  geography: ['Places & landscape', 'Place names, mountains, rivers and springs placed by two sources'],
  unverified: ['Not placed', 'Its place, or the site it belongs to, could not be confirmed; kept here, not placed'],
};
function Records({ data, geo, byId, focus, onOpen, onShow, onClose }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [n, setN] = useState(60);
  const geoBy = useMemo(() => new Map((geo?.features || []).filter((g) => g.geometry.type === 'Point').map((g) => [g.properties.csv_id, g])), [geo]);
  const focusRef = useRef(null);
  useEffect(() => { if (focus) { setQ(''); setF('all'); setN(1000); setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center' }), 60); } }, [focus]);
  const qq = q.trim().toLowerCase();
  const list = data.records.filter((r) => (f === 'all' || r.outcome === f) && (!qq || [r.name, r.kana, r.other_name, r.id, r.description, r.address].some((v) => (v || '').toLowerCase().includes(qq))));
  const name = (id) => { const h = byId.get(id); return h ? recordLabel(h.f.properties) : id; };
  return (
    <div className="sheet" role="dialog" aria-label="Kyoto City records">
      <header className="sheet-h">
        <div><h2>Kyoto City sightseeing records</h2>
          <p>All {data.records.length} records of <a href={data.source.url} target="_blank" rel="noreferrer">{data.source.title}</a>, {data.source.publisher}, {data.source.licence}, updated {data.source.updated}. Names, readings, descriptions and addresses are shown as published. Each record says what was done with it; nothing is placed without two agreeing sources.</p></div>
        <button className="x" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="sheet-meta rec-filter" role="group" aria-label="Filter by outcome">
        <button type="button" className={'chip' + (f === 'all' ? ' ok' : '')} onClick={() => setF('all')} aria-pressed={f === 'all'}><i />All {data.records.length}</button>
        {Object.entries(OUTCOME).map(([k, [lab, tip]]) => (
          <button type="button" key={k} title={tip} className={'chip' + (f === k ? ' ok' : k === 'unverified' ? ' warn' : '')} onClick={() => setF(k)} aria-pressed={f === k}><i />{lab} {data.outcomes[k] || 0}</button>
        ))}
        <input className="rec-q" type="search" placeholder="Search the records · 日本語 / ID" aria-label="Search the records" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="rec-list">
        {list.slice(0, n).map((r) => (
          <li key={r.id} ref={r.id === focus ? focusRef : null} className={r.id === focus ? 'on' : ''}>
            <details open={r.id === focus}>
              <summary>
                <b lang="ja">{r.name}</b> <small className="muted" lang="ja">{r.kana}</small>
                <span className={'rec-o ' + r.outcome}>{OUTCOME[r.outcome][0]}</span>
              </summary>
              <div className="rec-b">
                <p className="xs muted">{r.id} · {r.series}{r.kind !== r.series ? ` · ${r.kind}` : ''}{r.other_name ? <> · <span lang="ja">{r.other_name}</span></> : null}{r.address ? <> · <span lang="ja">{r.address}</span></> : null}</p>
                {r.description && <p lang="ja">{r.description}</p>}
                <p className="xs">
                  {r.site_id && <button className="link" type="button" onClick={() => onOpen(r.site_id)}>Open <span lang="ja">{name(r.site_id)}</span> on the map</button>}
                  {geoBy.get(r.id) && <button className="link" type="button" onClick={() => onShow(geoBy.get(r.id))}>Show on the map</button>}
                </p>
                {r.mentions && <p className="xs">Names in the text: {r.mentions.map((id, i) => <span key={id}>{i ? ', ' : ''}<button className="link" type="button" onClick={() => onOpen(id)} lang="ja">{name(id)}</button></span>)}</p>}
                {r.evidence && <p className="xs muted">{r.outcome === 'unverified' ? 'Why not placed: ' : 'How it was placed: '}{r.evidence}</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {list.length > n && <button className="btn ghost" type="button" onClick={() => setN(n + 120)}>Show more ({list.length - n} left)</button>}
      {list.length === 0 && <p className="muted">No records match.</p>}
    </div>
  );
}

function Sources({ d, status, walk, failed, onClose, onRecords }) {
  const m = d.manifest;
  const k = d.kdeMeta;
  return (
    <div className="sheet" role="dialog" aria-label="Data and sources">
      <header className="sheet-h">
        <div><h2>Data, sources and update times</h2><p>Record counts are preliminary mapped records, not official counts of unique operational attractions or stations.</p></div>
        <button className="x" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="sheet-meta">
        <Chip ok={!failed.length} label={failed.length ? `${failed.length} file(s) failed` : 'Map data loaded'} />
        <Chip ok={!!d.kde} label={d.kde ? 'Density: KDE computed' : 'Density: missing'} />
        {d.photos && <Chip ok label={`Photos: ${d.photos.with_photo} of ${d.photos.named_records} named`} />}
        <Chip ok={walk.available && !walk.pilot} warn={!walk.available || walk.pilot} label={!walk.available ? 'Walking: not calculated' : walk.pilot ? `Walking: pilot only (${walk.scopeIds.size} records)` : `Walking: prefecture (${walk.scopeIds.size} records)`} />
        <Clock />
      </div>
      <div className="src-grid">
        {d.records && (
          <section className="src-records">
            <h3>Kyoto City records</h3>
            <p>{d.records.records.length} records of the Kyoto City sightseeing list ({d.records.source?.publisher || 'Kyoto City'}, {d.records.source?.licence}). Each one is kept with its ID and what was done with it: placed on the map, attached to a site, kept as culture, placed as a landscape feature, or left unverified.</p>
            <button className="btn sm" type="button" onClick={onRecords}>Open the record library</button>
          </section>
        )}
        <section>
          <h3>Attractions & transit stops</h3>
          <p>OpenStreetMap contributors via <a href="https://download.geofabrik.de/asia/japan/kansai.html" target="_blank" rel="noreferrer">Geofabrik Kansai</a>, layers gis_osm_pois_free_1 and gis_osm_transport_free_1. Licence: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">ODbL</a>.</p>
          <p className="xs"><b>Source snapshot date:</b> not confirmed. Package prepared 2026-11-10 (this is not the OSM date).</p>
        </section>
        <section>
          <h3>Administrative boundary</h3>
          <p>MLIT National Land Numerical Information <a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html" target="_blank" rel="noreferrer">N03 (2026)</a>. File name N03-20260101_26 indicates the 1 January 2026 edition. {m?.boundary?.raw_features} raw municipality/ward polygons, drawn as {m?.boundary?.display_municipalities} dissolved municipalities.</p>
          <p className="xs">{m?.boundary?.display_note} Spatial joins use the raw polygons.</p>
        </section>
        <section>
          <h3>Koi pond background</h3>
          <p>The koi swimming behind the panel are drawn by <a href="https://github.com/pursurer/ascii-koi" target="_blank" rel="noreferrer">ASCII Koi</a> by pursurer (MIT licence), used unchanged. Decoration only: it carries no data.</p>
        </section>
        <section>
          <h3>Sample journeys & fares</h3>
          <p>Kyoto City Transportation Bureau. Standard routes: November 2024 official guide (timetables not rechecked). Express routes and fares: operator web pages accessed 2026-11-10.</p>
        </section>
        <section>
          <h3>Weather</h3>
          <p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> forecast API, requested live for the selected point (Asia/Tokyo, 7 days). Model estimates, CC BY 4.0. Free for non-commercial use within <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">daily limits</a>.</p>
        </section>
        <section>
          <h3>Analysis 1 · Kernel density</h3>
          {k ? <p className="xs">{k.kernel}; radius {k.search_radius_m} m; cells {k.cell_size_m} m; {k.crs}; units {k.units}; {k.edge_correction}. Computed {k.computed_at.replace('T', ' ').replace('+00:00', ' UTC')} from {k.input}.</p> : <p>Not loaded.</p>}
        </section>
        <section>
          <h3>Analysis 2 · Walking network</h3>
          <p className="xs">{walk.pilot ? 'walking_routes.geojson' : 'walking_routes_prefecture.geojson'} status: <b>{d.walking?.status || 'missing'}</b>{d.walking?.scope ? ` (scope: ${d.walking.scope})` : ''}, {d.walking?.features?.length ?? 0} features.</p>
          {d.walkReport && <p className="xs">Road data: {d.walkReport.road_data_check.total.toLocaleString('en-US')} segments read from {Object.keys(d.walkReport.road_data_check.files).length} GeoJSON parts ({d.walkReport.road_data_check.unique_osm_id.toLocaleString('en-US')} unique OSM IDs). Graph: {d.walkReport.graph.nodes.toLocaleString('en-US')} vertices, {d.walkReport.graph.components} connected pieces. Results: {Object.entries(d.walkReport.results).map(([k, v]) => `${k} ${v}`).join(', ')}. Computed {d.walkReport.computed_at.replace('T', ' ').replace('+00:00', ' UTC')}.</p>}
          {d.walkReport && <ul className="xs">{d.walkReport.limitations.map((x) => <li key={x}>{x}</li>)}</ul>}
        </section>
        {d.photos && (
          <section>
            <h3>Attraction photos</h3>
            <p className="xs">Wikidata (P18) and Wikimedia Commons, retrieved {d.photos.retrieved_at.replace('T', ' ').replace('Z', ' UTC')}. {d.photos.with_photo} of {d.photos.records ?? d.photos.named_records} records have a photo: {d.photos.by_match['wikidata-exact'] + (d.photos.by_match['site-wikidata'] || 0)} Wikidata items of the place itself, {d.photos.by_match['wikidata-related']} related places, {(d.photos.by_match['osm-wikidata'] || 0) + (d.photos.by_match['osm-image'] || 0) + (d.photos.by_match['osm-commons'] || 0)} linked from the record's own OpenStreetMap entry, {(d.photos.by_match['commons-geo'] || 0) + (d.photos.by_match['commons-near'] || 0)} Commons photos taken nearby that name the place. Records without a name get a photo only through their own OpenStreetMap link. Only CC0, public-domain, CC BY and CC BY-SA files are used; each photo shows its author and licence.</p>
          </section>
        )}
        {d.namesEn?.meta && (
          <section>
            <h3>English names</h3>
            <p className="xs">Shown as 「日文名称 (English name)」 only when verified: {d.namesEn.meta.counts.attractions.with_en} attraction and {d.namesEn.meta.counts.transport.with_en.toLocaleString('en-US')} stop records. {d.namesEn.meta.rules}</p>
          </section>
        )}
        {d.tourism && (
          <section className="wide">
            <h3>Visitor statistics</h3>
            <p className="xs">{d.tourism.municipalities.title} ({d.tourism.municipalities.scope}): shown in a place's Overview as the total for its municipality. {d.tourism.municipalities.notes.join(' ')} <a href={d.tourism.municipalities.source_url} target="_blank" rel="noreferrer">Source PDF</a>. {d.tourism.municipalities.accessed}</p>
            <p className="xs limit">The tables below are published reference figures. They are not joined to map records, because no verified link between their place names and the map records exists yet.</p>
            {d.tourism.reference_tables.map((t) => (
              <details className="more-d" key={t.title}>
                <summary>{t.title} · {t.scope}</summary>
                <table className="mini">
                  <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={typeof c === 'number' ? 'r mono' : ''}>{c == null ? 'not published' : typeof c === 'number' ? (c < 1 ? `${(c * 100).toFixed(1)}%` : c.toLocaleString('en-US')) : c}</td>)}</tr>)}</tbody>
                </table>
                <p className="xs muted">Unit: {t.unit}. {t.notes.join(' ')} <a href={t.source_url} target="_blank" rel="noreferrer">Source PDF</a>. {t.accessed}</p>
              </details>
            ))}
          </section>
        )}
        {d.bus && (
          <section>
            <h3>Bus routes (Kyoto City Bus)</h3>
            <p className="xs">Operator: {d.bus.operator}. {d.bus.coverage.routes} route entries in the catalogue; {d.bus.coverage.routes_with_animation} have at least one mapped direction ({d.bus.coverage.variants} directions or service patterns, {d.bus.coverage.stop_occurrences.toLocaleString('en-US')} stop calls).</p>
            <p className="xs">{d.bus.sources.animation} Stop order cross-checked with the operator only for {d.bus.coverage.official_order_checked.join(', ')}. {d.bus.sources.catalogue}. {d.bus.sources.fares}.</p>
            <p className="xs limit">Without a usable line ({d.bus.coverage.route_numbers_without_animation.length}): {d.bus.coverage.route_numbers_without_animation.join(', ')}. Records flagged for review: {d.bus.review.length}. The moving line is a presentation, not a live bus position or travel speed. Dashboard stop points are linked to operator stops by name and are not verified as the same platform.</p>
          </section>
        )}
        <section>
          <h3>Data quality notes</h3>
          <ul className="xs">
            <li>{m?.attractions?.unnamed} of {m?.attractions?.records} attraction records have no name; {m?.transport?.unnamed} of {m?.transport?.records} stop records have no name.</li>
            {(m?.transport?.duplicate_osm_ids || []).map((x) => <li key={x.osm_id}>OSM ID {x.osm_id} appears twice ({x.ids.join(', ')}); both are kept.</li>)}
            <li>Categories are as tagged in OSM (for example 伏見稲荷大社 A00306 is tagged viewpoint). Worship places and polygon features were not included.</li>
            <li>Railway entrances or platforms are not merged into stations. Stops near the prefecture edge need review before network analysis.</li>
            <li>Japanese names are kept as supplied; English names are added only from verifiable sources, never invented.</li>
          </ul>
        </section>
        <section>
          <h3>Build & file status</h3>
          <p className="xs">Data build {m?.built_at?.replace('T', ' ').replace('+00:00', ' UTC')}. Raw files checked against the package SHA-256 manifest: {Object.values(m?.raw_hash_check || {}).every((v) => v === 'match') ? 'all match' : 'mismatch found'}.</p>
          <ul className="xs files">{Object.entries(status).map(([key, v]) => <li key={key} className={v.ok ? '' : 'bad'}>{v.ok ? '✓' : '✗'} {v.file}{v.ok ? '' : ` — ${v.error}`}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
