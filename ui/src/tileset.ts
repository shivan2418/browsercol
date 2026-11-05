// Tileset mode: the client Engine's map (MapJson.java) turned into a list of
// draw operations in the order FreeCol's MapViewer paints, with the images
// its ImageLibrary would pick, at FreeCol's default "normal" graphics
// quality, with the animated water and rivers at the frame it is told. FreeCol makes
// some images by masking others (terrain transitions, beaches, rivers);
// those come as a Recipe that map.ts composites and caches by id.
import { MAP_KEY_FAMILIES, MAP_KEYS } from './map-keys';
import type { Resources } from './resources';
import type { Cursor } from './view';

export interface TileType {
  id: string;
  land: boolean;
  forested: boolean;
  name: string;
}

/** The client's view of the map, as MapJson.java writes it. */
export interface MapView {
  w: number;
  h: number;
  turn: string;
  /** The season and year of the turn, e.g. Spring 1493. */
  turnLabel: string;
  ourTurn: boolean;
  /** Whether the player is still colonial: not a rebel, an independent nation or retired. */
  colonial: boolean;
  /** Whether the player still has a Europe: it goes with independence. */
  europe: boolean;
  /** The id of the player's nation, e.g. model.nation.dutch. */
  nation: string;
  /** FreeCol's status line: the score, the gold, the tax and the year. */
  statusLine: string;
  types: TileType[];
  /** One character per tile: 'A' + type index, '.' if unexplored. */
  tiles: string;
  /** One character per tile: '1' if the player can see it now. */
  seen: string;
  /** Whether the tiles the player cannot see are greyed: the game's fog of war and the display fog of war option. */
  fog?: boolean;
  /** One character per tile: 'A' + regionNames index, '.' if unexplored or in no region. */
  regions?: string;
  regionNames?: string[];
  /** One character per tile: 'A' + players index, '.' if unexplored or nobody's. */
  owners: string;
  /** The tile owners: the nation's name and colour. */
  players: { name: string; rgb: number }[];
  /** [x, y, magnitude, style, forest mask]; style digits face NE, SE, SW, NW. */
  rivers: [number, number, number, string, string][];
  /** [x, y, zIndex] per complete road. */
  roads: [number, number, number][];
  /** [x, y, zIndex, kind, key] in zIndex order per tile. */
  items: [number, number, number, 'centered' | 'tile', string][];
  settlements: Settlement[];
  units: Unit[];
  active: [number, number] | null;
  activeUnit: ActiveUnit | null;
}

/** A step of a path: its tile and the turns to get there, or null off the map. */
export type PathStep = [number, number, number] | null;

/** What FreeCol's InfoPanel shows of the active unit, and its way to its destination. */
export interface ActiveUnit {
  id: string;
  label: string;
  /** Moves left, as FreeCol writes them, e.g. "1 2/3". */
  moves: string;
  /** The units and goods aboard. */
  cargo: string[];
  /** [x, y, turns] per step to the destination (null for a step off the map, e.g. Europe), or null without one. */
  path: PathStep[] | null;
}

export interface Settlement {
  x: number;
  y: number;
  /** Resource keys, most specific first. */
  keys: string[];
  /** The owner's colour. */
  rgb: number;
  /** The name as the player knows it. */
  name: string;
  /** -1 for native settlements. */
  population: number;
  /** The production bonus. */
  bonus: number;
  /** The preferred size change. */
  sizeChange: number;
  /** Null for colonies. */
  chips: Chips | null;
  /** The label text's colour on the owner's colour (ImageLibrary.makeForegroundColor). */
  fg?: number;
  /** Whether it is the player's own. */
  own?: boolean;
  /** For the player's own colony, what it builds and in how many turns, as the modern labels show it. */
  building?: string | null;
}

/** The unit MapViewer shows in front on a tile. */
export interface Unit {
  x: number;
  y: number;
  /** Resource keys, most specific first. */
  keys: string[];
  /** The owner's colour. */
  rgb: number;
  /** The occupation chip's text. */
  chip: string;
  /** The chip text's colour. */
  fg: number;
  /** Units on the tile. */
  stack: number;
  /** Drawn in grayscale: sentried, or out of sight. */
  fade: boolean;
}

