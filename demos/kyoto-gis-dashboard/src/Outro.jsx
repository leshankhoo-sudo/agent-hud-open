import { useEffect, useRef, useState } from 'react';
import { loadAsBlob } from './lib/media.js';
import { useScene } from './lib/depth.js';

// Closing section: one 10 s video holds four vertical shots side by side (16:9 overall).
// Each shot is drawn into its own panel; as the section scrolls into view the panels
// are built in one by one by a swarm of small pointers (see STEPS). With reduced motion it simply shows.
export const TEAM = ['KHOO LE SHAN', 'ER ZE XI', 'NICHOLAS LIM JUN XIAN', 'LUI YING HUI'];
const PANELS = [
  { k: '01', t: 'Explore', s: 'Attraction records across Kyoto Prefecture, checked against a second list and deduplicated' },
  { k: '02', t: 'Connect', s: '5,479 transit stops and road-network walking access' },
  { k: '03', t: 'Measure', s: 'Kernel density, live forecasts and credited photos' },
  { k: '04', t: 'Share', s: 'An open-data GIS dashboard, built as a team' },
];

// The page builds itself, after the reference recording: it starts empty; a swarm of small pointers flies
// in and gathers, pulls guide lines, then for each panel one pointer drags out a selection box (with its real
// size on a tag), the picture wipes in and the others type its title; then the card is framed, its title
// typed and the team names clicked in one by one; the guides go and the pointers leave.
const N_PTR = 14;
const PCOL = ['#ffffff', '#7ad7da', '#ff9a6b', '#8fb4ff'];
const STEPS = [
  { at: 0 },                      // 0 empty
  { at: 120, k: 'gather' },       // 1 pointers fly in and form a ring
  { at: 1150, k: 'guides' },      // 2 guide lines are pulled
  { at: 1900, k: 'panel', i: 0 }, // 3..6 one panel each
  { at: 2950, k: 'panel', i: 1 },
  { at: 4000, k: 'panel', i: 2 },
  { at: 5050, k: 'panel', i: 3 },
  { at: 6150, k: 'card' },        // 7 the card
  { at: 7300, k: 'chips' },       // 8 team names
  { at: 8500, k: 'leave' },       // 9 guides fade, pointers leave
  { at: 9600, k: 'done' },        // 10
];
const wobble = (n, k) => { const x = Math.sin((n + 1) * 12.9898 * k) * 43758.5453; return x - Math.floor(x); };

