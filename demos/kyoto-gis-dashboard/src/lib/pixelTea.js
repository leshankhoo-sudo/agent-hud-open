// 紅葉の小さな奇跡 — the tea-room story inside the music control, as pixel art.
//
// How it is drawn (the method is the one used by the MIT-licensed "slider-resident" volume slider by
// @Lattice_Node and its JK variant, which the team gave as the reference; the code, the room, the
// characters and the story here are this project's own):
//   - a small world, 192 x 59 pixels, shown at whole-number sizes;
//   - every pixel holds a material number, not a colour;
//   - colours come from a few hue ramps with eight fixed lightness steps (OKLab);
//   - light is computed per pixel from a handful of sources, cut into eight levels, and the steps
//     between levels are ordered dither (4 x 4 Bayer), so there are no in-between colours;
//   - in the dark everything falls to indigo night tones, and a thing shows its own colour only
//     once light reaches it. Some materials (flame, lit paper, the crane) shine by themselves.
//
// What moves it:
//   p     the volume, 0..1 = the story (same p, same poses; see the functions below)
//   beat  the music's own clock in beats (80 BPM), when it is playing: the wind bell rings a wave on
//         every beat, the flame pulses, the deer-scarer (shishi-odoshi) tips every two bars
//   waves each ring travels from the bell as far as the glass lens; what it passes sways or flickers
//         (maple boughs, the bell's paper, steam, flame, the cat's ears, the sleeve)
//   bands the smoothed low / mid / high / transient levels of the music: house lights, leaves,
//         flame and steam, sparkles
//   t     a free clock for small things only (blink, breath, twinkle)
import { hexToOklab, oklabToRgb } from './oklab.js';

