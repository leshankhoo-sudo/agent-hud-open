import { useEffect, useMemo, useRef, useState } from 'react';
import { iconURL } from './lib/icons.js';
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
import { SeasonBadge } from './Season.jsx';
import { seasonFor, initialSeasonMode, rememberSeasonMode } from './lib/season.js';
import { loadAll, ATTRACTION_CATS, TRANSPORT_TYPES, CATEGORY_LABEL, countBy, filterAttractions, filterTransport, recordLabel, muniLabel, englishPart, muniTourism, setEnglishFirst, isEnglishFirst } from './lib/data.js';
import { nameTerms } from './lib/terms.js';
import { themeOf, pointColor, initialTheme, rememberTheme } from './lib/theme.js';
import { walkingAvailability, indexWalking, walkingCoverage, IDENTITIES, CUTOFF_M } from './lib/walking.js';

// 「日文名称 (English name)」 with the English part styled lighter; original alone if none is verified.
// With "English first" on: English (日文). A record with no OSM name shows the English name of the same
// OSM record if there is one, otherwise its fallback label.
function NameEn({ p }) {
  if (!p.name) return <>{p.name_en || p.display_name}</>;
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
const n0 = (v) => (v == null ? '—' : v.toLocaleString('en-US'));

export default function App() {
  const [loaded, setLoaded] = useState(null);
  const [theme, setThemeState] = useState(initialTheme);
  const [cats, setCats] = useState(ATTRACTION_CATS.map((c) => c.key));
  const [types, setTypes] = useState(TRANSPORT_TYPES.map((t) => t.key));
  const [query, setQuery] = useState('');
  const [densityMode, setDensityMode] = useState('off');
  const [basemap, setBasemap] = useState('night');
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [sheet, setSheet] = useState(null); // 'journeys' | 'sources' | null
  const [maxWalk, setMaxWalk] = useState(500);
  const [walkTypes, setWalkTypes] = useState(['bus', 'rail']);
  const [walkShow, setWalkShow] = useState(false);
  const [enFirst, setEnFirstState] = useState(isEnglishFirst);
  const toggleEnFirst = () => { const v = !enFirst; setEnglishFirst(v); setEnFirstState(v); try { localStorage.setItem(EN_KEY, v ? '1' : '0'); } catch { /* not stored */ } };
  // Which attraction records the walking summary and map include (unverified ones are off by default).
  const [walkIdent, setWalkIdent] = useState(['named', 'osm_tags']);
  const [focus, setFocus] = useState(null); // hovered category / transit type in the filter list
  const [leftOpen, setLeftOpen] = useState(() => !isPhone());
  const [rightOpen, setRightOpen] = useState(true);
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
  }, [walk, d, sel, walkShow, walkTypes, cats, A, byId, walkIdent]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (!s) return setSel(null);
    const hit = byId.get(s.id);
    if (!hit) return;
    // choosing another stop ends the route that was started from the previous stop
    if (hit.layer === 'transport' && busRun?.fromPoint && busRun.fromPoint !== s.id) closeBus();
    const [lon, lat] = hit.f.geometry.coordinates;
    const p = hit.f.properties;
    const ph = d?.photos?.photos?.[s.id];
    setSel({ id: s.id, layer: hit.layer, coords: [lon, lat], fly, label: recordLabel(p), en: !!(p.name && englishPart(p.name, p.name_en)), sub: CATEGORY_LABEL[p.category],
      photo: ph ? { src: `${import.meta.env.BASE_URL}${ph.src}`, related: ph.match === 'wikidata-related' ? ph.matched_label : null, credit: `${ph.artist} · ${ph.license}` } : null });
    setRightOpen(true);
    if (hit.layer !== 'attraction') setTab((t) => (t === 'walk' ? 'overview' : t));
    if (!d?.bus?.point_stops?.[s.id]) setTab((t) => (t === 'bus' ? 'overview' : t));
    if (isPhone()) setLeftOpen(false);
  };
  // the callout swatch follows the theme without re-running the camera move
  const selForMap = useMemo(() => (sel ? { ...sel, color: pointColor(byId.get(sel.id)?.f.properties || {}, theme) } : null), [sel, byId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const k = (e) => { if (e.key === 'Escape') { setSheet(null); setLegend(false); } };
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
    if (key === 'density' || key === 'walk') { if (!isPhone()) setLeftOpen(true); setPanel(key); }
    if (key === 'density' && d?.kde) setDensityMode('kde');
    if (key === 'walk' && walk.available) { setSel(null); setWalkShow(true); }
    if (key === 'weather') { select({ id: 'S00019' }); setTab('weather'); } // Kyoto Station
    if (key === 'map') resetViewRef.current?.();
  };
  const toggleUi = <><SeasonBadge auto={seasonAuto} mode={seasonMode} onMode={setSeasonMode} info={seasonInfo} /><MusicPlayer /><ThemeToggle theme={theme} onChange={setTheme} /></>;
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
  const matches = query.trim() ? [...fa.slice(0, 40), ...ft.slice(0, 40)] : [];
  const resetView = () => mapRef.current?.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
  resetViewRef.current = resetView;
  const isAttr = selHit?.layer === 'attraction';
  const selStopKeys = (sel && d.bus?.point_stops?.[sel.id]) || null;
  const tabs = selHit ? [['overview', 'Overview'], ...(selStopKeys ? [['bus', 'Bus Routes']] : []), ...(isAttr ? [['walk', 'Walking Routes']] : []), ['weather', 'Weather'], ['journeys', 'Journeys & Fares']] : [];
  const busRouteObj = d.bus?.routes.find((r) => r.key === busRoute) || null;
  const curTab = tabs.some(([k]) => k === tab) ? tab : 'overview';
  const densityLabel = densityMode === 'kde' ? 'KDE layer on' : densityMode === 'heat' ? 'Heatmap on' : 'Off';
  const pilotName = walk.pilotInfo?.name;
  const cls = 'app' + (introDone ? '' : dashSeen ? ' intro' : ' waiting') + (leftOpen ? '' : ' no-left') + (rightOpen ? '' : ' no-right') + (selHit ? ' has-sel' : '');

  return (
    <>
    {toggleUi}
    {intro}
    {d.explore?.places?.length > 0 && <Explore places={d.explore.places} attractions={A.length} stops={Tr.length} near={nearPlace} onEnter={enter} />}
    <Seam mark="読" ja="地図を読む" en="Reading the map" />
    <Features items={features} onOpen={openFeature} />
    <Seam mark="図" ja="地図" en="The dashboard" />
    <div id="dashboard" className={cls}>
      <header className="top">
        <span className="wa-band" aria-hidden="true" />
        <button type="button" className="nav-btn" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-controls="explore-panel">
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
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'journeys' ? null : 'journeys')} aria-expanded={sheet === 'journeys'}>Journeys & Fares</button>
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'sources' ? null : 'sources')} aria-expanded={sheet === 'sources'}>Data & Sources</button>
        </nav>
      </header>

      <button type="button" className="scrim" aria-label="Close the explore panel" tabIndex={leftOpen ? 0 : -1} onClick={() => setLeftOpen(false)} />
      <aside className="left" id="explore-panel" aria-label="Explore: search, filters and analysis">
        <section className="card">
          <h3>Find a place</h3>
          <input id="q" type="search" placeholder="Attraction or stop · 日本語 / English / ID" aria-label="Search attractions or stops" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <ul className="results">
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
        </section>

        <section className="card">
          <h3>Attraction categories</h3>
          {ATTRACTION_CATS.map((c) => (
            <label className="chk" key={c.key} onMouseEnter={() => setFocus({ kind: 'cat', key: c.key })} onMouseLeave={() => setFocus(null)}>
              <input type="checkbox" checked={cats.includes(c.key)} onChange={() => toggle(cats, setCats, c.key)} />
              <span className="sw" style={{ background: T.cat[c.key] }} />
              <span>{c.label}</span>
              <span className="n">{catCount[c.key] || 0}</span>
            </label>
          ))}
          <div className="row-btns"><button className="link" type="button" onClick={() => setCats(ATTRACTION_CATS.map((c) => c.key))}>All</button><button className="link" type="button" onClick={() => setCats([])}>None</button></div>
        </section>

        <section className="card">
          <h3>Public transport</h3>
          {TRANSPORT_TYPES.map((t) => (
            <label className="chk" key={t.key} title={t.cats.map((c) => `${subCount[c] || 0} ${CATEGORY_LABEL[c].toLowerCase()}${(subCount[c] || 0) === 1 ? '' : 's'}`).join(' + ')} onMouseEnter={() => setFocus({ kind: 'type', key: t.key })} onMouseLeave={() => setFocus(null)}>
              <input type="checkbox" checked={types.includes(t.key)} onChange={() => toggle(types, setTypes, t.key)} />
              <img className="sw ico" src={iconURL(t.key)} alt="" />
              <span>{t.label}</span>
              <span className="n">{(typeCount[t.key] || 0).toLocaleString('en-US')}</span>
            </label>
          ))}
        </section>

        <section className="card analysis">
          <h3>Analysis</h3>
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
        </section>
      </aside>

      <main className="center">
        <i className="corner c1" /><i className="corner c2" /><i className="corner c3" /><i className="corner c4" />
        {core ? (
          <MapView theme={theme} data={d} cats={cats} types={types} query={query} densityMode={densityMode} basemap={basemap} selected={selForMap} active={dashSeen} focus={focus} onSelect={(s) => select(s, false)} onHover={setHover} mapRef={mapRef} walkSet={walkSet} maxWalk={maxWalk} busRun={busRun} busHighlight={busHl?.ids} onBusProgress={setBusProg} busCtl={busCtl} />
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
        </div>
        {legend && (
          <div className="map-legend" id="map-legend" role="region" aria-label="Map legend">
            <header><b>Legend</b><button className="x" type="button" onClick={() => setLegend(false)} aria-label="Close legend">×</button></header>
            <ul>
              {ATTRACTION_CATS.map((c) => <li key={c.key}><span className="dot" style={{ background: T.cat[c.key] }} />{c.label}</li>)}
              {TRANSPORT_TYPES.map((t) => <li key={t.key}><img src={iconURL(t.key)} alt="" width="16" height="16" />{t.label} stop <span className="muted">(dot when zoomed out)</span></li>)}
              <li><span className="ln" style={{ borderColor: T.outline.line }} />Kyoto Prefecture boundary</li>
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
        <button type="button" className="edge-btn l" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-controls="explore-panel" aria-label={leftOpen ? 'Hide the explore panel' : 'Show the explore panel'}><i /></button>
        <button type="button" className="edge-btn r" onClick={() => setRightOpen(!rightOpen)} aria-expanded={rightOpen} aria-controls="details" aria-label={rightOpen ? 'Hide the details panel' : 'Show the details panel'}><i /><span>Details</span></button>
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
            <span>{CATEGORY_LABEL[hover.feature.properties.category]}</span>
          </div>
        )}
        {failed.length > 0 && core && <div className="toast" role="alert">Some files failed to load: {failed.map(([, v]) => v.file).join(', ')}</div>}

        {sheet === 'journeys' && <Journeys journeys={d.journeys} onClose={() => setSheet(null)} />}
        {sheet === 'sources' && <Sources d={d} status={loaded.status} walk={walk} failed={failed} onClose={() => setSheet(null)} />}
      </main>

      <aside className="right" id="details" aria-label="Selected place">
        {!selHit ? (
          <section className="card empty">
            <h3>Select a place</h3>
            <p>Click an attraction or a stop on the map, or search by name on the left.</p>
          </section>
        ) : (
          <div className="stack" key={sel.id}>
            <Summary hit={selHit} pm={d.pointMuni} photos={d.photos} color={dotColor(selHit.f)} onClose={() => setSel(null)} onHide={() => setRightOpen(false)} />
            <div className="tabs" role="tablist" aria-label="Details">
              {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={curTab === k} aria-controls={`pane-${k}`} className={curTab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            <div className="pane card" role="tabpanel" id="pane-overview" aria-labelledby="tab-overview" hidden={curTab !== 'overview'}>
              <Overview hit={selHit} pm={d.pointMuni} photos={d.photos} tourism={d.tourism} dup={dupOsm[sel.id]} walk={walk} ctx={d.context?.records?.[sel.id]} onWalk={() => setTab('walk')} />
            </div>
            {selStopKeys && (
              <div className="pane card" role="tabpanel" id="pane-bus" aria-labelledby="tab-bus" hidden={curTab !== 'bus'}>
                <BusAtStop bus={d.bus} stopKeys={selStopKeys} active={busRun?.variant.id} hlKey={busHl?.route.key} onStart={(route, v, key) => startBus(route, v.id, key, sel.id)} onHighlight={highlightBus} err={busErr} />
              </div>
            )}
            {isAttr && (
              <div className="pane card" role="tabpanel" id="pane-walk" aria-labelledby="tab-walk" hidden={curTab !== 'walk'}>
                <Walking available={walk} index={walkIndex} id={sel.id} byId={byId} maxWalk={maxWalk} />
              </div>
            )}
            {/* kept mounted so the forecast and the planned visit survive a change of tab */}
            <div className="pane card" role="tabpanel" id="pane-weather" aria-labelledby="tab-weather" hidden={curTab !== 'weather'}>
              <Weather target={{ id: sel.id, lat: sel.coords[1], lon: sel.coords[0] }} visit={visit} onVisit={setVisit} />
            </div>
            <div className="pane card" role="tabpanel" id="pane-journeys" aria-labelledby="tab-journeys" hidden={curTab !== 'journeys'}>
              <PlaceJourneys journeys={d.journeys} id={sel.id} onOpen={() => setSheet('journeys')} />
            </div>
          </div>
        )}
      </aside>
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
const SEAL = { attraction: '名', viewpoint: '景', museum: '館', castle: '城', bus_stop: '停', bus_station: '停', railway_station: '駅', railway_halt: '駅', tram_stop: '停' };

function Chip({ ok, warn, label }) {
  return <span className={'chip ' + (ok ? 'ok' : warn ? 'warn' : 'bad')}><i />{label}</span>;
}

const MATCH_TEXT = {
  'wikidata-exact': (p) => `Wikidata item with the same name, ${p.distance_m} m from this point`,
  'wikidata-related': (p) => `Photo of a related place: ${p.matched_label} (Wikidata, ${p.distance_m} m away). It may not show this exact record.`,
  'commons-geo': (p) => `Commons photo whose file name matches and which was taken ${p.distance_m} m from this point`,
};

// Top of the details panel: reliable photo (if any), name, category and where it is.
function Summary({ hit, pm, photos, color, onClose, onHide }) {
  const p = hit.f.properties;
  const [imgOk, setImgOk] = useState(false);
  const ph = hit.layer === 'attraction' ? photos?.photos?.[p.id] : null;
  const muniCode = pm?.points?.[p.id];
  return (
    <section className={'card detail' + (ph ? ' with-photo' : '')}>
      {/* hazy moving backdrop: the record's own photo when there is one, else a soft colour field */}
      <div className="haze" aria-hidden="true"><i key={p.id} style={{ backgroundImage: `url(${import.meta.env.BASE_URL}${ph?.src || `media/haze-${(p.id.charCodeAt(p.id.length - 1) % 5) + 1}.jpg`})` }} /></div>
      {ph && (
        <figure className={'hero photo' + (imgOk ? ' loaded' : '')}>
          <div className="ph-frame">
            <img src={`${import.meta.env.BASE_URL}${ph.src}`} alt={ph.description || ph.title} width={ph.width} height={ph.height} onLoad={() => setImgOk(true)} />
            <span className={'ph-badge ' + ph.match}>{ph.match === 'wikidata-related' ? 'Related place' : ph.match === 'commons-geo' ? 'Nearby photo' : 'Verified match'}</span>
          </div>
        </figure>
      )}
      <header className="card-h">
        <span className="kind"><i className="hanko" style={{ '--c': color }} aria-hidden="true" lang="ja">{SEAL[p.category] || '印'}</i>{CATEGORY_LABEL[p.category]}</span>
        <span className="card-h-btns">
          <button className="x hide-btn" type="button" onClick={onHide} aria-label="Hide details">⌄</button>
          <button className="x" type="button" onClick={onClose} aria-label="Clear selection">×</button>
        </span>
      </header>
      <h2 lang={p.name ? 'ja' : 'en'} key={p.id + (isEnglishFirst() ? 'en' : 'ja')}>
        {p.name ? (englishPart(p.name, p.name_en) && isEnglishFirst()
          ? <><Decode lang="en" text={p.name_en} /> <span className="en" lang="ja">({p.name})</span></>
          : <>{p.name}{p.name_en && englishPart(p.name, p.name_en) && <> <Decode className="en" lang="en" text={`(${p.name_en})`} /></>}</>)
          : p.name_en ? <span lang="en">{p.name_en}</span> : <span className="muted">{p.display_name}</span>}
      </h2>
      <p className="where" lang="ja">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8A4.5 4.5 0 0 0 3.500 6.5c0 3.800 4.500 8 4.500 8z" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="6.4" r="1.6" fill="currentColor" /></svg>
        {muniCode ? muniLabel(pm, muniCode) : 'Outside the prefecture boundary polygons'}
      </p>
      {hit.layer === 'attraction' && photos && !ph && <p className="nophoto xs"><span className="ph-ico" aria-hidden="true" />No verified photo for this place</p>}
    </section>
  );
}

// How a containing OSM area is described: a location, never an identification of the point.
const insidePhrase = (k) => (/temple|shrine|place of worship|church/.test(k) ? 'Inside the grounds of' : k === 'building' ? 'At' : 'Inside');

function Overview({ hit, pm, photos, tourism, dup, walk, ctx, onWalk }) {
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
        : <p className="xs limit">This record has no name in the source. The label above is a fallback, not an official name.</p>)}
      <dl className="kv">
        <div><dt>Category</dt><dd>{CATEGORY_LABEL[p.category]}</dd></div>
        {ctx?.inside?.length > 0 && (
          <div><dt>Location</dt><dd>
            {ctx.inside.slice(0, 2).map((s, i) => <span key={i} className="inside">{insidePhrase(s.kind)} <b lang="ja">{s.name_en ? (isEnglishFirst() ? `${s.name_en} (${s.name})` : `${s.name} (${s.name_en})`) : s.name}</b> <small className="muted">· {s.kind}</small></span>)}
            <small className="muted">OpenStreetMap area that contains this point. It tells where the point is, not what it is.</small>
          </dd></div>
        )}
        {!p.name && ctx && (
          <div><dt>Record</dt><dd>{ctx.identity === 'osm_tags' ? <>OSM-tagged: {Object.keys(ctx.tags || {}).join(', ')}</> : 'Unverified: only a category tag in OpenStreetMap'}</dd></div>
        )}
        {(() => { const terms = nameTerms(p.name, hit.layer === 'transport'); return terms.length > 0 && (
          <div><dt>In the name</dt><dd className="terms">{terms.map((x) => <span key={x.t}><b lang="ja">{x.t}</b> {x.m}</span>)}<small className="muted">Meaning of common words in the name, not a translation.</small></dd></div>
        ); })()}
        <div><dt>Area</dt><dd lang="ja">{muniCode ? muniLabel(pm, muniCode) : 'outside all boundary polygons'}</dd></div>
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
          {ph?.wikidata && <div><dt>Photo item</dt><dd className="mono"><a href={`https://www.wikidata.org/wiki/${ph.wikidata}`} target="_blank" rel="noreferrer">{ph.wikidata}</a></dd></div>}
        </dl>
        {dup && <p className="xs warnline">Shares OSM ID {dup.osm_id} with {dup.ids.filter((x) => x !== p.id).join(', ')}. Both records are kept as supplied.</p>}
      </details>
    </div>
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

function Sources({ d, status, walk, failed, onClose }) {
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
            <p className="xs">Wikidata (P18) and Wikimedia Commons, retrieved {d.photos.retrieved_at.replace('T', ' ').replace('Z', ' UTC')}. {d.photos.with_photo} of {d.photos.named_records} named records have a photo: {d.photos.by_match['wikidata-exact']} same-name Wikidata items, {d.photos.by_match['wikidata-related']} related places, {d.photos.by_match['commons-geo']} Commons photos taken within 300 m. Only CC0, public-domain, CC BY and CC BY-SA files are used; each photo shows its author and licence.</p>
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
