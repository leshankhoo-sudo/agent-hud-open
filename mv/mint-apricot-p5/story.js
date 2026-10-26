// ---------- lyric-driven story (times in beats u; B(u) converts to seconds) ----------
const B = u => T0 + BP * u;
// story beats s vs real beats u: line 1 (the walk) plays at double speed in u 0-7, everything after runs 7 beats ahead
const S = u => u < 7 ? u * 2 : u + 7, Sinv = s => s < 14 ? s / 2 : s - 7;
const LINES = [ // [startBeat, endBeat, text]
  [.2, 14, '我曾经走过多遥远的路'], [14, 22, '跨越过多少海洋去看你'], [22, 27, '孤单的黑夜途中'], [27, 31, '只要想着你'], [31, 38, '我就不会惶恐'],
  [38, 43, '时光的岸上'], [43, 47, '人来了又走'], [47, 55, '离开时你不用说我都懂'], [55, 62, '感谢你曾让我'], [62, 68, '留在你眼中']];
LYRICS = LINES.map(([a, b, text]) => ({ start: B(Sinv(a)), end: B(Sinv(b)) - .05, text }));

// ---------- sea, boat, weather ----------
const waveY = (x, u, layer, y0, amp) => y0 + layer * 34 + amp * (Math.sin(x * .0062 + u * Math.PI * .5 + layer * 1.3) * .62 + Math.sin(x * .013 - u * Math.PI * .75 + layer * 2.1) * .38);
function sea(u, y0, cols, amp, from = 0, to = 4, x0 = -500, x1 = 1800) {
  for (let L = from; L < to; L++) {
    const g = ctx.createLinearGradient(0, y0 + L * 34 - amp, 0, y0 + 500); g.addColorStop(0, shade(cols[L], .12)); g.addColorStop(1, shade(cols[L], -.25));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, 2000);
    for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, waveY(x, u, L, y0, amp * (1 + L * .15)));
    ctx.lineTo(x1, 2000); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = x0; x <= x1; x += 16) { const y = waveY(x, u, L, y0, amp * (1 + L * .15)) + 5; x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke(); ctx.restore();
  }
}
const waveTilt = (x, u, layer, y0, amp) => Math.atan2(waveY(x + 20, u, layer, y0, amp) - waveY(x - 20, u, layer, y0, amp), 40);
// teacup boat with a leaf sail; inner(ctx-local) draws the passenger at (0,-34)
function cupBoat(x, y, s, rot, inner, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  // mast + leaf sail
  ctx.strokeStyle = '#c99a72'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(48, -30); ctx.lineTo(48, -210); ctx.stroke();
  const puff = o.sail ?? 1;
  ctx.save(); ctx.translate(48, -200);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-90 * puff, 30, -80 * puff, 120, 0, 150); ctx.bezierCurveTo(-20 * puff, 100, -25 * puff, 40, 0, 0);
  const sg = ctx.createLinearGradient(-80, 0, 0, 150); sg.addColorStop(0, '#c7f5e2'); sg.addColorStop(1, '#6fd3ab'); ctx.fillStyle = sg; ctx.fill();
  ctx.strokeStyle = 'rgba(60,140,110,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 6); ctx.quadraticCurveTo(-40 * puff, 70, -4, 144); ctx.stroke(); ctx.restore();
  if (o.lantern) clayStar(48, -222, 20 * o.lantern, Math.sin(o.u * 2) * .2, '#ffe28a', .8);
  // interior + passenger + front of cup
  ctx.fillStyle = '#e9dcc8'; ctx.beginPath(); ctx.ellipse(0, -34, 82, 18, 0, 0, Math.PI * 2); ctx.fill();
  if (inner) inner();
  ctx.save(); ctx.beginPath(); ctx.moveTo(-82, -34); ctx.bezierCurveTo(-80, 30, 80, 30, 82, -34); ctx.ellipse(0, -34, 82, 18, 0, 0, Math.PI); ctx.closePath();
  const cg = ctx.createRadialGradient(-30, -20, 5, 0, -10, 110); cg.addColorStop(0, '#ffffff'); cg.addColorStop(.6, '#fbf3e6'); cg.addColorStop(1, '#dcc9b0'); ctx.fillStyle = cg; ctx.fill();
  ctx.strokeStyle = '#8fe3c4'; ctx.lineWidth = 9; ctx.beginPath(); ctx.ellipse(0, -14, 76, 14, 0, .1, Math.PI - .1); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = '#efe2cf'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(88, -12, 20, -1.3, 1.5); ctx.stroke();
  ctx.restore();
}
function rain(u, t, n, a = .5) {
  ctx.save(); ctx.strokeStyle = `rgba(200,210,255,${a})`; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) { const x = rnd(i) * 1700 - 200 - ((t * 120) % 100), y = ((rnd(i * 3) * 900 + t * 950) % 900) - 100;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 10, y + 34); ctx.stroke(); }
  ctx.restore();
}
function rainCloud(x, y, w, col) { cloud(x, y, w, col); }
function island(x, y, w, col = '#f6dcb4', grass = '#bfe3c0') {
  clayEll(x, y + 10, w, w * .32, col, { hi: .3 }); clayEll(x, y - 4, w * .86, w * .16, grass, { hi: .3, rim: false });
}
function fish(x, y, s, rot, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = shade(col, -.1); ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-44, -14); ctx.lineTo(-44, 14); ctx.closePath(); ctx.fill();
  clayEll(0, 0, 60, 30, col); ctx.fillStyle = '#3a2a28'; ctx.beginPath(); ctx.arc(16, -4, 3.5, 0, 7); ctx.fill(); ctx.restore();
}
function passerby(x, y, s, col, u, i) { // little clay strangers walking by
  const step = Math.sin(u * Math.PI * 4 + i);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  softShadow(0, 0, 70, .2); clayEll(-12, -6 - Math.max(0, step) * 6, 20, 12, shade(col, -.05)); clayEll(12, -6 - Math.max(0, -step) * 6, 20, 12, shade(col, -.05));
  clayEll(0, -40 - Math.abs(step) * 4, 70, 66, col); ctx.fillStyle = '#3a2a28'; ctx.beginPath(); ctx.arc(-10, -44, 4, 0, 7); ctx.arc(10, -44, 4, 0, 7); ctx.fill(); ctx.restore();
}
function bubble(x, y, r) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); const g = ctx.createRadialGradient(x - r * .3, y - r * .3, 2, x, y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f3e6f5'); ctx.fillStyle = g; ctx.fill(); ctx.restore(); }

// ---------- scenes ----------
const NIGHT = ['#3a3f7a', '#34396f', '#2d3264', '#272b58'], DAYSEA = ['#a9dfe0', '#8fd3d6', '#79c5cc', '#6ab7c2'], DUSK = ['#d79fb4', '#c88fae', '#b781a6', '#a6739c'];
// 0-14 "我曾经走过多遥远的路": a long walk through meadow, desert, snow and autumn, until the road meets the sea
const ZONES = [ // [fromBeat, sky top, sky bottom, far hills, ground]
  [-1, '#f7cdb9', '#fde9d6', '#bfe3c0', '#a9d8a8'], [3, '#ffd59a', '#fff0d0', '#f3cf96', '#f2d29a'],
  [6, '#c9d8ef', '#f4f6fb', '#e3ebf5', '#f7f9fc'], [9, '#f6b98f', '#ffe3c4', '#e9a173', '#e6b17c'], [12, '#f7cdb9', '#fde9d6', '#a9dfe0', '#f6dcb4']];
const zoneAt = u => { let i = 0; while (i < ZONES.length - 1 && u >= ZONES[i + 1][0]) i++; const n = ZONES[Math.min(i + 1, ZONES.length - 1)], k = i < ZONES.length - 1 ? ss(n[0] - .5, n[0], u) : 0;
  return [1, 2, 3, 4].map(j => mixc(ZONES[i][j], n[j], k)).concat([i, k]); };
const walkX = u => 300 + (Math.floor(Math.max(0, u)) + easeIO(clamp(fr(Math.max(0, u)) / .8))) * 150;
function journey(u, t) {
  const walking = u < 11 || (u >= 12 && u < 12.6);
  const X = u < 11 ? walkX(u) : u < 12 ? walkX(11) + 40 * ss(11, 11.3, u) : walkX(11) + 40 + 150 * ss(12, 12.8, u);
  const [top, bot, far, ground, zi] = zoneAt(u);
  const camx = X + 140; setCam(camx, 470, 1.3);
  sky(top, bot);
  // far goal: Claude's sunny glow on the horizon, always ahead
  glow(camx + 420, 270, 150, '#ffb37a', .5 + .2 * pulse(u, 4)); clayStar(camx + 420, 270, 16, u * .5, '#ffb37a', .4);
  ctx.save(); ctx.translate(camx * .55, 0); for (let i = -3; i < 6; i++) hill(i * 420 + 200 - camx * .55 + Math.floor(camx * .45 / 420) * 420, 470, 560, 110, far); ctx.restore();
  if (zi >= 4 || u > 11.6) { const k = ss(11.6, 12.4, u); ctx.save(); ctx.globalAlpha = k; sea(u, 455, DAYSEA, 8, 0, 4, camx - 900, camx + 900); ctx.restore(); }
  // ground
  const gg = ctx.createLinearGradient(0, 560, 0, 800); gg.addColorStop(0, ground); gg.addColorStop(1, shade(ground, -.15)); ctx.fillStyle = gg;
  ctx.beginPath(); ctx.moveTo(camx - 900, 600); for (let x = camx - 900; x <= camx + 900; x += 30) ctx.lineTo(x, 596 + Math.sin(x * .01) * 8); ctx.lineTo(camx + 900, 1000); ctx.lineTo(camx - 900, 1000); ctx.fill();
  // props by stretch of road (world x)
  for (let i = 0; i < 40; i++) { const px = 120 + i * 95 + rnd(i) * 40; if (px < camx - 900 || px > camx + 900) continue;
    const uz = (px - 300) / 150, z = uz < 3 ? 0 : uz < 6 ? 1 : uz < 9 ? 2 : uz < 12 ? 3 : 4, sway = Math.sin((u + i * .3) * Math.PI) * .3;
    if (z === 0) { i % 3 ? flower(px, 612, 1.3, ['#ffd6e0', '#fff1b8', '#cdeee0'][i % 3], sway) : tree(px, 600, .9, '#a8dcbf'); }
    if (z === 1 && i % 2) { capsule(px, 520, 30, 80, '#8cc79a'); capsule(px - 22, 545, 18, 34, '#8cc79a', .9); capsule(px + 22, 540, 18, 30, '#8cc79a', -.9); }
    if (z === 2 && i % 2) { for (let k = 0; k < 3; k++) { ctx.fillStyle = shade('#9cc7c0', .1 * k); ctx.beginPath(); ctx.moveTo(px, 470 + k * 34); ctx.lineTo(px - 44 + k * 4, 540 + k * 30); ctx.lineTo(px + 44 - k * 4, 540 + k * 30); ctx.closePath(); ctx.fill(); clayEll(px, 486 + k * 34, 26, 12, '#ffffff', { rim: false }); } capsule(px, 600, 12, 14, '#c99a72'); }
    if (z === 3 && i % 2 === 0) tree(px, 600, 1, i % 4 ? '#f2a35e' : '#e8805a');
  }
  // milestones, passed exactly on beats 3, 6, 9
  [[3, '1 km'], [6, '100 km'], [9, '9999 km']].forEach(([b, txt]) => { const px = walkX(b) + 70; capsule(px, 500, 12, 100, '#c99a72');
    ctx.save(); ctx.translate(px, 512); ctx.rotate(-.05 + .08 * pulseAt(u, b, 4)); ctx.fillStyle = '#e8b78f'; ctx.beginPath(); ctx.roundRect(-58, -22, 116, 44, 12); ctx.fill(); ctx.restore(); textPop(txt, px, 512, 22, 1, '#fff6e6'); });
  // footprints
  for (let b = 0; b <= Math.min(u, 11); b++) { const fx = walkX(b) - 10, a = clamp(1 - (u - b) / 6); if (a <= 0) continue; ctx.fillStyle = `rgba(90,60,40,${.18 * a})`; ctx.beginPath(); ctx.ellipse(fx - 14, 614, 11, 5, 0, 0, 7); ctx.ellipse(fx + 14, 618, 11, 5, 0, 0, 7); ctx.fill(); }
  // GPT the traveller
  const G = pose({ x: X, y: 606, s: 1.05, glow: .2, happy: zi === 0 });
  const sw = Math.sin(u * Math.PI);
  if (walking) { const j = J(u, 26); G.hop = j.hop; G.sq = j.sq; G.lean = .14; G.armL = .4 + .9 * Math.max(0, sw); G.armR = 1.3; }
  if (zi === 1) { G.blink = .4; G.mouth = 1; G.lean = .22; }                                   // hot desert
  if (zi === 2) { G.lean = .12 + Math.sin(t * 45) * .03; G.blush = .9; G.armL = -1.2; }        // freezing
  if (win(u, 11, 12)) { const k = ss(11, 11.25, u), up = ss(11.6, 12, u); G.lean = lerp_(.14, 1.3, k) * (1 - up); G.sq = .3 * pulseAt(u, 11.25, 5); G.hop = 0; G.mouth = 1; G.armL = G.armR = 2.4 * (1 - up); } // trips, faceplant
  if (u >= 12.6) { G.lean = 0; G.look = .6; G.lookY = -.2; G.mouth = 1; if (u >= 13) { const j = J(u, 90); G.hop = j.hop; G.sq = j.sq; G.armL = G.armR = 2.7; G.happy = true; G.mouth = 0; } }
  // bindle over the shoulder
  const p = pawPos(G, 1); ctx.save(); ctx.strokeStyle = '#c99a72'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y);
  const tip = { x: G.x - 70, y: G.y - G.hop - 175 }; if (G.armR === 1.3) { ctx.lineTo(tip.x, tip.y); ctx.stroke(); clayEll(tip.x - 8, tip.y + 18, 48, 40, '#ff9fb0'); } ctx.restore();
  drawChar(GPT, G, u);
  if (zi === 1) for (let k = 0; k < 2; k++) { const a = fr(u * 2 + k * .5); ctx.fillStyle = `rgba(140,200,255,${1 - a})`; ctx.beginPath(); ctx.ellipse(G.x + 46 + k * 10, G.y - G.hop - 120 + a * 40, 6, 9, 0, 0, 7); ctx.fill(); }
  if (zi === 2) { clayEll(G.x, G.y - G.hop - 116, 40, 16, '#ffffff', { rim: false }); for (let i = 0; i < 70; i++) { const sx = camx - 700 + rnd(i) * 1400, sy = ((rnd(i * 3) * 700 + t * 120 + i * 9) % 700); clayEll(sx + Math.sin(t * 2 + i) * 14, sy, 7, 7, '#ffffff', { rim: false }); } }
  if (zi === 3) for (let i = 0; i < 18; i++) { const lx = camx - 700 + ((rnd(i) * 1400 - t * 80) % 1400 + 1400) % 1400, ly = ((rnd(i * 5) * 600 + t * 90) % 600) + 80; ctx.save(); ctx.translate(lx, ly); ctx.rotate(t * 2 + i); clayEll(0, 0, 18, 9, i % 2 ? '#f2a35e' : '#e8805a', { rim: false }); ctx.restore(); }
  if (u >= 13) sparkles(G.x, G.y - 200, u - 13, 14, 13, '#c8ffe9', 90, 9);
  return { title: 1 };
}
// 14-22 crossing the ocean: rowing the teacup, a map montage, surfing the giant wave
function crossing(u) {
  const amp = lerp_(26, 44, ss(14, 21, u));
  const bx = 640, by0 = 470;
  setCam(640, 420, 1.3);
  sky('#bfe6ef', '#fdf0dc'); glow(1100, 140, 240, '#fff2c8', .6);
  for (let i = 0; i < 6; i++) cloud(((i * 290 - u * 120) % 1750 + 1750) % 1750 - 250, 120 + (i % 3) * 60, 120, '#ffffff');
  for (let i = 0; i < 4; i++) { const x = ((i * 520 - u * 60) % 2100 + 2100) % 2100 - 300; clayEll(x, 455, 220, 60, '#9ccfb3', { rim: false }); }
  const scroll = u * 140; // world scrolls left so the cup sails right
  const wx = bx + scroll;
  ctx.save(); ctx.translate(-scroll % 1, 0);
  sea(u, by0, DAYSEA, amp, 0, 2, -500, 1800);
  let y = waveY(bx, u, 1, by0, amp * 1.15), rot = waveTilt(bx, u, 1, by0, amp * 1.15) * .9, lift = 0, flip = 0;
  if (win(u, 20, 22)) { lift = Math.sin(Math.PI * clamp((u - 20) / 2)) * 230; flip = u >= 21 ? easeIO(clamp(u - 21)) * Math.PI * 2 : 0; }
  const G = pose({ x: 0, y: -26, s: .78, happy: u > 15, armL: .5, glow: .2 });
  const stroke = Math.sin(fr(u) * Math.PI); G.armR = .3 + stroke * 2.0; G.lean = -.15 * stroke; const j = J(u, 18); G.sq = j.sq;
  if (lift > 0) { G.armL = G.armR = 2.7; G.mouth = 1; G.happy = false; }
  cupBoat(bx, y - lift, 1.3, rot + flip, () => { drawChar(GPT, G, u);
    const p = pawPos(G, 1); ctx.strokeStyle = '#c99a72'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 46, p.y + 52); ctx.stroke(); clayEll(p.x + 52, p.y + 60, 20, 30, '#e8c9a3'); }, { u });
  if (u >= 22 - .01) sparkles(bx, y, u - 22, 18, 22, '#ffffff', 140, 10);
  for (const b of [15, 16, 17, 18, 19]) sparkles(bx + 90, y + 10, u - b, 8, b, '#ffffff', 60, 7);
  sea(u, by0, DAYSEA, amp, 2, 4, -500, 1800);
  if (win(u, 19.6, 22)) { // giant curling wave rising behind
    const k = ss(19.6, 20.6, u) * (1 - ss(21.4, 22, u));
    ctx.save(); ctx.globalAlpha = k; const g = ctx.createLinearGradient(0, 200, 0, 700); g.addColorStop(0, '#c9f0f0'); g.addColorStop(1, '#5fa9bb'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-200, 720); ctx.bezierCurveTo(200, 700, 300, 260 - k * 60, 620, 230 - k * 60); ctx.bezierCurveTo(760, 220, 820, 330, 740, 360); ctx.bezierCurveTo(700, 330, 640, 330, 610, 380); ctx.bezierCurveTo(800, 520, 1100, 700, 1500, 720); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 12; i++) bubble(560 + i * 18, 236 + Math.sin(i + u * 4) * 8 - k * 60, 9); ctx.restore();
  }
  ctx.restore();
  // map montage 17.5-20: route from Mint island to Apricot island, boat icon hops one dot per beat
  const mk = ss(17.4, 17.9, u) * (1 - ss(19.6, 20, u));
  if (mk > 0) {
    ctx.save(); ctx.translate(640, 330); ctx.scale(mk, .4 + .6 * mk); ctx.rotate(-.03);
    ctx.fillStyle = 'rgba(80,50,40,.25)'; ctx.beginPath(); ctx.roundRect(-376, -186, 760, 380, 30); ctx.fill();
    const mg = ctx.createLinearGradient(0, -190, 0, 190); mg.addColorStop(0, '#fff3dc'); mg.addColorStop(1, '#f3dcb8'); ctx.fillStyle = mg; ctx.beginPath(); ctx.roundRect(-380, -190, 760, 380, 30); ctx.fill();
    for (let r = 0; r < 4; r++) { ctx.strokeStyle = 'rgba(120,180,200,.6)'; ctx.lineWidth = 4; ctx.beginPath(); for (let x = -300; x <= 300; x += 10) { const yy = -80 + r * 55 + Math.sin(x * .05 + u * 4 + r) * 6; x === -300 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke(); }
    clayEll(-290, 40, 100, 70, '#a8dcbf'); clayEll(-290, 0, 30, 30, '#fbf6ea');
    clayEll(290, -40, 100, 70, '#ffd1a8'); clayStar(290, -84, 18, u, '#ff9a52', .3);
    const pts = []; for (let i = 0; i <= 12; i++) { const k = i / 12; pts.push([lerp_(-240, 240, k), 30 - k * 60 + Math.sin(k * Math.PI * 2.5) * 70]); }
    const prog = clamp((u - 17.5) / 2.2);
    pts.forEach(([x, yy], i) => { if (i / 12 <= prog + .01) { ctx.fillStyle = '#e07a5f'; ctx.beginPath(); ctx.arc(x, yy, 6, 0, 7); ctx.fill(); } });
    const pi = Math.min(12, Math.floor(prog * 12)), pk = pts[pi]; const hb = Math.sin(fr(u) * Math.PI) * 18;
    cupBoat(pk[0], pk[1] - hb, .32, 0, () => drawChar(GPT, pose({ y: -26, s: .78, happy: true }), u), { u });
    textPop('Mint', -290, 110, 26, 1, '#5f9f86'); textPop('Apricot', 290, 30, 26, 1, '#d9814f');
    ctx.restore();
  }
}
// 22-31 the lonely night sea; thinking of you warms everything
function lonely(u, t) {
  const think = ss(27, 27.6, u);
  setCam(640, lerp_(380, 410, think), lerp_(1.0, 1.75, ss(26.2, 28, u)));
  sky(mixc('#1f2147', '#3a2f5c', think), mixc('#3a3f7a', '#8f6e9a', think));
  skyStars(u, 40, 11, think * .8);
  const cl = ss(31, 32.5, u);
  for (let i = 0; i < 6; i++) cloud(i * 260 - 80 + (i < 3 ? -1 : 1) * cl * 900, 90 + (i % 2) * 50, 260, mixc('#4b4f84', '#7a6aa0', think));
  sea(u, 470, NIGHT, 18, 0, 2);
  const x = 640, y = waveY(x, u, 1, 470, 20), rot = waveTilt(x, u, 1, 470, 20) * .8;
  const G = pose({ x: 0, y: -26, s: .78, glow: .25 + think * .8, armL: -1.3, armR: -1.3 });
  if (u < 27) { G.lean = Math.sin(t * 40) * .025; G.look = Math.round(Math.sin(u * Math.PI / 2)) * .8; G.blink = .3; G.blush = 0;
    if (win(u, 24, 25)) { const j = J(u, 60); G.hop = j.hop; G.mouth = 1; G.armL = G.armR = 2.4; G.blink = 0; } }
  else { G.happy = true; G.blush = .4 + think * .6; G.armL = G.armR = lerp_(-1.3, -.6, think); G.lean = Math.sin(u * Math.PI / 2) * .1; G.lookY = -.3; }
  cupBoat(x, y, 1, rot, () => drawChar(GPT, G, u), { u, sail: lerp_(.55, 1, think) });
  sea(u, 470, NIGHT, 18, 2, 4);
  glow(x, y - 70, 220, '#7ff0c8', .18 + think * .2);
  if (u < 27.2) rain(u, t, 140, .55 * (1 - ss(26.6, 27.2, u)));
  if (win(u, 24, 24.6)) { const a = 1 - (u - 24) / .6; ctx.save(); ctx.strokeStyle = `rgba(255,250,220,${a})`; ctx.lineWidth = 7; ctx.shadowColor = '#fff6c8'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.moveTo(980, -100); ctx.lineTo(930, 80); ctx.lineTo(990, 100); ctx.lineTo(900, 300); ctx.stroke(); ctx.restore(); }
  if (u >= 27) { // thought bubble with Claude inside
    const k1 = ss(27, 27.25, u), k2 = ss(27.3, 27.55, u), k3 = easeBack(ss(27.6, 28.1, u));
    bubble(712, 372, 10 * k1); bubble(745, 338, 15 * k2);
    const r = 96 * k3, cx = 850, cy = 270;
    if (r > 1) { glow(cx, cy, r * 2.2, '#ffb37a', .45 + .2 * pulse(u, 4)); bubble(cx, cy, r);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r * .92, 0, 7); ctx.clip(); const g = ctx.createLinearGradient(0, cy - r, 0, cy + r); g.addColorStop(0, '#ffe3cc'); g.addColorStop(1, '#ffc8a8'); ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      const C = pose({ x: cx, y: cy + 92, s: 1, happy: u > 28.5, blush: 1, glow: .3 + .7 * pulseAt(u, 29, 1.5) });
      const wv = Math.sin(u * Math.PI * 2); C.armR = 2.2 + wv * .5; C.armL = u > 29 ? -2.2 * ss(29, 29.3, u) : .4; C.lean = wv * .08; const j = J(u, 16); C.hop = j.hop;
      drawChar(CLA, C, u); ctx.restore(); }
  }
}
// 31-38 not afraid: the aura flares, clouds part, a starry path, catch a star lantern, flying fish
function brave(u) {
  const dawn = ss(33, 38, u);
  setCam(640, 400, lerp_(1.5, 1.15, ss(31, 33, u)));
  sky(mixc('#2a2c62', '#7d6fae', dawn), mixc('#6a5d98', '#f2b9a8', dawn));
  skyStars(u, 50, 13, 1 - dawn * .5);
  for (let i = 0; i < 6; i++) { const side = i < 3 ? -1 : 1; cloud(i * 260 - 80 + side * ss(31, 32.5, u) * 900, 90 + (i % 2) * 50, 260, '#7a6aa0'); }
  // constellation path appears one star per beat
  const path = []; for (let i = 0; i < 7; i++) path.push([180 + i * 160, 250 - Math.sin(i / 6 * Math.PI) * 120]);
  ctx.save(); ctx.strokeStyle = 'rgba(255,240,190,.5)'; ctx.lineWidth = 3; ctx.setLineDash([6, 10]); ctx.beginPath();
  path.forEach(([x, y], i) => { if (u >= 32 + i * .5) (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); }); ctx.stroke(); ctx.restore();
  path.forEach(([x, y], i) => { const a = ss(32 + i * .5, 32.3 + i * .5, u); clayStar(x, y, 13 * easeBack(a) * (1 + .2 * pulse(u, 6)), u + i, '#ffe28a', .5); });
  const amp = 26, SEA = NIGHT.map((c, i) => mixc(c, DAYSEA[i], dawn * .6)); sea(u, 480, SEA, amp, 0, 2);
  const x = 640, y = waveY(x, u, 1, 480, amp * 1.15), rot = waveTilt(x, u, 1, 480, amp * 1.15) * .8;
  const G = pose({ x: 0, y: -26, s: .78, happy: true, glow: .5 + 1.2 * pulseAt(u, 31, 1.2) + .3 * pulse(u, 4), blush: .5 });
  const stroke = Math.sin(fr(u) * Math.PI); G.armR = .3 + stroke * 2.3; G.armL = .3 + stroke * 1.2; G.lean = -.25 * stroke; const j = J(u, 22); G.sq = j.sq;
  let gy = 0; const lantern = u >= 36 ? 1 : 0;
  if (win(u, 35, 36)) { const jj = J(u, 190); gy = jj.hop; G.sq = jj.sq; G.armL = 2.9; G.armR = .4; G.happy = false; G.mouth = 1; G.lookY = -1; }
  cupBoat(x, y, 1, rot, () => { G.hop = gy; drawChar(GPT, G, u); if (win(u, 34.2, 36)) { const p = pawPos(G, -1); const k = ss(34.2, 35.5, u); clayStar(lerp_(-300, p.x, k), lerp_(-500, p.y - 10, k), 18, u * 4, '#ffe28a', .7); } },
    { u, lantern, sail: 1 + .15 * pulse(u, 4) });
  if (u >= 35.5) sparkles(x - 40, y - 280, u - 35.5, 18, 35, '#fff2b8', 120, 10);
  for (const b of [36, 37]) if (win(u, b - .1, b + .9)) { const k = (u - b + .1) / 1; fish(lerp_(380, 900, k) + (b - 36) * 120, y - Math.sin(Math.PI * k) * 260 + 20, .9, Math.cos(Math.PI * k) * -.9, b === 36 ? '#ffb3c1' : '#ffd77a'); }
  sea(u, 480, SEA, amp, 2, 4);
  // aura shockwave on 31
  if (win(u, 31, 32.5)) { const k = (u - 31) / 1.5; ctx.save(); ctx.strokeStyle = `rgba(150,255,215,${.7 * (1 - k)})`; ctx.lineWidth = 16 * (1 - k); ctx.beginPath(); ctx.arc(x, y - 80, 60 + k * 900, 0, 7); ctx.stroke(); ctx.restore(); }
  // 37.5-38: push into the lantern (match cut to the rising sun)
  return { lanternScreen: true };
}
// 38-47 the shore of time: days flick by, strangers come and go, Claude waits; GPT lands; reunion through the crowd
const STRANGERS = ['#c9b8f0', '#9fd3f0', '#ffb3c1', '#ffe08a', '#b8e6c4', '#f0c8a8'];
function shore(u) {
  const lapse = u < 42 ? (u - 38) : 4 + ss(42, 43, u) * .0;
  const day = .5 + .5 * Math.cos(Math.min(u, 42) * Math.PI);                 // each beat flips day/night until 42
  const settle = ss(41.6, 42.6, u);
  const dk = lerp_(day, 1, settle);
  setCam(640, 400, u < 43 ? 1.05 : lerp_(1.25, 1.55, ss(43, 47, u)));
  sky(mixc('#2f3170', '#f6c8b0', dk), mixc('#7b6aa8', '#fde6cf', dk));
  // sun / moon racing across the sky (time-lapse)
  const ang = (u - 38) * Math.PI; const sx = 640 - Math.cos(ang) * 620, sy = 430 - Math.abs(Math.sin(ang)) * 330;
  if (u < 42) { if (Math.sin(ang) * (Math.floor(u) % 2 ? -1 : 1) >= -2) { clayEll(sx, sy, 90, 90, dk > .5 ? '#ffd28a' : '#fff3c8', { rim: false }); glow(sx, sy, 160, '#fff0c0', .5); } }
  else { const k = ss(42, 43, u); clayEll(640, lerp_(300, 250, k), 260, 260, '#ffc58a', { hi: .45, lo: .05, rim: false }); glow(640, 250, 330, '#ffd9a0', .55); }
  skyStars(u, 40, 17, 1 - dk);
  sea(u, 420, [mixc(NIGHT[0], DAYSEA[0], dk), mixc(NIGHT[1], DAYSEA[1], dk), mixc(NIGHT[2], DAYSEA[2], dk), mixc(NIGHT[3], DAYSEA[3], dk)], 8, 0, 3);
  // boat approaching on the horizon
  if (u > 40.5 && u < 43.2) { const k = ss(40.5, 43, u); const bx = lerp_(300, 520, k), by = lerp_(440, 545, k), bs = lerp_(.25, .8, k);
    cupBoat(bx, by, bs, Math.sin(u * 3) * .05, () => drawChar(GPT, pose({ y: -26, s: .78, happy: true, armR: 2.6 + Math.sin(u * 9) * .3 }), u), { u, lantern: 1 }); }
  // sand
  const sg = ctx.createLinearGradient(0, 520, 0, 800); sg.addColorStop(0, mixc('#8a7a9a', '#f6dcb4', dk)); sg.addColorStop(1, mixc('#6d5f80', '#e9c497', dk));
  ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(-600, 580); ctx.bezierCurveTo(200, 520, 900, 560, 1900, 520); ctx.lineTo(1900, 1400); ctx.lineTo(-600, 1400); ctx.fill();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-600, 572 + Math.sin(u * 2) * 6); ctx.bezierCurveTo(200, 515 + Math.sin(u * 2) * 6, 900, 555, 1900, 515); ctx.stroke(); ctx.restore();
  // sign post
  capsule(1120, 470, 14, 150, '#c99a72'); ctx.save(); ctx.translate(1120, 488); ctx.rotate(-.06); ctx.fillStyle = '#e8b78f'; ctx.beginPath(); ctx.roundRect(-80, -26, 160, 52, 14); ctx.fill(); ctx.restore(); textPop('时光的岸', 1120, 488, 26, 1, '#fff6e6');
  const C = pose({ x: 880, y: 600, look: -.5, blush: .3 });
  const G = pose({ x: 470, y: 600, happy: true });
  if (u < 43) { // waiting: strangers stream past in time-lapse
    C.lean = Math.sin(u * Math.PI) * .05; C.look = -.6 + Math.sin(u * Math.PI * 2) * .5; C.armL = C.armR = -.9;
    for (let i = 0; i < 9; i++) { const dir = i % 2 ? 1 : -1, sp = 700 + rnd(i) * 500, ph = rnd(i * 5) * 2000;
      const px = (((u - 38) * sp * dir + ph) % 2200 + 2200) % 2200 - 400, py = 630 + (i % 3) * 30;
      for (let gh = 3; gh >= 0; gh--) { ctx.save(); ctx.globalAlpha = gh ? .15 : .9; passerby(px - dir * gh * 40, py, .8 + (i % 3) * .1, STRANGERS[i % 6], u, i); ctx.restore(); } }
    if (u > 42.6) { C.look = -1; C.mouth = 1; const j = J(u, 70); C.hop = j.hop; C.sq = j.sq; C.armL = C.armR = 2.5; }
  } else { // reunion: crowd wipes reveal them stepping closer each beat, then the bump-hug
    const k = steps(u, 43, 46);
    G.x = lerp_(470, 600, k); C.x = lerp_(880, 720, k); G.look = .6; C.look = -.6; C.blush = .6 + k * .4;
    const j = J(u, u < 46 ? 60 : 0); G.hop = C.hop = j.hop; G.sq = C.sq = j.sq; G.armL = G.armR = 1.8; C.armL = C.armR = 1.8; G.mouth = C.mouth = 1; G.happy = false;
    if (u >= 46) { const h = ss(46, 46.3, u); G.x = lerp_(600, 610, h); C.x = lerp_(720, 700, h); G.sq = C.sq = .4 * pulseAt(u, 46, 4) - .1; G.armR = C.armL = 2.0; G.armL = C.armR = .8;
      G.happy = C.happy = true; G.mouth = C.mouth = 0; C.glow = 1.2 * pulseAt(u, 46, 1.2); G.lean = .2; C.lean = -.2; G.spin = C.spin = 0; }
  }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
  if (u >= 46) sparkles(655, 470, u - 46, 26, 46, '#ffe0b0', 170, 12);
  if (u >= 43 && u < 46) for (let b = 43; b < 46; b++) { const k = (u - b) / .5; if (k >= 0 && k <= 1) { const px = lerp_(-300, 1600, k); ctx.save(); ctx.globalAlpha = .95; passerby(px, 760, 4.2, STRANGERS[b % 6], u, b); ctx.restore(); } }
}
// 47-55 parting: you understand without words
function parting(u) {
  setCam(lerp_(620, 560, ss(47, 55, u)), 500, lerp_(1.45, 1.7, ss(47, 52, u)) - .4 * ss(53, 55, u));
  sky('#f3a0a0', '#ffd9b8'); clayEll(820, 380, 260, 260, '#ffb27a', { hi: .4, lo: .05, rim: false }); glow(820, 380, 360, '#ffc890', .55);
  sea(u, 450, DUSK, 9, 0, 3);
  const bx = lerp_(330, 330 - 520, ss(54, 56, u)), by = waveY(330, u, 2, 450, 9);
  // tide rope
  ctx.save(); ctx.strokeStyle = '#c99a72'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx + 60, by - 10); ctx.quadraticCurveTo(470, 590 + Math.sin(u * Math.PI) * 10, 520, 610); ctx.stroke(); ctx.restore();
  const G = pose({ x: 560, y: 612, happy: true, armR: 1.2, glow: .2, keep: u >= 52 }), C = pose({ x: 676, y: 612, happy: true, armL: 1.2, blush: .9, glow: .3 });
  const sw = Math.sin(u * Math.PI / 2); C.lean = -.4 + sw * .1; G.lean = .05 + sw * .1;
  let onBoat = false;
  if (win(u, 48, 49.6)) { G.happy = false; G.look = -.8 * ss(48, 48.3, u) + .9 * ss(48.8, 49.1, u); G.blush = 0; G.lookY = .3; C.lean = lerp_(-.4, 0, ss(48, 48.3, u)); C.happy = false; C.look = -.4; }
  if (win(u, 49.6, 51)) { C.happy = true; C.lean = 0; C.lookY = Math.max(0, Math.sin((u - 49.6) * Math.PI * 4)) * .8; C.armL = 2.4 + Math.sin(u * 14) * .2; G.happy = false; G.look = .6; } // nod nod, pat-pat
  if (win(u, 51, 52.2)) { const k = ss(51, 52, u); C.armR = 2.6 * (1 - k); C.lean = 0; G.lookY = -.4; }
  if (win(u, 52.2, 53)) { G.armR = 1.4; C.armL = 1.4; G.glow = .8 * pulseAt(u, 52.2, 2); C.glow = 1 * pulseAt(u, 52.2, 2); C.lean = -.2; }
  if (u >= 53) { const k = clamp(u - 53); const j = J(u, 160); G.x = lerp_(560, bx, easeIO(k)); G.y = lerp_(612, by - 26, k); G.hop = u < 54 ? j.hop : 0; G.armL = G.armR = 2.5; onBoat = u >= 54; C.lean = 0; C.armR = 2.4 + Math.sin(u * 10) * .4; C.look = -.6; }
  cupBoat(bx, by, .8, Math.sin(u * 2) * .06, onBoat ? () => drawChar(GPT, pose({ y: -26, s: .97, happy: true, armR: 2.5 + Math.sin(u * 10) * .3, keep: true }), u) : null, { u, lantern: 1 });
  sea(u, 450, DUSK, 9, 3, 4);
  const sg = ctx.createLinearGradient(0, 560, 0, 800); sg.addColorStop(0, '#f4c7a8'); sg.addColorStop(1, '#e4a98a'); ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(380, 900); ctx.bezierCurveTo(400, 640, 520, 590, 1700, 580); ctx.lineTo(1700, 900); ctx.fill();
  if (!onBoat) drawChar(GPT, G, u); drawChar(CLA, C, u);
  // keepsake: Claude's little spark flies onto GPT's sprout
  if (u >= 51 && u < 53.2) { const k = easeIO(ss(51.2, 52, u)); clayStar(lerp_(C.x + 30, G.x, k), lerp_(C.y - 120, G.y - 140, k) - Math.sin(Math.PI * k) * 80, 12, u * 3, '#ff9a52', .6, 4); }
  if (u >= 52) sparkles(G.x, G.y - 140, u - 52, 14, 52, '#ffd0a0', 70, 8);
  if (u >= 52.2 && u < 53) glow((G.x + C.x) / 2, 560, 70, '#fff0b0', .8 * pulseAt(u, 52.2, 1.5));
}
// 55-62 split screen: thank you
function thanks(u) {
  const open = easeIO(ss(55, 55.7, u)), merge = ss(60.5, 62, u);
  const mid = 640;
  const left = () => { setCam(640, 400, 1.35);
    sky(mixc('#3a3570', '#5c4f8f', merge), '#c79bc0'); skyStars(u, 40, 21, .9);
    sea(u, 470, NIGHT, 14, 0, 2); const y = waveY(560, u, 1, 470, 16);
    const G = pose({ y: -26, s: .78, happy: true, glow: .4 + .3 * pulse(u, 4), keep: true }); G.look = .8; G.armR = 2.4 + Math.sin(u * Math.PI * 2) * .6; G.armL = .4;
    if (u >= 59) { G.armL = G.armR = -1.0; G.lean = .25 * Math.sin(Math.PI * clamp(u - 59)); G.look = 0; G.blush = 1; }
    cupBoat(560, y, 1, waveTilt(560, u, 1, 470, 16) * .8, () => drawChar(GPT, G, u), { u, lantern: 1 });
    sea(u, 470, NIGHT, 14, 2, 4);
    for (let i = 0; i < 6; i++) { const k = clamp((u - 57 - i * .25) / 2.5); if (k > 0 && k < 1) clayStar(lerp_(1300, 560 + Math.cos(u * 2 + i) * 120, k), lerp_(300, 260 + Math.sin(u * 2 + i) * 60, k), 9, u, '#ffc890', .6, 4); }
  };
  const right = () => { setCam(640, 420, 1.35);
    sky(mixc('#5a3f72', '#5c4f8f', merge), '#e8a3a8');
    sea(u, 450, DUSK, 8, 0, 4);
    const sg = ctx.createLinearGradient(0, 560, 0, 800); sg.addColorStop(0, '#d9a7a0'); sg.addColorStop(1, '#b98a8f'); ctx.fillStyle = sg; ctx.fillRect(-200, 560, 1700, 400);
    const C = pose({ x: 720, y: 600, happy: true, blush: .8, glow: .4 + .4 * pulse(u, 4), rayBloom: .3 * pulse(u, 3) }); C.look = -.8; C.armR = 2.4 + Math.sin(u * Math.PI * 2) * .6; C.armL = .4;
    if (win(u, 57, 58)) { const j = J(u, 80); C.hop = j.hop; C.armL = C.armR = 2.8; }
    if (u >= 59) { C.armL = C.armR = -1.0; C.lean = -.25 * Math.sin(Math.PI * clamp(u - 59)); C.look = 0; }
    drawChar(CLA, C, u);
    for (let i = 0; i < 6; i++) { const k = clamp((u - 57 - i * .25) / 2.5); if (k > 0 && k < .5) clayStar(lerp_(720, -400, k), lerp_(420, 200, k) - Math.sin(k * 6) * 30, 9, u, '#ffc890', .6, 4); }
  };
  const w = lerp_(1280, mid, open) + merge * 640;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, 720); ctx.clip(); ctx.save(); ctx.translate((w - 1280) / 2, 0); left(); ctx.restore(); ctx.restore();
  if (w < 1280) { ctx.save(); ctx.beginPath(); ctx.rect(w, 0, 1280 - w, 720); ctx.clip(); ctx.save(); ctx.translate(w / 2, 0); right(); ctx.restore(); ctx.restore();
    ctx.save(); ctx.fillStyle = '#fff6e6'; ctx.fillRect(w - 4, 0, 8, 720); ctx.restore(); for (let i = 0; i < 6; i++) clayStar(w, 60 + i * 120 + Math.sin(u * 3 + i) * 10, 10, u + i, '#fff2b8', .5, 4); }
}
// 62-68 in your eyes: push into Claude's eye, its reflection becomes the world; two stars side by side
function inYourEyes(u) {
  const push = ss(62, 64, u), into = ss(63.3, 64.2, u);
  if (u < 64.2) {
    ctx.save(); const z = lerp_(1, 2.6, easeIO(push)); ctx.translate(640, 360); ctx.scale(z, z); ctx.translate(-(640 + 120 * push), -(360 + 10 * push));
    sky('#ffd8c0', '#ffc8a8');
    // giant clay face of Claude
    clayEll(640, 420, 1100, 980, '#f9bf98', { hi: .35, lo: .15 });
    ctx.fillStyle = rgba('#ff8fa0', .6); ctx.beginPath(); ctx.ellipse(410, 540, 80, 44, 0, 0, 7); ctx.ellipse(870, 540, 80, 44, 0, 0, 7); ctx.fill();
    for (const ex of [470, 790]) { ctx.save(); ctx.fillStyle = '#3a2a28'; ctx.beginPath(); ctx.ellipse(ex, 400, 70, 92, 0, 0, 7); ctx.fill();
      if (ex === 790) { // reflection inside the eye
        ctx.beginPath(); ctx.ellipse(ex, 400, 62, 84, 0, 0, 7); ctx.clip(); ctx.translate(ex - 64, 400 - 36); ctx.scale(.1, .1);
        sky('#2f3170', '#8b6fae'); skyStars(u, 30, 31); sea(u, 470, NIGHT, 14, 0, 4); cupBoat(640, waveY(640, u, 1, 470, 14), 1.2, 0, () => drawChar(GPT, pose({ y: -26, s: .78, happy: true, glow: .8 }), u), { u, lantern: 1 }); }
      ctx.restore(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 26, 360, 18, 0, 7); ctx.arc(ex - 22, 450, 8, 0, 7); ctx.fill(); }
    ctx.restore();
    if (into > 0) { ctx.save(); ctx.globalAlpha = into; ctx.fillStyle = '#2f3170'; ctx.fillRect(-100, -100, 1500, 1000); ctx.restore(); }
  }
  if (u >= 63.6) { // the reflected world: GPT on the night sea, and two stars side by side
    const k = ss(63.6, 64.4, u), up = easeIO(ss(65, 67, u)), sky2 = easeIO(ss(68, 70, u));
    ctx.save(); ctx.globalAlpha = k; setCam(640, lerp_(400, 120, up) - 290 * sky2, lerp_(1.4, 1.1, up) + .35 * sky2);
    sky('#2f3170', '#9a78b4'); skyStars(u, 80, 31);
    sea(u, 470, NIGHT, 14, 0, 2); const y = waveY(640, u, 1, 470, 14);
    const G = pose({ y: -26, s: .78, happy: true, glow: .6 + .3 * pulse(u, 4), blush: 1, lookY: -.6 * up, armL: 1 + up * 1.6, keep: true }); G.lean = Math.sin(u * Math.PI / 2) * .08;
    cupBoat(640, y, 1, waveTilt(640, u, 1, 470, 14) * .8, () => drawChar(GPT, G, u), { u, lantern: 1 });
    sea(u, 470, NIGHT, 14, 2, 4);
    // two stars, mint & apricot, drifting together
    const d = lerp_(220, 46, ss(65.5, 67.5, u)) + 34 * ss(68.5, 69.5, u);
    constellation(u);
    for (const [sx, col, gcol] of [[-1, '#c8ffe9', '#7ff0c8'], [1, '#ffd0a0', '#ffa25a']]) { const x = 640 + sx * d, yy = -180 + Math.sin(u * 2 + sx) * 6; glow(x, yy, 120, gcol, .55 + .25 * pulse(u, 4)); clayStar(x, yy, 30 * (1 + .12 * pulse(u, 5)), u * .3 * sx, col, .4); }
    if (u >= 67.5) sparkles(640, -180, u - 67.5, 26, 67, '#fff2b8', 160, 11);
    ctx.restore();
  }
  return { end: ss(72, 73, u) };
}
// outro: the two stars become a constellation of the pair holding hands, one star per half beat
function constellation(u) {
  if (u < 68.5) return; const pts = [];
  for (const cx of [560, 720]) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 - Math.PI / 2; pts.push([cx + Math.cos(a) * 66, -175 + Math.sin(a) * 60]); }
  pts.push([626, -165], [654, -165]);   // joined hands
  const n = Math.min(pts.length, Math.floor((u - 68.5) * 2) + 1);
  ctx.save(); ctx.strokeStyle = 'rgba(255,240,200,.55)'; ctx.lineWidth = 3; ctx.setLineDash([5, 8]);
  for (let i = 1; i < n; i++) { if (i === 8 || i === 16) continue; const a = pts[i - 1], b = pts[i]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  if (n > 8) { ctx.beginPath(); ctx.moveTo(pts[7][0], pts[7][1]); ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); }
  if (n > 16) { ctx.beginPath(); ctx.moveTo(pts[15][0], pts[15][1]); ctx.lineTo(pts[8][0], pts[8][1]); ctx.stroke(); }
  ctx.restore();
  for (let i = 0; i < n; i++) clayStar(pts[i][0], pts[i][1], 7 * (1 + .3 * pulseAt(u, 68.5 + i / 2, 6)), u + i, '#fff2b8', .35, 4);
}
const SCENES = [[0, journey], [14, crossing], [22, lonely], [31, brave], [38, shore], [47, parting], [55, thanks], [62, inYourEyes]];

