import { useEffect, useRef, useState } from 'react';
import { TEAM } from './Outro.jsx';

// Scroll intro: the page scroll scrubs one video (canal dolly → tilt up into the night sky),
// text panels appear in turn, and cherry petals are drawn on a canvas (so they always fall
// downward, also when the video plays backward). At the end the sky matches the dashboard
// background and the dashboard follows.
//
// The footage is AI-generated and illustrative; it is labelled as such on the page.

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// [start, end] of each text stage, as scroll progress 0..1
const STAGES = [
  [0, 0.12],
  [0.16, 0.36],
  [0.4, 0.58],
  [0.62, 0.8],
  [0.86, 1.01],
];

export default function Intro({ manifest, photos, kdeMeta, walkInfo }) {
  const root = useRef(null);
  const video = useRef(null);
  const canvas = useRef(null);
  const [stage, setStage] = useState(0);
  const state = useRef({ p: 0, shown: 0, last: 0, vel: 0 });

  // Scroll → video time, stage and petal wind.
  useEffect(() => {
    const v = video.current;
    const reduce = reduceMotion();
    let raf;
    v.pause();
    const frame = () => {
      const r = root.current.getBoundingClientRect();
      const span = r.height - innerHeight;
      const p = clamp(-r.top / span, 0, 1);
      const st = state.current;
      st.vel = st.vel * 0.9 + (p - st.p) * 60 * 0.1;
      st.p = p;
      st.shown += (p - st.shown) * (reduce ? 1 : 0.14);
      if (Math.abs(p - st.shown) < 0.0005) st.shown = p;
      const dur = v.duration || 14.25;
      const t = clamp(st.shown * dur, 0, dur - 0.05);
      if (!v.seeking && Math.abs(v.currentTime - t) > 0.02) {
        try { v.currentTime = t; } catch { /* not loaded yet */ }
      }
      root.current.style.setProperty('--p', st.shown.toFixed(4));
      root.current.style.setProperty('--fade', smooth(0.9, 1, st.shown).toFixed(3));
      const s = STAGES.findIndex(([a, b]) => st.shown >= a && st.shown < b);
      setStage((old) => (old === s ? old : s));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Petals on a canvas. They fall in screen space; scroll speed adds wind; near the end they
  // cool into small blue points that match the dashboard.
  useEffect(() => {
    if (reduceMotion()) return;
    const c = canvas.current;
    const g = c.getContext('2d');
    let W = 0, H = 0, D = 1, raf;
    const size = () => { D = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; c.width = W * D; c.height = H * D; };
    size();
    addEventListener('resize', size);
    const N = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
    const P = Array.from({ length: N }, () => spawn(true));
    function spawn(first) {
      return { x: Math.random() * innerWidth, y: first ? Math.random() * innerHeight : -20 - Math.random() * 80, s: 5 + Math.random() * 7, vy: 22 + Math.random() * 30,
        sway: 18 + Math.random() * 30, ph: Math.random() * 6.3, spin: (Math.random() - 0.5) * 3, rot: Math.random() * 6.3, flip: Math.random() * 6.3, depth: 0.5 + Math.random() * 0.5 };
    }
    let last = performance.now();
    const draw = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = state.current;
      const vis = 1 - smooth(0.97, 1, st.shown);
      g.setTransform(D, 0, 0, D, 0, 0);
      g.clearRect(0, 0, W, H);
      if (vis > 0.01 && root.current.getBoundingClientRect().bottom > 0) {
        const cool = smooth(0.72, 0.92, st.shown);
        const wind = clamp(st.vel * 900, -260, 260);
        for (const q of P) {
          q.ph += dt * 1.3;
          q.rot += q.spin * dt;
          q.flip += dt * 2.2;
          q.y += (q.vy - wind * 0.35) * q.depth * dt;
          q.x += (Math.sin(q.ph) * q.sway * 0.04 + wind * 0.25 * q.depth) * dt * 10;
          if (q.y > H + 30 || q.y < -140 || q.x < -60 || q.x > W + 60) Object.assign(q, spawn(false), q.y < -140 ? { y: H + 20 } : {});
          g.save();
          g.translate(q.x, q.y);
          g.rotate(q.rot);
          g.scale(1, Math.abs(Math.cos(q.flip)) * 0.75 + 0.25);
          g.globalAlpha = vis * (0.55 + 0.45 * q.depth);
          const s = q.s * q.depth * (1 - cool * 0.65);
          const r = Math.round(255 - cool * 175), gg = Math.round(196 - cool * 20), b = Math.round(214 + cool * 41);
          g.fillStyle = `rgb(${r},${gg},${b})`;
          if (cool > 0.6) {
            g.shadowColor = 'rgba(127,179,255,.9)';
            g.shadowBlur = 8;
          }
          g.beginPath();
          // cherry petal: rounded body with a small notch at the tip
          g.moveTo(0, -s);
          g.bezierCurveTo(s * 0.9, -s * 0.9, s * 0.8, s * 0.6, 0, s);
          g.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.9, -s * 0.9, 0, -s);
          g.fill();
          g.fillStyle = `rgba(${r - 30},${gg - 60},${b - 50},.35)`;
          g.beginPath();
          g.moveTo(-s * 0.18, -s);
          g.lineTo(0, -s * 0.62);
          g.lineTo(s * 0.18, -s);
          g.fill();
          g.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }, []);

  const skip = () => {
    const el = document.getElementById('dashboard');
    if (el) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  const m = manifest;
  const base = import.meta.env.BASE_URL;

  return (
    <section className="intro-s" ref={root} aria-label="Introduction">
      <div className="intro-sticky">
        <video ref={video} className="intro-v" src={`${base}media/sakura_scroll.mp4`} poster={`${base}media/sakura_poster.jpg`} muted playsInline preload="auto" aria-hidden="true" />
        <div className="intro-shade" />
        <canvas ref={canvas} className="intro-petals" aria-hidden="true" />

        <div className={'ist ist-0' + (stage === 0 ? ' on' : '')}>
          <p className="ist-eb">KYOTO PREFECTURE · 京都府</p>
          <h1>Kyoto Prefecture<br />Tourism GIS</h1>
          <p className="ist-sub">Attractions, transit stops and walking access across the prefecture. A university GIS prototype.</p>
          <div className="ist-team"><span>Prepared by</span>{TEAM.map((n, i) => <b key={n} style={{ '--j': i }}>{n}</b>)}</div>
          <button type="button" className="ist-skip" onClick={skip}>Skip to dashboard ↓</button>
        </div>

        <div className={'ist ist-card' + (stage === 1 ? ' on' : '')}>
          <p className="ist-eb">01 · STUDY AREA</p>
          <h2>The whole of Kyoto Prefecture</h2>
          <div className="ist-stats">
            <div><b>{m ? m.boundary.display_municipalities : '—'}</b><span>municipalities and Kyoto City wards (N03, 2026)</span></div>
            <div><b>{m ? m.attractions.records.toLocaleString('en-US') : '—'}</b><span>attraction records</span></div>
            <div><b>{m ? m.transport.records.toLocaleString('en-US') : '—'}</b><span>transit stop records</span></div>
          </div>
          <p className="ist-note">Preliminary OpenStreetMap records, not official counts.</p>
        </div>

        <div className={'ist ist-card' + (stage === 2 ? ' on' : '')}>
          <p className="ist-eb">02 · SOURCES</p>
          <h2>Built on open data</h2>
          <ul className="ist-chips">
            <li><b>OpenStreetMap</b><span>attractions, stops and roads, via Geofabrik (ODbL)</span></li>
            <li><b>MLIT N03 2026</b><span>administrative boundaries</span></li>
            <li><b>Kyoto City Bus</b><span>sample journeys and fares from Kyoto Station</span></li>
            <li><b>Open-Meteo</b><span>7-day model forecasts for each place</span></li>
            <li><b>Wikimedia Commons</b><span>{photos ? `${photos.with_photo} credited, matched photos` : 'credited photos'}</span></li>
          </ul>
        </div>

        <div className={'ist ist-card' + (stage === 3 ? ' on' : '')}>
          <p className="ist-eb">03 · ANALYSIS</p>
          <h2>Two questions</h2>
          <div className="ist-two">
            <div><i>A1</i><b>Where do attractions cluster?</b><span>Kernel density{kdeMeta ? `, ${kdeMeta.search_radius_m / 1000} km radius, ${kdeMeta.cell_size_m} m cells` : ''}</span></div>
            <div><i>A2</i><b>How far is the walk to a stop?</b><span>Road-network routes to the nearest bus and rail stop{walkInfo ? `, pilot of ${walkInfo} records in Gion–Kiyomizu` : ''}</span></div>
          </div>
        </div>

        <div className={'ist ist-end' + (stage === 4 ? ' on' : '')}>
          <p className="ist-eb">NIGHT FALLS OVER KYOTO</p>
          <button type="button" className="ist-go" onClick={skip}>Open the dashboard <span>↓</span></button>
        </div>

        <div className="ist-prog" aria-hidden="true"><i /></div>
        <p className="ist-credit">Illustrative AI-generated footage, not a recording of a specific site.</p>
      </div>
    </section>
  );
}
