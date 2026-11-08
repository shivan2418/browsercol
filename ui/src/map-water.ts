// The shader water (#409): in a Tileset that has the look for it (FreeCol+), the ocean, lakes and high seas are one
// surface under the land, coloured per pixel by a fragment shader, in place of FreeCol's 21 painted frames.
//
// Two seamless ripple textures from the Tileset slide over each other in different directions, so the pattern never
// visibly repeats; their slopes light the crests from the north-west, as FreeCol's art is lit, and where both crest
// together they glint. A field over the whole map, a texel per FIELD_TEXEL map pixels, says where the land and the
// coasts' sand are, how near they are, how deep the water is (a lake, the ocean, the high seas), and where there is
// water at all: near land the water is shallower and lighter, and foams where the sand fades into it; the high seas
// are darker and rougher.
//
// It is a few texture reads (the field and two ripples) and a little arithmetic per pixel, for a netbook's GPU. Where
// it cannot run (PixiJS's Canvas renderer, the Canvas 2D pen, a GPU without highp floats in its fragment shaders), the
// map draws FreeCol's frames (tileset.ts WaterDrawing).
//
// ShaderSurface is the part another surface reuses (#411's rivers): a mesh over the map's pixels with a shader, a field
// texture of the map, and textures and uniforms for its look.
import { BufferImageSource, Geometry, ImageSource, Mesh, Shader, type TextureSource } from 'pixi.js';
import { MAP_KEY_FAMILIES } from './map-keys';
import type { Resources } from './resources';
import type { MapView } from './tileset';
import { H, W } from './view';

const KEY = MAP_KEY_FAMILIES.shaderWater;

/** The shader water's look, from the Tileset's shader.water.* keys. */
export interface WaterLook {
  /** The ripple images: long swell, and short chop over it. Seamless, a power of two square. */
  swell: string;
  chop: string;
  /** Open coastal ocean, the high seas, and lakes and great rivers. */
  ocean: number;
  highSeas: number;
  lake: number;
  /** The water near land, which the deep colour lightens toward. */
  shallow: number;
  foam: number;
  /** The light on crests and glints. */
  light: number;
  /** How rough the coastal ocean and lakes are, and the high seas: how strongly their ripples are lit. */
  roughness: number;
  highSeasRoughness: number;
  /** How fast the ripples move, 1 the Tileset's normal. */
  speed: number;
  /** How long a swell and a chop texture are across, in map pixels. */
  swellSize: number;
  chopSize: number;
}

/** A number from a string resource, or the fallback when the Tileset has none. */
const numberOf = (res: Resources, key: string, fallback: number) => {
  const n = Number(res.string(key));
  return Number.isFinite(n) ? n : fallback;
};

/** The Tileset's water look, or null when it has none (FreeCol's own: its water stays FreeCol's frames). */
export function waterLook(res: Resources): WaterLook | null {
  const swell = res.path(`${KEY}swell`);
  const chop = res.path(`${KEY}chop`);
  if (!swell || !chop) return null;
  const color = (k: string) => res.color(`${KEY}${k}`);
  return {
    swell,
    chop,
    ocean: color('ocean'),
    highSeas: color('highSeas'),
    lake: color('lake'),
    shallow: color('shallow'),
    foam: color('foam'),
    light: color('light'),
    roughness: numberOf(res, `${KEY}roughness`, 0.5),
    highSeasRoughness: numberOf(res, `${KEY}highSeasRoughness`, 0.8),
    speed: numberOf(res, `${KEY}speed`, 1),
    swellSize: numberOf(res, `${KEY}swellSize`, 512),
    chopSize: numberOf(res, `${KEY}chopSize`, 192),
  };
}

/** The map pixels a field texel covers, at the least: a tile is 16 by 8 of them, and a coast's sand fades over 3. */
export const FIELD_TEXEL = 8;
/** How far from land the water is shallower, and how far the high seas and lakes fade into the ocean, in map pixels. */
const SHALLOW_PX = 48;
const DEPTH_PX = 96;

/** The whole map's size in map pixels: odd rows stick out half a tile, and each row is half a tile down. */
export const mapPixels = (w: number, h: number): [number, number] => [w * W + W / 2, ((h + 1) * H) / 2];

/** The map pixels a field texel covers for a map, so the field is no more than `max` texels either way. */
export const fieldTexel = (w: number, h: number, max = 4096): number => {
  const [pw, ph] = mapPixels(w, h);
  return Math.max(FIELD_TEXEL, Math.ceil(pw / max), Math.ceil(ph / max));
};

