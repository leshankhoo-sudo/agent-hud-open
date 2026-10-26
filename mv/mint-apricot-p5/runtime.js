// ---------- overlay + frame driver ----------
function textPop(str, x, y, size, a, col = '#fff8ec') {
  if (a <= 0) return; ctx.save(); ctx.globalAlpha = clamp(a); ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * .16; ctx.strokeStyle = 'rgba(150,80,60,.55)'; ctx.strokeText(str, x, y);
  ctx.shadowColor = 'rgba(240,138,75,.6)'; ctx.shadowBlur = size * .4; ctx.fillStyle = col; ctx.fillText(str, x, y); ctx.restore();
}
function lyricLine(L, t) { // characters pop in one after another, then the whole line fades
  ctx.save(); ctx.font = `36px ${FONT}`; const chars = [...L.text], w = chars.map(c => ctx.measureText(c).width), total = w.reduce((a, b) => a + b, 0);
  let x = 640 - total / 2; const out = 1 - ss(L.end - .12, L.end + .1, t);
  chars.forEach((c, i) => { const k = ss(L.start + i * .045, L.start + i * .045 + .18, t), s = easeBack(k);
    ctx.save(); ctx.translate(x + w[i] / 2, 662 + (1 - k) * 14); ctx.scale(s, s); textPop(c, 0, 0, 36, k * out); ctx.restore(); x += w[i]; });
  ctx.restore();
}
function overlay(t, u, info) {
  if (info.title) { const a = ss(.4, 1.4, u) * (1 - ss(5.6, 7, u)); const p = 1 + .04 * pulse(u, 5);
    ctx.save(); ctx.translate(640, 130 + (1 - a) * 14); ctx.scale(p, p); textPop('薄荷 & 杏桃', 0, 0, 80, a); textPop('Mint & Apricot', 0, 64, 28, a * .95); ctx.restore(); }
  if (info.end) { const a = info.end; textPop('留在你眼中', 640, 300, 72, a); textPop('Mint & Apricot · 两个 AI 小精灵的故事', 640, 380, 28, a * .95); }
  for (const L of LYRICS) if (t >= L.start - .05 && t < L.end + .12) lyricLine(L, t);
}
window.renderFrame = function (t) {
  const u = U(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, OUT_W, OUT_H);
  ctx.save(); ctx.scale(K, K);
  const bar = Math.floor(u) % 4 === 0 && u > 0 ? pulse(u, 5) : 0, z = 1 + bar * .04 + pulse(u, 8) * .01;
  ctx.translate(640, 360); ctx.scale(z, z); ctx.rotate((Math.floor(u) % 2 ? 1 : -1) * pulse(u, 7) * .005 * (u > 8)); ctx.translate(-640, -360);
  let i = SCENES.length - 1; while (i > 0 && u < SCENES[i][0]) i--;
  ctx.save(); const info = SCENES[i][1](u, t) || {}; ctx.restore();
  ctx.restore();
  ctx.save(); ctx.scale(K, K);
  const v = ctx.createRadialGradient(640, 360, 300, 640, 360, 820); v.addColorStop(0, 'rgba(60,30,40,0)'); v.addColorStop(1, 'rgba(60,30,40,.3)'); ctx.fillStyle = v; ctx.fillRect(0, 0, 1280, 720);
  transitions(u);
  overlay(t, u, info);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .07; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(grain.elt, (Math.floor(t * 30) % 4) * -16, (Math.floor(t * 30) % 3) * -16); ctx.restore();
  const fade = 1 - ss(-.6, .5, u); if (fade > 0) { ctx.fillStyle = `rgba(255,244,230,${fade})`; ctx.fillRect(0, 0, OUT_W, OUT_H); }
  return true;
};
function setup() {
  createCanvas(OUT_W, OUT_H); pixelDensity(1); noLoop(); ctx = drawingContext;
  grain = createGraphics(OUT_W + 64, OUT_H + 64); grain.pixelDensity(1); grain.loadPixels();
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;   // seeded so every render is identical
  for (let i = 0; i < grain.pixels.length; i += 4) { const v = 128 + (r() - .5) * 255; grain.pixels[i] = grain.pixels[i + 1] = grain.pixels[i + 2] = v; grain.pixels[i + 3] = 255; }
  grain.updatePixels();
  document.fonts.load(`40px ${FONT}`, '薄荷杏桃留在你眼中两个小精灵的故事时光的岸' + LYRICS.map(l => l.text).join('')).then(() => { window.renderFrame(0); window.ready = true; });
}
function draw() { }