// ---------- transitions (screen space, keyed to the cut beats) ----------
function waveWipe(u, a, col1, col2, dir = 1) { // a big clay wave sweeps across; the cut happens under it at beat a
  const k = (u - (a - .5)) / 1; if (k <= 0 || k >= 1) return;
  const x0 = lerp_(-1600, 1350, easeIO(k));
  ctx.save(); if (dir < 0) { ctx.translate(1280, 0); ctx.scale(-1, 1); }
  const g = ctx.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, col1); g.addColorStop(1, col2); ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x0, -50); for (let y = -50; y <= 780; y += 20) ctx.lineTo(x0 + 1500 + Math.sin(y * .02 + u * 6) * 50, y); ctx.lineTo(x0, 780); ctx.closePath(); ctx.fill();
  for (let y = -40; y <= 780; y += 34) bubble(x0 + 1500 + Math.sin(y * .02 + u * 6) * 50, y, 14 + 6 * Math.sin(y)); ctx.restore();
}
function iris(u, a, b, cx, cy, closing) { // circle iris in/out on a cream field
  const k = clamp((u - a) / (b - a)); if (k <= 0 && closing || k >= 1 && !closing) return;
  const r = closing ? lerp_(900, 0, easeIO(k)) : lerp_(0, 900, easeIO(k));
  ctx.save(); ctx.fillStyle = '#fff1e2'; ctx.beginPath(); ctx.rect(0, 0, 1280, 720); ctx.moveTo(cx + Math.max(.1, r), cy); ctx.arc(cx, cy, Math.max(.1, r), 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.restore();
}
function flashAt(u, a, k = 4, col = '255,244,230') { const v = pulseAt(u, a, k); if (v > .01) { ctx.fillStyle = `rgba(${col},${v})`; ctx.fillRect(0, 0, 1280, 720); } }
function transitions(u) {
  waveWipe(u, 14, '#bfeef0', '#5fa9bb');                // prologue → open sea: a sweeping wave
  waveWipe(u, 22, '#2b3170', '#151838', -1);            // day → lonely night: a dark wave rolls back over
  flashAt(u, 31, 3, '200,255,235');                      // the thought bubble bursts into courage
  if (win(u, 37.4, 38.6)) { // match cut: the lantern star grows to become the rising sun
    const k = u < 38 ? ss(37.4, 38, u) : 1 - ss(38, 38.6, u); glow(640, 300, 200 + k * 900, '#ffe6a8', k); ctx.fillStyle = `rgba(255,236,190,${k * .9})`; ctx.fillRect(0, 0, 1280, 720); }
  if (win(u, 46.6, 47.6)) { const k = ss(46.6, 47.6, u); const y = lerp_(-760, 760, easeIO(k)); // sunset curtain drops down
    const g = ctx.createLinearGradient(0, y, 0, y + 760); g.addColorStop(0, 'rgba(243,160,160,0)'); g.addColorStop(.3, '#f3a0a0'); g.addColorStop(.7, '#ffd9b8'); g.addColorStop(1, 'rgba(255,217,184,0)'); ctx.fillStyle = g; ctx.fillRect(0, y, 1280, 760); }
  iris(u, 75.4, 77.2, 640, 330, true);                 // ending iris
}