/**
 * The field the shader reads, a texel per `texel` map pixels, RGBA: red how much land or a coast's sand covers there,
 * green the water's depth (0 a lake, a half the ocean, 1 the high seas), blue how near land is, and alpha whether
 * there is water there at all.
 */
export interface WaterField {
  cols: number;
  rows: number;
  texel: number;
  data: Uint8Array;
  /**
   * What it was made from, unblurred, for the next field of the map to make again only round the tiles that changed.
   * The next field takes these, and its data, over.
   */
  made?: {
    w: number;
    h: number;
    types: string;
    tiles: string;
    land: Float32Array;
    depth: Float32Array;
    water: Float32Array;
  };
}

/** Tile types that are high seas, and lakes (calm, inland water). */
const HIGH_SEAS = new Set(['model.tile.highSeas']);
const LAKES = new Set(['model.tile.lake', 'model.tile.greatRiver']);
/** Where in a texel the sand is looked at: four points, for an edge smoother than the texels. */
const SAMPLES = [-0.25, -0.25, 0.25, -0.25, -0.25, 0.25, 0.25, 0.25];

/** A rectangle of texels: columns i0 to i1 and rows j0 to j1, the ends left out. */
interface Rect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * The water field of a map. Each texel's tile, at its centre, decides it, and a coast's sand counts as land as much as
 * it covers there (`sand`: its alpha, 0 to 1, at a point of the tile, or 0 for a tile with none). Then how near land
 * is and the depth are blurred, to fade over SHALLOW_PX and DEPTH_PX, and the water's edge a little.
 *
 * Given the map's `last` field, it makes again only the texels round the tiles that changed (ground explored, say),
 * reusing that field's arrays: the same field when no tile changed.
 */
export function waterField(
  map: Pick<MapView, 'w' | 'h' | 'types' | 'tiles'>,
  texel: number,
  sand: (x: number, y: number, u: number, v: number) => number,
  last?: WaterField | null,
): WaterField {
  const { w, h, tiles } = map;
  const [pw, ph] = mapPixels(w, h);
  const cols = Math.ceil(pw / texel);
  const rows = Math.ceil(ph / texel);
  const n = cols * rows;
  const types = map.types.map((t) => t.id).join();
  const was = last?.made;
  const reuse =
    !!was &&
    last.cols === cols &&
    last.rows === rows &&
    last.texel === texel &&
    was.w === w &&
    was.h === h &&
    was.types === types;
  const radius = (px: number) => Math.max(1, Math.round(px / texel / 2));
  const [nearR, depthR] = [radius(SHALLOW_PX), radius(DEPTH_PX)];
  // How far a blurred texel reaches: two passes of each blur.
  const reach = 2 * Math.max(nearR, depthR, 1);
  const all: Rect = { i0: 0, j0: 0, i1: cols, j1: rows };
  /** The texels to make again: round the tiles that changed, with their neighbours, whose sand depends on them. */
  let raw = all;
  if (reuse) {
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let k = 0; k < tiles.length; k++)
      if (tiles.charCodeAt(k) !== was.tiles.charCodeAt(k)) {
        const [x, y] = [k % w, Math.floor(k / w)];
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    if (x1 < 0) return last;
    raw = clip(
      {
        i0: Math.floor(((x0 - 1) * W) / texel),
        j0: Math.floor(((y0 - 2) * H) / 2 / texel),
        i1: Math.ceil(((x1 + 2) * W + W / 2) / texel),
        j1: Math.ceil(((y1 + 4) * H) / 2 / texel),
      },
      cols,
      rows,
    );
  }
  const land = reuse ? was.land : new Float32Array(n);
  const depth = reuse ? was.depth : new Float32Array(n);
  const water = reuse ? was.water : new Float32Array(n);
  // Per tile type: land (0), or water and its depth, offset by one.
  const kinds = map.types.map((t) => (t.land ? 0 : HIGH_SEAS.has(t.id) ? 2 : LAKES.has(t.id) ? 1 : 1.5));
  for (let j = raw.j0; j < raw.j1; j++) {
    const py = (j + 0.5) * texel;
    const row = Math.floor(py / (H / 2));
    for (let i = raw.i0; i < raw.i1; i++) {
      const px = (i + 0.5) * texel;
      const k = j * cols + i;
      // Off the map, or unexplored: no water, no land, and the ocean's depth.
      land[k] = 0;
      water[k] = 0;
      depth[k] = 0.5;
      // The tile whose diamond holds the texel's centre, as map.ts tileAt finds it.
      for (let y = row - 1; y <= row; y++) {
        if (y < 0 || y >= h) continue;
        const ox0 = (y % 2) * (W / 2);
        const x = Math.floor((px - ox0) / W);
        if (x < 0 || x >= w) continue;
        const [u, v] = [px - x * W - ox0, py - (y * H) / 2];
        if (Math.abs(u - W / 2) / (W / 2) + Math.abs(v - H / 2) / (H / 2) > 1) continue;
        const c = tiles.charCodeAt(y * w + x) - 65;
        if (c < 0) break;
        const kind = kinds[c];
        if (kind === 0) {
          land[k] = 1;
          break;
        }
        water[k] = 1;
        depth[k] = kind - 1;
        let a = 0;
        for (let s = 0; s < SAMPLES.length; s += 2) a += sand(x, y, u + SAMPLES[s] * texel, v + SAMPLES[s + 1] * texel);
        land[k] = a / (SAMPLES.length / 2);
        break;
      }
    }
  }
  // The texels whose blurred values may have changed, and the texels those are blurred from.
  const out = reuse ? clip(grow(raw, reach), cols, rows) : all;
  const src = reuse ? clip(grow(out, reach), cols, rows) : all;
  const sw = src.i1 - src.i0;
  const sh = src.j1 - src.j0;
  const part = (a: Float32Array) => {
    const p = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) p.set(a.subarray((src.j0 + j) * cols + src.i0, (src.j0 + j) * cols + src.i1), j * sw);
    return p;
  };
  const near = part(land);
  const deep = part(depth);
  const wet = part(water);
  for (let pass = 0; pass < 2; pass++) {
    blur(near, sw, sh, nearR);
    blur(deep, sw, sh, depthR);
  }
  blur(wet, sw, sh, 1);
  const data = reuse ? last.data : new Uint8Array(4 * n);
  for (let j = out.j0; j < out.j1; j++)
    for (let i = out.i0; i < out.i1; i++) {
      const k = j * cols + i;
      const p = (j - src.j0) * sw + (i - src.i0);
      data[4 * k] = Math.round(land[k] * 255);
      data[4 * k + 1] = Math.round(deep[p] * 255);
      data[4 * k + 2] = Math.round(near[p] * 255);
      data[4 * k + 3] = Math.round(wet[p] * 255);
    }
  return { cols, rows, texel, data, made: { w, h, types, tiles, land, depth, water } };
}