/** What a native settlement's chips show; the alarm chip once the player has made contact. */
export interface Chips {
  capital: boolean;
  /** The settlement chip's text colour on the owner's. */
  fg: number;
  mission: { rgb: number; expert: boolean } | null;
  alarm: { fg: number; worthScouting: boolean } | null;
}

/** An image file, or one made by drawing others in order onto a tile-sized canvas. */
export type Src = string | Recipe;
export interface Recipe {
  /** Same id, same image: map.ts's cache key. */
  id: string;
  steps: Step[];
}
/** Draw an image (scaled about the centre if asked), or keep only where a mask is opaque. */
export type Step = { draw: Src; alpha?: number; scale?: number } | { mask: Src };

/**
 * Where an image sits on its tile, as TileViewer and MapViewer place it:
 * at the top left, bottom-aligned (overlays and forests, taller than a tile),
 * centred, centred but not reaching below the tile (settlements), or centred
 * and raised (units).
 */
export type Anchor = 'tile' | 'bottom' | 'center' | 'large' | 'unit';

export type Op =
  | {
      k: 'image';
      x: number;
      y: number;
      src: Src;
      at: Anchor;
      dim?: true;
      fade?: true;
      marker?: true;
      /** One of the animated base tiles' (MapViewer paints them first, below the rest), which animatedBase draws again. */
      base?: true;
    }
  /** FreeCol's fog of war: 20% black over the tile's diamond. */
  | { k: 'fog'; x: number; y: number }
  /** A road to the neighbours with roads (RoadPainter), in color.map.road. */
  | { k: 'road'; x: number; y: number; dirs: Direction[]; color: number }
  /** A unit's occupation chip in its owner's colour, with a line per unit on the tile. */
  | { k: 'chip'; x: number; y: number; text: string; bg: number; fg: number; stack: number }
  /** A native settlement's chips in a row beside it, each the first chip's width plus 2 along, as TileViewer spaces them. */
  | { k: 'chips'; x: number; y: number; chips: { text: string; bg: number; fg: number }[]; dim?: true }
  /**
   * A colony's population in the tile's centre, in its production bonus's
   * color.map.productionBonus.N, and emphasised when the colony would rather grow.
   */
  | { k: 'population'; x: number; y: number; population: number; color: number; emph?: true; dim?: true }
  /** A settlement's name below the tile, in the owner's colour. */
  | { k: 'label'; x: number; y: number; name: string; rgb: number; dim?: true }
  /**
   * MapViewer's modern settlement label, across the tile's bottom edge: the name (and what the player's colony
   * builds) on the owner's colour at half alpha, with the population (italic when the colony would rather grow)
   * or a capital's star on its left, and the production bonus or the mission's cross on its right.
   */
  | {
      k: 'modernLabel';
      x: number;
      y: number;
      lines: string[];
      rgb: number;
      fg: number;
      left: { text: string; italic: boolean } | { capital: true } | null;
      right: { text: string } | { mission: { rgb: number; fg: number; expert: boolean } } | null;
      dim?: true;
    }
  /** A step of the active unit's path, centre to centre: green, or yellow if it ends on a later turn. */
  | { k: 'pathLine'; x: number; y: number; to: [number, number]; turns: number }
  /** A path step's mark in the tile's centre, with the turns to get there if any. */
  | { k: 'pathMark'; x: number; y: number; turns: number }
  /** The View menu's map grid: the tile's outline. */
  | { k: 'grid'; x: number; y: number }
  /** The View menu's borders: the sides of an owned tile (NE, SE, SW, NW) that face another owner, in the owner's colour. */
  | { k: 'border'; x: number; y: number; sides: Direction[]; rgb: number }
  /** The tile text option: the tile type's name, its owner or its region, in the tile's centre. */
  | { k: 'tileName'; x: number; y: number; name: string }
  /** The Debug menu's text over a tile (coordinates, colony value, AI missions): a line each, centred on the tile. */
  | { k: 'debugText'; x: number; y: number; lines: string[] }
  /** The Debug menu's AI defence map: a tile tinted in a colour. */
  | { k: 'tint'; x: number; y: number; rgb: number };

