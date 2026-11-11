// PROTOTYPE (#411): one river mesh, using FreeCol's existing recipes for the masks and pebble banks.
// The atlas packs screen-space flow in RG, minor/major speed blend in B, and the original mask in A.
// Bends are baked once on the CPU, leaving four texture reads and no neighbour work in the shader.
import { BufferImageSource, Geometry, ImageSource } from 'pixi.js';
import {
  paintedWaterAtlas,
  RIVER_MIDPOINTS,
  riverDirections,
  RIVER_SIDES,
  riverNeighbour,
  riverPlume,
  ShaderSurface,
  type RiverMap,
  type WaterLook,
} from './map-water';
import { isAnimated, passOf, STILL, type Op, type Recipe, type Src } from './tileset';
import { H, W, tileOrigin } from './view';

type Picture = HTMLImageElement | HTMLCanvasElement;
const VERTEX = `precision highp float;
in vec2 aPosition;
in vec2 aUv;
in float aMouth;
out vec2 vPosition;
out vec2 vUv;
out float vMouth;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPosition = aPosition;
  vUv = aUv;
  vMouth = aMouth;
}`;
const FRAGMENT = `precision highp float;
in vec2 vPosition;
in vec2 vUv;
in float vMouth;
out vec4 finalColor;
uniform sampler2D uRiverAtlas;
uniform sampler2D uWater;
uniform sampler2D uClimate;
uniform vec2 uFieldSize;
uniform vec3 uShal0;
uniform vec3 uShal1;
uniform vec3 uShal2;
uniform vec2 uSpeeds;
uniform float uTime;
uniform float uSplit;
uniform float uDeeper;
uniform float uStreakStrength;
// Soft dappled light carried by the river's own flow field, so it follows bends. Analytic noise: no texture reads.
// The ground is drawn at 2:1, so the noise is stretched across the screen to sit flat on it.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ripple(vec2 q) {
  float n = vnoise(q / 5.0) * 0.6 + vnoise(q / 2.5 + 17.0) * 0.4;
  return smoothstep(0.56, 0.82, n);
}
void main() {
  if (gl_FragCoord.x < uSplit) discard;
  vec4 mask = texture(uRiverAtlas, vUv);
  if (mask.a < 0.004) discard;
  vec2 velocity = (mask.rg * 2.0 - 1.0) * mix(uSpeeds.y, uSpeeds.x, mask.b);
  vec2 uv = vec2(vPosition.x + 2.0 * vPosition.y, 2.0 * vPosition.y - vPosition.x) * 0.63 / 128.0;
  vec2 travel = vec2(velocity.x + 2.0 * velocity.y, 2.0 * velocity.y - velocity.x) * 16.0 * 0.63 / 128.0;
  float phase = fract(uTime / 16.0);
  vec3 a = texture(uWater, uv - travel * phase).rgb;
  vec3 b = texture(uWater, uv - travel * fract(phase + 0.5)).rgb;
  vec3 art = mix(a, b, abs(phase * 2.0 - 1.0));
  vec4 climate = texture(uClimate, vPosition / uFieldSize);
  vec3 w = climate.rgb / max(dot(climate.rgb, vec3(1.0)), 0.001);
  vec3 shallow = (uShal0 * w.r + uShal1 * w.g + uShal2 * w.b) *
    mix(vec3(1.0), vec3(0.82, 0.86, 0.88), uDeeper);
  // The same painted-art modulation and near-shore tint as variant D.
  vec3 col = mix(art, shallow * (0.8 + dot(art, vec3(0.3))), dot(w, vec3(0.8, 0.75, 1.0)) * 0.92);
  col *= 1.0 - 0.12 * (1.0 - mask.b) * smoothstep(0.45, 1.0, mask.a);
  // Two phases a short cycle apart, as for the art: offsets stay small, so bends don't shear the pattern.
  vec2 q = vec2(vPosition.x, vPosition.y * 2.0);
  vec2 drift = vec2(velocity.x, velocity.y * 2.0) * 1.5;
  float rp = fract(uTime / 1.5);
  float current = mix(ripple(q - drift * rp), ripple(q - drift * fract(rp + 0.5) + vec2(37.0, 11.0)), abs(rp * 2.0 - 1.0));
  col += vec3(current * uStreakStrength);
  // Broken, faint foam only at the mixing edge of a mouth, never bands along the river.
  float foam = vMouth * 4.0 * climate.a * (1.0 - climate.a) * current * 0.16;
  col = mix(col, vec3(0.83, 0.88, 0.85), foam);
  // The soft mask keeps the pebble banks; opaque channel centres must not show stationary gravel.
  // Real rivers carry silt and shade: darker than the sunlit shallows they borrow their tint from.
  col *= 0.72;
  float alpha = mask.a;
  finalColor = vec4(col * alpha, alpha);
}`;

