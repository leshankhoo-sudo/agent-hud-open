import { useEffect, useRef } from 'react';

// Pointer light: "firefly meteors", matched frame by frame to the reference recordings.
// A flock of small particles follows the pointer. Each is its own body: a bright round head with a small soft
// glow, and a hair-thin tail drawn along that particle's own recent path. Measured in the recordings:
// - the tail is very thin (about a pixel) and long, brightest for a short stretch behind the head, then a long
//   faint run that fades out; its colour shifts along its length (a little gradient), from the head's white
//   into the scene's tint;
// - strands are irregular: lengths and brightness differ a lot, each runs at a slightly different angle, with
//   small kinks and wobbles, and now and then one crosses its neighbours;
// - colours, per theme, are the recordings' own: on the dark theme ("深空黑") warm-white heads, tails going
//   peach → rose → maroon, a few warmer red ones, added as light; on the light theme ("月光白") charcoal heads,
//   tails going to warm grey, a few with the rust-red accent, painted.
// Moving: each particle is pulled to a point near the pointer by its own spring, some looser, some stiffer,
// so the flock trails with inertia; a fast hand stretches the tails, a slow one draws them in. Resting: the
// long tails fade and the flock stays round the pointer like fireflies, each on its own slow loops, drifting
// apart and back, its light breathing on its own beat, with a short curved tail. Leaving the page fades them
// out; coming back starts them at the pointer, so no line is drawn from where they were.
// A theme change fades the colours across without touching the motion. One fixed canvas over the page that
// takes no pointer events; popups and tooltips are cut out of what it draws. Paused while the page is hidden;
// not started on touch-only devices; off by default with "reduce motion". The small toggle (CursorFxToggle)
// turns it off and on and is remembered.