export const W = 192, H = 59;
const N = W * H;
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => cl((p - a) / (b - a));
const ss = (x) => { x = cl(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, f) => a + (b - a) * f;
const mix2 = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
function bez(p0, p1, p2, p3, u) { const v = 1 - u; return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- chapters ----------
const CHAPTERS = [[0.15, '01 Silence'], [0.33, '02 Arrival'], [0.5, '03 An unexpected guest'], [0.65, '04 Playful wind'], [0.82, '05 The warmth of tea'], [0.95, '06 The little miracle'], [1.01, '07 Serenity']];
export const chapterOf = (p) => CHAPTERS.find(([to]) => p < to)[1];

// ---------- places (world pixels) ----------
export const PLACES = {
  floor: 55, door: [5, 27], post: 38, cushionL: 103, table: [109, 150], tableTop: 49,
  pot: [114, 48], cup: [121, 48], candle: [143, 48], cat: [134, 54], catOut: 157,
  bell: [50, 18], leafRest: [80, 40], leafRoom: [130, 48], lantern: [127, 35], scarer: [72, 38], hang: [174, 16],
};
const P = PLACES;

// ---------- the story, as functions of p ----------
export function traveller(p) {
  const shown = seg(p, 0.17, 0.2);
  const walk = seg(p, 0.2, 0.32);
  const x = lerp(P.door[0] + 11, P.cushionL, ss(walk)) + (p < 0.2 ? lerp(-3, 0, seg(p, 0.17, 0.2)) : 0);
  const steps = walk * 9;
  const sit = ss(seg(p, 0.645, 0.69));
  const look = p < 0.36 ? 0 : p < 0.44 ? ss(seg(p, 0.36, 0.4)) : p < 0.5 ? 1 - ss(seg(p, 0.44, 0.5)) : 0; // looks down at the cat
  const lookCrane = p > 0.83 && p < 0.96 ? Math.sin(Math.PI * seg(p, 0.83, 0.96)) : 0;
  const pour = seg(p, 0.69, 0.82);
  const grip = ss(seg(p, 0.672, 0.69)) * (1 - ss(seg(p, 0.82, 0.835))); // a hand on the kettle
  const cupReach = ss(seg(p, 0.94, 0.958)), cup = ss(seg(p, 0.958, 0.985)); // reaches for the cup, then lifts it
  return { grip, cupReach, shown, x, steps, walking: walk > 0 && walk < 1, sit, lookDown: look, lookUp: lookCrane, push: p > 0.16 && p < 0.21 ? Math.sin(Math.PI * seg(p, 0.16, 0.21)) : 0, pour, cup, shadow: p > 0.11 && p < 0.2 ? Math.sin(Math.PI * seg(p, 0.11, 0.2)) : 0 };
}
// the kettle in the pour: how far it is lifted over the cup (0..1) and whether tea is flowing
export function pourPose(p) {
  const pour = seg(p, 0.69, 0.82);
  const hold = pour > 0 && pour < 1 ? ss(seg(pour, 0, 0.15)) * (1 - ss(seg(pour, 0.85, 1))) : 0;
  return { hold, flow: ss(seg(pour, 0.18, 0.26)) * (1 - ss(seg(pour, 0.76, 0.84))) };
}
export function door(p) { return ss(seg(p, 0.155, 0.2)); }
export function cat(p) {
  const ears = seg(p, 0.33, 0.37), eyes = seg(p, 0.37, 0.41);
  const tilt = p > 0.41 && p < 0.5 ? Math.sin(Math.PI * seg(p, 0.41, 0.5)) : 0;
  const out = ss(seg(p, 0.48, 0.53));
  const paw = p > 0.545 && p < 0.6 ? Math.sin(Math.PI * seg(p, 0.545, 0.6)) : 0;
  const up = p > 0.83 && p < 0.955 ? ss(seg(p, 0.83, 0.86)) * (1 - ss(seg(p, 0.93, 0.955))) : 0;
  return { visible: p >= 0.33, asleep: p < 0.33, ears, eyes, tilt, out, paw, up, x: lerp(P.cat[0], P.catOut, out), y: lerp(P.cat[1], P.floor, out), garden: p > 0.955 ? 1 : 0 };
}
export function leaf(p) {
  if (p < 0.15) { const u = ss(seg(p, 0, 0.15)); const [x, y] = bez([62, 22], [70, 27], [66, 34], P.leafRest, u); return { x: x + Math.sin(u * 9) * 2 * (1 - u), y, rot: u * 7.5, flying: u < 1 }; }
  if (p < 0.5) return { x: P.leafRest[0], y: P.leafRest[1], rot: 7.5, flying: false };
  if (p < 0.62) { const u = ss(seg(p, 0.5, 0.62)); const [x, y] = bez(P.leafRest, [90, 27], [106, 33], P.leafRoom, u); return { x, y, rot: 7.5 + u * 14, flying: true, u }; }
  return { x: P.leafRoom[0], y: P.leafRoom[1], rot: 21.5, flying: false };
}
export function crane(p) {
  const form = ss(seg(p, 0.82, 0.865));
  if (form <= 0) return null;
  const fly = seg(p, 0.875, 0.95), out = seg(p, 0.95, 0.975), fall = seg(p, 0.972, 1);
  const start = [P.cup[0], 36];
  let x, y;
  if (fly <= 0) [x, y] = start;
  else if (out <= 0) {
    const c = [P.candle[0], 37], r = 11, a = Math.PI + Math.PI * ss(fly);
    [x, y] = fly < 0.2 ? mix2(start, [c[0] - r, c[1]], ss(seg(fly, 0, 0.2))) : [c[0] + r * Math.cos(a), c[1] + r * 0.6 * Math.sin(a)];
  } else [x, y] = bez([P.candle[0] + 11, 37], [160, 30], [164, 23], [168, 22], ss(out));
  const wing = seg(p, 0.855, 0.88);
  const leafK = ss(seg(p, 0.968, 0.98));
  if (fall > 0) { const [lx, ly] = bez([168, 22], [165, 27], [173, 32], [170, 39], ss(fall)); x = lx + Math.sin(fall * 8) * 1.4 * (1 - fall); y = ly; }
  return { x, y, form, wing, fly, out, leafK, fall, glow: form * (1 - leafK * 0.45) };
}
export function steam(p) { return p < 0.72 ? 0 : p < 0.82 ? ss(seg(p, 0.72, 0.78)) : p < 0.87 ? 1 - ss(seg(p, 0.82, 0.86)) * 0.85 : 0.15 + 0.35 * ss(seg(p, 0.95, 1)); }
// how many of the seven shoji of the house across the garden are lit, and the lights of the room
export function lights(p) {
  return {
    candle: p > 0.004 ? 1 : 0,
    windows: Math.round(7 * ss(seg(p, 0.03, 0.34))),
    paper: ss(seg(p, 0.06, 0.1)),   // light behind the door's paper, before it opens
    door: door(p),
    hang: ss(seg(p, 0.62, 0.7)),    // the hanging lantern
    room: 0.16 * ss(seg(p, 0.62, 0.74)) + 0.12 * ss(seg(p, 0.95, 1)),
    lantern: ss(seg(p, 0.9, 0.96)), // the stone lantern in the garden
  };
}

// ---------- palette: hue ramps x eight tones ----------
const TONES = [0.15, 0.23, 0.32, 0.42, 0.53, 0.65, 0.77, 0.9];
const NT = TONES.length;
const RAMPS = { SUMI: '#2a3160', AI: '#6f8ad0', KABE: '#b9a48e', KI: '#a8703f', AKARI: '#ff9440', KOKE: '#7d9a4c', KAMI: '#f3e9d2', BENI: '#e23c26', KIN: '#f4c24a', ISHI: '#9498a8', HADA: '#ebc4a0', KON: '#3a4f9e', IGUSA: '#a9a262' };
const RAMP_NAMES = Object.keys(RAMPS);
const R = Object.fromEntries(RAMP_NAMES.map((n, i) => [n, i]));
const PALETTE = new Uint32Array(RAMP_NAMES.length * NT);
RAMP_NAMES.forEach((name, ri) => {
  const [, a, b] = hexToOklab(RAMPS[name]);
  TONES.forEach((L, ti) => {
    const f = 0.55 + 0.6 * (1 - Math.abs(L - 0.62) / 0.5); // less chroma at the dark and light ends
    const [r, g, bl] = oklabToRgb([L, a * f, b * f]);
    PALETTE[ri * NT + ti] = (255 << 24) | (bl << 16) | (g << 8) | r;
  });
});
const pal = (ramp, tone) => ramp * NT + cl(Math.round(tone), 0, NT - 1);

// ---------- materials: [ramp, tone at full light, shines by itself] ----------
const MAT = {
  NONE: [R.SUMI, 0, 1],
  SKY: [R.SUMI, 1, 1], SKY2: [R.SUMI, 2, 1], STAR: [R.KAMI, 7, 1], STAR_D: [R.AI, 3, 1], MOON: [R.KAMI, 7, 1], MOON_D: [R.KAMI, 5, 1],
  ROOF: [R.ISHI, 3, 0], ROOF_L: [R.ISHI, 4, 0], HOUSE: [R.KI, 3, 0], PAPER_OFF: [R.AI, 3, 0], PAPER_ON: [R.AKARI, 6, 1], PAPER_ON2: [R.KIN, 7, 1], LATTICE: [R.KI, 1, 1],
  LEAF_D: [R.BENI, 2, 0], LEAF: [R.BENI, 4, 0], LEAF_L: [R.BENI, 5, 0], LEAF_H: [R.AKARI, 5, 0], TRUNK: [R.KI, 2, 0],
  MOSS: [R.KOKE, 4, 0], MOSS_D: [R.KOKE, 3, 0], STONE: [R.ISHI, 5, 0], STONE_D: [R.ISHI, 4, 0], STONE_L: [R.ISHI, 6, 0],
  LAN: [R.ISHI, 4, 0], LAN_FIRE: [R.AKARI, 7, 1], BAMBOO: [R.KOKE, 5, 0], BAMBOO_D: [R.KOKE, 3, 0], WATER: [R.AI, 5, 0], WATER_L: [R.KAMI, 6, 1],
  WOOD: [R.KI, 5, 0], WOOD_D: [R.KI, 4, 0], BEAM: [R.KI, 3, 0], BEAM_D: [R.KI, 2, 0], CEIL: [R.KI, 3, 0], CEIL_D: [R.KI, 2, 0],
  TRANSOM: [R.KAMI, 5, 0], WALL: [R.KABE, 4, 0], WALL_D: [R.KABE, 3, 0],
  DOOR_P: [R.KAMI, 5, 0], DOOR_LIT: [R.AKARI, 6, 1], DOOR_LIT2: [R.KIN, 7, 1], DOOR_SH: [R.KI, 3, 1],
  DW0: [R.KI, 2, 1], DW1: [R.KI, 4, 1], DW2: [R.AKARI, 5, 1], DW3: [R.AKARI, 6, 1], DW4: [R.KIN, 7, 1],
  HANG_OFF: [R.KAMI, 4, 0], HANG_ON: [R.AKARI, 6, 1], HANG_ON2: [R.KIN, 7, 1], HANG_FR: [R.KI, 1, 1],
  TATAMI: [R.IGUSA, 5, 0], TATAMI_D: [R.IGUSA, 4, 0], HERI: [R.SUMI, 1, 1],
  TABLE: [R.KI, 3, 0], TABLE_TOP: [R.KI, 4, 0], CUSHION: [R.KON, 3, 0], CUSHION_L: [R.KON, 4, 0],
  CUP: [R.KAMI, 7, 0], SAUCER: [R.KAMI, 5, 0], POT: [R.ISHI, 2, 0], POT_L: [R.ISHI, 4, 0], TEA: [R.AKARI, 5, 1],
  CANDLE: [R.KAMI, 6, 0], FLAME: [R.KIN, 7, 1], FLAME_C: [R.KAMI, 7, 1], FLAME_O: [R.AKARI, 6, 1], SMOKE: [R.ISHI, 5, 1], STEAM: [R.KAMI, 6, 1], STEAM_D: [R.ISHI, 5, 1],
  HAIR: [R.SUMI, 2, 0], SKIN: [R.HADA, 6, 0], SKIN_D: [R.HADA, 5, 0], KIM: [R.BENI, 4, 0], KIM_D: [R.BENI, 3, 0], KIM_L: [R.BENI, 5, 0], OBI: [R.KIN, 6, 0], KANZ: [R.KIN, 7, 1], COLLAR: [R.KAMI, 7, 0], TABI: [R.KAMI, 6, 0], EYE: [R.SUMI, 0, 1],
  RIM: [R.SUMI, 0, 1],
  CAT: [R.ISHI, 1, 0], CAT_L: [R.AKARI, 4, 0], CAT_EYE: [R.KIN, 7, 1], CAT_PUP: [R.SUMI, 0, 1],
  CRANE: [R.KIN, 7, 1], CRANE_D: [R.KIN, 5, 1], CRANE_W: [R.KAMI, 7, 1], MOTE: [R.KIN, 6, 1], MOTE_D: [R.AKARI, 5, 1],
  LEAF_R: [R.BENI, 5, 1], LEAF_RD: [R.BENI, 3, 1], LEAF_G: [R.KIN, 6, 1],
  WAVE_H: [R.KAMI, 7, 1], WAVE: [R.KIN, 6, 1], WAVE_D: [R.AI, 4, 1],
  GLYPH: [R.KAMI, 7, 1], GLYPH_D: [R.AI, 5, 1], GLYPH_W: [R.KIN, 7, 1],
  BELL: [R.AI, 6, 1], BELL_L: [R.KAMI, 7, 1], TANZAKU: [R.BENI, 5, 1], STRING: [R.ISHI, 4, 1],
};
const MAT_NAMES = Object.keys(MAT);
const M = Object.fromEntries(MAT_NAMES.map((n, i) => [n, i]));
// the colour of each material at each of the eight light levels
const LIT = new Uint8Array(MAT_NAMES.length * 8);
MAT_NAMES.forEach((name, m) => {
  const [r, t, self] = MAT[name];
  for (let lv = 0; lv < 8; lv++) {
    let id;
    if (self) id = pal(r, t);
    else if (lv === 0) id = pal(R.SUMI, t * 0.2);          // unlit: ink
    else if (lv === 1) id = pal(R.SUMI, 0.6 + t * 0.34);
    else if (lv === 2) id = pal(R.AI, t * 0.5 - 0.3);      // moonlight: indigo
    else id = pal(r, lerp(t * 0.45, t, (lv - 3) / 4));     // lit: its own colour, brighter with the light
    LIT[m * 8 + lv] = id;
  }
});

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------- sprites, as rows of letters ----------
const cells = (rows, map) => { const out = []; rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const m = map[row[i]]; if (m != null) out.push([i, j, m]); } }); return out; };
const HEAD = cells([
  '..HHHH..',
  '.HHHHHH.',
  'kHHHHHS.',
  'HHHHSES.',
  '.HHHSSSS',
  '..H.SSS.',
  '....sS..',
], { H: M.HAIR, S: M.SKIN, s: M.SKIN_D, E: M.EYE, k: M.KANZ });
const HEAD_BLINK = cells(['........', '........', '........', '.....S..'], { S: M.SKIN_D });
const CAT_SIT = cells([
  '.C...C..',
  '.CC.CC..',
  '.CCCCC..',
  '.CeCeC..',
  '.CCCCC..',
  '..CCC...',
  '.CCCCC.C',
  '.CCCCCC.',
  '.CCCCCC.',
], { C: M.CAT, e: M.CAT_EYE });
const CAT_LUMP = cells(['..CCCC..', '.CCCCCC.', 'CCCCCCCC'], { C: M.CAT });
const CAT_PEEK = cells(['.C...C..', '.CC.CC..', '.CCCCC..', '.CeCeC..'], { C: M.CAT, e: M.CAT_EYE });
const CRANE_UP = cells(['..G...G..', '..GG.GG..', 'g..GWG..G', '.gGGGGGG.', '...GGG...', '....g....'], { G: M.CRANE, g: M.CRANE_D, W: M.CRANE_W });
const CRANE_DOWN = cells(['g.......G', '.gGGWGGG.', '..GGGGG..', '.GG.g.GG.', '.G.....G.'], { G: M.CRANE, g: M.CRANE_D, W: M.CRANE_W });
const CRANE_FOLD = cells(['...G...', '..GWG..', '.gGGGG.', '..GGG..'], { G: M.CRANE, g: M.CRANE_D, W: M.CRANE_W });
const LEAF_F = [['.X.', 'XXX', '.x.'], ['X.X', '.X.', 'x.X'], ['.x.', 'XXX', '.X.'], ['X.x', '.X.', 'X.X']];
const POT_REST = cells(['..PPP..', '.P...P.', '.PPPPLp', '.PPPPP.', '..PPP..'], { P: M.POT, p: M.POT, L: M.POT_L });
const POT_TILT = cells(['.PP....', 'P..PP..', 'PPPPPL.', '.PPPPPp', '..PPP.p'], { P: M.POT, p: M.POT, L: M.POT_L });
const G_Z = cells(['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'], { X: 1 });
const G_Z_S = cells(['XXX', '.X.', 'XXX'], { X: 1 });
const G_MARK = cells(['XX', 'XX', 'XX', 'XX', '..', 'XX'], { X: 1 });
const G_KO = cells(['XXXX', '...X', '...X', '...X', 'XXXX'], { X: 1 });
const G_N = cells(['X....', '.X..X', '....X', '...X.', 'XXX..'], { X: 1 });

