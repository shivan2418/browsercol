// Crude map renderer: one brick per tile, coloured by tile type, settlements
// outlined, units as dots and the active unit's tile ringed. FreeCol's map is
// a diamond grid stored as staggered rows (odd rows half a tile to the right),
// so the bricks are half as tall as wide and odd rows are shifted: N is two
// rows up, NE one row up and to the right. Falls back to Canvas 2D where PixiJS cannot get
// a renderer (some headless browsers).
import { Application, Graphics } from 'pixi.js';

/** The client's view of the map, as ClientMain.mapJson writes it. */
export interface MapView {
  w: number;
  h: number;
  turn: string;
  ourTurn: boolean;
  /** Tile type ids, indexed by the tile characters. */
  types: string[];
  /** One character per tile: 'A' + type index, '.' if unexplored. */
  tiles: string;
  /** [x, y, rgb] per settlement and per unit. */
  settlements: [number, number, number][];
  units: [number, number, number][];
  /** The active unit's tile, if any. */
  active: [number, number] | null;
}

/** Brick width in pixels (height is half) and the map's size in tiles. */
export interface Layout {
  size: number;
  w: number;
  h: number;
}

/** Where a tile's brick starts. */
const origin = ({ size }: Layout, x: number, y: number): [number, number] => [
  x * size + (y % 2) * (size / 2),
  (y * size) / 2,
];

/** The tile [x, y] under a pixel of the map, or null off the map. */
export function tileAt(layout: Layout, px: number, py: number): [number, number] | null {
  const y = Math.floor(py / (layout.size / 2));
  const x = Math.floor((px - (y % 2) * (layout.size / 2)) / layout.size);
  return px < 0 || py < 0 || x < 0 || y < 0 || x >= layout.w || y >= layout.h ? null : [x, y];
}

// Colour per tile type id, matched on the last segment of the id.
const COLORS: [RegExp, number][] = [
  [/highSeas|deepOcean/i, 0x0a2a6b],
  [/ocean/i, 0x1f5fbf],
  [/lake/i, 0x4f8fdf],
  [/plains/i, 0xc9b458],
  [/grassland/i, 0x5fa83a],
  [/prairie/i, 0x9cc45a],
  [/savannah/i, 0xb7a93f],
  [/marsh/i, 0x6f8f5f],
  [/swamp/i, 0x4a6b4a],
  [/desert/i, 0xe0c88a],
  [/tundra/i, 0xb8c0b0],
  [/arctic/i, 0xf4f8ff],
  [/coniferForest|boreal/i, 0x1f5a2f],
  [/scrubForest/i, 0x6f7f35],
  [/tropicalForest|rain/i, 0x0f6f2f],
  [/forest/i, 0x2f7f3f],
  [/hills/i, 0x8f7050],
  [/mountains/i, 0x777777],
];
const colorOf = (id: string) => COLORS.find(([re]) => re.test(id))?.[1] ?? 0x888888;
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface Pen {
  clear(): void;
  rect(x: number, y: number, w: number, h: number, color: number): void;
  outline(x: number, y: number, w: number, h: number, color: number): void;
  dot(x: number, y: number, r: number, color: number): void;
}

async function pixiPen(host: HTMLElement, width: number, height: number): Promise<Pen> {
  const app = new Application();
  await app.init({ width, height, background: 0x000000, antialias: false });
  host.append(app.canvas);
  const g = new Graphics();
  app.stage.addChild(g);
  return {
    clear: () => g.clear(),
    rect: (x, y, w, h, color) => g.rect(x, y, w, h).fill(color),
    outline: (x, y, w, h, color) => g.rect(x, y, w, h).stroke({ width: 1, color }),
    dot: (x, y, r, color) => g.circle(x, y, r).fill(color),
  };
}

function canvasPen(host: HTMLElement, width: number, height: number): Pen {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  host.append(canvas);
  const c = canvas.getContext('2d')!;
  return {
    clear: () => c.clearRect(0, 0, width, height),
    rect: (x, y, w, h, color) => {
      c.fillStyle = css(color);
      c.fillRect(x, y, w, h);
    },
    outline: (x, y, w, h, color) => {
      c.strokeStyle = css(color);
      c.strokeRect(x, y, w, h);
    },
    dot: (x, y, r, color) => {
      c.fillStyle = css(color);
      c.beginPath();
      c.arc(x, y, r, 0, 2 * Math.PI);
      c.fill();
    },
  };
}

/** A map drawer for `host`; draws are serialised behind the renderer's async init. */
export function mapDrawer(host: HTMLElement): {
  draw(map: MapView): Promise<void>;
  renderer(): string;
  /** The tile under a pixel of the map, or null off it or before the first draw. */
  tileAt(px: number, py: number): [number, number] | null;
} {
  let pen: Pen | null = null;
  let layout: Layout | null = null;
  let renderer = 'none';
  let drawing = Promise.resolve();

  async function init(map: MapView) {
    // An even size keeps the half-brick offsets on whole pixels.
    const size = 2 * Math.max(1, Math.floor(Math.min(900 / (map.w + 0.5), 1400 / map.h) / 2));
    layout = { size, w: map.w, h: map.h };
    const w = (map.w + 0.5) * size;
    const h = (map.h * size) / 2;
    try {
      pen = await pixiPen(host, w, h);
      renderer = 'pixi';
    } catch (ex) {
      pen = canvasPen(host, w, h);
      renderer = `canvas2d (pixi failed: ${ex instanceof Error ? ex.message : String(ex)})`;
    }
  }

  async function drawNow(map: MapView) {
    if (!pen) await init(map);
    const p = pen!;
    const at = layout!;
    const s = at.size;
    const colors = map.types.map(colorOf);
    p.clear();
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = map.tiles.charCodeAt(y * map.w + x) - 65;
        const [px, py] = origin(at, x, y);
        p.rect(px, py, s, s / 2, i >= 0 ? colors[i] : 0x000000);
      }
    }
    for (const [x, y, rgb] of map.settlements) {
      const [px, py] = origin(at, x, y);
      p.rect(px, py, s, s / 2, rgb);
      p.outline(px + 0.5, py + 0.5, s - 1, s / 2 - 1, 0xffffff);
    }
    for (const [x, y, rgb] of map.units) {
      const [px, py] = origin(at, x, y);
      p.dot(px + s / 2, py + s / 4, Math.max(1.5, s / 6), rgb);
    }
    if (map.active) {
      const [px, py] = origin(at, ...map.active);
      p.outline(px - 0.5, py - 0.5, s + 1, s / 2 + 1, 0xffff00);
    }
  }

  return {
    draw: (map) => (drawing = drawing.then(() => drawNow(map))),
    renderer: () => renderer,
    tileAt: (px, py) => (layout ? tileAt(layout, px, py) : null),
  };
}
