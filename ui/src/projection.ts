// The map's geometry, in one place (#524): which tile is next to which, where a tile is on the screen, and what shape it
// has there. Everything else that draws, hit-tests or lays out the map asks this module and never does the arithmetic
// on tile coordinates itself: no row parity, no direction delta table, no diamond maths.
//
// Two interfaces, so that either can be swapped for another later without touching their users:
//  - a Grid, how the tiles are numbered and which are next to which (today FreeCol's staggered diamond grid);
//  - a Projection, where a tile goes on the screen at zoom 1 and its outline (today FreeCol's 128x64 isometric tiles).
// The exports at the bottom are the ones in use; nothing here yet chooses between more than one.

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** A tile's column and row. */
export type Tile = [number, number];
/** A point in map pixels, at zoom 1, or in a tile's box. */
export type Point = [number, number];

/** How the tiles are numbered and which are next to which. */
export interface Grid {
  /** All the directions a tile has a neighbour in, in FreeCol's order (Direction.values()). */
  readonly directions: readonly Direction[];
  /** The directions of the neighbours that share an edge with the tile, in the order river and road styles list them. */
  readonly edges: readonly Direction[];
  /** The directions of the neighbours that touch it only at a corner. */
  readonly corners: readonly Direction[];
  /** The neighbour in a direction. It may be off the map: the caller checks. */
  neighbour(x: number, y: number, d: Direction): Tile;
  /** The direction a neighbour sees the tile in. */
  opposite(d: Direction): Direction;
  /** Whether the neighbour in a direction shares an edge with the tile. */
  isEdge(d: Direction): boolean;
  /** Where an edge neighbour's direction comes in `edges` (a river style's digit), or -1 for a corner one. */
  edgeIndex(d: Direction): number;
  /**
   * A tile's two coordinates along the grid's own axes, which tiles that share an edge differ by one in: the chunks of
   * the tilemaps are made of them.
   */
  lattice(x: number, y: number): Point;
  /** Calls `f` with each tile of a w by h map, in the order they are drawn: each is drawn over those before it. */
  eachTile(w: number, h: number, f: (x: number, y: number) => void): void;
}

/** Where a tile goes on the screen, at zoom 1, and its shape. */
export interface Projection {
  /** The size of a tile's box in map pixels. */
  readonly tile: { readonly w: number; readonly h: number };
  /** The middle of a tile's box, in the box. */
  readonly middle: Point;
  /**
   * How far a point in a tile's box is from the middle of the tile's shape: 0 at the middle, 1 on its outline, more
   * beyond it.
   */
  inset(u: number, v: number): number;
  /** An offset on the screen, as it is seen from above, which the view squashes down the screen. */
  fromAbove(dx: number, dy: number): Point;
  /** Where a tile's box starts on the whole map. */
  origin(x: number, y: number): Point;
  /** The middle of a tile's box on the whole map. */
  centre(x: number, y: number): Point;
  /** The whole map's size in map pixels. */
  mapSize(w: number, h: number): Point;
  /**
   * The box in map pixels (left, top, right, bottom) round the tiles from column x0, row y0 to column x1, row y1 and
   * the tiles near them, which a change to them may change the look of: their neighbours and a beach two tiles away.
   */
  neighbourhood(x0: number, y0: number, x1: number, y1: number): [number, number, number, number];
  /** The tile whose shape holds a point of the whole map, or null off the map. */
  tileAt(w: number, h: number, px: number, py: number): Tile | null;
  /**
   * The corners of a tile's shape, going round it, for a box `width` pixels wide at `origin` (the tile's own box
   * by default), the shape shrunk to `scale` of it about its middle.
   */
  outline(origin: Point, width?: number, scale?: number): Point[];
  /** Where the middle of the edge shared with the neighbour in an edge direction is, from the tile's middle. */
  edgeMidpoint(d: Direction): Point;
  /** The point of a tile's box a road or a river leaves it by, in a direction. */
  anchor(d: Direction): Point;
  /** The two ends, in the tile's box, of the edge it shares with its neighbour in an edge direction. */
  edge(d: Direction): [Point, Point];
  /** Where the box of the tile at column `col`, row `row` of a square block of `size` tiles starts, in the block. */
  block(col: number, row: number, size?: number): Point;
  /** How big a block of `size` tiles is, from its top. */
  blockSize(size?: number): Point;
}

