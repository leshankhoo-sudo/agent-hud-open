import { useEffect, useRef, useState } from 'react';
import { TEAM } from './Outro.jsx';
import { loadAsBlob } from './lib/media.js';
import { useScene } from './lib/depth.js';

// Frosted glass button that fills with a soft, living liquid on hover or focus.
// The surface is a row of spring points: entering splashes where the pointer came in, moving
// the pointer stirs the surface, and the ripples spread and settle. Two layers at different
// speeds give depth; a thin highlight runs along the top. The label turns from white to ink
// as the liquid rises past it. With reduced motion the liquid simply fades in.
export function WaterButton({ children, onClick, scene, ghost = false, ...rest }) {
  const btn = useRef(null), cv = useRef(null);
  useEffect(() => {
    const b = btn.current, c = cv.current;
    if (!b || !c) return;
    const g = c.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const N = 28;
    const pts = Array.from({ length: N }, () => ({ y: 0, v: 0 }));
    const S = { level: 0, vel: 0, target: 0, raf: 0, t: 0, last: 0, lastX: null, dpr: 1, w: 0, h: 0 };
    const size = () => { const r = b.getBoundingClientRect(); S.dpr = Math.min(devicePixelRatio || 1, 2); S.w = r.width; S.h = r.height; c.width = Math.round(r.width * S.dpr); c.height = Math.round(r.height * S.dpr); };
    size();
    const tint = () => getComputedStyle(document.documentElement).getPropertyValue('--season').trim() || '#f4b6ca';
    const draw = () => {
      const { w, h, dpr } = S;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const lv = S.level;
      b.style.setProperty('--fill', Math.max(0, Math.min(1, lv)).toFixed(3));
      if (lv <= 0.001) return;
      const base = h * (1 - lv);
      const surf = (layer) => {
        g.beginPath();
        g.moveTo(-2, h + 2);
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * (w + 4) - 2;
          const swell = Math.sin(S.t * (layer ? 1.25 : 0.9) + i * (layer ? 0.42 : 0.33) + layer * 1.7) * (reduce ? 0 : 1.6 + 1.2 * layer) * Math.min(1, lv * 2) * (1 - Math.max(0, lv - 1) * 4);
          g.lineTo(x, base + pts[i].y * (layer ? 0.7 : 1) + swell);
        }
        g.lineTo(w + 2, h + 2);
        g.closePath();
      };
      const col = tint();
      // back layer: lighter, a little higher, slower
      g.save(); g.translate(0, -2.5); surf(1);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill(); g.restore();
      // front layer: milky glass with a hint of the season colour
      surf(0);
      const gr = g.createLinearGradient(0, base - 6, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.82)');
      gr.addColorStop(0.55, 'rgba(246,244,250,0.7)');
      gr.addColorStop(1, 'rgba(225,230,242,0.66)');
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.globalAlpha = 0.16; g.fillStyle = col; g.fillRect(0, base - 8, w, h - base + 10);
      g.restore();
      // highlight along the surface
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * (w + 4) - 2;
        const swell = Math.sin(S.t * 0.9 + i * 0.33) * (reduce ? 0 : 1.6) * Math.min(1, lv * 2) * (1 - Math.max(0, lv - 1) * 4);
        i ? g.lineTo(x, base + pts[i].y + swell) : g.moveTo(x, base + pts[i].y + swell);
      }
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1; g.stroke();
    };
    const step = (now) => {
      S.raf = 0;
      const real = Math.min(0.25, (now - (S.last || now)) / 1000) || 1 / 60; S.last = now; S.t += real;
      if (reduce) { S.level = S.target; draw(); return; }
      // Fixed steps of 1/60 s for however much time really passed, so the liquid takes the same
      // time to rise on a slow machine as on a fast one (it used to run in slow motion there).
      for (let left = real; left > 0.0005; left -= 1 / 60) {
        const dt = Math.min(1 / 60, left);
        // the level follows a soft spring towards the target
        const k = 5.2, damp = 3.6;
        S.vel += ((S.target - S.level) * k - S.vel * damp) * dt;
        S.level += S.vel * dt;
        // surface springs: each point returns to rest and pulls its neighbours
        for (let pass = 0; pass < 2; pass++) {
          for (const p of pts) { p.v += -p.y * 0.035; p.v *= 0.965; p.y += p.v; }
          for (let i = 0; i < N; i++) {
            const l = i ? pts[i - 1].y - pts[i].y : 0, r = i < N - 1 ? pts[i + 1].y - pts[i].y : 0;
            pts[i].v += (l + r) * 0.11;
          }
        }
      }
      draw();
      const moving = Math.abs(S.target - S.level) > 0.002 || Math.abs(S.vel) > 0.002 || pts.some((p) => Math.abs(p.v) > 0.01 || Math.abs(p.y) > 0.05);
      if (moving || S.target > 0) S.raf = requestAnimationFrame(step);
    };
    const kick = () => { if (!S.raf) { S.last = 0; S.raf = requestAnimationFrame(step); } };
    const at = (e) => { const r = b.getBoundingClientRect(); return Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * (N - 1)))); };
    const splash = (i, force) => { for (let j = -2; j <= 2; j++) { const k2 = i + j; if (k2 >= 0 && k2 < N) pts[k2].v += force * (1 - Math.abs(j) * 0.3); } };
    const enter = (e) => { S.target = 0.93; if (e && e.clientX != null) splash(at(e), 2.4); S.lastX = e?.clientX ?? null; kick(); };
    const leave = (e) => { S.target = 0; if (e && e.clientX != null) splash(at(e), -1.6); kick(); };
    const move = (e) => { if (S.lastX != null) { const dx = e.clientX - S.lastX; if (Math.abs(dx) > 0.5) splash(at(e), Math.max(-2.2, Math.min(2.2, dx * 0.22))); } S.lastX = e.clientX; kick(); };
    const focus = () => { if (b.matches(':focus-visible')) enter(null); };
    const blur = () => leave(null);
    b.addEventListener('pointerenter', enter); b.addEventListener('pointerleave', leave); b.addEventListener('pointermove', move);
    b.addEventListener('focus', focus); b.addEventListener('blur', blur);
    const ro = new ResizeObserver(() => { size(); draw(); });
    ro.observe(b);
    return () => {
      cancelAnimationFrame(S.raf); ro.disconnect();
      b.removeEventListener('pointerenter', enter); b.removeEventListener('pointerleave', leave); b.removeEventListener('pointermove', move);
      b.removeEventListener('focus', focus); b.removeEventListener('blur', blur);
    };
  }, []);
  return (
    <button ref={btn} type="button" className={'wbtn' + (ghost ? ' ghost' : '')} onClick={onClick} {...rest}>
      {scene && <span className="wbtn-scene" style={{ backgroundImage: `url(${scene})` }} aria-hidden="true" />}
      <canvas ref={cv} className="wbtn-liquid" aria-hidden="true" />
      <span className="wbtn-label">{children}</span>
    </button>
  );
}

