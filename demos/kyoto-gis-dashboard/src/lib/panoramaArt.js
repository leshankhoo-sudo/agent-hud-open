// Drawn-for-this-project silhouettes for the panorama between the season story and Explore.
// Everything is plain geometry generated from a fixed seed (the same picture on every load):
// ridge lines from summed sines, a five-storey pagoda, a temple hall, a tower, townhouse roofs,
// a row of torii, trees, a stone lantern and a branch. It is an illustration, not map data, and
// is labelled so on the page. View box: 1600 x 720, horizon near y = 470.
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const f = (n) => Number(n.toFixed(1));
const W = 1600, H = 720;

function ridgeY(x, base, amp, s, k = 1) {
  return base - amp * (0.55 * Math.sin(x * 0.0034 * k + s) + 0.28 * Math.sin(x * 0.0083 * k + s * 2.3) + 0.12 * Math.sin(x * 0.021 * k + s * 4.1) + 0.05 * Math.sin(x * 0.052 * k + s * 7.7));
}
function ridge(base, amp, s, k = 1) {
  let d = `M0 ${H + 220}`;
  for (let x = 0; x <= W; x += 14) d += `L${x} ${f(ridgeY(x, base, amp, s, k))}`;
  return `${d}L${W} ${H + 220}Z`;
}
// roof with upturned eaves: hw = half width at the eaves, h = height
const roof = (cx, y, hw, h, top = 0.42) => `M${f(cx - hw)} ${f(y - h * 0.16)}Q${f(cx - hw * 0.72)} ${f(y - h * 0.05)} ${f(cx - hw * top)} ${f(y - h)}L${f(cx + hw * top)} ${f(y - h)}Q${f(cx + hw * 0.72)} ${f(y - h * 0.05)} ${f(cx + hw)} ${f(y - h * 0.16)}Q${f(cx + hw * 0.5)} ${f(y + h * 0.1)} ${f(cx)} ${f(y + h * 0.08)}Q${f(cx - hw * 0.5)} ${f(y + h * 0.1)} ${f(cx - hw)} ${f(y - h * 0.16)}Z`;
const rect = (x, y, w, h, cls = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${cls ? ` class="${cls}"` : ''}/>`;

function pagoda(cx, base, s = 1) {
  let out = '', y = base;
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const bw = (46 - i * 5) * s, bh = (i ? 17 : 24) * s, hw = (58 - i * 6.5) * s, rh = 17 * s;
    out += rect(cx - bw / 2, y - bh, bw, bh);
    if (i === 0) out += rect(cx - 5 * s, y - 15 * s, 10 * s, 15 * s, 'lamp');
    y -= bh;
    out += `<path d="${roof(cx, y, hw, rh)}"/>`;
    y -= rh * 0.92;
  }
  // finial (sorin): a thin mast with rings
  out += rect(cx - 1.4 * s, y - 46 * s, 2.8 * s, 48 * s);
  for (let i = 0; i < 5; i++) out += `<ellipse cx="${f(cx)}" cy="${f(y - 10 * s - i * 6.4 * s)}" rx="${f((6.4 - i * 0.8) * s)}" ry="${f(1.5 * s)}"/>`;
  return out;
}
function hall(cx, base, s = 1) {
  // wide temple hall on a stage of posts
  let out = '';
  const w = 150 * s;
  for (let i = 0; i <= 8; i++) out += rect(cx - w / 2 + (i * w) / 8 - 1.5 * s, base - 30 * s, 3 * s, 30 * s);
  out += rect(cx - w / 2 - 6 * s, base - 34 * s, w + 12 * s, 5 * s);
  out += rect(cx - w * 0.42, base - 62 * s, w * 0.84, 30 * s);
  for (let i = 0; i < 5; i++) out += rect(cx - w * 0.36 + i * w * 0.165, base - 54 * s, w * 0.07, 16 * s, 'lamp');
  out += `<path d="${roof(cx, base - 60 * s, w * 0.62, 44 * s, 0.3)}"/>`;
  return out;
}
function tower(cx, base, s = 1) {
  // a slim observation tower on a low building
  return rect(cx - 44 * s, base - 30 * s, 88 * s, 30 * s) + rect(cx - 30 * s, base - 40 * s, 60 * s, 11 * s)
    + `<path d="M${f(cx - 9 * s)} ${f(base - 40 * s)}L${f(cx - 5 * s)} ${f(base - 128 * s)}L${f(cx + 5 * s)} ${f(base - 128 * s)}L${f(cx + 9 * s)} ${f(base - 40 * s)}Z"/>`
    + `<path d="M${f(cx - 17 * s)} ${f(base - 128 * s)}Q${f(cx - 20 * s)} ${f(base - 138 * s)} ${f(cx - 13 * s)} ${f(base - 146 * s)}L${f(cx + 13 * s)} ${f(base - 146 * s)}Q${f(cx + 20 * s)} ${f(base - 138 * s)} ${f(cx + 17 * s)} ${f(base - 128 * s)}Z"/>`
    + rect(cx - 15 * s, base - 139 * s, 30 * s, 3 * s, 'lamp')
    + rect(cx - 3 * s, base - 164 * s, 6 * s, 20 * s) + rect(cx - 0.9 * s, base - 196 * s, 1.8 * s, 34 * s);
}
function tree(cx, base, r, rnd) {
  let out = rect(cx - r * 0.07, base - r * 1.1, r * 0.14, r * 1.1);
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) out += `<circle cx="${f(cx + (rnd() - 0.5) * r * 1.3)}" cy="${f(base - r * (1.0 + rnd() * 0.9))}" r="${f(r * (0.45 + rnd() * 0.3))}"/>`;
  return out;
}
function torii(cx, base, s) {
  const w = 44 * s, h = 46 * s;
  return `<g>${rect(cx - w * 0.36, base - h, 4.2 * s, h)}${rect(cx + w * 0.36 - 4.2 * s, base - h, 4.2 * s, h)}${rect(cx - w * 0.44, base - h * 0.74, w * 0.88, 3.6 * s)}`
    + `<path d="M${f(cx - w * 0.62)} ${f(base - h - 7 * s)}Q${f(cx)} ${f(base - h + 1.5 * s)} ${f(cx + w * 0.62)} ${f(base - h - 7 * s)}L${f(cx + w * 0.58)} ${f(base - h + 1 * s)}Q${f(cx)} ${f(base - h + 8 * s)} ${f(cx - w * 0.58)} ${f(base - h + 1 * s)}Z"/></g>`;
}
const LEAF = [[0.5, 0], [0.61, 0.24], [0.82, 0.14], [0.75, 0.38], [1, 0.4], [0.8, 0.56], [0.9, 0.7], [0.64, 0.66], [0.54, 1], [0.46, 1], [0.36, 0.66], [0.1, 0.7], [0.2, 0.56], [0, 0.4], [0.25, 0.38], [0.18, 0.14], [0.39, 0.24]];
const momiji = (x, y, s, rot, cls) => `<polygon class="${cls}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" points="${LEAF.map(([a, b]) => `${f((a - 0.5) * s)},${f((b - 0.5) * s)}`).join(' ')}"/>`;
const blossom = (x, y, s, rot, cls) => `<g class="${cls}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})">${[0, 72, 144, 216, 288].map((a) => `<ellipse transform="rotate(${a})" cx="0" cy="${f(-s * 0.3)}" rx="${f(s * 0.2)}" ry="${f(s * 0.3)}"/>`).join('')}<circle r="${f(s * 0.09)}" class="eye"/></g>`;

export function buildPanorama() {
  const rnd = mulberry(20261113);
  // far and middle ridges; a few strokes on the middle ridge stand for the "大" hillside mark
  const far = `<path d="${ridge(452, 62, 0.6, 0.8)}"/>`;
  const dx = 1010, dy = ridgeY(1010, 486, 84, 2.1) + 34;
  const mid = `<path d="${ridge(486, 84, 2.1)}"/><g class="dai" transform="translate(${f(dx)} ${f(dy)})"><path d="M-17 -6H17M0 -19C0 -6 -5 9 -19 19M1 -5C5 6 11 14 20 18"/></g>`;
  // stylised mist bands (suyari-gasumi): flat bars with round ends, as in yamato-e painting
  const bar = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
  const mistA = bar(-60, 486, 620, 20) + bar(380, 508, 760, 16) + bar(1020, 478, 520, 18) + bar(1320, 502, 360, 14) + bar(120, 524, 300, 12);
  const mistB = bar(620, 604, 560, 16) + bar(1000, 572, 420, 18) + bar(1240, 598, 460, 14) + bar(-100, 676, 520, 18) + bar(470, 692, 640, 14);
  // town: roofs along the valley floor with the landmarks standing above them
  let city = '';
  const base = 560;
  for (let x = -20; x < W + 40;) {
    const w = 40 + rnd() * 44, h = 20 + rnd() * 24;
    city += `<path d="M${f(x)} ${base + 40}V${f(base - h + 9)}L${f(x + w / 2)} ${f(base - h)}L${f(x + w)} ${f(base - h + 9)}V${base + 40}Z"/>`;
    if (rnd() < 0.62) city += rect(x + w * (0.2 + rnd() * 0.5), base - h * 0.5, 4.5, 5.5, 'lamp');
    x += w * (0.72 + rnd() * 0.3);
  }
  city += rect(-60, base + 20, W + 120, 380);
  for (const x of [130, 300, 1190, 1380, 1500]) city += tree(x, base - 6, 20 + rnd() * 10, rnd);
  city += pagoda(612, base - 10, 1.28) + hall(806, base - 8, 0.92) + tower(986, base - 6, 0.98);
  // near hill with a row of torii climbing it, and trees in the season colour
  const hillY = (x) => ridgeY(x, 626, 26, 5.2, 0.7) + Math.max(0, (560 - x) * 0.06);
  let hill = '<path d="M0 940';
  for (let x = 0; x <= W; x += 14) hill += `L${x} ${f(hillY(x))}`;
  hill += `L${W} 940Z"/>`;
  let gates = '';
  for (let i = 0; i < 9; i++) { const x = 250 + i * 37 - i * i * 1.1; gates += torii(x, hillY(x) + 3, 1.06 - i * 0.055); }
  let trees = '';
  for (const x of [60, 150, 640, 720, 1040, 1150, 1290, 1420, 1540]) trees += tree(x, hillY(x) + 4, 24 + rnd() * 16, rnd);
  // foreground: a stone lantern and a branch reaching in from the top left
  const lx = 1296, ly = 640;
  const lantern = `<path d="M-60 940V704Q560 706 980 672T1296 638Q1480 634 1660 652V940Z"/><g>${rect(lx - 34, ly - 12, 68, 14)}${rect(lx - 9, ly - 96, 18, 86)}<path d="M${lx - 30} ${ly - 96}L${lx - 22} ${ly - 108}H${lx + 22}L${lx + 30} ${ly - 96}Z"/>`
    + `${rect(lx - 21, ly - 148, 42, 40)}<path d="${roof(lx, ly - 146, 50, 30, 0.2)}"/><circle cx="${lx}" cy="${ly - 181}" r="6.5"/>`
    + `<rect class="lamp big" x="${lx - 12}" y="${ly - 140}" width="24" height="25" rx="2"/></g>`;
  const twigs = [];
  const limb = 'M-40 44C150 30 300 70 430 128S640 176 760 150';
  const sub = ['M250 62C300 20 360 6 430 0', 'M430 128C470 180 520 200 590 212', 'M560 160C600 120 660 100 720 96', 'M120 40C150 90 200 120 260 132'];
  for (let i = 0; i < 46; i++) {
    const t = rnd();
    const px = -20 + t * 780, py = 40 + Math.sin(t * 2.6) * 70 + (rnd() - 0.35) * 150;
    twigs.push([px, py, 20 + rnd() * 20, rnd() * 360, rnd() < 0.5]);
  }
  const branch = `<g transform="translate(1600 0) scale(-1 1)"><g class="branch"><path d="${limb}" stroke-width="13"/>${sub.map((d) => `<path d="${d}" stroke-width="6"/>`).join('')}</g>`
    + `<g class="f-momiji">${twigs.map(([x, y, s, r, a]) => momiji(x, y, s, r, a ? 'la' : 'lb')).join('')}</g>`
    + `<g class="f-sakura">${twigs.map(([x, y, s, r, a]) => blossom(x, y, s * 0.9, r, a ? 'la' : 'lb')).join('')}</g>`
    + `<g class="f-snow">${twigs.filter((_, i) => i % 2 === 0).map(([x, y, s]) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.9)}" ry="${f(s * 0.3)}"/>`).join('')}</g></g>`;
  const stars = Array.from({ length: 46 }, (_, i) => `<circle cx="${f(rnd() * W)}" cy="${f(rnd() * 330)}" r="${f(0.7 + rnd() * 1.2)}" style="--d:${f(rnd() * 5)}s" class="${i % 3 ? '' : 'tw'}"/>`).join('');
  return { far, mid, mistA, mistB, city, hill, gates, trees, lantern, branch, stars };
}
