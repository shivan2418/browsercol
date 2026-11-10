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

/** The kinds of water the shader tells apart, each with a look of its own: lakes are calm, the high seas rough. */
export type WaterKind = 'ocean' | 'highSeas' | 'lake';

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
  /** Per kind of water: how rough it is (how strongly its ripples are lit), and how much foam breaks on its shore. */
  roughness: Record<WaterKind, number>;
  foamStrength: Record<WaterKind, number>;
  /** How fast the ripples move on the ocean and high seas, and on lakes: 1 the Tileset's normal. */
  speed: number;
  lakeSpeed: number;
  /** How long a swell and a chop texture are across, in map pixels. */
  swellSize: number;
  chopSize: number;
  /**
   * PROTOTYPE (water playground): the wave model. 'slide' two textures sliding in straight lines (the first look);
   * 'warp' the same two textures, their coordinates bent by a slowly drifting swirl; 'flow' a flow map: the chop
   * carried along the swirl, two phases crossfaded, each area on its own phase, and two swells crossing.
   */
  waves: WaveModel;
  /** The swirl: how big its eddies are in map pixels, how hard it bends the ripples, how far it carries the chop. */
  flowSize: number;
  warp: number;
  flowStrength: number;
  /** How fast the swirl itself drifts and changes, and how fast a 'flow' phase turns over, against the ripples' speed. */
  flowSpeed: number;
  /** How much the drift's heading wanders (radians), and its speed (0 steady, 0.5 half again and back). */
  wander: number;
  gust: number;
  /** How much the swell and the chop tilt the light, and how much light the crests catch. */
  swellAmount: number;
  chopAmount: number;
  crest: number;
  /** How the shore distance is made: 'blur' (the first look), 'signed' (409-coasts-astra), 'art' (the art's own edge). */
  shore: ShoreModel;
  /** For 'signed' and 'art': the shallows' and foam's widths out from the art's edge, in map pixels. */
  shallowWidth: number;
  foamWidth: number;
  /** The high seas' deep colour, as a share of the coast's deep colour (with climate). */
  highSeasShade: number;
  /** Colour by the nearest land's climate, or not (the ocean, shallow and foam colours above). */
  climate: boolean;
  palettes: Record<Climate, Palette>;
  /** Ice along cold coasts, 0 to 1. */
  ice: number;
  /** PROTOTYPE: the painted-art recipe; absent keeps the parked ripple renderer. */
  recipe?: WaterRecipe;
  /** PROTOTYPE river axis; absent preserves the flipbook. Speeds are screen pixels per second. */
  rivers?: { mode: 'flipbook' | 'flow'; minor: number; major: number };
}

export type WaveModel = 'slide' | 'warp' | 'flow';
export type ShoreModel = 'blur' | 'signed' | 'art';
export type Climate = 'cold' | 'temperate' | 'tropical';
export const CLIMATES: Climate[] = ['cold', 'temperate', 'tropical'];
/** A climate's water: deep, shallow and foam colours, and how much foam breaks. */
export interface Palette {
  deep: number;
  shallow: number;
  foam: number;
  foamAmount: number;
}

export interface WaterRecipe {
  shallows: 'turquoise' | 'climate';
  shore: 'drawn' | 'art';
  motion: 'bands' | 'foam';
  deep: 'plain' | 'climate';
  depth: 'normal' | 'deeper';
  /** Pixels per second, pixels between crests, pixels per second, shelf pixels, blend tiles. */
  bandSpeed: number;
  bandSpacing: number;
  driftSpeed: number;
  shelfWidth: number;
  climateBlend: number;
  /** The clipped beach: 1 draws the water again over FreeCol's beach art past a waterline, 0 not; and where the
   * waterline sits, in pixels out from where the art covers half. */
  clip: number;
  clipAt: number;
}

type FieldMap = Pick<MapView, 'w' | 'h' | 'types' | 'tiles'>;

/** River sides in FreeCol's style order, in the staggered map and the 2:1 screen diamond. */
export const RIVER_SIDES = ['NE', 'SE', 'SW', 'NW'] as const;
export const RIVER_MIDPOINTS = [
  [32, -16],
  [32, 16],
  [-32, 16],
  [-32, -16],
] as const;
export function riverNeighbour(x: number, y: number, side: number): [number, number] {
  return [x + (side < 2 ? y % 2 : (y % 2) - 1), y + (side === 0 || side === 3 ? -1 : 1)];
}

export type RiverMap = FieldMap & Pick<MapView, 'rivers'>;
/** Downstream side by row-major tile index; -1 is an inland sink.
 * Each component drains to its strongest mouth, or equally strong mouths by distance. Without a mouth it drains
 * to its largest end (largest tile for a loop). Equal-distance parents prefer the larger river, then side order.
 * Distances strictly decrease, so even malformed cyclic networks cannot produce cyclic flow.
 */
export function riverDirections(map: RiverMap): Map<number, number> {
  const rivers = new Map(
    map.rivers.filter(([x, y]) => map.tiles[y * map.w + x] !== '.').map((r) => [r[1] * map.w + r[0], r]),
  );
  const type = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.w && y < map.h ? map.types[map.tiles.charCodeAt(y * map.w + x) - 65] : undefined;
  const edges = new Map<number, [number, number][]>();
  const mouths = new Map<number, number[]>();
  for (const [id, [x, y, , style]] of rivers) {
    const adjacent: [number, number][] = [];
    const outlets: number[] = [];
    for (let side = 0; side < 4; side++) {
      if (!(Number(style[side]) > 0)) continue;
      const [nx, ny] = riverNeighbour(x, y, side);
      const t = type(nx, ny);
      if (!t) continue;
      const next = ny * map.w + nx;
      if (!t.land) outlets.push(side);
      else if (Number(rivers.get(next)?.[3][(side + 2) % 4]) > 0) adjacent.push([side, next]);
    }
    edges.set(id, adjacent);
    if (outlets.length) mouths.set(id, outlets);
  }
  const result = new Map<number, number>();
  const visited = new Set<number>();
  for (const start of rivers.keys()) {
    if (visited.has(start)) continue;
    const component = [start];
    visited.add(start);
    for (let i = 0; i < component.length; i++)
      for (const [, next] of edges.get(component[i])!)
        if (!visited.has(next)) {
          visited.add(next);
          component.push(next);
        }
    let roots = component.filter((id) => mouths.has(id));
    const inland = !roots.length;
    if (inland) {
      roots = component.filter((id) => edges.get(id)!.length <= 1);
      if (!roots.length) roots = component;
    }
    roots.sort((a, b) => rivers.get(b)![2] - rivers.get(a)![2] || a - b);
    const strongest = rivers.get(roots[0])![2];
    roots = inland ? roots.slice(0, 1) : roots.filter((id) => rivers.get(id)![2] === strongest);
    const distance = new Map(roots.map((id) => [id, 0]));
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++)
      for (const [, next] of edges.get(queue[i])!)
        if (!distance.has(next)) {
          distance.set(next, distance.get(queue[i])! + 1);
          queue.push(next);
        }
    for (const id of component) {
      if (distance.get(id) === 0) {
        const outlets = mouths.get(id);
        result.set(
          id,
          outlets?.slice().sort((a, b) => Number(rivers.get(id)![3][b]) - Number(rivers.get(id)![3][a]) || a - b)[0] ??
            -1,
        );
      } else {
        const parents = edges.get(id)!.filter(([, next]) => distance.get(next)! < distance.get(id)!);
        parents.sort(([a, ai], [b, bi]) => rivers.get(bi)![2] - rivers.get(ai)![2] || a - b);
        result.set(id, parents[0][0]);
      }
    }
  }
  return result;
}

