import { useEffect, useRef } from 'react';

// Pointer light: "firefly meteors", after the reference recording.
// A small flock of particles follows the pointer. Each particle is its own body: a bright round head with a
// soft glow, and a thin tail drawn along that particle's own recent path, so it bends where the particle
// turned; the tail is brightest at the head and thins and fades to its end. No two particles are joined and
// there is no shared tail.
// Moving: each particle is pulled to a point near the pointer by its own spring, a little stiffer or looser
// than its neighbours, so the flock trails with inertia; a fast hand stretches the tails, a slow one draws
// them in. Resting: the long tails fade and the flock stays around the pointer like fireflies, each on its
// own slow loops at its own speed, drifting apart and back, its light breathing on its own beat, with a
// short curved tail. Leaving the page fades them out; coming back starts them at the pointer, so no line is
// drawn from where they were.
// Colours follow the dashboard's theme switch (white cores and pale-blue glow added as light on the dark
// theme; clear mid-blue heads with a touch of cyan, painted normally, on the light one); a theme change
// fades from one to the other without touching the motion.
// One fixed canvas over the page that takes no pointer events. Popups and tooltips are cut out of what it
// draws, so it never lies over them. Paused while the page is hidden; not started on touch-only devices,
// and off by default with "reduce motion". The small toggle (CursorFxToggle) turns it off and on and is
// remembered.

// ---- all tuning in one place --------------------------------------------------------------------------
export const FX = {
  count: 54,                    // particles
  trail: 30,                    // most path samples kept per particle
  sampleHz: 75,                 // path samples per second (independent of the display's refresh rate)
  stiff: [150, 330],            // spring stiffness while the pointer moves (per particle, random in range)
  damping: [0.62, 0.86],        // damping ratio while moving
  spread: [3, 24],              // px, how far from the pointer each particle aims while moving
  tailMove: [0.075, 0.15],      // s of path drawn as tail while moving (a fast hand makes it long in px)
  tailRest: [0.42, 0.72],       // s of path drawn while resting (short arcs)
  tailMax: [70, 130],           // px, the longest a tail gets however fast the hand (per particle)
  restAfter: 0.22,              // s without movement before the flock starts to rest
  restIn: 0.9, restOut: 0.16,   // s to ease into rest, and back to moving
  restRadius: [16, 74],         // px, each firefly's distance from the pointer while resting
  restSpin: [0.35, 1.25],       // rad/s each firefly travels round (either way)
  restStiff: 0.32,              // springs loosen to this share while resting, so the loops are soft
  size: [0.75, 1.65],           // px, head radius
  bright: [0.62, 1],            // head brightness
  breathe: [1.1, 3.2],          // rad/s, each firefly's own light pulse while resting
  fadeIn: 9, fadeOut: 2.6,      // rates for the whole flock appearing / leaving the page
  themeRate: 5,                 // rate of the colour change when the theme switches
  rejoin: 160,                  // px: coming back further than this from where it left restarts the flock at the pointer
  dark: { core: [255, 255, 255], glow: [150, 200, 255], tailA: [236, 243, 255], tailB: [138, 186, 255], hi: null, blend: 'lighter', glowA: 0.55, tailW: 1, alpha: 1 },
  light: { core: [26, 76, 188], glow: [64, 126, 226], tailA: [32, 92, 204], tailB: [38, 168, 204], hi: [130, 228, 242], blend: 'source-over', glowA: 0.2, tailW: 1.1, alpha: 0.95 },
  // what the light must never lie over
  avoid: '[role="dialog"], [role="tooltip"], .tip, .season-pop, .split-tip, .koto-cap, .maplibregl-popup, .d3-card',
};
const KEY = 'kyoto.cursorFx';
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// On for a desktop mouse the first time, off with "reduce motion" or on touch; after that the user's choice.
export function cursorFxInitial() {
  try { const v = localStorage.getItem(KEY); if (v === 'on' || v === 'off') return v === 'on' && finePointer(); } catch { /* storage blocked */ }
  return finePointer() && !reducedMotion();
}
export function saveCursorFx(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } }

export function CursorFxToggle({ on, onChange }) {
  const label = `Cursor light: ${on ? 'On' : 'Off'}`;
  return (
    <button type="button" className={'fx-toggle' + (on ? ' on' : '')} aria-pressed={on} aria-label={label} title={label} onClick={() => onChange(!on)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="fx-tail" d="M4 19.5c3.4-.6 6.4-2.7 9.6-6.2M3.5 14.6c2.7-.2 5.3-1.4 8-3.6M8.6 21c2.2-1.3 4.4-3.4 6.3-6.2" />
        <circle className="fx-glow" cx="16.6" cy="8.2" r="5" />
        <circle className="fx-head" cx="16.6" cy="8.2" r="2.3" />
        <path className="fx-off" d="M4 4l16 16" />
      </svg>
    </button>
  );
}

const lerp = (a, b, t) => a + (b - a) * t;
const pick = ([a, b]) => a + Math.random() * (b - a);
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
// a soft round glow, drawn once and stamped under each head
const glowSprite = (rgb) => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb}, 1)`); gr.addColorStop(0.25, `rgba(${rgb}, .45)`); gr.addColorStop(0.6, `rgba(${rgb}, .1)`); gr.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
};

export default function CursorLight({ on = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!on || !cv || !finePointer()) return undefined;
    const ctx = cv.getContext('2d');
    const root = document.documentElement;
    const isLight = () => root.dataset.theme === 'light';
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, t = 0;
    let inside = false, seen = false, lastMove = 0, show = 0, rest = 0, tm = isLight() ? 1 : 0, avoidAt = -1, avoid = [];
    const ptr = { x: 0, y: 0 }, left = { x: 0, y: 0 };
    const LUT = 8;   // tail colour steps
    const pal = {};
    const paint = (k) => {
      const p = FX[k];
      pal[k] = { ...p, steps: Array.from({ length: LUT }, (_, i) => css(mix3(p.tailA, p.tailB, i / (LUT - 1)))), coreCss: css(p.core), hiCss: p.hi && css(p.hi), sprite: glowSprite(p.glow.join(', ')) };
    };
    paint('dark'); paint('light');
    const P = Array.from({ length: FX.count }, () => {
      const zeta = pick(FX.damping), k = pick(FX.stiff), a = Math.random() * 6.283;
      return {
        x: 0, y: 0, vx: 0, vy: 0, k, c: 2 * zeta * Math.sqrt(k),
        ox: Math.cos(a) * pick(FX.spread), oy: Math.sin(a) * pick(FX.spread),
        tm: pick(FX.tailMove), tr: pick(FX.tailRest), tl: pick(FX.tailMax), size: pick(FX.size), b: pick(FX.bright),
        // the firefly's own loop: radius that swells and shrinks, travel round, a wobble, and a light pulse
        R: pick(FX.restRadius), th: Math.random() * 6.283, w: pick(FX.restSpin) * (Math.random() < 0.5 ? -1 : 1),
        rw: 0.3 + Math.random() * 0.7, rp: Math.random() * 6.283, ex: 0.7 + Math.random() * 0.3,
        ww: 1.3 + Math.random() * 1.9, wa: 4 + Math.random() * 9, wp: Math.random() * 6.283,
        bw: pick(FX.breathe), bp: Math.random() * 6.283,
        hx: new Float32Array(FX.trail), hy: new Float32Array(FX.trail), ht: new Float32Array(FX.trail), hn: 0, hi: 0, hs: -1,
      };
    });
    const place = (x, y) => {   // start every particle at the pointer with no history
      for (const p of P) { p.x = x + p.ox * 0.4; p.y = y + p.oy * 0.4; p.vx = p.vy = 0; p.hn = 0; p.hs = -1; }
    };
    const fit = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const findAvoid = () => {
      avoid = [];
      for (const el of document.querySelectorAll(FX.avoid)) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
        // checkVisibility also knows a closed <details> (the season popover lives in one)
        if (el.checkVisibility ? !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : getComputedStyle(el).visibility === 'hidden') continue;
        if (+getComputedStyle(el).opacity < 0.05) continue;
        avoid.push(r);
      }
    };
    const xs = new Float32Array(FX.trail + 2), ys = new Float32Array(FX.trail + 2);
    // a particle's tail: its own path from the head back over `span` seconds, tapering
    const tail = (p, span, P2, a) => {
      const n = p.hn; if (!n) return 0;
      xs[0] = p.x; ys[0] = p.y;
      let m = 1, prevT = t;
      for (let j = 0; j < n; j++) {
        const i = (p.hi - 1 - j + FX.trail) % FX.trail;
        const age = t - p.ht[i];
        if (age > span) {   // stop exactly at the cut, part-way to this sample, so the length changes smoothly
          const f = Math.min(1, Math.max(0, (span - (t - prevT)) / Math.max(1e-4, prevT - p.ht[i])));
          xs[m] = lerp(xs[m - 1], p.hx[i], f); ys[m] = lerp(ys[m - 1], p.hy[i], f); m++;
          break;
        }
        xs[m] = p.hx[i]; ys[m] = p.hy[i]; m++; prevT = p.ht[i];
      }
      if (m < 2) return 0;
      let len = 0;
      for (let j = 1; j < m; j++) {   // and no longer than this particle's longest tail
        const d = Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
        if (len + d > p.tl) { const f = (p.tl - len) / d; xs[j] = lerp(xs[j - 1], xs[j], f); ys[j] = lerp(ys[j - 1], ys[j], f); m = j + 1; len = p.tl; break; }
        len += d;
      }
      if (len < 0.8) return 0;
      // a smooth curve through the samples (midpoint quadratics), drawn piece by piece so it can taper
      let run = 0, mx = xs[0], my = ys[0];
      for (let j = 1; j < m; j++) {
        const nx = j < m - 1 ? (xs[j] + xs[j + 1]) / 2 : xs[j], ny = j < m - 1 ? (ys[j] + ys[j + 1]) / 2 : ys[j];
        run += Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
        const u = Math.min(1, run / len);
        ctx.globalAlpha = a * Math.pow(1 - u * 0.96, 1.7);
        ctx.strokeStyle = P2.steps[Math.min(LUT - 1, (u * LUT) | 0)];
        ctx.lineWidth = Math.max(0.2, p.size * 0.95 * P2.tailW * (1 - u * 0.85));
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo(xs[j], ys[j], nx, ny); ctx.stroke();
        mx = nx; my = ny;
      }
      return len;
    };
    let maxTail = 0, drawn = 0, spread = 0;
    const draw = (k, weight) => {
      const P2 = pal[k];
      ctx.globalCompositeOperation = P2.blend;
      ctx.lineCap = 'round';
      for (const p of P) {
        const breath = lerp(1, 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * p.bw + p.bp)), rest);
        const a = show * weight * P2.alpha * p.b * breath;
        if (a < 0.01) continue;
        const len = tail(p, lerp(p.tm, p.tr, rest), P2, a);
        if (len > maxTail) maxTail = len;
        const gs = p.size * 7;
        ctx.globalAlpha = a * P2.glowA;
        ctx.drawImage(P2.sprite, p.x - gs, p.y - gs, gs * 2, gs * 2);
        ctx.globalAlpha = a;
        ctx.fillStyle = P2.coreCss;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.2832); ctx.fill();
        if (P2.hiCss) { ctx.fillStyle = P2.hiCss; ctx.globalAlpha = a * 0.85; ctx.beginPath(); ctx.arc(p.x - p.size * 0.32, p.y - p.size * 0.32, p.size * 0.38, 0, 6.2832); ctx.fill(); }
        drawn++;
      }
    };
    const frame = (now) => {
      raf = 0;
      // fades run on real time, so they finish on time even when frames drop; the springs take a capped step
      const rdt = Math.min(0.25, last ? (now - last) / 1000 : 1 / 60), dt = Math.min(1 / 30, rdt);
      last = now; t += dt;
      const still = (now - lastMove) / 1000 > FX.restAfter;
      rest += ((still ? 1 : 0) - rest) * (1 - Math.exp(-rdt / (still ? FX.restIn : FX.restOut) * 2.2));
      show += ((inside ? 1 : 0) - show) * (1 - Math.exp(-rdt * (inside ? FX.fadeIn : FX.fadeOut)));
      tm += ((isLight() ? 1 : 0) - tm) * (1 - Math.exp(-rdt * FX.themeRate));
      // move: each particle on its own spring towards its own point, which wanders on its own loop while resting
      spread = 0;
      for (const p of P) {
        const R = p.R * (0.72 + 0.4 * Math.sin(t * p.rw + p.rp));
        p.th += p.w * dt * (0.8 + 0.4 * Math.sin(t * 0.7 + p.rp));
        const rx = Math.cos(p.th) * R + Math.sin(t * p.ww + p.wp) * p.wa;
        const ry = Math.sin(p.th) * R * p.ex + Math.cos(t * p.ww * 0.83 + p.wp) * p.wa;
        const tx = ptr.x + lerp(p.ox, rx, rest), ty = ptr.y + lerp(p.oy, ry, rest);
        const k = p.k * lerp(1, FX.restStiff, rest), c = p.c * lerp(1, Math.sqrt(FX.restStiff), rest);
        // two half steps keep a stiff spring steady at a low frame rate
        for (let s = 0; s < 2; s++) {
          const hd = dt / 2;
          p.vx += (k * (tx - p.x) - c * p.vx) * hd; p.vy += (k * (ty - p.y) - c * p.vy) * hd;
          p.x += p.vx * hd; p.y += p.vy * hd;
        }
        if (p.hs < 0 || t - p.hs >= 1 / FX.sampleHz) {
          p.hx[p.hi] = p.x; p.hy[p.hi] = p.y; p.ht[p.hi] = t; p.hi = (p.hi + 1) % FX.trail; p.hn = Math.min(FX.trail, p.hn + 1); p.hs = t;
        }
        spread = Math.max(spread, Math.hypot(p.x - ptr.x, p.y - ptr.y));
      }
      if (now - avoidAt > 120) { avoidAt = now; findAvoid(); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      maxTail = 0; drawn = 0;
      if (show > 0.005) {
        ctx.save();
        if (avoid.length) {   // cut popups and tooltips out of the drawing
          ctx.beginPath(); ctx.rect(0, 0, w, h);
          for (const r of avoid) ctx.rect(r.left - 2, r.top - 2, r.width + 4, r.height + 4);
          ctx.clip('evenodd');
        }
        if (tm < 0.995) draw('dark', 1 - tm);
        if (tm > 0.005) draw('light', tm);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (inside || show > 0.005) raf = requestAnimationFrame(frame);
      else { last = 0; ctx.clearRect(0, 0, w, h); }
    };
    const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      // first sight, or back after the flock faded out, or back far from where it left: start at the pointer
      if (!seen || (!inside && (show < 0.05 || Math.hypot(ptr.x - left.x, ptr.y - left.y) > FX.rejoin))) place(ptr.x, ptr.y);
      seen = true; inside = true; lastMove = performance.now();
      kick();
    };
    const out = () => { if (inside) { inside = false; left.x = ptr.x; left.y = ptr.y; } kick(); };
    const leaveDoc = (e) => { if (!e.relatedTarget) out(); };
    const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; } else kick(); };
    const themeWatch = new MutationObserver(kick);   // a theme change eases the colour even while the flock rests
    fit();
    addEventListener('resize', fit);
    addEventListener('pointermove', move, { passive: true });
    document.addEventListener('mouseout', leaveDoc);
    addEventListener('blur', out);
    document.addEventListener('visibilitychange', vis);
    themeWatch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    window.__cursorLight = {   // read by the automated tests
      on: true, get running() { return !!raf; }, get count() { return P.length; }, get drawn() { return drawn; },
      get show() { return show; }, get rest() { return rest; }, get theme() { return tm; }, get maxTail() { return maxTail; }, get spread() { return spread; },
      get cut() { return avoid.length; }, get heads() { return P.slice(0, 6).map((p) => [Math.round(p.x), Math.round(p.y)]); },
    };
    return () => {
      removeEventListener('resize', fit); removeEventListener('pointermove', move); document.removeEventListener('mouseout', leaveDoc);
      removeEventListener('blur', out); document.removeEventListener('visibilitychange', vis); themeWatch.disconnect();
      cancelAnimationFrame(raf); raf = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      window.__cursorLight = { on: false, running: false };
    };
  }, [on]);
  return <canvas ref={ref} className="cursor-light" aria-hidden="true" />;
}
