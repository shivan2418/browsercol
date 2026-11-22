// THROWAWAY prototype (#405): a 3D "one continuous terrain mesh" map from the game's tile data.
// three.js 0.187.0 (WebGL2 only). Everything here is procedural placeholder: it measures cost, readability and
// architecture, not art quality. Query: ?map=topdown|isometric &view=topdown|iso &grid=0|1 &hud=0|1 &aa=0|1
// &maxdpr=N &band=0.1..0.5 &pitch=deg &tex=128|256.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const T0 = performance.now();
const Q = new URLSearchParams(location.search);
const mapName = Q.get('map') ?? 'topdown';
const S = +(Q.get('s') ?? 4); // terrain vertices per tile edge
const TEX = +(Q.get('tex') ?? 256);
const timing = {};
const mark = (k, t) => (timing[k] = Math.round((performance.now() - t) * 10) / 10);

THREE.ColorManagement.enabled = false; // all colours below are display values; one simple pipeline for every material

// ---------- data ----------
let t = performance.now();
const json = await (await fetch(`./maps/${mapName}.json`)).json();
mark('fetchParseMapMs', t);
const W = json.w, H = json.h;
const typeId = json.types.map((x) => x.id.replace('model.tile.', ''));
const present = new Uint8Array(W * H);
const kind = new Array(W * H); // tile type name
for (let i = 0; i < W * H; i++) {
  const ch = json.tiles[i];
  if (ch === '.') { kind[i] = null; continue; }
  present[i] = 1;
  kind[i] = typeId[ch.charCodeAt(0) - 65];
}
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const kindAt = (x, y) => (inb(x, y) ? kind[y * W + x] : null);
const FOREST = new Set(['borealForest', 'mixedForest', 'wetlandForest', 'coniferForest', 'scrubForest', 'rainForest',
  'broadleafForest', 'tropicalForest']);
const isWater = (k) => k === 'ocean' || k === 'highSeas' || k === 'lake';

// ground texture layers
const G = { deep: 0, sand: 1, grass: 2, plains: 3, prairie: 4, savannah: 5, desert: 6, tundra: 7, snow: 8, marsh: 9,
  swamp: 10, rock: 11, hills: 12, fTemp: 13, fConifer: 14, jungle: 15 };
const GROUND = {
  ocean: G.sand, highSeas: G.deep, lake: G.sand, arctic: G.snow, tundra: G.tundra, plains: G.plains,
  grassland: G.grass, prairie: G.prairie, savannah: G.savannah, desert: G.desert, marsh: G.marsh, swamp: G.swamp,
  hills: G.hills, mountains: G.rock, borealForest: G.fConifer, coniferForest: G.fConifer, mixedForest: G.fTemp,
  broadleafForest: G.fTemp, wetlandForest: G.swamp, scrubForest: G.savannah, rainForest: G.jungle,
  tropicalForest: G.jungle,
};
const BASE_H = { ocean: -0.30, highSeas: -0.55, lake: -0.22, hills: 0.55, mountains: 0.80, marsh: 0.03, swamp: 0.03 };
const RUGGED = { hills: 0.12, mountains: 0.2 };
// relief scales the ground's height (not the peaks or trees): the oblique view shears height up the screen, so it keeps the ground flat
const RELIEF = +(Q.get('relief') ?? (Q.get('view') === 'oblique' ? 0.35 : 1));
const baseH = (k) => { const v = k === null ? -0.55 : (BASE_H[k] ?? 0.08); return v > 0 ? v * RELIEF : v; }; // water depth is not scaled
const rugged = (k) => (RUGGED[k] ?? 0) * RELIEF;

// ---------- noise ----------
function hash(ix, iy, s = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (x) => x * x * (3 - 2 * x);
function vnoise(x, y, s = 0, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
  const wrap = (v) => (period ? ((v % period) + period) % period : v);
  const a = hash(wrap(ix), wrap(iy), s), b = hash(wrap(ix + 1), wrap(iy), s);
  const c = hash(wrap(ix), wrap(iy + 1), s), d = hash(wrap(ix + 1), wrap(iy + 1), s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct = 4, s = 0, period = 0) {
  let v = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x, y, s + o, period ? period * (1 << o) : 0);
    tot += amp; amp *= 0.5; x *= 2; y *= 2;
  }
  return v / tot;
}