/** Edge-connected ocean only. Rivers and explicit lake terrain never drain a lake mask. */
export function lakeMask(map: FieldMap): Uint8Array {
  const { w, h, tiles, types } = map;
  const lake = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const water = (k: number) => {
    const t = types[tiles.charCodeAt(k) - 65];
    return !!t && !t.land && t.id !== 'model.tile.greatRiver';
  };
  for (let k = 0; k < lake.length; k++) {
    if (!water(k) || seen[k]) continue;
    let count = 1;
    let edge = false;
    queue[0] = k;
    seen[k] = 1;
    for (let head = 0; head < count; head++) {
      const q = queue[head],
        x = q % w,
        y = Math.floor(q / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      // The four long sides of a staggered diamond, not its four corners.
      const left = x + (y % 2) - 1;
      for (const yy of [y - 1, y + 1])
        for (const xx of [left, left + 1]) {
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          const n = yy * w + xx;
          if (!seen[n] && water(n)) {
            seen[n] = 1;
            queue[count++] = n;
          }
        }
    }
    for (let i = 0; i < count; i++) {
      const q = queue[i];
      if (!edge || types[tiles.charCodeAt(q) - 65].id === 'model.tile.lake') lake[q] = 1;
    }
  }
  return lake;
}

/**
 * Grow then shrink a binary land mask. The original land wins over the channel mask, so closing never cuts land.
 * `channels` protects water centres and the segments joining all eight sailing neighbours.
 */
export function closeCoast(
  land: Float32Array,
  channels: Uint8Array,
  cols: number,
  rows: number,
  texel: number,
  radius = 20,
): Float32Array {
  const grown = shoreDistance(land, cols, rows, texel).map((d) => (d <= radius ? 1 : 0));
  const shrunk = shoreDistance(grown, cols, rows, texel);
  return land.map((v, k) => (v >= 0.5 || (shrunk[k] < -radius && !channels[k]) ? 1 : 0));
}

/** A continuous mixture, not a nearest-climate label. Two box passes give a triangular kernel. */
export function climateShares(zone: Float32Array, cols: number, rows: number, radius: number): Float32Array[] {
  return [1, 2, 3].map((z) => {
    const a = zone.map((v) => (v === z ? 1 : 0));
    blur(a, cols, rows, radius);
    blur(a, cols, rows, radius);
    return a;
  });
}

/**
 * Which climate a land tile type gives the water by it: cold (tundra, arctic, boreal), tropical (savannah, swamp and
 * their forests: only there do long turquoise shallows fit), temperate the rest, broadleaf, marsh and desert included;
 * hills and mountains none (the latitude decides).
 */
export const CLIMATE_OF: Record<string, Climate> = {
  'model.tile.tundra': 'cold',
  'model.tile.arctic': 'cold',
  'model.tile.borealForest': 'cold',
  'model.tile.plains': 'temperate',
  'model.tile.grassland': 'temperate',
  'model.tile.prairie': 'temperate',
  'model.tile.mixedForest': 'temperate',
  'model.tile.coniferForest': 'temperate',
  'model.tile.savannah': 'tropical',
  'model.tile.desert': 'temperate',
  'model.tile.marsh': 'temperate',
  'model.tile.swamp': 'tropical',
  'model.tile.broadleafForest': 'temperate',
  'model.tile.tropicalForest': 'tropical',
  'model.tile.wetlandForest': 'temperate',
  'model.tile.rainForest': 'tropical',
  'model.tile.scrubForest': 'temperate',
};

/** A number from a string resource, or the fallback when the Tileset has none. */
const numberOf = (res: Resources, key: string, fallback: number) => {
  const n = Number(res.string(key));
  return Number.isFinite(n) ? n : fallback;
};

/** A string resource that is one of `values`, or the fallback. */
const oneOf = <T extends string>(v: string, values: readonly T[], fallback: T): T =>
  values.includes(v as T) ? (v as T) : fallback;

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
    roughness: {
      ocean: numberOf(res, `${KEY}ocean.roughness`, 0.5),
      highSeas: numberOf(res, `${KEY}highSeas.roughness`, 0.8),
      lake: numberOf(res, `${KEY}lake.roughness`, 0.3),
    },
    foamStrength: {
      ocean: numberOf(res, `${KEY}ocean.foam`, 1),
      highSeas: numberOf(res, `${KEY}highSeas.foam`, 1),
      lake: numberOf(res, `${KEY}lake.foam`, 0),
    },
    speed: numberOf(res, `${KEY}ocean.speed`, 1),
    lakeSpeed: numberOf(res, `${KEY}lake.speed`, 0.5),
    swellSize: numberOf(res, `${KEY}swellSize`, 512),
    chopSize: numberOf(res, `${KEY}chopSize`, 192),
    waves: oneOf(res.string(`${KEY}waves`), ['slide', 'warp', 'flow'] as const, 'slide'),
    flowSize: numberOf(res, `${KEY}flowSize`, 1400),
    warp: numberOf(res, `${KEY}warp`, 0.35),
    flowStrength: numberOf(res, `${KEY}flowStrength`, 0.25),
    flowSpeed: numberOf(res, `${KEY}flowSpeed`, 0.3),
    wander: numberOf(res, `${KEY}wander`, 0.6),
    gust: numberOf(res, `${KEY}gust`, 0.3),
    swellAmount: numberOf(res, `${KEY}swellAmount`, 0.5),
    chopAmount: numberOf(res, `${KEY}chopAmount`, 1),
    crest: numberOf(res, `${KEY}crest`, 0.6),
    shore: oneOf(res.string(`${KEY}shore`), ['blur', 'signed', 'art'] as const, 'blur'),
    shallowWidth: numberOf(res, `${KEY}shallowWidth`, 36),
    foamWidth: numberOf(res, `${KEY}foamWidth`, 6),
    highSeasShade: numberOf(res, `${KEY}highSeasShade`, 0.72),
    climate: res.string(`${KEY}climate`) === 'true',
    palettes: Object.fromEntries(
      CLIMATES.map((k) => [
        k,
        {
          deep: res.has(`${KEY}${k}.deep`) ? res.color(`${KEY}${k}.deep`) : color('ocean'),
          shallow: res.has(`${KEY}${k}.shallow`) ? res.color(`${KEY}${k}.shallow`) : color('shallow'),
          foam: res.has(`${KEY}${k}.foam`) ? res.color(`${KEY}${k}.foam`) : color('foam'),
          foamAmount: numberOf(res, `${KEY}${k}.foamAmount`, 1),
        },
      ]),
    ) as Record<Climate, Palette>,
    ice: numberOf(res, `${KEY}ice`, 0),
    rivers: {
      mode: 'flipbook',
      minor: numberOf(res, `${KEY}river.minorSpeed`, 12),
      major: numberOf(res, `${KEY}river.majorSpeed`, 6),
    },
  };
}

/** The map pixels a field texel covers, at the least: a tile is 16 by 8 of them, and a coast's sand fades over 3. */
export const FIELD_TEXEL = 8;
/** How far from land the water is shallower, and how far the high seas and lakes fade into the ocean, in map pixels. */
const SHALLOW_PX = 48;
const DEPTH_PX = 96;
/** PROTOTYPE: the signed shore distance's cap either side, and how far land's climate reaches over the water. */
export const SHORE_PX = 48;
const CLIMATE_PX = 160;

/** The whole map's size in map pixels: odd rows stick out half a tile, and each row is half a tile down. */
export const mapPixels = (w: number, h: number): [number, number] => [w * W + W / 2, ((h + 1) * H) / 2];

/** The map pixels a field texel covers for a map, so the field is no more than `max` texels either way. */
export const fieldTexel = (w: number, h: number, max = 4096): number => {
  const [pw, ph] = mapPixels(w, h);
  return Math.max(FIELD_TEXEL, Math.ceil(pw / max), Math.ceil(ph / max));
};

/**
 * The field the shader reads, a texel per `texel` map pixels, RGBA: red how much land, or a water tile's shore cover
 * (its sand and the land and beach its transitions bring onto it), covers there,
 * green the water's depth (0 a lake, a half the ocean, 1 the high seas), blue how near land is, and alpha whether
 * there is water there at all.
 */
export interface WaterField {
  cols: number;
  rows: number;
  texel: number;
  /** Recipe fields use 2:1 texels, matching the map diamonds. */
  texelY?: number;
  data: Uint8Array;
  /** PROTOTYPE: per texel, how much the water is cold, temperate and tropical (RGB, adding up to 1). */
  climate?: Uint8Array;
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
    shore: ShoreModel;
    /** Per texel, whether open water is sure to show there: a water tile's middle that nothing covers. */
    seed: Uint8Array;
    /** Per texel, the climate of the land there: 0 none (water, or hills by the latitude), 1 cold, 2 temperate, 3 tropical. */
    zone: Uint8Array;
    recipeKey: string;
    lakes?: Uint8Array;
    channels: Uint8Array;
    plume: Float32Array;
  };
}

/** Tile types that are high seas, and lakes (calm, inland water). */
const HIGH_SEAS = new Set(['model.tile.highSeas']);
const LAKES = new Set(['model.tile.lake', 'model.tile.greatRiver']);
/** Where in a texel the sand is looked at: four points, for an edge smoother than the texels. */
const SAMPLES = [-0.25, -0.25, 0.25, -0.25, -0.25, 0.25, 0.25, 0.25];
/** PROTOTYPE, the 'art' shore: sixteen points a texel, for the art's edge to a pixel or two. */
const FINE = [-0.375, -0.125, 0.125, 0.375].flatMap((a) => [-0.375, -0.125, 0.125, 0.375].flatMap((b) => [a, b]));