// ---- all tuning in one place --------------------------------------------------------------------------
export const FX = {
  count: 72,                    // particles
  trail: 48,                    // most path samples kept per particle
  sampleHz: 80,                 // path samples per second (independent of the display's refresh rate)
  stiff: [120, 3000],           // spring stiffness while the pointer moves (per particle, spread evenly on a log scale):
                                // the loose ones lag behind, so the heads are strung out along the path, not bunched at the pointer
  damping: [0.55, 0.95],        // damping ratio while moving (the looser ones overshoot a little)
  spread: [5, 52],              // px, how far from the pointer each particle aims while moving
  tailMove: [0.1, 0.2],         // s of path drawn as tail while moving (a fast hand makes it long in px)
  tailRest: [0.45, 0.85],       // s of path drawn while resting (short arcs)
  tailMax: [100, 210],          // px, the longest a tail gets however fast the hand (per particle)
  width: [0.35, 0.9],           // px, tail width just behind the head (per particle); it thins to a quarter
  size: [0.8, 1.45],            // px, head radius
  bright: [0.45, 1],            // brightness (per particle)
  jitter: [0.2, 1.2],           // px, sideways wobble of a moving strand
  jitterHz: [4, 12],            // its rate
  kick: 0.5,                    // small sideways knocks per particle per second while moving (kinks, crossings)
  kickV: [30, 90],              // px/s
  bands: 9,                     // a tail is drawn in this many pieces, each thinner, dimmer and further along the gradient
  restAfter: 0.22,              // s without movement before the flock starts to rest
  restIn: 0.9, restOut: 0.16,   // s to ease into rest, and back to moving
  restRadius: [16, 78],         // px, each firefly's distance from the pointer while resting
  restSpin: [0.35, 1.25],       // rad/s each firefly travels round (either way)
  restK: [45, 95],              // spring stiffness while resting (soft, so the loops are smooth)
  breathe: [1.1, 3.2],          // rad/s, each firefly's own light pulse while resting
  fadeIn: 9, fadeOut: 2.6,      // rates for the whole flock appearing / leaving the page
  themeRate: 5,                 // rate of the colour change when the theme switches
  rejoin: 160,                  // px: coming back further than this from where it left restarts the flock at the pointer
  // colours sampled from the recordings (head first, tail end last)
  dark: {
    blend: 'lighter', alpha: 1, core: [255, 250, 244], glow: [255, 226, 212], glowA: 0.5, glowR: 4.5, bloom: 0.13,
    stops: [[255, 248, 242], [255, 228, 218], [255, 208, 198], [246, 186, 200], [228, 166, 198]],
    warm: { share: 0.2, stops: [[255, 238, 228], [255, 200, 180], [248, 164, 150], [230, 134, 134], [204, 112, 124]] },
  },
  light: {
    blend: 'source-over', alpha: 0.92, core: [34, 31, 33], glow: [60, 54, 54], glowA: 0.14, glowR: 3.2, bloom: 0,
    stops: [[34, 31, 33], [56, 51, 52], [86, 80, 80], [120, 112, 112], [152, 144, 144]],
    warm: { share: 0.16, stops: [[40, 32, 30], [112, 58, 44], [170, 84, 60], [190, 120, 100], [200, 160, 148]] },
  },
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
const css = (c) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
const LUT = 16;   // colour steps along a tail
// a multi-stop gradient, as LUT css colours
const ramp = (stops) => Array.from({ length: LUT }, (_, i) => {
  const u = (i / (LUT - 1)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(u)), f = u - k;
  return css([0, 1, 2].map((c) => lerp(stops[k][c], stops[k + 1][c], f)));
});
// brightness along a tail (0 = head): a short bright stretch, then a long faint run
const fall = (u) => Math.pow(1 - u, 2.2) * 0.85 + 0.15 * (1 - u);
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
    const pal = {};
    for (const k of ['dark', 'light']) {
      const p = FX[k];
      pal[k] = { ...p, main: ramp(p.stops), warmRamp: ramp(p.warm.stops), coreCss: css(p.core), sprite: glowSprite(p.glow.join(', ')) };
    }
    const P = Array.from({ length: FX.count }, () => {
      const zeta = pick(FX.damping), k = Math.exp(pick(FX.stiff.map(Math.log))), a = Math.random() * 6.283;
      return {
        x: 0, y: 0, vx: 0, vy: 0, k, c: 2 * zeta * Math.sqrt(k), dx: 0, dy: 0,   // dx, dy: where it is drawn (with its wobble)
        ox: Math.cos(a) * pick(FX.spread), oy: Math.sin(a) * pick(FX.spread),
        kr: pick(FX.restK), tm: pick(FX.tailMove), tr: pick(FX.tailRest), tl: pick(FX.tailMax), wd: pick(FX.width), size: pick(FX.size), b: pick(FX.bright), r: Math.random(),
        // its own sideways wobble while moving (two rates, so it never repeats evenly)
        ja: pick(FX.jitter), jf1: pick(FX.jitterHz) * 6.283, jf2: pick(FX.jitterHz) * 6.283 * 1.7, jp1: Math.random() * 6.283, jp2: Math.random() * 6.283,
        // the firefly's own loop: radius that swells and shrinks, travel round, a wobble, and a light pulse
        R: pick(FX.restRadius), th: Math.random() * 6.283, w: pick(FX.restSpin) * (Math.random() < 0.5 ? -1 : 1),
        rw: 0.3 + Math.random() * 0.7, rp: Math.random() * 6.283, ex: 0.7 + Math.random() * 0.3,
        ww: 1.3 + Math.random() * 1.9, wa: 4 + Math.random() * 9, wp: Math.random() * 6.283,
        bw: pick(FX.breathe), bp: Math.random() * 6.283,
        hx: new Float32Array(FX.trail), hy: new Float32Array(FX.trail), ht: new Float32Array(FX.trail), hn: 0, hi: 0, hs: -1,
      };
    });
    const place = (x, y) => {   // start every particle at the pointer with no history
      for (const p of P) { p.x = p.dx = x + p.ox * 0.4; p.y = p.dy = y + p.oy * 0.4; p.vx = p.vy = 0; p.hn = 0; p.hs = -1; }
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
    const xs = new Float32Array(FX.trail + 2), ys = new Float32Array(FX.trail + 2), cum = new Float32Array(FX.trail + 2);
    // a particle's tail: its own path from the head back over `span` seconds, in bands that thin, dim and
    // move along the colour gradient
    const tail = (p, span, cols, a, bloom) => {
      const n = p.hn; if (!n) return 0;
      xs[0] = p.dx; ys[0] = p.dy;
      let m = 1, prevT = t;
      for (let j = 0; j < n; j++) {
        const i = (p.hi - 1 - j + FX.trail) % FX.trail;
        if (t - p.ht[i] > span) {   // stop exactly at the cut, part-way to this sample, so the length changes smoothly
          const f = Math.min(1, Math.max(0, (span - (t - prevT)) / Math.max(1e-4, prevT - p.ht[i])));
          xs[m] = lerp(xs[m - 1], p.hx[i], f); ys[m] = lerp(ys[m - 1], p.hy[i], f); m++;
          break;
        }
        xs[m] = p.hx[i]; ys[m] = p.hy[i]; m++; prevT = p.ht[i];
      }
      if (m < 2) return 0;
      cum[0] = 0;
      for (let j = 1; j < m; j++) {   // and no longer than this particle's longest tail
        const d = Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
        if (cum[j - 1] + d > p.tl) { const f = (p.tl - cum[j - 1]) / d; xs[j] = lerp(xs[j - 1], xs[j], f); ys[j] = lerp(ys[j - 1], ys[j], f); cum[j] = p.tl; m = j + 1; break; }
        cum[j] = cum[j - 1] + d;
      }
      const len = cum[m - 1];
      if (len < 0.8) return 0;
      const B = FX.bands;
      let j = 1;
      for (let b = 0; b < B; b++) {
        const d0 = (b / B) * len, d1 = ((b + 1) / B) * len, um = (b + 0.5) / B;
        while (j < m - 1 && cum[j] < d0) j++;
        let f = (d0 - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
        ctx.beginPath(); ctx.moveTo(lerp(xs[j - 1], xs[j], f), lerp(ys[j - 1], ys[j], f));
        let q = j;
        while (q < m - 1 && cum[q] < d1) { ctx.lineTo(xs[q], ys[q]); q++; }
        f = Math.min(1, (d1 - cum[q - 1]) / Math.max(1e-6, cum[q] - cum[q - 1]));
        ctx.lineTo(lerp(xs[q - 1], xs[q], f), lerp(ys[q - 1], ys[q], f));
        ctx.strokeStyle = cols[Math.min(LUT - 1, (um * LUT) | 0)];
        if (bloom && b < 3) {   // a faint haze round the bright stretch behind the head
          ctx.globalAlpha = a * fall(um) * bloom; ctx.lineWidth = p.wd * 5 * (1 - 0.6 * um); ctx.stroke();
        }
        ctx.globalAlpha = a * fall(um);
        ctx.lineWidth = Math.max(0.18, p.wd * (1 - 0.75 * um));
        ctx.stroke();
      }
      return len;
    };
    let maxTail = 0, drawn = 0, spread = 0;
    const draw = (k, weight) => {
      const P2 = pal[k];
      ctx.globalCompositeOperation = P2.blend;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      for (const p of P) {
        const breath = lerp(1, 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * p.bw + p.bp)), rest);
        const a = show * weight * P2.alpha * p.b * breath;
        if (a < 0.01) continue;
        const len = tail(p, lerp(p.tm, p.tr, rest), p.r < P2.warm.share ? P2.warmRamp : P2.main, a, P2.bloom);
        if (len > maxTail) maxTail = len;
        const gs = p.size * P2.glowR;
        ctx.globalAlpha = a * P2.glowA;
        ctx.drawImage(P2.sprite, p.dx - gs, p.dy - gs, gs * 2, gs * 2);
        ctx.globalAlpha = a;
        ctx.fillStyle = P2.coreCss;
        ctx.beginPath(); ctx.arc(p.dx, p.dy, p.size, 0, 6.2832); ctx.fill();
        drawn++;
      }
    };
    const frame = (now) => {
      raf = 0;
      // fades run on real time, so they finish on time even when frames drop; the springs take a capped step
      const rdt = Math.max(0, Math.min(0.25, last ? (now - last) / 1000 : 1 / 60)), dt = Math.min(1 / 15, rdt);
      const subs = Math.max(2, Math.ceil(dt * 120));   // springs advance in steps of 1/120 s or less, so a slow machine is not slow motion
      last = now; t += dt;
      const still = (now - lastMove) / 1000 > FX.restAfter;
      rest += ((still ? 1 : 0) - rest) * (1 - Math.exp(-rdt / (still ? FX.restIn : FX.restOut) * 2.2));
      show += ((inside ? 1 : 0) - show) * (1 - Math.exp(-rdt * (inside ? FX.fadeIn : FX.fadeOut)));
      tm += ((isLight() ? 1 : 0) - tm) * (1 - Math.exp(-rdt * FX.themeRate));
      // move: each particle on its own spring towards its own point, which wanders on its own loop while resting
      spread = 0;
      const moving = 1 - rest;
      for (const p of P) {
        const R = p.R * (0.72 + 0.4 * Math.sin(t * p.rw + p.rp));
        p.th += p.w * dt * (0.8 + 0.4 * Math.sin(t * 0.7 + p.rp));
        const rx = Math.cos(p.th) * R + Math.sin(t * p.ww + p.wp) * p.wa;
        const ry = Math.sin(p.th) * R * p.ex + Math.cos(t * p.ww * 0.83 + p.wp) * p.wa;
        const tx = ptr.x + lerp(p.ox, rx, rest), ty = ptr.y + lerp(p.oy, ry, rest);
        const k = lerp(p.k, p.kr, rest), c = lerp(p.c, 2 * 0.7 * Math.sqrt(p.kr), rest);
        // now and then a small sideways knock: a kink in the strand, sometimes a crossing
        const sp = Math.hypot(p.vx, p.vy);
        if (moving > 0.5 && sp > 60 && Math.random() < FX.kick * dt) {
          const kv = pick(FX.kickV) * (Math.random() < 0.5 ? -1 : 1);
          const nx = -p.vy / sp, ny = p.vx / sp;
          p.vx += nx * kv; p.vy += ny * kv;
        }
        for (let s = 0; s < subs; s++) {
          const hd = dt / subs;
          p.vx += (k * (tx - p.x) - c * p.vx) * hd; p.vy += (k * (ty - p.y) - c * p.vy) * hd;
          p.x += p.vx * hd; p.y += p.vy * hd;
        }
        // drawn with a fine sideways wobble while it travels, so no strand is a clean line
        const v = Math.hypot(p.vx, p.vy), along = Math.min(1, v / 300) * moving;
        const o = p.ja * along * (0.7 * Math.sin(t * p.jf1 + p.jp1) + 0.3 * Math.sin(t * p.jf2 + p.jp2));
        p.dx = p.x + (v > 1e-3 ? (-p.vy / v) * o : 0); p.dy = p.y + (v > 1e-3 ? (p.vx / v) * o : 0);
        if (p.hs < 0 || t - p.hs >= 1 / FX.sampleHz) {
          p.hx[p.hi] = p.dx; p.hy[p.hi] = p.dy; p.ht[p.hi] = t; p.hi = (p.hi + 1) % FX.trail; p.hn = Math.min(FX.trail, p.hn + 1); p.hs = t;
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
