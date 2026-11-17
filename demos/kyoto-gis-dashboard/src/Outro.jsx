import { useEffect, useRef, useState } from 'react';
import { loadAsBlob } from './lib/media.js';
import { useScene } from './lib/depth.js';

// Closing section: one 10 s video holds four vertical shots side by side (16:9 overall), one shot per panel,
// and a thank-you card over them.
// The page builds itself as it comes into view, the way a page is laid out in a design tool (after the
// reference recording): a team of small pointers flies in, pulls a four-column layout grid, drags out a box
// for each panel (an image placeholder with a cross and its real size), sketches grey text bars and
// measures the gaps; then each picture is dropped in, the bars are typed over with a caret; the card is
// framed, snapped to centre guides, sketched, and filled in; the scaffolding goes and the pointers leave.
// Scrolled back up past it, it is taken apart in reverse, and built again next time. With reduced motion
// it simply shows.
export const TEAM = ['KHOO LE SHAN', 'ER ZE XI', 'NICHOLAS LIM JUN XIAN', 'LUI YING HUI'];
const PANELS = [
  { k: '01', t: 'Explore', s: 'Attraction records across Kyoto Prefecture, checked against a second list and deduplicated' },
  { k: '02', t: 'Connect', s: '5,479 transit stops and road-network walking access' },
  { k: '03', t: 'Measure', s: 'Kernel density, live forecasts and credited photos' },
  { k: '04', t: 'Share', s: 'An open-data GIS dashboard, built as a team' },
];

const N_PTR = 14;
const PCOL = ['#ffffff', '#7ad7da', '#ff9a6b', '#8fb4ff'];
// the build, step by step (ms from the start). Each pointer has a job: 0-3 one panel each, 4-7 the text of
// one panel each, 8-9 measuring, 10-13 the card.
const STEPS = [
  0,      // 0  empty
  100,    // 1  pointers fly in, each above its column
  700,    // 2  the layout grid is pulled down, column by column
  1500,   // 3  pointers at the top-left corner of their panel
  2250,   // 4  ... and drag out the panel boxes (image placeholders with their size)
  3100,   // 5  grey text bars are sketched; the gaps are measured
  4000,   // 6  pictures are dropped into the boxes, one after another
  5000,   // 7  the bars are typed over
  6000,   // 8  the card: pointers at its top-left corner
  6750,   // 9  ... drag it out; centre guides snap; it is sketched
  7700,   // 10 the card is filled in: title typed, names clicked in
  8900,   // 11 the source line and button; the grid and measures go; pointers leave
  10000,  // 12 done
];
const DONE = STEPS.length - 1;
const r01 = (n, k) => { const x = Math.sin((n + 1) * 12.9898 * k) * 43758.5453; return x - Math.floor(x); };

