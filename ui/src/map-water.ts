// The shader water (#409, #411): in a Tileset that has the look for it (BrowserCol), the ocean, lakes and high seas
// are one surface under the land, coloured per pixel by a fragment shader, in place of FreeCol's 21 painted frames.
//
// The shader paints FreeCol's own ocean, high seas and lake art (paintedWaterAtlas), drifting slowly, and colours it by
// the climate of the nearest land: a shallow shelf by the coast, wide and turquoise only by tropical land, bands moving
// ashore, and foam lapping the beach. A field over the whole map, in 2:1 texels, says how far the shore is (a signed
// distance to the edge of FreeCol's beach art), how deep the water is (a lake, the ocean, the high seas), and where
// there is water at all; a second field gives each texel's climate and river plume. The field is made on the CPU
// (waterField), off the main thread where the browser has a worker (water-field.worker.ts).
//
// It is four texture reads and a little arithmetic per pixel, for a netbook's GPU. Where it cannot run (PixiJS's
// Canvas renderer, the Canvas 2D pen, a GPU without highp floats in its fragment shaders), the map draws FreeCol's
// frames (tileset.ts WaterDrawing).
//
// ShaderSurface is the part another surface reuses (#411's rivers, map-rivers.ts): a mesh over the map's pixels with a
// shader, the field textures of the map, and textures and uniforms for its look.
import { BufferImageSource, Geometry, ImageSource, Mesh, Shader, type TextureSource } from 'pixi.js';
import { MAP_KEY_FAMILIES } from './map-keys';
import type { Resources } from './resources';
import type { MapView } from './tileset';
import { H, W } from './view';

const KEY = MAP_KEY_FAMILIES.shaderWater;

/** The shader water's look, from the Tileset's shader.water.* keys. */
export interface WaterLook {
  /** The foam's colour, and how far it laps out from the beach art's edge, in map pixels. */
  foam: number;
  foamWidth: number;
  /** The high seas' deep colour, as a share of the coast's deep colour. */
  highSeasShade: number;
  /** Each climate's deep water and shallows. */
  palettes: Record<Climate, Palette>;
  /** The bands moving ashore: pixels per second, and pixels between crests. */
  bandSpeed: number;
  bandSpacing: number;
  /** How fast FreeCol's art drifts, in pixels per second. */
  driftSpeed: number;
  /** How far the shallow shelf reaches from land, in map pixels, by tropical land (about half that by other land). */
  shelfWidth: number;
  /** How many tiles the land's climates blend over, out over the water. */
  climateBlend: number;
  /** The clipped beach: 1 draws the water again over FreeCol's beach art past a waterline, 0 not; and where the
   * waterline sits, in pixels out from where the art covers half. */
  clip: number;
  clipAt: number;
  /** The rivers' flow, in screen pixels per second, and how much the ripples on them brighten it. */
  rivers: { minor: number; major: number; streakStrength: number };
}

