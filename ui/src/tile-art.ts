// The seam for art placed by rule (#535, ADR 0003): extra layers that a Tileset registers and the map builds into the
// chunk tilemap beside the Tileset's pictures. A layer is called once per tile with the tile, its neighbours, a seed and
// the current Projection, and returns pictures and where to put them. Scattered trees, layered forests and peaks are
// what it is for (post-2.0); what ships now is a debug marker (debugMarkers) that proves it draws in both views.
//
// With no layer registered the map's build does not call into this at all: placeTileArt returns before it looks at a
// tile, and nothing is allocated.
import { mapGrid, type Direction, type Point, type Projection } from './projection';
import type { TileType } from './tileset';

/** A picture a layer draws: a canvas or an image, as the map's other pictures. */
export type TilePicture = HTMLImageElement | HTMLCanvasElement;

/** A tile, as a layer sees it: where, and its type, null while it is unexplored. */
export interface ArtTile {
  x: number;
  y: number;
  type: TileType | null;
}

/** What a layer is called with, for one tile. */
export interface TileArtContext {
  tile: ArtTile;
  /** The tile's neighbours by screen direction, null off the map. */
  neighbours: Partial<Record<Direction, ArtTile | null>>;
  /** The same for the same tile of the same map, whatever order the tiles are visited in. */
  seed: number;
  /** The projection of the Map view now being drawn: where the tile's box and middle are on the map, its size. */
  projection: Projection;
  /** The tile's box origin and middle in map pixels, as the projection places them. */
  origin: Point;
  centre: Point;
}

/** One picture a layer adds, its top-left corner in map pixels. */
export interface Placed {
  pic: TilePicture;
  x: number;
  y: number;
}

export interface TileArtLayer {
  /** What the layer is called, to register and unregister it by. */
  id: string;
  /** The pictures to add for one tile; nothing for none. The layer keeps its own pictures: they are drawn, not copied. */
  at(c: TileArtContext): readonly Placed[] | null | undefined;
}

const layers: TileArtLayer[] = [];
const NONE: readonly TileArtLayer[] = Object.freeze([]);

/** Register a layer (a Tileset's, or the debug one), replacing one of the same id; returns what unregisters it. */
export function registerTileArt(layer: TileArtLayer): () => void {
  unregisterTileArt(layer.id);
  layers.push(layer);
  return () => unregisterTileArt(layer.id);
}

export function unregisterTileArt(id: string): void {
  const i = layers.findIndex((l) => l.id === id);
  if (i >= 0) layers.splice(i, 1);
}

/** The layers registered now: a shared empty list when there are none. */
export const tileArtLayers = (): readonly TileArtLayer[] => (layers.length ? layers : NONE);

/** A seed for a tile: a hash of the map's size and the tile's place. */
export function tileSeed(w: number, h: number, x: number, y: number): number {
  let s =
    Math.imul(w, 374761393) ^ Math.imul(h, 668265263) ^ Math.imul(x + 1, 2246822519) ^ Math.imul(y + 1, 3266489917);
  s = Math.imul(s ^ (s >>> 15), 2246822519);
  s = Math.imul(s ^ (s >>> 13), 3266489917);
  return (s ^ (s >>> 16)) >>> 0;
}

/**
 * Run the layers over the map, each tile in turn, and give each picture they place to `put` with the tile it is for.
 * Does nothing, and allocates nothing, when `active` is empty.
 */
export function placeTileArt(
  active: readonly TileArtLayer[],
  map: { w: number; h: number; typeAt(x: number, y: number): TileType | null },
  projection: Projection,
  put: (tile: Point, p: Placed, layer: TileArtLayer) => void,
): void {
  if (active.length === 0) return;
  const { w, h } = map;
  const at = (x: number, y: number): ArtTile => ({ x, y, type: map.typeAt(x, y) });
  projection.eachTile(w, h, (x, y) => {
    const neighbours: TileArtContext['neighbours'] = {};
    for (const d of mapGrid.directions) {
      const [nx, ny] = mapGrid.neighbour(x, y, projection.inGrid(d));
      neighbours[d] = nx >= 0 && ny >= 0 && nx < w && ny < h ? at(nx, ny) : null;
    }
    const context: TileArtContext = {
      tile: at(x, y),
      neighbours,
      seed: tileSeed(w, h, x, y),
      projection,
      origin: projection.origin(x, y, h),
      centre: projection.centre(x, y, h),
    };
    for (const layer of active) for (const p of layer.at(context) ?? []) put([x, y], p, layer);
  });
}

const MARK = 14;
let mark: HTMLCanvasElement | null = null;
/** A small bright square, drawn once. */
function markPicture(): HTMLCanvasElement {
  if (mark) return mark;
  mark = Object.assign(document.createElement('canvas'), { width: MARK, height: MARK });
  // No 2D context (a test's jsdom): the picture is there, blank.
  const g = mark.getContext('2d');
  if (g) {
    g.fillStyle = '#ff00ff';
    g.fillRect(0, 0, MARK, MARK);
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.strokeRect(1, 1, MARK - 2, MARK - 2);
  }
  return mark;
}

/** The debug layer: a magenta marker at the middle of every explored tile. It exists to prove the seam in both views. */
export const debugMarkers: TileArtLayer = {
  id: 'debug-markers',
  at: ({ tile, centre }) =>
    tile.type
      ? [{ pic: markPicture(), x: Math.round(centre[0] - MARK / 2), y: Math.round(centre[1] - MARK / 2) }]
      : null,
};
