// 3D density for the dashboard map: the attraction kernel density (scripts/kde_surface.py, ~250 m grid)
// drawn as pixel columns (one per ~500 m block, the mean of its grid nodes) inside MapLibre, with Three.js (MIT) in a custom layer that shares the
// map's WebGL context and camera. Pan, zoom and tilt move it with the map.
// Height is linear in density, rounded up to whole steps of H_MAX / 32, so a column twice as high holds about
// twice the density. Colour follows the same value. Where the density
// is zero the surface lies flat, a thin plate over the prefecture.
// The surface rises once when switched on: each node starts a little later the denser it is, and the
// colour deepens as it climbs. Nothing is drawn outside the prefecture boundary.
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

export const H_MAX = 28000;   // metres drawn at the highest node (stated on the legend as a vertical scale)
const PLATE = 18;             // metres: the flat plate where the density is zero
export const RAMPS = {
  light: ['#f4eff9', '#ddd1f4', '#a98ff0', '#d052b7', '#7c1863'],   // pale lilac to deep magenta (light reference)
  dark: ['#2a3640', '#22707f', '#79d7da', '#fff0d4', '#ff8a5c'],    // charcoal, teal, white, warm orange
};
const SHADOW = { light: '#8d7bb8', dark: '#0a0f13' };

