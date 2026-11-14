// The beat of "Kyoto, Slowly", from the same tempo curve the piece was written with
// (scripts/compose_music.py: 80 BPM, 4 beats to the bar, and a slight rubato: each 8-bar phrase
// eases a little, most in its last bar). beatMap gives the time of every beat inside the loop, so
// the picture can follow the music's real beats instead of a steady metronome that would drift.
const GRID = 96; // steps per beat, as in the script

export function beatMap(bpm, bars) {
  const beats = bars * 4, T = new Float64Array(beats + 1);
  let acc = 0;
  for (let i = 0; i < beats * GRID; i++) {
    if (i % GRID === 0) T[i / GRID] = acc;
    const beat = i / GRID, bar = Math.floor(beat / 4) % 8, pos = (beat % 4) / 4;
    const slow = bar === 7 ? 0.035 * pos : 0.012 * Math.sin(Math.PI * ((bar + pos) / 8));
    acc += ((60 / bpm) * (1 + slow)) / GRID;
  }
  T[beats] = acc;
  return T;
}

// seconds into the loop -> beats into the loop (a whole number on each beat)
export function beatAt(T, sec) {
  const n = T.length - 1, len = T[n];
  sec = ((sec % len) + len) % len;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= sec) lo = m; else hi = m; }
  return lo + (sec - T[lo]) / (T[hi] - T[lo]);
}