const grow = (r: Rect, by: number): Rect => ({ i0: r.i0 - by, j0: r.j0 - by, i1: r.i1 + by, j1: r.j1 + by });
const clip = (r: Rect, cols: number, rows: number): Rect => ({
  i0: Math.max(0, r.i0),
  j0: Math.max(0, r.j0),
  i1: Math.min(cols, r.i1),
  j1: Math.min(rows, r.j1),
});

/** A box blur of radius `r` across then down, in place; past the edges counts as the edge. */
export function blur(a: Float32Array, cols: number, rows: number, r: number) {
  const line = new Float32Array(Math.max(cols, rows));
  const scale = 1 / (2 * r + 1);
  const run = (len: number, start: number, step: number) => {
    for (let i = 0, k = start; i < len; i++, k += step) line[i] = a[k];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += line[i < 0 ? 0 : i >= len ? len - 1 : i];
    for (let i = 0, k = start; i < len; i++, k += step) {
      a[k] = sum * scale;
      const add = i + r + 1;
      const drop = i - r;
      sum += line[add >= len ? len - 1 : add] - line[drop < 0 ? 0 : drop];
    }
  };
  for (let j = 0; j < rows; j++) run(cols, j * cols, 1);
  for (let i = 0; i < cols; i++) run(rows, i, cols);
}

/** What the ripples' offsets and the foam's lapping are at a time: each offset a whole texture's turn at most. */
export function waterTime(look: Pick<WaterLook, 'speed'>, ms: number) {
  const s = (ms / 1000) * look.speed;
  const turn = (x: number) => x - Math.floor(x);
  return {
    // The swell drifts east and a little south; the chop runs across it, north-east.
    swell: [turn(s * 0.011), turn(s * 0.004)] as [number, number],
    chop: [turn(-s * 0.017), turn(s * 0.029)] as [number, number],
    lap: (s * 1.3) % (2 * Math.PI),
  };
}