/** A rectangle of texels: columns i0 to i1 and rows j0 to j1, the ends left out. */
interface Rect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * The water field of a map. Each texel's tile, at its centre, decides it, and a water tile's shore cover counts as land
 * as much as it covers there (`sand`: its cover, 0 to 1, at a point of the tile, or 0 for a tile with none). Then how near land
 * is and the depth are blurred, to fade over SHALLOW_PX and DEPTH_PX, and the water's edge a little.
 *
 * Given the map's `last` field, it makes again only the texels round the tiles that changed (ground explored, say),
 * reusing that field's arrays: the same field when no tile changed.
 */
export function waterField(
  map: FieldMap & Partial<Pick<MapView, 'rivers'>>,
  texel: number,
  sand: (x: number, y: number, u: number, v: number) => number,
  last?: WaterField | null,
  shore: ShoreModel = 'blur',
  recipe?: WaterRecipe,
): WaterField {
  const { w, h, tiles } = map;
  const [pw, ph] = mapPixels(w, h);
  const cols = Math.ceil(pw / texel);
  const texelY = recipe ? texel / 2 : texel;
  const rows = Math.ceil(ph / texelY);
  const n = cols * rows;
  const types = map.types.map((t) => t.id).join();
  const was = last?.made;
  const recipeKey = recipe ? `${recipe.shore}:${recipe.climateBlend}:${JSON.stringify(map.rivers ?? [])}` : '';
  const reuse =
    !!was &&
    last.cols === cols &&
    last.rows === rows &&
    last.texel === texel &&
    was.w === w &&
    was.h === h &&
    was.types === types &&
    was.shore === shore &&
    was.recipeKey === recipeKey;
  const radius = (px: number) => Math.max(1, Math.round(px / texel / 2));
  const distanceCap = recipe ? 192 : SHORE_PX;
  const closingRadius = recipe?.shore === 'drawn' ? W / Math.SQRT2 / 2 : 20;
  const [nearR, depthR, climateR] = [
    radius(SHALLOW_PX),
    radius(DEPTH_PX),
    radius(recipe ? recipe.climateBlend * W : CLIMATE_PX),
  ];
  // Closing reaches twice its radius, followed by the capped distance.
  const reach = Math.max(
    2 * Math.max(nearR, depthR, climateR, 1),
    Math.ceil((distanceCap + (recipe ? 2 * closingRadius : 0)) / texel) + 1,
  );
  const lakes = recipe ? lakeMask(map) : undefined;
  const all: Rect = { i0: 0, j0: 0, i1: cols, j1: rows };
  /** The texels to make again: round the tiles that changed, with their neighbours, whose sand depends on them. */
  let raw = all;
  if (reuse) {
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let k = 0; k < tiles.length; k++)
      if (tiles.charCodeAt(k) !== was.tiles.charCodeAt(k) || lakes?.[k] !== was.lakes?.[k]) {
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
        j0: Math.floor(((y0 - 2) * H) / 2 / texelY),
        i1: Math.ceil(((x1 + 2) * W + W / 2) / texel),
        j1: Math.ceil(((y1 + 4) * H) / 2 / texelY),
      },
      cols,
      rows,
    );
  }
  const land = reuse ? was.land : new Float32Array(n);
  const depth = reuse ? was.depth : new Float32Array(n);
  const water = reuse ? was.water : new Float32Array(n);
  const zone = reuse ? was.zone : new Uint8Array(n);
  const seed = reuse ? was.seed : new Uint8Array(n);
  const channels = reuse ? was.channels : new Uint8Array(n);
  const plume = reuse ? was.plume : new Float32Array(n);
  const riverTiles = new Map((map.rivers ?? []).map((r) => [r[1] * w + r[0], r]));
  const points = shore === 'art' ? FINE : SAMPLES;
  // Per tile type: land (0), or water and its depth, offset by one.
  const kinds = map.types.map((t) => (t.land ? 0 : HIGH_SEAS.has(t.id) ? 2 : LAKES.has(t.id) ? 1 : 1.5));
  const zones = map.types.map((t) => {
    const c = CLIMATE_OF[t.id];
    return c ? CLIMATES.indexOf(c) + 1 : 0;
  });
  for (let j = raw.j0; j < raw.j1; j++) {
    const py = (j + 0.5) * texelY;
    const row = Math.floor(py / (H / 2));
    for (let i = raw.i0; i < raw.i1; i++) {
      const px = (i + 0.5) * texel;
      const k = j * cols + i;
      // Off the map, or unexplored: no water, no land, and the ocean's depth.
      land[k] = 0;
      water[k] = 0;
      depth[k] = 0.5;
      zone[k] = 0;
      seed[k] = 0;
      channels[k] = 0;
      plume[k] = 0;
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
          zone[k] = zones[c];
          break;
        }
        water[k] = 1;
        depth[k] = lakes?.[y * w + x] ? 0 : kind - 1;
        let a = 0;
        for (let s = 0; s < points.length; s += 2) a += sand(x, y, u + points[s] * texel, v + points[s + 1] * texelY);
        land[k] = a / (points.length / 2);
        if (land[k] < 0.05 && Math.abs(u - W / 2) / (W / 2) + Math.abs(v - H / 2) / (H / 2) < 0.5) seed[k] = 1;
        if (recipe) {
          const dx = u - W / 2,
            dy = (v - H / 2) * 2;
          if (Math.hypot(dx, dy) < W * 0.25) channels[k] = 1;
          const left = x + (y % 2) - 1;
          const neighbours = [
            [x, y - 2],
            [left + 1, y - 1],
            [x + 1, y],
            [left + 1, y + 1],
            [x, y + 2],
            [left, y + 1],
            [x - 1, y],
            [left, y - 1],
          ];
          for (let d = 0; d < neighbours.length; d++) {
            const [nx, ny] = neighbours[d];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nt = map.types[tiles.charCodeAt(ny * w + nx) - 65];
            if (!nt) continue;
            const ex = (nx - x) * W + (((ny % 2) - (y % 2)) * W) / 2;
            const ey = (ny - y) * H;
            const length = Math.hypot(ex, ey);
            const along = (dx * ex + dy * ey) / length;
            const side = Math.abs(dx * ey - dy * ex) / length;
            if (!nt.land && along >= 0 && along <= length && side < W * 0.18) channels[k] = 1;
            const river = riverTiles.get(ny * w + nx);
            // River style order NE, SE, SW, NW. Only a connection toward this water tile makes a mouth.
            if (nt.land && d % 2 === 1 && river && Number(river[3][((d - 1) / 2 + 2) % 4]) > 0) {
              const offshore = length / 2 - along;
              plume[k] = Math.max(plume[k], riverPlume(offshore, side, river[2]));
            }
          }
          if (recipe.shore === 'drawn') land[k] = 0;
        }
        break;
      }
    }
  }
  // The texels whose blurred values may have changed, and the texels those are blurred from.
  const out = reuse ? clip(grow(raw, reach), cols, rows) : all;
  const src = reuse ? clip(grow(out, reach), cols, rows) : all;
  const sw = src.i1 - src.i0;
  const sh = src.j1 - src.j0;
  const seedPart = (source = seed) => {
    const p = new Uint8Array(sw * sh);
    for (let j = 0; j < sh; j++)
      p.set(source.subarray((src.j0 + j) * cols + src.i0, (src.j0 + j) * cols + src.i1), j * sw);
    return p;
  };
  const part = (a: Float32Array) => {
    const p = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) p.set(a.subarray((src.j0 + j) * cols + src.i0, (src.j0 + j) * cols + src.i1), j * sw);
    return p;
  };
  let cover: Float32Array = part(land);
  if (shore === 'art' || recipe?.shore === 'art') cover = fillHoles(cover, seedPart(), sw, sh);
  if (recipe) cover = closeCoast(cover, seedPart(channels), sw, sh, texel, closingRadius);
  const near = !recipe && shore === 'blur' ? cover : shoreDistance(cover, sw, sh, texel, distanceCap);
  const deep = part(depth);
  const wet = part(water);
  for (let pass = 0; pass < 2; pass++) {
    if (!recipe && shore === 'blur') blur(near, sw, sh, nearR);
    if (!recipe) blur(deep, sw, sh, depthR);
  }
  // Each climate's share of the land round a texel, blurred far out over the water.
  const zoneAt = new Float32Array(sw * sh);
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) zoneAt[j * sw + i] = zone[(src.j0 + j) * cols + src.i0 + i];
  const shares = climateShares(zoneAt, sw, sh, climateR);
  blur(wet, sw, sh, 1);
  const data = reuse ? last.data : new Uint8Array(4 * n);
  const climate = reuse && last.climate ? last.climate : new Uint8Array(4 * n);
  for (let j = out.j0; j < out.j1; j++)
    for (let i = out.i0; i < out.i1; i++) {
      const k = j * cols + i;
      const p = (j - src.j0) * sw + (i - src.i0);
      data[4 * k] = Math.round((recipe ? cover[p] : land[k]) * 255);
      data[4 * k + 1] = Math.round(deep[p] * 255);
      data[4 * k + 2] = Math.round((!recipe && shore === 'blur' ? near[p] : 0.5 - near[p] / (2 * distanceCap)) * 255);
      data[4 * k + 3] = Math.round(wet[p] * 255);
      // Far from any land, the latitude: cold toward the poles, tropical round the equator.
      const lat = Math.abs(((j + 0.5) * texelY) / ph - 0.5) * 2;
      const cold = smooth(0.62, 0.8, lat);
      const tropical = 1 - smooth(0.25, 0.45, lat);
      const byLat = [cold, Math.max(0, 1 - cold - tropical), tropical];
      const sum = shares[0][p] + shares[1][p] + shares[2][p];
      const far = Math.max(0, 1 - sum / 0.25);
      let total = 0;
      const mixed = byLat.map((l, z) => {
        const v = shares[z][p] + far * 0.25 * l;
        total += v;
        return v;
      });
      for (let z = 0; z < 3; z++) climate[4 * k + z] = Math.round((mixed[z] / Math.max(total, 1e-6)) * 255);
      climate[4 * k + 3] = recipe ? Math.round(plume[k] * 255) : 255;
    }
  return {
    cols,
    rows,
    texel,
    texelY,
    data,
    climate,
    made: { w, h, types, tiles, land, depth, water, shore, zone, seed, recipeKey, lakes, channels, plume },
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Mouth coverage in the field's uncompressed diamond metric, shared with the flowing delta atlas. */
export function riverPlume(offshore: number, side: number, magnitude: number): number {
  const width = (magnitude > 1 ? 10 : 6) + Math.max(0, offshore) * 0.45;
  return (1 - smooth(0, W * 0.4, offshore)) * (1 - smooth(width * 0.3, width, side));
}

/**
 * PROTOTYPE, the 'art' shore: water the open sea cannot reach without crossing the art (where it covers half or more)
 * is a hole in the art (the sand's and the land's masks leave a few), and counts as covered: the shallows and foam keep
 * to the coast's outer edge instead of ringing each hole, and the shader colours a hole as the shallowest water.
 */
export function fillHoles(land: Float32Array, seed: Uint8Array, cols: number, rows: number): Float32Array {
  const open = new Uint8Array(land.length);
  const stack: number[] = [];
  for (let k = 0; k < land.length; k++)
    if (seed[k] && land[k] < 0.5) {
      open[k] = 1;
      stack.push(k);
    }
  while (stack.length) {
    const k = stack.pop()!;
    const [x, y] = [k % cols, Math.floor(k / cols)];
    for (const q of [
      x > 0 ? k - 1 : -1,
      x + 1 < cols ? k + 1 : -1,
      y > 0 ? k - cols : -1,
      y + 1 < rows ? k + cols : -1,
    ])
      if (q >= 0 && !open[q] && land[q] < 0.5) {
        open[q] = 1;
        stack.push(q);
      }
  }
  for (let k = 0; k < land.length; k++) if (!open[k] && land[k] < 0.5) land[k] = Math.max(land[k], 0.75);
  return land;
}

/**
 * PROTOTYPE, from 409-coasts-astra: the signed distance to the cover's half-opacity contour, in map pixels, positive
 * offshore, capped at SHORE_PX. Crossings are found between texels, then spread with two chamfer passes.
 */
export function shoreDistance(
  land: Float32Array,
  cols: number,
  rows: number,
  texel: number,
  cap = SHORE_PX,
): Float32Array {
  const distance = new Float32Array(land.length).fill(cap);
  const diagonal = texel * Math.SQRT2;
  const cross = (k: number, q: number, a: number) => {
    const b = land[q] - 0.5;
    if (a >= 0 !== b >= 0) distance[k] = Math.min(distance[k], (texel * Math.abs(a)) / Math.abs(a - b));
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x;
      const a = land[k] - 0.5;
      if (x > 0) cross(k, k - 1, a);
      if (x + 1 < cols) cross(k, k + 1, a);
      if (y > 0) cross(k, k - cols, a);
      if (y + 1 < rows) cross(k, k + cols, a);
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x;
      let d = distance[k];
      if (x > 0) d = Math.min(d, distance[k - 1] + texel);
      if (y > 0) {
        d = Math.min(d, distance[k - cols] + texel);
        if (x > 0) d = Math.min(d, distance[k - cols - 1] + diagonal);
        if (x + 1 < cols) d = Math.min(d, distance[k - cols + 1] + diagonal);
      }
      distance[k] = d;
    }
  for (let y = rows - 1; y >= 0; y--)
    for (let x = cols - 1; x >= 0; x--) {
      const k = y * cols + x;
      let d = distance[k];
      if (x + 1 < cols) d = Math.min(d, distance[k + 1] + texel);
      if (y + 1 < rows) {
        d = Math.min(d, distance[k + cols] + texel);
        if (x > 0) d = Math.min(d, distance[k + cols - 1] + diagonal);
        if (x + 1 < cols) d = Math.min(d, distance[k + cols + 1] + diagonal);
      }
      distance[k] = d;
    }
  for (let k = 0; k < distance.length; k++) if (land[k] >= 0.5) distance[k] = -distance[k];
  return distance;
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
export function waterTime(speed: number, ms: number) {
  const s = (ms / 1000) * speed;
  const turn = (x: number) => x - Math.floor(x);
  return {
    // The swell drifts east and a little south; the chop runs across it, north-east.
    swell: [turn(s * 0.011), turn(s * 0.004)] as [number, number],
    chop: [turn(-s * 0.017), turn(s * 0.029)] as [number, number],
    lap: (s * 1.3) % (2 * Math.PI),
  };
}

/** A value per kind of water, in the order the shader takes them: ocean, high seas, lake. */
const kinds = (v: Record<WaterKind, number>): [number, number, number] => [v.ocean, v.highSeas, v.lake];

/** 0xRRGGBB as a colour's three channels, 0 to 1. */
const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// Both stages at highp, which canDrawWater checks the GPU has: PixiJS asks for mediump in a fragment shader unless the
// source starts with its precision, and the ripples' coordinates reach tens of turns of their textures on a big map.
const VERTEX = /* glsl */ `precision highp float;
in vec2 aPosition;
out vec2 vField;
out vec2 vSwell;
out vec2 vChop;
out vec2 vSlant;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uFieldSize;
uniform vec4 uSwell;
uniform vec4 uChop;
// The ripples' offsets on lakes, which move at their own speed.
uniform vec4 uLakeAt;
out vec2 vSwellLake;
out vec2 vChopLake;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vField = aPosition / uFieldSize;
  // The map is seen at a slant, its tiles twice as wide as tall: so are the waves.
  vec2 slant = vec2(aPosition.x, aPosition.y * 2.0);
  vSlant = slant;
  vSwell = slant * uSwell.z + uSwell.xy;
  vChop = mat2(0.98, 0.2, -0.2, 0.98) * slant * uChop.z + uChop.xy;
  vSwellLake = slant * uSwell.z + uLakeAt.xy;
  vChopLake = mat2(0.98, 0.2, -0.2, 0.98) * slant * uChop.z + uLakeAt.zw;
}
`;

/** Unproject FreeCol's diamond into tile coordinates, then make its edges periodic once, not per frame. */
export function paintedWaterAtlas(pictures: (HTMLImageElement | HTMLCanvasElement)[]): HTMLCanvasElement {
  const size = 128;
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size * pictures.length });
  const g = canvas.getContext('2d')!;
  const output = g.createImageData(size, size * pictures.length);
  pictures.forEach((pic, kind) => {
    const source = Object.assign(document.createElement('canvas'), { width: pic.width, height: pic.height });
    const ctx = source.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(pic, 0, 0);
    const pixels = ctx.getImageData(0, 0, pic.width, pic.height).data;
    const square = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size,
          v = (y + 0.5) / size;
        const sx = Math.min(pic.width - 1, Math.max(0, Math.floor(((1 + u - v) * pic.width) / 2)));
        const sy = Math.min(pic.height - 1, Math.floor(((u + v) * pic.height) / 2));
        for (let c = 0; c < 3; c++) square[(y * size + x) * 3 + c] = pixels[(sy * pic.width + sx) * 4 + c];
      }
    // Near an edge use the middle of the shifted image. Both opposite edges therefore have the same colour/slope.
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const wx = smooth(0, 24, Math.min(x, size - 1 - x));
        const wy = smooth(0, 24, Math.min(y, size - 1 - y));
        const xx = (x + size / 2) % size,
          yy = (y + size / 2) % size;
        const k = ((kind * size + y) * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          const a = square[(y * size + x) * 3 + c] * wx + square[(y * size + xx) * 3 + c] * (1 - wx);
          const b = square[(yy * size + x) * 3 + c] * wx + square[(yy * size + xx) * 3 + c] * (1 - wx);
          output.data[k + c] = a * wy + b * (1 - wy);
        }
        output.data[k + 3] = 255;
      }
  });
  g.putImageData(output, 0, 0);
  return canvas;
}