// FreeCol's Direction: [dx, dy] on odd rows, then on even rows.
const STEPS: Record<Direction, [number, number, number, number]> = {
  N: [0, -2, 0, -2],
  NE: [1, -1, 0, -1],
  E: [1, 0, 1, 0],
  SE: [1, 1, 0, 1],
  S: [0, 2, 0, 2],
  SW: [0, 1, -1, 1],
  W: [-1, 0, -1, 0],
  NW: [0, -1, -1, -1],
};
const OPPOSITE: Record<Direction, Direction> = {
  N: 'S',
  NE: 'SW',
  E: 'W',
  SE: 'NW',
  S: 'N',
  SW: 'NE',
  W: 'E',
  NW: 'SE',
};
const EDGES: readonly Direction[] = ['NE', 'SE', 'SW', 'NW'];

/** FreeCol's map: a staggered diamond grid, odd rows half a tile to the right, a row half a tile down. */
export const staggered: Grid = {
  directions: Object.keys(STEPS) as Direction[],
  edges: EDGES,
  corners: ['N', 'E', 'S', 'W'],
  neighbour: (x, y, d) => {
    const s = STEPS[d];
    return y % 2 ? [x + s[0], y + s[1]] : [x + s[2], y + s[3]];
  },
  opposite: (d) => OPPOSITE[d],
  isEdge: (d) => EDGES.includes(d),
  edgeIndex: (d) => EDGES.indexOf(d),
  lattice: (x, y) => [x + ((y + 1) >> 1), (y >> 1) - x],
  eachTile: (w, h, f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f(x, y);
  },
};

/** FreeCol's tiles: 128x64 diamonds. A tile's box is this big whatever the view. */
export const W = 128;
export const H = 64;

const ANCHORS: Record<Direction, Point> = {
  N: [W / 2, 0],
  NE: [0.75 * W, 0.25 * H],
  E: [W, H / 2],
  SE: [0.75 * W, 0.75 * H],
  S: [W / 2, H],
  SW: [0.25 * W, 0.75 * H],
  W: [0, H / 2],
  NW: [0.25 * W, 0.25 * H],
};

/** The diamond's edges, by the neighbour they face: between the anchors at their ends. */
const EDGE_ENDS: Partial<Record<Direction, [Direction, Direction]>> = {
  NE: ['N', 'E'],
  SE: ['E', 'S'],
  SW: ['S', 'W'],
  NW: ['W', 'N'],
};

/** FreeCol's isometric view of the staggered grid. */
export const isometric: Projection = {
  tile: { w: W, h: H },
  origin: (x, y) => [x * W + (y % 2) * (W / 2), (y * H) / 2],
  centre: (x, y) => {
    const [ox, oy] = isometric.origin(x, y);
    return [ox + W / 2, oy + H / 2];
  },
  middle: [W / 2, H / 2],
  inset: (u, v) => Math.abs(u - W / 2) / (W / 2) + Math.abs(v - H / 2) / (H / 2),
  fromAbove: (dx, dy) => [dx, dy * 2],
  neighbourhood: (x0, y0, x1, y1) => [(x0 - 1) * W, ((y0 - 2) * H) / 2, (x1 + 2) * W + W / 2, ((y1 + 4) * H) / 2],
  mapSize: (w, h) => [(w + 0.5) * W, ((h + 1) * H) / 2],
  tileAt: (w, h, px, py) => {
    const row = Math.floor(py / (H / 2));
    for (const y of [row - 1, row]) {
      if (y < 0 || y >= h) continue;
      const x = Math.floor((px - (y % 2) * (W / 2)) / W);
      const [ox, oy] = isometric.origin(x, y);
      if (x >= 0 && x < w && Math.abs(px - ox - W / 2) / (W / 2) + Math.abs(py - oy - H / 2) / (H / 2) <= 1) {
        return [x, y];
      }
    }
    return null;
  },
  outline: ([ox, oy], width = W, scale = 1) => {
    const [tw, th] = [width * scale, ((width * H) / W) * scale];
    const [cx, cy] = [ox + width / 2, oy + (width * H) / W / 2];
    return [
      [cx, cy - th / 2],
      [cx + tw / 2, cy],
      [cx, cy + th / 2],
      [cx - tw / 2, cy],
    ];
  },
  anchor: (d) => ANCHORS[d],
  edge: (d) => {
    const [a, b] = EDGE_ENDS[d]!;
    return [ANCHORS[a], ANCHORS[b]];
  },
  edgeMidpoint: (d) => {
    const [[ax, ay], [bx, by]] = isometric.edge(d);
    return [(ax + bx) / 2 - W / 2, (ay + by) / 2 - H / 2];
  },
  // The colony's tiles are a block of the square grid, which this view turns a quarter to the side, so its diagonal is
  // the screen's row.
  block: (col, row, size = 3) => [((size - 1 - col + row) * W) / 2, ((col + row) * H) / 2],
  blockSize: (size = 3) => [size * W, size * H],
};

/** The grid and the projection the map uses. */
export const mapGrid: Grid = staggered;
export const projection: Projection = isometric;