/** 0xRRGGBB as a colour's three channels, 0 to 1. */
const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// Both stages at highp, which canDrawWater checks the GPU has: PixiJS asks for mediump in a fragment shader unless the
// source starts with its precision, and the ripples' coordinates reach tens of turns of their textures on a big map.
const VERTEX = /* glsl */ `precision highp float;
in vec2 aPosition;
out vec2 vField;
out vec2 vSwell;
out vec2 vChop;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uFieldSize;
uniform vec4 uSwell;
uniform vec4 uChop;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vField = aPosition / uFieldSize;
  // The map is seen at a slant, its tiles twice as wide as tall: so are the waves.
  vec2 slant = vec2(aPosition.x, aPosition.y * 2.0);
  vSwell = slant * uSwell.z + uSwell.xy;
  vChop = mat2(0.98, 0.2, -0.2, 0.98) * slant * uChop.z + uChop.xy;
}
`;

const FRAGMENT = /* glsl */ `precision highp float;
in vec2 vField;
in vec2 vSwell;
in vec2 vChop;
out vec4 finalColor;
uniform sampler2D uField;
uniform sampler2D uSwellMap;
uniform sampler2D uChopMap;
uniform vec3 uOcean;
uniform vec3 uHighSeas;
uniform vec3 uLake;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uLight;
// x: the coast's roughness, y: the high seas', z: the foam's lapping, in radians.
uniform vec3 uSea;
void main() {
  vec4 f = texture(uField, vField);
  vec3 s = texture(uSwellMap, vSwell).rgb;
  vec3 c = texture(uChopMap, vChop).rgb;
  // The depth: a lake at 0, the ocean at a half, the high seas at 1.
  float lake = clamp(1.0 - f.g * 2.0, 0.0, 1.0);
  float high = clamp(f.g * 2.0 - 1.0, 0.0, 1.0);
  float rough = mix(uSea.x, uSea.y, high);
  // The ripples' slope, lit from the north-west as FreeCol's art is: the swell rolls, the chop catches the light.
  vec2 slope = (s.gb - 0.5) * 0.5 + (c.gb - 0.5);
  float lit = dot(slope, vec2(-0.6, -0.8)) * rough;
  vec3 deep = mix(mix(uOcean, uLake, lake), uHighSeas, high);
  vec3 col = mix(deep, uShallow, smoothstep(0.0, 0.5, f.b) * 0.6);
  col *= 1.0 + lit * 0.9 + (s.r - 0.5) * 0.25 * rough;
  // Light on the chop's crests, and a glint where a crest faces the light.
  col = mix(col, uLight, smoothstep(0.8, 1.0, c.r) * smoothstep(0.1, 0.45, lit) * 0.6);
  // A line of foam where the sand fades into the water, broken up by the chop and lapping in and out.
  float edge = f.r + (c.r - 0.6) * 0.1 + 0.04 * sin(uSea.z + f.b * 12.0);
  float foam = smoothstep(0.06, 0.14, edge) * (1.0 - smoothstep(0.22, 0.4, edge));
  col = mix(col, uFoam, foam * smoothstep(0.3, 0.8, c.r + (s.r - 0.5) * 0.5) * 0.55);
  finalColor = vec4(col * f.a, f.a);
}
`;

/** A field texture: one texel per field texel, smoothed between them. */
const fieldSource = (f: WaterField) =>
  new BufferImageSource({
    resource: f.data,
    width: f.cols,
    height: f.rows,
    format: 'rgba8unorm',
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
  });

/**
 * A surface over the map's pixels drawn by a shader: a mesh of one quad, from (0, 0) to the field's size, with the
 * field as the texture uField and the size it covers as uFieldSize. Its vertex shader gets aPosition in map pixels and
 * PixiJS's transform uniforms; the textures and uniforms of its look are its own.
 */
