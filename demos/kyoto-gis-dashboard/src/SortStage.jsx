import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildPlan, goldenSphere, project, rng, shuffle, flightMs, flightEase, arcMid, along, easeInOut, DURATION, PHASES, FLIGHT } from './lib/sortMotion.js';
import { createOdometer } from './lib/odometer.js';
import './sort.css';

// "Sort the data": the back of the dashboard. Every record that went into the attraction layer floats as
// one sphere (644 = 523 OpenStreetMap records + 121 Kyoto City sites). A double-click on the sphere starts
// the sort: the category slots spring out of it, the 5 duplicates fly into the record they repeat and on to
// "Merged", the 13 records that are not places to visit go to "Left out", and the 626 records on the map
// fly into their 6 categories. It ends with a vermilion 済 seal and falling petals.
// Data: public/data/sort_story.json (scripts/sort_story.py). Motion credit: see lib/sortMotion.js.
const SEAL = { attraction: '名', viewpoint: '景', museum: '館', castle: '城', temple: '寺', shrine: '社' };
const LABEL = { viewpoint: 'Viewpoint', attraction: 'Attraction', museum: 'Museum', temple: 'Temple', shrine: 'Shrine', castle: 'Castle' };
const COLS = [['viewpoint', 'attraction', 'museum'], ['temple', 'shrine', 'castle']];
const SLOTS = 30;   // per category card while sorting (10 x 3); afterwards every record, scrollable
const BASE = import.meta.env.BASE_URL;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAPTIONS = {
  idle: 'Every record that went into the map, before sorting',
  merge: 'Duplicates join the record they repeat',
  leftOut: 'Setting aside what is not a place to visit',
  sort: 'Each place flies to its category',
};

export function makeSortBus() {
  return { subs: new Set(), last: null, emit(c) { this.last = c; this.subs.forEach((f) => f(c)); } };
}
const ZERO = { checked: 0, merged: 0, leftOut: 0, sorted: 0, withPhoto: 0, cats: 0 };

// Header counters while the back is showing: each digit rolls as the records land.
export function SortCounters({ bus, story }) {
  const refs = useRef({});
  const c = story.counts;
  const items = [['checked', 'records checked', c.start], ['merged', 'merged', null], ['leftOut', 'left out', null], ['sorted', 'sorted onto the map', c.on_map], ['withPhoto', 'with a photo', null], ['cats', 'categories', 6]];
  useEffect(() => {
    const max = { checked: c.start, merged: c.merged, leftOut: c.left_out, sorted: c.on_map, withPhoto: c.with_photo, cats: 6 };
    const odos = {};
    for (const [k] of items) odos[k] = createOdometer(refs.current[k], String(max[k]).length);
    const v0 = bus.last || ZERO;
    for (const k in odos) odos[k].set(v0[k] || 0, true);
    const on = (v) => { for (const k in odos) odos[k].set(v[k] || 0); };
    bus.subs.add(on);
    return () => { bus.subs.delete(on); Object.values(odos).forEach((o) => o.destroy()); };
  }, [bus, story]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="counts sort-counts" role="group" aria-label="Sorting progress">
      {items.map(([k, label, total]) => (
        <div className="count sc-count" key={k} data-k={k}>
          <span className="v"><span ref={(el) => (refs.current[k] = el)} />{total != null && <small> / {total}</small>}</span>
          <span className="k">{label}</span>
        </div>
      ))}
    </div>
  );
}