// Four reads: distance/depth/cover, climate/plume, and two slowly drifting painted layers.
const PAINTED_FRAGMENT = /* glsl */ `precision highp float;
in vec2 vField;
in vec2 vSlant;
out vec4 finalColor;
uniform sampler2D uField;
uniform sampler2D uClimate;
uniform sampler2D uSwellMap;
uniform vec4 uRecipe;
uniform vec4 uAxes;
uniform vec4 uShore;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uShal0;
uniform vec3 uShal1;
uniform vec3 uShal2;
uniform vec3 uDeep0;
uniform vec3 uDeep1;
uniform vec3 uDeep2;
uniform float uTime;
uniform float uSplit;
uniform float uView;
uniform float uRiverFlow;
uniform vec2 uClip;
vec3 paint(vec2 p, float kind) {
  vec2 q = fract(p);
  return texture(uSwellMap, vec2(q.x, (kind + (q.y * 127.0 + 0.5) / 128.0) / 3.0)).rgb;
}
void main() {
  if (gl_FragCoord.x < uSplit) discard;
  vec4 f = texture(uField, vField);
  if (f.a < 0.001) discard;
  vec4 climate = texture(uClimate, vField);
#ifdef CLIP
  // Out before any painting: the clipped beach is off, the shore is drawn, or the pixel is off the waterline's strip.
  if (uClip.x < 0.5 || uAxes.y < 0.5) discard;
  float strip = (0.5 - f.b) * 384.0 + climate.a * 22.0;
  if (strip < uClip.y || strip > 34.0) discard;
#endif
  vec3 w = climate.rgb / max(dot(climate.rgb, vec3(1.0)), 0.001);
  float lake = 1.0 - smoothstep(0.05, 0.35, f.g);
  float high = smoothstep(0.65, 0.95, f.g);
  float kind = lake > 0.5 ? 2.0 : high > 0.5 ? 1.0 : 0.0;
  vec2 p = vec2(vSlant.x + vSlant.y, vSlant.y - vSlant.x) / 128.0;
  float t = uTime * mix(1.0, 0.04, lake);
  vec2 drift = vec2(t * uRecipe.z / 128.0, t * uRecipe.z * 0.37 / 128.0);
  vec3 a = paint(p * 0.63 + drift, kind);
  vec3 b = paint(mat2(0.8, -0.6, 0.6, 0.8) * p * 0.47 - drift * vec2(0.43, 0.79), kind);
  float noise = sin(p.x * 1.71 + sin(p.y * 1.37)) * sin(p.y * 2.13 - p.x * 0.61);
  vec3 art = mix(a, b, 0.5 + noise * 0.12);
  float plume = climate.a;
  float drawn = 1.0 - step(0.5, uAxes.y);
  float dist = (0.5 - f.b) * 384.0 - drawn * 12.67 + plume * 22.0;
  float d = max(0.0, dist);
  float deeper = uAxes.w;
  // Long shallows only by tropical land: cold and temperate shelves are about half as wide, and fainter.
  float shelfReach = dot(w, vec3(0.5, 0.55, 1.0));
  float shelf = (1.0 - smoothstep(8.0, uRecipe.w * shelfReach * mix(1.0, 0.8, deeper), d + noise * 6.0)) *
    dot(w, vec3(0.8, 0.75, 1.0));
  vec3 shallow = uAxes.x > 0.5 ? uShal0*w.r + uShal1*w.g + uShal2*w.b : uShallow;
  vec3 deep = art;
  if (uAxes.z > 0.5) {
    vec3 tint = uDeep0*w.r + uDeep1*w.g + uDeep2*w.b;
    deep = mix(art, tint * (0.75 + dot(art, vec3(0.33))), 0.38) * mix(1.0, uShore.z, high);
  }
  deep *= mix(vec3(1.0), vec3(0.72, 0.8, 0.92), deeper);
  // Dim without pushing slate-green back toward the ocean's saturated blue.
  shallow *= mix(vec3(1.0), vec3(0.82, 0.86, 0.88), deeper);
  vec3 col = mix(deep, shallow * (0.8 + dot(art, vec3(0.3))), shelf * 0.92);
  // In the field's uncompressed metric a diamond edge is 128 / sqrt(2) pixels.
  float dd = d / 90.51;
  float broken = sin(p.x * 8.3 + sin(p.y * 5.7)) * sin(p.y * 7.1 - p.x * 3.9);
  float phase = (d + uTime * uRecipe.x) * 6.283185 / uRecipe.y + noise * 3.0 + broken;
  float bands = smoothstep(0.65, 1.0, sin(phase)) * smoothstep(0.04, 0.15, dd) *
    (1.0 - smoothstep(0.0, 0.6, dd)) * smoothstep(-0.15, 0.55, broken) * (1.0 - lake);
  col += vec3(0.9, 0.95, 1.0) * bands * 0.22 * step(0.0, uRecipe.x);
  col += lake * 0.025 * (0.5 + 0.5 * sin(p.x * 0.7 + p.y * 0.4 + uTime * 0.19));
  float lap = sin(uTime * mix(1.1, 0.45, lake) + noise * 2.0);
  float reach = uShore.y * (0.7 + 0.3 * lap) * mix(1.0, 0.35, lake);
  float waterline = mix(reach * 0.35, -reach * (0.35 + 0.65 * lap), drawn);
  float foam = (1.0 - smoothstep(0.0, max(0.5, uShore.y * 0.55), abs(dist - waterline))) *
    (0.6 + noise * 0.3) * mix(0.5, 0.16, lake) * (1.0 - plume);
  // Dry sand must show outside the land tile, not start behind its opaque edge.
  float dry = 1.0 - smoothstep(-9.0, -2.0, dist);
  vec3 sand = mix(vec3(0.64, 0.56, 0.42), vec3(0.86, 0.76, 0.55), dry);
  sand *= 0.97 + noise * 0.03;
  // Foam washes over the beach, leaving a darker wet strip when it retreats.
  sand = mix(sand, sand * 0.82, drawn * (1.0 - smoothstep(-8.0, -1.0, dist)) *
    smoothstep(waterline - 3.0, waterline + 1.0, dist) * 0.35);
  // The art shore keeps its painted cover. Sand underneath fills transparent holes, but stops well inside the art's
  // own fade to the sea: sand under the fade read as beach bleeding into the water (worst on snow and tundra).
  float sandEdge = mix(-10.0, 0.0, drawn);
  col = mix(col, sand, 1.0 - smoothstep(sandEdge - 2.0, sandEdge + 2.0, dist));
  col = mix(col, uFoam, foam);
  vec3 river = mix(art, shallow * (0.8 + dot(art, vec3(0.3))), dot(w, vec3(0.8, 0.75, 1.0)) * 0.92);
  col = mix(col, mix(vec3(0.16, 0.34, 0.39), river, uRiverFlow), plume * 0.8);
  if (uView > 0.5) col = uView < 1.5 ? vec3(f.r, f.g, f.b) : w;
#ifdef CLIP
  // Drawn again over FreeCol's beach art: only the water past the waterline, so the art's fade to the sea is
  // covered and the beach ends in a clean edge. Not at river mouths (their art stays), nor far out where no art is.
  float over = smoothstep(uClip.y, uClip.y + 4.0, dist) * (1.0 - smoothstep(30.0, 34.0, dist)) * (1.0 - plume) *
    uClip.x * (1.0 - drawn);
  if (over < 0.004) discard;
  finalColor = vec4(col * f.a * over, f.a * over);
#else
  finalColor = vec4(col * f.a, f.a);
#endif
}
`;
/** The painted water again, over FreeCol's beach art past the waterline (the clipped beach). */
const PAINTED_CLIP_FRAGMENT = PAINTED_FRAGMENT.replace(
  'precision highp float;',
  'precision highp float;\n#define CLIP 1',
);

