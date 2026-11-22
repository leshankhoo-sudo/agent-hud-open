import { useEffect, useRef } from 'react';
import './vendor/ascii-koi/pond.js';   // ASCII Koi engine by pursurer (MIT), unchanged; it defines window.AsciiKoi

// A koi pond drawn in text characters, as a background behind the cards of the information panel.
// It never sits above content: the layer is under the cards (CSS) and takes no pointer events.
// The pond is simulated at SCALE times the panel's size and shown at the panel's size, so the koi are
// smaller and, as the engine places koi by area, there are more of them (up to 14).
// The swimming, wakes and water light are kept; a click on bare panel background drops fish food and
// sends soft ripples out from that point.
// On the dark theme a thin blue and teal mist drifts over the water (CSS only, see .koi-mist).
// Colours follow the light / dark theme. The pond stops while the panel is hidden or off screen, and
// with "reduce motion" it is a still picture.
const SCALE = 1.9;
const PALETTE = {
  dark: { water: '#101416', ink: '#edf3f5', accent: '#e8784f', koiLight: '#ebe6dc', koiDark: '#1b2023', dark: true },
  light: { water: '#f4efe6', ink: '#2f2924', accent: '#d2572f', koiLight: '#fffaf1', koiDark: '#3a312b', dark: false },
};

export default function Koi({ theme, scroller, paused = false }) {
  const canvas = useRef(null);
  const ripCanvas = useRef(null);
  const mist = useRef(null);
  const pond = useRef(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const pausedRef = useRef(paused);   // e.g. while the dashboard is turned over to "Sort the data"
  pausedRef.current = paused;
  const pauser = useRef(null);

  useEffect(() => {
    const host = scroller.current, cv = canvas.current, K = window.AsciiKoi;
    if (!host || !cv || !K) return undefined;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const p = K.createPond({ canvas: cv, reduce, most: 14, dpr: () => Math.min(2, devicePixelRatio || 1) / SCALE, palette: () => PALETTE[themeRef.current === 'light' ? 'light' : 'dark'] });
    pond.current = p;
    window.__koi = p;   // read by the automated tests
    let w = 0, h = 0, started = false, visible = false;
    // Ripples on the water where food is thrown: a few thin rings that spread and fade. They are drawn on
    // their own canvas in the same background layer (under the cards, no pointer events), several throws
    // overlap, and the canvas is only redrawn while a ripple is alive.
    const rc = ripCanvas.current, rx = rc.getContext('2d');
    const ripples = [];
    let rraf = 0, rdpr = 1;
    const drawRipples = (now) => {
      rraf = 0;
      rx.setTransform(rdpr, 0, 0, rdpr, 0, 0);
      rx.clearRect(0, 0, w, h);
      const light = themeRef.current === 'light';
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i], a = (now - r.t0) / r.life;
        if (a >= 1) { ripples.splice(i, 1); continue; }
        if (a < 0) continue;
        const e = 1 - (1 - a) ** 3, fade = (1 - a) ** 1.7, R = 5 + e * r.reach;
        rx.beginPath();
        rx.ellipse(r.x, r.y, R, R * 0.94, 0, 0, Math.PI * 2);
        rx.lineWidth = 0.6 + 1.3 * (1 - a);
        rx.strokeStyle = light ? `rgba(84, 70, 60, ${(0.3 * fade * r.k).toFixed(3)})` : `rgba(206, 240, 242, ${(0.5 * fade * r.k).toFixed(3)})`;
        rx.stroke();
      }
      if (ripples.length) rraf = requestAnimationFrame(drawRipples);
    };
    const ripple = (x, y) => {
      const now = performance.now();
      for (let k = 0; k < 3; k++) ripples.push({ x, y, t0: now + k * 280, life: 2400 + k * 300, reach: 64 + k * 30, k: 1 - k * 0.25 });
      while (ripples.length > 45) ripples.shift();
      if (!rraf) rraf = requestAnimationFrame(drawRipples);
    };
    window.__koiRipples = () => ripples.length;   // read by the automated tests
    const fit = () => {
      const nw = host.clientWidth, nh = host.clientHeight;
      if (nw < 40 || nh < 40 || (nw === w && nh === h)) return;
      w = nw; h = nh;
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      rdpr = Math.min(2, devicePixelRatio || 1);
      mist.current.style.width = `${w}px`; mist.current.style.height = `${h}px`;
      rc.style.width = `${w}px`; rc.style.height = `${h}px`; rc.width = Math.round(w * rdpr); rc.height = Math.round(h * rdpr);
      p.size(w * SCALE, h * SCALE);
      if (!started) { started = true; p.start(); p.pause(!visible || pausedRef.current); }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    // only animate while the panel is really on screen
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (started) p.pause(!visible || document.hidden || pausedRef.current); }, { threshold: 0.05 });
    io.observe(host);
    const vis = () => { if (started) p.pause(!visible || document.hidden || pausedRef.current); };
    document.addEventListener('visibilitychange', vis);
    // fish food where bare panel background is clicked (never on a card or control)
    const click = (e) => {
      if (e.target.closest('.card, .phead, .tile, button, a, input, label')) return;
      const r = cv.getBoundingClientRect();
      if (p.feed((e.clientX - r.left) * SCALE, (e.clientY - r.top) * SCALE)) ripple(e.clientX - r.left, e.clientY - r.top);
    };
    host.addEventListener('click', click);
    fit();
    pauser.current = () => { if (started) p.pause(!visible || document.hidden || pausedRef.current); };
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); host.removeEventListener('click', click); cancelAnimationFrame(rraf); p.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { pond.current?.colors(); }, [theme]);
  useEffect(() => { pauser.current?.(); }, [paused]);

  return <div className="koi-layer" aria-hidden="true"><canvas ref={canvas} /><canvas ref={ripCanvas} className="koi-ripples" /><i ref={mist} className="koi-mist" /></div>;
}