// Background for a slot: the record's photo cell in the atlas, or its category seal when it has no photo.
function slotLook(row, A) {
  const cell = row[2];
  if (cell < 0) return { np: true, text: SEAL[row[1]] || '名', style: {} };
  const rows = Math.ceil(A.count / A.cols);
  return {
    np: false, text: '',
    style: {
      backgroundImage: `url(${BASE}${A.file})`,
      backgroundSize: `${A.cols * 100}% ${rows * 100}%`,
      backgroundPosition: `${((cell % A.cols) / (A.cols - 1)) * 100}% ${rows > 1 ? (Math.floor(cell / A.cols) / (rows - 1)) * 100 : 0}%`,
    },
  };
}
function paintSlot(el, row, A, name) {
  const look = slotLook(row, A);
  el.classList.toggle('np', look.np);
  el.textContent = look.text;
  el.style.backgroundImage = look.style.backgroundImage || '';
  el.style.backgroundSize = look.style.backgroundSize || '';
  el.style.backgroundPosition = look.style.backgroundPosition || '';
  el.style.setProperty('--c', `var(--cat-${row[1]})`);
  el.dataset.id = row[0];
  el.disabled = false;
  el.tabIndex = 0;
  el.setAttribute('aria-label', name);
  // a short pop on landing (transform only, no forced layout, so landings never stall the frame)
  el.animate([{ transform: 'scale(1.35)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

function Slot({ row, A, name, onOpen }) {
  const look = slotLook(row, A);
  return (
    <button type="button" className={'slot' + (look.np ? ' np' : '')} data-id={row[0]} style={{ ...look.style, '--c': `var(--cat-${row[1]})` }} aria-label={name} onClick={() => onOpen(row[0])}>{look.text}</button>
  );
}

function SortCard({ info, onClose, onShow }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [info.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={'sort-card' + (info.photo ? ' with-photo' : '')} role="dialog" aria-label={`About ${info.name}`} tabIndex={-1} ref={ref} style={{ '--c': `var(--cat-${info.cat})` }}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      {info.photo && (
        <figure>
          <img src={info.photo.src} alt={info.photo.alt} />
          <figcaption>Photo: {info.photo.artist} · {info.photo.license}</figcaption>
        </figure>
      )}
      <div className="sc-body">
        <p className="sc-kind"><i className="seal" lang="ja">{SEAL[info.cat] || '名'}</i>{LABEL[info.cat] || info.cat}{info.status !== 'map' && <span className={'sc-status ' + info.status}>{info.status === 'merged' ? 'Merged' : 'Left out'}</span>}</p>
        <h3 lang="ja">{info.name}</h3>
        <dl>
          {info.area && <div><dt>Area</dt><dd lang="ja">{info.area}</dd></div>}
          {info.walk?.map((w) => <div key={w.k}><dt>{w.k === 'bus' ? 'Nearest bus stop' : 'Nearest station'}</dt><dd lang="ja">{w.text}</dd></div>)}
          {info.merged && <div><dt>Merged into</dt><dd lang="ja">{info.merged.intoName} <small>({info.merged.into})</small></dd></div>}
          {info.leftOut && <div><dt>Left out as</dt><dd>{info.leftOut.kind}</dd></div>}
          <div><dt>Source</dt><dd>{info.source}</dd></div>
        </dl>
        {(info.merged || info.leftOut) && <p className="sc-why">{(info.merged || info.leftOut).evidence}</p>}
        {info.status === 'left_out' && <p className="sc-why">Kept in the raw data (data/raw), not drawn on the map.</p>}
        <div className="sc-btns">
          {info.mapId && <button type="button" className="btn sm" onClick={() => onShow(info.mapId)}>{info.status === 'merged' ? 'Show the kept record on the map' : 'Show on map'}</button>}
          <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </section>
  );
}

export default function SortStage({ story, colors, theme, shown, bus, describe, nameOf, onShowOnMap, onBack, speed = 1 }) {
  const duration = DURATION / Math.max(0.05, speed);
  const inRef = useRef(null), cvRef = useRef(null), midRef = useRef(null), capRef = useRef(null);
  const cards = useRef({});
  const [phase, setPhase] = useState('idle');   // idle | run | done
  const [lists, setLists] = useState(null);     // after the sort: every record in each slot, to browse
  const [celebrate, setCelebrate] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [open, setOpen] = useState(null);
  const rowById = useMemo(() => new Map(story.rows.map((r) => [r[0], r])), [story]);
  const A = story.atlas;
  const live = useRef({});
  live.current = { colors, shown, nameOf, setPhase, setLists, setCelebrate };
  const E = useRef(null);

  // ---------- engine: created once per data set ----------
  useEffect(() => {
    const cv = cvRef.current, ctx = cv.getContext('2d');
    const atlas = new Image();
    atlas.src = `${BASE}${A.file}`;
    const pts = goldenSphere(story.rows.length);
    const e = {
      tiles: [], byId: new Map(), fliers: [], rings: [], petals: [],
      yaw: 0, tilt: 0, spin: 0, pointer: null, drag: null, tap: null,
      geo: null, geoFrom: null, geoT0: 0, mode: 'idle',
      run: null, counts: { ...ZERO }, sent: '', sprites: {}, w: 0, h: 0, dpr: 1, last: 0, raf: 0, on: false, pausedAt: 0,
    };
    E.current = e;

    e.buildTiles = (seed) => {
      const rows = shuffle(story.rows.slice(), rng(seed));
      e.tiles = rows.map((r, i) => ({ id: r[0], row: r, p: pts[i], alive: true, sx: 0, sy: 0, s: 1, a: 1, depth: 0, lens: 0, pulse: 0, fade: 0 }));
      e.byId = new Map(e.tiles.map((t) => [t.id, t]));
    };
    e.buildTiles(7);

    e.sprite = (cat) => {
      const col = live.current.colors?.[cat] || '#888';
      const key = cat + col;
      if (e.sprites[key]) return e.sprites[key];
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = col;
      g.beginPath(); g.roundRect(2, 2, 60, 60, 12); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.roundRect(2, 2, 60, 30, [12, 12, 0, 0]); g.fill();
      g.fillStyle = '#fff'; g.font = '600 34px "Shippori Mincho", "Yu Mincho", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(SEAL[cat] || '名', 32, 35);
      return (e.sprites[key] = c);
    };

    e.measure = () => {
      const el = inRef.current, mid = midRef.current;
      if (!el || !mid) return;
      // offsets, not client rects: the stage may be mid-turn (3D transform) when it is measured
      const m = { left: mid.offsetLeft, top: mid.offsetTop, width: mid.offsetWidth, height: mid.offsetHeight }, r = { left: 0, top: 0 };
      if (!m.width || !el.offsetWidth) return;
      e.w = el.scrollWidth; e.h = el.scrollHeight;
      e.dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(e.w * e.dpr); cv.height = Math.round(e.h * e.dpr);
      cv.style.width = e.w + 'px'; cv.style.height = e.h + 'px';
      const cx = m.left - r.left + m.width / 2, cy = m.top - r.top + m.height * 0.47;
      e.geoIdle = { cx, cy, R: Math.max(70, Math.min(e.w * 0.25, m.height * 0.4, m.width * 0.62)) };
      e.geoRun = { cx, cy: m.top - r.top + m.height * 0.45, R: Math.max(60, Math.min(m.width * 0.42, m.height * 0.33)) };
      if (!e.geoFrom) e.geo = e.mode === 'idle' ? e.geoIdle : e.geoRun;
    };
    e.rel = (el) => {
      const r = el.getBoundingClientRect(), o = inRef.current.getBoundingClientRect();
      return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2, size: r.width };
    };
    // Every slot's position is measured once, in one layout pass, when the first record flies (the slots have
    // finished springing out by then), and again only after a resize. Measuring per flight forced a layout of the
    // whole page for each record, which stalled frames and made records pour out in clumps.
    e.slotPos = null;
    e.measureSlots = () => {
      const pos = new Map();
      for (const card of Object.values(cards.current)) if (card) for (const sl of card.querySelectorAll('.sc-grid .slot')) pos.set(sl, e.rel(sl));
      e.slotPos = pos;
    };

    e.emit = () => {
      const s = JSON.stringify(e.counts);
      if (s !== e.sent) { e.sent = s; bus.emit({ ...e.counts }); }
    };
    e.caption = (k) => { if (capRef.current && capRef.current.dataset.k !== k) { capRef.current.dataset.k = k; capRef.current.textContent = CAPTIONS[k] || ''; } };

    // ---------- the sort ----------
    e.start = (seed = 11) => {
      const now = performance.now();
      e.mode = 'run';
      e.geoFrom = { ...e.geo }; e.geoT0 = now;
      e.rings.push({ x: e.geo.cx, y: e.geo.cy, r0: e.geo.R * 0.9, grow: e.geo.R * 0.7, t0: now, dur: 900 });
      const rand = rng(seed);
      e.run = { t0: now, plan: buildPlan(story.rows, duration, rand), idx: 0, rand, queued: {}, landed: {}, catSet: new Set(), done: false };
      e.counts = { ...ZERO };
      e.emit();
      e.caption('idle');
      e.wake();
    };
    e.slotOf = (target) => {
      const card = cards.current[target];
      if (!card) return null;
      const slots = card.querySelectorAll('.sc-grid .slot');
      const q = e.run.queued[target] = (e.run.queued[target] || 0) + 1;
      return slots.length ? slots[(q - 1) % slots.length] : null;
    };
    e.launch = (ev, now) => {
      const t = e.byId.get(ev.id);
      if (!t || !t.alive) return;
      t.alive = false;
      e.counts.checked++;
      const from = { x: t.sx, y: t.sy }, s0 = t.size || 24;
      if (ev.kind === 'merge') {
        const kept = e.byId.get(story.merged[ev.id].into);
        e.fliers.push({ t, kind: 'merge-a', from, kept, t0: now, dur: 520 * Math.min(1, duration / DURATION * 1.2), s0 });
        return;
      }
      e.fly(t, from, s0, ev.kind === 'leftOut' ? 'left_out' : t.row[1], now);
    };
    e.fly = (t, from, s0, target, now) => {
      const slot = e.slotOf(target);
      if (!slot) return;
      if (!e.slotPos || !e.slotPos.has(slot)) e.measureSlots();
      const to = e.slotPos.get(slot);
      e.fliers.push({ t, kind: 'arc', target, slot, from, to, mid: arcMid(from, to, e.run.rand), t0: now, dur: flightMs(e.run.rand, duration), s0 });
    };
    e.land = (f) => {
      const row = f.t.row, r = e.run;
      paintSlot(f.slot, row, A, live.current.nameOf(row[0]));
      (r.landed[f.target] = r.landed[f.target] || []).push(row[0]);
      const card = cards.current[f.target];
      if (card) {
        // the card's rim lights up for a moment: an opacity animation of its own layer (runs off the main thread)
        const ring = card._ring || (card._ring = card.querySelector('.hit-ring'));
        ring?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
        card._odo?.set(r.landed[f.target].length);
      }
      if (f.target === 'merged') e.counts.merged = r.landed.merged.length;
      else if (f.target === 'left_out') e.counts.leftOut = r.landed.left_out.length;
      else {
        e.counts.sorted++;
        if (row[2] >= 0) e.counts.withPhoto++;
        r.catSet.add(f.target);
        e.counts.cats = r.catSet.size;
      }
    };
    e.finish = (now) => {
      const r = e.run;
      r.done = true;
      e.run = null;
      e.mode = 'done';
      e.caption('');
      const lists = {};
      for (const k of [...COLS.flat(), 'merged', 'left_out']) lists[k] = (r.landed[k] || []).slice();
      for (const k of COLS.flat()) lists[k].sort((a, b) => (rowById.get(b)[2] >= 0) - (rowById.get(a)[2] >= 0));
      live.current.setPhase('done');
      live.current.setCelebrate(true);
      // the full, scrollable lists replace the slots once the petals have fallen, so building 626 tiles
      // never interrupts the finish; until then the slots on screen can already be clicked
      clearTimeout(e.listT);
      e.listT = setTimeout(() => live.current.setLists(lists), 3900);
      // petals burst from the seal, then drift down
      const g = e.geoRun, pr = rng(5);
      for (let i = 0; i < 120; i++) {
        const a = -Math.PI / 2 + (pr() - 0.5) * Math.PI * 1.7, v = 0.18 + pr() * 0.55;
        e.petals.push({ x: g.cx + (pr() - 0.5) * 30, y: g.cy - 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.1, rot: pr() * 6.3, vr: (pr() - 0.5) * 0.008, flip: pr() * 6.3, vf: 0.004 + pr() * 0.006, sway: pr() * 6.3, size: 7 + pr() * 7, hue: pr(), t0: now + 260, life: 3600 + pr() * 1400 });
      }
      e.rings.push({ x: g.cx, y: g.cy - 10, r0: 30, grow: g.R * 1.1, t0: now + 240, dur: 900 });
    };
    e.fillStatic = () => {
      const r = { landed: {} };
      for (const row of story.rows) {
        const k = row[3] === 'merged' ? 'merged' : row[3] === 'left_out' ? 'left_out' : row[1];
        (r.landed[k] = r.landed[k] || []).push(row[0]);
      }
      e.tiles.forEach((t) => (t.alive = false));
      const c = story.counts;
      e.counts = { checked: c.start, merged: c.merged, leftOut: c.left_out, sorted: c.on_map, withPhoto: c.with_photo, cats: 6 };
      e.emit();
      for (const k of Object.keys(r.landed)) cards.current[k]?._odo?.set(r.landed[k].length, true);
      e.mode = 'done';
      e.caption('');
      const lists = {};
      for (const k of [...COLS.flat(), 'merged', 'left_out']) lists[k] = (r.landed[k] || []).slice();
      for (const k of COLS.flat()) lists[k].sort((a, b) => (rowById.get(b)[2] >= 0) - (rowById.get(a)[2] >= 0));
      live.current.setLists(lists);
      live.current.setPhase('done');
      live.current.setCelebrate(false);
      e.draw(performance.now());
    };
    e.reset = () => {
      clearTimeout(e.listT);
      e.slotPos = null;
      e.fliers = []; e.petals = []; e.rings = []; e.run = null; e.mode = 'idle';
      e.buildTiles(7 + Math.floor(Math.random() * 1000));
      e.tiles.forEach((t) => (t.fade = 0));
      e.counts = { ...ZERO }; e.sent = ''; e.emit();
      for (const k in cards.current) cards.current[k]?._odo?.set(0, true);
      e.caption('idle');
    };

    // ---------- frame ----------
    e.draw = (now) => {
      const { w, h, dpr } = e;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!e.geo) return;
      const { cx, cy, R } = e.geo, base = R * 0.095;
      const P = e.pointer;
      const order = [];
      for (const t of e.tiles) {
        if (!t.alive) continue;
        const q = project(t.p, e.yaw, e.tilt);
        let x = cx + q.x * R, y = cy + q.y * R, s = base * q.scale;
        let lensT = 0;
        if (P && !e.drag && q.depth > 0.45) { const d = Math.hypot(x - P.x, y - P.y); lensT = Math.max(0, 1 - d / 95) ** 2; }
        t.lens += (lensT - t.lens) * 0.22;
        if (t.lens > 0.01 && P) { const dx = x - P.x, dy = y - P.y, d = Math.hypot(dx, dy) || 1; x += (dx / d) * 16 * t.lens; y += (dy / d) * 16 * t.lens; s *= 1 + 0.85 * t.lens; }
        if (t.pulse > 0) { s *= 1 + 0.6 * t.pulse; t.pulse = Math.max(0, t.pulse - 0.025); }
        t.fade = Math.min(1, t.fade + 0.03);
        t.sx = x; t.sy = y; t.size = s; t.depth = q.depth + t.lens; t.a = Math.min(1, q.alpha + t.lens) * t.fade;
        order.push(t);
      }
      order.sort((a, b) => a.depth - b.depth);
      for (const t of order) { ctx.globalAlpha = t.a; e.tile(t.row, t.sx, t.sy, t.size, 0); }
      // fliers
      for (const f of e.fliers) {
        ctx.globalAlpha = 1;
        e.tile(f.t.row, f.x, f.y, f.size, f.rot || 0);
      }
      // rings
      for (let i = e.rings.length - 1; i >= 0; i--) {
        const g = e.rings[i], k = (now - g.t0) / g.dur;
        if (k < 0) continue;
        if (k >= 1) { e.rings.splice(i, 1); continue; }
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.strokeStyle = g.color || e.ink; ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r0 + g.grow * easeInOut(k), 0, Math.PI * 2); ctx.stroke();
      }
      // petals
      for (let i = e.petals.length - 1; i >= 0; i--) {
        const p = e.petals[i], age = now - p.t0;
        if (age < 0) continue;
        if (age > p.life) { e.petals.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, (p.life - age) / 900);
        e.petal(p);
      }
      ctx.globalAlpha = 1;
    };
    e.tile = (row, x, y, s, rot) => {
      const cell = row[2];
      ctx.save();
      ctx.translate(x, y);
      if (rot) ctx.rotate(rot);
      if (cell >= 0 && atlas.complete && atlas.naturalWidth) ctx.drawImage(atlas, (cell % A.cols) * A.cell, Math.floor(cell / A.cols) * A.cell, A.cell, A.cell, -s / 2, -s / 2, s, s);
      else ctx.drawImage(e.sprite(row[1]), -s / 2, -s / 2, s, s);
      ctx.restore();
    };
    e.petal = (p) => {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.flip)) * 0.8 + 0.2);
      const s = p.size;
      const grd = ctx.createLinearGradient(0, -s, 0, s);
      grd.addColorStop(0, p.hue < 0.5 ? '#ffd3e0' : '#ffe4ec'); grd.addColorStop(1, p.hue < 0.5 ? '#f49ab8' : '#f7b3c8');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(s * 0.9, s * 0.35, s * 0.75, -s * 0.75, s * 0.18, -s * 0.95);
      ctx.lineTo(0, -s * 0.62);   // the notch at the tip of a cherry petal
      ctx.lineTo(-s * 0.18, -s * 0.95);
      ctx.bezierCurveTo(-s * 0.75, -s * 0.75, -s * 0.9, s * 0.35, 0, s);
      ctx.fill();
      ctx.restore();
    };

    e.step = (now) => {
      const raw = now - (e.last || now), dt = Math.min(50, raw);
      e.last = now;
      // sphere geometry: idle -> sorting layout
      if (e.geoFrom) {
        const k = easeInOut(Math.min(1, (now - e.geoT0) / 900)), a = e.geoFrom, b = e.geoRun;
        e.geo = { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, R: a.R + (b.R - a.R) * k };
        if (k >= 1) e.geoFrom = null;
      } else e.geo = e.mode === 'idle' ? e.geoIdle : e.geoRun;
      // turn: steady spin, steered by the pointer, flung by a drag (with momentum)
      const P = e.pointer, g = e.geo;
      let steer = 0, tiltT = Math.sin(now / 4000) * 0.35;
      if (P && !e.drag && g) {
        const nx = Math.max(-1.4, Math.min(1.4, (P.x - g.cx) / g.R)), ny = Math.max(-1.4, Math.min(1.4, (P.y - g.cy) / g.R));
        steer = nx * 0.0011; tiltT = ny * 0.55;
      }
      e.spin *= Math.pow(0.94, dt / 16.7);
      e.yaw += dt * (0.00035 + steer) + e.spin * dt;
      e.tilt += (tiltT - e.tilt) * Math.min(1, 0.05 * dt / 16.7);
      // timeline
      const r = e.run;
      if (r) {
        const t = now - r.t0;
        const ev = r.plan.events;
        // at most four launches per 1/60 s of frame time (up to 24): a single late frame no longer releases a
      // clump, while a steadily slow machine still keeps to the 15 s timeline
      const cap = Math.min(24, Math.max(4, Math.ceil((4 * raw) / 16.7)));
      let n = 0;
      while (r.idx < ev.length && ev[r.idx].t <= t && n < cap) { e.launch(ev[r.idx++], now); n++; }
        e.caption(t < PHASES.merge * duration ? 'idle' : t < PHASES.leftOut * duration ? 'merge' : t < PHASES.sort * duration ? 'leftOut' : 'sort');
      }
      // fliers
      for (let i = e.fliers.length - 1; i >= 0; i--) {
        const f = e.fliers[i], k = Math.min(1, (now - f.t0) / f.dur);
        if (f.kind === 'merge-a') {
          const u = easeInOut(k), kept = f.kept;
          f.x = f.from.x + (kept.sx - f.from.x) * u; f.y = f.from.y + (kept.sy - f.from.y) * u;
          f.size = f.s0 * (1 - 0.35 * u); f.rot = 0;
          if (k >= 1) {
            e.fliers.splice(i, 1);
            kept.pulse = 1;
            e.rings.push({ x: kept.sx, y: kept.sy, r0: 4, grow: 34, t0: now, dur: 520, color: e.accent });
            e.fly(f.t, { x: kept.sx, y: kept.sy }, f.size, 'merged', now);
          }
          continue;
        }
        const u = flightEase(k), pos = along(f.from, f.mid, f.to, u);
        f.x = pos.x; f.y = pos.y; f.rot = pos.rot;
        f.size = u < FLIGHT.peak ? f.s0 * (1 + 0.2 * (u / FLIGHT.peak)) : f.s0 * 1.2 + (f.to.size - f.s0 * 1.2) * ((u - FLIGHT.peak) / (1 - FLIGHT.peak));
        if (k >= 1) { e.fliers.splice(i, 1); e.land(f); }
      }
      // petals
      for (const p of e.petals) {
        if (now < p.t0) continue;
        p.vy += 0.00045 * dt; p.vx *= Math.pow(0.992, dt / 16.7); p.vy = Math.min(p.vy, 0.09);
        p.x += (p.vx + Math.sin(now / 520 + p.sway) * 0.03) * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt; p.flip += p.vf * dt;
      }
      if (r && !r.done && r.idx >= r.plan.events.length && !e.fliers.length) e.finish(now);
      e.emit();
      e.draw(now);
    };
    e.loop = (now) => {
      e.raf = 0;
      if (!e.on) return;
      e.step(now);
      // after the finish, once the petals have fallen there is nothing left to draw: rest until a replay
      if (e.mode === 'done' && !e.petals.length && !e.rings.length && !e.fliers.length) { e.on = false; e.pausedAt = 0; return; }
      e.raf = requestAnimationFrame(e.loop);
    };
    e.wake = () => {
      const want = !!live.current.shown && e.visible !== false && !document.hidden;
      if (want && !e.on) {
        e.on = true;
        const now = performance.now();
        if (e.pausedAt) {   // a pause shifts the timeline, so nothing jumps on return
          const d = now - e.pausedAt;
          if (e.run) e.run.t0 += d;
          for (const f of e.fliers) f.t0 += d;
          for (const p of e.petals) p.t0 += d;
          e.pausedAt = 0;
        }
        e.last = 0;
        if (reduced()) { e.on = false; e.measure(); e.geo = e.mode === 'idle' ? e.geoIdle : e.geoRun; e.draw(now); return; }
        e.raf = requestAnimationFrame(e.loop);
      } else if (!want && e.on) {
        e.on = false; e.pausedAt = performance.now();
        cancelAnimationFrame(e.raf); e.raf = 0;
      }
    };
    const css = getComputedStyle(inRef.current);
    e.ink = css.getPropertyValue('--sort-ink').trim() || '#79d7da';
    e.accent = css.getPropertyValue('--vermilion').trim() || '#ff7a45';

    e.measure();
    const ro = new ResizeObserver(() => { e.measure(); e.slotPos = null; if (!e.on) e.draw(performance.now()); });
    ro.observe(inRef.current);
    const io = new IntersectionObserver(([en]) => { e.visible = en.isIntersecting; e.wake(); });
    io.observe(inRef.current);
    const vis = () => e.wake();
    document.addEventListener('visibilitychange', vis);
    atlas.onload = () => { if (!e.on) e.draw(performance.now()); };
    if (typeof window !== 'undefined') window.__kyotoSort = e;   // read by the browser tests
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); e.on = false; cancelAnimationFrame(e.raf); };
  }, [story]); // eslint-disable-line react-hooks/exhaustive-deps

  // run / pause with the face of the dashboard
  useEffect(() => { E.current?.wake(); if (shown) E.current?.measure(); }, [shown]);
  // colours follow the theme
  useEffect(() => {
    const e = E.current;
    if (!e) return;
    e.sprites = {};
    const css = getComputedStyle(inRef.current);
    e.ink = css.getPropertyValue('--sort-ink').trim() || e.ink;
    e.accent = css.getPropertyValue('--vermilion').trim() || e.accent;
    if (!e.on) e.draw(performance.now());
  }, [theme, colors]);

  // card counters (rolling digits)
  useEffect(() => {
    const made = [];
    for (const [k, el] of Object.entries(cards.current)) {
      if (!el) continue;
      const n = el.querySelector('.sc-n');
      const max = k === 'merged' ? story.counts.merged : k === 'left_out' ? story.counts.left_out : story.counts.by_category[k];
      el._odo = createOdometer(n, String(max).length);
      made.push(el._odo);
    }
    return () => made.forEach((o) => o.destroy());
  }, [story]);

  // slots spring out of the sphere (before the first paint of the run layout), then the timeline starts
  const pop = useRef(false);
  const begin = () => {
    const e = E.current;
    if (!e || phase !== 'idle') return;
    setOpen(null);
    if (reduced()) { e.fillStatic(); return; }
    pop.current = true;
    setPhase('run');
  };
  useLayoutEffect(() => {
    const e = E.current;
    if (!pop.current || phase !== 'run' || !e) return;
    pop.current = false;
    e.measure();
    const g = e.geo, o = inRef.current.getBoundingClientRect();
    const order = [];
    COLS[0].forEach((k, i) => { order.push(k); if (COLS[1][i]) order.push(COLS[1][i]); });
    order.push('merged', 'left_out');
    order.forEach((k, i) => {
      const el = cards.current[k];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = g.cx - (r.left - o.left + r.width / 2), dy = g.cy - (r.top - o.top + r.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(${dx > 0 ? -10 : 10}deg)`, opacity: 0, filter: 'blur(8px)' },
        { opacity: 1, filter: 'blur(0)', offset: 0.55 },
        { transform: 'none', opacity: 1, filter: 'blur(0)' },
      ], { duration: 760, delay: i * 85, easing: 'cubic-bezier(.34, 1.45, .55, 1)', fill: 'backwards' });
    });
    e.start(11 + runKey);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const replay = () => {
    const e = E.current;
    if (!e) return;
    setOpen(null); setLists(null); setCelebrate(false);
    setRunKey((k) => k + 1);
    e.reset();
    setPhase('idle');
  };
  // after a replay resets the slots, start again on the next frame
  const pendingReplay = useRef(false);
  useEffect(() => { if (pendingReplay.current && phase === 'idle') { pendingReplay.current = false; begin(); } }); // eslint-disable-line react-hooks/exhaustive-deps

  // pointer: steer, magnify, drag to spin, double-click (or double-tap) the sphere to start
  const local = (ev) => { const o = inRef.current.getBoundingClientRect(); return { x: ev.clientX - o.left, y: ev.clientY - o.top }; };
  const onMove = (ev) => {
    const e = E.current; if (!e) return;
    const p = local(ev);
    if (e.drag) { const dx = p.x - e.drag.x; e.yaw += dx * 0.006; e.spin = dx * 0.006 / Math.max(8, ev.timeStamp - e.drag.t); e.drag = { x: p.x, y: p.y, t: ev.timeStamp, moved: e.drag.moved + Math.abs(dx) }; }
    e.pointer = ev.pointerType === 'touch' && !e.drag ? null : p;
  };
  const onDown = (ev) => {
    const e = E.current; if (!e || !e.geo) return;
    const p = local(ev);
    if (Math.hypot(p.x - e.geo.cx, p.y - e.geo.cy) > e.geo.R * 1.15 || e.mode === 'done') return;
    e.drag = { x: p.x, y: p.y, t: ev.timeStamp, moved: 0, x0: p.x, y0: p.y };
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  };
  const onUp = (ev) => {
    const e = E.current; if (!e) return;
    const d = e.drag;
    e.drag = null;
    if (!d || d.moved > 8 || phase !== 'idle') return;
    const p = local(ev);
    if (e.tap && ev.timeStamp - e.tap.t < 500 && Math.hypot(p.x - e.tap.x, p.y - e.tap.y) < 44) { e.tap = null; begin(); return; }
    e.tap = { t: ev.timeStamp, x: p.x, y: p.y };
  };
  const onLeave = () => { const e = E.current; if (e && !e.drag) e.pointer = null; };
  const onKey = (ev) => { if (phase === 'idle' && (ev.key === 'Enter' || ev.key === ' ') && ev.target === inRef.current) { ev.preventDefault(); begin(); } };

  const openId = (id) => { if (id) setOpen(id); };
  const slotClick = (ev) => { const b = ev.target.closest('.slot'); if (b?.dataset.id) openId(b.dataset.id); };
  const info = open ? describe(open) : null;

  const card = (k, tray) => {
    const total = k === 'merged' ? story.counts.merged : k === 'left_out' ? story.counts.left_out : story.counts.by_category[k];
    const n = tray ? total : SLOTS;
    return (
      <section key={k} className={'sc-card' + (tray ? ' tray ' + k : '')} data-k={k} ref={(el) => (cards.current[k] = el)} style={{ '--c': tray ? undefined : `var(--cat-${k})` }}>
        <i className="hit-ring" aria-hidden="true" />
        <header>
          {tray ? <i className="seal tray-seal" lang="ja" aria-hidden="true">{k === 'merged' ? '重' : '外'}</i> : <i className="seal" lang="ja" aria-hidden="true">{SEAL[k]}</i>}
          <b>{tray ? (k === 'merged' ? 'Merged' : 'Left out') : LABEL[k]}</b>
          {tray && <small>{k === 'merged' ? 'duplicates' : 'not places to visit'}</small>}
          <span className="sc-n" />
        </header>
        {lists
          ? <div className={'sc-grid all' + (tray ? ' t' : '')} key={'all' + runKey}>{lists[k].map((id) => <Slot key={id} row={rowById.get(id)} A={A} name={nameOf(id)} onOpen={openId} />)}</div>
          : <div className={'sc-grid' + (tray ? ' t' : '')} key={'run' + runKey} onClick={slotClick}>{Array.from({ length: n }, (_, i) => <button key={i} type="button" className="slot empty" disabled tabIndex={-1} aria-label="Empty slot" />)}</div>}
      </section>
    );
  };

  return (
    <div className={'sort-back ph-' + phase} aria-hidden={!shown} inert={shown ? undefined : ''} style={Object.fromEntries(Object.entries(colors || {}).map(([k, v]) => ['--cat-' + k, v]))}>
      <div className={'sort-in' + (phase === 'idle' ? ' idle' : '')} ref={inRef} tabIndex={0} role="group"
        aria-label={phase === 'idle' ? 'Sorting sphere: 644 records. Double-click the sphere, or press Enter, to sort them.' : 'Sorting the records'}
        onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { if (E.current) E.current.drag = null; }} onPointerLeave={onLeave} onKeyDown={onKey}>
        <canvas className="sort-cv" ref={cvRef} aria-hidden="true" />
        <svg className="sc-defs" width="0" height="0" aria-hidden="true" focusable="false">
          <filter id="sc-rough"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" /></filter>
        </svg>
        <div className="sc-col l">{COLS[0].map((k) => card(k))}{card('merged', true)}</div>
        <div className="sc-mid" ref={midRef}>
          <p className="sc-eyebrow"><span lang="ja">整理</span> Sort the data</p>
          <p className="sc-cap" ref={capRef} aria-live="off">{CAPTIONS.idle}</p>
          {phase === 'idle' && <p className="sc-hint"><span className="dbl" aria-hidden="true"><i /><i /></span>{coarse() ? 'Double-tap' : 'Double-click'} the sphere to sort</p>}
          {phase === 'done' && (
            <div className={'sc-done' + (celebrate ? ' anim' : '')}>
              <span className="hanko-big" lang="ja" aria-hidden="true">済</span>
              <p className="sc-big"><b>{story.counts.on_map}</b> places sorted</p>
              <p className="sc-chips"><span>{story.counts.merged} merged</span><span>{story.counts.left_out} left out</span><span>{story.counts.with_photo} with a photo</span></p>
              <p className="sc-tip">Click any tile to see the place.</p>
            </div>
          )}
        </div>
        <div className="sc-col r">{COLS[1].map((k) => card(k))}{card('left_out', true)}</div>
        <footer className="sc-bar">
          <p className="xs">{story.counts.osm_records} OpenStreetMap records + {story.counts.city_list_added} Kyoto City sites = {story.counts.start} records → {story.counts.merged} merged, {story.counts.left_out} left out, {story.counts.on_map} on the map in 6 categories. <span className="muted">Motion adapted from <a href={story.motion_credit.url} target="_blank" rel="noreferrer">Claude photo sorter</a> ({story.motion_credit.license}).</span></p>
          <div className="sc-btns">
            <button type="button" className="btn ghost sm" onClick={() => { pendingReplay.current = true; replay(); }} disabled={phase !== 'done'}>Replay</button>
            <button type="button" className="btn sm" onClick={onBack}>Back to the map</button>
          </div>
        </footer>
        {info && <SortCard info={info} onClose={() => setOpen(null)} onShow={(id) => { setOpen(null); onShowOnMap(id); }} />}
      </div>
    </div>
  );
}
