import { useEffect, useRef, useState } from 'react';
import { buildTeaCache, drawTeaRoom, hitTea, chapterOf } from './lib/teaScene.js';
import { createFoley } from './lib/foley.js';

// Background music as a small glass window onto a tea room: 紅葉の小さな奇跡, a little story that
// the volume plays (lib/teaScene.js). The glass lens is the volume; pressing it plays or pauses.
// Moving it moves the story forwards and backwards (story = volume), while the music keeps its own
// place. The music itself colours the room through a few smoothed bands (low, mid, high and
// transients), and every action of the story has a small synthesised sound (lib/foley.js) on its
// own channel, which follows the volume and is silent at 0.
//
// Audio: off until the visitor plays it; the file is only downloaded then. It loops inside the
// decoded buffer between two sample-exact points, so there is no gap at the loop.
// Keyboard and screen readers: a real button (play / pause) and a real range input (volume).
// Interaction idea after a reference clip of a capsule volume slider with a lens; the scene,
// drawing, sounds and behaviour here are this project's own.

const VOL_KEY = 'kyoto-gis-music-volume';
const savedVolume = () => { try { const v = parseFloat(localStorage.getItem(VOL_KEY)); return v >= 0 && v <= 1 ? v : 0.5; } catch { return 0.5; } };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// stage geometry, in CSS pixels at its normal size (it is shown larger when opened)
const CW = 280, CH = 108;
const PX = 8, PY = 8, PW = 264, PH = 88;          // the capsule
const WX = 13, WY = 13, WW = 254, WH = 78;         // the window in it
const KW = 56, KH = 98, KY = PY + PH / 2;          // the glass lens
const K0 = WX + 26, K1 = WX + WW - 26;             // travel of the lens's centre
const MAG = 1.3;                                   // how much the lens magnifies
const OPEN = 1.3;                                  // how much larger the control is when opened

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export default function MusicPlayer() {
  const au = useRef(null); // { ctx, gain, sfx, src, an, td, fd, foley }
  const box = useRef(null), stage = useRef(null), cv = useRef(null);
  const [state, setState] = useState('idle'); // idle | loading | playing | paused | error
  const [vol, setVol] = useState(savedVolume);
  const live = useRef({ state: 'idle', vol, volAt: 0 });
  live.current.state = state;
  if (live.current.vol !== vol) { live.current.vol = vol; live.current.volAt = performance.now(); }
  const base = import.meta.env.BASE_URL;
  const kick = useRef(() => {});

  useEffect(() => () => { au.current?.foley?.stop(); au.current?.ctx.close(); }, []);
  useEffect(() => {
    const a = au.current;
    // perceived loudness is closer to the square of the slider position; changes are smoothed (no clicks)
    if (a) {
      a.gain.gain.setTargetAtTime(vol * vol, a.ctx.currentTime, 0.05);
      a.sfx.gain.setTargetAtTime(vol > 0.005 ? 0.35 + 0.45 * vol : 0, a.ctx.currentTime, 0.05);
    }
    try { localStorage.setItem(VOL_KEY, String(vol)); } catch { /* storage blocked */ }
    kick.current();
  }, [vol]);
  useEffect(() => { kick.current(); }, [state]);

  const start = async () => {
    try {
      setState('loading');
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const [meta, bytes] = await Promise.all([
        fetch(`${base}data/music.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        fetch(`${base}media/kyoto-slowly.mp3`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
      ]);
      const buf = await ctx.decodeAudioData(bytes);
      const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
      const sfx = ctx.createGain(); sfx.gain.value = 0; sfx.connect(ctx.destination); // the story's sounds, on their own channel
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.loopStart = meta.loop_start; src.loopEnd = Math.min(meta.loop_end, buf.duration);
      src.connect(gain);
      // a tap for the scene: the music before the volume is applied, so the room answers the music, not the slider
      const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.6; src.connect(an);
      src.start(0, meta.loop_start);
      const v = live.current.vol;
      gain.gain.setTargetAtTime(v * v, ctx.currentTime, 0.6); // fade in
      sfx.gain.setTargetAtTime(v > 0.005 ? 0.35 + 0.45 * v : 0, ctx.currentTime, 0.3);
      au.current = { ctx, gain, sfx, src, an, td: new Uint8Array(an.fftSize), fd: new Uint8Array(an.frequencyBinCount), foley: createFoley(ctx, sfx) };
      box.current.__foley = au.current.foley; // for tests: the sounds it has played
      if (ctx.state === 'suspended') await ctx.resume();
      setState('playing');
    } catch (e) {
      console.warn('Music could not be played:', e);
      setState('error');
    }
  };
  const play = async () => {
    const s = live.current.state, a = au.current;
    if (s === 'playing' || s === 'loading') return;
    if (live.current.vol < 0.04) setVol(0.5); // pressing play on a silent slider should be heard
    if (s === 'paused' && a) { await a.ctx.resume(); setState('playing'); return; }
    await start();
  };
  const toggle = async () => {
    const s = live.current.state;
    if (s === 'playing') { await au.current.ctx.suspend(); setState('paused'); return; }
    if (s === 'error') { setState('idle'); return; }
    await play();
  };
  const act = useRef({});
  act.current = { play, toggle, setVol };

  // ---- drawing, audio features and pointer handling ----
  useEffect(() => {
    const st = stage.current, c = cv.current, root = box.current;
    const g = c.getContext('2d');
    const sc = document.createElement('canvas'), sg = sc.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const S = {
      kx: K0 + (K1 - K0) * live.current.vol, kv: 0, stretch: 0, press: 0, over: 0, overSide: 0,
      p: live.current.vol, pv: 0, speed: 0, catUp: 0, px: 0, hover: false, overKnob: false, drag: null, raf: 0, last: 0, t: 0, dpr: 1, skip: false, mouseX: null,
      band: { low: 0, mid: 0, high: 0, rms: 0, base: 0, trans: 0 }, nextFeat: 0, pokes: {}, cache: null,
    };
    root.__band = S.band; // for tests: the smoothed music features
    const size = () => {
      S.dpr = Math.min(devicePixelRatio || 1, 2.5);
      c.width = Math.round(CW * S.dpr * OPEN); c.height = Math.round(CH * S.dpr * OPEN);
      S.res = S.dpr * MAG * OPEN; sc.width = Math.round(WW * S.res); sc.height = Math.round(WH * S.res);
      S.cache = buildTeaCache(S.res); // the still parts of the room, painted once per size
    };
    size();
    // smoothed features of the music, read about 30 times a second while it plays
    const features = (now, dt) => {
      const a = au.current, B = S.band;
      const on = a && live.current.state === 'playing';
      if (!on) { for (const k of ['low', 'mid', 'high', 'rms', 'trans']) B[k] *= Math.exp(-dt * 4); return; }
      if (now < S.nextFeat) { B.trans *= Math.exp(-dt * 5); return; }
      S.nextFeat = now + 33;
      a.an.getByteFrequencyData(a.fd); a.an.getByteTimeDomainData(a.td);
      const hz = a.ctx.sampleRate / a.an.fftSize;
      const band = (f0, f1) => { const i0 = Math.max(1, Math.floor(f0 / hz)), i1 = Math.min(a.fd.length - 1, Math.ceil(f1 / hz)); let s = 0; for (let i = i0; i <= i1; i++) s += a.fd[i]; return s / ((i1 - i0 + 1) * 255); };
      let sum = 0; for (let i = 0; i < a.td.length; i += 2) { const v = (a.td[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / (a.td.length / 2));
      B.raw = [band(30, 250), band(250, 2000), band(2000, 8000), rms].map((x) => +x.toFixed(3));
      const follow = (k, v, up, down) => { B[k] += (v - B[k]) * (v > B[k] ? up : down); };
      // ranges measured on this piece (byte levels are in decibels): quiet passages near 0, the fullest near 1
      follow('low', clamp((band(30, 250) - 0.58) / 0.26), 0.35, 0.08);
      follow('mid', clamp((band(250, 2000) - 0.43) / 0.2), 0.3, 0.08);
      follow('high', clamp((band(2000, 8000) - 0.11) / 0.25), 0.4, 0.12);
      follow('rms', clamp(rms / 0.09), 0.4, 0.1);
      // a transient: the level jumps well above its recent average
      B.base += (B.rms - B.base) * 0.04;
      if (B.rms - B.base > 0.28) B.trans = 1; else B.trans *= 0.78;
    };
    const draw = () => {
      const dark = document.documentElement.dataset.theme !== 'light';
      const k = S.dpr * OPEN;
      const B = S.band, now = S.t;
      const age = (n) => (S.pokes[n] != null ? now - S.pokes[n] : 99);
      const idle = (performance.now() - live.current.volAt) / 1000;
      sg.setTransform(S.res, 0, 0, S.res, 0, 0);
      drawTeaRoom(sg, S.cache, {
        p: S.p, t: S.t, dt: S.dt, still: reduce, px: S.px,
        low: B.low, mid: B.mid + (age('maple') < 1.5 ? (1 - age('maple') / 1.5) * 1.2 : 0), high: Math.min(1, B.high + (age('candle') < 1 ? 1 - age('candle') : 0)), trans: B.trans,
        idle: S.drag ? 0 : idle, catBlink: age('cat') < 0.35 ? 1 : 0,
        react: { speed: S.speed, catUp: Math.max(S.catUp, age('cat') < 0.9 ? Math.sin(Math.PI * age('cat') / 0.9) : 0) },
      });
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, CW, CH);
      // the capsule: lacquer in the dark theme, glazed white in the light theme
      g.save();
      g.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(80,60,40,.28)'; g.shadowBlur = 9 * k; g.shadowOffsetY = 3 * k;
      const fr = g.createLinearGradient(0, PY, 0, PY + PH);
      if (dark) { fr.addColorStop(0, '#262733'); fr.addColorStop(0.5, '#14151e'); fr.addColorStop(1, '#0b0c13'); } else { fr.addColorStop(0, '#ffffff'); fr.addColorStop(0.55, '#f3f0ea'); fr.addColorStop(1, '#dfdad1'); }
      rr(g, PX, PY, PW, PH, PH / 2); g.fillStyle = fr; g.fill();
      g.restore();
      rr(g, PX + 0.5, PY + 0.5, PW - 1, PH - 1, PH / 2); g.lineWidth = 1; g.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.9)'; g.stroke();
      rr(g, WX - 1.6, WY - 1.6, WW + 3.2, WH + 3.2, WH / 2 + 1.6); g.lineWidth = 0.8; g.strokeStyle = dark ? 'rgba(214,176,112,.55)' : 'rgba(120,96,70,.3)'; g.stroke();
      // the window
      g.save();
      rr(g, WX, WY, WW, WH, WH / 2); g.clip();
      g.drawImage(sc, WX, WY, WW, WH);
      const sh = g.createLinearGradient(0, WY, 0, WY + WH);
      sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(0.14, 'rgba(0,0,0,0)'); sh.addColorStop(0.9, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = sh; g.fillRect(WX, WY, WW, WH);
      rr(g, WX, WY, WW, WH, WH / 2); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke();
      g.restore();
      // the glass lens: wider when pressed, stretched by speed, squeezed past an end; thick-edged optical glass
      const kw = KW * (1 + S.stretch * 0.42 + 0.06 * S.press - 0.08 * S.over), kh = KH * (1 - S.stretch * 0.14 - 0.03 * S.press + 0.05 * S.over);
      const kx = S.kx + S.overSide * S.over * 4;
      const x0 = kx - kw / 2, y0 = KY - kh / 2, r = kw / 2 - 1;
      g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 10 * k; g.shadowOffsetY = 4 * k; g.fillStyle = 'rgba(0,0,0,.4)'; rr(g, x0 + 5, y0 + 7, kw - 10, kh - 12, r); g.fill(); g.restore();
      g.save();
      rr(g, x0, y0, kw, kh, r); g.clip();
      g.fillStyle = dark ? '#191a24' : '#ece8e1'; g.fillRect(x0, y0, kw, kh);
      // the part of the room under the lens, magnified, with a slight barrel bend at the rim
      const mag = MAG * (1 + 0.04 * S.press);
      g.drawImage(sc, kx + (WX - kx) * mag, KY + (WY - KY) * mag, WW * mag, WH * mag);
      const rim = g.createRadialGradient(kx, KY, kw * 0.32, kx, KY, kw * 0.62);
      rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(10,12,30,.42)');
      g.fillStyle = rim; g.fillRect(x0, y0, kw, kh);
      const ex = g.createLinearGradient(x0, 0, x0 + kw, 0);
      ex.addColorStop(0, 'rgba(255,255,255,.34)'); ex.addColorStop(0.12, 'rgba(255,255,255,.04)'); ex.addColorStop(0.5, 'rgba(255,255,255,0)'); ex.addColorStop(0.86, 'rgba(6,8,26,.06)'); ex.addColorStop(1, 'rgba(6,8,26,.5)');
      g.fillStyle = ex; g.fillRect(x0, y0, kw, kh);
      const ey = g.createLinearGradient(0, y0, 0, y0 + kh);
      ey.addColorStop(0, 'rgba(255,255,255,.4)'); ey.addColorStop(0.2, 'rgba(255,255,255,.03)'); ey.addColorStop(0.78, 'rgba(0,0,0,0)'); ey.addColorStop(1, 'rgba(0,0,0,.36)');
      g.fillStyle = ey; g.fillRect(x0, y0, kw, kh);
      const hl = g.createRadialGradient(kx - kw * 0.16, y0 + kh * 0.2, 0, kx - kw * 0.16, y0 + kh * 0.2, kw * 0.36);
      hl.addColorStop(0, 'rgba(255,255,255,.7)'); hl.addColorStop(0.5, 'rgba(255,255,255,.16)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl; g.beginPath(); g.ellipse(kx - kw * 0.16, y0 + kh * 0.2, kw * 0.3, kh * 0.11, -0.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 1.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0 + kw - 7, y0 + kh * 0.58); g.quadraticCurveTo(x0 + kw - 7.5, y0 + kh - 12, x0 + kw * 0.6, y0 + kh - 7.5); g.stroke();
      // what a press will do
      const s = live.current.state;
      if (s !== 'playing' || S.overKnob) {
        g.fillStyle = 'rgba(10,10,22,.4)'; g.beginPath(); g.arc(kx, KY, 11.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.9; g.stroke();
        g.fillStyle = '#fff';
        if (s === 'loading') { g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.beginPath(); g.arc(kx, KY, 6.5, S.t * 5, S.t * 5 + 4.2); g.stroke(); }
        else if (s === 'playing') { g.fillRect(kx - 3.9, KY - 4.6, 2.7, 9.2); g.fillRect(kx + 1.2, KY - 4.6, 2.7, 9.2); }
        else if (s === 'error') { g.font = '700 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', kx, KY + 0.5); }
        else { g.beginPath(); g.moveTo(kx - 3.1, KY - 5.2); g.lineTo(kx + 5.4, KY); g.lineTo(kx - 3.1, KY + 5.2); g.closePath(); g.fill(); }
      }
      g.restore();
      // the thick glass edge: a bright outer rim, a darker band, a fine inner line
      rr(g, x0 + 0.7, y0 + 0.7, kw - 1.4, kh - 1.4, r); g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke();
      rr(g, x0 + 2.2, y0 + 2.2, kw - 4.4, kh - 4.4, r - 1.5); g.lineWidth = 2.2; g.strokeStyle = 'rgba(20,24,44,.22)'; g.stroke();
      rr(g, x0 + 3.6, y0 + 3.6, kw - 7.2, kh - 7.2, r - 3); g.lineWidth = 0.7; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
      st.style.setProperty('--kx', `${S.kx.toFixed(1)}px`);
    };
    const frame = (now) => {
      S.raf = 0;
      const dt = Math.min(0.2, (now - (S.last || now)) / 1000) || 0.016; S.last = now;
      const s = live.current.state, v = live.current.vol;
      // about 20 redraws a second while it only plays, small, in the corner
      const busy = S.hover || S.drag || Math.abs(S.kv) > 2 || Math.abs(v - S.p) > 0.002;
      if (!busy && s === 'playing' && now - (S.lastDraw || 0) < 48) { S.raf = requestAnimationFrame(frame); S.last = now - dt * 1000; return; }
      S.lastDraw = now;
      S.t += dt; S.dt = dt;
      const target = K0 + (K1 - K0) * v;
      if (reduce) { S.kx = target; S.kv = 0; S.stretch = 0; }
      else {
        // small fixed steps keep the springs steady when frames are long
        const kk = S.drag ? 520 : 150, d = S.drag ? 34 : 13;
        for (let left = dt; left > 0.0005; left -= 1 / 120) { const h = Math.min(1 / 120, left); S.kv += ((target - S.kx) * kk - S.kv * d) * h; S.kx += S.kv * h; }
        S.stretch += (clamp(Math.abs(S.kv) / 1400, 0, 0.32) - S.stretch) * Math.min(1, dt * 14);
        S.press += ((S.drag ? 1 : 0) - S.press) * Math.min(1, dt * 16);
        S.over += ((S.drag?.over || 0) - S.over) * Math.min(1, dt * 14);
      }
      // the story follows the volume closely (the same p always gives the same picture)
      const p0 = S.p;
      S.p += (v - S.p) * (reduce ? 1 : 1 - Math.exp(-dt * 16));
      if (Math.abs(v - S.p) < 0.0005) S.p = v;
      const sp = (S.p - p0) / dt;
      S.speed += (clamp(Math.abs(sp) / 1.5) - S.speed) * Math.min(1, dt * 8);
      if (Math.abs(sp) > 1.4) S.catUp = 1; else S.catUp *= Math.exp(-dt * 3);
      // sounds of the story, on the way past each moment
      const a = au.current;
      if (a && s === 'playing') { a.foley.update(p0, S.p, sp); a.foley.tick(S.p); }
      features(now, dt);
      const pxT = reduce ? 0 : (S.mouseX == null ? 0 : S.mouseX * 0.7);
      S.px += (pxT - S.px) * Math.min(1, dt * 5);
      draw();
      const moving = Math.abs(target - S.kx) > 0.05 || Math.abs(S.kv) > 0.5 || Math.abs(v - S.p) > 0.0005 || Math.abs(pxT - S.px) > 0.003 || S.press > 0.01 || S.over > 0.01 || S.band.rms > 0.01;
      const living = !reduce && (s === 'playing' || S.hover); // flame, steam, breathing
      if (!document.hidden && (moving || S.drag || s === 'loading' || S.t - (S.poked ?? -99) < 3 || living)) S.raf = requestAnimationFrame(frame);
      else S.last = 0;
    };
    kick.current = () => { if (!S.raf) S.raf = requestAnimationFrame(frame); };
    kick.current();

    const poke = (what) => {
      S.pokes[what] = S.t; S.poked = S.t;
      const f = au.current?.foley;
      if (f && live.current.state === 'playing') f.play(what === 'cat' ? 'meow' : what === 'maple' ? 'leaf' : what === 'traveller' ? 'fabric' : 'paw');
    };
    const local = (e) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * CW, ((e.clientY - r.top) / r.height) * CH]; };
    const sceneAt = (x, y) => (x >= WX && x <= WX + WW && y >= WY && y <= WY + WH ? hitTea(x - WX, y - WY, S.p, S.px) : null);
    const toVol = (x) => Math.round(clamp((x - K0) / (K1 - K0)) * 100) / 100;
    const down = (e) => {
      if (e.button != null && e.button !== 0) return;
      const [x, y] = local(e);
      const onKnob = Math.abs(x - S.kx) <= KW / 2 + 3;
      const hit = onKnob ? null : sceneAt(x, y);
      if (hit) { poke(hit); kick.current(); return; } // a tap on something in the room, not the volume
      S.drag = { id: e.pointerId, grab: onKnob ? x - S.kx : 0, x0: e.clientX, moved: !onKnob, onKnob, over: 0 };
      try { st.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      root.classList.add('drag');
      if (!onKnob) act.current.setVol(toVol(x));
      kick.current();
    };
    const move = (e) => {
      const [x, y] = local(e);
      S.mouseX = clamp((x - CW / 2) / (CW / 2), -1, 1);
      S.overKnob = Math.abs(x - S.kx) <= KW / 2 && y > 0 && y < CH;
      if (!S.drag) st.style.cursor = !S.overKnob && sceneAt(x, y) ? 'pointer' : '';
      const d = S.drag;
      if (d) {
        if (!d.moved && Math.abs(e.clientX - d.x0) > 3) d.moved = true;
        if (d.moved) {
          const want = x - d.grab;
          // past either end the lens gives a little, like glass pressed against its frame
          const past = want > K1 ? want - K1 : want < K0 ? K0 - want : 0;
          d.over = clamp(1 - Math.exp(-past / 26)); S.overSide = want > K1 ? 1 : -1;
          act.current.setVol(toVol(want));
        }
      }
      kick.current();
    };
    const up = () => {
      const d = S.drag;
      if (!d) return;
      S.drag = null; root.classList.remove('drag');
      if (d.onKnob && !d.moved) act.current.toggle();
      else if (live.current.vol > 0.02) act.current.play(); // sliding the sound up starts it (a user gesture)
      kick.current();
    };
    const enter = () => { S.hover = true; kick.current(); };
    const leave = () => { S.hover = false; S.overKnob = false; S.mouseX = null; st.style.cursor = ''; kick.current(); };
    st.addEventListener('pointerdown', down); st.addEventListener('pointermove', move); st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
    const mo = new MutationObserver(() => kick.current());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onVis = () => kick.current();
    document.addEventListener('visibilitychange', onVis);
    const mq = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`); const onDpr = () => { size(); kick.current(); };
    mq.addEventListener?.('change', onDpr);
    return () => {
      cancelAnimationFrame(S.raf); mo.disconnect(); document.removeEventListener('visibilitychange', onVis); mq.removeEventListener?.('change', onDpr);
      st.removeEventListener('pointerdown', down); st.removeEventListener('pointermove', move); st.removeEventListener('pointerup', up); st.removeEventListener('pointercancel', up);
      root.removeEventListener('pointerenter', enter); root.removeEventListener('pointerleave', leave);
      kick.current = () => {};
    };
  }, []);

  const playing = state === 'playing';
  const label = state === 'error' ? 'Music could not be loaded. Press to try again.' : playing ? 'Pause background music' : state === 'loading' ? 'Loading music…' : 'Play background music';
  const pct = Math.round(vol * 100);
  const cap = state === 'error' ? 'Music unavailable · press to retry' : state === 'loading' ? 'Loading · Kyoto, Slowly' : playing ? `Kyoto, Slowly · ${pct}% · ${chapterOf(vol)}` : 'Slide the glass to play · 紅葉の小さな奇跡';
  const onRange = (e) => { setVol(Number(e.target.value)); if (Number(e.target.value) > 0.02) play(); };
  return (
    <div ref={box} className={'music koto' + (playing ? ' playing' : '') + (state === 'loading' ? ' loading' : '') + (state === 'error' ? ' error' : '')} role="group" aria-label="Background music: Kyoto, Slowly (original piano piece). The volume also moves a little story in the window.">
      <div className="koto-stage" ref={stage}>
        <canvas ref={cv} className="koto-cv" aria-hidden="true" />
        {/* pointer presses are handled on the stage (press = play or pause, drag = volume); the click handler is for the keyboard */}
        <button type="button" className="music-btn" onClick={(e) => { if (e.detail === 0) toggle(); }} aria-pressed={playing} aria-label={label} title={label} />
        <span className="koto-cap" aria-hidden="true">{cap}</span>
      </div>
      <label className="koto-range">
        <span>Music volume</span>
        <input type="range" min="0" max="1" step="0.02" value={vol} onChange={onRange} aria-label="Music volume" aria-valuetext={`${pct}%, ${chapterOf(vol).slice(3)}`} />
      </label>
    </div>
  );
}
