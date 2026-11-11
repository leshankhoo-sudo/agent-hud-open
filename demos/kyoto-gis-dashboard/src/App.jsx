import { useEffect, useMemo, useRef, useState } from 'react';
import { iconURL } from './lib/icons.js';
import MapView, { BASEMAPS, KDE_BREAKS, kdeColors, OFFLINE_PREVIEW } from './MapView.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import Weather from './Weather.jsx';
import Intro from './Intro.jsx';
import Outro from './Outro.jsx';
import { loadAll, ATTRACTION_CATS, TRANSPORT_TYPES, CATEGORY_LABEL, countBy, filterAttractions, filterTransport, recordLabel, muniLabel, englishPart, muniTourism } from './lib/data.js';
import { themeOf, pointColor, initialTheme, rememberTheme } from './lib/theme.js';
import { walkingAvailability, indexWalking, walkingCoverage } from './lib/walking.js';

// 「日文名称 (English name)」 with the English part styled lighter; original alone if none is verified.
function NameEn({ p }) {
  if (!p.name) return <>{p.display_name}</>;
  const en = englishPart(p.name, p.name_en);
  return <>{p.name}{en && <span className="en" lang="en"> ({en})</span>}</>;
}

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
  const [focus, setFocus] = useState(null); // hovered category / transit type in the filter list
  const [leftOpen, setLeftOpen] = useState(() => !isPhone());
  const [rightOpen, setRightOpen] = useState(true);
  const [panel, setPanel] = useState(null); // which analysis is expanded: 'density' | 'walk' | null
  const [tab, setTab] = useState('overview');
  const [legend, setLegend] = useState(false);
  const [visit, setVisit] = useState({ day: null, hour: null }); // planned visit, shared by every place
  const mapRef = useRef(null);
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
  // Theme: only colours change. Filters, selection, analysis state and the planned visit are untouched.
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const setTheme = (t) => { setThemeState(t); rememberTheme(t); };
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
  const coverage = useMemo(() => {
    if (!walkIndex) return null;
    const ids = A.filter((f) => cats.includes(f.properties.category) && walk.scopeIds.has(f.properties.id)).map((f) => f.properties.id);
    return walkingCoverage(walkIndex, ids, walkTypes, maxWalk);
  }, [walkIndex, walk, A, cats, walkTypes, maxWalk]);
  // What the map animates: the selected pilot attraction's routes, or (after the walking
  // controls are used) every pilot route for the chosen stop types and categories.
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
      feats = d.walking.features.filter((f) => ok(f) && inCats.has(f.properties.attraction_id));
    }
    if (!mode) return null;
    return { mode, key: `${mode}|${sel?.id || ''}|${walkTypes.join()}|${cats.join()}`, items: feats.map(item).filter(Boolean) };
  }, [walk, d, sel, walkShow, walkTypes, cats, A, byId]);
  const dupOsm = useMemo(() => {
    const m = {};
    (d?.manifest?.transport?.duplicate_osm_ids || []).forEach((x) => x.ids.forEach((id) => (m[id] = x)));
    return m;
  }, [d]);

  const select = (s, fly = true) => {
    if (!s) return setSel(null);
    const hit = byId.get(s.id);
    if (!hit) return;
    const [lon, lat] = hit.f.geometry.coordinates;
    const p = hit.f.properties;
    const ph = d?.photos?.photos?.[s.id];
    setSel({ id: s.id, layer: hit.layer, coords: [lon, lat], fly, label: recordLabel(p), en: !!(p.name && englishPart(p.name, p.name_en)), sub: CATEGORY_LABEL[p.category],
      photo: ph ? { src: `${import.meta.env.BASE_URL}${ph.src}`, related: ph.match === 'wikidata-related' ? ph.matched_label : null, credit: `${ph.artist} · ${ph.license}` } : null });
    setRightOpen(true);
    if (hit.layer !== 'attraction') setTab((t) => (t === 'walk' ? 'overview' : t));
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

  const toggleUi = <ThemeToggle theme={theme} onChange={setTheme} />;
  const intro = <Intro manifest={d?.manifest} photos={d?.photos} kdeMeta={d?.kdeMeta} walkInfo={walk.available ? walk.scopeIds.size : null} />;
  if (!loaded) return <>{toggleUi}{intro}<div className="boot" id="dashboard"><div className="boot-mark" /><p>Loading Kyoto Prefecture data…</p></div></>;
  const failed = Object.entries(loaded.status).filter(([, v]) => !v.ok);
  const core = d.attractions && d.transport;
  const selHit = sel ? byId.get(sel.id) : null;
  const toggle = (arr, set, k) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  const matches = query.trim() ? [...fa.slice(0, 40), ...ft.slice(0, 40)] : [];
  const resetView = () => mapRef.current?.fitBounds([[134.85, 34.7], [136.06, 35.79]], { padding: 24, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
  const isAttr = selHit?.layer === 'attraction';
  const tabs = selHit ? [['overview', 'Overview'], ...(isAttr ? [['walk', 'Walking Routes']] : []), ['weather', 'Weather'], ['journeys', 'Journeys & Fares']] : [];
  const curTab = tabs.some(([k]) => k === tab) ? tab : 'overview';
  const densityLabel = densityMode === 'kde' ? 'KDE layer on' : densityMode === 'heat' ? 'Heatmap on' : 'Off';
  const pilotName = walk.pilotInfo?.name;
  const cls = 'app' + (introDone ? '' : dashSeen ? ' intro' : ' waiting') + (leftOpen ? '' : ' no-left') + (rightOpen ? '' : ' no-right') + (selHit ? ' has-sel' : '');

  return (
    <>
    {toggleUi}
    {intro}
    <div id="dashboard" className={cls}>
      <header className="top">
        <button type="button" className="nav-btn" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-controls="explore">
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
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'journeys' ? null : 'journeys')} aria-expanded={sheet === 'journeys'}>Journeys & Fares</button>
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'sources' ? null : 'sources')} aria-expanded={sheet === 'sources'}>Data & Sources</button>
        </nav>
      </header>

      <button type="button" className="scrim" aria-label="Close the explore panel" tabIndex={leftOpen ? 0 : -1} onClick={() => setLeftOpen(false)} />
      <aside className="left" id="explore" aria-label="Explore: search, filters and analysis">
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
            <span className={'entry-s' + (walkShow ? ' on' : '')}>{!walk.available ? 'Not calculated' : walk.pilot ? `Pilot · ${walk.scopeIds.size} records` : 'Results loaded'}</span>
            <i aria-hidden="true" />
          </button>
          {panel === 'walk' && (
            <div className="entry-body" id="an-walk" aria-disabled={!walk.available}>
              {!walk.available && <p className="xs limit">Walking analysis not yet available. These controls stay disabled until real network results are loaded.</p>}
              {walk.pilot && <p className="xs limit">Pilot area only: {pilotName}, {walk.scopeIds.size} named attraction records (dashed box on the map). Not a Kyoto Prefecture result.</p>}
              <label className="xs" htmlFor="walkmax">Max walking distance along roads: <b className="mono">{maxWalk} m</b></label>
              <input id="walkmax" type="range" min="100" max="2000" step="50" value={maxWalk} onChange={(e) => { setMaxWalk(Number(e.target.value)); setWalkShow(true); }} disabled={!walk.available} />
              <div className="seg sm">
                {[['bus', 'Nearest bus'], ['rail', 'Nearest rail']].map(([k, l]) => (
                  <button key={k} type="button" disabled={!walk.available} className={walkTypes.includes(k) ? 'on' : ''} aria-pressed={walkTypes.includes(k)} onClick={() => { setWalkTypes(walkTypes.includes(k) ? (walkTypes.length > 1 ? walkTypes.filter((x) => x !== k) : walkTypes) : [...walkTypes, k]); setWalkShow(true); }}>{l}</button>
                ))}
              </div>
              {walk.available && (
                <div className="walk-map">
                  <button type="button" className={'btn sm' + (walkShow ? '' : ' ghost')} onClick={() => { if (sel?.layer === 'attraction') setSel(null); setWalkShow(!walkShow || sel?.layer === 'attraction'); }}>
                    {walkShow && !(sel?.layer === 'attraction') ? 'Hide routes on map' : 'Show pilot routes on map'}
                  </button>
                </div>
              )}
              {coverage && (
                <div className="cov">
                  <div className="cov-big"><b className="mono"><Rolling value={coverage.within} /></b><span>of {coverage.denominator} pilot records within {maxWalk} m of a {walkTypes.join(' or ')} stop</span></div>
                  <ul className="xs states">
                    <li><i className="st far" />Beyond {maxWalk} m: {coverage.beyond}</li>
                    <li><i className="st none" />No connectable network route: {coverage.noRoute}</li>
                    <li><i className="st nc" />Not calculated yet: {coverage.notComputed} in the pilot · {(A.length - walk.scopeIds.size).toLocaleString('en-US')} records outside it</li>
                  </ul>
                  <details className="more-d"><summary>How this is counted</summary>
                    <p className="xs">Routes follow the road network; no straight lines are used. Counted over pilot records in the current category filter, each attraction once, using its nearer selected stop type. Click a pilot attraction to see only its routes.</p>
                  </details>
                </div>
              )}
            </div>
          )}
        </section>
      </aside>

      <main className="center">
        <i className="corner c1" /><i className="corner c2" /><i className="corner c3" /><i className="corner c4" />
        {core ? (
          <MapView theme={theme} data={d} cats={cats} types={types} query={query} densityMode={densityMode} basemap={basemap} selected={selForMap} active={dashSeen} focus={focus} onSelect={(s) => select(s, false)} onHover={setHover} mapRef={mapRef} walkSet={walkSet} maxWalk={maxWalk} />
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
        <button type="button" className="edge-btn l" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-controls="explore" aria-label={leftOpen ? 'Hide the explore panel' : 'Show the explore panel'}><i /></button>
        <button type="button" className="edge-btn r" onClick={() => setRightOpen(!rightOpen)} aria-expanded={rightOpen} aria-controls="details" aria-label={rightOpen ? 'Hide the details panel' : 'Show the details panel'}><i /><span>Details</span></button>
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
              <Overview hit={selHit} pm={d.pointMuni} photos={d.photos} tourism={d.tourism} dup={dupOsm[sel.id]} walk={walk} onWalk={() => setTab('walk')} />
            </div>
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
    <Outro manifest={d.manifest} />
    </>
  );
}

