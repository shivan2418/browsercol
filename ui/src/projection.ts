// The map's geometry, in one place (#524): which tile is next to which, where a tile is on the screen, and what shape it
// has there. Everything else that draws, hit-tests or lays out the map asks this module and never does the arithmetic
// on tile coordinates itself: no direction delta table, no diamond maths.
//
// Two interfaces, so that either can be swapped for another later without touching their users:
//  - a Grid, how the tiles are numbered and which are next to which (the square grid of #526, ADR 0014);
//  - a Projection, where a tile goes on the screen at zoom 1 and its outline (the Isometric view of #529: FreeCol's
//    128x64 diamonds, the whole map one big diamond).
// The exports at the bottom are the ones in use: `projection` stands for whichever of the two Projections, Isometric
// or Top-down (#530), the Map view is now on, and `setView` switches it.
//
// Two kinds of direction meet here. A *grid* direction is where a neighbour is in the grid: N is (0, -1), E is (1, 0).
// A *screen* direction is where it shows on the screen, which is what FreeCol's art is named by: in the Isometric view
// the diamond's NE face is the grid's N edge, its SE face the E edge, and so on, a turn of an eighth. Grid.neighbour
// takes a grid direction; everything that draws (roads, rivers, beaches, borders, fog) and the player's keys think in
// screen ones, and use `neighbourOnScreen` and Projection.inGrid.

// A map has a shape that fits the Map view the game is played in (#559, ADR 0014). A Top-down shaped map is the whole
// rectangle of the grid. An Isometric shaped one is a 45 degree diamond on the grid: the tiles whose screen column
// x - y and screen row x + y are in a range, which draws as a rectangle in the Isometric view. The map's w and h are
// the box round its tiles; the Engine leaves out the tiles in the box's corners. `shape` below says which kind the
// map shown is, and the Isometric view lays an Isometric shaped map out as that rectangle.

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** A tile's column and row. */
export type Tile = [number, number];
/** A point in map pixels, at zoom 1, or in a tile's box. */
export type Point = [number, number];

/** How the tiles are numbered and which are next to which. */
export interface Grid {
  /** All the directions a tile has a neighbour in, in FreeCol's order (Direction.values()). */
  readonly directions: readonly Direction[];
  /** The directions of the neighbours that share an edge with the tile, in the order river styles list them. */
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
}

