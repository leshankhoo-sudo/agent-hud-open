import { useEffect, useRef, useState } from 'react';
import { loadAsBlob } from './lib/media.js';

// Closing section: one 10 s video holds four vertical shots side by side (16:9 overall).
// Each shot is drawn into its own panel; as the section scrolls into view the panels
// slide down one after another, then text and the team names rise in.
export const TEAM = ['KHOO LE SHAN', 'ER ZE XI', 'NICHOLAS LIM JUN XIAN', 'LUI YING HUI'];
const PANELS = [
  { k: '01', t: 'Explore', s: '523 attraction records across Kyoto Prefecture' },
  { k: '02', t: 'Connect', s: '5,479 transit stops and a road-network walking pilot' },
  { k: '03', t: 'Measure', s: 'Kernel density, live forecasts and credited photos' },
  { k: '04', t: 'Share', s: 'An open-data GIS dashboard, built as a team' },
];

export default function Outro({ manifest }) {
  const root = useRef(null);
  const video = useRef(null);
  const canvases = useRef([]);
  const [on, setOn] = useState(false);

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
