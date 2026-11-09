import { useEffect, useMemo, useRef, useState } from 'react';
import MapView, { BASEMAPS, KDE_BREAKS, KDE_COLORS, OFFLINE_PREVIEW } from './MapView.jsx';
import Weather from './Weather.jsx';
import { loadAll, ATTRACTION_CATS, TRANSPORT_TYPES, CATEGORY_LABEL, countBy, filterAttractions, filterTransport } from './lib/data.js';
import { walkingAvailability, indexWalking, walkingCoverage } from './lib/walking.js';

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

export default function App() {
  const [loaded, setLoaded] = useState(null);
  const [cats, setCats] = useState(ATTRACTION_CATS.map((c) => c.key));
  const [types, setTypes] = useState(TRANSPORT_TYPES.map((t) => t.key));
  const [query, setQuery] = useState('');
  const [densityMode, setDensityMode] = useState('off');
  const [basemap, setBasemap] = useState('gsi');
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [sheet, setSheet] = useState(null); // 'journeys' | 'sources' | null
  const [maxWalk, setMaxWalk] = useState(500);
  const [walkTypes, setWalkTypes] = useState(['bus', 'rail']);
  const [walkShow, setWalkShow] = useState(false);
  const mapRef = useRef(null);
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => { if (loaded) { const t = setTimeout(() => setIntroDone(true), 2400); return () => clearTimeout(t); } }, [loaded]);

  useEffect(() => { loadAll().then(setLoaded); }, []);

  const d = loaded?.data;
  const A = d?.attractions?.features || [];
  const T = d?.transport?.features || [];
  const byId = useMemo(() => {
    const m = new Map();
    A.forEach((f) => m.set(f.properties.id, { f, layer: 'attraction' }));
    T.forEach((f) => m.set(f.properties.id, { f, layer: 'transport' }));
    return m;
  }, [A, T]);
  const fa = useMemo(() => filterAttractions(A, cats, query), [A, cats, query]);
  const ft = useMemo(() => filterTransport(T, types, query), [T, types, query]);
  const catCount = useMemo(() => countBy(A, 'category'), [A]);
  const typeCount = useMemo(() => countBy(T, 'transport_type'), [T]);
  const subCount = useMemo(() => countBy(T, 'category'), [T]);
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
      return st ? { feature: f, stop: { id: st.properties.id, name: st.properties.name || st.properties.display_name, coords: st.geometry.coordinates, type: f.properties.stop_type } } : null;
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
    setSel({ id: s.id, layer: hit.layer, coords: [lon, lat], fly, label: p.name || p.display_name, sub: `${p.id} · ${CATEGORY_LABEL[p.category]}`, color: dotColor(hit.f) });
  };
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { setSheet(null); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  if (!loaded) return <div className="boot"><div className="boot-mark" /><p>Loading Kyoto Prefecture data…</p></div>;
  const failed = Object.entries(loaded.status).filter(([, v]) => !v.ok);
  const core = d.attractions && d.transport;
  const selHit = sel ? byId.get(sel.id) : null;
  const toggle = (arr, set, k) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  const matches = query.trim() ? [...fa.slice(0, 40), ...ft.slice(0, 40)] : [];

  return (
    <div className={'app' + (introDone ? '' : ' intro')}>
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect x="3" y="7" width="26" height="3.4" rx="1.4" fill="#ff7a45" /><rect x="6" y="12.5" width="20" height="2.4" rx="1" fill="#ff7a45" /><rect x="8.4" y="10" width="2.6" height="18" rx="1" fill="#ff7a45" /><rect x="21" y="10" width="2.6" height="18" rx="1" fill="#ff7a45" /></svg>
          <div>
            <h1>Kyoto Prefecture Tourism GIS</h1>
            <p>University GIS prototype · provisional extent: Kyoto Prefecture (京都府)</p>
          </div>
        </div>
        <div className="counts" aria-live="polite">
          <div className="count">
            <span className="k">Attractions shown</span>
            <span className="v"><Rolling value={fa.length} /><small> / {A.length.toLocaleString('en-US')}</small></span>
            <span className="k2">preliminary records</span>
          </div>
          <div className="count">
            <span className="k">Transit stops shown</span>
            <span className="v"><Rolling value={ft.length} /><small> / {T.length.toLocaleString('en-US')}</small></span>
            <span className="k2">preliminary records</span>
          </div>
        </div>
        <Clock />
        <div className="status">
          <Chip ok={core && !failed.length} label={failed.length ? `${failed.length} file(s) failed` : 'Map data loaded'} />
          <Chip ok={!!d.kde} label={d.kde ? 'Density: KDE computed' : 'Density: missing'} />
          <Chip ok={walk.available && !walk.pilot} warn={!walk.available || walk.pilot} label={!walk.available ? 'Walking: not calculated' : walk.pilot ? `Walking: pilot only (${walk.scopeIds.size} records)` : 'Walking: results loaded'} />
          <button className="btn" type="button" onClick={() => setSheet(sheet === 'journeys' ? null : 'journeys')} aria-expanded={sheet === 'journeys'}>Sample journeys & fares</button>
          <button className="btn ghost" type="button" onClick={() => setSheet(sheet === 'sources' ? null : 'sources')} aria-expanded={sheet === 'sources'}>Data & sources</button>
        </div>
      </header>

      <aside className="left" aria-label="Filters">
        <section className="card">
          <h3>Search</h3>
          <input id="q" type="search" placeholder="Name, A00001, S00019 or OSM ID" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <ul className="results">
              {matches.length === 0 && <li className="muted">No records match.</li>}
              {matches.slice(0, 12).map((f) => (
                <li key={f.properties.id}>
                  <button type="button" onClick={() => select({ id: f.properties.id })}>
                    <span className="dot" style={{ background: dotColor(f) }} />
                    <span className="nm">{f.properties.display_name}</span>
                    <span className="id">{f.properties.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Attraction categories</h3>
          {ATTRACTION_CATS.map((c) => (
            <label className="chk" key={c.key}>
              <input type="checkbox" checked={cats.includes(c.key)} onChange={() => toggle(cats, setCats, c.key)} />
              <span className="sw" style={{ background: c.color }} />
              <span>{c.label}</span>
              <span className="n">{catCount[c.key] || 0}</span>
            </label>
          ))}
          <div className="row-btns"><button className="link" type="button" onClick={() => setCats(ATTRACTION_CATS.map((c) => c.key))}>All</button><button className="link" type="button" onClick={() => setCats([])}>None</button></div>
        </section>

        <section className="card">
          <h3>Transit type</h3>
          {TRANSPORT_TYPES.map((t) => (
            <label className="chk" key={t.key}>
              <input type="checkbox" checked={types.includes(t.key)} onChange={() => toggle(types, setTypes, t.key)} />
              <span className="sw round" style={{ background: t.color }} />
              <span>{t.label}<small className="sub">{t.cats.map((c) => `${subCount[c] || 0} ${CATEGORY_LABEL[c].toLowerCase()}${(subCount[c] || 0) === 1 ? '' : 's'}`).join(' + ')}</small></span>
              <span className="n">{(typeCount[t.key] || 0).toLocaleString('en-US')}</span>
            </label>
          ))}
        </section>

        <section className="card">
          <h3>Analysis 1 · Attraction density</h3>
          <div className="seg" role="radiogroup" aria-label="Density layer">
            {[['off', 'Off'], ['kde', 'KDE result'], ['heat', 'Visual heatmap']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={densityMode === k} className={densityMode === k ? 'on' : ''} onClick={() => setDensityMode(k)} disabled={k === 'kde' && !d.kde}>{l}</button>
            ))}
          </div>
          {densityMode === 'kde' && d.kdeMeta && (
            <div className="legend">
              <div className="ramp">{KDE_COLORS.map((c, i) => <span key={c} style={{ background: c }} title={`${KDE_BREAKS[i]}+`} />)}</div>
              <div className="ramp-l">{KDE_BREAKS.map((b) => <span key={b}>{b}</span>)}</div>
              <p className="xs">Records per km² · quartic kernel · search radius {d.kdeMeta.search_radius_m / 1000} km · {d.kdeMeta.cell_size_m} m cells · EPSG:6674. Follows the category filter.</p>
            </div>
          )}
          {densityMode === 'heat' && <p className="xs warnline">Visual heatmap for display only. Its radius changes with zoom, so it is not a Kernel Density result.</p>}
          <p className="xs muted">Shows where point records concentrate. It does not measure visitor numbers or crowding.</p>
        </section>

        <section className={'card' + (walk.available ? '' : ' disabled-card')} aria-disabled={!walk.available}>
          <h3>Analysis 2 · Walking access</h3>
          {!walk.available && <p className="xs">Walking analysis not yet available. These controls stay disabled until real network results are loaded.</p>}
          {walk.pilot && <p className="xs warnline">Pilot area only ({walk.pilotInfo?.name}, {walk.scopeIds.size} named records, dashed box on the map). Not a Kyoto Prefecture result.</p>}
          <label className="xs" htmlFor="walkmax">Max network walking distance: <b className="mono">{maxWalk} m</b></label>
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
              <p className="xs muted">Routes grow along the road network up to the distance above; a stop lights up when its route reaches it. Click a pilot attraction to see only its routes.</p>
            </div>
          )}
          {coverage && (
            <div className="cov">
              <div className="cov-big"><b className="mono"><Rolling value={coverage.within} /></b><span>of {coverage.denominator} pilot records within {maxWalk} m of a {walkTypes.join(' or ')} stop</span></div>
              <ul className="xs">
                <li>Farther than {maxWalk} m: {coverage.beyond}</li>
                <li>No network route (reported separately): {coverage.noRoute}</li>
                {coverage.notComputed > 0 && <li>Not computed: {coverage.notComputed}</li>}
              </ul>
              <p className="xs muted">Denominator: pilot records in the current category filter. Each attraction counted once, using its nearer selected stop type.</p>
            </div>
          )}
        </section>

        <section className="card">
          <h3>Basemap</h3>
          {OFFLINE_PREVIEW ? <p className="xs warnline">Online preview: basemap tiles are blocked by the viewer, so only the project data is drawn. Run or deploy the project for the GSI / OSM basemap.</p> : (
          <div className="seg">
            {Object.entries(BASEMAPS).map(([k, b]) => <button key={k} type="button" className={basemap === k ? 'on' : ''} onClick={() => setBasemap(k)}>{b.label}</button>)}
          </div>)}
        </section>
      </aside>

      <main className="center">
        <i className="corner c1" /><i className="corner c2" /><i className="corner c3" /><i className="corner c4" />
        {core ? (
          <MapView data={d} cats={cats} types={types} query={query} densityMode={densityMode} basemap={basemap} selected={sel} onSelect={(s) => select(s, false)} onHover={setHover} mapRef={mapRef} walkSet={walkSet} maxWalk={maxWalk} />
        ) : (
          <div className="alert big" role="alert"><b>Map data could not be loaded.</b>{failed.map(([k, v]) => <span key={k}>{v.file}: {v.error}</span>)}</div>
        )}
        {hover && (
          <div className="tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
            <b>{hover.feature.properties.display_name}</b>
            <span>{hover.feature.properties.id} · {CATEGORY_LABEL[hover.feature.properties.category]}</span>
          </div>
        )}
        {failed.length > 0 && core && <div className="toast">Some files failed to load: {failed.map(([, v]) => v.file).join(', ')}</div>}

        {sheet === 'journeys' && <Journeys journeys={d.journeys} onClose={() => setSheet(null)} />}
        {sheet === 'sources' && <Sources d={d} status={loaded.status} onClose={() => setSheet(null)} />}
      </main>

      <aside className="right" aria-label="Selected record">
        {!selHit ? (
          <section className="card empty">
            <h3>No record selected</h3>
            <p>Click an attraction or a stop on the map, or search on the left. Weather is requested for the selected point.</p>
            <ol className="xs">
              <li>Attractions: coloured circles by category.</li>
              <li>Stops: small blue (bus), white (rail), pink (tram).</li>
            </ol>
          </section>
        ) : (
          <div className="stack" key={sel.id}>
            <Detail hit={selHit} pm={d.pointMuni} dup={dupOsm[sel.id]} onClose={() => setSel(null)} />
            {selHit.layer === 'attraction' && <Walking available={walk} index={walkIndex} id={sel.id} byId={byId} />}
            <Weather target={{ id: sel.id, lat: sel.coords[1], lon: sel.coords[0] }} />
          </div>
        )}
      </aside>
    </div>
  );
}

const dotColor = (f) => (ATTRACTION_CATS.find((c) => c.key === f.properties.category) || TRANSPORT_TYPES.find((t) => t.key === f.properties.transport_type) || { color: '#888' }).color;

function Clock() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(t);
  return <span className="clock" title="Current time in Kyoto">{s} JST</span>;
}