/** FreeCol's colony labels option: none, classic (the population in the settlement, the name below) or modern. */
export type ColonyLabels = 0 | 1 | 2;

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** FreeCol's Direction: [dx, dy] on odd rows, then on even rows. */
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
export const DIRECTIONS = Object.keys(STEPS) as Direction[];
const LONG_SIDES: Direction[] = ['NE', 'SE', 'SW', 'NW'];
const REVERSE: Record<Direction, Direction> = {
  N: 'S',
  NE: 'SW',
  E: 'W',
  SE: 'NW',
  S: 'N',
  SW: 'NE',
  W: 'E',
  NW: 'SE',
};

// The map's resource keys, from map-keys.ts, where the families the map
// draws live: the prefixes are the ones build-art.mjs copies the art of,
// so a key the map draws is never missing from the site.
const {
  tile: TILE,
  tileOverlay: TILE_OVERLAY,
  tileForest: TILE_FOREST,
  aboveTile: ABOVE_TILE,
  mask: MASK,
  productionBonus: PRODUCTION_BONUS,
  mission: MISSION,
  settlementChip: SETTLEMENT_CHIP,
  alarmChip: ALARM_CHIP,
} = MAP_KEY_FAMILIES;
const { tileMask: TILE_MASK, road: ROAD, cross: CROSS } = MAP_KEYS;

const BEACH = `${TILE}model.tile.beach`;
const RIVER_WATER = `${TILE}river.water`;
const RIVER_PEBBLES = `${TILE}river.pebbles`;
const UNEXPLORED = 'model.tile.unexplored';
/** ImageLibrary.getMissionChip's text colours if the Tileset has none: Java's Color.GRAY and BLACK. */
const MISSION_FG = { normal: 0x808080, expert: 0x000000 };

/** ImageLibrary.variationSeedUsing. */
const seedOf = (x: number, y: number) => x * 6841 + y * 7919;
const lower = (ds: Direction[]) =>
  ds
    .map((d) => d.toLowerCase())
    .sort()
    .join('_');
const terrainKey = (id: string) => `${TILE}${id}.center`;

/** What draws a unit on its tile: its image, the first of its keys the art has, then its occupation chip. */
export function unitOps(u: Unit, res: Resources): Op[] {
  const { x, y, rgb, chip, fg, stack, fade } = u;
  const key = u.keys.find((k) => res.has(k));
  const ops: Op[] = [];
  if (key) ops.push({ k: 'image', x, y, src: res.path(key)!, at: 'unit', ...(fade ? { fade: true as const } : {}) });
  ops.push({ k: 'chip', x, y, text: chip, bg: rgb, fg, stack });
  return ops;
}

/**
 * The frames of the terrain animations, in ticks (TileViewer counts 125 ms as one): water, which is the
 * ocean and its beaches, and rivers, with the deltas. The first frame, 0, is the still map.
 */
export interface Ticks {
  water: number;
  river: number;
}

/** Which of the terrain animates: none, the water, or the water and the rivers too. */
export type TerrainAnimation = 'off' | 'water' | 'all';

/** The terrain's animation frame time in milliseconds, TileViewer's. */
export const TICK_MS = 125;

/** Still water and rivers: the first frame. */
export const STILL: Ticks = { water: 0, river: 0 };

/** The animated base tiles of the scene at some frame: what animates, and nothing else. */
export const animatedBase = (map: MapView, res: Resources, ticks: Ticks): Op[] => scene(map, res, 1, ticks, true);

/**
 * The map's draw operations.
 *
 * @param ticks The frame of the animated water and rivers.
 * @param baseOnly Only the animated base tiles, which come first, marked `base`.
 */
