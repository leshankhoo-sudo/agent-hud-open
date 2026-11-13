// Sounds for the tea-room story, all synthesised here with Web Audio (no recordings, so nothing to
// license): footsteps, the shoji sliding, kimono fabric, the cat's bell and a short meow, autumn
// wind, the leaf, a paw tap, tea pouring, a cup set down and a small glass bell for the crane.
// They go to their own gain node, separate from the music, and are silent when the volume is 0.
//
// Events are tied to points of the story (p). Moving p across a point plays its sound once, and
// only in the directions that make sense (a cup is not set down backwards; a door slides either
// way). Each sound has a cool-down, the same sound never overlaps itself, at most six voices play
// at once, and while the slider is flung very fast only the main moments are kept. Pouring is a
// held sound: it plays while p is moving forward through the pour and fades out otherwise.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function createFoley(ctx, out) {
  const N = ctx.sampleRate;
  const noise = ctx.createBuffer(1, N * 2, N);
  { const d = noise.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; } }
  let voices = 0;
  const log = [];
  const MAX_VOICES = 6;
  const last = {};
  const env = (gn, at, peak, attack, decay) => { gn.gain.setValueAtTime(0.0001, at); gn.gain.exponentialRampToValueAtTime(peak, at + attack); gn.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay); };
  const voice = (dur) => { voices++; setTimeout(() => { voices--; }, dur * 1000 + 60); };
  const noiseHit = ({ at = ctx.currentTime, type = 'bandpass', f = 1000, q = 1, f2, peak = 0.3, attack = 0.005, decay = 0.1, rate = 1 }) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, at); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + attack + decay);
    const gn = ctx.createGain(); env(gn, at, peak, attack, decay);
    s.connect(fl); fl.connect(gn); gn.connect(out);
    s.start(at, Math.random() * 1.5); s.stop(at + attack + decay + 0.05);
  };
  const tone = ({ at = ctx.currentTime, f, type = 'sine', peak = 0.2, attack = 0.004, decay = 0.5, glide }) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
    if (glide) glide(o.frequency, at);
    const gn = ctx.createGain(); env(gn, at, peak, attack, decay);
    o.connect(gn); gn.connect(out); o.start(at); o.stop(at + attack + decay + 0.05);
  };
  const SOUNDS = {
    step: () => { noiseHit({ type: 'lowpass', f: 420, q: 0.7, peak: 0.32, attack: 0.004, decay: 0.09 }); noiseHit({ f: 2400, q: 2, peak: 0.05, decay: 0.03 }); return 0.12; },
    shoji: () => { noiseHit({ f: 1500, f2: 2600, q: 2.5, peak: 0.12, attack: 0.08, decay: 0.42, rate: 0.7 }); noiseHit({ at: ctx.currentTime + 0.5, type: 'lowpass', f: 700, peak: 0.16, decay: 0.06 }); return 0.6; },
    fabric: () => { noiseHit({ f: 3200, q: 0.8, peak: 0.07, attack: 0.05, decay: 0.28 }); return 0.35; },
    bell: () => { const t = ctx.currentTime; for (const [d, f] of [[0, 4186], [0.09, 4700], [0.17, 4186]]) { tone({ at: t + d, f, peak: 0.05, decay: 0.35 }); tone({ at: t + d, f: f * 2.4, peak: 0.02, decay: 0.2 }); } return 0.6; },
    meow: () => {
      const t = ctx.currentTime, o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(480, t); o.frequency.linearRampToValueAtTime(760, t + 0.16); o.frequency.linearRampToValueAtTime(520, t + 0.42);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.setValueAtTime(900, t); f1.frequency.linearRampToValueAtTime(1500, t + 0.15); f1.frequency.linearRampToValueAtTime(1000, t + 0.42);
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.11, t + 0.05); gn.gain.setValueAtTime(0.1, t + 0.3); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
      o.connect(f1); f1.connect(gn); gn.connect(out); o.start(t); o.stop(t + 0.5);
      return 0.5;
    },
    wind: () => { noiseHit({ type: 'bandpass', f: 380, f2: 820, q: 0.9, peak: 0.12, attack: 0.5, decay: 1.2, rate: 0.5 }); return 1.7; },
    leaf: () => { const t = ctx.currentTime; for (let i = 0; i < 4; i++) noiseHit({ at: t + i * 0.045 + Math.random() * 0.02, f: 5200, q: 3, peak: 0.05, decay: 0.03 }); return 0.25; },
    paw: () => { noiseHit({ type: 'lowpass', f: 900, peak: 0.08, decay: 0.04 }); return 0.1; },
    clink: () => { const t = ctx.currentTime; for (const [f, a] of [[2630, 0.08], [3910, 0.05], [5840, 0.025]]) tone({ at: t, f, peak: a, decay: 0.35 }); return 0.4; },
    chime: () => { const t = ctx.currentTime, f0 = [1568, 1760, 2093][Math.floor(Math.random() * 3)]; for (const [m, a, d] of [[1, 0.09, 2.2], [2.76, 0.04, 1.2], [5.4, 0.018, 0.6]]) tone({ at: t, f: f0 * m, peak: a, decay: d }); return 2.3; },
  };
  const COOL = { step: 0.11, shoji: 0.7, fabric: 0.4, bell: 0.7, meow: 0.9, wind: 1.6, leaf: 0.3, paw: 0.25, clink: 0.6, chime: 1.4 };
  const MAIN = new Set(['shoji', 'meow', 'chime', 'clink']);
  const play = (name, { fast = false } = {}) => {
    const now = ctx.currentTime;
    if (ctx.state !== 'running') return false;
    if (now - (last[name] ?? -9) < COOL[name]) return false;      // cool-down: never stacks on itself
    if (voices >= MAX_VOICES) return false;                       // polyphony limit
    if (fast && !MAIN.has(name)) return false;                    // a fling keeps only the main moments
    last[name] = now;
    voice(SOUNDS[name]());
    log.push(name); if (log.length > 80) log.shift(); // the last sounds, for tests
    return true;
  };

  // story points: [p, sound, direction] (+1 forwards only, -1 backwards only, 0 either way)
  const EVENTS = [
    [0.03, 'wind', 0], [0.135, 'leaf', 1],
    [0.165, 'shoji', 0], [0.195, 'fabric', 1],
    [0.345, 'bell', 1], [0.44, 'meow', 1],
    [0.505, 'wind', 0], [0.555, 'paw', 1], [0.565, 'leaf', 0], [0.618, 'leaf', 1],
    [0.66, 'fabric', 0], [0.69, 'fabric', 1], [0.805, 'clink', 1],
    [0.86, 'chime', 1], [0.955, 'chime', 1], [0.975, 'wind', 1],
  ];
  // footsteps fall on the walk's steps (nine between p = 0.20 and 0.32)
  for (let i = 1; i <= 9; i++) EVENTS.push([0.2 + (0.12 * (i - 0.5)) / 9, 'step', 0]);
  EVENTS.sort((a, b) => a[0] - b[0]);

  // the held pouring sound
  const pour = (() => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.playbackRate.value = 1.3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(bp.frequency);
    const gn = ctx.createGain(); gn.gain.value = 0;
    s.connect(bp); bp.connect(gn); gn.connect(out); s.start(); lfo.start();
    return { gn, stop: () => { try { s.stop(); lfo.stop(); } catch { /* already stopped */ } } };
  })();

  let lastForward = -9;
  return {
    // p moved from a to b; speed in p per second
    update(a, b, speed) {
      if (a === b) return;
      const dir = b > a ? 1 : -1, fast = Math.abs(speed) > 1.6;
      if (dir > 0) lastForward = ctx.currentTime;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (const [at, name, d] of EVENTS) {
        if (at <= lo || at > hi) continue;
        if (d !== 0 && d !== dir) continue;
        play(name, { fast });
      }
    },
    // called every frame: the pour follows forward movement inside the pour
    tick(p) {
      const now = ctx.currentTime;
      const on = p > 0.715 && p < 0.79 && now - lastForward < 0.25 ? 1 : 0;
      pour.gn.gain.setTargetAtTime(on * 0.13, now, on ? 0.06 : 0.12);
    },
    play,
    log,
    stop() { pour.gn.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => pour.stop(), 400); },
  };
}