// ---------- ground textures (procedural, tileable) ----------
t = performance.now();
const PAL = [ // c1, c2, detail strength, kind of pattern
  [[0.07, 0.17, 0.30], [0.10, 0.23, 0.38], 0.15, 0], [[0.78, 0.72, 0.52], [0.86, 0.80, 0.60], 0.25, 0],
  [[0.28, 0.50, 0.17], [0.42, 0.62, 0.22], 0.5, 1], [[0.60, 0.62, 0.30], [0.72, 0.70, 0.36], 0.4, 1],
  [[0.50, 0.60, 0.25], [0.66, 0.70, 0.32], 0.4, 1], [[0.70, 0.60, 0.30], [0.80, 0.70, 0.38], 0.4, 1],
  [[0.84, 0.72, 0.48], [0.92, 0.82, 0.60], 0.2, 2], [[0.48, 0.50, 0.40], [0.62, 0.60, 0.50], 0.35, 1],
  [[0.88, 0.91, 0.96], [0.97, 0.98, 1.0], 0.12, 0], [[0.28, 0.43, 0.33], [0.38, 0.52, 0.40], 0.4, 3],
  [[0.20, 0.32, 0.22], [0.30, 0.40, 0.28], 0.4, 3], [[0.36, 0.34, 0.32], [0.58, 0.55, 0.52], 0.5, 4],
  [[0.52, 0.45, 0.25], [0.66, 0.55, 0.31], 0.5, 1], [[0.18, 0.34, 0.14], [0.28, 0.44, 0.19], 0.5, 1],
  [[0.17, 0.29, 0.20], [0.26, 0.37, 0.25], 0.5, 1], [[0.12, 0.30, 0.13], [0.19, 0.40, 0.17], 0.5, 1],
];
const NL = PAL.length;
const texData = new Uint8Array(TEX * TEX * 4 * NL);
for (let l = 0; l < NL; l++) {
  const [c1, c2, det, pat] = PAL[l];
  const base = l * TEX * TEX * 4;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX, v = y / TEX;
      const lo = fbm(u * 4, v * 4, 4, l * 7, 4);
      const hi = fbm(u * 32, v * 32, 3, l * 7 + 50, 32);
      let k = lo;
      let shade = 1 + (hi - 0.5) * det * 1.6;
      if (pat === 2) shade += Math.sin((u * 16 + lo * 2.0) * Math.PI * 2) * 0.06; // dune ripples
      if (pat === 3 && lo > 0.58) k = 1.4; // water patches
      if (pat === 4) { const r = 1 - Math.abs(fbm(u * 8, v * 8, 3, l + 90, 8) - 0.5) * 2; shade *= 0.7 + 0.5 * r * r; }
      const kk = Math.min(Math.max(k, 0), 1);
      let r = c1[0] + (c2[0] - c1[0]) * kk, g = c1[1] + (c2[1] - c1[1]) * kk, b = c1[2] + (c2[2] - c1[2]) * kk;
      if (pat === 3 && k > 1.2) { r = 0.12; g = 0.25; b = 0.30; }
      const o = base + (y * TEX + x) * 4;
      texData[o] = Math.max(0, Math.min(255, r * shade * 255));
      texData[o + 1] = Math.max(0, Math.min(255, g * shade * 255));
      texData[o + 2] = Math.max(0, Math.min(255, b * shade * 255));
      texData[o + 3] = 255;
    }
  }
}
const groundTex = new THREE.DataArrayTexture(texData, TEX, TEX, NL);
groundTex.format = THREE.RGBAFormat; groundTex.generateMipmaps = true; groundTex.minFilter = THREE.LinearMipmapLinearFilter;
groundTex.magFilter = THREE.LinearFilter; groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.anisotropy = 4; groundTex.needsUpdate = true;
const macroData = new Uint8Array(64 * 64);
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) macroData[y * 64 + x] = fbm(x / 16, y / 16, 3, 777, 4) * 255;
const macroTex = new THREE.DataTexture(macroData, 64, 64, THREE.RedFormat);
macroTex.wrapS = macroTex.wrapT = THREE.RepeatWrapping; macroTex.minFilter = macroTex.magFilter = THREE.LinearFilter;
macroTex.unpackAlignment = 1; macroTex.needsUpdate = true;
mark('textureGenMs', t);