export default function Outro({ manifest }) {
  const root = useRef(null);
  useScene(root);
  const video = useRef(null);
  const canvases = useRef([]);
  const [on, setOn] = useState(false);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [step, setStep] = useState(reduce ? DONE : 0);
  const frame = useRef(null), card = useRef(null), team = useRef(null), heading = useRef(null);
  const [geo, setGeo] = useState(null);   // element boxes, in px inside the frame
  const timers = useRef([]);
  const stepRef = useRef(step); stepRef.current = step;

  const measure = () => {
    const f = frame.current.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }; };
    const ops = [...frame.current.querySelectorAll('.op')];
    setGeo({ W: f.width, H: f.height, panels: ops.map(rel), text: ops.map((o) => rel(o.querySelector('.op-t'))), card: rel(card.current), head: rel(heading.current), chips: [...team.current.children].map(rel) });
  };
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const build = () => {
    clear(); measure();
    const from = stepRef.current;
    STEPS.forEach((at, k) => { if (k > from) timers.current.push(setTimeout(() => setStep(k), at - STEPS[from])); });
  };
  const takeApart = () => {   // in reverse, quickly
    clear();
    for (let k = stepRef.current - 1, n = 0; k >= 0; k--, n++) timers.current.push(setTimeout(() => setStep(k), n * 90));
  };

  useEffect(() => loadAsBlob(video.current, `${import.meta.env.BASE_URL}media/ending_quad.mp4`), []);
  useEffect(() => {
    let inView = false;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const vis = e.intersectionRatio > 0.35;
      setOn((o) => o || vis);
      const v = video.current;
      if (vis) v.play().catch(() => {}); else v.pause();
      if (reduce) return;
      if (vis && !inView) { inView = true; build(); }
      // scrolled back up so the section is below the screen: take it apart, ready to build again
      if (!e.isIntersecting && inView && e.boundingClientRect.top > 0) { inView = false; takeApart(); }
    }), { threshold: [0, 0.35, 0.7] });
    io.observe(root.current);
    return () => { io.disconnect(); clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // where pointer n is at the current step
  const ptr = (n) => {
    const g = geo;
    if (!g || step === 0) return { x: n % 2 ? -50 : (g ? g.W + 50 : 0), y: (g ? g.H : 600) * r01(n, 7), o: 0 };
    if (step >= 11) { const a = (n / N_PTR) * Math.PI * 2; return { x: g.W / 2 + Math.cos(a) * g.W * 0.8, y: g.H / 2 + Math.sin(a) * g.H * 0.9, o: 0 }; }
    const P = g.panels, T = g.text, C = g.card;
    const jit = (v, k) => v + (r01(n, k) - 0.5) * 18;
    if (n <= 3) {   // the panel builders
      const p = P[n];
      if (step === 1) return { x: p.x + p.w * 0.5, y: 14, o: 1 };
      if (step === 2) return { x: p.x + p.w * 0.5, y: g.H - 10, o: 1 };
      if (step === 3) return { x: p.x + 4, y: p.y + 4, o: 1 };
      if (step === 4 || step === 5) return { x: p.x + p.w - 2, y: p.y + p.h - 2, o: 1 };
      if (step === 6 || step === 7) return { x: p.x + p.w * 0.55, y: p.y + p.h * 0.38, o: 1 };
      return { x: jit(C.x + C.w * (0.2 + 0.2 * n), 3), y: C.y - 26, o: 1 };   // stand by over the card
    }
    if (n <= 7) {   // the text writers
      const t = T[n - 4];
      if (step <= 4) return { x: jit(t.x + t.w * 0.4, 1), y: jit(g.H * 0.9, 2), o: step >= 1 ? 1 : 0 };
      if (step === 5) return { x: t.x + t.w * 0.85, y: t.y + t.h * 0.55, o: 1 };
      if (step <= 7) return { x: t.x + t.w * (step === 7 ? 0.7 : 0.4), y: t.y + t.h * 0.3, o: 1 };
      return { x: jit(C.x + C.w * 0.5, 4), y: C.y + C.h + 22, o: 1 };
    }
    if (n <= 9) {   // the measurers: in the gaps between panels
      const k = n === 8 ? 0 : 2, a = P[k], b = P[k + 1];
      if (step < 5) return { x: jit(g.W / 2, 5), y: jit(40, 6), o: 1 };
      if (step <= 7) return { x: (a.x + a.w + b.x) / 2 + 6, y: g.H * 0.5 + 8, o: 1 };
      return { x: n === 8 ? C.x - 18 : C.x + C.w + 18, y: C.y + C.h / 2, o: 1 };
    }
    // the card builders
    const m = n - 10;
    if (step < 8) return { x: jit(g.W * (0.35 + m * 0.1), 7), y: jit(g.H * 0.18, 8), o: 1 };
    if (step === 8) return { x: C.x + 4, y: C.y + 4, o: 1 };
    if (step === 9) return m === 0 ? { x: C.x + C.w - 2, y: C.y + C.h - 2, o: 1 } : { x: jit(C.x + C.w * (0.25 + 0.25 * m), 9), y: C.y + C.h * 0.35, o: 1 };
    const c = g.chips[m % g.chips.length];
    return { x: c.x + c.w * 0.5, y: c.y + c.h * 0.7, o: 1 };
  };

  // pointers on the same job move together but not in lockstep; where they hand work over in turn
  // (dropping pictures, typing, clicking names in) they go one after another, in time with what they make
  const delay = (n) => step === 6 && n <= 3 ? n * 0.22 : step === 7 && n >= 4 && n <= 7 ? (n - 4) * 0.12 : step === 10 && n >= 10 ? (n - 10) * 0.22 : (n % 4) * 0.04;
  const base = import.meta.env.BASE_URL;
  const topOf = () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const building = !reduce;
  const showOverlay = building && geo && step > 0 && step < DONE;
  const gaps = geo ? geo.panels.slice(0, -1).map((a, k) => { const b = geo.panels[k + 1]; return b.y === a.y ? { x: a.x + a.w, w: b.x - (a.x + a.w), y: a.y + a.h * 0.5 } : null; }).filter(Boolean) : [];

  return (
    <section className={'outro' + (on ? ' on' : '') + (building ? ' build' : '') + ` st${step}`} ref={root} id="credits" aria-label="Credits">
      <video ref={video} muted loop playsInline preload="auto" aria-hidden="true" className="outro-src" />
      <div className="outro-frame" ref={frame}>
        {PANELS.map((p, i) => (
          <div className={'op' + (step >= 6 ? ' on' : '') + (step >= 7 ? ' txt' : '')} key={p.k} style={{ '--i': i }}>
            <canvas ref={(el) => (canvases.current[i] = el)} style={{ backgroundImage: `url(${base}media/ending_quad.jpg)`, backgroundPosition: `${i * 33.333}% 0` }} />
            <div className="op-t">
              <span>{p.k}</span>
              <b>{p.t}</b>
              <small>{p.s}</small>
            </div>
          </div>
        ))}
        {showOverlay && (
          <div className="swarm" aria-hidden="true">
            {/* layout grid: one column band per panel, pulled down */}
            {geo.panels.map((p, k) => <i key={'g' + k} className="sw-col" style={{ left: p.x, top: 0, width: p.w, height: geo.H, '--k': k }} />)}
            {/* panel boxes: image placeholders with a cross and their size */}
            {step >= 4 && geo.panels.map((p, k) => (
              <b key={'p' + k} className={'sw-ph' + (step >= 6 ? ' img' : '')} style={{ left: p.x, top: p.y, width: p.w, height: p.h, '--k': k }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" /><line x1="100" y1="0" x2="0" y2="100" /></svg>
                <em>{Math.round(p.w)} × {Math.round(p.h)}</em>
              </b>
            ))}
            {/* grey text bars, sketched before the words are typed */}
            {step >= 5 && step < 8 && geo.text.map((t, k) => (
              <span key={'t' + k} className={'sw-bars' + (step >= 7 ? ' go' : '')} style={{ left: t.x, top: t.y, width: t.w, height: t.h, '--k': k }}><i style={{ width: '18%' }} /><i style={{ width: '62%' }} /><i style={{ width: '88%' }} /><i style={{ width: '70%' }} /></span>
            ))}
            {/* gap measurements between the panels */}
            {step >= 5 && gaps.map((q, k) => (
              <span key={'m' + k} className="sw-gap" style={{ left: q.x, top: q.y, width: q.w, '--k': k }}><em>{Math.round(q.w)}</em></span>
            ))}
            {/* the card: a box dragged out, centre guides that snap, then a sketch of its content */}
            {step >= 9 && <b className="sw-box" style={{ left: geo.card.x, top: geo.card.y, width: geo.card.w, height: geo.card.h }}><em>{Math.round(geo.card.w)} × {Math.round(geo.card.h)}</em></b>}
            {step >= 9 && step < 11 && <><i className="sw-snap v" style={{ left: geo.card.x + geo.card.w / 2 }} /><i className="sw-snap h" style={{ top: geo.card.y + geo.card.h / 2 }} /></>}
            {step === 9 && (
              <span className="sw-sketch">
                <i style={{ left: geo.head.x, top: geo.head.y, width: geo.head.w, height: geo.head.h * 0.7 }} />
                {geo.chips.map((c, k) => <i key={k} className="chip" style={{ left: c.x, top: c.y, width: c.w, height: c.h, '--k': k }} />)}
              </span>
            )}
            {Array.from({ length: N_PTR }, (_, n) => { const q = ptr(n); return <i key={n} className="sw-ptr" style={{ '--c': PCOL[n % 4], transform: `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`, opacity: q.o, transitionDelay: `${delay(n).toFixed(2)}s` }} />; })}
          </div>
        )}
        <div className={'outro-card' + (step >= 9 ? ' on' : '') + (step >= 10 ? ' fill chips' : '') + (step >= 11 ? ' done' : '')} ref={card}>
          <p className="ist-eb">THANK YOU · ありがとう</p>
          <h2 ref={heading}>Kyoto Prefecture Tourism GIS</h2>
          <p className="oc-by">Prepared by</p>
          <ul className="oc-team" ref={team}>{TEAM.map((n, i) => <li key={n} style={{ '--j': i }}>{n}</li>)}</ul>
          <p className="oc-src">Data: OpenStreetMap contributors (ODbL), MLIT N03 2026, Kyoto City Transportation Bureau, Open-Meteo, Wikimedia Commons{manifest ? ` · ${manifest.attractions.records} + ${manifest.transport.records} records` : ''}</p>
          <button type="button" className="ist-skip" onClick={topOf}>Back to the start ↑</button>
        </div>
      </div>
      <p className="ist-credit">Closing clips: social-media travel montage (creators incl. @camezi), used for a non-commercial university presentation.</p>
    </section>
  );
}