export function scene(
  map: MapView,
  res: Resources,
  colonyLabels: ColonyLabels = 1,
  ticks: Ticks = STILL,
  baseOnly = false,
): Op[] {
  const { w, h } = map;
  const ops: Op[] = [];

  /** A tile's place in the row-major per-tile strings and lookups. */
  const index = (x: number, y: number) => y * w + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const step = (x: number, y: number, d: Direction): [number, number] | null => {
    const s = STEPS[d];
    const [nx, ny] = y % 2 ? [x + s[0], y + s[1]] : [x + s[2], y + s[3]];
    return inside(nx, ny) ? [nx, ny] : null;
  };
  const typeAt = (x: number, y: number): TileType | null => {
    const c = map.tiles.charCodeAt(index(x, y)) - 65;
    return c >= 0 ? map.types[c] : null;
  };
  const explored = (p: [number, number] | null) => !!p && typeAt(...p) !== null;
  /** Tile.isLand: unexplored tiles have no type, so are not land. */
  const land = (p: [number, number] | null) => !!p && !!typeAt(...p)?.land;
  /** Drawn as seen: in sight, or anywhere when the fog of war does not show. */
  const seen = (x: number, y: number) => map.fog === false || map.seen[index(x, y)] === '1';

  const rivers = new Map<number, { magnitude: number; style: string; mask: string }>();
  for (const [x, y, magnitude, style, mask] of map.rivers) rivers.set(index(x, y), { magnitude, style, mask });
  const riverAt = (p: [number, number] | null) => (p ? rivers.get(index(...p)) : undefined);
  const roads = new Set(map.roads.map(([x, y]) => index(x, y)));

  const first = (keys: string[]) => keys.find((k) => res.has(k));

  /** Image with its alpha cut to a mask (ImageUtils.imageWithAlphaFromMask). */
  const masked = (img: Src, mask: Src): Recipe => ({
    id: `mask:${srcId(img)}:${srcId(mask)}`,
    steps: [{ draw: img }, { mask }],
  });

  /** ImageResource.getVariationNumberForTick: the frame of an animation's art. */
  const frame = (key: string, tick: number) => tick % res.variations(key);

  // BeachTileAnimationImageCreator: the beach, with the ocean over it except
  // where the mask for the land sides cuts it away, and over that again by an
  // alpha that goes up and down with the frame.
  const beachKey = (dirs: Direction[]) => {
    const pre = lower(dirs.filter((d) => LONG_SIDES.includes(d)));
    return lower(dirs.filter((d) => LONG_SIDES.includes(d) || pre === '' || !pre.includes(d.toLowerCase())));
  };
  const water = (x: number, y: number, type: TileType): Src | null => {
    const n = frame(terrainKey(type.id), ticks.water);
    const ocean = res.path(terrainKey(type.id), n);
    if (!ocean) return null;
    const dirs = DIRECTIONS.filter((d) => land(step(x, y, d)));
    const key = beachKey(dirs);
    const beach = res.path(BEACH);
    const mask = res.path(`${MASK}beach.${key}`);
    const tileMask = res.path(TILE_MASK);
    if (dirs.length === 0 || !beach || !mask || !tileMask) return ocean;
    const over = masked(ocean, mask);
    const alpha = 0.05 * (n <= 10 ? n : 10 - (n - 10));
    return {
      id: `beach:${ocean}:${key}`,
      steps: [{ draw: beach }, { draw: over }, ...(alpha > 0 ? [{ draw: over, alpha }] : []), { mask: tileMask }],
    };
  };

  // BaseTileTransitionImageCreator at normal quality: nice corners, no mask variations.
  const transition = (x: number, y: number, d: Direction, nice: boolean): Recipe | null => {
    const tile: [number, number] = [x, y];
    const b = step(x, y, d);
    if (!b || !explored(b) || !explored(tile)) return null;
    const type = typeAt(x, y)!;
    const btype = typeAt(...b)!;
    const special = nice && (d === 'NW' || d === 'SE');
    if (type === btype && !special) return null;
    const imageKey = land(b) || !land(tile) ? terrainKey(btype.id) : BEACH;
    const image = res.path(imageKey);
    const own = res.path(terrainKey(type.id));
    const mask = res.path(`${MASK}${d.toLowerCase()}`);
    if (!image || !own || !mask) return null;
    if (image === own && !special) return null;
    const src = res.path(imageKey, 0)!;
    if (!special) return { id: `transition:${image}:${mask}`, steps: [{ draw: src }, { mask }] };

    const beachNe = specialBeach(tile, b, 'NE');
    const beachSw = specialBeach(tile, b, 'SW');
    const steps: Step[] = [];
    if (land(tile) || land(b)) steps.push({ draw: src });
    else {
      for (const [on, dir] of [
        [beachNe, 'ne'],
        [beachSw, 'sw'],
      ] as const) {
        const beach = res.path(BEACH, 0);
        const beachMask = res.path(`${MASK}special.beach.${dir}`);
        if (on && beach && beachMask) steps.push({ draw: masked(beach, beachMask) });
      }
    }
    for (const t of [transition(...b, 'NE', false), transition(...b, 'SW', false)]) if (t) steps.push({ draw: t });
    steps.push({ mask });
    const ne = step(...b, 'NE');
    const sw = step(...b, 'SW');
    const id = [image, ne ? typeAt(...ne)?.id : null, sw ? typeAt(...sw)?.id : null, beachNe, beachSw, mask];
    return { id: `corner:${id.join(':')}`, steps };
  };
  const specialBeach = (tile: [number, number], b: [number, number], d: Direction) =>
    !land(tile) && !land(b) && (land(step(...tile, d)) || land(step(...b, d)));
  const transitions = (x: number, y: number) => {
    for (const d of ['NE', 'SW', 'NW', 'SE'] as Direction[]) {
      const t = transition(x, y, d, true);
      if (t) ops.push({ k: 'image', x, y, src: t, at: 'tile' });
    }
  };

  // TileViewer.hasRiverDelta: water with a river flowing in from the land.
  const deltas = (x: number, y: number): Direction[] =>
    land([x, y]) || !explored([x, y])
      ? []
      : LONG_SIDES.filter((d) => {
          const b = step(x, y, d);
          const river = land(b) ? riverAt(b) : undefined;
          return !!river && Number(river.style[LONG_SIDES.indexOf(REVERSE[d])] ?? 0) > 0;
        });
  // DeltaAnimationImageCreator.
  const delta = (d: Direction): Recipe | null => {
    const dir = d.toLowerCase();
    const [pebbles, waterImg, waterMask, pebblesMask, tileMask] = [
      res.path(RIVER_PEBBLES),
      res.path(RIVER_WATER, frame(RIVER_WATER, ticks.river)),
      res.path(`${MASK}river.delta.${dir}`),
      res.path(`${MASK}river.delta.pebbles.${dir}`),
      res.path(TILE_MASK),
    ];
    if (!pebbles || !waterImg || !waterMask || !pebblesMask || !tileMask) return null;
    return {
      id: `delta:${waterImg}:${dir}`,
      steps: [
        { draw: masked(pebbles, pebblesMask) },
        { draw: masked(waterImg, waterMask), alpha: 0.9 },
        { mask: tileMask },
      ],
    };
  };

  // RiverAnimationImageCreator: river water and pebbles in
  // the shape of the river's mask, fading out at a slightly larger mask.
  const river = (x: number, y: number): Recipe | null => {
    const r = riverAt([x, y])!;
    const conns = LONG_SIDES.filter((_, i) => r.style[i] !== '0');
    const shape = lower(conns);
    const minor = r.magnitude <= 1 ? '.minor' : '';
    const toMajor =
      r.magnitude > 1
        ? []
        : conns.filter((d) => {
            const n = step(x, y, d);
            return !!n && ((riverAt(n)?.magnitude ?? 0) > 1 || (land([x, y]) && !land(n)));
          });
    const [pebbles, waterImg, base, tileMask] = [
      res.path(RIVER_PEBBLES),
      res.path(RIVER_WATER, frame(RIVER_WATER, ticks.river)),
      res.path(`${MASK}river${minor}${shape ? '.' + shape : ''}`),
      res.path(TILE_MASK),
    ];
    if (!pebbles || !waterImg || !base || !tileMask) return null;
    const extra = toMajor.map((d) => res.path(`${MASK}river.to_major.${d.toLowerCase()}`)).filter((m) => m !== null);
    const mask: Src = extra.length
      ? { id: `riverMask:${base}:${extra.join(',')}`, steps: [base, ...extra].map((m) => ({ draw: m })) }
      : base;
    const larger: Recipe = {
      id: `larger:${srcId(mask)}`,
      steps: [{ draw: mask, scale: 1.25 }, { draw: mask }],
    };
    return {
      id: `river:${waterImg}:${srcId(mask)}`,
      steps: [{ draw: pebbles }, { draw: masked(waterImg, mask), alpha: 0.9 }, { mask: larger }, { mask: tileMask }],
    };
  };

  const each = (f: (x: number, y: number) => void) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f(x, y);
  };
  const terrain = (x: number, y: number, type: TileType | null) => {
    const src = res.forSeed(terrainKey(type?.id ?? UNEXPLORED), seedOf(x, y));
    if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
  };
  const animated = (x: number, y: number) => {
    const type = typeAt(x, y);
    return !!type && (!type.land || !!riverAt([x, y]));
  };

  // MapViewer paints the animated base tiles below the rest: water with its
  // beaches and deltas, and land with a river.
  each((x, y) => {
    const type = typeAt(x, y);
    if (!type) return;
    if (!type.land) {
      const src = water(x, y, type);
      if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
      const ds = deltas(x, y);
      if (ds.length) transitions(x, y);
      for (const d of ds) {
        const src = delta(d);
        if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
      }
    } else if (riverAt([x, y])) {
      terrain(x, y, type);
      transitions(x, y);
      const src = river(x, y);
      if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
    }
  });
  for (const op of ops) if (op.k === 'image') op.base = true;
  if (baseOnly) return ops;
  each((x, y) => {
    if (!animated(x, y)) terrain(x, y, typeAt(x, y));
  });
  each((x, y) => {
    if (explored([x, y]) && !riverAt([x, y]) && !deltas(x, y).length) transitions(x, y);
  });
  each((x, y) => {
    if (explored([x, y]) && !seen(x, y)) ops.push({ k: 'fog', x, y });
  });
  each((x, y) => {
    if (!explored([x, y])) return;
    for (const d of DIRECTIONS) {
      const n = step(x, y, d);
      if (!n || explored(n)) continue;
      const src = res.forSeed(`${TILE}${UNEXPLORED}.border.${d}`, seedOf(x, y));
      if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
    }
  });

  // TileViewer.displayTileItems and the settlement, per explored tile.
  const itemsAt = new Map<number, { z: number; op: () => void }[]>();
  const addItem = (x: number, y: number, z: number, op: () => void) => {
    const i = index(x, y);
    itemsAt.set(i, [...(itemsAt.get(i) ?? []), { z, op }]);
  };
  const roadColor = res.color(ROAD);
  for (const [x, y, z] of map.roads) {
    addItem(x, y, z, () =>
      ops.push({
        k: 'road',
        x,
        y,
        dirs: DIRECTIONS.filter((d) => {
          const n = step(x, y, d);
          return !!n && roads.has(index(...n));
        }),
        color: roadColor,
      }),
    );
  }
  for (const [x, y, z, kind, key] of map.items) {
    const src = res.path(key);
    const dim = seen(x, y) ? {} : { dim: true as const };
    if (src)
      addItem(x, y, z, () => ops.push({ k: 'image', x, y, src, at: kind === 'tile' ? 'tile' : 'center', ...dim }));
  }
  const settlements = new Map(map.settlements.map((s) => [index(s.x, s.y), s]));
  each((x, y) => {
    const type = typeAt(x, y);
    if (!type) return;
    const dim = seen(x, y) ? {} : { dim: true as const };
    const items = (itemsAt.get(index(x, y)) ?? []).sort((a, b) => a.z - b.z);
    const upTo = (z: number) => {
      while (items.length && items[0].z < z) items.shift()!.op();
    };
    upTo(100);
    const overlay = res.forSeed(`${TILE_OVERLAY}${type.id}`, seedOf(x, y));
    if (overlay) ops.push({ k: 'image', x, y, src: overlay, at: 'bottom', ...dim });
    upTo(200);
    if (type.forested) {
      const r = riverAt([x, y]);
      const styled = r && `${TILE_FOREST}${type.id}.s${r.mask === '0000' ? '0100' : r.mask}`;
      const src = res.path(styled && res.has(styled) ? styled : `${TILE_FOREST}${type.id}`);
      if (src) ops.push({ k: 'image', x, y, src, at: 'bottom', ...dim });
    }
    upTo(Infinity);
    const s = settlements.get(index(x, y));
    const key = s && first(s.keys);
    if (s && key) {
      ops.push({ k: 'image', x, y, src: res.path(key)!, at: 'large', ...dim });
      // TileViewer.displaySettlementWithChipsOrPopulationNumber: the number with classic labels, the chips
      // unless modern.
      const { rgb, population, bonus, sizeChange, chips } = s;
      const emph = sizeChange > 0 ? { emph: true as const } : {};
      const color = res.color(`${PRODUCTION_BONUS}${bonus}`);
      if (population >= 0 && colonyLabels === 1)
        ops.push({ k: 'population', x, y, population, color, ...emph, ...dim });
      if (chips && colonyLabels !== 2) ops.push({ k: 'chips', x, y, chips: nativeChips(rgb, chips), ...dim });
    }
  });

  // ImageLibrary's settlement, mission and alarm chips.
  function nativeChips(rgb: number, { capital, fg, mission, alarm }: Chips) {
    const chips = [{ text: res.string(`${SETTLEMENT_CHIP}${capital ? 'capital' : 'normal'}`), bg: rgb, fg }];
    if (mission) {
      const kind = mission.expert ? 'expert' : 'normal';
      const crossFg = res.color(`${MISSION}${kind}`, MISSION_FG[kind]);
      chips.push({ text: res.string(CROSS), bg: mission.rgb, fg: crossFg });
    }
    if (alarm) {
      const text = res.string(`${ALARM_CHIP}${alarm.worthScouting ? 'contacted' : 'scouted'}`);
      chips.push({ text, bg: rgb, fg: alarm.fg });
    }
    return chips;
  }

  for (const u of map.units) ops.push(...unitOps(u, res));

  each((x, y) => {
    const type = typeAt(x, y);
    const src = type && res.forSeed(`${ABOVE_TILE}${type.id}`, seedOf(x, y));
    if (src) ops.push({ k: 'image', x, y, src, at: 'center' });
  });

  for (const s of map.settlements) {
    const { x, y, rgb, name } = s;
    if (!explored([x, y]) || colonyLabels === 0) continue;
    const dim = seen(x, y) ? {} : { dim: true as const };
    if (colonyLabels === 1) {
      ops.push({ k: 'label', x, y, name, rgb, ...dim });
      continue;
    }
    // MapViewer.displaySettlementLabels, modern.
    const own = s.building ? [s.building] : [];
    const left =
      s.population >= 0
        ? { text: String(s.population), italic: s.sizeChange > 0 }
        : s.chips?.capital
          ? { capital: true as const }
          : null;
    const mission = s.chips?.mission;
    const right =
      s.population >= 0 && s.own && s.bonus !== 0
        ? { text: s.bonus > 0 ? `+${s.bonus}` : String(s.bonus) }
        : mission
          ? { mission: { rgb: mission.rgb, fg: foregroundOf(mission.rgb), expert: mission.expert } }
          : null;
    ops.push({
      k: 'modernLabel',
      x,
      y,
      lines: [name, ...own],
      rgb,
      fg: s.fg ?? foregroundOf(rgb),
      left,
      right,
      ...dim,
    });
  }
  return ops;
}