function Clock() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(t);
  return <span className="clock" title="Current time in Kyoto">{s} JST</span>;
}

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
        <span className="kind"><i style={{ background: color }} />{CATEGORY_LABEL[p.category]}</span>
        <span className="card-h-btns">
          <button className="x hide-btn" type="button" onClick={onHide} aria-label="Hide details">⌄</button>
          <button className="x" type="button" onClick={onClose} aria-label="Clear selection">×</button>
        </span>
      </header>
      <h2 lang={p.name ? 'ja' : 'en'} key={p.id}>
        {p.name ? <>{p.name}{p.name_en && englishPart(p.name, p.name_en) && <> <Decode className="en" lang="en" text={`(${p.name_en})`} /></>}</> : <span className="muted">{p.display_name}</span>}
      </h2>
      <p className="where" lang="ja">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8A4.5 4.5 0 0 0 3.500 6.5c0 3.800 4.500 8 4.500 8z" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="6.4" r="1.6" fill="currentColor" /></svg>
        {muniCode ? muniLabel(pm, muniCode) : 'Outside the prefecture boundary polygons'}
      </p>
      {hit.layer === 'attraction' && photos && !ph && <p className="nophoto xs"><span className="ph-ico" aria-hidden="true" />No verified photo for this place</p>}
    </section>
  );
}