/** The shader's compile-time choices: the wave model, the shore's encoding, climate colours or not. */
export interface WaterVariant {
  waves: WaveModel;
  signedShore: boolean;
  climate: boolean;
}

/**
 * The fragment shader for a variant. Texture reads per pixel: the field, the climate field (with climate), and the
 * ripples: 'slide' 2 (swell, chop), 'warp' 3 (swirl, swell, chop), 'flow' 5 (swirl, two crossing swells, two chop
 * phases).
 */
export const fragmentFor = (v: WaterVariant) => /* glsl */ `precision highp float;
#define WAVES ${v.waves === 'slide' ? 0 : v.waves === 'warp' ? 1 : 2}
#define SIGNED_SHORE ${v.signedShore ? 1 : 0}
#define CLIMATE ${v.climate ? 1 : 0}
#define SHORE_PX ${SHORE_PX}.0
in vec2 vField;
in vec2 vSwell;
in vec2 vChop;
in vec2 vSwellLake;
in vec2 vChopLake;
in vec2 vSlant;
out vec4 finalColor;
uniform sampler2D uField;
uniform sampler2D uClimate;
uniform sampler2D uSwellMap;
uniform sampler2D uChopMap;
uniform vec3 uOcean;
uniform vec3 uHighSeas;
uniform vec3 uLake;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uLight;
// Per kind of water, x the ocean, y the high seas, z lakes: the roughness, and the foam's strength.
uniform vec3 uRough;
uniform vec3 uFoamStrength;
// The foam's lapping in radians: on the ocean and high seas, and on lakes.
uniform vec2 uLap;
// x 1/swell size, y 1/chop size, z 1/swirl size (per map pixel), w how hard the swirl bends the ripples (turns).
uniform vec4 uScale;
// On the sea and on lakes: the swirl's offset (xy), the flow's phase (z).
uniform vec4 uSea;
uniform vec4 uCalm;
// On the sea and on lakes: the swell's offset (xy) and the chop's (zw).
uniform vec4 uSeaAt;
uniform vec4 uCalmAt;
// x how far the flow carries the chop in a phase (turns), y crest light, z swell's tilt, w chop's tilt.
uniform vec4 uWave;
// x shallows' width, y foam's width (map pixels from the art's edge), z the high seas' shade, w ice.
uniform vec4 uShore;
// Per climate (cold, temperate, tropical): deep, shallow, foam colours, and the foam's amount.
uniform vec3 uDeep0;
uniform vec3 uDeep1;
uniform vec3 uDeep2;
uniform vec3 uShal0;
uniform vec3 uShal1;
uniform vec3 uShal2;
uniform vec3 uFoam0;
uniform vec3 uFoam1;
uniform vec3 uFoam2;
uniform vec3 uFoamAmt;
// PROTOTYPE: 0 the water, 1 the field, 2 the climate, 3 the swirl.
uniform float uView;

const mat2 ROT = mat2(0.98, 0.2, -0.2, 0.98);
const mat2 CROSS = mat2(0.6, -0.8, 0.8, 0.6);

void main() {
  vec4 f = texture(uField, vField);
  // The depth: a lake at 0, the ocean at a half, the high seas at 1.
  float lake = clamp(1.0 - f.g * 2.0, 0.0, 1.0);
  float high = clamp(f.g * 2.0 - 1.0, 0.0, 1.0);
  // A lake's ripples, slower, where the water is more lake than sea: blending the two places would make them jump
  // whenever either offset turns over.
  bool calm = lake > 0.5;
  vec3 s;
  vec3 c;
  vec2 flow = vec2(0.0);
#if WAVES == 0
  s = texture(uSwellMap, calm ? vSwellLake : vSwell).rgb;
  c = texture(uChopMap, calm ? vChopLake : vChop).rgb;
#else
  vec4 m = calm ? uCalm : uSea;
  vec4 at = calm ? uCalmAt : uSeaAt;
  // The swirl: the swell texture seen very large, drifting slowly. Its slope turned a quarter is a curl, a flow that
  // goes round and round with no sources or sinks, so the ripples it carries neither bunch up nor thin out.
  vec3 sw = texture(uSwellMap, vSlant * uScale.z + m.xy).rgb;
  flow = vec2(sw.b - 0.5, 0.5 - sw.g) * 2.0;
  vec2 bend = flow * uScale.w;
  s = texture(uSwellMap, vSlant * uScale.x + at.xy + bend * 0.5).rgb;
#if WAVES == 1
  // Warp: the chop bent by the swirl and by the swell under it, so its crests change shape as both drift.
  c = texture(uChopMap, ROT * vSlant * uScale.y + at.zw + bend + (s.gb - 0.5) * uScale.w * 0.5).rgb;
#else
  // A second swell crossing the first: where they meet the crests rise and fall, and the pattern never repeats.
  vec3 s2 = texture(uSwellMap, CROSS * vSlant * uScale.x * 1.37 + vec2(-at.y, at.x * 1.3) - bend * 0.3).rgb;
  s = vec3((s.r + s2.r - 1.0) * 0.75 + 0.5, (s.gb + s2.gb) * 0.5);
  // Flow: the chop carried along the swirl, a phase at a time; two phases half a turn apart, crossfaded so neither's
  // jump back shows. Each area runs on its own phase (from the swirl's height), so nothing pulses in step.
  float ph = fract(m.z + sw.r * 1.7);
  float ph2 = fract(ph + 0.5);
  float k = abs(1.0 - 2.0 * ph);
  vec2 base = ROT * vSlant * uScale.y + at.zw + (s.gb - 0.5) * uScale.w * 0.3;
  vec2 carry = flow * uWave.x;
  vec3 c0 = texture(uChopMap, base + carry * ph).rgb;
  vec3 c1 = texture(uChopMap, base + carry * ph2 + vec2(0.37, 0.61)).rgb;
  // Two patterns crossfaded are flatter than either: give back their contrast.
  c = (mix(c0, c1, k) - 0.5) * inversesqrt(k * k + (1.0 - k) * (1.0 - k)) + 0.5;
#endif
#endif
  float rough = mix(mix(uRough.x, uRough.y, high), uRough.z, lake);
  float strength = mix(mix(uFoamStrength.x, uFoamStrength.y, high), uFoamStrength.z, lake);
#if CLIMATE
  vec3 w = texture(uClimate, vField).rgb;
  w /= max(w.r + w.g + w.b, 0.001);
  vec3 deepC = uDeep0 * w.r + uDeep1 * w.g + uDeep2 * w.b;
  vec3 shalC = uShal0 * w.r + uShal1 * w.g + uShal2 * w.b;
  vec3 foamC = uFoam0 * w.r + uFoam1 * w.g + uFoam2 * w.b;
  float foamAmt = dot(w, uFoamAmt);
  float cold = w.r;
  vec3 highC = deepC * uShore.z;
#else
  vec3 w = vec3(0.0, 1.0, 0.0);
  vec3 deepC = uOcean;
  vec3 shalC = uShallow;
  vec3 foamC = uFoam;
  float foamAmt = 1.0;
  float cold = 0.0;
  vec3 highC = uHighSeas;
#endif
  // The ripples' slope, lit from the north-west as FreeCol's art is: the swell rolls, the chop catches the light.
  vec2 slope = (s.gb - 0.5) * uWave.z + (c.gb - 0.5) * uWave.w;
  float lit = dot(slope, vec2(-0.6, -0.8)) * rough;
  // Lakes take the lake colour: all of it on flat colours, more than half of it over the climate's deep.
  vec3 deep = mix(mix(deepC, mix(deepC, uLake, CLIMATE == 1 ? 0.6 : 1.0), lake), highC, high);
#if SIGNED_SHORE
  // Map pixels out from the edge of the art over the water (the sand, the beach and land transitions): negative under it.
  float shore = (0.5 - f.b) * 2.0 * SHORE_PX;
  float shallows = 1.0 - smoothstep(0.0, uShore.x, max(shore, 0.0));
  vec3 col = mix(deep, shalC, shallows * 0.9);
#else
  // Shallower and lighter toward the shore, lightest where the sand and land fade into the water (red is how much
  // they cover here, blue how near they are), so no deep blue shows between the shallows and the sand.
  vec3 col = mix(deep, shalC, max(smoothstep(0.0, 0.5, f.b) * 0.6, smoothstep(0.0, 0.4, f.r) * 0.85));
#endif
  col *= 1.0 + lit * 0.9 + (s.r - 0.5) * 0.25 * rough;
  // Light on the chop's crests, and a glint where a crest faces the light.
  col = mix(col, uLight, smoothstep(0.8, 1.0, c.r) * smoothstep(0.1, 0.45, lit) * uWave.y);
  float lap = mix(uLap.x, uLap.y, lake);
#if SIGNED_SHORE
  // Foam lapping out from the art's edge and back, broken by the chop; it starts under the art, so no water shows
  // between them.
  float reach = uShore.y * (0.75 + 0.25 * sin(lap + s.r * 6.0)) * (0.8 + 0.4 * c.r);
  float foam = (1.0 - smoothstep(0.0, reach, shore)) * smoothstep(0.25, 0.7, c.r + (s.r - 0.5) * 0.5 + 0.25);
  // Ice along cold coasts: a pale shelf out from the shore, its edge rough with the swell.
  float ice = cold * uShore.w * (1.0 - smoothstep(uShore.y * 0.6, uShore.y * 1.6, shore + (s.r - 0.5) * uShore.y));
#else
  // Foam lapping at the sand's edge (where it covers about half), reaching a little under the sand, broken up by the
  // chop and moving in and out.
  float edge = f.r + (c.r - 0.6) * 0.1 + 0.05 * sin(lap + f.b * 12.0);
  float foam = smoothstep(0.15, 0.32, edge) * (1.0 - smoothstep(0.7, 0.95, edge)) *
    smoothstep(0.3, 0.8, c.r + (s.r - 0.5) * 0.5);
  float ice = cold * uShore.w * smoothstep(0.1, 0.3, f.r + (s.r - 0.5) * 0.1);
#endif
  col = mix(col, foamC, clamp(foam * 0.75 * strength * foamAmt, 0.0, 1.0));
  col = mix(col, mix(foamC, vec3(0.85, 0.9, 0.95), 0.4), clamp(ice, 0.0, 0.9));
  if (uView > 0.5) {
#if SIGNED_SHORE
    float b = clamp(0.5 - shore / (2.0 * SHORE_PX), 0.0, 1.0);
#else
    float b = f.b;
#endif
    col = uView < 1.5 ? vec3(f.r, f.g * 0.5, b) : uView < 2.5 ? w : vec3(flow * 0.5 + 0.5, 0.5);
    if (uView < 1.5 && abs(f.r - 0.5) < 0.03) col = vec3(1.0, 1.0, 0.0);
  }
  finalColor = vec4(col * f.a, f.a);
}
`;

