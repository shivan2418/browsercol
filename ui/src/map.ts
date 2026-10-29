// Crude map renderer: one square per tile, coloured by tile type, settlements
// outlined and units as dots. Falls back to Canvas 2D where PixiJS cannot get
// a renderer (some headless browsers).
import { Application, Graphics } from 'pixi.js';

/** The client's view of the map, as ClientMain.mapJson writes it. */
export interface MapView {
  w: number;
  h: number;
  turn: string;
  /** Tile type ids, indexed by the tile characters. */
  types: string[];
  /** One character per tile: 'A' + type index, '.' if unexplored. */
  tiles: string;
  /** [x, y, rgb] per settlement and per unit. */
  settlements: [number, number, number][];
  units: [number, number, number][];
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
export function mapDrawer(host: HTMLElement): { draw(map: MapView): Promise<void>; renderer(): string } {
  let pen: Pen | null = null;
  let size = 8;
  let renderer = 'none';
  let drawing = Promise.resolve();

  async function init(map: MapView) {
    size = Math.max(2, Math.floor(Math.min(900 / map.w, 700 / map.h)));
    const w = map.w * size;
    const h = map.h * size;
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
    const s = size;
    const colors = map.types.map(colorOf);
    p.clear();
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = map.tiles.charCodeAt(y * map.w + x) - 65;
        p.rect(x * s, y * s, s, s, i >= 0 ? colors[i] : 0x000000);
      }
    }
    for (const [x, y, rgb] of map.settlements) {
      p.rect(x * s, y * s, s, s, rgb);
      p.outline(x * s + 0.5, y * s + 0.5, s - 1, s - 1, 0xffffff);
    }
    for (const [x, y, rgb] of map.units) p.dot(x * s + s / 2, y * s + s / 2, Math.max(1.5, s / 3), rgb);
  }

  return {
    draw: (map) => (drawing = drawing.then(() => drawNow(map))),
    renderer: () => renderer,
  };
}