export function decodeSurface(json) {
  const bin = atob(json.values), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const v = new Uint16Array(u8.buffer);
  const inside = [];
  for (let k = 0; k < v.length; k++) if (v[k] !== json.outside) inside.push(v[k]);
  const sorted = Uint16Array.from(inside).sort();
  return { ...json, v, sorted };
}
// value (records per km²) at a lon/lat, from the nearest grid node; null outside the prefecture
export function valueAt(S, lng, lat) {
  const i = Math.round((lng - S.lon0) / S.dlon), j = Math.round((lat - S.lat0) / S.dlat);
  if (i < 0 || j < 0 || i >= S.nx || j >= S.ny) return null;
  const q = S.v[j * S.nx + i];
  return q === S.outside ? null : q / S.scale;
}
// share of the prefecture's grid nodes whose density is lower than this value
export function shareBelow(S, value) {
  const q = Math.round(value * S.scale), a = S.sorted;
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < q) lo = m + 1; else hi = m; }
  return lo / a.length;
}
// densities along an east-west line through a point, `half` nodes each side (null outside)
export function transect(S, lng, lat, half = 10) {
  const i0 = Math.round((lng - S.lon0) / S.dlon), j = Math.round((lat - S.lat0) / S.dlat), out = [];
  for (let i = i0 - half; i <= i0 + half; i++) {
    const q = i >= 0 && i < S.nx && j >= 0 && j < S.ny ? S.v[j * S.nx + i] : S.outside;
    out.push(q === S.outside ? null : q / S.scale);
  }
  return out;
}
// the highest local peaks, at least `minKm` apart
export function peaks(S, count = 6, minKm = 9) {
  const cand = [];
  const r = 6;
  for (let j = r; j < S.ny - r; j++) for (let i = r; i < S.nx - r; i++) {
    const q = S.v[j * S.nx + i];
    if (q === S.outside || q < S.peak * S.scale * 0.12) continue;
    let top = true;
    for (let dj = -r; dj <= r && top; dj++) for (let di = -r; di <= r; di++) { const o = S.v[(j + dj) * S.nx + i + di]; if (o !== S.outside && o > q) { top = false; break; } }
    if (top) cand.push({ lng: S.lon0 + i * S.dlon, lat: S.lat0 + j * S.dlat, value: q / S.scale });
  }
  cand.sort((a, b) => b.value - a.value);
  const out = [];
  for (const c of cand) {
    if (out.every((o) => km(o, c) >= minKm)) out.push(c);
    if (out.length === count) break;
  }
  return out;
}
export const km = (a, b) => {
  const R = 6371, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Pixel (voxel) style: one square column per ~500 m block, built from whole steps of STEP metres, colour in
// a few flat bands, the side of each column ruled at every step so it reads as stacked cubes.
const LEVELS = 32;                       // steps from the ground to the highest block
const STEP = H_MAX / LEVELS;
const levelOf = (value, peak) => (value <= 0 ? 0 : Math.max(1, Math.ceil((value / peak) * LEVELS)));
const vert = /* glsl */`
  attribute float dens;
  uniform float uGrow;
  varying float vD; varying float vK; varying float vZ; varying vec3 vN;
  void main() {
    // each block rises a little later the denser it is, and climbs in whole steps, like pixels
    float k = clamp(uGrow * 1.55 - dens * 0.55, 0.0, 1.0);
    k = 1.0 - pow(1.0 - k, 3.0);
    vec4 base = instanceMatrix * vec4(position, 1.0);
    float hFull = instanceMatrix[2][2];
    float hNow = max(${(STEP * 0.22).toFixed(1)}, floor(hFull * k / ${STEP.toFixed(1)} + 0.5) * ${STEP.toFixed(1)});
    hNow = min(hNow, hFull);
    vec3 p = vec3(base.x, base.y, position.z * hNow);
    vZ = p.z; vK = k; vD = dens; vN = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const frag = /* glsl */`
  uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 c4; uniform vec3 uShadow;
  uniform float uAmb; uniform float uFade;
  varying float vD; varying float vK; varying float vZ; varying vec3 vN;
  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
    return mix(c3, c4, (t - 0.75) / 0.25);
  }
  void main() {
    // colour by density in eight flat bands, deepening as the block climbs
    float t = floor(pow(vD, 0.42) * vK * 8.0 + 0.5) / 8.0;
    vec3 col = ramp(t);
    // flat shading per face, as in pixel art: top brightest, the face towards the light next, the rest darker
    vec3 n = normalize(vN);
    float face = n.z > 0.5 ? 1.0 : (dot(n, normalize(vec3(-0.6, 0.8, 0.0))) > 0.2 ? 0.8 : 0.6);
    float lit = uAmb + (1.0 - uAmb) * face;
    col = mix(uShadow, col, clamp(lit, 0.0, 1.0));
    // a fine line at every step on the sides: stacked cubes
    float side = 1.0 - step(0.5, abs(n.z));
    float d = abs(fract(vZ / ${STEP.toFixed(1)} + 0.5) - 0.5) * ${STEP.toFixed(1)};
    col *= 1.0 - side * 0.22 * (1.0 - smoothstep(0.0, ${(STEP * 0.07).toFixed(1)}, d));
    gl_FragColor = vec4(col, uFade);
  }`;

// The layer object MapLibre calls. `S` is a decoded surface.
export function createDensityLayer(S, theme) {
  const center = [S.lon0 + (S.nx * S.dlon) / 2, S.lat0 + (S.ny * S.dlat) / 2];
  const O = maplibregl.MercatorCoordinate.fromLngLat(center, 0), s = O.meterInMercatorCoordinateUnits();
  const L = {
    id: 'density-3d', type: 'custom', renderingMode: '3d',
    grow: 0, fade: 1, mvp: new THREE.Matrix4(),
    toLocal(lng, lat, h = 0) { const m = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0); return new THREE.Vector3((m.x - O.x) / s, -(m.y - O.y) / s, h); },
    toLngLat(x, y) { return new maplibregl.MercatorCoordinate(O.x + x * s, O.y - y * s, 0).toLngLat(); },
    heightOf(value) { const n = levelOf(value, S.peak); return n ? n * STEP : STEP * 0.22; },
    setTheme(t) { const r = RAMPS[t === 'light' ? 'light' : 'dark']; ['c0', 'c1', 'c2', 'c3', 'c4'].forEach((k, i) => this.mat.uniforms[k].value.set(r[i])); this.mat.uniforms.uShadow.value.set(SHADOW[t === 'light' ? 'light' : 'dark']); this.mat.uniforms.uAmb.value = t === 'light' ? 0.62 : 0.4; },
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      // blocks: 2 x 2 grid nodes (~500 m) each, the mean of the nodes inside the prefecture; one instance per block
      const { nx, ny, v } = S, blocks = [];
      for (let j = 0; j + 1 < ny; j += 2) for (let i = 0; i + 1 < nx; i += 2) {
        let sum = 0, cnt = 0;
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = v[(j + dj) * nx + i + di]; if (q !== S.outside) { sum += q / S.scale; cnt++; } }
        if (cnt) blocks.push({ lng: S.lon0 + (i + 0.5) * S.dlon, lat: S.lat0 + (j + 0.5) * S.dlat, value: sum / cnt });
      }
      const a0 = this.toLocal(S.lon0, S.lat0), a1 = this.toLocal(S.lon0 + 2 * S.dlon, S.lat0 + 2 * S.dlat);
      const bw = Math.abs(a1.x - a0.x) * 0.84, bh = Math.abs(a1.y - a0.y) * 0.84;   // a small gap between blocks: the pixel grid
      const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0, 0.5);
      const dens = new Float32Array(blocks.length);
      const g = box;
      g.setAttribute('dens', new THREE.InstancedBufferAttribute(dens, 1));
      this.blocks = blocks;
      this.mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, transparent: true,
        uniforms: { uGrow: { value: 0 }, uFade: { value: 1 }, uAmb: { value: 0.4 }, uShadow: { value: new THREE.Color() }, c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() } },
      });
      this.setTheme(theme);
      this.mesh = new THREE.InstancedMesh(g, this.mat, blocks.length);
      const m4 = new THREE.Matrix4();
      blocks.forEach((bk, k) => {
        const p = this.toLocal(bk.lng, bk.lat), h = this.heightOf(bk.value);
        m4.makeScale(bw, bh, h); m4.setPosition(p.x, p.y, 0);
        this.mesh.setMatrixAt(k, m4);
        dens[k] = bk.value / S.peak;
      });
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this.raycaster = new THREE.Raycaster();
    },
    render(gl, matrix) {
      const m = new THREE.Matrix4().fromArray(matrix);
      const l = new THREE.Matrix4().makeTranslation(O.x, O.y, O.z).scale(new THREE.Vector3(s, -s, s));
      this.mvp = m.multiply(l);
      this.camera.projectionMatrix = this.mvp;
      this.mat.uniforms.uGrow.value = this.grow;
      this.mat.uniforms.uFade.value = this.fade;
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      this.onRender?.();
    },
    onRemove() { this.mesh?.geometry.dispose(); this.mat?.dispose(); this.renderer?.dispose(); },
    // where on the surface a screen point lands (after the rise): { lng, lat, h } or null
    pick(px, py) {
      if (!this.map) return null;
      const c = this.map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
      const inv = this.mvp.clone().invert();
      const x = (px / w) * 2 - 1, y = 1 - (py / h) * 2;
      const near = new THREE.Vector3(x, y, -1).applyMatrix4(inv), far = new THREE.Vector3(x, y, 1).applyMatrix4(inv);
      this.raycaster.ray.set(near, far.sub(near).normalize());
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      if (!hit) return null;
      const ll = this.toLngLat(hit.point.x, hit.point.y);
      return { lng: ll.lng, lat: ll.lat, h: hit.point.z };
    },
    // screen position of a point at a height (null when behind the camera)
    project(lng, lat, h) {
      const p = this.toLocal(lng, lat, h), e = this.mvp.elements;
      const X = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12], Y = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13], W = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
      if (W <= 0) return null;
      const c = this.map.getCanvas();
      return { x: (X / W + 1) / 2 * c.clientWidth, y: (1 - Y / W) / 2 * c.clientHeight };
    },
  };
  return L;
}