/** Where a tile goes on the screen, at zoom 1, and its shape. */
export interface Projection {
  /** The size of a tile's box in map pixels. */
  readonly tile: { readonly w: number; readonly h: number };
  /**
   * How far a unit slides on the screen in one full step's time, across and down: a step of a tile to a neighbour
   * takes the share of that its distance is. The Isometric view's is its tile's size (an edge step is half a tile
   * each way, so half a step); the Top-down view's is two tiles', so an edge step takes as long.
   */
  readonly stride: { readonly w: number; readonly h: number };
  /**
   * Whether a settlement's name and label sit inside the tile, along its bottom edge, rather than straddling it: the
   * Isometric diamond's corners leave room below it, a square tile has none.
   */
  readonly labelsInside: boolean;
  /** The middle of a tile's box, in the box. */
  readonly middle: Point;
  /**
   * How far a point in a tile's box is from the middle of the tile's shape: 0 at the middle, 1 on its outline, more
   * beyond it.
   */
  inset(u: number, v: number): number;
  /** An offset on the screen, as it is seen from above, which the view squashes down the screen. */
  fromAbove(dx: number, dy: number): Point;
  /**
   * Where a tile's box starts on the whole map. `rows` is the map's height: a view that turns the map puts its first
   * tile at a place that depends on it, so that no tile has a negative place.
   */
  origin(x: number, y: number, rows: number): Point;
  /** The middle of a tile's box on the whole map. */
  centre(x: number, y: number, rows: number): Point;
  /** The whole map's size in map pixels. */
  mapSize(w: number, h: number): Point;
  /**
   * The box in map pixels (left, top, right, bottom) round the tiles from column x0, row y0 to column x1, row y1 and
   * the tiles near them, which a change to them may change the look of: their neighbours and a beach two tiles away.
   */
  neighbourhood(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rows: number,
  ): [left: number, top: number, right: number, bottom: number];
  /** The tile whose shape holds a point of the whole map, or null off the map. */
  tileAt(w: number, h: number, px: number, py: number): Tile | null;
  /** The point nearest a point of the whole map that the camera may be centred on: one on the map's own shape. */
  keepOn(w: number, h: number, p: Point): Point;
  /** How far down the map's rows a point of the whole map is: 0 at the top edge of the first row, 1 at the last row's end. */
  rowFraction(h: number, px: number, py: number): number;
  /** Calls `f` with each tile of a w by h map, in the order they are drawn: each is drawn over those before it. */
  eachTile(w: number, h: number, f: (x: number, y: number) => void): void;
  /** The screen directions of the tile's faces (the ones that share a side with a neighbour), in river style order. */
  readonly faces: readonly Direction[];
  /** Whether a screen direction is a face. */
  isFace(d: Direction): boolean;
  /** The screen direction in which the neighbour in a grid direction shows. */
  onScreen(d: Direction): Direction;
  /** The grid direction of the neighbour that shows in a screen direction. */
  inGrid(d: Direction): Direction;
  /**
   * The corners of a tile's shape, going round it, for a box `width` pixels wide at `origin` (the tile's own box
   * by default), the shape shrunk to `scale` of it about its middle.
   */
  outline(origin: Point, width?: number, scale?: number): Point[];
  /** Where the middle of the edge shared with the neighbour in a face's direction is, from the tile's middle. */
  edgeMidpoint(d: Direction): Point;
  /** The point of a tile's box a road or a river leaves it by, in a screen direction. */
  anchor(d: Direction): Point;
  /** The two ends, in the tile's box, of the side it shares with its neighbour in a face's direction. */
  edge(d: Direction): [Point, Point];
  /** Where the box of the tile at column `col`, row `row` of a square block of `size` tiles starts, in the block. */
  block(col: number, row: number, size?: number): Point;
  /** How big a block of `size` tiles is, from its top. */
  blockSize(size?: number): Point;
}

/** The outline of the map: the whole grid, or the diamond of FreeCol's staggered maps. */
export interface MapShape {
  kind: 'topDown' | 'isometric';
  /** An Isometric shape's half-height rows (a row is half a tile high on the screen), else 0. */
  rows: number;
}

const TOP_DOWN_SHAPE: MapShape = { kind: 'topDown', rows: 0 };
let shape: MapShape = TOP_DOWN_SHAPE;

/** The shape of the map shown. */
export const mapShape = (): MapShape => shape;
/** Set the shape of the map shown, when a game's map arrives. Returns whether it changed. */
export const setMapShape = (next: Partial<MapShape> | null | undefined): boolean => {
  const n: MapShape =
    next?.kind === 'isometric' && (next.rows ?? 0) > 0 ? { kind: 'isometric', rows: next.rows! } : TOP_DOWN_SHAPE;
  const changed = n.kind !== shape.kind || n.rows !== shape.rows;
  shape = n;
  return changed;
};

/** The Map view a shape is made for: an Isometric shaped map is a rectangle on screen in the Isometric view. */
export const viewOfShape = (s: Pick<MapShape, 'kind'> | null | undefined): MapViewKind =>
  s?.kind === 'isometric' ? 'isometric' : 'topdown';

/** The tiles across an Isometric shape of a box `w` wide: the columns of its staggered map. */
const isoColumns = (w: number) => w - (shape.rows >> 1);

/**
 * Whether column x, row y of a w by h box is a tile of the map. An Isometric shaped map's tile (x, y) is column
 * x - ((r + 1) >> 1) of the staggered row r = x + y - (columns - 1): the staggered map's tile, in the diamond.
 */
