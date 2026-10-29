// Tileset mode: the client Engine's map (MapJson.java) turned into a list of
// draw operations in the order FreeCol's MapViewer paints, with the images
// its ImageLibrary would pick, at FreeCol's default "normal" graphics
// quality and with animations stopped at their first frame. FreeCol makes
// some images by masking others (terrain transitions, beaches, rivers);
// those come as a Recipe the renderer composites and caches by id.
import type { Resources } from './resources';

export interface TileType {
  id: string;
  land: boolean;
  forested: boolean;
}

/** The client's view of the map, as MapJson.java writes it. */
export interface MapView {
  w: number;
  h: number;
  turn: string;
  ourTurn: boolean;
  types: TileType[];
  /** One character per tile: 'A' + type index, '.' if unexplored. */
  tiles: string;
  /** One character per tile: '1' if the player can see it now. */
  seen: string;
  /** [x, y, magnitude, style, forest mask]; style digits face NE, SE, SW, NW. */
  rivers: [number, number, number, string, string][];
  /** [x, y, zIndex] per complete road. */
  roads: [number, number, number][];
  /** [x, y, zIndex, kind, key] in zIndex order per tile. */
  items: [number, number, number, 'centered' | 'tile', string][];
  /** [x, y, keys, rgb, name, population (-1 for native settlements), production bonus]. */
  settlements: [number, number, string[], number, string, number, number][];
  /** [x, y, keys, rgb, chip text, chip text rgb, units on the tile, faded]. */
  units: [number, number, string[], number, string, number, number, boolean][];
  active: [number, number] | null;
}