// Page 1: the cherry-blossom waterway video plays on a loop under a short introduction to the project.
// Wide screens get a 16:9 cut (1920x1080, cropped from the 4K original, so no upscaling); tall
// screens get the full portrait frame (1440x2560).
// Video: Kanenori, Pixabay (Pixabay Content License); the source does not state where it was filmed.
// A few out-of-focus petals close to the lens: the nearest layer, so it moves most with the pointer.
const FORE = [
  { '--x': '80%', '--y': '9%', '--s': '74px', '--k': 62, '--b': '5px', '--o': 0.46, '--r': '24deg', '--t': '11s' },
  { '--x': '94%', '--y': '38%', '--s': '54px', '--k': 46, '--b': '3.2px', '--o': 0.56, '--r': '-38deg', '--t': '9s', '--d': '-3s' },
  { '--x': '63%', '--y': '88%', '--s': '66px', '--k': 70, '--b': '5.5px', '--o': 0.4, '--r': '70deg', '--t': '13s', '--d': '-6s' },
  { '--x': '55%', '--y': '12%', '--s': '26px', '--k': 26, '--b': '1.2px', '--o': 0.74, '--r': '-14deg', '--t': '8s', '--d': '-2s' },
  { '--x': '86%', '--y': '72%', '--s': '22px', '--k': 20, '--b': '.8px', '--o': 0.78, '--r': '110deg', '--t': '7s', '--d': '-5s' },
  { '--x': '71%', '--y': '46%', '--s': '15px', '--k': 13, '--b': '.3px', '--o': 0.8, '--r': '40deg', '--t': '10s', '--d': '-1s' },
];
const pickVideo = () => (typeof matchMedia === 'function' && matchMedia('(min-aspect-ratio: 1/1)').matches ? 'wide' : 'tall');
export default function Landing({ counts, onOpenMap, onStory, onNav }) {
  const base = import.meta.env.BASE_URL;
  const video = useRef(null), root = useRef(null);
  useScene(root);
  const [kind, setKind] = useState(pickVideo);
  const src = kind === 'wide' ? { mp4: `${base}media/cherry-1920x1080.mp4`, poster: `${base}media/cherry-poster-wide.webp` } : { mp4: `${base}media/cherry-1440.mp4`, poster: `${base}media/cherry-poster.webp` };
  useEffect(() => {
    const mq = matchMedia('(min-aspect-ratio: 1/1)');
    const on = () => setKind(pickVideo());
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // The video is read in one go into a blob: the simple Windows launcher server answers one
    // request at a time, and a half-read video stream would hold every other file back.
    const release = loadAsBlob(v, src.mp4);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.pause(); return release; }
    const play = () => v.play()?.catch?.(() => {});
    v.addEventListener('loadeddata', play);
    // pause when scrolled away, so it costs nothing in the background
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.05 });
    io.observe(v);
    return () => { io.disconnect(); v.removeEventListener('loadeddata', play); release(); };
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = (x) => (x == null ? '—' : x.toLocaleString('en-US'));
  return (
    <section className={'landing ' + kind} id="top" ref={root} aria-labelledby="ld-title">
      <div className="ld-stage" aria-hidden="true">
        <video key={kind} ref={video} className="ld-video" poster={src.poster} muted loop playsInline autoPlay preload="auto" />
        <div className="ld-shade" />
      </div>
      <div className="ld-fore" aria-hidden="true">{FORE.map((s, i) => <i key={i} style={s} />)}</div>

      <nav className="ld-nav" aria-label="Sections">
        <a className="ld-brand" href="#top" onClick={(e) => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect x="3" y="7" width="26" height="3.4" rx="1.4" fill="currentColor" /><rect x="6" y="12.5" width="20" height="2.4" rx="1" fill="currentColor" /><rect x="8.4" y="10" width="2.6" height="18" rx="1" fill="currentColor" /><rect x="21" y="10" width="2.6" height="18" rx="1" fill="currentColor" /></svg>
          <span>Kyoto Prefecture Tourism GIS</span>
        </a>
        <ul>
          {[['seasons', 'Seasons'], ['explore', 'Places'], ['dashboard', 'Map'], ['sources', 'Data'], ['credits', 'Team']].map(([k, l]) => (
            <li key={k}><button type="button" onClick={() => onNav(k)}>{l}</button></li>
          ))}
        </ul>
      </nav>

      <div className="ld-copy">
        <p className="ld-kicker"><span lang="ja">京都府</span> · Kyoto Prefecture</p>
        <h1 id="ld-title" className="ld-title">Kyoto Prefecture<br />Tourism GIS</h1>
        <p className="ld-lead">A university GIS project mapping attractions, public transport and walking access across Kyoto Prefecture, for visitors from Japan and abroad.</p>
        <ul className="ld-stats" aria-label="Records in this project">
          <li><b>{n(counts?.attractions)}</b><span>attraction records</span></li>
          <li><b>{n(counts?.stops)}</b><span>transit stops</span></li>
          <li><b>{n(counts?.areas)}</b><span>cities, towns and wards</span></li>
        </ul>
        <div className="ld-btns">
          <WaterButton onClick={onOpenMap} scene={`${base}season/autumn.webp`}>Open the map</WaterButton>
          <WaterButton onClick={onStory} scene={`${base}season/summer.webp`} ghost>Walk through the seasons</WaterButton>
        </div>
        <p className="ld-team">{TEAM.join(' · ')}</p>
      </div>

      <button type="button" className="ld-scroll" onClick={onStory}><span>Scroll</span><i aria-hidden="true" /></button>
      <p className="ld-credit">Video: Kanenori, <a href="https://pixabay.com/videos/spring-waterway-cherry-blossoms-345013/" target="_blank" rel="noreferrer">Pixabay</a> (Pixabay Content License) · filming location not stated by the source</p>
    </section>
  );
}