export const inShape = (w: number, h: number, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (shape.kind !== 'isometric') return true;
  const columns = isoColumns(w);
  const row = x + y - (columns - 1);
  const col = x - ((row + 1) >> 1);
  return row >= 0 && row < shape.rows && col >= 0 && col < columns;
};

/**
 * Whether the Isometric view lays the map out as a rectangle on the screen: it does for an Isometric shaped map, and
 * only then (a Top-down shaped map is a big diamond there, and an Isometric shaped one a diamond in Top-down).
 */
const flat = () => kind === 'isometric' && shape.kind === 'isometric';
/**
 * Where the Isometric view's rectangle starts in the box's own diamond layout: the tiles of an Isometric shaped map
 * are those with screen column x - y from 1 - columns to columns and screen row x + y from columns - 1, which in
 * the box w by h (rows = h) puts the rectangle's left edge at (h - columns) tile half-widths and its top at
 * (columns - 1) half-heights.
 */
const flatOffset = (h: number): Point => {
  const columns = h - ((shape.rows - 1) >> 1);
  return [(h - columns) * (W / 2), (columns - 1) * (H / 2)];
};

const DIRECTIONS: readonly Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** FreeCol's Direction since #526 (ADR 0014): the same step in every row. */
const STEPS: Record<Direction, Point> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
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
const EDGES: readonly Direction[] = ['N', 'E', 'S', 'W'];

