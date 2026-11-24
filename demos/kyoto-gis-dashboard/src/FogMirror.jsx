import { useEffect, useRef } from 'react';
import GROUP4 from './lib/group4.js';

// The back of the closing card: a fogged mirror. The four closing panels behind the card are drawn sharp, then
// covered with a white breath of fog (the same picture, blurred and washed out, with grain and fine beads of
// condensation, its thicker patches drifting slowly). "Group 4" is then written into the fog by hand: a soft
// brush follows the pen strokes of the letters in writing order (made from the font by
// scripts/make_group4_strokes.py) and is clipped to the letters' outline, so the clear glass shows the panels
// through the letters, stroke by stroke, as a fingertip would leave it. A few drops gather at the bottom of the
// letters and run down. After a while the fog creeps back over the writing, and it is written again.
// Moving the mouse over the glass wipes it too; those wipes fog over again in a few seconds.
// It draws only while the back is showing and on screen. With reduced motion the writing is simply there.
// Cost: the canvas size is never read inside the frame (that forced a layout of the page every frame); the
// clear parts (letters, drips, wipes) are kept at half size and blurred once when they change; the haze is
// drawn on the small blur canvas; and when nothing moves on the glass it draws 30 times a second (the closing
// video behind it runs at about that).
const WRITE_MS = 4200;      // the pen's time on the glass for all of "Group 4" (lifts come on top)
const START_MS = 650;       // after the card has turned
const HOLD_MS = 14000;      // the writing stays this long
const REFOG_MS = 6000;      // then the fog takes it back over this long
const AGAIN_MS = 1400;      // and it is written again after this
const WIPE_FADE_MS = 2600;  // a mouse wipe's fog comes back with this time constant
const BRUSH = 1.3;          // brush radius as a share of the stroke's half-width (clipped to the letters anyway)

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ease = (u) => 0.6 * u + 0.4 * (1 - Math.cos(Math.PI * u)) / 2;   // a pen speeds up a little mid-stroke