/** An image file, or one made by drawing others in order onto a tile-sized canvas. */
export type Src = string | Recipe;
export interface Recipe {
  /** Same id, same image: the renderer's cache key. */
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
  | { k: 'image'; x: number; y: number; src: Src; at: Anchor; dim?: true; fade?: true }
  /** FreeCol's fog of war: 20% black over the tile's diamond. */
  | { k: 'fog'; x: number; y: number }
  /** A road to the neighbours with roads (RoadPainter). */
  | { k: 'road'; x: number; y: number; dirs: Direction[] }
  /** A unit's occupation chip in its owner's colour, with a line per unit on the tile. */
  | { k: 'chip'; x: number; y: number; text: string; bg: number; fg: number; stack: number }
  /** A settlement's population (colonies) and its name below the tile, in the owner's colour. */
  | { k: 'label'; x: number; y: number; name: string; population: number; bonus: number; rgb: number; dim?: true };

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

const TILE_MASK = 'image.mask';
const BEACH = 'image.tile.model.tile.beach';
const RIVER_WATER = 'image.tile.river.water';
const RIVER_PEBBLES = 'image.tile.river.pebbles';
const UNEXPLORED = 'model.tile.unexplored';

/** ImageLibrary.variationSeedUsing. */
const seedOf = (x: number, y: number) => x * 6841 + y * 7919;
const lower = (ds: Direction[]) =>
  ds
    .map((d) => d.toLowerCase())
    .sort()
    .join('_');
const terrainKey = (id: string) => `image.tile.${id}.center`;

export function scene(map: MapView, res: Resources): Op[] {
  const { w, h } = map;
  const ops: Op[] = [];

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const step = (x: number, y: number, d: Direction): [number, number] | null => {
    const s = STEPS[d];
    const [nx, ny] = y % 2 ? [x + s[0], y + s[1]] : [x + s[2], y + s[3]];
    return inside(nx, ny) ? [nx, ny] : null;
  };
  const typeAt = (x: number, y: number): TileType | null => {
    const c = map.tiles.charCodeAt(y * w + x) - 65;
    return c >= 0 ? map.types[c] : null;
  };
  const explored = (p: [number, number] | null) => !!p && typeAt(...p) !== null;
  /** Tile.isLand: unexplored tiles have no type, so are not land. */
  const land = (p: [number, number] | null) => !!p && !!typeAt(...p)?.land;
  const seen = (x: number, y: number) => map.seen[y * w + x] === '1';

  const rivers = new Map<number, { magnitude: number; style: string; mask: string }>();
  for (const [x, y, magnitude, style, mask] of map.rivers) rivers.set(y * w + x, { magnitude, style, mask });
  const riverAt = (p: [number, number] | null) => (p ? rivers.get(p[1] * w + p[0]) : undefined);
  const roads = new Set(map.roads.map(([x, y]) => y * w + x));

  const variant = (key: string, n: number) => res.path(key, n);
  const named = (key: string) => res.path(key);
  const first = (keys: string[]) => keys.find((k) => res.has(k));

  /** Image with its alpha cut to a mask (ImageUtils.imageWithAlphaFromMask). */
  const masked = (img: Src, mask: Src): Recipe => ({
    id: `mask:${srcId(img)}:${srcId(mask)}`,
    steps: [{ draw: img }, { mask }],
  });

  // BeachTileAnimationImageCreator, first frame: the beach, with the ocean
  // over it except where the mask for the land sides cuts it away.
  const beachKey = (dirs: Direction[]) => {
    const pre = lower(dirs.filter((d) => LONG_SIDES.includes(d)));
    return lower(dirs.filter((d) => LONG_SIDES.includes(d) || pre === '' || !pre.includes(d.toLowerCase())));
  };
  const water = (x: number, y: number, type: TileType): Src | null => {
    const ocean = variant(terrainKey(type.id), 0);
    if (!ocean) return null;
    const dirs = DIRECTIONS.filter((d) => land(step(x, y, d)));
    const key = beachKey(dirs);
    const beach = named(BEACH);
    const mask = named(`image.mask.beach.${key}`);
    const tileMask = named(TILE_MASK);
    if (dirs.length === 0 || !beach || !mask || !tileMask) return ocean;
    return {
      id: `beach:${ocean}:${key}`,
      steps: [{ draw: beach }, { draw: masked(ocean, mask) }, { mask: tileMask }],
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
    const image = named(imageKey);
    const own = named(terrainKey(type.id));
    const mask = named(`image.mask.${d.toLowerCase()}`);
    if (!image || !own || !mask) return null;
    if (image === own && !special) return null;
    const src = variant(imageKey, 0)!;
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
        const beach = variant(BEACH, 0);
        const beachMask = named(`image.mask.special.beach.${dir}`);
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
  // DeltaAnimationImageCreator, first frame.
  const delta = (d: Direction): Recipe | null => {
    const dir = d.toLowerCase();
    const [pebbles, waterImg, waterMask, pebblesMask, tileMask] = [
      named(RIVER_PEBBLES),
      variant(RIVER_WATER, 0),
      named(`image.mask.river.delta.${dir}`),
      named(`image.mask.river.delta.pebbles.${dir}`),
      named(TILE_MASK),
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

  // RiverAnimationImageCreator, first frame: river water and pebbles in
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
      named(RIVER_PEBBLES),
      variant(RIVER_WATER, 0),
      named(`image.mask.river${minor}${shape ? '.' + shape : ''}`),
      named(TILE_MASK),
    ];
    if (!pebbles || !waterImg || !base || !tileMask) return null;
    const extra = toMajor.map((d) => named(`image.mask.river.to_major.${d.toLowerCase()}`)).filter((m) => m !== null);
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
      const src = res.forSeed(`image.tile.${UNEXPLORED}.border.${d}`, seedOf(x, y));
      if (src) ops.push({ k: 'image', x, y, src, at: 'tile' });
    }
  });

  // TileViewer.displayTileItems and the settlement, per explored tile.
  const itemsAt = new Map<number, { z: number; op: () => void }[]>();
  const addItem = (x: number, y: number, z: number, op: () => void) => {
    const i = y * w + x;
    itemsAt.set(i, [...(itemsAt.get(i) ?? []), { z, op }]);
  };
  for (const [x, y, z] of map.roads) {
    addItem(x, y, z, () =>
      ops.push({
        k: 'road',
        x,
        y,
        dirs: DIRECTIONS.filter((d) => {
          const n = step(x, y, d);
          return !!n && roads.has(n[1] * w + n[0]);
        }),
      }),
    );
  }
  for (const [x, y, z, kind, key] of map.items) {
    const src = named(key);
    const dim = seen(x, y) ? {} : { dim: true as const };
    if (src)
      addItem(x, y, z, () => ops.push({ k: 'image', x, y, src, at: kind === 'tile' ? 'tile' : 'center', ...dim }));
  }
  const settlements = new Map(map.settlements.map((s) => [s[1] * w + s[0], s]));
  each((x, y) => {
    const type = typeAt(x, y);
    if (!type) return;
    const dim = seen(x, y) ? {} : { dim: true as const };
    const items = (itemsAt.get(y * w + x) ?? []).sort((a, b) => a.z - b.z);
    const upTo = (z: number) => {
      while (items.length && items[0].z < z) items.shift()!.op();
    };
    upTo(100);
    const overlay = res.forSeed(`image.tileoverlay.${type.id}`, seedOf(x, y));
    if (overlay) ops.push({ k: 'image', x, y, src: overlay, at: 'bottom', ...dim });
    upTo(200);
    if (type.forested) {
      const r = riverAt([x, y]);
      const styled = r && `image.tileforest.${type.id}.s${r.mask === '0000' ? '0100' : r.mask}`;
      const src = named(styled && res.has(styled) ? styled : `image.tileforest.${type.id}`);
      if (src) ops.push({ k: 'image', x, y, src, at: 'bottom', ...dim });
    }
    upTo(Infinity);
    const s = settlements.get(y * w + x);
    const key = s && first(s[2]);
    if (s && key) {
      ops.push({ k: 'image', x, y, src: named(key)!, at: 'large', ...dim });
    }
  });

  for (const [x, y, keys, bg, text, fg, stack, fade] of map.units) {
    const key = first(keys);
    if (key) ops.push({ k: 'image', x, y, src: named(key)!, at: 'unit', ...(fade ? { fade: true as const } : {}) });
    ops.push({ k: 'chip', x, y, text, bg, fg, stack });
  }

  each((x, y) => {
    const type = typeAt(x, y);
    const src = type && res.forSeed(`image.abovetile.${type.id}`, seedOf(x, y));
    if (src) ops.push({ k: 'image', x, y, src, at: 'center' });
  });

  for (const [x, y, , rgb, name, population, bonus] of map.settlements) {
    if (!explored([x, y])) continue;
    ops.push({ k: 'label', x, y, name, population, bonus, rgb, ...(seen(x, y) ? {} : { dim: true as const }) });
  }
  return ops;
}

export const srcId = (src: Src) => (typeof src === 'string' ? src : src.id);