/**
 * What MapViewer draws over the map: the cursor (image.tile.unitSelect on
 * the active unit, tileSelect on a selected tile), then the active unit's
 * path, as displayPath does: the lines, then the marks.
 */
export function overlay(cursor: Cursor | null, path: PathStep[] | null, res: Resources): Op[] {
  const ops: Op[] = [];
  const src = cursor && res.path(cursor.kind === 'unit' ? `${TILE}unitSelect` : `${TILE}tileSelect`);
  if (cursor && src)
    ops.push({
      k: 'image',
      x: cursor.at[0],
      y: cursor.at[1],
      src,
      at: 'center',
      marker: true,
    });
  // displayPath draws nothing for a path of one step, and no line through a step off the map.
  if (!path || path.length < 2) return ops;
  for (let i = 1; i < path.length; i++) {
    const [from, to] = [path[i - 1], path[i]];
    if (from && to) ops.push({ k: 'pathLine', x: from[0], y: from[1], to: [to[0], to[1]], turns: to[2] });
  }
  for (const step of path) if (step) ops.push({ k: 'pathMark', x: step[0], y: step[1], turns: step[2] });
  return ops;
}

/**
 * The operations of an overlay that blink: the cursor. The unit cursor blinks with the active unit in FreeCol's
 * style; the tile cursor, shown when no unit is left to move, always blinks, so the player sees where they are.
 * They are drawn on a layer of their own, between the overlay and the units.
 */