function Overview({ hit, pm, photos, tourism, dup, walk, onWalk }) {
  const p = hit.f.properties;
  const [lon, lat] = hit.f.geometry.coordinates;
  const muniCode = pm?.points?.[p.id];
  const ph = hit.layer === 'attraction' ? photos?.photos?.[p.id] : null;
  const tc = muniTourism(tourism, pm, muniCode);
  const tm = tourism?.municipalities;
  const inPilot = walk.available && (!walk.pilot || walk.scopeIds.has(p.id));
  return (
    <div className="ov">
      {!p.name && <p className="xs limit">This record has no name in the source. The label above is a fallback, not an official name.</p>}
      <dl className="kv">
        <div><dt>Category</dt><dd>{CATEGORY_LABEL[p.category]}</dd></div>
        <div><dt>Area</dt><dd lang="ja">{muniCode ? muniLabel(pm, muniCode) : 'outside all boundary polygons'}</dd></div>
        {hit.layer === 'attraction' && (
          <div><dt>Walking access</dt><dd>{inPilot ? <button className="link" type="button" onClick={onWalk}>Network routes available · open Walking Routes</button> : walk.available ? `Not calculated yet (pilot covers ${walk.scopeIds.size} records in ${walk.pilotInfo?.name})` : 'Not calculated yet'}</dd></div>
        )}
      </dl>

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
  const row = (t, label) => {
    const x = r[t];
    if (!x) return <div className="wrow"><dt>{label}</dt><dd><span className="state"><i className="st nc" />Not calculated yet</span></dd></div>;
    if (x.route_status !== 'ok') return <div className="wrow"><dt>{label}</dt><dd><span className="state"><i className="st none" /><b>No connectable network route</b></span><small>Result: {x.route_status} · distance not available</small>{x.note && <small>{x.note}</small>}</dd></div>;
    const s = byId.get(x.stop_id)?.f.properties;
    const within = x.distance_m <= maxWalk;
    return (
      <div className="wrow">
        <dt><i className={'wkey ' + t} />{label}</dt>
        <dd>
          <b lang="ja">{s ? <NameEn p={s} /> : x.stop_id}</b>
          <span className="wdist"><b className="mono"><Rolling value={Math.round(x.distance_m)} /> m</b> · ≈{x.duration_min} min walk</span>
          <span className="state"><i className={'st ' + (within ? 'ok' : 'far')} />{within ? `Within ${maxWalk} m` : `Beyond ${maxWalk} m (selected distance)`}</span>
          {x.note && <small className="warnline">{x.note}</small>}
          <small className="mono muted">{x.stop_id} · 80 m/min · access gaps not added: {x.attraction_snap_gap_m} m + {x.stop_snap_gap_m} m</small>
        </dd>
      </div>
    );
  };
  return (
    <section className="walk">
      <p className="xs limit">Pilot result ({available.pilotInfo?.name || 'pilot area'}): routes follow the road network, never a straight line.</p>
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
        <Chip ok={walk.available && !walk.pilot} warn={!walk.available || walk.pilot} label={!walk.available ? 'Walking: not calculated' : walk.pilot ? `Walking: pilot only (${walk.scopeIds.size} records)` : 'Walking: results loaded'} />
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
          <p className="xs">walking_routes.geojson status: <b>{d.walking?.status || 'missing'}</b>{d.walking?.scope ? ` (scope: ${d.walking.scope})` : ''}, {d.walking?.features?.length ?? 0} features.</p>
          {d.walkReport && <p className="xs">Road data: {d.walkReport.road_data_check.total.toLocaleString('en-US')} segments read from {Object.keys(d.walkReport.road_data_check.files).length} GeoJSON parts ({d.walkReport.road_data_check.unique_osm_id.toLocaleString('en-US')} unique OSM IDs). Pilot graph: {d.walkReport.graph.nodes.toLocaleString('en-US')} vertices, {d.walkReport.graph.components} connected pieces. Results: {Object.entries(d.walkReport.results).map(([k, v]) => `${k} ${v}`).join(', ')}. Computed {d.walkReport.computed_at.replace('T', ' ').replace('+00:00', ' UTC')}.</p>}
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