// ---------- heightfield ----------
t = performance.now();
const tileH = new Float32Array(W * H), tileR = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { tileH[y * W + x] = baseH(kind[y * W + x]); tileR[y * W + x] = rugged(kind[y * W + x]); }
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
function sampleH(px, py) {
  const qx = px - 0.5, qy = py - 0.5;
  const ix = Math.floor(qx), iy = Math.floor(qy), fx = sm(qx - ix), fy = sm(qy - iy);
  const g = (a, b, arr) => arr[cl(b, 0, H - 1) * W + cl(a, 0, W - 1)];
  const bil = (arr) => {
    const a = g(ix, iy, arr), b = g(ix + 1, iy, arr), c = g(ix, iy + 1, arr), d = g(ix + 1, iy + 1, arr);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const h = bil(tileH), r = bil(tileR);
  return r > 0 ? h + r * (fbm(px * 1.6, py * 1.6, 3, 5) - 0.5) * 2 : h;
}
const NX = W * S, NY = H * S, VX = NX + 1, VY = NY + 1;
const hf = new Float32Array(VX * VY);
for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) hf[j * VX + i] = sampleH(i / S, j / S);
mark('heightfieldMs', t);
const heightAt = sampleH;

// ---------- terrain mesh ----------
t = performance.now();
const pos = new Float32Array(VX * VY * 3), nor = new Float32Array(VX * VY * 3), uvs = new Float32Array(VX * VY * 2);
for (let j = 0; j < VY; j++) {
  for (let i = 0; i < VX; i++) {
    const o = j * VX + i;
    pos[o * 3] = i / S; pos[o * 3 + 1] = hf[o]; pos[o * 3 + 2] = j / S;
    uvs[o * 2] = i / S; uvs[o * 2 + 1] = j / S;
    const hl = hf[j * VX + Math.max(i - 1, 0)], hr = hf[j * VX + Math.min(i + 1, VX - 1)];
    const hu = hf[Math.max(j - 1, 0) * VX + i], hd = hf[Math.min(j + 1, VY - 1) * VX + i];
    const dx = (hr - hl) / (((Math.min(i + 1, VX - 1) - Math.max(i - 1, 0)) / S)), dz = (hd - hu) / (((Math.min(j + 1, VY - 1) - Math.max(j - 1, 0)) / S));
    const n = new THREE.Vector3(-dx, 1, -dz).normalize();
    nor[o * 3] = n.x; nor[o * 3 + 1] = n.y; nor[o * 3 + 2] = n.z;
  }
}
const idx = [];
for (let ty = 0; ty < H; ty++) {
  for (let tx = 0; tx < W; tx++) {
    if (!present[ty * W + tx]) continue;
    for (let sj = 0; sj < S; sj++) {
      for (let si = 0; si < S; si++) {
        const i = tx * S + si, j = ty * S + sj;
        const a = j * VX + i, b = a + 1, c = a + VX, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
}
const terrainGeo = new THREE.BufferGeometry();
terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
terrainGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
terrainGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
mark('terrainMeshMs', t);

const idData = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) idData[i] = kind[i] ? GROUND[kind[i]] : G.deep;
const idTex = new THREE.DataTexture(idData, W, H, THREE.RedFormat);
idTex.minFilter = idTex.magFilter = THREE.NearestFilter; idTex.unpackAlignment = 1; idTex.needsUpdate = true;

const presTex = new THREE.DataTexture(present.map((v) => v * 255), W, H, THREE.RedFormat);
presTex.minFilter = presTex.magFilter = THREE.NearestFilter; presTex.unpackAlignment = 1; presTex.needsUpdate = true;

const SUN = new THREE.Vector3(-0.55, 0.78, -0.42).normalize(); // one sun, NW and up, for the ground, trees, peaks and units
const terrainMat = new THREE.ShaderMaterial({
  uniforms: {
    groundTex: { value: groundTex }, ids: { value: idTex }, macro: { value: macroTex },
    mapSize: { value: new THREE.Vector2(W, H) }, band: { value: +(Q.get('band') ?? 0.16) },
    gridOn: { value: Q.get('grid') === '1' ? 1 : 0 }, warp: { value: +(Q.get('warp') ?? 0) }, sun: { value: SUN },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN; varying float vH;
    void main(){ vUv = uv; vN = normal; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2DArray groundTex; uniform sampler2D ids; uniform sampler2D macro;
    uniform vec2 mapSize; uniform float band; uniform float gridOn; uniform float warp; uniform vec3 sun;
    varying vec2 vUv; varying vec3 vN; varying float vH;
    int idAt(ivec2 p){ p = clamp(p, ivec2(0), ivec2(mapSize) - 1); return int(texelFetch(ids, p, 0).r * 255.0 + 0.5); }
    void main(){
      vec2 wp = (vec2(texture(macro, vUv / 5.0).r, texture(macro, vUv / 5.0 + 0.37).r) - 0.5) * warp; // wobbles the borders
      vec2 q = vUv + wp - 0.5; ivec2 i0 = ivec2(floor(q)); vec2 f = fract(q);
      vec2 s = smoothstep(0.5 - band, 0.5 + band, f);     // soft band round each tile edge, no edge pieces
      vec2 uv = vUv * 0.5; vec2 dx = dFdx(uv), dy = dFdy(uv);
      float w0 = (1.-s.x)*(1.-s.y), w1 = s.x*(1.-s.y), w2 = (1.-s.x)*s.y, w3 = s.x*s.y;
      vec3 col = vec3(0.0);
      if (w0 > 0.002) col += w0 * textureGrad(groundTex, vec3(uv, float(idAt(i0))), dx, dy).rgb;
      if (w1 > 0.002) col += w1 * textureGrad(groundTex, vec3(uv, float(idAt(i0 + ivec2(1,0)))), dx, dy).rgb;
      if (w2 > 0.002) col += w2 * textureGrad(groundTex, vec3(uv, float(idAt(i0 + ivec2(0,1)))), dx, dy).rgb;
      if (w3 > 0.002) col += w3 * textureGrad(groundTex, vec3(uv, float(idAt(i0 + ivec2(1,1)))), dx, dy).rgb;
      col *= 0.8 + 0.4 * texture(macro, vUv / 13.0).r;
      vec3 n = normalize(vN);
      float rock = smoothstep(0.90, 0.66, n.y) * smoothstep(0.0, 0.2, vH);       // steep land shows rock
      col = mix(col, textureGrad(groundTex, vec3(uv * 1.7, 11.0), dx, dy).rgb, rock * 0.85);
      float diff = max(dot(n, sun), 0.0);
      col *= 0.40 + 0.12 * n.y + 0.82 * diff;
      if (gridOn > 0.5) {
        vec2 g = abs(fract(vUv - 0.5) - 0.5) / fwidth(vUv);
        col = mix(col, vec3(0.0), (1.0 - min(min(g.x, g.y), 1.0)) * 0.45);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.frustumCulled = false; // the oblique view shears height out of the frustum's box

// ---------- water: one plane over the low ground, shore from the heightfield ----------
const hHalf = new Uint16Array(VX * VY);
for (let i = 0; i < hf.length; i++) hHalf[i] = THREE.DataUtils.toHalfFloat(hf[i]);
const hTex = new THREE.DataTexture(hHalf, VX, VY, THREE.RedFormat, THREE.HalfFloatType);
hTex.minFilter = hTex.magFilter = THREE.LinearFilter; hTex.unpackAlignment = 1; hTex.needsUpdate = true;
const waterMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { pres: { value: presTex }, mapSize: { value: new THREE.Vector2(W, H) }, hTex: { value: hTex }, hSize: { value: new THREE.Vector2(VX, VY) }, S: { value: S }, time: { value: 0 }, sun: { value: SUN } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D hTex; uniform sampler2D pres; uniform vec2 mapSize; uniform vec2 hSize; uniform float S; uniform float time; uniform vec3 sun; varying vec2 vP;
    void main(){
      if (texelFetch(pres, clamp(ivec2(floor(vP)), ivec2(0), ivec2(mapSize) - 1), 0).r < 0.5) discard; // absent tile (Isometric shape's corners)
      float h = texture(hTex, (vP * S + 0.5) / hSize).r;
      float wave = sin(vP.x * 5.0 + time * 1.1) * sin(vP.y * 4.3 - time * 0.8) + 0.5 * sin((vP.x + vP.y) * 9.0 + time * 1.7);
      float depth = -h + 0.012 * wave;
      if (depth < -0.02) discard;
      vec3 shallow = vec3(0.26, 0.64, 0.68), deep = vec3(0.04, 0.17, 0.36);
      vec3 col = mix(shallow, deep, smoothstep(0.0, 0.55, depth));
      float foam = smoothstep(0.085, 0.0, depth) * (0.55 + 0.45 * sin(depth * 70.0 - time * 2.2));
      col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.8);
      float glint = pow(max(0.0, 0.5 + 0.5 * wave), 5.0) * 0.05;
      col *= 0.55 + 0.45 * sun.y;
      col += glint;
      float alpha = mix(0.50, 0.97, smoothstep(0.0, 0.2, depth));
      alpha = max(alpha * smoothstep(-0.02, 0.012, depth), foam * 0.6 * smoothstep(-0.02, 0.0, depth));
      gl_FragColor = vec4(col, alpha);
    }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(W / 2, 0, H / 2), waterMat);
water.renderOrder = 2; water.frustumCulled = false;

// ---------- trees and peaks (procedural low-poly, instanced) ----------
function coloured(geo, rgb, jitter = 0) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const j = 1 + (jitter ? (hash(i, 3, 9) - 0.5) * jitter : 0); c[i * 3] = rgb[0] * j; c[i * 3 + 1] = rgb[1] * j; c[i * 3 + 2] = rgb[2] * j; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const stripUv = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
function conifer() {
  const parts = [coloured(stripUv(new THREE.CylinderGeometry(0.03, 0.05, 0.2, 5).translate(0, 0.1, 0)), [0.34, 0.24, 0.14])];
  [[0.24, 0.42, 0.14], [0.19, 0.38, 0.34], [0.13, 0.34, 0.52]].forEach(([r, h, y], i) =>
    parts.push(coloured(stripUv(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0)), [0.62 + i * 0.05, 0.85 + i * 0.04, 0.62])));
  return mergeGeometries(parts);
}
function broadleaf() {
  const trunk = coloured(stripUv(new THREE.CylinderGeometry(0.035, 0.055, 0.34, 5).translate(0, 0.17, 0)), [0.38, 0.27, 0.16]);
  const crown = new THREE.IcosahedronGeometry(0.22, 0).scale(1, 0.85, 1).translate(0, 0.5, 0);
  const crown2 = new THREE.IcosahedronGeometry(0.15, 0).translate(0.08, 0.66, 0.03);
  return mergeGeometries([trunk, coloured(stripUv(crown), [0.8, 0.95, 0.7], 0.2), coloured(stripUv(crown2), [0.9, 1.0, 0.75], 0.2)]);
}
function peak(seed) {
  const g = new THREE.ConeGeometry(0.5, 1, 7, 3).toNonIndexed();
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash(Math.round(x * 100), Math.round(z * 100), seed) - 0.5) * 0.45 * (y > -0.45 ? 1 : 0.3);
    p.setXYZ(i, x * k, y + (hash(Math.round(x * 50), Math.round(y * 50), seed + 3) - 0.5) * 0.12 * (y > -0.45 ? 1 : 0), z * k);
    const snow = y > 0.12 + (hash(Math.round(x * 30), Math.round(z * 30), seed) - 0.5) * 0.2 ? 1 : 0;
    const v = snow ? [0.93, 0.95, 0.98] : [0.50 + 0.1 * hash(i, 1, seed), 0.47 + 0.1 * hash(i, 2, seed), 0.45];
    c.set(v, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv'); g.computeVertexNormals(); g.translate(0, 0.5, 0);
  return g;
}
function pawn() {
  const body = coloured(stripUv(new THREE.CylinderGeometry(0.1, 0.17, 0.34, 8).translate(0, 0.17, 0)), [1, 1, 1]);
  const head = coloured(stripUv(new THREE.SphereGeometry(0.1, 8, 6).translate(0, 0.42, 0)), [0.95, 0.8, 0.65]);
  return mergeGeometries([body, head]);
}
function ship() {
  const hull = coloured(stripUv(new THREE.BoxGeometry(0.3, 0.12, 0.62).translate(0, 0.06, 0)), [0.55, 0.38, 0.22]);
  const prow = coloured(stripUv(new THREE.ConeGeometry(0.15, 0.2, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4).translate(0, 0.06, -0.4)), [0.55, 0.38, 0.22]);
  const mast = coloured(stripUv(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4).translate(0, 0.37, 0)), [0.3, 0.2, 0.1]);
  const sail = coloured(stripUv(new THREE.BoxGeometry(0.02, 0.3, 0.3).translate(0, 0.4, 0)), [1, 1, 1]);
  return mergeGeometries([hull, prow, mast, sail]);
}
const lam = new THREE.MeshLambertMaterial({ vertexColors: true });

t = performance.now();
const conifers = [], broads = [], peaks = [[], [], []];
const treeTint = { borealForest: [0.55, 0.78, 0.7], coniferForest: [0.7, 0.9, 0.7], mixedForest: [0.85, 1, 0.8], wetlandForest: [0.7, 0.85, 0.6],
  scrubForest: [1.1, 1, 0.6], rainForest: [0.55, 0.95, 0.6], broadleafForest: [0.95, 1.05, 0.75], tropicalForest: [0.7, 1.05, 0.55] };
for (let ty = 0; ty < H; ty++) {
  for (let tx = 0; tx < W; tx++) {
    const k = kind[ty * W + tx];
    if (!k) continue;
    if (FOREST.has(k)) {
      const n = 3 + Math.floor(hash(tx, ty, 11) * 4); // 3..6
      const pts = [];
      for (let a = 0, tries = 0; pts.length < n && tries < 40; tries++, a++) {
        const px = 0.14 + 0.72 * hash(tx, ty, 20 + tries * 2), py = 0.14 + 0.72 * hash(tx, ty, 21 + tries * 2);
        if (pts.every(([x, y]) => (x - px) ** 2 + (y - py) ** 2 > 0.07)) pts.push([px, py]);
      }
      const isCon = k === 'borealForest' || k === 'coniferForest' || (k === 'mixedForest' && hash(tx, ty, 5) < 0.5);
      pts.forEach(([ox, oy], i) => {
        const x = tx + ox, y = ty + oy;
        const sc = (k === 'scrubForest' ? 0.55 : 1) * (0.85 + 0.5 * hash(tx, ty, 40 + i)) * (isCon ? 1.15 : 1.0);
        (isCon ? conifers : broads).push({ x, y, h: heightAt(x, y), s: sc, r: hash(tx, ty, 60 + i) * 6.28, tint: treeTint[k] });
      });
    } else if (k === 'mountains') {
      const v = Math.floor(hash(tx, ty, 70) * 3);
      peaks[v].push({ x: tx + 0.5 + (hash(tx, ty, 71) - 0.5) * 0.12, y: ty + 0.5 + (hash(tx, ty, 72) - 0.5) * 0.12,
        h: heightAt(tx + 0.5, ty + 0.5) - 0.12, s: 0.95 + 0.35 * hash(tx, ty, 73), r: hash(tx, ty, 74) * 6.28, ht: 1.05 + 0.5 * hash(tx, ty, 75) });
    }
  }
}
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
function instanced(geo, list, mat, tall = false) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1)); m.count = list.length;
  list.forEach((it, i) => {
    dummy.position.set(it.x, it.h, it.y); dummy.rotation.set(0, it.r, 0);
    dummy.scale.set(it.s, tall ? it.s * (it.ht ?? 1) : it.s, it.s); dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (it.tint) { const v = 0.9 + 0.2 * hash(Math.round(it.x * 50), Math.round(it.y * 50), 3); m.setColorAt(i, tmpC.setRGB(it.tint[0] * v, it.tint[1] * v, it.tint[2] * v)); }
  });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}
const treeObjs = [instanced(conifer(), conifers, lam), instanced(broadleaf(), broads, lam)];
const peakObjs = peaks.map((l, i) => instanced(peak(i + 1), l, lam, true));

// units: ~50 markers on tile centres (40 on land, 10 ships)
const NATION = [[0.85, 0.15, 0.15], [0.15, 0.3, 0.85], [0.95, 0.85, 0.1], [0.15, 0.65, 0.25], [0.95, 0.95, 0.95], [0.1, 0.1, 0.1], [0.8, 0.4, 0.05], [0.6, 0.2, 0.7]];
const landTiles = [], seaTiles = [];
for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
  const k = kind[ty * W + tx]; if (!k) continue;
  if (k === 'ocean') seaTiles.push([tx, ty]); else if (k !== 'highSeas' && k !== 'lake' && k !== 'arctic') landTiles.push([tx, ty]);
}
const pick = (arr, n, seed) => { const out = []; for (let i = 0; out.length < n && i < n * 50; i++) { const p = arr[Math.floor(hash(i, seed, 99) * arr.length)]; if (!out.includes(p)) out.push(p); } return out; };
const mkUnits = (tiles, tall) => tiles.map(([tx, ty], i) => ({ x: tx + 0.5, y: ty + 0.5, h: Math.max(heightAt(tx + 0.5, ty + 0.5), 0) - (tall ? 0.03 : 0), s: tall ? 1.4 : 1.7, r: tall ? hash(tx, ty, 8) * 6.28 : 0, tint: NATION[i % NATION.length] }));
const unitObjs = [instanced(pawn(), mkUnits(pick(landTiles, 40, 1), false), lam), instanced(ship(), mkUnits(pick(seaTiles, 10, 2), true), lam)];
mark('instancesMs', t);

// ---------- scene, lights, camera ----------
const canvas = document.getElementById('c');
const maxdpr = +(Q.get('maxdpr') ?? 9);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.get('aa') === '1', powerPreference: 'default', alpha: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxdpr));
renderer.setClearColor(0x0a1830);
const scene = new THREE.Scene();
scene.add(terrain, water, ...treeObjs, ...peakObjs, ...unitObjs);
const sunLight = new THREE.DirectionalLight(0xfff3dc, 0.95 * Math.PI); sunLight.position.copy(SUN).multiplyScalar(50);
scene.add(sunLight, sunLight.target, new THREE.HemisphereLight(0xcfe0ff, 0x6a6048, 0.62 * Math.PI));
const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
const pcam = new THREE.PerspectiveCamera(35, 1, 1, 3000); // the 'tilt' view: perspective, north up, grid not rotated
let cam = ocam;
const view = { yaw: 0, pitch: 70, px: 40, tx: W / 2, tz: H / 2 };
const VIEWS = { topdown: { yaw: 0, pitch: +(Q.get('pitch') ?? 70), persp: false, shear: 0 }, iso: { yaw: 45, pitch: +(Q.get('pitch') ?? 30), persp: false, shear: 0 },
  tilt: { yaw: 0, pitch: +(Q.get('pitch') ?? 45), persp: true, shear: 0 },
  // Colonization oblique: straight down, ground square and north up, height sheared up the screen by k
  oblique: { yaw: 0, pitch: 90, persp: false, shear: +(Q.get('k') ?? 0.8) } };
