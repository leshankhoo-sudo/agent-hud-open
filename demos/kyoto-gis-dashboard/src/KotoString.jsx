import { useEffect, useRef } from 'react';
import { pluck } from './lib/pluck.js';

// The east-west cross-section of the density surface, drawn as a koto string. Its resting shape is the data.
// Press anywhere on it and drag: it bends to a point there, like a string pulled by a finger. Let go and it
// rings: the shape a plucked string has (its first eight standing waves, each fading at its own rate) is
// drawn every frame, and a plucked-string tone plays (lib/pluck.js). A tap plucks it lightly; Enter or Space
// plucks it in the middle. After it is first drawn it shivers once by itself, without sound, to show it can
// be played. "Reduce motion": no vibration, the sound still plays.
const W = 220, H = 44, N = 72, MODES = 8, F1 = 7.5, MAXA = 16;
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function restShape(vals) {
  const n = vals.length, max = Math.max(1e-6, ...vals.map((x) => x || 0));
  const ys = vals.map((x) => H - 3 - ((x || 0) / max) * (H - 8));
  return Array.from({ length: N }, (_, k) => {   // resampled to N points so a bend looks smooth
    const u = (k / (N - 1)) * (n - 1), i = Math.min(n - 2, Math.floor(u)), f = u - i;
    return ys[i] * (1 - f) + ys[i + 1] * f;
  });
}

export default function KotoString({ values, freq, autoDelay = 2900, label }) {
  const svg = useRef(null), line = useRef(null), area = useRef(null), dot = useRef(null);
  const st = useRef({ mode: 'rest', x0: 0.5, A: 0, t0: 0, raf: 0, gain: 1 });
  const rest = useRef(restShape(values));
  rest.current = restShape(values);

  const paint = (disp) => {
    const ys = rest.current;
    let d = '';
    for (let k = 0; k < N; k++) {
      const x = (k / (N - 1)) * W, y = ys[k] + disp(k / (N - 1));
      d += `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(2)}`;
    }
    line.current?.setAttribute('d', d);
    area.current?.setAttribute('d', `${d}L${W},${H}L0,${H}Z`);
    dot.current?.setAttribute('cy', (ys[(N - 1) / 2 | 0] + disp(0.5)).toFixed(2));
  };
  const triangle = (x0, A) => (x) => A * (x < x0 ? x / x0 : (1 - x) / (1 - x0));
  const ringing = (x0, A, t) => (x) => {
    let y = 0;
    for (let n = 1; n <= MODES; n++) {
      const b = (2 * A * Math.sin(n * Math.PI * x0)) / (n * n * Math.PI * Math.PI * x0 * (1 - x0));
      y += b * Math.sin(n * Math.PI * x) * Math.cos(2 * Math.PI * F1 * n * t) * Math.exp(-t * (0.9 + 0.55 * n));
    }
    return y;
  };
  const loop = () => {
    const s = st.current;
    s.raf = 0;
    if (s.mode !== 'vibe') return;
    const t = (performance.now() - s.t0) / 1000;
    if (t > 3.2) { s.mode = 'rest'; paint(() => 0); return; }
    paint(ringing(s.x0, s.A, t));
    s.raf = requestAnimationFrame(loop);
  };
  const release = (x0, A, sound) => {
    const s = st.current;
    if (sound) pluck({ freq, amp: Math.abs(A) / MAXA + 0.25, bright: 1 - 2 * Math.min(x0, 1 - x0) });
    if (reduce()) { s.mode = 'rest'; paint(() => 0); return; }
    s.mode = 'vibe'; s.x0 = x0; s.A = A; s.t0 = performance.now();
    if (!s.raf) s.raf = requestAnimationFrame(loop);
  };

  useEffect(() => {
    paint(() => 0);
    if (reduce()) return undefined;
    const t = setTimeout(() => { if (st.current.mode === 'rest') release(0.38, 3.2, false); }, autoDelay);   // one silent shiver
    return () => { clearTimeout(t); cancelAnimationFrame(st.current.raf); };
  }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e) => {
    const r = svg.current.getBoundingClientRect();
    return { x: Math.min(0.94, Math.max(0.06, (e.clientX - r.left) / r.width)), y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e) => {
    e.preventDefault(); e.stopPropagation();
    svg.current.setPointerCapture?.(e.pointerId);
    const p = local(e), s = st.current;
    cancelAnimationFrame(s.raf); s.raf = 0;
    const restY = rest.current[Math.round(p.x * (N - 1))];
    s.mode = 'pull'; s.x0 = p.x; s.A = Math.max(-MAXA, Math.min(MAXA, p.y - restY)); s.y0 = p.y - s.A;
    svg.current.classList.add('pulling');
    paint(triangle(s.x0, s.A));
  };
  const move = (e) => {
    const s = st.current;
    if (s.mode !== 'pull') return;
    const p = local(e);
    s.A = Math.max(-MAXA, Math.min(MAXA, p.y - rest.current[Math.round(s.x0 * (N - 1))]));
    paint(triangle(s.x0, s.A));
  };
  const up = () => {
    const s = st.current;
    if (s.mode !== 'pull') return;
    svg.current.classList.remove('pulling');
    release(s.x0, Math.abs(s.A) < 1.5 ? -6 : s.A, true);   // a tap plucks it lightly
  };
  const key = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); release(0.5, -9, true); } };

  return (
    <svg className="koto-string" ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="button" tabIndex={0} aria-label={label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
      <path className="area" ref={area} />
      <path className="ln" ref={line} />
      <circle ref={dot} cx={W / 2} r="3" />
      <rect className="hit" x="0" y="-8" width={W} height={H + 16} />
    </svg>
  );
}