interface Patch {
  x: number;
  y: number;
  mask: Recipe;
  downstream: number;
  style: string;
  magnitude: number;
  /** A delta's tile mask, used to extend its original water shape into its own plume. */
  keep?: Src;
}

export interface RiverDrawing {
  banks: Op[];
  geometry: Geometry;
  atlas: BufferImageSource;
}

/** Strip only the water draw from a river recipe. All bank masks and their soft edges remain FreeCol's. */
export async function riverDrawing(
  map: RiverMap,
  base: Op[],
  get: (src: Src) => Promise<Picture>,
): Promise<RiverDrawing> {
  const directions = riverDirections(map);
  const tiles = new Map(map.rivers.map((r) => [r[1] * map.w + r[0], r]));
  const patches: Patch[] = [];
  const banks = base.map((op) => {
    if (op.k !== 'image') return op;
    const recipe = isAnimated(op.src) ? op.src.animate(STILL) : op.src;
    if (typeof recipe === 'string' || isAnimated(recipe)) return op;
    const mouth = recipe.id.startsWith('delta:')
      ? RIVER_SIDES.findIndex((s) => recipe.id.endsWith(`:${s.toLowerCase()}:fading`))
      : -1;
    if (!recipe.id.startsWith('river:') && mouth < 0) return op;
    const [rx, ry] = mouth < 0 ? [op.x, op.y] : riverNeighbour(op.x, op.y, mouth);
    const river = tiles.get(ry * map.w + rx);
    if (!river) return op;
    const water = recipe.steps[1];
    if (!('draw' in water) || typeof water.draw === 'string' || isAnimated(water.draw)) return op;
    const shape = water.draw.steps[1];
    if (!('mask' in shape)) return op;
    const mask: Recipe = {
      id: `flow-mask:${recipe.id}`,
      steps: [{ draw: shape.mask }, ...recipe.steps.slice(2)],
    };
    const keep = recipe.steps[2];
    patches.push({
      x: op.x,
      y: op.y,
      mask,
      downstream: mouth < 0 ? (directions.get(ry * map.w + rx) ?? -1) : (mouth + 2) % 4,
      style: mouth < 0 ? river[3] : '0000',
      magnitude: river[2],
      keep: mouth >= 0 && 'mask' in keep ? keep.mask : undefined,
    });
    const bank: Op = {
      ...op,
      src: { id: `flow-banks:${recipe.id}`, steps: [recipe.steps[0], ...recipe.steps.slice(2)] },
    };
    passOf.set(bank, passOf.get(op) ?? 0);
    return bank;
  });
  const entries = new Map<string, { patch: Patch; slot: number }>();
  const slots = patches.map((patch) => {
    const key = `${patch.mask.id}:${patch.downstream}:${patch.style}:${patch.magnitude}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { patch, slot: entries.size };
      entries.set(key, entry);
    }
    return entry.slot;
  });
  const cols = Math.min(16, Math.max(1, entries.size));
  const rows = Math.max(1, Math.ceil(entries.size / cols));
  const width = cols * (W + 2),
    height = rows * (H + 2);
  const data = new Uint8Array(width * height * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const { patch, slot } of entries.values()) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(await get(patch.mask), 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;
    let keep: Uint8ClampedArray | undefined;
    if (patch.keep) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(await get(patch.keep), 0, 0, W, H);
      keep = ctx.getImageData(0, 0, W, H).data;
    }
    const connected = [0, 1, 2, 3].filter((s) => Number(patch.style[s]) > 0);
    const downstream = patch.downstream;
    const out = downstream < 0 ? [0, 0] : RIVER_MIDPOINTS[downstream];
    const mouthLength = Math.hypot(out[0], out[1] * 2);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const px = x + 0.5 - W / 2,
          py = y + 0.5 - H / 2;
        let vx = out[0] / 35.777,
          vy = out[1] / 35.777;
        let total = 1,
          minor = patch.magnitude <= 1 ? 1 : 0;
        // Inverse fourth-power weights approach the side's exact normal at every shared midpoint.
        // A side uses the connection magnitude, so minor-to-major joins agree on speed at their shared edge.
        for (const side of connected) {
          const [sx, sy] = RIVER_MIDPOINTS[side];
          const d2 = (px - sx) ** 2 + (py - sy) ** 2;
          const weight = 160000 / Math.max(1, d2 * d2);
          const sign = side === downstream ? 1 : -1;
          vx += (weight * sign * sx) / 35.777;
          vy += (weight * sign * sy) / 35.777;
          minor += weight * (Math.max(patch.magnitude, Number(patch.style[side])) <= 1 ? 1 : 0);
          total += weight;
        }
        const length = Math.hypot(vx, vy);
        const at = ((Math.floor(slot / cols) * (H + 2) + y + 1) * width + (slot % cols) * (W + 2) + x + 1) * 4;
        data[at] = Math.round((length ? (vx / length) * 0.5 + 0.5 : 0.5) * 255);
        data[at + 1] = Math.round((length ? (vy / length) * 0.5 + 0.5 : 0.5) * 255);
        data[at + 2] = Math.round((minor / total) * 255);
        const pixel = (y * W + x) * 4 + 3;
        let alpha = pixels[pixel];
        if (keep) {
          const offshore = mouthLength + (px * out[0] + py * out[1] * 4) / mouthLength;
          const side = Math.abs(px * out[1] * 2 - py * out[0] * 2) / mouthLength;
          alpha =
            (Math.max(
              alpha * riverPlume(offshore, 0, patch.magnitude),
              255 * riverPlume(offshore, side, patch.magnitude),
            ) *
              keep[pixel]) /
            255;
        }
        data[at + 3] = Math.round(alpha);
      }
  }
  const positions = new Float32Array(patches.length * 8);
  const uvs = new Float32Array(patches.length * 8);
  const mouths = new Float32Array(patches.length * 4);
  const indices = new Uint32Array(patches.length * 6);
  patches.forEach((patch, i) => {
    const [x, y] = tileOrigin(patch.x, patch.y);
    positions.set([x, y, x + W, y, x + W, y + H, x, y + H], i * 8);
    const u = ((slots[i] % cols) * (W + 2) + 1) / width;
    const v = (Math.floor(slots[i] / cols) * (H + 2) + 1) / height;
    uvs.set([u, v, u + W / width, v, u + W / width, v + H / height, u, v + H / height], i * 8);
    mouths.fill(patch.keep ? 1 : 0, i * 4, i * 4 + 4);
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return {
    banks,
    geometry: new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: 'float32x2' },
        aUv: { buffer: uvs, format: 'float32x2' },
        aMouth: { buffer: mouths, format: 'float32' },
      },
      indexBuffer: indices,
    }),
    atlas: new BufferImageSource({
      resource: data,
      width,
      height,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'linear',
    }),
  };
}

export class RiverSurface {
  readonly surface: ShaderSurface;
  private last = -1;
  private time = 0;
  constructor(drawing: RiverDrawing, water: Picture) {
    this.surface = new ShaderSurface(
      VERTEX,
      FRAGMENT,
      {
        uTime: { value: 0, type: 'f32' },
        uSplit: { value: 0, type: 'f32' },
        uDeeper: { value: 0, type: 'f32' },
        uStreakStrength: { value: 0.1, type: 'f32' },
        uSpeeds: { value: [6, 3], type: 'vec2<f32>' },
        uShal0: { value: [0, 0, 0], type: 'vec3<f32>' },
        uShal1: { value: [0, 0, 0], type: 'vec3<f32>' },
        uShal2: { value: [0, 0, 0], type: 'vec3<f32>' },
      },
      {
        uRiverAtlas: drawing.atlas,
        uWater: new ImageSource({ resource: paintedWaterAtlas([water]), addressMode: 'repeat', scaleMode: 'linear' }),
      },
      undefined,
      drawing.geometry,
    );
  }
  setTime(ms: number, moving: boolean, look: WaterLook, rate: number) {
    if (this.last >= 0 && moving) this.time += Math.min(0.1, Math.max(0, (ms - this.last) / 1000)) * rate;
    this.last = ms;
    const u = this.surface.uniforms;
    u.uTime = this.time;
    u.uDeeper = look.recipe?.depth === 'deeper' ? 1 : 0;
    u.uStreakStrength = look.rivers?.streakStrength ?? 0.1;
    const speeds = u.uSpeeds as number[];
    speeds[0] = look.rivers?.minor ?? 6;
    speeds[1] = look.rivers?.major ?? 3;
    this.tint('uShal0', look.palettes.cold.shallow);
    this.tint('uShal1', look.palettes.temperate.shallow);
    this.tint('uShal2', look.palettes.tropical.shallow);
  }
  private tint(name: string, color: number) {
    const rgb = this.surface.uniforms[name] as number[];
    rgb[0] = ((color >> 16) & 255) / 255;
    rgb[1] = ((color >> 8) & 255) / 255;
    rgb[2] = (color & 255) / 255;
  }
}
