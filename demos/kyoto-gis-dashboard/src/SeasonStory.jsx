import { useEffect, useRef, useState } from 'react';

// Page 2: the four seasons side by side (stacked on phones). The season it is in Kyoto now is
// the highlighted card: wider, full colour, its own lettering treatment. The other three move
// too, through a cinematic grade (muted colour, lower exposure, film grain) that lifts on hover.
// Every card moves with the scroll as if walking in: an estimated depth map makes near things
// grow and slide faster than far things, and the season name sits at a set depth, so nearer
// branches, gates or bamboo pass in front of it. One typeface for all (Shippori Mincho).
// Images: supplied by the team from Pinterest, original authors unknown, coursework use only,
// illustrative (not verified as photographs of a particular place). Titles printed on the
// autumn and spring images were removed so that all four seasons share one typeface.
export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
export const SCENES = {
  spring: { ja: '春', en: 'Spring', kigo: '春霞', kigoR: 'Harugasumi', kigoEn: 'spring haze', focus: [0.52, 0.5], zoom: 0.16, textDepth: 0.6, cardY: 0.5 },
  summer: { ja: '夏', en: 'Summer', kigo: '木漏れ日', kigoR: 'Komorebi', kigoEn: 'sunlight through leaves', focus: [0.53, 0.43], zoom: 0.34, textDepth: 0.44, cardY: 0.43 },
  autumn: { ja: '秋', en: 'Autumn', kigo: '紅葉', kigoR: 'Kōyō', kigoEn: 'autumn leaves', focus: [0.58, 0.62], zoom: 0.3, textDepth: 0.5, cardY: 0.36 },
  winter: { ja: '冬', en: 'Winter', kigo: '雪景色', kigoR: 'Yukigeshiki', kigoEn: 'snow scene', focus: [0.58, 0.6], zoom: 0.28, textDepth: 0.62, cardY: 0.4 },
};
const FONT = '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const win = (p, a, b) => clamp((p - a) / (b - a));

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uImg, uDepth, uText;
uniform vec4 uBox; uniform vec2 uFocus, uPar, uRes; uniform float uZoom, uTextDepth, uCine, uFade, uTime;
in vec2 vUv; out vec4 o;
float D(vec2 q){ return texture(uDepth, clamp(q, 0.0, 1.0)).r; }
vec2 warp(vec2 q, float d){ float k = 1.0 + uZoom * (0.45 + 0.55 * d); return uFocus + (q - uFocus) / k - uPar * (d - 0.35); }
void main(){
  vec2 s = vec2(vUv.x, 1.0 - vUv.y);
  vec2 q = (s - uBox.xy) / uBox.zw;
  float d = D(q); vec2 p = warp(q, d);
  d = D(p); p = warp(q, d);
  d = D(p); p = warp(q, d);
  d = D(p);
  vec3 col = texture(uImg, clamp(p, 0.002, 0.998)).rgb;
  vec4 t = texture(uText, s);
  float vis = 1.0 - smoothstep(uTextDepth - 0.05, uTextDepth + 0.05, d);
  col = mix(col, t.rgb, t.a * vis);
  // cinematic grade for the seasons that are not now
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 cine = mix(vec3(l), col, 0.42) * 0.74 + vec3(0.012, 0.014, 0.03);
  float gr = fract(sin(dot(floor(s * uRes) + floor(uTime * 24.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col = mix(col, cine + gr * 0.07, uCine);
  float vg = smoothstep(1.2, 0.3, length((s - 0.5) * vec2(1.1, 1.0)));
  col *= mix(mix(0.78, 0.6, uCine), 1.0, vg);
  o = vec4(col * (1.0 - uFade), 1.0);
}`;
function program(gl) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function texture(gl, src, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });

// One card: its own WebGL canvas, picture, depth map and lettering.
function makeCard(canvas, key, base) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  let prog;
  try { prog = program(gl); } catch (e) { console.warn(e); return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uImg', 'uDepth', 'uText', 'uBox', 'uFocus', 'uPar', 'uRes', 'uZoom', 'uTextDepth', 'uCine', 'uFade', 'uTime']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uImg, 0); gl.uniform1i(U.uDepth, 1); gl.uniform1i(U.uText, 2);
  const txt = document.createElement('canvas'), tg = txt.getContext('2d');
  const tTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const card = { key, ready: false, w: 1, h: 1, dpr: 1, cine: 1 };
  Promise.all([loadImg(`${base}season/${key}.webp`), loadImg(`${base}season/${key}-depth.webp`)]).then(([img, dep]) => {
    gl.activeTexture(gl.TEXTURE0); texture(gl, img, true);
    gl.activeTexture(gl.TEXTURE1); texture(gl, dep, false);
    card.iw = img.naturalWidth; card.ih = img.naturalHeight; card.ready = true;
  }).catch(() => {});
  card.resize = (dpr) => { card.dpr = dpr; const w = canvas.clientWidth, h = canvas.clientHeight; card.w = w; card.h = h; for (const c of [canvas, txt]) { c.width = Math.max(2, Math.round(w * dpr)); c.height = Math.max(2, Math.round(h * dpr)); } };
  card.render = ({ p, enter, time, par, highlight, fade }) => {
    if (!card.ready) return;
    const sc = SCENES[key];
    const W = canvas.width, H = canvas.height;
    const a = card.iw / card.ih, sa = W / H;
    let bw, bh;
    if (sa > a) { bw = 1; bh = (W / a) / H; } else { bh = 1; bw = (a * H) / W; }
    const bx = (1 - bw) / 2, by = (1 - bh) / 2;
    const zoom = sc.zoom * ease(p * 1.1) + 0.02 + Math.sin(time * 0.45 + key.length) * 0.01;
    // lettering at its depth plane
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, W, H);
    const kT = 1 + zoom * (0.45 + 0.55 * sc.textDepth);
    // the name is placed in the card's own frame (the picture may be cropped top and bottom) and
    // grows with the camera like anything else at its depth
    const fyC = by + sc.focus[1] * bh;
    const tyS = (fyC + (sc.cardY - fyC) * kT) * H;
    const word = sc.en.toUpperCase();
    const size = Math.min(W * 0.84 / (word.length * 0.78), H * 0.12) * (highlight ? 1 : 0.92);
    drawTitle(tg, { season: key, word, kanji: sc.ja, x: W / 2, y: tyS, size, enter, prog: p, time, full: highlight });
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, txt);
    gl.viewport(0, 0, W, H);
    gl.uniform4f(U.uBox, bx, by, bw, bh);
    gl.uniform2f(U.uFocus, sc.focus[0], sc.focus[1]);
    gl.uniform2f(U.uPar, par[0], par[1]);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uZoom, zoom);
    gl.uniform1f(U.uTextDepth, sc.textDepth);
    gl.uniform1f(U.uCine, card.cine);
    gl.uniform1f(U.uFade, fade);
    gl.uniform1f(U.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  card.destroy = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  return card;
}

// Season name with a treatment per season (one typeface for all four).
function drawTitle(g, o) {
  const { season, word, kanji, x, y, size, enter, prog, time, full } = o;
  g.font = `600 ${size}px ${FONT}`;
  g.textBaseline = 'alphabetic';
  const gap = size * 0.1;
  const widths = [...word].map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
  const base = y + size * 0.36;
  const kSize = size * 1.05;
  if (season === 'spring') {
    const hz = g.createRadialGradient(x, y - size * 0.4, size * 0.2, x, y - size * 0.4, total * 0.62);
    hz.addColorStop(0, `rgba(255,240,244,${0.72 * enter})`); hz.addColorStop(0.55, `rgba(255,232,238,${0.45 * enter})`); hz.addColorStop(1, 'rgba(255,232,238,0)');
    g.save(); g.fillStyle = hz; g.beginPath(); g.ellipse(x, y - size * 0.4, total * 0.68, size * 1.6, 0, 0, 6.283); g.fill(); g.restore();
  }
  const fillFor = (ly, s) => {
    let f;
    if (season === 'spring') { f = g.createLinearGradient(0, ly - s * 0.8, 0, ly); f.addColorStop(0, '#fffafc'); f.addColorStop(1, '#f6bfd0'); g.shadowColor = 'rgba(160,60,90,.25)'; g.shadowBlur = s * 0.08; }
    else if (season === 'summer') { f = g.createLinearGradient(0, ly - s * 0.8, 0, ly); f.addColorStop(0, '#ffffff'); f.addColorStop(1, '#e3f3d6'); g.shadowColor = 'rgba(20,60,20,.45)'; g.shadowBlur = s * 0.1; }
    else if (season === 'autumn') {
      const t = clamp(0.15 + prog * 1.4);
      f = g.createLinearGradient(0, ly, 0, ly - s * 0.78);
      f.addColorStop(0, '#b8321d'); f.addColorStop(Math.max(0.001, t * 0.75), '#e2582c'); f.addColorStop(Math.min(0.999, t), '#f3b04a'); f.addColorStop(1, '#fff6e6');
      g.shadowColor = 'rgba(70,20,5,.35)'; g.shadowBlur = s * 0.08;
    } else { f = g.createLinearGradient(0, ly - s * 0.8, 0, ly); f.addColorStop(0, '#3a4f74'); f.addColorStop(1, '#1d2a42'); g.shadowColor = 'rgba(255,255,255,.55)'; g.shadowBlur = s * 0.06; }
    return f;
  };
  const glyph = (ch, lx, ly, s, k, w) => {
    g.save();
    g.globalAlpha = k;
    if (season === 'winter') g.filter = `blur(${((1 - k) * s * 0.08).toFixed(1)}px)`;
    g.font = `600 ${s}px ${FONT}`;
    g.fillStyle = fillFor(ly, s);
    g.fillText(ch, lx, ly);
    g.shadowBlur = 0;
    if (season === 'summer' && full) {
      const sx = x - total * 0.8 + ((time * 0.18) % 1) * total * 1.6;
      const sw = g.createLinearGradient(sx - s, 0, sx + s, 0);
      sw.addColorStop(0, 'rgba(255,255,220,0)'); sw.addColorStop(0.5, 'rgba(255,255,220,.85)'); sw.addColorStop(1, 'rgba(255,255,220,0)');
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = sw; g.fillRect(lx - 4, ly - s, w + 8, s * 1.2);
    }
    if (season === 'winter') {
      g.globalCompositeOperation = 'source-over';
      const cap = g.createLinearGradient(0, ly - s * 0.76, 0, ly - s * 0.56);
      cap.addColorStop(0, 'rgba(255,255,255,1)'); cap.addColorStop(0.55, 'rgba(255,255,255,.95)'); cap.addColorStop(1, 'rgba(255,255,255,0)');
      g.save(); g.beginPath(); g.rect(lx - 4, ly - s, w + 8, s * 0.4); g.clip();
      g.fillStyle = cap; g.translate(0, -s * 0.025 * k); g.fillText(ch, lx, ly); g.restore();
    }
    g.restore();
  };
  // kanji above the word, then the letters rise one by one from behind the scene
  const kk = ease(enter * 1.5);
  g.font = `600 ${kSize}px ${FONT}`;
  const kw = g.measureText(kanji).width;
  glyph(kanji, x - kw / 2, base - size * 1.15 + (1 - kk) * kSize * 0.5, kSize, kk, kw);
  let cx = x - total / 2;
  word.split('').forEach((ch, i) => {
    const k = ease(enter * 1.7 - 0.15 - i * 0.1);
    if (k > 0) glyph(ch, cx, base + (1 - k) * size * 0.55, size, k, widths[i]);
    cx += widths[i] + gap;
  });
}

// ---------- seasonal particles over the stage (highlighted season only) ----------
const LEAF = [[0.5, 0], [0.61, 0.24], [0.82, 0.14], [0.75, 0.38], [1, 0.4], [0.8, 0.56], [0.9, 0.7], [0.64, 0.66], [0.54, 1], [0.46, 1], [0.36, 0.66], [0.1, 0.7], [0.2, 0.56], [0, 0.4], [0.25, 0.38], [0.18, 0.14], [0.39, 0.24]];
function drawParticle(g, kind, p) {
  g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = p.a;
  const s = p.s;
  if (kind === 'snow') { g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(200,220,255,.8)'; g.shadowBlur = s * 0.8; g.beginPath(); g.arc(0, 0, s * 0.32, 0, 6.283); g.fill(); }
  else if (kind === 'firefly') { const gr = g.createRadialGradient(0, 0, 0, 0, 0, s); gr.addColorStop(0, 'rgba(240,255,170,1)'); gr.addColorStop(0.25, 'rgba(210,255,120,.6)'); gr.addColorStop(1, 'rgba(160,240,80,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s, 0, 6.283); g.fill(); }
  else if (kind === 'petal') { g.fillStyle = p.c; g.beginPath(); g.moveTo(0, -s * 0.5); g.bezierCurveTo(s * 0.55, -s * 0.45, s * 0.45, s * 0.35, 0, s * 0.5); g.bezierCurveTo(-s * 0.45, s * 0.35, -s * 0.55, -s * 0.45, 0, -s * 0.5); g.fill(); }
  else { g.fillStyle = p.c; g.beginPath(); LEAF.forEach(([x, y], i) => (i ? g.lineTo((x - 0.5) * s, (y - 0.5) * s) : g.moveTo((x - 0.5) * s, (y - 0.5) * s))); g.closePath(); g.fill(); }
  g.restore();
}
const PALETTE = { petal: ['#f9c9d6', '#f4b6ca', '#fde3ea', '#eea3b8'], leaf: ['#d8402a', '#e9622f', '#f08a3a', '#b9301f', '#f2a640'], green: ['#7fbf6a', '#a3d27c', '#5c9e55', '#c3e08f'] };
const particleKind = (season, theme) => (season === 'spring' ? 'petal' : season === 'winter' ? 'snow' : season === 'summer' ? (theme === 'light' ? 'green' : 'firefly') : 'leaf');

export default function SeasonStory({ season = 'autumn', autoSeason = 'autumn', theme = 'dark', counts, onExplore, onPick }) {
  const base = import.meta.env.BASE_URL;
  const root = useRef(null), fxc = useRef(null), lines = useRef(null);
  const canv = useRef({});
  const [fallback, setFallback] = useState(false);
  const st = useRef({ season, theme, hover: null, prog: 0, target: 0, enter: 0, seen: false, mouse: [0, 0], mouseT: [0, 0], particles: [] });
  st.current.season = season; st.current.theme = theme;

  useEffect(() => {
    const S = st.current;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const phone = matchMedia('(max-width: 760px)');
    const cards = {};
    for (const k of SEASON_ORDER) {
      const c = makeCard(canv.current[k], k, base);
      if (!c) { setFallback(true); Object.values(cards).forEach((x) => x.destroy()); return; }
      cards[k] = c;
    }
    const fx = fxc.current;
    let raf = 0, dead = false, visible = false, last = performance.now(), time = 0;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      for (const k of SEASON_ORDER) cards[k].resize(k === S.season ? dpr : Math.min(dpr, 1.5));
      fx.width = Math.round(fx.clientWidth * dpr); fx.height = Math.round(fx.clientHeight * dpr); S.dpr = dpr;
    };
    resize();
    const ro = new ResizeObserver(() => { resize(); kick(); });
    SEASON_ORDER.forEach((k) => ro.observe(canv.current[k]));
    const onScroll = () => {
      const r = root.current.getBoundingClientRect();
      S.target = phone.matches ? clamp((innerHeight - r.top) / (r.height + innerHeight)) : clamp(-r.top / Math.max(1, r.height - innerHeight));
      S.scrollV = (S.scrollV || 0) + (scrollY - (S.lastY ?? scrollY)); S.lastY = scrollY;
      kick();
    };
    addEventListener('scroll', onScroll, { passive: true });
    const onMove = (e) => { S.mouseT = [(e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2]; };
    if (!reduce) addEventListener('pointermove', onMove, { passive: true });
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { S.seen = true; kick(); } }, { threshold: 0 });
    io.observe(root.current);

    function frame(now) {
      raf = 0;
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      S.prog += (S.target - S.prog) * (reduce ? 1 : Math.min(1, dt * 6));
      if (S.seen) S.enter = reduce ? 1 : Math.min(1, S.enter + dt / 1.8);
      S.mouse = S.mouse.map((m, i) => m + (S.mouseT[i] - m) * Math.min(1, dt * 3));
      const p = S.prog;
      const fade = phone.matches ? 0 : win(p, 0.9, 1) * 0.9;
      for (const k of SEASON_ORDER) {
        const c = cards[k];
        const hl = k === S.season;
        const target = hl ? 0 : S.hover === k ? 0.3 : 1;
        c.cine += (target - c.cine) * (reduce ? 1 : Math.min(1, dt * 4));
        let cp = p;
        if (phone.matches) { const r = canv.current[k].getBoundingClientRect(); cp = clamp((innerHeight - r.top) / (innerHeight + r.height)); }
        const par = [S.mouse[0] * 0.01 + (reduce ? 0 : Math.sin(time * 0.21 + k.length) * 0.003), S.mouse[1] * 0.006];
        c.render({ p: cp, enter: S.enter, time: reduce ? 0 : time, par, highlight: hl, fade });
      }
      // story lines under the cards
      if (lines.current) {
        lines.current.querySelectorAll('[data-in]').forEach((el) => {
          const [s0, s1] = el.dataset.in.split(',').map(Number);
          el.style.setProperty('--k', (ease(win(p, s0, s1)) * (phone.matches ? 1 : 1 - win(p, 0.9, 0.98))).toFixed(3));
        });
        lines.current.querySelectorAll('[data-count]').forEach((el) => {
          const k = ease(win(p, ...el.dataset.in.split(',').map(Number)));
          el.firstChild.textContent = Math.round(Number(el.dataset.count) * k).toLocaleString('en-US');
        });
      }
      // particles of the highlighted season, three depth layers, also drifting with the scroll
      const g = fx.getContext('2d');
      const W = fx.width, H = fx.height, dpr = S.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      if (!reduce && !phone.matches) {
        const kind = particleKind(S.season, S.theme);
        const want = Math.round(30 * (kind === 'snow' ? 1.5 : 1));
        const pal = kind === 'petal' ? PALETTE.petal : kind === 'green' ? PALETTE.green : PALETTE.leaf;
        if (S.kind !== kind) { S.particles = []; S.kind = kind; }
        while (S.particles.length < want) {
          const layer = [0.55, 1, 1.7][Math.floor(Math.random() * 3)];
          S.particles.push({ layer, x: Math.random() * W, y: -Math.random() * H, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 1.6, sw: Math.random() * 6.28, s: (kind === 'snow' ? 7 : kind === 'firefly' ? 10 : 14) * layer * dpr, c: pal[Math.floor(Math.random() * pal.length)], a: kind === 'firefly' ? 0 : 0.5 + 0.4 * Math.min(1, layer) });
        }
        const sv = (S.scrollV || 0) * dpr; S.scrollV = 0;
        S.particles = S.particles.filter((q) => {
          if (kind === 'firefly') { q.y -= 14 * q.layer * dt * dpr; q.x += Math.sin(time * 0.8 + q.sw) * 12 * dt * dpr; q.a = 0.35 + 0.65 * Math.max(0, Math.sin(time * 1.6 + q.sw * 3)); }
          else { q.y += (kind === 'snow' ? 26 : 36) * q.layer * dt * dpr; q.x += Math.sin(time * 0.9 + q.sw) * 18 * q.layer * dt * dpr; q.r += q.vr * dt; }
          q.y -= sv * 0.3 * q.layer;
          drawParticle(g, kind === 'green' ? 'leaf' : kind, { ...q, a: q.a * (1 - fade) });
          return q.y < H + 40 && q.y > -H * 1.2 && q.x > -60 && q.x < W + 60;
        });
      }
      const settled = Math.abs(S.target - S.prog) < 0.0005 && S.enter >= 1 && SEASON_ORDER.every((k) => Math.abs(cards[k].cine - (k === S.season ? 0 : S.hover === k ? 0.3 : 1)) < 0.002);
      if ((!reduce && visible && !document.hidden) || !settled) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !dead) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    S.kick = () => { resize(); kick(); };
    onScroll();
    return () => {
      dead = true; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      removeEventListener('scroll', onScroll); removeEventListener('pointermove', onMove);
      Object.values(cards).forEach((c) => c.destroy());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { st.current.kick?.(); }, [season, theme]);

  const n = (x) => (x == null ? 0 : x);
  const now = SCENES[autoSeason] || SCENES.autumn;
  return (
    <section className={'story' + (fallback ? ' fallback' : '')} id="seasons" ref={root} aria-labelledby="story-title">
      <div className="story-stage">
        <header className="story-head">
          <p className="story-kicker"><span lang="ja">京都の四季</span> · Four seasons</p>
          <h2 id="story-title">Kyoto through the seasons</h2>
          <p className="story-now">Now in Kyoto: <b>{now.en}</b> · <span lang="ja">{now.kigo}</span> {now.kigoR}, {now.kigoEn}</p>
        </header>
        <div className="scards">
          {SEASON_ORDER.map((k) => {
            const sc = SCENES[k];
            return (
              <figure key={k} className={'scard' + (k === season ? ' on' : '') + (k === autoSeason ? ' now' : '')}
                onPointerEnter={() => { st.current.hover = k; st.current.kick?.(); }} onPointerLeave={() => { st.current.hover = null; st.current.kick?.(); }}>
                {fallback && <img src={`${base}season/${k}.webp`} alt="" />}
                <canvas ref={(el) => { canv.current[k] = el; }} aria-hidden="true" />
                {k === autoSeason && <span className="scard-now">Now in Kyoto</span>}
                <figcaption><b lang="ja">{sc.ja}</b><span>{sc.en}</span><em><span lang="ja">{sc.kigo}</span> {sc.kigoR}</em></figcaption>
                <button type="button" className="scard-pick" onClick={() => onPick?.(k)} aria-pressed={k === season} aria-label={`Use the ${sc.en.toLowerCase()} theme`} />
              </figure>
            );
          })}
        </div>
        <canvas ref={fxc} className="story-fx" aria-hidden="true" />
        <div className="story-lines" ref={lines}>
          <p className="sl big" data-in="0.12,0.26"><span>One prefecture, from the Sea of Japan coast to the old capital.</span></p>
          <p className="sl" data-in="0.24,0.38"><span>{n(counts?.areas)} cities, towns and wards · mapped from official boundaries</span></p>
          <div className="sl nums" data-in="0.36,0.52">
            <span data-count={n(counts?.attractions)} data-in="0.36,0.52"><b>0</b> attraction records</span>
            <span data-count={n(counts?.stops)} data-in="0.38,0.54"><b>0</b> bus and rail stops</span>
          </div>
          <p className="sl" data-in="0.52,0.66"><span>Two questions: where do attractions cluster, and how far is the walk to the nearest stop?</span></p>
          <p className="sl cta" data-in="0.64,0.76"><button type="button" onClick={onExplore}>Explore seven places <i aria-hidden="true">↓</i></button></p>
        </div>
        <p className="story-credit">Images: Pinterest, original authors unknown · coursework use only · illustrative, not verified photos of particular places · title lettering removed, movement from estimated depth maps</p>
      </div>
    </section>
  );
}