export const isCursorMarker = (op: Op): boolean => op.k === 'image' && op.marker === true;

/** ImageLibrary.makeForegroundColor: black on a light colour, white on a dark one. */
export const foregroundOf = (rgb: number): number =>
  ((rgb >> 16) & 0xff) * 0.3 + ((rgb >> 8) & 0xff) * 0.59 + (rgb & 0xff) * 0.11 >= 126 ? 0x000000 : 0xffffff;

/** The tile text option (displayTileText): nothing, the tile type's name, its owner or its region. */
export type TileText = 0 | 1 | 2 | 3;

/** The View menu's display switches. */
export interface ViewModes {
  grid: boolean;
  borders: boolean;
  tileText: TileText;
}

export const NO_MODES: ViewModes = { grid: false, borders: false, tileText: 0 };

/** What the View menu's switches add to the map: the grid, the borders between owners, the tiles' names. */
export function viewModeOps(
  map: Pick<MapView, 'w' | 'h' | 'types' | 'tiles' | 'owners' | 'players' | 'regions' | 'regionNames'>,
  modes: ViewModes,
): Op[] {
  const ops: Op[] = [];
  if (!modes.grid && !modes.borders && !modes.tileText) return ops;
  const { w, h } = map;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (modes.grid) ops.push({ k: 'grid', x, y });
      if (modes.borders) {
        const owner = map.players[map.owners.charCodeAt(i) - 65];
        if (owner) {
          const sides = LONG_SIDES.filter((d) => {
            const s = STEPS[d];
            const [nx, ny] = y % 2 ? [x + s[0], y + s[1]] : [x + s[2], y + s[3]];
            const other = nx >= 0 && ny >= 0 && nx < w && ny < h ? map.owners.charCodeAt(ny * w + nx) : Number.NaN;
            return other !== map.owners.charCodeAt(i);
          });
          if (sides.length) ops.push({ k: 'border', x, y, sides, rgb: owner.rgb });
        }
      }
      // TileViewer.displayOptionalTileText.
      const name =
        modes.tileText === 1
          ? map.types[map.tiles.charCodeAt(i) - 65]?.name
          : modes.tileText === 2
            ? map.players[map.owners.charCodeAt(i) - 65]?.name
            : modes.tileText === 3
              ? map.regionNames?.[(map.regions?.charCodeAt(i) ?? 0) - 65]
              : undefined;
      if (name) ops.push({ k: 'tileName', x, y, name });
    }
  }
  return ops;
}

export const srcId = (src: Src) => (typeof src === 'string' ? src : src.id);

/**
 * What the Debug menu has the map show over its tiles, as the Engine worked it out (DebugInspection.overlay):
 * text at tiles ([x, y, text]; a line each) and tints of tiles ([x, y, rgb]).
 */
export interface DebugOverlay {
  labels: readonly (readonly [number, number, string])[];
  tints: readonly (readonly [number, number, number])[];
}

export const NO_OVERLAY: DebugOverlay = { labels: [], tints: [] };

/** MapViewer.displayDebugAiDefensiveMap's tint: Color(r, g, b, 150) on the tile's fog shape. */
export const TINT_ALPHA = 150 / 255;

/** The operations of the Debug menu's overlay: the tints, then the text over them. */
export function debugOverlayOps(overlay: DebugOverlay): Op[] {
  return [
    ...overlay.tints.map(([x, y, rgb]): Op => ({ k: 'tint', x, y, rgb })),
    ...overlay.labels.map(([x, y, text]): Op => ({ k: 'debugText', x, y, lines: text.split('\n') })),
  ];
}
