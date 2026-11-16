import { useEffect, useRef } from 'react';
import './vendor/ascii-koi/pond.js';   // ASCII Koi engine by pursurer (MIT), unchanged; it defines window.AsciiKoi

// A koi pond drawn in text characters, as a background behind the cards of the information panel.
// It never sits above content: the layer is under the cards (CSS) and takes no pointer events.
// The pond is simulated at SCALE times the panel's size and shown at the panel's size, so the koi are
// smaller and, as the engine places koi by area, there are more of them (up to 14).
// The swimming, wakes and water light are kept; a click on bare panel background drops fish food.
// Colours follow the light / dark theme. The pond stops while the panel is hidden or off screen, and
// with "reduce motion" it is a still picture.
const SCALE = 1.9;
const PALETTE = {
  dark: { water: '#101416', ink: '#edf3f5', accent: '#e8784f', koiLight: '#ebe6dc', koiDark: '#1b2023', dark: true },
  light: { water: '#f4efe6', ink: '#2f2924', accent: '#d2572f', koiLight: '#fffaf1', koiDark: '#3a312b', dark: false },
};

export default function Koi({ theme, scroller }) {
  const canvas = useRef(null);
  const pond = useRef(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const host = scroller.current, cv = canvas.current, K = window.AsciiKoi;
    if (!host || !cv || !K) return undefined;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const p = K.createPond({ canvas: cv, reduce, most: 14, dpr: () => Math.min(2, devicePixelRatio || 1) / SCALE, palette: () => PALETTE[themeRef.current === 'light' ? 'light' : 'dark'] });
    pond.current = p;
    window.__koi = p;   // read by the automated tests
    let w = 0, h = 0, started = false, visible = false;
    const fit = () => {
      const nw = host.clientWidth, nh = host.clientHeight;
      if (nw < 40 || nh < 40 || (nw === w && nh === h)) return;
      w = nw; h = nh;
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      p.size(w * SCALE, h * SCALE);
      if (!started) { started = true; p.start(); p.pause(!visible); }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    // only animate while the panel is really on screen
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (started) p.pause(!visible || document.hidden); }, { threshold: 0.05 });
    io.observe(host);
    const vis = () => { if (started) p.pause(!visible || document.hidden); };
    document.addEventListener('visibilitychange', vis);
    // fish food where bare panel background is clicked (never on a card or control)
    const click = (e) => {
      if (e.target.closest('.card, .phead, .tile, button, a, input, label')) return;
      const r = cv.getBoundingClientRect();
      p.feed((e.clientX - r.left) * SCALE, (e.clientY - r.top) * SCALE);
    };
    host.addEventListener('click', click);
    fit();
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); host.removeEventListener('click', click); p.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { pond.current?.colors(); }, [theme]);

  return <div className="koi-layer" aria-hidden="true"><canvas ref={canvas} /></div>;
}