export type Climate = 'cold' | 'temperate' | 'tropical';
export const CLIMATES: Climate[] = ['cold', 'temperate', 'tropical'];
/** A climate's water: its deep and shallow colours. */
export interface Palette {
  deep: number;
  shallow: number;
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

/**
 * Each climate's share of the land round each texel, from cells of `f` by `f` texels over the whole map: the cells'
 * shares are blurred twice by `r` cells and read back bilinearly. The whole map's cells cost less than the texels
 * round one explored tile, and a field patched after exploring comes out as a fresh one, as both see every cell.
 */
export function coarseClimate(zone: Uint8Array, cols: number, rows: number, f: number, r: number) {
  const cw = Math.ceil(cols / f);
  const ch = Math.ceil(rows / f);
  const cells = [new Float32Array(cw * ch), new Float32Array(cw * ch), new Float32Array(cw * ch)];
  const count = new Float32Array(cw * ch);
  for (let j = 0; j < rows; j++) {
    const row = Math.floor(j / f) * cw;
    for (let i = 0; i < cols; i++) {
      const c = row + Math.floor(i / f);
      count[c]++;
      const z = zone[j * cols + i];
      if (z) cells[z - 1][c]++;
    }
  }
  for (const a of cells) {
    for (let c = 0; c < a.length; c++) a[c] /= count[c];
    blur(a, cw, ch, r);
    blur(a, cw, ch, r);
  }
  return {
    /** The three shares at texel (i, j), into `to`. */
    at(i: number, j: number, to: Float64Array) {
      const x = Math.min(cw - 1, Math.max(0, (i + 0.5) / f - 0.5));
      const y = Math.min(ch - 1, Math.max(0, (j + 0.5) / f - 0.5));
      const x0 = Math.floor(x),
        y0 = Math.floor(y);
      const x1 = Math.min(cw - 1, x0 + 1),
        y1 = Math.min(ch - 1, y0 + 1);
      const fx = x - x0,
        fy = y - y0;
      for (let z = 0; z < 3; z++) {
        const a = cells[z];
        const top = a[y0 * cw + x0] * (1 - fx) + a[y0 * cw + x1] * fx;
        const bottom = a[y1 * cw + x0] * (1 - fx) + a[y1 * cw + x1] * fx;
        to[z] = top * (1 - fy) + bottom * fy;
      }
    },
  };
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

/** The Tileset's water look, or null when it has none (FreeCol's own: its water stays FreeCol's frames). */
export function waterLook(res: Resources): WaterLook | null {
  // A Tileset has the look when it says how wide its shelf is; FreeCol's own and FreeCol+ do not.
  if (!Number.isFinite(Number(res.string(`${KEY}shelfWidth`)))) return null;
  return {
    foam: res.color(`${KEY}foam`),
    foamWidth: numberOf(res, `${KEY}foamWidth`, 7),
    highSeasShade: numberOf(res, `${KEY}highSeasShade`, 0.72),
    palettes: Object.fromEntries(
      CLIMATES.map((k) => [k, { deep: res.color(`${KEY}${k}.deep`), shallow: res.color(`${KEY}${k}.shallow`) }]),
    ) as Record<Climate, Palette>,
    bandSpeed: numberOf(res, `${KEY}bandSpeed`, 5),
    bandSpacing: numberOf(res, `${KEY}bandSpacing`, 40),
    driftSpeed: numberOf(res, `${KEY}driftSpeed`, 2),
    shelfWidth: numberOf(res, `${KEY}shelfWidth`, 90),
    climateBlend: numberOf(res, `${KEY}climateBlend`, 3),
    clip: numberOf(res, `${KEY}clip`, 1),
    clipAt: numberOf(res, `${KEY}clipAt`, -2),
    rivers: {
      minor: numberOf(res, `${KEY}river.minorSpeed`, 6),
      major: numberOf(res, `${KEY}river.majorSpeed`, 3),
      streakStrength: numberOf(res, `${KEY}river.streakStrength`, 0.1),
    },
  };
}

/** The map pixels a field texel covers, at the least: a tile is 16 by 8 of them, and a coast's sand fades over 3. */
export const FIELD_TEXEL = 8;
/** The shore distance's cap either side when closing the coast, and the field's cap offshore, in map pixels. */
const CLOSE_CAP = 48;
const SHORE_CAP = 192;
/** How far closing the coast grows and shrinks it, in map pixels. */
const CLOSING_PX = 20;

/** The whole map's size in map pixels: odd rows stick out half a tile, and each row is half a tile down. */
export const mapPixels = (w: number, h: number): [number, number] => [w * W + W / 2, ((h + 1) * H) / 2];

/** The map pixels a field texel covers for a map, so the field is no more than `max` texels either way. */
export const fieldTexel = (w: number, h: number, max = 4096): number => {
  const [pw, ph] = mapPixels(w, h);
  return Math.max(FIELD_TEXEL, Math.ceil(pw / max), Math.ceil(ph / max));
};

/**
 * The field the shader reads, in 2:1 texels of `texel` by `texel / 2` map pixels, RGBA: red how much land, or a water
 * tile's shore cover (its sand and the land and beach its transitions bring onto it), with holes in the art filled and
 * the coast closed; green the water's depth (0 a lake, a half the ocean, 1 the high seas); blue the signed distance to
 * the shore, 0.5 at it and less offshore; and alpha whether there is water there at all.
 */
export interface WaterField {
  cols: number;
  rows: number;
  texel: number;
  texelY: number;
  data: Uint8Array;
  /** Per texel, how much the water is cold, temperate and tropical (RGB, adding up to 1), and a river's plume (A). */
  climate: Uint8Array;
  /**
   * What it was made from, unblurred, for the next field of the map to make again only round the tiles that changed.
   * The next field takes these, and its data, over.
   */
  made?: {
    w: number;
    h: number;
    types: string;
    tiles: string;
    climateBlend: number;
    land: Float32Array;
    depth: Float32Array;
    water: Float32Array;
    /** Per texel, whether open water is sure to show there: a water tile's middle that nothing covers. */
    seed: Uint8Array;
    /** Per texel, the climate of the land there: 0 none (water, or hills by the latitude), 1 cold, 2 temperate, 3 tropical. */
    zone: Uint8Array;
    /** Per texel, a sailing channel closing the coast must leave open. */
    channels: Uint8Array;
    plume: Float32Array;
    /** Each river tile's entry, by tile index: a river explored or changed is made again round its tile. */
    rivers: Map<number, string>;
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
 * The water field of a map. Each texel's tile, at its centre, decides it, and a water tile's shore cover counts as land
 * as much as it covers there (`sand`: its cover, 0 to 1, at a point of the tile, or 0 for a tile with none). Holes in
 * the cover are filled and the coast closed, and the signed distance to its edge taken; the climate comes from a
 * coarse grid over the whole map, blended over `climateBlend` tiles.
 *
 * Given the map's `last` field, it makes again only the texels round the tiles that changed (ground explored, say),
 * reusing that field's arrays: the same field when no tile changed.
 */
export function waterField(
  map: FieldMap & Partial<Pick<MapView, 'rivers'>>,
  texel: number,
  sand: (x: number, y: number, u: number, v: number) => number,
  last: WaterField | null | undefined,
  climateBlend: number,
): WaterField {
  const { w, h, tiles } = map;
  const [pw, ph] = mapPixels(w, h);
  const cols = Math.ceil(pw / texel);
  const texelY = texel / 2;
  const rows = Math.ceil(ph / texelY);
  const n = cols * rows;
  const types = map.types.map((t) => t.id).join();
  const was = last?.made;
  // A river's plume reaches only the water tiles by it: a river explored makes the field again round its tile alone.
  const riverEntries = new Map((map.rivers ?? []).map((r) => [r[1] * w + r[0], r.join()]));
  const reuse =
    !!was &&
    last.cols === cols &&
    last.rows === rows &&
    last.texel === texel &&
    was.w === w &&
    was.h === h &&
    was.types === types &&
    was.climateBlend === climateBlend;
  const climateR = Math.max(1, Math.round((climateBlend * W) / texel / 2));
  // The climate comes from a coarse grid over the whole map (coarseClimate), so the shore's passes need not reach as
  // far as the climate blends: a move that explores a tile then makes far fewer texels again (#411).
  const coarse = Math.max(1, Math.round(W / 2 / texel));
  const coarseR = Math.max(1, Math.round(climateR / coarse));
  // Closing reaches twice its radius, followed by the capped distance.
  const reach = Math.ceil((SHORE_CAP + 2 * CLOSING_PX) / texel) + 1;
  const all: Rect = { i0: 0, j0: 0, i1: cols, j1: rows };
  /** The texels to make again: round the tiles that changed, with their neighbours, whose sand depends on them. */
  let raw = all;
  if (reuse) {
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    const changed = (k: number) => {
      const [x, y] = [k % w, Math.floor(k / w)];
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    };
    for (let k = 0; k < tiles.length; k++) if (tiles.charCodeAt(k) !== was.tiles.charCodeAt(k)) changed(k);
    for (const [k, r] of riverEntries) if (was.rivers.get(k) !== r) changed(k);
    for (const k of was.rivers.keys()) if (!riverEntries.has(k)) changed(k);
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
  // Per tile type: land (0), or water and its depth, offset by one. Lakes by their type: FreeCol makes all water shut
  // off from the ocean lake tiles.
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
        depth[k] = kind - 1;
        let a = 0;
        for (let s = 0; s < SAMPLES.length; s += 2)
          a += sand(x, y, u + SAMPLES[s] * texel, v + SAMPLES[s + 1] * texelY);
        land[k] = a / (SAMPLES.length / 2);
        if (land[k] < 0.05 && Math.abs(u - W / 2) / (W / 2) + Math.abs(v - H / 2) / (H / 2) < 0.5) seed[k] = 1;
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
        break;
      }
    }
  }
  // The texels whose values may have changed, and the texels those are made from.
  const out = reuse ? clip(grow(raw, reach), cols, rows) : all;
  // The coarse climate changes within its two blurs and the bilinear step of a changed tile.
  const outClimate = reuse ? clip(grow(raw, (2 * coarseR + 2) * coarse), cols, rows) : all;
  const src = reuse ? clip(grow(out, reach), cols, rows) : all;
  const sw = src.i1 - src.i0;
  const sh = src.j1 - src.j0;
  const seedPart = (source: Uint8Array) => {
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
  let cover = fillHoles(part(land), seedPart(seed), sw, sh);
  cover = closeCoast(cover, seedPart(channels), sw, sh, texel, CLOSING_PX);
  const near = shoreDistance(cover, sw, sh, texel, SHORE_CAP);
  const deep = part(depth);
  const wet = part(water);
  const grid = coarseClimate(zone, cols, rows, coarse, coarseR);
  blur(wet, sw, sh, 1);
  const data = reuse ? last.data : new Uint8Array(4 * n);
  const climate = reuse ? last.climate : new Uint8Array(4 * n);
  for (let j = out.j0; j < out.j1; j++)
    for (let i = out.i0; i < out.i1; i++) {
      const k = j * cols + i;
      const p = (j - src.j0) * sw + (i - src.i0);
      data[4 * k] = Math.round(cover[p] * 255);
      data[4 * k + 1] = Math.round(deep[p] * 255);
      data[4 * k + 2] = Math.round((0.5 - near[p] / (2 * SHORE_CAP)) * 255);
      data[4 * k + 3] = Math.round(wet[p] * 255);
    }
  const share = new Float64Array(3);
  for (let j = outClimate.j0; j < outClimate.j1; j++) {
    // Far from any land, the latitude: cold toward the poles, tropical round the equator. Per row, and without
    // arrays per texel: this loop runs over every texel made again when a move explores a tile.
    const lat = Math.abs(((j + 0.5) * texelY) / ph - 0.5) * 2;
    const cold = smooth(0.62, 0.8, lat);
    const tropical = 1 - smooth(0.25, 0.45, lat);
    const temperate = Math.max(0, 1 - cold - tropical);
    for (let i = outClimate.i0; i < outClimate.i1; i++) {
      const k = j * cols + i;
      grid.at(i, j, share);
      const far = Math.max(0, 1 - (share[0] + share[1] + share[2]) / 0.25) * 0.25;
      const a = share[0] + far * cold,
        b = share[1] + far * temperate,
        c = share[2] + far * tropical;
      const total = Math.max(a + b + c, 1e-6);
      climate[4 * k] = Math.round((a / total) * 255);
      climate[4 * k + 1] = Math.round((b / total) * 255);
      climate[4 * k + 2] = Math.round((c / total) * 255);
      climate[4 * k + 3] = Math.round(plume[k] * 255);
    }
  }
  return {
    cols,
    rows,
    texel,
    texelY,
    data,
    climate,
    made: { w, h, types, tiles, climateBlend, land, depth, water, zone, seed, channels, plume, rivers: riverEntries },
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
 * Water the open sea cannot reach without crossing the art (where it covers half or more)
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
 * The signed distance to the cover's half-opacity contour, in map pixels, positive offshore, capped at `cap`. Crossings are found between texels, then spread with two chamfer passes.
 */
export function shoreDistance(
  land: Float32Array,
  cols: number,
  rows: number,
  texel: number,
  cap = CLOSE_CAP,
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

/** 0xRRGGBB as a colour's three channels, 0 to 1. */
const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// Both stages at highp, which canDrawWater checks the GPU has: PixiJS asks for mediump in a fragment shader unless the
// source starts with its precision, and the ripples' coordinates reach tens of turns of their textures on a big map.
const VERTEX = /* glsl */ `precision highp float;
in vec2 aPosition;
out vec2 vField;
out vec2 vSlant;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uFieldSize;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vField = aPosition / uFieldSize;
  // The map is seen at a slant, its tiles twice as wide as tall: so is the water's pattern.
  vSlant = vec2(aPosition.x, aPosition.y * 2.0);
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
uniform sampler2D uFieldBefore;
uniform float uFade;
uniform sampler2D uClimate;
uniform sampler2D uSwellMap;
uniform vec4 uRecipe;
uniform vec4 uShore;
uniform vec3 uFoam;
uniform vec3 uShal0;
uniform vec3 uShal1;
uniform vec3 uShal2;
uniform vec3 uDeep0;
uniform vec3 uDeep1;
uniform vec3 uDeep2;
uniform float uTime;
uniform vec2 uClip;
vec3 paint(vec2 p, float kind) {
  vec2 q = fract(p);
  return texture(uSwellMap, vec2(q.x, (kind + (q.y * 127.0 + 0.5) / 128.0) / 3.0)).rgb;
}
void main() {
  vec4 f = texture(uField, vField);
  // A field just made fades in from the one before: the shelf, the coast and new water grow rather than pop in.
  // Once it is in, the field before is not read.
  if (uFade < 1.0) f = mix(texture(uFieldBefore, vField), f, uFade);
  if (f.a < 0.001) discard;
  vec4 climate = texture(uClimate, vField);
#ifdef CLIP
  // Out before any painting: the clipped beach is off, or the pixel is off the waterline's strip.
  if (uClip.x < 0.5) discard;
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
  float dist = (0.5 - f.b) * 384.0 + plume * 22.0;
  float d = max(0.0, dist);
  // Long shallows only by tropical land: cold and temperate shelves are about half as wide, and fainter.
  float shelfReach = dot(w, vec3(0.5, 0.55, 1.0));
  float shelf = (1.0 - smoothstep(8.0, uRecipe.w * shelfReach * 0.8, d + noise * 6.0)) *
    dot(w, vec3(0.8, 0.75, 1.0));
  vec3 shallow = uShal0*w.r + uShal1*w.g + uShal2*w.b;
  vec3 tint = uDeep0*w.r + uDeep1*w.g + uDeep2*w.b;
  vec3 deep = mix(art, tint * (0.75 + dot(art, vec3(0.33))), 0.38) * mix(1.0, uShore.z, high);
  deep *= vec3(0.72, 0.8, 0.92);
  // Dim without pushing slate-green back toward the ocean's saturated blue.
  shallow *= vec3(0.82, 0.86, 0.88);
  vec3 col = mix(deep, shallow * (0.8 + dot(art, vec3(0.3))), shelf * 0.92);
  // In the field's uncompressed metric a diamond edge is 128 / sqrt(2) pixels.
  float dd = d / 90.51;
  float broken = sin(p.x * 8.3 + sin(p.y * 5.7)) * sin(p.y * 7.1 - p.x * 3.9);
  float phase = (d + uTime * uRecipe.x) * 6.283185 / uRecipe.y + noise * 3.0 + broken;
  float bands = smoothstep(0.65, 1.0, sin(phase)) * smoothstep(0.04, 0.15, dd) *
    (1.0 - smoothstep(0.0, 0.6, dd)) * smoothstep(-0.15, 0.55, broken) * (1.0 - lake);
  col += vec3(0.9, 0.95, 1.0) * bands * 0.22;
  col += lake * 0.025 * (0.5 + 0.5 * sin(p.x * 0.7 + p.y * 0.4 + uTime * 0.19));
  float lap = sin(uTime * mix(1.1, 0.45, lake) + noise * 2.0);
  float reach = uShore.y * (0.7 + 0.3 * lap) * mix(1.0, 0.35, lake);
  float waterline = reach * 0.35;
  float foam = (1.0 - smoothstep(0.0, max(0.5, uShore.y * 0.55), abs(dist - waterline))) *
    (0.6 + noise * 0.3) * mix(0.5, 0.16, lake) * (1.0 - plume);
  // Dry sand must show outside the land tile, not start behind its opaque edge.
  float dry = 1.0 - smoothstep(-9.0, -2.0, dist);
  vec3 sand = mix(vec3(0.64, 0.56, 0.42), vec3(0.86, 0.76, 0.55), dry);
  sand *= 0.97 + noise * 0.03;
  // The art shore keeps its painted cover. Sand underneath fills transparent holes, but stops well inside the art's
  // own fade to the sea: sand under the fade read as beach bleeding into the water (worst on snow and tundra).
  col = mix(col, sand, 1.0 - smoothstep(-12.0, -8.0, dist));
  col = mix(col, uFoam, foam);
  vec3 river = mix(art, shallow * (0.8 + dot(art, vec3(0.3))), dot(w, vec3(0.8, 0.75, 1.0)) * 0.92);
  col = mix(col, river, plume * 0.8);
#ifdef CLIP
  // Drawn again over FreeCol's beach art: only the water past the waterline, so the art's fade to the sea is
  // covered and the beach ends in a clean edge. Not at river mouths (their art stays), nor far out where no art is.
  float over = smoothstep(uClip.y, uClip.y + 4.0, dist) * (1.0 - smoothstep(30.0, 34.0, dist)) * (1.0 - plume) *
    uClip.x;
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

/** How long a field just made takes to fade in from the one before, in ms. */
export const FIELD_FADE_MS = 500;

/** A field texture: one texel per field texel, smoothed between them. */
const fieldSource = (cols: number, rows: number, data: Uint8Array) =>
  new BufferImageSource({
    resource: data,
    width: cols,
    height: rows,
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
  /** A second draw of the same surface, with its own fragment shader and the same uniforms and textures, for the map
   * to place higher up (the clipped beach); null when there is none. */
  readonly overlay: Mesh<Geometry, Shader> | null = null;
  private field: BufferImageSource;
  /** The field before, which the field fades in from (uFieldBefore, uFade), and when that fade began. */
  private before: BufferImageSource;
  private fadeFrom = -1;
  /** The climate field, the same size as the field. */
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
    this.field = fieldSource(1, 1, new Uint8Array(4));
    this.before = this.field;
    this.climate = fieldSource(1, 1, new Uint8Array([0, 255, 0, 255]));
    this.textures = Object.values(textures);
    const shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        surface: { uFieldSize: { value: [1, 1], type: 'vec2<f32>' }, uFade: { value: 1, type: 'f32' }, ...uniforms },
        uField: this.field,
        uFieldBefore: this.before,
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
        resources: {
          surface: shader.resources.surface,
          uField: this.field,
          uFieldBefore: this.before,
          uClimate: this.climate,
          ...textures,
        },
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

  /**
   * Cover the map the field covers, and read it: at `now` (ms) it starts fading in from the field before, over
   * FIELD_FADE_MS (fading()), or at once without a `now` or when the field's size changed (another map).
   */
  setField(f: WaterField, now?: number) {
    const [w, h] = [f.cols * f.texel, f.rows * f.texelY];
    const shown = this.field;
    const sameSize = shown.width === f.cols && shown.height === f.rows;
    const fade = sameSize && now !== undefined;
    /** What is let go, destroyed once the shaders no longer read it. */
    const gone: BufferImageSource[] = [];
    if (sameSize && now !== undefined) {
      // The field shown now becomes the one before; the new one goes into the texture that was before, if it fits.
      const spare = this.before;
      this.before = shown;
      if (spare !== shown && spare.width === f.cols && spare.height === f.rows) {
        spare.resource = f.data;
        spare.update();
        this.field = spare;
      } else {
        if (spare !== shown) gone.push(spare);
        this.field = fieldSource(f.cols, f.rows, f.data);
      }
    } else {
      if (this.before !== shown) gone.push(this.before);
      if (sameSize) {
        shown.resource = f.data;
        shown.update();
      } else {
        this.field = fieldSource(f.cols, f.rows, f.data);
        gone.push(shown);
      }
      this.before = this.field;
    }
    for (const m of [this.mesh, this.overlay]) {
      if (!m) continue;
      m.shader!.resources.uField = this.field;
      m.shader!.resources.uFieldBefore = this.before;
    }
    for (const g of gone) g.destroy();
    this.fadeFrom = fade ? now : -1;
    this.uniforms.uFade = fade ? 0 : 1;
    const climate = f.climate;
    const oldClimate = this.climate;
    if (oldClimate.width === f.cols && oldClimate.height === f.rows) {
      oldClimate.resource = climate;
      oldClimate.update();
    } else {
      this.climate = fieldSource(f.cols, f.rows, climate);
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

  /** Move the field's fade in on to `now` (ms); whether it is still fading, and the map must be drawn again. */
  fading(now: number): boolean {
    if (this.fadeFrom < 0) return false;
    const t = Math.min(1, Math.max(0, (now - this.fadeFrom) / FIELD_FADE_MS));
    this.uniforms.uFade = t;
    if (t >= 1) {
      // Faded in: the field before is let go, so only a fade holds a second field.
      this.fadeFrom = -1;
      const before = this.before;
      this.before = this.field;
      for (const m of [this.mesh, this.overlay]) if (m) m.shader!.resources.uFieldBefore = this.field;
      if (before !== this.field) before.destroy();
    }
    return true;
  }

  /** Destroy the mesh, its geometry and shader, the field and the look's textures. */
  destroy() {
    this.overlay?.shader?.destroy();
    this.overlay?.destroy();
    this.mesh.geometry.destroy();
    this.mesh.shader?.destroy();
    this.mesh.destroy();
    if (this.before !== this.field) this.before.destroy();
    this.field.destroy();
    this.climate.destroy();
    for (const t of this.textures) t.destroy();
  }
}

/** FreeCol's water art, unprojected (paintedWaterAtlas), as a texture that repeats, with mipmaps so it does not
 * shimmer zoomed out. */
const artSource = (pic: HTMLImageElement | HTMLCanvasElement) =>
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
  const p = look.palettes;
  return {
    uFoam: color(look.foam),
    uShore: vec4([0, look.foamWidth, look.highSeasShade, 0]),
    uDeep0: color(p.cold.deep),
    uDeep1: color(p.temperate.deep),
    uDeep2: color(p.tropical.deep),
    uShal0: color(p.cold.shallow),
    uShal1: color(p.temperate.shallow),
    uShal2: color(p.tropical.shallow),
    uRecipe: vec4([look.bandSpeed, look.bandSpacing, look.driftSpeed, look.shelfWidth]),
    uTime: { value: 0, type: 'f32' },
    uClip: { value: [look.clip, look.clipAt], type: 'vec2<f32>' },
  };
};

/** The shader water: a ShaderSurface with the water's shader and look, whose time moves the water. */
export class WaterSurface {
  readonly surface: ShaderSurface;
  /** Its own clock, in seconds of water time. */
  private clock = { ms: -1, t: 0 };
  constructor(
    readonly look: WaterLook,
    /** FreeCol's ocean, high seas and lake art, unprojected (paintedWaterAtlas). */
    art: HTMLImageElement | HTMLCanvasElement,
  ) {
    this.surface = new ShaderSurface(
      VERTEX,
      PAINTED_FRAGMENT,
      uniformsOf(look),
      { uSwellMap: artSource(art) },
      PAINTED_CLIP_FRAGMENT,
    );
    // The clipped beach's second draw costs nothing while it is off.
    if (this.surface.overlay) this.surface.overlay.renderable = !!look.clip;
  }

  /** Move the water to where it is at `ms`: a frame's step at most, so a tab in the background does not jump it. */
  setTime(ms: number) {
    const c = this.clock;
    c.t += c.ms < 0 ? 0 : Math.min(0.1, Math.max(0, (ms - c.ms) / 1000));
    c.ms = ms;
    this.surface.uniforms.uTime = c.t;
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
