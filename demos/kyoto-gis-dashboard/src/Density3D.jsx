import { useEffect, useRef, useState } from 'react';
import KotoString from './KotoString.jsx';
import { noteFor } from './lib/pluck.js';
import { ATTRACTION_CATS, recordLabel, muniLabel } from './lib/data.js';
import { themeOf } from './lib/theme.js';

// "3D density" on the dashboard map. Switched on next to Cinematic view, it raises the attraction
// kernel density (~250 m grid, scripts/kde_surface.py) out of the map as one surface: the denser a
// place, the higher and deeper in colour. No text while it rises. Afterwards the strongest peaks get a
// quiet label (their municipality), and a click anywhere on the surface draws a line out to a small
// glass card with what the data says about that spot. Three view presets turn the camera.
// Three.js and the surface data load only the first time it is switched on.
// Every number on the card is computed from the project's own data; distances are straight-line.

const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const VIEWS = [
  { k: 'oblique', label: 'Oblique', pitch: 58, bearing: -16 },
  { k: 'top', label: 'Top', pitch: 0, bearing: 0 },
  { k: 'low', label: 'Low', pitch: 60, bearing: 38 },
];
const fmt = (v) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const pct = (x) => (x > 0.99 ? (Math.floor(x * 1000) / 10).toFixed(1) : String(Math.floor(x * 100)));
const kmFmt = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(1)} km`);

// point in polygon (ray casting) for the municipality under a point
function inRing(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function muniAt(muni, lng, lat) {
  for (const f of muni?.features || []) {
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some((p) => inRing(p[0], lng, lat) && !p.slice(1).some((h) => inRing(h, lng, lat)))) return f.properties;
  }
  return null;
}

export default function Density3D({ mapRef, on, theme, d }) {
  const [phase, setPhase] = useState('off');          // off · loading · rising · ready · leaving · error
  const [view, setView] = useState('oblique');
  const [card, setCard] = useState(null);             // { lng, lat, h, info }
  const [labels, setLabels] = useState([]);
  const [spin, setSpin] = useState(false);
  const L = useRef(null), S = useRef(null), mod = useRef(null);
  const labelEls = useRef([]), anchorEl = useRef(null), lineEl = useRef(null), cardEl = useRef(null), wrapEl = useRef(null);
  const T = themeOf(theme);

  const fly = (k) => {
    const map = mapRef.current, v = VIEWS.find((x) => x.k === k);
    if (!map || !v) return;
    setView(k);
    const cam = map.cameraForBounds([[134.86, 34.7], [136.06, 35.79]], { padding: { top: 70, bottom: 50, left: 40, right: 40 } });
    map.easeTo({ center: k === 'low' ? [135.62, 35.06] : cam.center, zoom: k === 'low' ? cam.zoom + 0.7 : cam.zoom + (k === 'top' ? 0 : 0.15), pitch: v.pitch, bearing: v.bearing, duration: reduce() ? 0 : 1700, essential: true });
  };

  // switch on / off
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let alive = true, raf = 0;
    if (on) {
      setPhase('loading');
      (async () => {
        try {
          const m = mod.current || (mod.current = await import('./lib/density3d.js'));
          if (!S.current) {
            const r = await fetch(`${import.meta.env.BASE_URL}data/analysis/density_surface.json`);
            if (!r.ok) throw new Error(`density_surface.json ${r.status}`);
            S.current = m.decodeSurface(await r.json());
          }
          if (!alive) return;
          if (L.current && map.getLayer('density-3d')) map.removeLayer('density-3d');
          const layer = m.createDensityLayer(S.current, theme);
          L.current = layer;
          const before = ['attractions-pt', 'lm-minor', 'transport-pt'].find((id) => map.getLayer(id));
          map.addLayer(layer, before);
          fly('oblique');
          setPhase('rising');
          const t0 = performance.now(), dur = reduce() ? 0 : 2600;
          const step = (now) => {
            if (!alive) return;
            layer.grow = dur ? Math.min(1, (now - t0) / dur) : 1;
            map.triggerRepaint();
            if (layer.grow < 1) raf = requestAnimationFrame(step);
            else { setPhase('ready'); setLabels(m.peaks(S.current, 6).map((p) => ({ ...p, h: layer.heightOf(p.value), name: shortAt(p) }))); }
          };
          raf = requestAnimationFrame(step);
        } catch (e) { if (alive) { console.error(e); setPhase('error'); } }
      })();
    } else if (L.current) {
      // sink back down, then remove
      setCard(null); setLabels([]);
      setPhase('leaving');
      const layer = L.current, t0 = performance.now(), dur = reduce() ? 0 : 900, g0 = layer.grow;
      const step = (now) => {
        const k = dur ? Math.min(1, (now - t0) / dur) : 1;
        layer.grow = g0 * (1 - k); layer.fade = 1 - k * k;
        map.triggerRepaint();
        if (k < 1) raf = requestAnimationFrame(step);
        else { if (map.getLayer('density-3d')) map.removeLayer('density-3d'); L.current = null; setPhase('off'); map.easeTo({ pitch: 0, bearing: 0, duration: reduce() ? 0 : 900 }); }
      };
      raf = requestAnimationFrame(step);
    }
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  useEffect(() => { if (L.current?.mat) { L.current.setTheme(theme); mapRef.current?.triggerRepaint(); } }, [theme, mapRef]);

  // While the surface is up the camera can turn: right-drag or Ctrl-drag rotates it (two fingers on a phone),
  // the arrow keys with Shift too. The flat map keeps its fixed north-up view, so this is undone afterwards.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !(phase === 'rising' || phase === 'ready')) return undefined;
    map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.keyboard.enableRotation();
    // Hold the middle mouse button and drag to orbit: sideways turns the camera round, up and down tilts it.
    // On release it keeps turning a little and slows to a stop.
    const box = map.getCanvasContainer();
    let drag = null, coast = 0;
    const down = (e) => {
      if (e.button !== 1) return;
      e.preventDefault();   // no browser auto-scroll
      cancelAnimationFrame(coast); setSpin(false);
      drag = { x: e.clientX, y: e.clientY, b: map.getBearing(), p: map.getPitch(), lx: e.clientX, lt: e.timeStamp, v: 0 };
      box.classList.add('orbiting');
    };
    const move = (e) => {
      if (!drag) return;
      const dt = Math.max(8, e.timeStamp - drag.lt);
      drag.v = 0.8 * drag.v + 0.2 * ((e.clientX - drag.lx) * 0.35 / dt);   // degrees per ms
      drag.lx = e.clientX; drag.lt = e.timeStamp;
      map.jumpTo({ bearing: drag.b + (e.clientX - drag.x) * 0.35, pitch: Math.max(0, Math.min(map.getMaxPitch(), drag.p - (e.clientY - drag.y) * 0.25)) });
    };
    const up = (e) => {
      if (!drag || (e.button !== undefined && e.button !== 1)) return;
      let v = reduce() ? 0 : drag.v, last = 0;
      drag = null; box.classList.remove('orbiting');
      const glide = (now) => { const dt = last ? Math.min(40, now - last) : 16; last = now; v *= Math.pow(0.9, dt / 16.7); map.setBearing(map.getBearing() + v * dt); if (Math.abs(v) > 0.002) coast = requestAnimationFrame(glide); };
      if (Math.abs(v) > 0.005) coast = requestAnimationFrame(glide);
    };
    const aux = (e) => { if (e.button === 1) e.preventDefault(); };
    box.addEventListener('mousedown', down, true);
    box.addEventListener('auxclick', aux);
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
    return () => {
      map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation();
      box.removeEventListener('mousedown', down, true); box.removeEventListener('auxclick', aux);
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      cancelAnimationFrame(coast); box.classList.remove('orbiting');
    };
  }, [phase, mapRef]);
  // a slow orbit round the prefecture; any drag, wheel or touch stops it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !spin || phase !== 'ready' || reduce()) return undefined;
    let raf = 0, last = 0;
    const step = (now) => { const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; map.setBearing(map.getBearing() + dt * 9); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    const stop = (e) => { if (e.originalEvent) setSpin(false); };
    for (const ev of ['dragstart', 'wheel', 'touchstart', 'rotatestart', 'mousedown']) map.on(ev, stop);
    return () => { cancelAnimationFrame(raf); for (const ev of ['dragstart', 'wheel', 'touchstart', 'rotatestart', 'mousedown']) map.off(ev, stop); };
  }, [spin, phase, mapRef]);
  useEffect(() => { if (!on) setSpin(false); }, [on]);
  const turn = (deg) => { const map = mapRef.current; if (!map) return; setSpin(false); map.easeTo({ bearing: map.getBearing() + deg, duration: reduce() ? 0 : 900 }); };
  useEffect(() => () => { const map = mapRef.current; if (map?.getLayer('density-3d')) map.removeLayer('density-3d'); }, [mapRef]);

  const shortAt = (p) => { const pr = muniAt(d.municipalities, p.lng, p.lat); if (!pr) return ''; const code = String(pr.N03_007); const en = d.pointMuni?.names_en?.[code] || d.namesEn?.municipalities?.[code]?.en; return en ? en.split(',')[0].replace(/ (Ward|City|Town|Village)$/, '') : [pr.N03_004, pr.N03_005].filter(Boolean).join(' '); };
  const nameAt = (p) => { const pr = muniAt(d.municipalities, p.lng, p.lat); return pr ? muniLabel(d.pointMuni, pr.N03_007) || [pr.N03_004, pr.N03_005].filter(Boolean).join(' ') : ''; };

  // what the data says about one spot
  const describe = (lng, lat) => {
    const m = mod.current, Sx = S.current, here = { lng, lat };
    const value = m.valueAt(Sx, lng, lat);
    if (value == null) return null;
    const near = [];
    let total = 0;
    const byCat = {};
    for (const f of d.attractions?.features || []) {
      const [x, y] = f.geometry.coordinates, k = m.km(here, { lng: x, lat: y });
      if (k <= 1) { byCat[f.properties.category] = (byCat[f.properties.category] || 0) + 1; total++; if (f.properties.name || f.properties.name_en) near.push({ k, name: recordLabel(f.properties) }); }
    }
    near.sort((a, b) => a.k - b.k);
    let stops = 0, nearest = null;
    for (const f of d.transport?.features || []) {
      const [x, y] = f.geometry.coordinates, k = m.km(here, { lng: x, lat: y });
      if (k <= 1) stops++;
      if (!nearest || k < nearest.k) nearest = { k, name: recordLabel(f.properties), type: f.properties.type };
    }
    return {
      value, below: m.shareBelow(Sx, value), peak: Sx.peak,
      muni: nameAt(here), line: m.transect(Sx, lng, lat, 10),
      total, byCat, names: near.slice(0, 3), stops, nearest,
    };
  };

  // click on the surface (only once it has risen)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== 'ready') return undefined;
    const click = (e) => {
      const hit = L.current?.pick(e.point.x, e.point.y);
      if (!hit) { setCard(null); return; }
      const info = describe(hit.lng, hit.lat);
      setCard(info ? { ...hit, info, id: Date.now() } : null);
    };
    const key = (e) => { if (e.key === 'Escape') setCard(null); };
    map.on('click', click);
    addEventListener('keydown', key);
    map.getCanvas().style.cursor = 'crosshair';
    return () => { map.off('click', click); removeEventListener('keydown', key); map.getCanvas().style.cursor = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // keep labels, the anchor, the leader line and the card attached to the surface as the map moves
  useEffect(() => {
    const layer = L.current;
    if (!layer) return undefined;
    layer.onRender = () => {
      const placed = [];
      labels.forEach((p, i) => {
        const el = labelEls.current[i], s = layer.project(p.lng, p.lat, p.h);
        if (!el) return;
        if (!s || placed.some((q) => Math.abs(q.x - s.x) < 110 && Math.abs(q.y - s.y) < 34)) { el.style.visibility = 'hidden'; return; }
        placed.push(s);
        el.style.transform = `translate(${s.x}px, ${s.y}px)`; el.style.visibility = '';
      });
      if (card && anchorEl.current && cardEl.current && wrapEl.current) {
        const s = layer.project(card.lng, card.lat, card.h);
        if (!s) { wrapEl.current.style.opacity = 0; return; }
        wrapEl.current.style.opacity = '';
        const W = wrapEl.current.clientWidth, H = wrapEl.current.clientHeight, cw = cardEl.current.offsetWidth || 300, ch = cardEl.current.offsetHeight || 320;
        const right = s.x + 60 + cw < W - 12;                                    // open to the side with room
        // keep clear of the map-tool rail on the left edge and the view presets above it
        const ey = Math.max(76, Math.min(H - ch + 20, s.y - 70));
        const cx = Math.max(72, Math.min(W - cw - 12, right ? s.x + 56 : s.x - 56 - cw));
        const ex = right ? cx : cx + cw;
        anchorEl.current.style.transform = `translate(${s.x}px, ${s.y}px)`;
        lineEl.current.setAttribute('d', `M${s.x},${s.y} L${s.x + (right ? 26 : -26)},${ey} L${ex},${ey}`);
        cardEl.current.style.transform = `translate(${cx}px, ${ey - 20}px)`;
        cardEl.current.dataset.side = right ? 'r' : 'l';
      }
    };
    mapRef.current?.triggerRepaint();
    return () => { if (layer) layer.onRender = null; };
  }, [labels, card, mapRef, phase]);

  const shown = phase !== 'off';
  if (!shown && !on) return null;
  const i = card?.info;
  const catList = i ? ATTRACTION_CATS.filter((c) => i.byCat[c.key]) : [];
  return (
    <div className={'d3 ' + phase} ref={wrapEl} data-theme-variant={theme}>
      {phase === 'loading' && <div className="d3-status" role="status">Raising the density surface…</div>}
      {phase === 'error' && <div className="d3-status err" role="alert">The 3D density surface could not be loaded.</div>}
      {(phase === 'rising' || phase === 'ready') && (
        <>
          <div className="d3-views" role="group" aria-label="3D view">
            {VIEWS.map((v) => <button key={v.k} type="button" aria-pressed={view === v.k} className={view === v.k ? 'on' : ''} onClick={() => { setSpin(false); fly(v.k); }}>{v.label}</button>)}
            <i className="sep" aria-hidden="true" />
            <button type="button" className="ico" onClick={() => turn(-45)} aria-label="Turn left 45 degrees" title="Turn left">⟲</button>
            <button type="button" className="ico" onClick={() => turn(45)} aria-label="Turn right 45 degrees" title="Turn right">⟳</button>
            <button type="button" className={spin ? 'on' : ''} aria-pressed={spin} onClick={() => setSpin(!spin)} disabled={phase !== 'ready'} title="Orbit slowly round the prefecture">Orbit</button>
          </div>
          <div className="d3-key" aria-label="3D density legend">
            <b>Attraction density</b>
            <i style={{ background: `linear-gradient(90deg, ${(theme === 'light' ? ['#f4eff9', '#ddd1f4', '#a98ff0', '#d052b7', '#7c1863'] : ['#1a2229', '#1f5f6e', '#79d7da', '#fff0d4', '#ff8a5c']).join(', ')})` }} />
            <span>0</span><span>{S.current ? S.current.peak.toFixed(1) : ''} records / km²</span>
            <small>Height in proportion to density (1 record/km² ≈ {S.current ? Math.round(28000 / S.current.peak / 100) / 10 : ''} km drawn) · ~250 m grid · kernel density, not visitor numbers{phase === 'ready' ? ' · click the surface · hold the middle mouse button and drag to orbit (or right-drag)' : ''}</small>
          </div>
        </>
      )}
      {phase === 'ready' && labels.map((p, k) => (
        <div key={k} className="d3-lab" ref={(el) => (labelEls.current[k] = el)} style={{ '--k': k }}><span translate="no">{p.name || '—'}</span><small>{fmt(p.value)}</small></div>
      ))}
      {card && i && (
        <div className="d3-card-wrap" key={card.id}>
          <svg className="d3-line" aria-hidden="true"><path ref={lineEl} d="" /></svg>
          <i className="d3-anchor" ref={anchorEl} aria-hidden="true" />
          <section className="d3-card" ref={cardEl} role="dialog" aria-label="About this spot">
            <header>
              <p>DENSITY · THIS SPOT</p>
              <button type="button" className="x" onClick={() => setCard(null)} aria-label="Close">×</button>
            </header>
            <div className="d3-big">
              <Gauge share={i.below} />
              <div><b className="d3-num"><Count to={i.value} delay={1350} dur={1500} /></b><span>records / km²</span><small>denser than {pct(i.below)}% of the prefecture</small></div>
            </div>
            {i.muni && <p className="d3-where">{i.muni}</p>}
            <figure className="d3-cut">
              <figcaption><span>W</span>Cross-section, 5 km east–west <em className="pluck-hint">· pluck it</em><span>E</span></figcaption>
              <KotoString values={i.line} freq={noteFor(i.below)} label="Cross-section of the density, 5 km east to west. Press and drag to pluck it like a koto string; denser spots sound higher." />
            </figure>
            <div className="d3-cats">
              <p><b>{i.total}</b> attraction record{i.total === 1 ? '' : 's'} within 1 km</p>
              {i.total > 0 && <div className="bar">{catList.map((c, k) => <i key={c.key} style={{ flexGrow: i.byCat[c.key], background: T.cat[c.key], '--k': k }} title={`${c.label}: ${i.byCat[c.key]}`} />)}</div>}
              {i.total > 0 && <ul>{catList.map((c) => <li key={c.key}><i style={{ background: T.cat[c.key] }} />{c.label} {i.byCat[c.key]}</li>)}</ul>}
              {i.names.length > 0 && <ol>{i.names.map((x, k) => <li key={k} style={{ '--k': k }}>{x.name}<span>{kmFmt(x.k)}</span></li>)}</ol>}
            </div>
            <p className="d3-stops"><b>{i.stops}</b> transit stop{i.stops === 1 ? '' : 's'} within 1 km{i.nearest ? <> · nearest {i.nearest.name}, {kmFmt(i.nearest.k)}</> : null}</p>
            <footer>Kernel density of attraction records (2 km radius). Not visitor numbers. Distances are straight-line.</footer>
          </section>
        </div>
      )}
    </div>
  );
}

// number that counts up to its value once, after the card has unfolded
function Count({ to, delay = 0, dur = 900, format = fmt }) {
  const [v, setV] = useState(reduce() ? to : 0);
  useEffect(() => {
    if (reduce()) { setV(to); return undefined; }
    let raf, t0;
    const step = (now) => { t0 ??= now + delay; const k = Math.max(0, Math.min(1, (now - t0) / dur)); setV(to * (1 - Math.pow(1 - k, 4))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, dur]);
  return format(v);
}
// ring that sweeps to the spot's share of the prefecture
function Gauge({ share }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <svg className="d3-gauge" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} className="bg" />
      <circle cx="28" cy="28" r={r} className="fg" style={{ '--len': c, '--to': c * (1 - share) }} />
      <circle cx="28" cy="28" r={r} className="ping" />
      <text x="28" y="31"><Count to={share * 100} delay={1350} dur={1600} format={(x) => Math.floor(x)} /></text>
    </svg>
  );
}