// ---------- the world ----------
export function createPixelTea() {
  const mat = new Uint8Array(N), base = new Uint8Array(N);
  const thr = new Float32Array(N);
  const maps = { moon: new Float32Array(N), candle: new Float32Array(N), house: new Float32Array(N), door: new Float32Array(N), room: new Float32Array(N), lantern: new Float32Array(N), hang: new Float32Array(N) };
  const lensCol = new Float32Array(W);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const cg = canvas.getContext('2d');
  const img = cg.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const rnd = mulberry(20261114);

  // ----- drawing tools (material numbers into the buffer) -----
  let buf = mat;
  const put = (x, y, m) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = m; };
  const rect = (x, y, w, h, m) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, m); };
  const stamp = (list, x, y, only) => { for (const [i, j, m] of list) put(x + i, y + j, only ?? m); };
  const line = (x0, y0, x1, y1, m) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))); for (let i = 0; i <= n; i++) put(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), m); };

  // a scratch sheet for figures: they are drawn here, then stamped with a one-pixel ink rim
  const TW = 44, TH = 40;
  const tmp = new Uint8Array(TW * TH);
  const tput = (x, y, m) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < TW && y < TH) tmp[y * TW + x] = m; };
  const trect = (x, y, w, h, m) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tput(x + i, y + j, m); };
  const tstamp = (list, x, y) => { for (const [i, j, m] of list) tput(x + i, y + j, m); };
  const tline = (x0, y0, x1, y1, w, m) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))); for (let i = 0; i <= n; i++) trect(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), w, w, m); };
  const flush = (wx, wy, ox, oy, rim = true) => {
    // (ox, oy) on the sheet lands on (wx, wy) in the world
    if (rim) for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      if (!tmp[j * TW + i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + dx, b = j + dy; if (a < 0 || b < 0 || a >= TW || b >= TH || !tmp[b * TW + a]) put(wx + a - ox, wy + b - oy, M.RIM); }
    }
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) { const m = tmp[j * TW + i]; if (m) put(wx + i - ox, wy + j - oy, m); }
    tmp.fill(0);
  };

  // ----- the parts that never move, painted once -----
  const canopies = []; // maple leaves as lists of [x, y, material, bough], redrawn each frame so they can sway
  function paintBase() {
    buf = base;
    // sky above the roofs, a moon between the maples, stars
    for (let y = 16; y < 43; y++) for (let x = 41; x < 178; x++) put(x, y, y < 21 ? M.SKY : M.SKY2);
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j <= 9) put(101 + i, 19 + j, (i - 1) * (i - 1) + (j + 1) * (j + 1) > 7 ? M.MOON_D : M.MOON);
    // the house across the garden: tiled roof, wall, veranda (its shoji are drawn each frame)
    for (let y = 22; y < 27; y++) { const inset = (26 - y) * 3; for (let x = 44 + inset; x < 176 - inset; x++) put(x, y, (x + y * 2) % 4 === 0 ? M.ROOF_L : M.ROOF); }
    rect(44, 27, 132, 1, M.BEAM_D);
    rect(46, 28, 128, 8, M.HOUSE);
    rect(44, 36, 132, 1, M.BEAM);
    // garden floor: moss with darker tufts
    for (let y = 37; y < 43; y++) for (let x = 41; x < 178; x++) put(x, y, rnd() < 0.22 ? M.MOSS_D : M.MOSS);
    // stones
    const stone = (x, y, w, h) => { for (let j = 0; j < h; j++) { const cut = j === 0 ? 1 : 0; for (let i = cut; i < w - cut; i++) put(x + i, y + j, j === 0 ? M.STONE_L : i === 0 ? M.STONE_D : M.STONE); } };
    stone(88, 36, 6, 6); stone(95, 33, 5, 9); stone(101, 38, 5, 4); stone(158, 39, 6, 3);
    // stone lantern (toro): cap, fire box, post, foot
    rect(125, 31, 5, 1, M.LAN); rect(124, 32, 7, 1, M.LAN); rect(125, 33, 5, 3, M.LAN); rect(126, 36, 3, 4, M.LAN); rect(124, 40, 7, 2, M.LAN);
    // water basin for the deer-scarer
    rect(75, 40, 6, 2, M.STONE_D); rect(76, 39, 4, 1, M.WATER);
    // trunks of the maples
    line(60, 42, 62, 30, M.TRUNK); line(61, 42, 63, 30, M.TRUNK); line(62, 34, 54, 26, M.TRUNK); line(63, 33, 72, 25, M.TRUNK);
    line(150, 42, 152, 29, M.TRUNK); line(151, 42, 153, 29, M.TRUNK); line(152, 33, 142, 25, M.TRUNK); line(153, 32, 164, 24, M.TRUNK);
    line(112, 42, 113, 31, M.TRUNK);
    // ceiling, transom of paper panes, beam
    for (let y = 0; y < 9; y++) for (let x = 0; x < W; x++) put(x, y, (x % 24 === 0 || y === 8) ? M.CEIL_D : M.CEIL);
    for (let x = 0; x < W; x++) for (let y = 9; y < 14; y++) put(x, y, (x % 20 === 0 || x % 20 === 19 || y === 9 || y === 13 || (x % 5 === 2 && x % 20 !== 2)) ? M.BEAM_D : M.TRANSOM);
    rect(0, 14, W, 2, M.BEAM_D);
    // left wall with the doorway, posts, right wall
    rect(0, 16, 38, 30, M.WALL); for (let y = 16; y < 46; y += 3) for (let x = (y % 2) * 2; x < 38; x += 5) put(x, y, M.WALL_D);
    rect(P.post, 9, 3, 37, M.BEAM_D); rect(178, 9, 3, 37, M.BEAM_D); rect(181, 16, 11, 30, M.WALL);
    rect(P.door[0] - 1, 17, 1, 29, M.BEAM_D); rect(P.door[1] + 1, 17, 1, 29, M.BEAM_D); rect(P.door[0] - 1, 17, P.door[1] - P.door[0] + 3, 1, M.BEAM_D);
    // engawa boards
    for (let x = 0; x < W; x++) { put(x, 43, M.WOOD); put(x, 44, x % 12 === 0 ? M.WOOD_D : M.WOOD); put(x, 45, M.WOOD_D); }
    // tatami with its dark borders
    for (let y = 46; y < H; y++) for (let x = 0; x < W; x++) put(x, y, y % 2 === 0 && (x + y) % 4 === 0 ? M.TATAMI_D : M.TATAMI);
    rect(0, 51, W, 1, M.HERI);
    for (const x of [22, 74, 126, 178]) for (let y = 46; y < H; y++) put(x + Math.round((y - 46) * (x - 96) * 0.012), y, M.HERI);
    // cushions
    rect(95, 54, 16, 2, M.CUSHION); rect(96, 54, 14, 1, M.CUSHION_L); rect(152, 54, 15, 2, M.CUSHION); rect(153, 54, 13, 1, M.CUSHION_L);
    buf = mat;
    // maple crowns: each a few hundred leaf pixels in four boughs, dark inside, bright at the edges
    const crown = (cx, cy, rw, rh, n, seed) => {
      const r2 = mulberry(seed), list = [];
      for (let i = 0; i < n; i++) {
        const a = r2() * Math.PI * 2, d = Math.sqrt(r2());
        const x = Math.round(cx + Math.cos(a) * d * rw), y = Math.round(cy + Math.sin(a) * d * rh * (0.75 + 0.25 * Math.cos(a)));
        if (y < 16 || y > 34) continue;
        const edge = d + (y < cy ? 0.15 : -0.1) + (r2() - 0.5) * 0.5;
        list.push([x, y, edge > 0.95 ? M.LEAF_H : edge > 0.7 ? M.LEAF_L : edge > 0.35 ? M.LEAF : M.LEAF_D, Math.floor(((x - (cx - rw)) / (2 * rw)) * 4)]);
      }
      canopies.push({ cx, list });
    };
    crown(62, 23, 19, 8, 620, 5); crown(152, 22, 23, 9, 820, 9); crown(113, 26, 8, 5, 170, 13);
  }

  // ----- light: how strongly each source reaches each pixel -----
  function buildLight() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      thr[i] = (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
      const garden = x >= 41 && x < 178 && y >= 16 && y < 43;
      const inRoom = !garden;
      // moon: the garden, and a slanted patch on the engawa and the front mats
      let moon = garden ? 0.33 : 0.09;
      if (y >= 43) { const reach = cl(1 - (y - 43) / 13), band = x > 46 + (y - 43) * 1.4 && x < 176 + (y - 43) * 0.6 ? 1 : 0; moon = 0.09 + 0.2 * reach * band; }
      maps.moon[i] = moon;
      // candle on the table: a pool of light, stronger below and beside than above
      { const dx = x - P.candle[0], dy = (y - (P.candle[1] - 3)) * 1.25, d2 = dx * dx + dy * dy; maps.candle[i] = (inRoom || y > 30 ? 1 : 0.5) * 1.15 / (1 + d2 / (15 * 15)); }
      // the house's windows: they light the garden from behind, and a little of the engawa
      maps.house[i] = garden ? 0.2 + 0.42 * Math.exp(-((y - 33) * (y - 33)) / 46) : y >= 43 && y < 47 ? 0.2 : y >= 47 ? 0.06 * cl(1 - (y - 47) / 8) : 0.03;
      // the open doorway: a fan of warm light across the wall and the mats to its right
      { const dx = x - 16, dy = (y - 40) * 1.3, d2 = dx * dx + dy * dy; maps.door[i] = inRoom && x < 100 ? 1.05 / (1 + d2 / (20 * 20)) : 0; }
      // the room's own soft light once the tea begins
      maps.room[i] = inRoom ? (y < 14 ? 0.4 : y < 46 ? 0.85 : 1) : 0.2;
      // the hanging lantern by the right post: the room's own lamp
      { const dx = x - P.hang[0], dy = (y - (P.hang[1] + 5)) * 0.9, d2 = dx * dx + dy * dy; maps.hang[i] = (y < 14 ? 0.45 : inRoom ? 1.25 : 0.7) / (1 + d2 / (26 * 26)); }
      // the stone lantern in the garden
      { const dx = x - P.lantern[0], dy = (y - P.lantern[1]) * 1.2, d2 = dx * dx + dy * dy; maps.lantern[i] = garden ? 0.9 / (1 + d2 / (11 * 11)) : 0; }
    }
  }
  paintBase(); buildLight();

  // ----- state of the small decorative things (never the story) -----
  const S = { waves: [], lastBeat: -1, drift: [], motes: [], konAt: -9, konSeen: -1, startle: -9, events: [] };
  const stars = Array.from({ length: 16 }, () => [41 + Math.floor(rnd() * 136), 16 + Math.floor(rnd() * 6), rnd() * 6.28]);

  // how strongly a wave front is passing column x right now (0..1)
  // how strongly a wave front is passing each column right now (0..1), worked out once a frame
  const waveCol = new Float32Array(W);
  const fillWaves = () => {
    waveCol.fill(0);
    for (const w of S.waves) for (let x = Math.max(0, Math.floor(P.bell[0] - w.r - 6)); x <= Math.min(W - 1, Math.ceil(P.bell[0] + w.r + 6)); x++) {
      const near = 1 - Math.abs(w.r - Math.abs(x - P.bell[0])) / 6;
      if (near > 0 && w.p * near > waveCol[x]) waveCol[x] = w.p * near;
    }
  };
  const waveAt = (x) => waveCol[cl(Math.round(x), 0, W - 1)];

  function drawTraveller(T, o) {
    if (T.shown <= 0.01) return null;
    const OX = 20, OY = 36; // sheet position of the point between the feet
    const phase = (T.steps % 1);
    const stride = T.walking ? (phase < 0.5 ? 1 : -1) : 0;
    const bob = T.walking && (phase % 0.5) > 0.25 ? 1 : 0;
    const breath = !T.walking && o.idle > 1.2 && Math.sin(o.t * 1.6) > 0.3 ? 1 : 0;
    const seated = T.sit > 0.5;
    const drop = Math.round(lerp(0, 9, T.sit)); // how far the shoulders come down when kneeling
    const top = OY - 24 + drop + bob + (seated ? 0 : 0);
    const sh = top + 7;
    // kimono: shoulders to hem; seated it spreads forward over the knees
    if (!seated) {
      for (let r = 0; r < OY - sh; r++) { const half = 3 + (r > 9 ? 1 : 0); for (let i = -half; i < half + (r > 5 ? 1 : 0); i++) tput(OX + i, sh + r, i === -half ? M.KIM_D : i >= half - 1 ? M.KIM_L : M.KIM); }
      // feet in white tabi, stepping
      tput(OX - 2 - stride, OY, M.TABI); tput(OX - 1 - stride, OY, M.TABI); tput(OX + 1 + stride, OY - (stride < 0 ? 1 : 0), M.TABI); tput(OX + 2 + stride, OY - (stride < 0 ? 1 : 0), M.TABI);
    } else {
      for (let r = 0; r < 7; r++) for (let i = -3; i < 3; i++) tput(OX + i, sh + r, i === -3 ? M.KIM_D : i >= 2 ? M.KIM_L : M.KIM);
      for (let r = 0; r < 3; r++) for (let i = -4; i < 6; i++) tput(OX + i, sh + 7 + r, i === -4 ? M.KIM_D : r === 0 && i > 2 ? M.KIM_L : M.KIM);
      tput(OX - 4, OY, M.TABI); tput(OX - 3, OY, M.TABI);
    }
    // collar and obi
    tput(OX + 1, sh, M.COLLAR); tput(OX + 2, sh + 1, M.COLLAR); tput(OX + 1, sh + 2, M.COLLAR);
    const obiY = sh + (seated ? 5 : 6);
    trect(OX - 3, obiY, 6, 2, M.OBI);
    // head, turned down to the cat or up to the crane by a pixel
    const hy = top + (T.lookDown > 0.5 ? 1 : 0) - (T.lookUp > 0.5 ? 1 : 0) - breath + (o.nod && seated ? 1 : 0); // seated, a small nod on every other beat
    tstamp(HEAD, OX - 4 + (T.lookDown > 0.5 ? 1 : 0), hy);
    if (o.idle > 1.2 && (o.t % 4.2) < 0.14) tstamp(HEAD_BLINK, OX - 4 + (T.lookDown > 0.5 ? 1 : 0), hy);
    // arm and sleeve: hanging, sliding the door, pouring, holding the cup
    const wx = Math.round(T.x), wy = P.floor;
    const sx = OX + 2, sy = sh + 1;
    const rest = seated ? [sx + 4, sy + 6] : [sx + 1 + (T.walking ? stride : 0), sy + 8];
    let hand = rest;
    if (T.push > 0.05) hand = [sx - 2 - Math.round(4 * T.push), sy + 3];
    else if (T.cupReach > 0) { const atCup = [OX + P.cup[0] - 3 - wx, OY + P.cup[1] - 2 - wy]; hand = T.cup > 0 ? mix2(atCup, [OX + 5, top + 6], T.cup) : mix2(rest, atCup, T.cupReach); }
    else if (T.grip > 0) hand = mix2(rest, [OX + o.potAt[0] - 1 - wx, OY + o.potAt[1] - wy], T.grip);
    hand = [Math.round(hand[0]), Math.round(hand[1])];
    const sway = Math.round(o.sleeve || 0);
    tline(sx, sy, hand[0], hand[1], 2, M.KIM_D);
    // the hanging part of the sleeve
    const mx = Math.round((sx + hand[0]) / 2), my = Math.round((sy + hand[1]) / 2);
    trect(mx - 1 + sway, my + 1, 3, 3, M.KIM_D); tput(mx + sway, my + 4, M.KIM_D);
    tput(hand[0] + 1, hand[1], M.SKIN); tput(hand[0] + 1, hand[1] + 1, M.SKIN);
    if (T.cup > 0) trect(hand[0] + 2, hand[1] - 1, 3, 2, M.CUP);
    // fade in at the door: drawn only once more than half there
    if (T.shown < 0.5) { tmp.fill(0); return null; }
    flush(wx, wy, OX, OY);
    return true;
  }

  function drawCat(C, o, under) {
    const x = Math.round(C.x), y = Math.round(C.y);
    const front = waveAt(x) > 0.35;
    const blink = (o.idle > 1.2 && (o.t % 3.6) < 0.15) || o.catBlink;
    const lookUp = Math.max(C.up, o.catUp) > 0.5;
    if (under) {
      // under the table: a dark lump that breathes; then the ears catch the light, then the eyes open
      if (C.asleep || C.ears < 1) {
        stamp(CAT_LUMP, x - 4, y - 2 - (C.asleep && Math.sin(o.t * 1.3) > 0.6 ? 0 : 0));
        if (C.ears > 0.3) { put(x - 2, y - 3, M.CAT_L); put(x + 2, y - 3, M.CAT_L); }
        if (C.ears > 0.75) { put(x - 2, y - 4, M.CAT_L); put(x + 2, y - 4, M.CAT_L); }
        return;
      }
      const tilt = C.tilt > 0.5 ? 1 : 0;
      stamp(CAT_LUMP, x - 4, y - 2);
      stamp(CAT_PEEK, x - 4 + tilt, y - 5);
      put(x - 3 + tilt, y - 5, M.CAT_L); put(x + 1 + tilt, y - 5, M.CAT_L);
      if (C.eyes < 0.5 || blink) { put(x - 2 + tilt, y - 2, M.CAT); put(x + tilt, y - 2, M.CAT); }
      return;
    }
    const OX = 14, OY = 30;
    const up = lookUp ? 1 : 0;
    // body and head as one sitting cat; the head lifts to follow the crane
    tstamp(CAT_SIT.filter(([, j]) => j >= 5), OX - 4, OY - 8);
    tstamp(CAT_SIT.filter(([, j]) => j < 5), OX - 4 + (front ? 0 : 0), OY - 8 - up);
    if (front) tput(OX - 3, OY - 9 - up, M.CAT); // an ear flicks as a wave passes
    if (blink) { tput(OX - 2, OY - 5 - up, M.CAT); tput(OX, OY - 5 - up, M.CAT); }
    // the eyes follow the crane
    if (!blink && o.craneDir) { tput(OX - 2 + (o.craneDir > 0 ? 0 : 0), OY - 5 - up, M.CAT_EYE); }
    // tail: curls, swings on the beat
    const tw = o.beatOn ? 1 : 0;
    tput(OX + 3, OY - 2, M.CAT); tput(OX + 4, OY - 3 - tw, M.CAT); tput(OX + 4 + tw, OY - 4 - tw, M.CAT);
    // a paw: reaches for the leaf, or for the motes when it waits in the crane scene
    const chase = C.up > 0.5 && o.idle > 1.2 && Math.sin(o.t * 2.4) > 0 ? 1 : 0;
    const paw = Math.max(C.paw, chase);
    if (paw > 0.2) { tput(OX - 4, OY - 3, M.CAT); tput(OX - 5, OY - 4 - Math.round(paw * 2), M.CAT); tput(OX - 5, OY - 5 - Math.round(paw * 2), M.CAT_L); }
    // warm rim on the side of the candle
    tput(OX - 4, OY - 6 - up, M.CAT_L); tput(OX - 4, OY - 1, M.CAT_L);
    flush(x, y, OX, OY);
  }

  function glyph(list, x, y, m, rim = M.RIM) {
    for (const [i, j] of list) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + i + dx, y + j + dy, rim);
    for (const [i, j] of list) put(x + i, y + j, m);
  }

  // ----- one frame of the world -----
  // o: { p, t, dt, still, playing, vol, beat, low, mid, high, trans, idle, speed, catUp, catBlink, lensX, poke }
  function render(o) {
    const p = cl(o.p), t = o.t, still = o.still;
    const Lg = lights(p);
    const beat = o.playing && o.beat != null ? o.beat : null;
    const bi = beat == null ? -1 : Math.floor(beat), bf = beat == null ? 0 : beat - bi;
    const pulse = beat == null ? 0 : Math.exp(-bf * 5); // 1 on the beat, falling away
    S.events.length = 0;

    // waves: one ring from the bell on every beat, travelling as far as the lens
    const reach = cl((o.lensX ?? W) - P.bell[0] + 12, 14, 132);
    if (beat != null && bi !== S.lastBeat && !still) {
      S.lastBeat = bi;
      if (o.vol > 0.01) S.waves.push({ r: 2, p: cl(0.35 + o.vol * 0.5 + (bi % 4 === 0 ? 0.15 : 0)) });
    }
    for (const w of S.waves) w.r += (o.dt || 0.033) * 46;
    S.waves = S.waves.filter((w) => {
      if (w.r < Math.max(reach, w.min || 0)) return true;
      if (!w.min) S.events.push('reach'); // a ring of the music has arrived at the glass
      return false;
    });

    fillWaves();
    mat.set(base);
    buf = mat;

    // stars twinkle
    for (const [x, y, ph] of stars) put(x, y, still || Math.sin(t * 1.1 + ph) > -0.2 ? M.STAR : M.STAR_D);

    // the house's shoji light up one by one with the volume; the low end of the music makes one glow
    const hot = beat == null ? -1 : (bi * 3) % 7;
    for (let i = 0; i < 7; i++) {
      const x = 48 + i * 18, on = i < Lg.windows;
      const m = on ? (i === hot && o.low > 0.55 && bf < 0.5 ? M.PAPER_ON2 : M.PAPER_ON) : M.PAPER_OFF;
      rect(x, 29, 14, 6, m);
      for (const dx of [4, 9]) rect(x + dx, 29, 1, 6, M.LATTICE);
      rect(x, 31, 14, 1, M.LATTICE);
    }

    // maples: every bough sways a pixel with the mid range, with the gust of chapter 4, and as a wave passes
    const gust = p > 0.5 && p < 0.64 ? Math.sin(Math.PI * seg(p, 0.5, 0.64)) : 0;
    const shake = o.poke.maple < 1.5 ? (1 - o.poke.maple / 1.5) : 0;
    const sway = [0, 0, 0, 0];
    for (const c of canopies) {
      // each bough's own sway, once per bough; the wave adds per column
      for (let k = 0; k < 4; k++) sway[k] = still ? 0 : Math.sin(t * (0.9 + k * 0.17) + k * 1.7 + c.cx) * (0.35 + o.mid * 0.9) + gust * 1.6 + shake * Math.sin(t * 18 + k) * 1.5;
      for (const [x, y, m, bough] of c.list) {
        const wv = still ? 0 : waveCol[x < 0 ? 0 : x >= W ? W - 1 : x];
        put(x + Math.round(sway[bough < 0 ? 0 : bough > 3 ? 3 : bough] + wv * 1.3), y + (wv > 0.6 && (x + y) % 3 === 0 ? 1 : 0), m);
      }
    }

    // leaves drifting down in the garden: a few always, more with the volume and on the beat
    if (!still) {
      const phrase = beat != null && beat % 32 < 2 ? 1 : 0;
      const want = 2 + Math.round(p * 7) + (gust > 0.3 ? 5 : 0) + phrase * 5;
      if (S.drift.length < want && (rnd() < 0.08 + pulse * 0.2 + phrase * 0.4 || shake > 0.5)) { const c = canopies[rnd() < 0.6 ? 1 : 0]; S.drift.push({ x: c.cx + (rnd() - 0.5) * 30, y: 24 + rnd() * 6, v: 4 + rnd() * 5, ph: rnd() * 6.28, f: 0 }); }
      const dt = o.dt || 0.033;
      S.drift = S.drift.filter((q) => {
        q.y += q.v * dt; q.x += (Math.sin(t * 1.6 + q.ph) * 4 - gust * 9 - waveAt(q.x) * 6) * dt; q.f += dt * 5;
        put(q.x, q.y, (q.f | 0) % 2 ? M.LEAF_R : M.LEAF_RD);
        return q.y < 41 && q.x > 42 && q.x < 177;
      });
    }

    // stone lantern lights up near the end
    if (Lg.lantern > 0.5) { rect(126, 33, 3, 2, M.LAN_FIRE); }

    // deer-scarer: the bamboo fills for two bars, tips, and knocks back on the stone
    {
      const [sx, sy] = P.scarer;
      const cyc = beat == null ? 0 : (beat % 8) / 8;
      const tip = cyc > 0.86 && cyc < 0.95, knock = cyc >= 0.95;
      rect(sx + 3, sy - 1, 1, 4, M.BAMBOO_D); // the post
      if (tip) { line(sx, sy - 2, sx + 7, sy + 1, M.BAMBOO); put(sx + 8, sy + 1, M.WATER_L); put(sx + 8, sy + 2, M.WATER_L); }
      else { line(sx, sy + 1, sx + 7, sy - 2, M.BAMBOO); put(sx, sy + 1, M.BAMBOO_D); }
      // the spout that feeds it, a drop falling in time with the beat
      rect(sx + 9, sy - 4, 1, 3, M.BAMBOO_D); rect(sx + 7, sy - 4, 3, 1, M.BAMBOO);
      if (beat != null && bf < 0.5) put(sx + 7, sy - 3 + Math.round(bf * 3), M.WATER_L);
      if (knock && beat != null) {
        const k = Math.floor(beat / 8);
        if (k !== S.konSeen) { S.konSeen = k; S.konAt = t; S.events.push('kon'); }
      }
      const ka = t - S.konAt;
      if (ka < 1.1 && !still) { const up = Math.round(ka * 5); glyph(G_KO, sx - 3, sy - 12 - up, ka > 0.7 ? M.GLYPH_D : M.GLYPH); glyph(G_N, sx + 3, sy - 12 - up, ka > 0.7 ? M.GLYPH_D : M.GLYPH); }
    }

    // the wind bell under the eave: glass, clapper, a red paper strip that swings on the beat and in the gust
    {
      const [bx, by] = P.bell;
      const swing = still ? 0 : Math.round(Math.sin((beat ?? t * 0.6) * Math.PI) * (beat == null ? 0.6 : 1.4) + gust * 1.5);
      rect(bx, 16, 1, 2, M.STRING);
      rect(bx - 1, by, 3, 1, M.BELL_L); rect(bx - 1, by + 1, 3, 2, M.BELL); put(bx, by + 1, M.BELL_L);
      put(bx + (swing > 0 ? 1 : swing < 0 ? -1 : 0), by + 3, M.STRING);
      rect(bx + swing, by + 4, 1, 4, M.TANZAKU); put(bx + swing + (swing >= 0 ? 1 : -1), by + 6, M.TANZAKU);
    }

    // the hanging lantern by the right post: sways on the beat, in the gust and as a wave passes
    {
      const [hx, hy] = P.hang;
      const sw = still ? 0 : Math.round(Math.sin((beat ?? t * 0.5) * Math.PI * 0.5) * 0.7 + gust * 1.2 + waveAt(hx) * 1.4);
      const on = Lg.hang > 0.5, hot = on && (pulse > 0.55 || o.low > 0.75);
      put(hx, hy, M.STRING); put(hx + (sw > 0 ? 1 : sw < 0 ? -1 : 0), hy + 1, M.STRING);
      rect(hx - 1 + sw, hy + 2, 3, 1, M.HANG_FR);
      for (let j = 0; j < 5; j++) for (let i = -2; i <= 2; i++) put(hx + i + sw, hy + 3 + j, !on ? M.HANG_OFF : (Math.abs(i) < 2 && j > 0 && j < 4 && (hot || i === 0)) ? M.HANG_ON2 : M.HANG_ON);
      rect(hx - 1 + sw, hy + 8, 3, 1, M.HANG_FR); put(hx + sw, hy + 9, M.TANZAKU); put(hx + sw + (sw > 0 ? 1 : 0), hy + 10, M.TANZAKU);
    }

    // the sound: rings of dots spreading from the bell; they thin out as they travel
    if (!still) for (const w of S.waves) {
      const fade = cl(w.r / reach);
      const m = fade < 0.3 ? M.WAVE_H : fade < 0.7 ? M.WAVE : M.WAVE_D;
      const thick = 1 + Math.round(w.p * 1.6);
      for (let k = 0; k < thick; k++) {
        const r = w.r - k; if (r < 3) continue;
        const stepA = 0.8 / Math.max(r, 6);
        for (let a = -0.35; a <= 1.25; a += stepA) {
          const x = Math.round(P.bell[0] + Math.cos(a) * r), y = Math.round(P.bell[1] + 1 + Math.sin(a) * r * 0.62);
          if (x < 41 || x > 177 || y < 16 || y > 57) continue;
          const drop = k * 0.3 + fade * fade * 0.7 + (a < 0 ? 0.3 : 0);
          if ((BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16 < drop) continue;
          put(x, y, k === 0 ? m : M.WAVE_D);
        }
      }
    }

    // the red leaf of the story, in the garden
    const L = leaf(p);
    const drawLeaf = (x, y, rot, m1, m2) => { const f = LEAF_F[((rot * 0.9) | 0) & 3]; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const ch = f[j][i]; if (ch !== '.') put(Math.round(x) - 1 + i, Math.round(y) - 1 + j, ch === 'X' ? m1 : m2); } };
    const spin = L.flying ? 1 + o.speed * 1.5 : 1;
    if (L.y < 43) drawLeaf(L.x, L.y, L.rot * spin + (still ? 0 : waveAt(L.x) * 2), M.LEAF_R, M.LEAF_RD);

    // the sliding door, the traveller's shadow on its paper, the bright room behind it
    {
      const T0 = traveller(p), open = Lg.door;
      const [d0, d1] = P.door, wdt = d1 - d0 + 1, off = Math.round(open * (wdt - 3));
      for (let y = 18; y < 46; y++) for (let x = d0; x <= d1; x++) {
        const v = 1 - Math.hypot(x - (d0 + 9), (y - 28) * 0.75) / 21 + (thr[y * W + x] - 0.5) * 0.3 - (y > 41 ? 0.35 : 0);
        put(x, y, v > 0.82 ? M.DW4 : v > 0.56 ? M.DW3 : v > 0.3 ? M.DW2 : v > 0.08 ? M.DW1 : M.DW0);
      }
      for (let x = d0; x <= d1 - off; x++) for (let y = 18; y < 46; y++) {
        const lx = x - d0 + off; // position on the panel
        const glow = Lg.paper - Math.hypot(lx - 11, (y - 30) * 0.7) / 26; // the light comes up from the middle of the paper
        put(x, y, lx % 6 === 5 || y % 7 === 3 ? M.LATTICE : glow > 0.62 + thr[y * W + x] * 0.22 ? M.DOOR_LIT2 : glow > thr[y * W + x] * 0.5 ? M.DOOR_LIT : M.DOOR_P);
      }
      if (T0.shadow > 0.15 && off < wdt - 8) { // a figure behind the paper
        const cx = d0 + 12 - off;
        for (let y = 24; y < 46; y++) { const half = y < 29 ? 2 : y < 31 ? 1 : 3 + (y > 40 ? 1 : 0); for (let x = cx - half; x <= cx + half; x++) if (x >= d0 && x <= d1 - off && (x - d0 + off) % 6 !== 5 && y % 7 !== 3) put(x, y, M.DOOR_SH); }
      }
    }

    const T = traveller(p), C = cat(p), Cr = crane(p);
    // under the table: shadow, the cat while it hides there
    rect(P.table[0] + 2, 55, P.table[1] - P.table[0] - 3, 1, M.HERI);
    if (C.out < 0.5) drawCat(C, o, true);
    // the table and what stands on it
    rect(P.table[0] + 2, 51, 2, 4, M.TABLE); rect(P.table[1] - 3, 51, 2, 4, M.TABLE);
    rect(P.table[0], P.tableTop, P.table[1] - P.table[0] + 1, 2, M.TABLE); rect(P.table[0], P.tableTop, P.table[1] - P.table[0] + 1, 1, M.TABLE_TOP);
    rect(P.cup[0] - 2, P.cup[1], 5, 1, M.SAUCER);
    if (T.cup <= 0) { rect(P.cup[0] - 1, P.cup[1] - 2, 3, 2, M.CUP); if (p > 0.74) put(P.cup[0], P.cup[1] - 2, M.TEA); } // tea in the cup, until it is lifted
    rect(P.candle[0] - 1, P.candle[1] - 2, 3, 3, M.CANDLE);
    // the iron kettle: at rest, lifted, tilted over the cup
    const PP = pourPose(p);
    const pot = mix2([P.pot[0] - 3, P.pot[1] - 4], [P.cup[0] - 6, P.cup[1] - 10], PP.hold).map(Math.round);
    drawTraveller(T, { ...o, nod: pulse > 0.6 && bi % 2 === 0 && o.idle > 1.2, potAt: [pot[0] + 3, pot[1]], sleeve: still ? 0 : Math.sin(t * 1.3) * (0.3 + o.mid) + waveAt(T.x) * 1.2 });
    stamp(PP.flow > 0.3 ? POT_TILT : POT_REST, pot[0], pot[1]);
    if (PP.flow > 0.05) for (let yy = pot[1] + 5; yy < P.cup[1] - 2; yy++) if (PP.flow > 0.5 || (yy + ((t * 12) | 0)) % 2) put(pot[0] + 6, yy, M.TEA);
    if (C.out >= 0.5) drawCat(C, { ...o, craneDir: Cr ? Math.sign(Cr.x - C.x) : 0, beatOn: pulse > 0.5 }, false);
    if (L.y >= 43) drawLeaf(L.x, L.y, L.rot * spin, M.LEAF_R, M.LEAF_RD);

    // candle flame: leans as a wave passes, pulses on the beat, flickers with the high range
    {
      const [cx, cy] = P.candle;
      if (Lg.candle) {
        const lean = still ? 0 : (waveAt(cx) > 0.3 ? 1 : 0) + (gust > 0.5 ? 1 : 0);
        const tall = (pulse > 0.6 || o.high > 0.7 || o.poke.candle < 0.8) ? 1 : 0;
        const fl = !still && Math.sin(t * 13) * Math.sin(t * 7.3) > 0.55 ? 1 : 0;
        put(cx, cy - 3, M.FLAME_O); put(cx + (fl ? lean : 0), cy - 4, M.FLAME); put(cx, cy - 3, M.FLAME_C);
        if (tall) put(cx + lean, cy - 5, M.FLAME_O);
      } else if (!still) { const k = (t * 0.4) % 1; put(cx + Math.round(Math.sin(k * 6)), cy - 3 - Math.round(k * 5), M.SMOKE); } // a thread of smoke when it is out
    }

    // steam from the cup: curls, bends with the waves, gathers for the crane
    const st = steam(p);
    if (st > 0.02 && !still) for (let i = 0; i < 6; i++) {
      const k = (t * 0.3 + i / 6) % 1;
      if (k > st * 1.1) continue;
      const x = P.cup[0] + Math.round(Math.sin(t * 1.4 + i * 1.9) * (0.6 + k * 2) + waveAt(P.cup[0]) * 2 * k), y = P.cup[1] - 3 - Math.round(k * 10);
      put(x, y, k < 0.6 ? M.STEAM : M.STEAM_D);
    }

    // the crane: motes gather, it unfolds, beats its wings, flies; then a golden leaf
    let craneLight = null;
    if (Cr) {
      const cx = Math.round(Cr.x), cy = Math.round(Cr.y);
      if (Cr.form < 1) for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + t * 0.9, r = (1 - Cr.form) * 8; put(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6 + (1 - Cr.form) * 5, i % 2 ? M.MOTE : M.STEAM); }
      if (Cr.leafK > 0.5) drawLeaf(Cr.x, Cr.y, (Cr.fall || 0) * 7, M.LEAF_G, M.CRANE_D);
      else if (Cr.form > 0.4) {
        const fold = Cr.wing < 0.5;
        const upBeat = still ? true : Math.sin(t * (Cr.fly > 0 ? 11 : 3)) > 0;
        const spr = fold ? CRANE_FOLD : upBeat ? CRANE_UP : CRANE_DOWN;
        const w = fold ? 7 : 9;
        for (const [i, j, m] of spr) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(cx - (w >> 1) + i + dx, cy - 3 + j + dy, M.RIM);
        stamp(spr, cx - (w >> 1), cy - 3);
      }
      // a few sparks in its wake, more on a transient
      if (!still && Cr.form > 0.6) for (let i = 0; i < 3 + Math.round(o.trans * 4); i++) { const a = t * 3 + i * 2.1; put(cx - 3 - i * 2 + Math.round(Math.sin(a) * 1.5), cy + Math.round(Math.cos(a) * 2), i % 2 ? M.MOTE : M.MOTE_D); }
      craneLight = [Cr.x, Cr.y, 0.95 * Cr.glow * (0.8 + 0.3 * o.high + 0.3 * pulse)];
    }
    // golden motes rising by the maple at the end
    {
      const k = ss(seg(p, 0.95, 0.985));
      if (k > 0) { const r3 = mulberry(311); for (let i = 0; i < 12; i++) { const x = 146 + r3() * 28, y0 = 20 + r3() * 18, ph = r3(); const y = y0 - (still ? 0 : ((t * 0.14 + ph) % 1) * 6); if (r3() < k && (still || Math.sin(t * 2 + ph * 9) > -0.3 || o.trans > 0.5)) put(x, y, i % 3 ? M.MOTE : M.MOTE_D); } }
    }

    // signs: the sleeping cat's z z z, an exclamation mark when the slider is flung
    if (!still && p < 0.33) for (let i = 0; i < 2; i++) {
      const k = (t * 0.3 + i * 0.5) % 1, x = P.cat[0] - 1 + Math.round(k * 7), y = 45 - Math.round(k * 9);
      if (k < 0.45) stamp(G_Z_S, x, y, k < 0.12 ? M.GLYPH_D : M.GLYPH); else glyph(G_Z, x, y - 2, k > 0.85 ? M.GLYPH_D : M.GLYPH);
    }
    if (o.catUp > 0.6 && S.startle < t - 1.2) S.startle = t;
    if (t - S.startle < 0.7 && C.visible) glyph(G_MARK, Math.round(C.x) + 3, Math.round(C.y) - (C.out >= 0.5 ? 17 : 11), M.GLYPH_W);

    // ---- light ----
    const flick = still ? 0 : Math.sin(t * 11.3) * Math.sin(t * 17.7) * 0.06;
    const sCandle = Lg.candle * (0.82 + flick + 0.12 * pulse + 0.14 * o.high + (o.poke.candle < 1 ? 0.3 * (1 - o.poke.candle) : 0));
    const sHouse = (Lg.windows / 7) * (0.85 + 0.25 * o.low);
    const sDoor = Lg.door * 0.85 + Lg.paper * (1 - Lg.door) * 0.16, sRoom = 0.05 + Lg.room, sLan = Lg.lantern * (0.9 + 0.15 * pulse);
    const sHang = Lg.hang * (0.82 + 0.12 * pulse + 0.1 * o.low);
    const { moon, candle, house, door: dm, room, lantern, hang } = maps;
    const cL = craneLight;
    // the glass gathers a little light: the room is a touch brighter where the lens is
    const lx = o.lensX ?? -99;
    for (let x = 0; x < W; x++) { const d = x - lx; lensCol[x] = 0.15 * Math.exp(-(d * d) / 300); }
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      let Lv = moon[i] + sCandle * candle[i] + sHouse * house[i] + sDoor * dm[i] + sRoom * room[i] + sLan * lantern[i] + sHang * hang[i] + lensCol[x];
      if (cL) { const dx = x - cL[0], dy = y - cL[1]; Lv += cL[2] / (1 + (dx * dx + dy * dy * 1.4) / 90); }
      let lv = (Lv * 7 + thr[i]) | 0;
      if (lv > 7) lv = 7;
      out[i] = PALETTE[LIT[mat[i] * 8 + lv]];
    }
    cg.putImageData(img, 0, 0);
    return S.events;
  }

  // what a tap at world pixel (x, y) lands on
  function hit(x, y, p) {
    const near = (cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;
    const C = cat(p);
    if (near(C.x, C.y - (C.out >= 0.5 ? 5 : 2), 6)) return 'cat';
    if (near(P.candle[0], P.candle[1] - 3, 4.5)) return 'candle';
    const T = traveller(p);
    if (T.shown > 0.5 && near(T.x, P.floor - (T.sit > 0.5 ? 8 : 12), 7)) return 'traveller';
    if (near(P.bell[0], P.bell[1] + 3, 5)) return 'bell';
    if (y > 15 && y < 35 && ((x > 43 && x < 82) || (x > 128 && x < 177))) return 'maple';
    return null;
  }

  return {
    canvas, render, hit,
    ring(power = 0.9) { S.waves.push({ r: 2, p: power, min: 46 }); }, // the bell, rung by hand
    busy: () => S.waves.length > 0,
  };
}