/** A field texture: one texel per field texel, smoothed between them. */
const fieldSource = (f: WaterField, data = f.data) =>
  new BufferImageSource({
    resource: data,
    width: f.cols,
    height: f.rows,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
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
  /** PROTOTYPE: a second draw of the same surface, with its own fragment shader and the same uniforms and textures,
   * for the map to place higher up (the clipped beach); null when there is none. */
  readonly overlay: Mesh<Geometry, Shader> | null = null;
  private field: BufferImageSource;
  /** PROTOTYPE: the climate field, the same size as the field. */
  private climate: BufferImageSource;
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
    overlayFragment?: string,
    private readonly customGeometry?: Geometry,
  ) {
    this.positions = new Float32Array(8);
    const geometry =
      customGeometry ??
      new Geometry({
        attributes: { aPosition: { buffer: this.positions, format: 'float32x2' } },
        indexBuffer: [0, 1, 2, 0, 2, 3],
      });
    this.field = fieldSource({ cols: 1, rows: 1, texel: 1, data: new Uint8Array(4) });
    this.climate = fieldSource({ cols: 1, rows: 1, texel: 1, data: new Uint8Array([0, 255, 0, 255]) });
    this.textures = Object.values(textures);
    const shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        surface: { uFieldSize: { value: [1, 1], type: 'vec2<f32>' }, ...uniforms },
        uField: this.field,
        uClimate: this.climate,
        ...textures,
      },
    });
    this.mesh = new Mesh({ geometry, shader });
    // The map's chunks cull themselves; this is the whole map, which the GPU clips to the screen.
    this.mesh.cullable = false;
    if (overlayFragment) {
      const over = Shader.from({
        gl: { vertex, fragment: overlayFragment },
        resources: { surface: shader.resources.surface, uField: this.field, uClimate: this.climate, ...textures },
      });
      this.overlay = new Mesh({ geometry, shader: over });
      this.overlay.cullable = false;
    }
  }

  /** The overlay's shader sources, for programLinks. */
  get overlayProgram(): { vertex: string; fragment: string } | null {
    const p = this.overlay?.shader?.glProgram;
    return p ? { vertex: p.vertex ?? '', fragment: p.fragment ?? '' } : null;
  }

  /** The shader's sources as PixiJS gives them to WebGL, for programLinks. */
  get program(): { vertex: string; fragment: string } {
    const { vertex, fragment } = this.mesh.shader!.glProgram!;
    return { vertex: vertex ?? '', fragment: fragment ?? '' };
  }

  /** The surface's uniforms, to change: the shader reads them at the next draw. */
  get uniforms(): Record<string, unknown> {
    return (this.mesh.shader!.resources.surface as { uniforms: Record<string, unknown> }).uniforms;
  }

  /** Cover the map the field covers, and read it. */
  setField(f: WaterField) {
    const [w, h] = [f.cols * f.texel, f.rows * (f.texelY ?? f.texel)];
    const old = this.field;
    if (old.width === f.cols && old.height === f.rows) {
      old.resource = f.data;
      old.update();
    } else {
      this.field = fieldSource(f);
      this.mesh.shader!.resources.uField = this.field;
      if (this.overlay) this.overlay.shader!.resources.uField = this.field;
      old.destroy();
    }
    const climate = f.climate ?? new Uint8Array(4 * f.cols * f.rows).fill(85);
    const oldClimate = this.climate;
    if (oldClimate.width === f.cols && oldClimate.height === f.rows) {
      oldClimate.resource = climate;
      oldClimate.update();
    } else {
      this.climate = fieldSource(f, climate);
      this.mesh.shader!.resources.uClimate = this.climate;
      if (this.overlay) this.overlay.shader!.resources.uClimate = this.climate;
      oldClimate.destroy();
    }
    if (!this.customGeometry) {
      this.positions.set([0, 0, w, 0, w, h, 0, h]);
      this.mesh.geometry.getBuffer('aPosition').update();
    }
    this.uniforms.uFieldSize = [w, h];
  }

  /** Destroy the mesh, its geometry and shader, the field and the look's textures. */
  destroy() {
    this.overlay?.shader?.destroy();
    this.overlay?.destroy();
    this.mesh.geometry.destroy();
    this.mesh.shader?.destroy();
    this.mesh.destroy();
    this.field.destroy();
    this.climate.destroy();
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

/** The water's uniforms for a look. */
const uniformsOf = (look: WaterLook): Record<string, { value: number | number[]; type: string }> => {
  const color = (c: number) => ({ value: rgb(c), type: 'vec3<f32>' });
  const vec4 = (value: number[]) => ({ value, type: 'vec4<f32>' });
  const vec3 = (value: number[]) => ({ value, type: 'vec3<f32>' });
  const p = look.palettes;
  return {
    uSwell: vec4([0, 0, 1 / look.swellSize, 0]),
    uChop: vec4([0, 0, 1 / look.chopSize, 0]),
    uOcean: color(look.ocean),
    uHighSeas: color(look.highSeas),
    uLake: color(look.lake),
    uShallow: color(look.shallow),
    uFoam: color(look.foam),
    uLight: color(look.light),
    uLakeAt: vec4([0, 0, 0, 0]),
    uRough: vec3(kinds(look.roughness)),
    uFoamStrength: vec3(kinds(look.foamStrength)),
    uLap: { value: [0, 0], type: 'vec2<f32>' },
    uScale: vec4([1 / look.swellSize, 1 / look.chopSize, 1 / look.flowSize, look.warp]),
    uSea: vec4([0, 0, 0, 0]),
    uCalm: vec4([0, 0, 0, 0]),
    uSeaAt: vec4([0, 0, 0, 0]),
    uCalmAt: vec4([0, 0, 0, 0]),
    uWave: vec4([look.flowStrength, look.crest, look.swellAmount, look.chopAmount]),
    uShore: vec4([look.shallowWidth, look.foamWidth, look.highSeasShade, look.ice]),
    uDeep0: color(p.cold.deep),
    uDeep1: color(p.temperate.deep),
    uDeep2: color(p.tropical.deep),
    uShal0: color(p.cold.shallow),
    uShal1: color(p.temperate.shallow),
    uShal2: color(p.tropical.shallow),
    uFoam0: color(p.cold.foam),
    uFoam1: color(p.temperate.foam),
    uFoam2: color(p.tropical.foam),
    uFoamAmt: vec3(CLIMATES.map((k) => p[k].foamAmount)),
    uView: { value: 0, type: 'f32' },
    uRecipe: vec4([
      look.recipe?.motion === 'foam' ? -1 : (look.recipe?.bandSpeed ?? 5),
      look.recipe?.bandSpacing ?? 32,
      look.recipe?.driftSpeed ?? 2,
      look.recipe?.shelfWidth ?? 90,
    ]),
    uAxes: vec4([
      look.recipe?.shallows === 'climate' ? 1 : 0,
      look.recipe?.shore === 'art' ? 1 : 0,
      look.recipe?.deep === 'climate' ? 1 : 0,
      look.recipe?.depth === 'deeper' ? 1 : 0,
    ]),
    uTime: { value: 0, type: 'f32' },
    uSplit: { value: 0, type: 'f32' },
    uRiverFlow: { value: look.rivers?.mode === 'flow' ? 1 : 0, type: 'f32' },
    uClip: { value: [look.recipe?.clip ?? 0, look.recipe?.clipAt ?? -2], type: 'vec2<f32>' },
  };
};

/** The shader water: a ShaderSurface with the water's shader and look, whose time moves the ripples. */
export class WaterSurface {
  readonly surface: ShaderSurface;
  /** PROTOTYPE: how fast its time runs (0 stands still), and what the playground shows (0 the water). */
  rate = 1;
  view = 0;
  /** Its own clock, in seconds of water time, and the drifts integrated over it, so speed and heading can wander. */
  private clock = { ms: -1, t: 0, sea: new Float64Array(6), calm: new Float64Array(6) };
  constructor(
    readonly look: WaterLook,
    swell: HTMLImageElement | HTMLCanvasElement,
    chop: HTMLImageElement | HTMLCanvasElement,
  ) {
    this.surface = new ShaderSurface(
      VERTEX,
      look.recipe
        ? PAINTED_FRAGMENT
        : fragmentFor({ waves: look.waves, signedShore: look.shore !== 'blur', climate: look.climate }),
      uniformsOf(look),
      { uSwellMap: rippleSource(swell), uChopMap: rippleSource(chop) },
      look.recipe ? PAINTED_CLIP_FRAGMENT : undefined,
    );
    if (this.surface.overlay) this.surface.overlay.renderable = !!look.recipe?.clip;
  }

  /** PROTOTYPE: take a look's numbers and colours without building the shader again (not its waves, shore or climate). */
  setLook(next: WaterLook) {
    Object.assign(this.look, next);
    // The clipped beach's second draw costs nothing while it is off.
    if (this.surface.overlay) this.surface.overlay.renderable = !!next.recipe?.clip;
    const u = this.surface.uniforms;
    for (const [k, v] of Object.entries(uniformsOf(next)))
      if (!['uView', 'uTime', 'uSplit'].includes(k)) u[k] = v.value;
  }

  /** Move the ripples and the foam to where they are at `ms`. */
  setTime(ms: number) {
    const look = this.look;
    const c = this.clock;
    const dt = c.ms < 0 ? 0 : Math.min(0.1, Math.max(0, (ms - c.ms) / 1000)) * this.rate;
    c.ms = ms;
    c.t += dt;
    const u = this.surface.uniforms;
    u.uView = this.view;
    if (look.recipe) {
      u.uTime = c.t * look.speed;
      return;
    }
    if (look.waves === 'slide') {
      const t = waterTime(look.speed, c.t * 1000);
      const l = waterTime(look.lakeSpeed, c.t * 1000);
      u.uSwell = [...t.swell, 1 / look.swellSize, 0];
      u.uChop = [...t.chop, 1 / look.chopSize, 0];
      u.uLakeAt = [...l.swell, ...l.chop];
      u.uLap = [t.lap, l.lap];
      return;
    }
    // The drift's heading and pace wander slowly, on a few incommensurate sines, so no direction or speed holds.
    const t = c.t;
    const heading = look.wander * (Math.sin(t * 0.031) + 0.6 * Math.sin(t * 0.077 + 1.3));
    const pace = 1 + look.gust * Math.sin(t * 0.053 + 0.4) * Math.sin(t * 0.021 + 2.1);
    const [hc, hs] = [Math.cos(heading), Math.sin(heading)];
    const step = (a: Float64Array, speed: number) => {
      const d = dt * speed * pace;
      // The swell drifts east and a little south, the chop north-east, both turned by the heading.
      a[0] += d * (0.011 * hc - 0.004 * hs);
      a[1] += d * (0.011 * hs + 0.004 * hc);
      a[2] += d * (-0.017 * hc - 0.029 * hs);
      a[3] += d * (-0.017 * hs + 0.029 * hc);
      // The swirl drifts, and the flow's phase turns over, at their own pace.
      a[4] += d * 0.004 * look.flowSpeed;
      a[5] += d * 0.35 * look.flowSpeed;
      for (let i = 0; i < 6; i++) a[i] -= Math.floor(a[i]);
    };
    step(c.sea, look.speed);
    step(c.calm, look.lakeSpeed);
    const [s, l] = [c.sea, c.calm];
    u.uSeaAt = [s[0], s[1], s[2], s[3]];
    u.uCalmAt = [l[0], l[1], l[2], l[3]];
    u.uSea = [s[4], s[4], s[5], 0];
    u.uCalm = [l[4], l[4], l[5], 0];
    u.uLap = [(t * look.speed * 1.3) % (2 * Math.PI), (t * look.lakeSpeed * 1.3) % (2 * Math.PI)];
  }
}

/**
 * Whether a WebGL context compiles and links a program from these sources: PixiJS compiles a shader only when it first
 * draws it, and only logs it when that fails, which would leave the map with no water.
 */
export function programLinks(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  { vertex, fragment }: { vertex: string; fragment: string },
): boolean {
  const made: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) return false;
      made.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false;
    }
    program = gl.createProgram();
    if (!program) return false;
    for (const shader of made) gl.attachShader(program, shader);
    gl.linkProgram(program);
    return !!gl.getProgramParameter(program, gl.LINK_STATUS);
  } catch {
    return false;
  } finally {
    if (program) gl.deleteProgram(program);
    for (const shader of made) gl.deleteShader(shader);
  }
}