function sprite() {   // a soft round brush
  const c = mk(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.62, 'rgba(0,0,0,.95)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c;
}

// draw a canvas (or a part of an image) the way object-fit: cover shows it in a box
function cover(g, src, sx, sy, sw, sh, x, y, w, h) {
  if (!sw || !sh || w <= 0 || h <= 0) return;
  const s = Math.max(w / sw, h / sh), cw = w / s, ch = h / s;
  g.drawImage(src, sx + (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, x, y, w, h);
}

export default function FogMirror({ active, panels, boxRef, reduce, poster }) {
  const cv = useRef(null);
  const st = useRef(null);       // everything the drawing loop keeps
  const activeRef = useRef(active); activeRef.current = active;

  useEffect(() => {
    const canvas = cv.current, box = boxRef.current;
    if (!canvas || !box) return undefined;
    const ctx = canvas.getContext('2d');
    const brush = sprite();
    const img = new Image(); img.src = poster;
    const S = st.current = { W: 0, H: 0, raf: 0, seen: true, wipes: 0, lastWipe: 0, wipeDecayAt: 0, last: null, cycleAt: 0, dataAt: 0, dirty: true, drawnAt: 0 };

    function layout() {
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const W = Math.round(canvas.offsetWidth * dpr), H = Math.round(canvas.offsetHeight * dpr);
      if (!W || !H || (W === S.W && H === S.H)) return;
      Object.assign(S, { W, H, dpr });
      canvas.width = W; canvas.height = H;
      S.small = mk(Math.max(8, Math.round(W / 14)), Math.max(6, Math.round(H / 14)));   // drawn small, stretched back: a cheap strong blur
      // the clear parts (mask) are kept at half size: they are soft anyway
      S.fog = mk(W, H); S.mask = mk(Math.ceil(W / 2), Math.ceil(H / 2)); S.maskBlur = mk(Math.ceil(W / 2), Math.ceil(H / 2)); S.ink = mk(W, H); S.pen = mk(W, H); S.drip = mk(W, H); S.wipe = mk(W, H);
      // grain and beads of condensation: fixed, so made once per size
      S.tex = mk(W, H);
      const t = S.tex.getContext('2d'), grain = mk(256, 256), gg = grain.getContext('2d'), id = gg.createImageData(256, 256);
      for (let i = 0; i < id.data.length; i += 4) { const v = 200 + Math.random() * 55; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = Math.random() * 60; }
      gg.putImageData(id, 0, 0);
      t.globalAlpha = 0.55; t.fillStyle = t.createPattern(grain, 'repeat'); t.fillRect(0, 0, W, H); t.globalAlpha = 1;
      for (let n = Math.round(W * H / 2400 / dpr); n > 0; n--) {
        const x = Math.random() * W, y = Math.random() * H, r = (Math.random() ** 2.4 * 2.4 + 0.5) * dpr;
        t.globalAlpha = 0.6; t.fillStyle = '#fff'; t.beginPath(); t.arc(x, y, r, 0, 7); t.fill();
        t.globalAlpha = 0.28; t.fillStyle = 'rgb(70,80,100)'; t.beginPath(); t.arc(x + r * 0.35, y + r * 0.4, r * 0.5, 0, 7); t.fill();
      }
      t.globalAlpha = 1;
      // the letters, fitted to the glass
      const [x0, y0, x1, y1] = GROUP4.box;
      const k = Math.min(W * 0.8 / (x1 - x0), H * 0.6 / (y1 - y0));
      const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k - H * 0.02;
      const ig = S.ink.getContext('2d'); ig.setTransform(k, 0, 0, k, ox, oy); ig.fillStyle = '#000'; ig.fill(new Path2D(GROUP4.path)); ig.setTransform(1, 0, 0, 1, 0, 0);
      // the pen strokes in canvas pixels, with their lengths, and when the pen is on each
      S.strokes = GROUP4.strokes.map((s) => {
        const pts = s.map(([x, y, r]) => [x * k + ox, y * k + oy, Math.max(1, r * k)]);
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        return { pts, cum, len: cum[cum.length - 1] };
      });
      const wsum = S.strokes.reduce((a, s) => a + s.len ** 0.85, 0);
      let t0 = 0, right = -1e9;
      S.strokes.forEach((s, i) => {
        if (i) {
          const p = S.strokes[i - 1].pts.at(-1), q = s.pts[0];
          const near = Math.hypot(q[0] - p[0], q[1] - p[1]) < p[2] * 4;
          t0 += q[0] - right > W * 0.06 ? 420 : near ? 50 : 170;   // a longer pause before the next word ("4")
        }
        s.t0 = t0; s.dur = WRITE_MS * s.len ** 0.85 / wsum; t0 += s.dur;
        right = Math.max(right, ...s.pts.map((q) => q[0]));
      });
      S.total = t0;
      S.drips = GROUP4.drips.map(([si, pi]) => ({ si, at: S.strokes[si]?.cum[pi] ?? 0, p: S.strokes[si]?.pts[pi] })).filter((d) => d.p);
      S.k = k;
      reset(performance.now());
    }

    function reset(now) {
      S.writeAt = now + (reduce ? -1e7 : START_MS);
      S.done = { si: 0, d: 0 };     // how far the brush has been laid down
      S.drops = []; S.dripped = new Set(); S.cycleAt = 0; S.dirty = true;
      if (S.pen) { S.pen.getContext('2d').clearRect(0, 0, S.W, S.H); S.drip.getContext('2d').clearRect(0, 0, S.W, S.H); }
    }

    // where the pen is at time t (ms into the writing): stroke index and distance along it
    function penAt(t) {
      const ss = S.strokes;
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        if (t < s.t0) return { si: i, d: 0, down: false };
        if (t < s.t0 + s.dur) return { si: i, d: ease((t - s.t0) / s.dur) * s.len, down: true };
      }
      return { si: ss.length, d: 0, down: false };
    }
    function pointAt(s, d) {
      let i = 1; while (i < s.cum.length - 1 && s.cum[i] < d) i++;
      const a = s.pts[i - 1], b = s.pts[i], seg = s.cum[i] - s.cum[i - 1] || 1, u = Math.min(1, Math.max(0, (d - s.cum[i - 1]) / seg));
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    // lay the brush along stroke si from distance d0 to d1
    function stamp(g, s, d0, d1) {
      for (let d = d0; d <= d1; ) {
        const [x, y, r] = pointAt(s, d), R = r * BRUSH;
        g.drawImage(brush, x - R, y - R, R * 2, R * 2);
        d += Math.max(0.8, r * 0.3);
      }
    }
    function writeUpTo(pen) {
      const g = S.pen.getContext('2d');
      while (S.done.si < S.strokes.length && (S.done.si < pen.si || (S.done.si === pen.si && S.done.d < pen.d))) {
        const s = S.strokes[S.done.si], to = S.done.si < pen.si ? s.len : pen.d;
        stamp(g, s, S.done.d, to);
        if (S.done.si < pen.si) S.done = { si: S.done.si + 1, d: 0 }; else S.done.d = to + 0.01;
      }
      // drops gather where the pen has been at the bottom of a letter
      S.drips.forEach((dp, n) => {
        if (S.dripped.has(n) || reduce) return;
        if (pen.si > dp.si || (pen.si === dp.si && pen.d >= dp.at)) {
          S.dripped.add(n);
          const [x, y, r] = dp.p;
          S.drops.push({ x: x + (Math.random() - 0.5) * r, y: y + r * 0.6, v: 0, r: Math.max(1.8 * S.dpr, r * 0.55), stop: y + S.H * (0.12 + Math.random() * 0.2), trail: [] , wait: 300 + n * 500 });
        }
      });
    }

    function sharp(g, w, h) {
      g.fillStyle = '#0b1022'; g.fillRect(0, 0, w, h);
      const cr = box.getBoundingClientRect(); if (!cr.width || !cr.height) return;
      const sx = w / cr.width, sy = h / cr.height;
      const list = (panels.current || []).filter(Boolean).map((c, i) => ({ c, i, op: c.parentElement.getBoundingClientRect(), r: c.getBoundingClientRect() }));
      let over = 0;
      list.forEach(({ op }) => { over += Math.max(0, Math.min(op.right, cr.right) - Math.max(op.left, cr.left)) * Math.max(0, Math.min(op.bottom, cr.bottom) - Math.max(op.top, cr.top)); });
      const src = ({ c, i }) => (c.width ? [c, 0, 0, c.width, c.height] : img.complete && img.naturalWidth ? [img, img.naturalWidth / 4 * i, 0, img.naturalWidth / 4, img.naturalHeight] : null);
      if (over > 0.3 * cr.width * cr.height) {   // the card is over the panels: show what is behind it
        list.forEach((p) => {
          const s = src(p); if (!s) return;
          g.save(); g.beginPath(); g.rect((p.op.left - cr.left) * sx, (p.op.top - cr.top) * sy, p.op.width * sx, p.op.height * sy); g.clip();
          cover(g, ...s, (p.r.left - cr.left) * sx, (p.r.top - cr.top) * sy, p.r.width * sx, p.r.height * sy);
          g.restore();
        });
      } else {   // on a phone the card sits under the panels: it reflects all four side by side
        list.forEach((p, n) => { const s = src(p); if (s) cover(g, ...s, n * w / list.length, 0, w / list.length, h); });
      }
    }

    function frame(now) {
      S.raf = 0;
      if (!activeRef.current || !S.seen) return;
      // the size is kept by the ResizeObserver; reading it here every frame would force a layout of the page
      if (!S.W) layout();
      if (!S.W) { S.raf = requestAnimationFrame(frame); return; }
      const { W, H } = S;
      const t = now - S.writeAt;
      // what changes this frame: the pen writing (and the letters filling in after it), drops running, a wipe
      // fogging over. With none of these, 30 frames a second are enough.
      const busy = (t >= -100 && t < S.total + 600) || S.drops.some((d) => d.y < d.stop) || now - S.lastWipe < WIPE_FADE_MS * 3.2;
      if (!busy && now - S.drawnAt < 31) { S.raf = requestAnimationFrame(frame); return; }
      S.drawnAt = now;
      const pen = t >= 0 ? penAt(t) : { si: 0, d: 0, down: false };
      if (t >= 0 && t < S.total + 600) { writeUpTo(pen); S.dirty = true; }
      const written = t >= S.total;
      // the cycle: written, held, fogged over, written again
      let refog = 0;
      if (written && !reduce) {
        const since = t - S.total - HOLD_MS;
        refog = Math.min(1, Math.max(0, since / REFOG_MS));
        if (since > REFOG_MS + AGAIN_MS) { reset(now); S.wipe.getContext('2d').clearRect(0, 0, W, H); }
      }
      // drops run down, leaving a clear trail
      const dg = S.drip.getContext('2d'); dg.lineCap = 'round'; dg.strokeStyle = 'rgba(0,0,0,.85)';
      S.drops.forEach((d) => {
        if (d.wait > 0) { d.wait -= 16; return; }
        if (d.y < d.stop) {
          S.dirty = true;
          d.v = Math.min(d.v + 0.0009 * S.dpr, 0.07 * S.dpr) * (d.y > d.stop - 6 * S.dpr ? 0.92 : 1);
          const ny = d.y + d.v * 16 + (Math.random() < 0.03 ? 1.6 * S.dpr : 0), nx = d.x + (Math.random() - 0.5) * 0.3 * S.dpr;
          dg.lineWidth = d.r * 1.25; dg.beginPath(); dg.moveTo(d.x, d.y); dg.lineTo(nx, ny); dg.stroke();
          d.x = nx; d.y = ny;
        }
      });
      // mouse wipes slowly fog over again
      if (now - S.wipeDecayAt > 120) {
        const wg = S.wipe.getContext('2d');
        if (now - S.lastWipe > WIPE_FADE_MS * 3.2) { if (S.wipeLeft) { wg.clearRect(0, 0, W, H); S.wipeLeft = false; S.dirty = true; } }
        else { wg.globalCompositeOperation = 'destination-out'; wg.fillStyle = `rgba(0,0,0,${1 - Math.exp(-(now - S.wipeDecayAt) / WIPE_FADE_MS)})`; wg.fillRect(0, 0, W, H); wg.globalCompositeOperation = 'source-over'; S.wipeLeft = true; S.dirty = true; }
        S.wipeDecayAt = now;
      }
      // what is clear: the brush inside the letters (and, once written, all of the letters), drip trails, wipes
      if (S.dirty) {
        S.dirty = false;
        const m = S.mask.getContext('2d'), mw = S.mask.width, mh = S.mask.height;
        m.clearRect(0, 0, mw, mh);
        m.drawImage(S.pen, 0, 0, mw, mh);
        if (written) { m.globalAlpha = Math.min(1, (t - S.total) / 500); m.drawImage(S.ink, 0, 0, mw, mh); m.globalAlpha = 1; }
        m.globalCompositeOperation = 'destination-in'; m.drawImage(S.ink, 0, 0, mw, mh);
        m.globalCompositeOperation = 'source-over';
        m.drawImage(S.drip, 0, 0, mw, mh);
        m.drawImage(S.wipe, 0, 0, mw, mh);
        // softened once here, not every frame
        const mb = S.maskBlur.getContext('2d');
        mb.clearRect(0, 0, mw, mh); mb.filter = `blur(${0.6 * S.dpr}px)`; mb.drawImage(S.mask, 0, 0); mb.filter = 'none';
      }
      // the picture: sharp behind, fog over it with the clear parts cut out
      sharp(ctx, W, H);
      // the fog: the picture drawn small (a cheap strong blur) with the white breath and its slowly drifting
      // thicker patches on it, all at that small size, then stretched over the glass with the grain and beads
      const sm = S.small.getContext('2d'), sw = S.small.width, sh = S.small.height;
      sm.drawImage(canvas, 0, 0, sw, sh);   // the sharp picture just drawn, shrunk (one source, no layout reads)
      sm.fillStyle = 'rgba(226, 233, 242, .58)'; sm.fillRect(0, 0, sw, sh);
      const drift = reduce ? 0 : now;
      for (let n = 0; n < 4; n++) {
        const a = drift / 9000 + n * 1.7, x = sw * (0.5 + 0.45 * Math.sin(a * (1 + n * 0.13))), y = sh * (0.5 + 0.4 * Math.cos(a * 0.8 + n));
        const rg = sm.createRadialGradient(x, y, 0, x, y, sw * 0.38);
        rg.addColorStop(0, 'rgba(244, 247, 251, .34)'); rg.addColorStop(1, 'rgba(244, 247, 251, 0)');
        sm.fillStyle = rg; sm.fillRect(0, 0, sw, sh);
      }
      const f = S.fog.getContext('2d');
      f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1; f.imageSmoothingQuality = 'high';
      f.drawImage(S.small, 0, 0, W, H);
      f.drawImage(S.tex, 0, 0);
      f.globalCompositeOperation = 'destination-out'; f.globalAlpha = 0.94 * (1 - refog); f.drawImage(S.maskBlur, 0, 0, W, H);
      f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1;
      ctx.drawImage(S.fog, 0, 0);
      // a faint wet rim along what was cleared
      ctx.globalAlpha = 0.16 * (1 - refog); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(S.maskBlur, -S.dpr, -1.5 * S.dpr, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      // the fingertip: a soft wet gleam where the pen is
      if (pen.down && !reduce) {
        const [x, y, r] = pointAt(S.strokes[pen.si], pen.d), R = r * 2.2 + 6 * S.dpr;
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.45, 'rgba(235,242,250,.22)'); g.addColorStop(1, 'rgba(235,242,250,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      }
      // the drops
      S.drops.forEach((d) => {
        if (d.wait > 0) return;
        const a = 1 - refog, g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.4, 0, d.x, d.y, d.r * 1.4);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(0.5, `rgba(220,230,245,${0.5 * a})`); g.addColorStop(1, `rgba(40,50,70,${0.25 * a})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 1.25, 0, 0, 7); ctx.fill();
      });
      // for the tests: how far the writing is, and what the glass is doing
      if (now - S.dataAt > 100) {
        S.dataAt = now;
        const ds = canvas.dataset;
        ds.pen = (t < 0 ? 0 : Math.min(1, t / S.total)).toFixed(2);
        ds.phase = t < 0 ? 'wait' : !written ? 'writing' : refog > 0 ? 'refog' : 'written';
        ds.wipes = String(S.wipes);
      }
      S.raf = requestAnimationFrame(frame);
    }
    S.frame = frame;

    // mouse wipes (a mouse or a pen only: on a touch screen a finger scrolls the page)
    const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * S.W, (e.clientY - r.top) / r.height * S.H]; };
    const move = (e) => {
      if (e.pointerType === 'touch' || !activeRef.current || !S.W) return;
      const [x, y] = toCanvas(e), R = 17 * S.dpr, wg = S.wipe.getContext('2d');
      const [px, py] = S.last || [x, y];
      const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / (R * 0.35)));
      for (let i = 1; i <= n; i++) { const u = i / n; wg.drawImage(brush, px + (x - px) * u - R, py + (y - py) * u - R, R * 2, R * 2); }
      S.last = [x, y]; S.wipes++; S.lastWipe = performance.now(); S.dirty = true;
    };
    const leave = () => { S.last = null; };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
    const ro = new ResizeObserver(() => layout()); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { S.seen = e.isIntersecting; if (S.seen && activeRef.current && !S.raf) S.raf = requestAnimationFrame(frame); });
    io.observe(canvas);
    return () => { cancelAnimationFrame(S.raf); ro.disconnect(); io.disconnect(); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // turned to the back: fresh fog, written again; turned away: the drawing stops
  useEffect(() => {
    const S = st.current; if (!S) return;
    if (active) {
      if (S.W) {
        const now = performance.now();
        S.writeAt = now + (reduce ? -1e7 : START_MS); S.done = { si: 0, d: 0 }; S.drops = []; S.dripped = new Set();
        S.pen.getContext('2d').clearRect(0, 0, S.W, S.H); S.drip.getContext('2d').clearRect(0, 0, S.W, S.H); S.wipe.getContext('2d').clearRect(0, 0, S.W, S.H); S.dirty = true;
      } else S.W = 0;
      if (!S.raf) S.raf = requestAnimationFrame(S.frame);
    } else if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={cv} className="fm-glass" aria-hidden="true" />;
}
