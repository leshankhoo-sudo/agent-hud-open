// Colour interpolation in OKLab (Björn Ottosson, 2020): blends between two sRGB colours keep their
// lightness and hue steadier than a plain RGB mix, so a night-to-day ramp does not pass through a
// muddy grey. Stops are hex strings, spread evenly over 0..1. Results are cached per ramp at
// 1/512 steps, so a frame costs a table look-up, not a conversion.
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b].map((c) => Math.round(255 * Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, c)))))));
}
// ramp(['#000', '#fff'])(t) -> [r, g, b]
export function ramp(stops) {
  const labs = stops.map(hexToOklab);
  const N = 512, table = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = t * (labs.length - 1), k = Math.min(labs.length - 2, Math.floor(x)), f = x - k;
    const a = labs[k], b = labs[k + 1];
    table[i] = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return (t) => table[Math.round(Math.min(1, Math.max(0, t)) * N)];
}
export const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
