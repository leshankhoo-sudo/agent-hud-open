import { useEffect, useRef, useState } from 'react';
import { loadAsBlob } from './lib/media.js';
import { useScene } from './lib/depth.js';

// Closing section: one 10 s video holds four vertical shots side by side (16:9 overall).
// Each shot is drawn into its own panel; as the section scrolls into view the panels
// slide down one after another, then text and the team names rise in. A swarm of small pointers
// "builds" the page as it arrives: they frame the panels, then the card, then scatter.
export const TEAM = ['KHOO LE SHAN', 'ER ZE XI', 'NICHOLAS LIM JUN XIAN', 'LUI YING HUI'];
const PANELS = [
  { k: '01', t: 'Explore', s: 'Attraction records across Kyoto Prefecture, checked against a second list and deduplicated' },
  { k: '02', t: 'Connect', s: '5,479 transit stops and road-network walking access' },
  { k: '03', t: 'Measure', s: 'Kernel density, live forecasts and credited photos' },
  { k: '04', t: 'Share', s: 'An open-data GIS dashboard, built as a team' },
];

// The swarm that builds the page: where each small pointer goes in the three steps (percent of the frame).
// Step 1: the corners of the four panels. Step 2: round the thank-you card. Step 3: away, off the frame.
const SWARM = Array.from({ length: 16 }, (_, n) => {
  const r = (k) => { const x = Math.sin((n + 1) * 78.233 * k) * 43758.5453; return x - Math.floor(x); };
  const col = n % 4, corner = Math.floor(n / 4);
  const ang = (n / 16) * Math.PI * 2;
  return {
    n, k: ['#ffffff', '#7ad7da', '#ff9a6b', '#8fb4ff'][n % 4],
    x1: col * 25 + (corner % 2 ? 23.5 : 1.5) + r(1) * 1.5, y1: (corner < 2 ? 3 : 93) + r(2) * 3,
    x2: 50 + Math.cos(ang) * (21 + r(3) * 3), y2: 42 + Math.sin(ang) * (29 + r(4) * 4),
    x3: 50 + Math.cos(ang) * 75, y3: 46 + Math.sin(ang) * 80,
  };
});

export default function Outro({ manifest }) {
  const root = useRef(null);
  useScene(root);
  const video = useRef(null);
  const canvases = useRef([]);
  const [on, setOn] = useState(false);
  const [swarm, setSwarm] = useState(0);
  // the swarm plays once, when the page first comes into view
  useEffect(() => {
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = [setTimeout(() => setSwarm(1), 60), setTimeout(() => setSwarm(2), 1500), setTimeout(() => setSwarm(3), 3100), setTimeout(() => setSwarm(4), 4400)];
    return () => t.forEach(clearTimeout);
  }, [on]);

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
    <section className={'outro' + (on ? ' on' : '')} ref={root} id="credits" aria-label="Credits">
      <video ref={video} muted loop playsInline preload="auto" aria-hidden="true" className="outro-src" />
      <div className="outro-frame">
        {PANELS.map((p, i) => (
          <div className="op" key={p.k} style={{ '--i': i }}>
            <canvas ref={(el) => (canvases.current[i] = el)} style={{ backgroundImage: `url(${base}media/ending_quad.jpg)`, backgroundPosition: `${i * 33.333}% 0` }} />
            <div className="op-t">
              <span>{p.k}</span>
              <b>{p.t}</b>
              <small>{p.s}</small>
            </div>
          </div>
        ))}
        {swarm < 4 && (
          <div className="swarm" data-s={swarm} aria-hidden="true">
            {PANELS.map((p, i) => <b key={p.k} className="g" style={{ '--i': i }}><em>{p.k} · {p.t}</em></b>)}
            <b className="c"><em>thank-you card</em></b>
            {SWARM.map((m) => <i key={m.n} style={{ '--n': m.n, '--k': m.k, '--x1': `${m.x1}%`, '--y1': `${m.y1}%`, '--x2': `${m.x2}%`, '--y2': `${m.y2}%`, '--x3': `${m.x3}%`, '--y3': `${m.y3}%` }} />)}
          </div>
        )}
        <div className="outro-card">
          <p className="ist-eb">THANK YOU · ありがとう</p>
          <h2>Kyoto Prefecture Tourism GIS</h2>
          <p className="oc-by">Prepared by</p>
          <ul className="oc-team">{TEAM.map((n, i) => <li key={n} style={{ '--j': i }}>{n}</li>)}</ul>
          <p className="oc-src">Data: OpenStreetMap contributors (ODbL), MLIT N03 2026, Kyoto City Transportation Bureau, Open-Meteo, Wikimedia Commons{manifest ? ` · ${manifest.attractions.records} + ${manifest.transport.records} records` : ''}</p>
          <button type="button" className="ist-skip" onClick={top}>Back to the start ↑</button>
        </div>
      </div>
      <p className="ist-credit">Closing clips: social-media travel montage (creators incl. @camezi), used for a non-commercial university presentation.</p>
    </section>
  );
}