const isoShaped = json.shape === 'isometric';
function mapCentreFor() { return [W / 2, H / 2]; }
function updateCam() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const y = view.yaw * Math.PI / 180, p = view.pitch * Math.PI / 180;
  const hx = Math.sin(y), hz = Math.cos(y);
  cam = view.persp ? pcam : ocam;
  let dist = 100;
  if (view.persp) {
    pcam.aspect = w / h; // view.px is the pixels a tile spans at the target
    dist = h / (2 * view.px * Math.tan(pcam.fov * Math.PI / 360));
    pcam.near = Math.max(dist * 0.05, 0.5); pcam.far = dist * 6 + 400; pcam.updateProjectionMatrix();
  } else {
    const hh = h / (2 * view.px), hw = hh * (w / h);
    ocam.left = -hw; ocam.right = hw; ocam.top = hh; ocam.bottom = -hh; ocam.updateProjectionMatrix();
    if (view.shear) {
      // Oblique projection. View space looks straight down: x east, y north (up the screen), z = world height.
      // clip.y = sy * (y + k z) draws anything with height up the screen, so it shows its side.
      // clip.z = c * (y - 0.5 z): depth follows north-south first (further south draws over further north, as in
      // Colonization), height second, so a tall thing does not sink behind the row north of it.
      const te = ocam.projectionMatrix.elements, sy = te[5], c = 1 / 200;
      te[9] = sy * view.shear; te[13] = sy * view.shear * 100; // the camera is 100 above the ground: height 0 does not shift
      te[6] = c; te[10] = -c * 0.5; te[14] = 0;
      ocam.projectionMatrixInverse.copy(ocam.projectionMatrix).invert();
    }
  }
  cam.up.set(-hx, 0, -hz);
  cam.position.set(view.tx + hx * Math.cos(p) * dist, Math.sin(p) * dist, view.tz + hz * Math.cos(p) * dist);
  cam.lookAt(view.tx, 0, view.tz);
  cam.updateMatrixWorld();
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  updateCam();
}
window.addEventListener('resize', resize);
function setView(name) { Object.assign(view, VIEWS[name]); updateCam(); }
function fit() {
  // the largest zoom at which the whole map is on screen in the current view
  view.tx = W / 2; view.tz = H / 2;
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const fits = (px) => { view.px = px; updateCam(); return corners.every((c) => { const v = c.clone().project(cam); return Math.abs(v.x) <= 0.98 && Math.abs(v.y) <= 0.98; }); };
  let lo = 0.5, hi = 400;
  for (let i = 0; i < 30; i++) { const m = Math.sqrt(lo * hi); if (fits(m)) lo = m; else hi = m; }
  view.px = lo; updateCam();
}
function clampTarget() { view.tx = cl(view.tx, 0, W); view.tz = cl(view.tz, 0, H); }
// pan: dragging moves the ground with the pointer (vertical drags are foreshortened by the pitch)
function pan(dx, dy) {
  const y = view.yaw * Math.PI / 180, sp = Math.sin(view.pitch * Math.PI / 180);
  const rx = Math.cos(y), rz = -Math.sin(y), ux = -Math.sin(y), uz = -Math.cos(y);
  view.tx += (-dx * rx) / view.px + (dy * ux) / (view.px * sp);
  view.tz += (-dx * rz) / view.px + (dy * uz) / (view.px * sp);
  clampTarget(); updateCam();
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => { if (drag) { pan(e.clientX - drag[0], e.clientY - drag[1]); drag = [e.clientX, e.clientY]; } });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.px = cl(view.px * Math.exp(-e.deltaY * 0.0015), 3, 200); updateCam(); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'g') terrainMat.uniforms.gridOn.value ^= 1;
  if (e.key === 'v') setView(view.persp ? 'oblique' : view.shear ? 'topdown' : view.yaw ? 'tilt' : 'iso');
  if (e.key === 'f') fit();
});