export default function Outro({ manifest }) {
  const root = useRef(null);
  useScene(root);
  const video = useRef(null);
  const canvases = useRef([]);
  const [on, setOn] = useState(false);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [step, setStep] = useState(reduce ? 10 : 0);
  const frame = useRef(null), card = useRef(null), team = useRef(null), heading = useRef(null);
  const [geo, setGeo] = useState(null);   // element boxes, in px inside the frame
  // the build plays once, when the page first comes into view
  useEffect(() => {
    if (!on || reduce) return undefined;
    const f = frame.current.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }; };
    setGeo({ W: f.width, H: f.height, panels: [...frame.current.querySelectorAll('.op')].map(rel), card: rel(card.current), head: rel(heading.current), chips: [...team.current.children].map(rel) });
    const t = STEPS.map((st, k) => setTimeout(() => setStep(k), st.at));
    return () => t.forEach(clearTimeout);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  // where each pointer is at the current step
  const ptr = (n) => {
    const g = geo, st = STEPS[step] || {};
    if (!g) return { x: -40, y: -40, o: 0 };
    const cx = g.W / 2, cy = g.H * 0.45, a = (n / N_PTR) * Math.PI * 2;
    const ring = (x, y, r) => ({ x: x + Math.cos(a) * r * (0.85 + 0.3 * wobble(n, 2)), y: y + Math.sin(a) * r * 0.75 * (0.85 + 0.3 * wobble(n, 3)), o: 1 });
    const around = (b, lead) => {   // pointer 0 drags the corner; the others crowd round the box, mostly near the title area
      if (n === 0) return lead ? { x: b.x + b.w, y: b.y + b.h, o: 1 } : { x: b.x, y: b.y, o: 1 };
      const t = n / N_PTR;
      return { x: b.x + b.w * (0.15 + 0.7 * wobble(n, 5)), y: b.y + b.h * (0.55 + 0.4 * t), o: 1 };
    };
    switch (st.k) {
      case undefined: return { x: n % 2 ? -60 : g.W + 60, y: g.H * wobble(n, 7), o: 0 };
      case 'gather': return ring(cx, cy, 46);
      case 'guides': return n < 4 ? { x: [g.W * 0.25, g.W * 0.5, g.W * 0.75, g.W][n], y: n < 3 ? g.H - 8 : g.H * 0.42, o: 1 } : ring(cx, cy, 70);
      case 'panel': return around(g.panels[st.i], true);
      case 'card': return around(g.card, true);
      case 'chips': { const c = g.chips[n % g.chips.length]; return { x: c.x + c.w * (0.3 + 0.4 * wobble(n, 9)), y: c.y + c.h * 0.7, o: 1 }; }
      case 'leave': return { x: cx + Math.cos(a) * g.W * 0.9, y: cy + Math.sin(a) * g.H * 0.9, o: 0 };
      default: return { x: cx, y: cy, o: 0 };
    }
  };
  const box = (() => {   // the selection box being dragged out
    const st = STEPS[step] || {};
    if (!geo) return null;
    if (st.k === 'panel') return geo.panels[st.i];
    if (st.k === 'card') return geo.card;
    return null;
  })();
  const built = (i) => step >= 3 + i;
  const build = !reduce;

  useEffect(() => loadAsBlob(video.current, `${import.meta.env.BASE_URL}media/ending_quad.mp4`), []);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const vis = e.intersectionRatio > 0.35;
      setOn((o) => o || vis);
      const v = video.current;
      if (vis) v.play().catch(() => {}); else v.pause();
    }), { threshold: [0, 0.35, 0.7] });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);

  // Copy each quarter of the video into its panel canvas.
  useEffect(() => {
    let raf;
    const draw = () => {
      const v = video.current;
      if (v.readyState >= 2 && !v.paused) {
        const qw = v.videoWidth / 4, h = v.videoHeight;
        canvases.current.forEach((c, i) => {
          if (!c) return;
          if (c.width !== qw) { c.width = qw; c.height = h; }
          c.getContext('2d').drawImage(v, qw * i, 0, qw, h, 0, 0, qw, h);
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const base = import.meta.env.BASE_URL;
  const top = () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  return (
    <section className={'outro' + (on ? ' on' : '') + (build ? ' build' : '') + (step >= 10 ? ' built' : '')} ref={root} id="credits" aria-label="Credits">
      <video ref={video} muted loop playsInline preload="auto" aria-hidden="true" className="outro-src" />
      <div className="outro-frame" ref={frame}>
        {PANELS.map((p, i) => (
          <div className={'op' + (built(i) ? ' on' : '')} key={p.k} style={{ '--i': i }}>
            <canvas ref={(el) => (canvases.current[i] = el)} style={{ backgroundImage: `url(${base}media/ending_quad.jpg)`, backgroundPosition: `${i * 33.333}% 0` }} />
            <div className="op-t">
              <span>{p.k}</span>
              <b>{p.t}</b>
              <small>{p.s}</small>
            </div>
          </div>
        ))}
        {build && step < 10 && geo && (
          <div className={'swarm s' + step} aria-hidden="true">
            <svg className="sw-guides" width={geo.W} height={geo.H}>
              {[0.25, 0.5, 0.75].map((x, k) => <line key={k} x1={geo.W * x} y1="0" x2={geo.W * x} y2={geo.H} style={{ '--k': k }} />)}
              <line className="h" x1="0" y1={geo.H * 0.42} x2={geo.W} y2={geo.H * 0.42} style={{ '--k': 3 }} />
            </svg>
            {box && (
              <b className="sw-box" key={step} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                <em>{Math.round(box.w)} × {Math.round(box.h)}</em>
              </b>
            )}
            {Array.from({ length: N_PTR }, (_, n) => { const q = ptr(n); return <i key={n} style={{ '--k': PCOL[n % 4], transform: `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`, opacity: q.o, transitionDelay: `${(n * 0.03).toFixed(2)}s` }} />; })}
          </div>
        )}
        <div className={'outro-card' + (step >= 7 ? ' on' : '') + (step >= 8 ? ' chips' : '') + (step >= 9 ? ' done' : '')} ref={card}>
          <p className="ist-eb">THANK YOU · ありがとう</p>
          <h2 ref={heading}>Kyoto Prefecture Tourism GIS</h2>
          <p className="oc-by">Prepared by</p>
          <ul className="oc-team" ref={team}>{TEAM.map((n, i) => <li key={n} style={{ '--j': i }}>{n}</li>)}</ul>
          <p className="oc-src">Data: OpenStreetMap contributors (ODbL), MLIT N03 2026, Kyoto City Transportation Bureau, Open-Meteo, Wikimedia Commons{manifest ? ` · ${manifest.attractions.records} + ${manifest.transport.records} records` : ''}</p>
          <button type="button" className="ist-skip" onClick={top}>Back to the start ↑</button>
        </div>
      </div>
      <p className="ist-credit">Closing clips: social-media travel montage (creators incl. @camezi), used for a non-commercial university presentation.</p>
    </section>
  );
}
