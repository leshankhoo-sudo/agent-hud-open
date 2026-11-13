import { useEffect, useRef, useState } from 'react';
import { drawGarden } from './lib/gardenScene.js';

// Background music as a small lived-in window: a pill-shaped view into a tatami room and its
// garden, with a glass dome that slides along it. The dome is the volume; pressing it plays or
// pauses. The room answers the volume (see lib/gardenScene.js): silent is a moonlit night with the
// cat asleep, and as the sound rises the candle, the shoji across the garden and the ceiling
// lights come on, leaves fall, the cat sways, and at the top a fox looks in. The flame and the
// leaves follow the level of the music itself. Interaction idea after a reference clip of a
// "volume with a resident" slider; the scene, drawing and behaviour here are this project's own.
//
// Audio: off until the visitor plays it; the file is only downloaded then. It loops inside the
// decoded buffer between two sample-exact points (the file carries a second of periodic lead-in
// and lead-out), so there is no gap at the loop even though it is an MP3.
// Keyboard and screen readers: a real button (play / pause) and a real range input (volume).

const VOL_KEY = 'kyoto-gis-music-volume';
const savedVolume = () => { try { const v = parseFloat(localStorage.getItem(VOL_KEY)); return v >= 0 && v <= 1 ? v : 0.5; } catch { return 0.5; } };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// stage geometry, in CSS pixels at full size
const CW = 280, CH = 108;
const PX = 8, PY = 8, PW = 264, PH = 88;          // the pill
const WX = 13, WY = 13, WW = 254, WH = 78;         // the window in it
const KW = 56, KH = 98, KY = PY + PH / 2;          // the glass dome
const K0 = WX + 26, K1 = WX + WW - 26;             // travel of the dome's centre
const MAG = 1.3;                                   // how much the dome magnifies

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export default function MusicPlayer() {
  const au = useRef(null); // { ctx, gain, src, an, buf }
  const box = useRef(null), stage = useRef(null), cv = useRef(null);
  const [state, setState] = useState('idle'); // idle | loading | playing | paused | error
  const [vol, setVol] = useState(savedVolume);
  const live = useRef({ state: 'idle', vol });
  live.current.state = state; live.current.vol = vol;
  const base = import.meta.env.BASE_URL;
  const kick = useRef(() => {});

  useEffect(() => () => { au.current?.ctx.close(); }, []);
  useEffect(() => {
    // perceived loudness is closer to the square of the slider position
    if (au.current) au.current.gain.gain.setTargetAtTime(vol * vol, au.current.ctx.currentTime, 0.05);
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
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = meta.loop_start;
      src.loopEnd = Math.min(meta.loop_end, buf.duration);
      src.connect(gain);
      // a tap for the scene: the level of the music before the volume is applied
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      src.start(0, meta.loop_start);
      const v = live.current.vol;
      gain.gain.setTargetAtTime(v * v, ctx.currentTime, 0.6); // fade in
      au.current = { ctx, gain, src, an, buf: new Uint8Array(an.fftSize) };
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

  // ---- drawing and pointer handling ----
  useEffect(() => {
    const st = stage.current, c = cv.current, root = box.current;
    const g = c.getContext('2d');
    const sc = document.createElement('canvas'), sg = sc.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const store = { parts: [], kind: null };
    const S = { kx: K0 + (K1 - K0) * live.current.vol, kv: 0, stretch: 0, L: 0, beat: 0, px: 0, hover: false, overKnob: false, drag: null, raf: 0, last: 0, t: 0, dpr: 1, skip: false, mouseX: null };
    const size = () => {
      S.dpr = Math.min(devicePixelRatio || 1, 2.5);
      c.width = Math.round(CW * S.dpr); c.height = Math.round(CH * S.dpr);
      S.res = S.dpr * MAG; sc.width = Math.round(WW * S.res); sc.height = Math.round(WH * S.res);
    };
    size();
    const level = () => {
      const a = au.current;
      if (!a || live.current.state !== 'playing') return 0;
      a.an.getByteTimeDomainData(a.buf);
      let sum = 0;
      for (let i = 0; i < a.buf.length; i += 2) { const v = (a.buf[i] - 128) / 128; sum += v * v; }
      return clamp(Math.sqrt(sum / (a.buf.length / 2)) * 3.4);
    };
    const draw = () => {
      const dark = document.documentElement.dataset.theme !== 'light';
      const season = document.documentElement.dataset.season || 'autumn';
      const { dpr } = S;
      // the room, drawn a little larger than shown so that the dome can magnify it
      sg.setTransform(S.res, 0, 0, S.res, 0, 0);
      drawGarden(sg, { L: S.L, t: S.t, beat: S.beat, season, px: S.px, still: reduce, store, dt: S.dt });
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, CW, CH);
      // frame: lacquer in the dark theme, glazed white in the light theme
      g.save();
      g.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(80,60,40,.28)'; g.shadowBlur = 9; g.shadowOffsetY = 3;
      const fr = g.createLinearGradient(0, PY, 0, PY + PH);
      if (dark) { fr.addColorStop(0, '#262733'); fr.addColorStop(0.5, '#14151e'); fr.addColorStop(1, '#0b0c13'); } else { fr.addColorStop(0, '#ffffff'); fr.addColorStop(0.55, '#f3f0ea'); fr.addColorStop(1, '#dfdad1'); }
      rr(g, PX, PY, PW, PH, PH / 2); g.fillStyle = fr; g.fill();
      g.restore();
      rr(g, PX + 0.5, PY + 0.5, PW - 1, PH - 1, PH / 2); g.lineWidth = 1; g.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.9)'; g.stroke();
      rr(g, WX - 1.6, WY - 1.6, WW + 3.2, WH + 3.2, WH / 2 + 1.6); g.lineWidth = 0.8; g.strokeStyle = dark ? 'rgba(214,176,112,.55)' : 'rgba(120,96,70,.3)'; g.stroke();
      // window
      g.save();
      rr(g, WX, WY, WW, WH, WH / 2); g.clip();
      g.drawImage(sc, WX, WY, WW, WH);
      const sh = g.createLinearGradient(0, WY, 0, WY + WH);
      sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(0.14, 'rgba(0,0,0,0)'); sh.addColorStop(0.9, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = sh; g.fillRect(WX, WY, WW, WH);
      rr(g, WX, WY, WW, WH, WH / 2); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke();
      g.restore();
      // glass dome
      const kw = KW * (1 + S.stretch * 0.42), kh = KH * (1 - S.stretch * 0.14);
      const x0 = S.kx - kw / 2, y0 = KY - kh / 2, r = kw / 2 - 1;
      g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 10; g.shadowOffsetY = 4; g.fillStyle = 'rgba(0,0,0,.4)'; rr(g, x0 + 5, y0 + 7, kw - 10, kh - 12, r); g.fill(); g.restore();
      g.save();
      rr(g, x0, y0, kw, kh, r); g.clip();
      g.fillStyle = dark ? '#191a24' : '#ece8e1'; g.fillRect(x0, y0, kw, kh);
      g.drawImage(sc, S.kx + (WX - S.kx) * MAG, KY + (WY - KY) * MAG, WW * MAG, WH * MAG);
      const ex = g.createLinearGradient(x0, 0, x0 + kw, 0);
      ex.addColorStop(0, 'rgba(255,255,255,.34)'); ex.addColorStop(0.12, 'rgba(255,255,255,.04)'); ex.addColorStop(0.5, 'rgba(255,255,255,0)'); ex.addColorStop(0.86, 'rgba(6,8,26,.06)'); ex.addColorStop(1, 'rgba(6,8,26,.5)');
      g.fillStyle = ex; g.fillRect(x0, y0, kw, kh);
      const ey = g.createLinearGradient(0, y0, 0, y0 + kh);
      ey.addColorStop(0, 'rgba(255,255,255,.4)'); ey.addColorStop(0.2, 'rgba(255,255,255,.03)'); ey.addColorStop(0.78, 'rgba(0,0,0,0)'); ey.addColorStop(1, 'rgba(0,0,0,.36)');
      g.fillStyle = ey; g.fillRect(x0, y0, kw, kh);
      // highlights on the glass
      const hl = g.createRadialGradient(S.kx - kw * 0.16, y0 + kh * 0.2, 0, S.kx - kw * 0.16, y0 + kh * 0.2, kw * 0.36);
      hl.addColorStop(0, 'rgba(255,255,255,.7)'); hl.addColorStop(0.5, 'rgba(255,255,255,.16)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl; g.beginPath(); g.ellipse(S.kx - kw * 0.16, y0 + kh * 0.2, kw * 0.3, kh * 0.11, -0.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 1.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0 + kw - 7, y0 + kh * 0.58); g.quadraticCurveTo(x0 + kw - 7.5, y0 + kh - 12, x0 + kw * 0.6, y0 + kh - 7.5); g.stroke();
      // what a press will do
      const s = live.current.state;
      if (s !== 'playing' || S.overKnob) {
        g.fillStyle = 'rgba(10,10,22,.4)'; g.beginPath(); g.arc(S.kx, KY, 11.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.9; g.stroke();
        g.fillStyle = '#fff';
        if (s === 'loading') { g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.beginPath(); g.arc(S.kx, KY, 6.5, S.t * 5, S.t * 5 + 4.2); g.stroke(); }
        else if (s === 'playing') { g.fillRect(S.kx - 3.9, KY - 4.6, 2.7, 9.2); g.fillRect(S.kx + 1.2, KY - 4.6, 2.7, 9.2); }
        else if (s === 'error') { g.font = '700 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', S.kx, KY + 0.5); }
        else { g.beginPath(); g.moveTo(S.kx - 3.1, KY - 5.2); g.lineTo(S.kx + 5.4, KY); g.lineTo(S.kx - 3.1, KY + 5.2); g.closePath(); g.fill(); }
      }
      g.restore();
      rr(g, x0 + 0.7, y0 + 0.7, kw - 1.4, kh - 1.4, r); g.lineWidth = 1.3; g.strokeStyle = 'rgba(255,255,255,.82)'; g.stroke();
      rr(g, x0 + 2.6, y0 + 2.6, kw - 5.2, kh - 5.2, r - 2); g.lineWidth = 0.8; g.strokeStyle = 'rgba(255,255,255,.2)'; g.stroke();
      st.style.setProperty('--kx', `${S.kx.toFixed(1)}px`);
    };
    const frame = (now) => {
      S.raf = 0;
      const dt = Math.min(0.2, (now - (S.last || now)) / 1000) || 0.016; S.last = now;
      const s = live.current.state, v = live.current.vol;
      // at a quiet 30 fps while it only plays in the corner
      const busy = S.hover || S.drag || Math.abs(S.kv) > 2;
      if (!busy && s === 'playing' && (S.skip = !S.skip)) { S.raf = requestAnimationFrame(frame); S.last = now - dt * 1000; return; }
      S.t += dt; S.dt = dt;
      const target = K0 + (K1 - K0) * v;
      if (reduce) { S.kx = target; S.kv = 0; S.stretch = 0; }
      else {
        // small fixed steps keep the spring steady when frames are long
        const k = S.drag ? 520 : 150, d = S.drag ? 34 : 13;
        for (let left = dt; left > 0.0005; left -= 1 / 120) { const h = Math.min(1 / 120, left); S.kv += ((target - S.kx) * k - S.kv * d) * h; S.kx += S.kv * h; }
        S.stretch += (clamp(Math.abs(S.kv) / 1400, 0, 0.32) - S.stretch) * Math.min(1, dt * 14);
      }
      const Lt = s === 'playing' || s === 'loading' ? v : 0;
      S.L += (Lt - S.L) * (reduce ? 1 : 1 - Math.exp(-dt * 3));
      S.beat += (level() - S.beat) * 0.3;
      const pxT = reduce ? 0 : (S.mouseX == null ? 0 : S.mouseX * 0.7) - (v - 0.5) * 0.5;
      S.px += (pxT - S.px) * Math.min(1, dt * 5);
      draw();
      const moving = Math.abs(target - S.kx) > 0.05 || Math.abs(S.kv) > 0.5 || Math.abs(Lt - S.L) > 0.002 || Math.abs(pxT - S.px) > 0.003;
      if (!document.hidden && (moving || S.drag || s === 'loading' || (!reduce && (s === 'playing' || S.hover)))) S.raf = requestAnimationFrame(frame);
      else S.last = 0;
    };
    kick.current = () => { if (!S.raf) S.raf = requestAnimationFrame(frame); };
    kick.current();

    const local = (e) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * CW, ((e.clientY - r.top) / r.height) * CH]; };
    const toVol = (x) => Math.round(clamp((x - K0) / (K1 - K0)) * 50) / 50;
    const down = (e) => {
      if (e.button != null && e.button !== 0) return;
      const [x] = local(e);
      const onKnob = Math.abs(x - S.kx) <= KW / 2 + 3;
      S.drag = { id: e.pointerId, grab: onKnob ? x - S.kx : 0, x0: e.clientX, moved: !onKnob, onKnob };
      try { st.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      root.classList.add('drag');
      if (!onKnob) act.current.setVol(toVol(x));
      kick.current();
    };
    const move = (e) => {
      const [x, y] = local(e);
      S.mouseX = clamp((x - CW / 2) / (CW / 2), -1, 1);
      S.overKnob = Math.abs(x - S.kx) <= KW / 2 && y > 0 && y < CH;
      const d = S.drag;
      if (d) {
        if (!d.moved && Math.abs(e.clientX - d.x0) > 3) d.moved = true;
        if (d.moved) act.current.setVol(toVol(x - d.grab));
      }
      kick.current();
    };
    const up = () => {
      const d = S.drag;
      if (!d) return;
      S.drag = null; root.classList.remove('drag');
      if (d.onKnob && !d.moved) act.current.toggle();
      else if (live.current.vol > 0.02) act.current.play(); // sliding the sound up starts it
      kick.current();
    };
    const enter = () => { S.hover = true; kick.current(); };
    const leave = () => { S.hover = false; S.overKnob = false; S.mouseX = null; kick.current(); };
    st.addEventListener('pointerdown', down); st.addEventListener('pointermove', move); st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
    const mo = new MutationObserver(() => kick.current());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-season'] });
    const onVis = () => kick.current();
    document.addEventListener('visibilitychange', onVis);
    const mq = matchMedia('(resolution: 1dppx)'); const onDpr = () => { size(); kick.current(); };
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
  const cap = state === 'error' ? 'Music unavailable · press to retry' : state === 'loading' ? 'Loading · Kyoto, Slowly' : playing ? `Kyoto, Slowly · ${pct}%` : 'Slide the glass to play · Kyoto, Slowly';
  const onRange = (e) => { setVol(Number(e.target.value)); if (Number(e.target.value) > 0.02) play(); };
  return (
    <div ref={box} className={'music koto' + (playing ? ' playing' : '') + (state === 'loading' ? ' loading' : '') + (state === 'error' ? ' error' : '')} role="group" aria-label="Background music: Kyoto, Slowly (original piano piece)">
      <div className="koto-stage" ref={stage}>
        <canvas ref={cv} className="koto-cv" aria-hidden="true" />
        {/* pointer presses are handled on the stage (press = play or pause, drag = volume); the click handler is for the keyboard */}
        <button type="button" className="music-btn" onClick={(e) => { if (e.detail === 0) toggle(); }} aria-pressed={playing} aria-label={label} title={label} />
        <span className="koto-cap" aria-hidden="true">{cap}</span>
      </div>
      <label className="koto-range">
        <span>Music volume</span>
        <input type="range" min="0" max="1" step="0.02" value={vol} onChange={onRange} aria-label="Music volume" aria-valuetext={`${pct}%`} />
      </label>
    </div>
  );
}