// ---------- frame loop, stats, bench ----------
const gl = renderer.getContext();
const hud = document.getElementById('hud');
if (Q.get('hud') === '0') hud.style.display = 'none';
let bench = null, frames = 0, lastT = performance.now();
const rafMs = [], workMs = [], px1 = new Uint8Array(4); // a 1 px readback blocks until the GPU has drawn the frame
function frame(now) {
  requestAnimationFrame(frame);
  if (bench) {
    const u = (now - bench.start) / 1000, ph = u / bench.secs;
    // a scripted path: sweep across the map while the zoom breathes between ~16 and ~48 px a tile
    view.px = bench.far ? bench.farPx : 32 * Math.exp(0.5 * Math.sin(ph * Math.PI * 4)); // far: the whole map on screen
    const k = bench.far ? 0.04 : 0.35;
    view.tx = W / 2 + Math.sin(ph * Math.PI * 2) * W * k; view.tz = H / 2 + Math.cos(ph * Math.PI * 3) * H * k * 0.85;
    updateCam();
    if (frames > 2) rafMs.push(now - lastT);
  }
  lastT = now;
  waterMat.uniforms.time.value = now / 1000;
  const t0 = performance.now();
  renderer.render(scene, cam);
  if (bench) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); if (frames > 2) workMs.push(performance.now() - t0); }
  frames++;
  if (bench && now - bench.start > bench.secs * 1000) { const r = bench.done; bench = null; r(); }
  if (frames % 20 === 0 && hud.style.display !== 'none') {
    const i = renderer.info;
    hud.textContent = `${mapName} map ${W}x${H}  view ${view.persp ? 'tilt (perspective)' : view.yaw ? 'isometric' : 'top-down'}  ${view.px.toFixed(1)} px/tile\ncalls ${i.render.calls}  tris ${i.render.triangles}  [g] grid  [v] view  [f] fit`;
  }
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const bytesOf = (a) => a.byteLength;
window.proto = {
  W, H, shape: json.shape, setView, fit, timing,
  setGrid: (on) => (terrainMat.uniforms.gridOn.value = on ? 1 : 0),
  setZoom: (px) => { view.px = px; updateCam(); },
  lookAt: (x, y) => { view.tx = x; view.tz = y; updateCam(); },
  tileKinds: () => kind,
  stats() {
    const i = renderer.info;
    const texBytes = TEX * TEX * 4 * NL * 4 / 3 + 64 * 64 + W * H + VX * VY * 2;
    const geoBytes = pos.byteLength + nor.byteLength + uvs.byteLength + idx.length * 4 +
      [...treeObjs, ...peakObjs, ...unitObjs].reduce((a, m) => a + m.geometry.attributes.position.array.byteLength * 2 + m.instanceMatrix.array.byteLength, 0);
    return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries,
      textureMB: +(texBytes / 1048576).toFixed(2), geometryMB: +(geoBytes / 1048576).toFixed(2), terrainTris: idx.length / 3,
      trees: conifers.length + broads.length, peaks: peaks.reduce((a, l) => a + l.length, 0), units: unitObjs.reduce((a, m) => a + m.count, 0),
      renderer: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), dpr: renderer.getPixelRatio(), size: [canvas.width, canvas.height] };
  },
  runBench(secs = 6, far = false) {
    if (far) fit();
    rafMs.length = 0; workMs.length = 0; frames = 0;
    return new Promise((res) => { bench = { far, farPx: view.px, start: performance.now(), secs, done: () => res({ rafP50: pct(rafMs, 0.5), rafP95: pct(rafMs, 0.95), workP50: pct(workMs, 0.5), workP95: pct(workMs, 0.95), frames: workMs.length }) } });
  },
};
setView(Q.get('view') ?? 'topdown');
resize();
if (Q.get('fit') !== '0') fit();
renderer.render(scene, cam);
gl.finish();
timing.loadToFirstFrameMs = Math.round(performance.now() - T0);
window.protoReady = true;
requestAnimationFrame(frame);