function Chip({ ok, warn, label }) {
  return <span className={'chip ' + (ok ? 'ok' : warn ? 'warn' : 'bad')}><i />{label}</span>;
}

function Detail({ hit, pm, dup, onClose }) {
  const p = hit.f.properties;
  const [lon, lat] = hit.f.geometry.coordinates;
  const muniCode = pm?.points?.[p.id];
  return (
    <section className="card detail">
      <header className="card-h">
        <span className="kind" style={{ background: dotColor(hit.f) }}>{CATEGORY_LABEL[p.category]}</span>
        <button className="x" type="button" onClick={onClose} aria-label="Clear selection">×</button>
      </header>
      <h2 lang={p.name ? 'ja' : 'en'}>{p.name || <span className="muted">{p.display_name}</span>}</h2>
      {!p.name && <p className="xs muted">This record has no name in the source. The label above is a fallback, not an official name.</p>}
      <dl className="kv">
        <div><dt>Record ID</dt><dd className="mono">{p.id}</dd></div>
        <div><dt>OSM ID</dt><dd className="mono"><a href={`https://www.openstreetmap.org/node/${p.osm_id}`} target="_blank" rel="noreferrer">{p.osm_id}</a></dd></div>
        <div><dt>Category</dt><dd>{CATEGORY_LABEL[p.category]} <span className="muted">({p.category})</span></dd></div>
        {p.transport_type && <div><dt>Transit type</dt><dd>{p.transport_type}</dd></div>}
        <div><dt>Municipality</dt><dd lang="ja">{muniCode ? pm.names[muniCode] : 'outside all N03 polygons'}<span className="muted xs"> · N03 spatial join</span></dd></div>
        <div><dt>Coordinates</dt><dd className="mono">{lat.toFixed(5)}, {lon.toFixed(5)}</dd></div>
        <div><dt>Status</dt><dd>{p.validation_status} · {p.source}</dd></div>
      </dl>
      {dup && <p className="xs warnline">Shares OSM ID {dup.osm_id} with {dup.ids.filter((x) => x !== p.id).join(', ')}. Both records are kept as supplied.</p>}
    </section>
  );
}