export class ShaderSurface {
  readonly mesh: Mesh<Geometry, Shader>;
  private field: BufferImageSource;
  private positions: Float32Array;
  /** Its look's textures, which it destroys with itself. */
  private textures: TextureSource[];
  constructor(
    vertex: string,
    fragment: string,
    /** Its own uniforms, by name: { value, type } as PixiJS's UniformGroup takes them. */
    uniforms: Record<string, { value: number | Float32Array | number[]; type: string }>,
    /** Its own textures, by the sampler's name. */
    textures: Record<string, TextureSource>,
  ) {
    this.positions = new Float32Array(8);
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: this.positions, format: 'float32x2' } },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.field = fieldSource({ cols: 1, rows: 1, texel: 1, data: new Uint8Array(4) });
    this.textures = Object.values(textures);
    const shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        surface: { uFieldSize: { value: [1, 1], type: 'vec2<f32>' }, ...uniforms },
        uField: this.field,
        ...textures,
      },
    });
    this.mesh = new Mesh({ geometry, shader });
    // The map's chunks cull themselves; this is the whole map, which the GPU clips to the screen.
    this.mesh.cullable = false;
  }

  /** The surface's uniforms, to change: the shader reads them at the next draw. */
  get uniforms(): Record<string, unknown> {
    return (this.mesh.shader!.resources.surface as { uniforms: Record<string, unknown> }).uniforms;
  }

  /** Cover the map the field covers, and read it. */
  setField(f: WaterField) {
    const [w, h] = [f.cols * f.texel, f.rows * f.texel];
    const old = this.field;
    if (old.width === f.cols && old.height === f.rows) {
      old.resource = f.data;
      old.update();
    } else {
      this.field = fieldSource(f);
      this.mesh.shader!.resources.uField = this.field;
      old.destroy();
    }
    this.positions.set([0, 0, w, 0, w, h, 0, h]);
    this.mesh.geometry.getBuffer('aPosition').update();
    this.uniforms.uFieldSize = [w, h];
  }

  /** Destroy the mesh, its geometry and shader, the field and the look's textures. */
  destroy() {
    this.mesh.geometry.destroy();
    this.mesh.shader?.destroy();
    this.mesh.destroy();
    this.field.destroy();
    for (const t of this.textures) t.destroy();
  }
}

/** A ripple image as a texture that repeats, with mipmaps so it does not shimmer zoomed out. */
const rippleSource = (pic: HTMLImageElement | HTMLCanvasElement) =>
  new ImageSource({
    resource: pic,
    addressMode: 'repeat',
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    autoGenerateMipmaps: true,
  });

/** The shader water: a ShaderSurface with the water's shader and look, whose time moves the ripples. */
export class WaterSurface {
  readonly surface: ShaderSurface;
  constructor(
    readonly look: WaterLook,
    swell: HTMLImageElement | HTMLCanvasElement,
    chop: HTMLImageElement | HTMLCanvasElement,
  ) {
    const color = (c: number) => ({ value: rgb(c), type: 'vec3<f32>' });
    this.surface = new ShaderSurface(
      VERTEX,
      FRAGMENT,
      {
        uSwell: { value: [0, 0, 1 / look.swellSize, 0], type: 'vec4<f32>' },
        uChop: { value: [0, 0, 1 / look.chopSize, 0], type: 'vec4<f32>' },
        uOcean: color(look.ocean),
        uHighSeas: color(look.highSeas),
        uLake: color(look.lake),
        uShallow: color(look.shallow),
        uFoam: color(look.foam),
        uLight: color(look.light),
        uSea: { value: [look.roughness, look.highSeasRoughness, 0], type: 'vec3<f32>' },
      },
      { uSwellMap: rippleSource(swell), uChopMap: rippleSource(chop) },
    );
  }

  /** Move the ripples and the foam to where they are at `ms`. */
  setTime(ms: number) {
    const t = waterTime(this.look, ms);
    const u = this.surface.uniforms;
    u.uSwell = [...t.swell, 1 / this.look.swellSize, 0];
    u.uChop = [...t.chop, 1 / this.look.chopSize, 0];
    u.uSea = [this.look.roughness, this.look.highSeasRoughness, t.lap];
  }
}

/** Whether a WebGL context can draw the shader water: highp floats in fragment shaders, which the ripples need. */
export function canDrawWater(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const p = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return !!p && p.precision > 0;
}

/** A sand picture's alpha (alphaOf, a tile's W x H) at a point of its tile, the nearest pixel's. */
export const sandAt = (alpha: Float32Array, u: number, v: number): number =>
  alpha[Math.min(H - 1, Math.max(0, Math.floor(v))) * W + Math.min(W - 1, Math.max(0, Math.floor(u)))] ?? 0;

/** Each sand picture's alpha, 0 to 1 per pixel, made once. */
const alphas = new WeakMap<HTMLImageElement | HTMLCanvasElement, Float32Array>();
export function alphaOf(pic: HTMLImageElement | HTMLCanvasElement): Float32Array {
  let a = alphas.get(pic);
  if (!a) {
    const c = Object.assign(document.createElement('canvas'), { width: pic.width, height: pic.height });
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(pic, 0, 0);
    const d = g.getImageData(0, 0, pic.width, pic.height).data;
    a = new Float32Array(pic.width * pic.height);
    for (let i = 0; i < a.length; i++) a[i] = d[4 * i + 3] / 255;
    alphas.set(pic, a);
  }
  return a;
}