/** FreeCol's map since #526: a square grid, the same eight neighbours at the same offsets in every row. */
export const square: Grid = {
  directions: DIRECTIONS,
  edges: EDGES,
  corners: ['NE', 'SE', 'SW', 'NW'],
  neighbour: (x, y, d) => [x + STEPS[d][0], y + STEPS[d][1]],
  opposite: (d) => OPPOSITE[d],
  isEdge: (d) => EDGES.includes(d),
  edgeIndex: (d) => EDGES.indexOf(d),
  lattice: (x, y) => [x, y],
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

/** The diamond's faces, as screen directions: those of the grid's edge neighbours N, E, S and W, in that order. */
const FACES: readonly Direction[] = ['NE', 'SE', 'SW', 'NW'];

/**
 * The Isometric view of the square grid: each tile one of FreeCol's 128x64 diamonds, the grid turned an eighth so that
 * east is down to the right and south down to the left, and the whole map one big diamond. Tile (x, y)'s box is at
 * ((x - y + rows - 1) * W/2, (x + y) * H/2): the first tile at the top, the first row's last tile at the right and
 * the first column's last at the left.
 */
export const isometric: Projection = {
  tile: { w: W, h: H },
  stride: { w: W, h: H },
  labelsInside: false,
  origin: (x, y, rows) => {
    const [dx, dy] = flat() ? flatOffset(rows) : [0, 0];
    return [(x - y + rows - 1) * (W / 2) - dx, (x + y) * (H / 2) - dy];
  },
  centre: (x, y, rows) => {
    const [ox, oy] = isometric.origin(x, y, rows);
    return [ox + W / 2, oy + H / 2];
  },
  middle: [W / 2, H / 2],
  inset: (u, v) => Math.abs(u - W / 2) / (W / 2) + Math.abs(v - H / 2) / (H / 2),
  fromAbove: (dx, dy) => [dx, dy * 2],
  neighbourhood: (x0, y0, x1, y1, rows) => {
    // Three tiles round, which reach a beach two tiles away and the art taller than its tile.
    const reach = 3;
    return [
      isometric.origin(x0 - reach, y1 + reach, rows)[0],
      isometric.origin(x0 - reach, y0 - reach, rows)[1] - H,
      isometric.origin(x1 + reach, y0 - reach, rows)[0] + W,
      isometric.origin(x1 + reach, y1 + reach, rows)[1] + H,
    ];
  },
  mapSize: (w, h) =>
    flat()
      ? // The rectangle of an Isometric shaped map: its columns of tile widths and a half more, its rows of half tiles
        // and a half more.
        [isoColumns(w) * W + W / 2, ((shape.rows + 1) * H) / 2]
      : [((w + h) * W) / 2, ((w + h) * H) / 2],
  tileAt: (w, h, px, py) => {
    // With a = x and b = y as continuous coordinates, a tile's diamond is where both are within half a tile of it.
    const [ox, oy] = flat() ? flatOffset(h) : [0, 0];
    const p = (px + ox) / (W / 2) - h;
    const q = (py + oy) / (H / 2) - 1;
    const [x, y] = [Math.floor((p + q) / 2 + 0.5), Math.floor((q - p) / 2 + 0.5)];
    return inShape(w, h, x, y) ? [x, y] : null;
  },
  keepOn: (w, h, [px, py]) => {
    const [mw, mh] = isometric.mapSize(w, h);
    // A rectangle on the screen: the camera stays inside it.
    if (flat()) return [Math.min(mw, Math.max(0, px)), Math.min(mh, Math.max(0, py))];
    const out = Math.abs(px - mw / 2) / (mw / 2) + Math.abs(py - mh / 2) / (mh / 2);
    return out <= 1 ? [px, py] : [mw / 2 + (px - mw / 2) / out, mh / 2 + (py - mh / 2) / out];
  },
  rowFraction: (h, px, py) => {
    // A rectangle has its rows across it: the top edge is the north pole and the bottom edge the south pole.
    if (flat()) return Math.min(1, Math.max(0, py / (((shape.rows + 1) * H) / 2)));
    // The row is the continuous coordinate b = (q - p) / 2 of tileAt, from -0.5 to h - 0.5.
    const [p, q] = [px / (W / 2) - h, py / (H / 2) - 1];
    return Math.min(1, Math.max(0, (q - p) / 2 + 0.5) / h);
  },
  eachTile: (w, h, f) => {
    // Along the diagonals x + y, back to front, each from west to east: what a tile's art covers is drawn before it.
    for (let s = 0; s < w + h - 1; s++) {
      for (let x = Math.max(0, s - h + 1); x <= Math.min(w - 1, s); x++) if (inShape(w, h, x, s - x)) f(x, s - x);
    }
  },
  faces: FACES,
  isFace: (d) => FACES.includes(d),
  onScreen: (d) => DIRECTIONS[(DIRECTIONS.indexOf(d) + 1) % 8],
  inGrid: (d) => DIRECTIONS[(DIRECTIONS.indexOf(d) + 7) % 8],
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
  // The colony's tiles are a block of the grid, laid out as the map lays its tiles out: east of the middle one is down
  // to the right of it.
  block: (col, row, size = 3) => [((size - 1 + col - row) * W) / 2, ((col + row) * H) / 2],
  blockSize: (size = 3) => [size * W, size * H],
};

/** A tile's side in the Top-down view, in map pixels. The art for it is 64x64 (#530). */
export const T = 64;

/**
 * The Top-down view of the square grid (#530): each tile a 64x64 square, north up, the whole map a rectangle. A screen
 * direction is a grid direction: there is no turn between them.
 */
export const topDown: Projection = {
  tile: { w: T, h: T },
  stride: { w: 2 * T, h: 2 * T },
  labelsInside: true,
  origin: (x, y) => [x * T, y * T],
  centre: (x, y) => [x * T + T / 2, y * T + T / 2],
  middle: [T / 2, T / 2],
  inset: (u, v) => Math.max(Math.abs(u - T / 2), Math.abs(v - T / 2)) / (T / 2),
  fromAbove: (dx, dy) => [dx, dy],
  neighbourhood: (x0, y0, x1, y1) => {
    // Three tiles round, as in the Isometric view: a beach two tiles away and the art taller than its tile.
    const reach = 3;
    return [(x0 - reach) * T, (y0 - reach) * T, (x1 + reach + 1) * T, (y1 + reach + 1) * T];
  },
  mapSize: (w, h) => [w * T, h * T],
  tileAt: (w, h, px, py) => {
    const [x, y] = [Math.floor(px / T), Math.floor(py / T)];
    return inShape(w, h, x, y) ? [x, y] : null;
  },
  keepOn: (w, h, [px, py]) => [Math.min(w * T, Math.max(0, px)), Math.min(h * T, Math.max(0, py))],
  rowFraction: (h, _px, py) => Math.min(1, Math.max(0, py / (h * T))),
  eachTile: (w, h, f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inShape(w, h, x, y)) f(x, y);
  },
  faces: EDGES,
  isFace: (d) => EDGES.includes(d),
  onScreen: (d) => d,
  inGrid: (d) => d,
  outline: ([ox, oy], width = T, scale = 1) => {
    const s = width * scale;
    const [x0, y0] = [ox + (width - s) / 2, oy + (width - s) / 2];
    return [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
    ];
  },
  anchor: (d) => {
    const [dx, dy] = STEPS[d];
    return [(T / 2) * (1 + dx), (T / 2) * (1 + dy)];
  },
  edge: (d) => {
    const [dx, dy] = STEPS[d];
    // The side in a direction: its middle is half a tile that way, and it runs across.
    const [cx, cy] = [(T / 2) * (1 + dx), (T / 2) * (1 + dy)];
    return dx === 0
      ? [
          [0, cy],
          [T, cy],
        ]
      : [
          [cx, 0],
          [cx, T],
        ];
  },
  edgeMidpoint: (d) => [(T / 2) * STEPS[d][0], (T / 2) * STEPS[d][1]],
  block: (col, row) => [col * T, row * T],
  blockSize: (size = 3) => [size * T, size * T],
};

