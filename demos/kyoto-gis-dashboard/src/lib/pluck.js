// A plucked string, synthesised here (Karplus-Strong: a short burst of noise circulating in a delay line
// one period long, softened a little on every pass), so there is no recording to license.
// It plays through its own AudioContext, started only by a press, at the music volume the visitor set
// for the site (kyoto-gis-music-volume); at volume 0 it is silent.
let ctx = null;
const VOL_KEY = 'kyoto-gis-music-volume';
const volume = () => { try { const v = parseFloat(localStorage.getItem(VOL_KEY)); return v >= 0 && v <= 1 ? v : 0.5; } catch { return 0.5; } };

// Hirajoshi (平調子), the usual koto tuning, on D: D E F A B-flat, over two octaves from D3.
const SCALE = [0, 2, 3, 7, 8];
export function noteFor(k) {
  const steps = Math.round(Math.min(1, Math.max(0, k)) * (SCALE.length * 2 - 1));
  return 146.83 * 2 ** (Math.floor(steps / SCALE.length) + SCALE[steps % SCALE.length] / 12);
}

// one string sample: freq in Hz; bright 0..1 (plucked near an end sounds brighter); seconds long
export function stringSamples(freq, sr, { bright = 0.4, seconds = 2.4, seed = 1 } = {}) {
  const n = Math.floor(sr * seconds), N = Math.max(2, Math.round(sr / freq));
  const out = new Float32Array(n), line = new Float32Array(N);
  let s = seed >>> 0 || 1, lp = 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
  const soft = 0.75 - bright * 0.6;   // the pick: a softer burst for a mellow pluck
  for (let i = 0; i < N; i++) { lp = soft * lp + (1 - soft) * rnd(); line[i] = lp; }
  const loss = Math.pow(10, -3 / (2.6 * freq));   // about 2.6 s to fall by 60 dB
  let p = 0, peak = 1e-6;
  for (let i = 0; i < n; i++) {
    const a = line[p], b = line[(p + 1) % N];
    out[i] = a;
    line[p] = (a * 0.5 + b * 0.5) * loss;
    p = (p + 1) % N;
    if (Math.abs(a) > peak) peak = Math.abs(a);
  }
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

export function pluck({ freq, amp = 1, bright = 0.4 }) {
  const v = volume();
  if (v <= 0 || typeof window === 'undefined') return false;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const sr = ctx.sampleRate, data = stringSamples(freq, sr, { bright, seed: (Math.random() * 1e9) | 0 });
    const buf = ctx.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const t = ctx.currentTime;
    // a koto string is pressed a little as it is plucked: the pitch starts a touch sharp and settles
    src.playbackRate.setValueAtTime(1.012, t);
    src.playbackRate.exponentialRampToValueAtTime(1, t + 0.09);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800 + bright * 4200; lp.Q.value = 0.4;
    const g = ctx.createGain();
    const level = Math.max(0.05, Math.min(1, amp)) * v * 0.55;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + data.length / sr);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(t);
    return true;
  } catch {
    return false;
  }
}