function Walking({ available, index, id, byId }) {
  const naRows = (
    <dl className="kv dim">
      <div><dt>Nearest bus stop (network)</dt><dd>not calculated</dd></div>
      <div><dt>Nearest rail station (network)</dt><dd>not calculated</dd></div>
      <div><dt>Sample-journey alighting stop</dt><dd>no verified journey links this record</dd></div>
    </dl>
  );
  if (!available.available || (available.pilot && !available.scopeIds.has(id))) {
    return (
      <section className="card walk-na">
        <h3>Walking access to stops</h3>
        <p><b>Walking analysis not yet available</b>{available.pilot ? ' for this record.' : '.'}</p>
        <p className="xs">{available.pilot ? `Network routes exist only for the ${available.scopeIds.size} named records in the ${available.pilotInfo?.name} test area so far.` : available.reason} No straight-line substitute is shown.</p>
        {naRows}
      </section>
    );
  }
  const r = index.byAttraction.get(id) || {};
  const row = (t, label) => {
    const x = r[t];
    if (!x) return <div className="wrow"><dt>{label}</dt><dd>no result for this record</dd></div>;
    if (x.route_status !== 'ok') return <div className="wrow"><dt>{label}</dt><dd className="warnline">{x.route_status} · distance not available<small>{x.note}</small></dd></div>;
    const s = byId.get(x.stop_id)?.f.properties;
    return (
      <div className="wrow">
        <dt><i className={'wkey ' + t} />{label}</dt>
        <dd>
          <b lang="ja">{s?.name || s?.display_name || x.stop_id}</b> <span className="mono muted">{x.stop_id}</span>
          <span className="wdist"><b className="mono">{Math.round(x.distance_m).toLocaleString('en-US')} m</b> · ≈{x.duration_min} min at 80 m/min</span>
          <small>Access gaps (straight, not added): attraction {x.attraction_snap_gap_m} m, stop {x.stop_snap_gap_m} m</small>
          {x.note && <small className="warnline">{x.note}</small>}
        </dd>
      </div>
    );
  };
  return (
    <section className="card walk">
      <h3>Walking access to stops <span className="pill">pilot</span></h3>
      <dl className="kv">{row('bus', 'Nearest bus stop')}{row('rail', 'Nearest rail station')}</dl>
      <dl className="kv dim"><div><dt>Sample-journey alighting stop</dt><dd>no verified journey links this record</dd></div></dl>
      <p className="xs muted">Shortest path on OSM road segments joined at shared vertices. Walkability is assumed from road class (no foot/access tags). Points are not verified entrances.</p>
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

function Sources({ d, status, onClose }) {
  const m = d.manifest;
  const k = d.kdeMeta;
  return (
    <div className="sheet" role="dialog" aria-label="Data and sources">
      <header className="sheet-h">
        <div><h2>Data, sources and update times</h2><p>Record counts are preliminary mapped records, not official counts of unique operational attractions or stations.</p></div>
        <button className="x" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>
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
        <section>
          <h3>Data quality notes</h3>
          <ul className="xs">
            <li>{m?.attractions?.unnamed} of {m?.attractions?.records} attraction records have no name; {m?.transport?.unnamed} of {m?.transport?.records} stop records have no name.</li>
            {(m?.transport?.duplicate_osm_ids || []).map((x) => <li key={x.osm_id}>OSM ID {x.osm_id} appears twice ({x.ids.join(', ')}); both are kept.</li>)}
            <li>Categories are as tagged in OSM (for example 伏見稲荷大社 A00306 is tagged viewpoint). Worship places and polygon features were not included.</li>
            <li>Railway entrances or platforms are not merged into stations. Stops near the prefecture edge need review before network analysis.</li>
            <li>Japanese names are kept as supplied; no English names are invented.</li>
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