/** The Map views: the Isometric one (FreeCol's own, the default) and the Top-down one (#530). */
export type MapViewKind = 'isometric' | 'topdown';
const VIEWS: Record<MapViewKind, Projection> = { isometric, topdown: topDown };
let kind: MapViewKind = 'isometric';

/** The Map view the map is on now. */
export const currentView = (): MapViewKind => kind;
/**
 * Switch the Map view. What was worked out with the old projection (the camera, the scenes, the pictures made) is the
 * caller's to make again: see switchView in view.ts.
 */
export const setView = (next: MapViewKind): void => {
  kind = next;
};

/** The grid and the projection the map uses; `projection` is whichever Map view is on, and changes when it is switched. */
export const mapGrid: Grid = square;
export const projection: Projection = new Proxy({} as Projection, {
  get: (_, key) => VIEWS[kind][key as keyof Projection],
});

/** The top of a text `size` high that names a settlement, on the tile whose box starts at `oy`: below it, or inside its bottom edge. */
export const nameTop = (oy: number, size: number): number =>
  oy + projection.tile.h - (projection.labelsInside ? size + 2 : 0);
/** The top of a settlement's label box `height` high: across the tile's bottom edge, or inside it. */
export const boxTop = (oy: number, height: number): number =>
  oy + projection.tile.h - (projection.labelsInside ? height : height / 2);

/** The tile next to (x, y) in a screen direction: where a road, river or picture named for that direction leads. */
export const neighbourOnScreen = (x: number, y: number, d: Direction): Tile =>
  mapGrid.neighbour(x, y, projection.inGrid(d));

/** A closed shape's corners as a path on a pen with moveTo and lineTo; `close` goes back to the first corner. */
export const tracePath = (
  pen: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void },
  pts: Point[],
  close = false,
) => (close ? [...pts, pts[0]] : pts).forEach((pt, i) => (i ? pen.lineTo(...pt) : pen.moveTo(...pt)));