/** Whether a WebGL context can draw the shader water: highp floats in fragment shaders, which the ripples need. */
export function canDrawWater(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const p = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return !!p && p.precision > 0;
}

/** A tile's cover (coverOf, W x H) at a point of the tile, the nearest pixel's. */
export const coverAt = (alpha: Float32Array, u: number, v: number): number =>
  alpha[Math.min(H - 1, Math.max(0, Math.floor(v))) * W + Math.min(W - 1, Math.max(0, Math.floor(u)))] ?? 0;

/**
 * How much the pictures on a water tile cover it together, 0 to 1 per pixel of the tile: one picture's alpha, or what
 * they leave uncovered taken away from one. Kept per set of pictures, which tiles of the same shore shape share.
 */
const covers = new Map<string, Float32Array>();
const picIds = new WeakMap<HTMLImageElement | HTMLCanvasElement, number>();
let nextPic = 1;
export function coverOf(pics: (HTMLImageElement | HTMLCanvasElement)[]): Float32Array {
  if (pics.length === 1) return alphaOf(pics[0]);
  const key = pics
    .map((p) => {
      let id = picIds.get(p);
      if (!id) picIds.set(p, (id = nextPic++));
      return id;
    })
    .join();
  let c = covers.get(key);
  if (!c) {
    c = new Float32Array(W * H).fill(1);
    for (const p of pics) {
      const a = alphaOf(p);
      for (let i = 0; i < c.length; i++) c[i] *= 1 - a[i];
    }
    for (let i = 0; i < c.length; i++) c[i] = 1 - c[i];
    covers.set(key, c);
  }
  return c;
}

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

/** PROTOTYPE (water playground, ?playground=water): what map.ts hands the playground to drive the water. */
export const waterPlayground: {
  /** The look the water is drawn in now. */
  look?: WaterLook | null;
  /** The surface drawing it. */
  surface?: () => WaterSurface | null;
  /** Draw the water in another look: a new shader, and the field made again. */
  restart?: (look: WaterLook) => Promise<boolean>;
  /** Flipbook under the recipe; split is a fraction of the map canvas. */
  compare?: (split: number, defaultOnly: boolean) => void | Promise<void>;
  /** The map the field was last made from. */
  map?: RiverMap;
} = {};
