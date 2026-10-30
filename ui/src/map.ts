// Tileset mode map renderer: draws the operations of tileset.ts with
// PixiJS, falling back to Canvas 2D where PixiJS cannot get a renderer (some
// headless browsers). Images load by path from the art/ directory that
// scripts/build-art.mjs fills; recipes (FreeCol's masked images) are
// composited once on a canvas and cached by id. The map is FreeCol's: 128x64
// diamonds in staggered rows, odd rows half a tile to the right. Drag to pan.
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { resources, type ArtLayer, type Resources } from './resources';
import { scene, srcId, type Direction, type MapView, type Op, type Src } from './tileset';

export type { MapView } from './tileset';

const W = 128;
const H = 64;
/** TileViewer.STATE_OFFSET_X and TileBounds' unit offsets, at scale 1. */
const STATE_OFFSET_X = 25;
const UNIT_OFFSET = 20;
const OTHER_UNITS_OFFSET_X = -5;
const OTHER_UNITS_WIDTH = 3;
const MAX_OTHER_UNITS = 10;
const ROAD_COLOR = 0x804000;
/** color.map.productionBonus.N in FreeCol's default resources. */
const BONUS_COLORS: Record<number, number> = { 2: 0x0000ff, 1: 0x00aa00, 0: 0xffffff, [-1]: 0xffa500, [-2]: 0xff0000 };

/** Where a tile's 128x64 box starts on the whole map. */
export const tileOrigin = (x: number, y: number): [number, number] => [x * W + (y % 2) * (W / 2), (y * H) / 2];

/** The tile whose diamond holds a point of the whole map, or null off the map. */
export function tileAt(w: number, h: number, px: number, py: number): [number, number] | null {
  const row = Math.floor(py / (H / 2));
  for (const y of [row - 1, row]) {
    if (y < 0 || y >= h) continue;
    const x = Math.floor((px - (y % 2) * (W / 2)) / W);
    const [ox, oy] = tileOrigin(x, y);
    if (x >= 0 && x < w && Math.abs(px - ox - W / 2) / (W / 2) + Math.abs(py - oy - H / 2) / (H / 2) <= 1) {
      return [x, y];
    }
  }
  return null;
}

type Picture = HTMLImageElement | HTMLCanvasElement;
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
/** FreeCol's fog of war RescaleOp: each colour channel at 80%. */
const fogged = (c: number) =>
  [16, 8, 0].reduce((n, shift) => n | (Math.round(((c >> shift) & 0xff) * 0.8) << shift), 0);

/** Images by path and recipes by id, loaded and composited once. */
function pictures(base: string) {
  const cache = new Map<string, Promise<Picture>>();
  const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const load = (path: string) => {
    const img = new Image();
    img.src = base + path;
    return img.decode().then(() => img);
  };
  const compose = async (src: Exclude<Src, string>): Promise<Picture> => {
    const c = canvas(W, H);
    const g = c.getContext('2d')!;
    for (const step of src.steps) {
      if ('mask' in step) {
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(await get(step.mask), 0, 0, W, H);
      } else {
        const s = step.scale ?? 1;
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = step.alpha ?? 1;
        g.drawImage(await get(step.draw), (W - W * s) / 2, (H - H * s) / 2, W * s, H * s);
      }
      g.globalAlpha = 1;
    }
    return c;
  };
  const get = (src: Src): Promise<Picture> => {
    const id = srcId(src);
    let p = cache.get(id);
    if (!p) cache.set(id, (p = typeof src === 'string' ? load(src) : compose(src)));
    return p;
  };
  /** ImageLibrary's grayscale images: sentries and units out of sight. */
  const gray = (src: Src): Promise<Picture> => {
    const id = 'gray:' + srcId(src);
    let p = cache.get(id);
    if (!p) {
      p = get(src).then((img) => {
        const c = canvas(img.width, img.height);
        const g = c.getContext('2d')!;
        g.filter = 'grayscale(1)';
        g.drawImage(img, 0, 0);
        return c;
      });
      cache.set(id, p);
    }
    return p;
  };
  return { get, gray };
}

interface TextStyle {
  color: number;
  font: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
}

/** What draws the map: a PixiJS scene graph or a Canvas 2D context. */
interface Pen {
  readonly canvas: HTMLCanvasElement;
  clear(): void;
  image(pic: Picture, x: number, y: number, dim: boolean): void;
  diamond(x: number, y: number, color: number, alpha: number): void;
  road(x: number, y: number, path: (p: PathSink) => void): void;
  rect(x: number, y: number, w: number, h: number, color: number): void;
  line(x1: number, y1: number, x2: number, y2: number, color: number): void;
  /** Text with a black outline, its top centred on (x, y) or starting there. */
  text(s: string, x: number, y: number, style: TextStyle, center: boolean): void;
  measure(s: string, style: TextStyle): number;
  /** Show the map moved by (dx, dy). */
  show(dx: number, dy: number): void;
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadTo(cx: number, cy: number, x: number, y: number): void;
}

const fontOf = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${s.font}`;

async function pixiPen(host: HTMLElement, width: number, height: number): Promise<Pen> {
  const app = new Application();
  await app.init({ width, height, background: 0x000000, antialias: true });
  host.append(app.canvas);
  const world = new Container();
  app.stage.addChild(world);
  const textures = new WeakMap<Picture, Texture>();
  const texture = (pic: Picture) => {
    let t = textures.get(pic);
    if (!t) textures.set(pic, (t = Texture.from(pic)));
    return t;
  };
  const measurer = document.createElement('canvas').getContext('2d')!;
  return {
    canvas: app.canvas,
    clear: () => {
      for (const child of world.removeChildren()) child.destroy();
    },
    image: (pic, x, y, dim) => {
      const s = new Sprite(texture(pic));
      s.position.set(x, y);
      if (dim) s.tint = 0xcccccc;
      world.addChild(s);
    },
    diamond: (x, y, color, alpha) => {
      world.addChild(
        new Graphics().poly([x + W / 2, y, x + W, y + H / 2, x + W / 2, y + H, x, y + H / 2]).fill({ color, alpha }),
      );
    },
    road: (x, y, path) => {
      const g = new Graphics();
      path({
        moveTo: (px, py) => g.moveTo(x + px, y + py),
        lineTo: (px, py) => g.lineTo(x + px, y + py),
        quadTo: (cx, cy, px, py) => g.quadraticCurveTo(x + cx, y + cy, x + px, y + py),
      });
      world.addChild(g.stroke({ width: H / 32, color: ROAD_COLOR }));
    },
    rect: (x, y, w, h, color) => {
      world.addChild(new Graphics().rect(x, y, w, h).fill(color));
    },
    line: (x1, y1, x2, y2, color) => {
      world.addChild(new Graphics().moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 1, color }));
    },
    text: (s, x, y, style, center) => {
      const t = new Text({
        text: s,
        style: {
          fontFamily: style.font,
          fontSize: style.size,
          fontWeight: style.bold ? 'bold' : 'normal',
          fontStyle: style.italic ? 'italic' : 'normal',
          fill: style.color,
          stroke: { color: 0x000000, width: 2 },
        },
      });
      t.position.set(center ? x - t.width / 2 : x, y);
      world.addChild(t);
    },
    measure: (s, style) => {
      measurer.font = fontOf(style);
      return measurer.measureText(s).width;
    },
    show: (dx, dy) => world.position.set(dx, dy),
  };
}

function canvasPen(host: HTMLElement, width: number, height: number): Pen {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  host.append(canvas);
  const c = canvas.getContext('2d')!;
  // Canvas 2D has no scene graph: record the drawing and replay it to pan.
  let calls: ((c: CanvasRenderingContext2D) => void)[] = [];
  return {
    canvas,
    clear: () => (calls = []),
    image: (pic, x, y, dim) =>
      calls.push((c) => {
        c.filter = dim ? 'brightness(0.8)' : 'none';
        c.drawImage(pic, x, y);
        c.filter = 'none';
      }),
    diamond: (x, y, color, alpha) =>
      calls.push((c) => {
        c.globalAlpha = alpha;
        c.fillStyle = css(color);
        c.beginPath();
        c.moveTo(x + W / 2, y);
        c.lineTo(x + W, y + H / 2);
        c.lineTo(x + W / 2, y + H);
        c.lineTo(x, y + H / 2);
        c.fill();
        c.globalAlpha = 1;
      }),
    road: (x, y, path) =>
      calls.push((c) => {
        c.strokeStyle = css(ROAD_COLOR);
        c.lineWidth = H / 32;
        c.beginPath();
        path({
          moveTo: (px, py) => c.moveTo(x + px, y + py),
          lineTo: (px, py) => c.lineTo(x + px, y + py),
          quadTo: (cx, cy, px, py) => c.quadraticCurveTo(x + cx, y + cy, x + px, y + py),
        });
        c.stroke();
      }),
    rect: (x, y, w, h, color) =>
      calls.push((c) => {
        c.fillStyle = css(color);
        c.fillRect(x, y, w, h);
      }),
    line: (x1, y1, x2, y2, color) =>
      calls.push((c) => {
        c.strokeStyle = css(color);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
      }),
    text: (s, x, y, style, center) =>
      calls.push((c) => {
        c.font = fontOf(style);
        c.textAlign = center ? 'center' : 'left';
        c.textBaseline = 'top';
        c.lineWidth = 2;
        c.strokeStyle = '#000';
        c.strokeText(s, x, y);
        c.fillStyle = css(style.color);
        c.fillText(s, x, y);
      }),
    measure: (s, style) => {
      c.font = fontOf(style);
      return c.measureText(s).width;
    },
    show: (dx, dy) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#000';
      c.fillRect(0, 0, width, height);
      c.translate(dx, dy);
      for (const call of calls) call(c);
    },
  };
}

/** RoadPainter's corner points and the road pairs it skips on 3 and 4 way tiles. */
const CORNERS: Record<Direction, [number, number]> = {
  N: [W / 2, 0],
  NE: [0.75 * W, 0.25 * H],
  E: [W, H / 2],
  SE: [0.75 * W, 0.75 * H],
  S: [W / 2, H],
  SW: [0.25 * W, 0.75 * H],
  W: [0, H / 2],
  NW: [0.25 * W, 0.25 * H],
};
const PROHIBITED: Record<Direction, Direction[]> = {
  N: ['NW', 'NE'],
  NE: ['N', 'E'],
  E: ['NE', 'SE'],
  SE: ['E', 'S'],
  S: ['SE', 'SW'],
  SW: ['S', 'W'],
  W: ['SW', 'NW'],
  NW: ['W', 'N'],
};
function roadPath(dirs: Direction[], p: PathSink) {
  const pts = dirs.map((d) => CORNERS[d]);
  const [cx, cy] = [W / 2, H / 2];
  if (pts.length === 0) {
    p.moveTo(0.35 * W, 0.35 * H);
    p.lineTo(0.65 * W, 0.65 * H);
    p.moveTo(0.35 * W, 0.65 * H);
    p.lineTo(0.65 * W, 0.35 * H);
  } else if (pts.length === 1) {
    p.moveTo(cx, cy);
    p.lineTo(...pts[0]);
  } else if (pts.length === 2) {
    p.moveTo(...pts[0]);
    p.quadTo(cx, cy, ...pts[1]);
  } else if (pts.length <= 4) {
    let pen = dirs[dirs.length - 1];
    p.moveTo(...CORNERS[pen]);
    for (const d of dirs) {
      if (PROHIBITED[pen].includes(d)) p.moveTo(...CORNERS[d]);
      else p.quadTo(cx, cy, ...CORNERS[d]);
      pen = d;
    }
  } else {
    for (const pt of pts) {
      p.moveTo(cx, cy);
      p.lineTo(...pt);
    }
  }
}

const CHIP: TextStyle = { color: 0, font: 'sans-serif', size: 10, bold: true };
const NAME: TextStyle = { color: 0, font: 'serif', size: 13 };
/** TileViewer's fonts: simple-bold-tiny, and simple-bold+italic-smaller to emphasise. */
const POPULATION: TextStyle = { color: 0, font: 'sans-serif', size: 12, bold: true };
const POPULATION_EMPH: TextStyle = { ...POPULATION, size: 14, italic: true };

/** Draw the scene's operations, loading what they need first. */
async function paint(pen: Pen, ops: Op[], pics: ReturnType<typeof pictures>) {
  const images = await Promise.all(
    ops.map((op) =>
      op.k === 'image' ? (op.fade ? pics.gray(op.src) : pics.get(op.src)).catch(() => null) : Promise.resolve(null),
    ),
  );
  pen.clear();
  ops.forEach((op, i) => {
    const [ox, oy] = tileOrigin(op.x, op.y);
    const shade = (c: number) => ('dim' in op && op.dim ? fogged(c) : c);
    switch (op.k) {
      case 'image': {
        const img = images[i];
        if (!img) return;
        const [iw, ih] = [img.width, img.height];
        const [dx, dy] =
          op.at === 'tile'
            ? [0, 0]
            : op.at === 'bottom'
              ? [0, H - ih]
              : op.at === 'center'
                ? [(W - iw) / 2, (H - ih) / 2]
                : op.at === 'large'
                  ? [(W - iw) / 2, H - ih > 0 ? (H - ih) / 2 : H - ih]
                  : [(W - iw) / 2, (H - ih) / 2 - UNIT_OFFSET];
        pen.image(img, ox + Math.trunc(dx), oy + Math.trunc(dy), !!op.dim);
        return;
      }
      case 'fog':
        return pen.diamond(ox, oy, 0x000000, 0.2);
      case 'road':
        return pen.road(ox, oy, (p) => roadPath(op.dirs, p));
      case 'chip': {
        // ImageLibrary.createChip: a black border round the owner's colour.
        const pad = 6;
        const cw = Math.ceil(pen.measure(op.text, CHIP)) + pad;
        const ch = CHIP.size + pad;
        const x = ox + STATE_OFFSET_X;
        pen.rect(x, oy, cw, ch, 0x000000);
        pen.rect(x + 1, oy + 1, cw - 2, ch - 2, op.bg);
        pen.text(op.text, x + pad / 2, oy + pad / 2 - 1, { ...CHIP, color: op.fg }, false);
        if (op.stack > 1) {
          const x1 = x + OTHER_UNITS_OFFSET_X;
          for (let n = 0; n < Math.min(op.stack, MAX_OTHER_UNITS); n++) {
            pen.line(x1, oy + 1.5 + 2 * n, x1 + OTHER_UNITS_WIDTH, oy + 1.5 + 2 * n, 0xffffff);
          }
        }
        return;
      }
      case 'population': {
        const style = op.emph ? POPULATION_EMPH : POPULATION;
        const color = shade(BONUS_COLORS[op.bonus] ?? 0xffffff);
        pen.text(String(op.population), ox + W / 2, oy + (H - style.size) / 2, { ...style, color }, true);
        return;
      }
      case 'label':
        // The classic colony labels: the name below the tile.
        pen.text(op.name, ox + W / 2 + 1, oy + H, { ...NAME, color: shade(op.rgb) }, true);
        return;
    }
  });
}

/** The art manifest from scripts/build-art.mjs. */
interface Art {
  layers: ArtLayer[];
  files: string[];
}

/** A map drawer for `host`, with art under `artBase`; draws are serialised. */
export function mapDrawer(
  host: HTMLElement,
  artBase: string,
): {
  draw(map: MapView): Promise<void>;
  renderer(): string;
  /** The tile under a pixel of the canvas, or null off the map or before the first draw. */
  tileAt(px: number, py: number): [number, number] | null;
  /** Where a tile's centre is on the canvas, panning it into view if needed. */
  pointOf(x: number, y: number): [number, number];
  /** The resolver, once the art manifest has loaded. */
  resources(): Resources | null;
} {
  let pen: Pen | null = null;
  let res: Resources | null = null;
  let size: [number, number] = [0, 0];
  let renderer = 'none';
  let drawing = Promise.resolve();
  const pics = pictures(artBase);
  const view = { w: 0, h: 0, dx: 0, dy: 0, width: 0, height: 0 };

  const clamp = () => {
    view.dx = Math.min(0, Math.max(view.width - size[0], view.dx));
    view.dy = Math.min(0, Math.max(view.height - size[1], view.dy));
    pen?.show(view.dx, view.dy);
  };

  async function init(map: MapView) {
    const art = (await (await fetch(artBase + 'art.json')).json()) as Art;
    res = resources(art.layers, art.files);
    size = [(map.w + 0.5) * W, ((map.h + 1) * H) / 2];
    view.w = map.w;
    view.h = map.h;
    view.width = Math.min(size[0], Math.max(320, innerWidth - 360));
    view.height = Math.min(size[1], Math.max(240, innerHeight));
    try {
      pen = await pixiPen(host, view.width, view.height);
      renderer = 'pixi';
    } catch (ex) {
      pen = canvasPen(host, view.width, view.height);
      renderer = `canvas2d (pixi failed: ${ex instanceof Error ? ex.message : String(ex)})`;
    }
    pan(pen.canvas);
    // Start on the active unit, if any.
    if (map.active) centre(...map.active);
  }

  const centre = (x: number, y: number) => {
    const [ox, oy] = tileOrigin(x, y);
    view.dx = view.width / 2 - ox - W / 2;
    view.dy = view.height / 2 - oy - H / 2;
    clamp();
  };

  /** Drag to pan; a drag of a few pixels or more is not a click. */
  function pan(canvas: HTMLCanvasElement) {
    let from: [number, number] | null = null;
    let moved = 0;
    canvas.addEventListener('pointerdown', (e) => {
      from = [e.clientX, e.clientY];
      moved = 0;
    });
    addEventListener('pointermove', (e) => {
      if (!from) return;
      moved += Math.abs(e.clientX - from[0]) + Math.abs(e.clientY - from[1]);
      view.dx += e.clientX - from[0];
      view.dy += e.clientY - from[1];
      from = [e.clientX, e.clientY];
      clamp();
    });
    addEventListener('pointerup', () => (from = null));
    canvas.addEventListener('click', (e) => {
      if (moved > 4) e.stopPropagation();
    });
  }

  async function drawNow(map: MapView) {
    if (!pen) await init(map);
    await paint(pen!, scene(map, res!), pics);
    pen!.show(view.dx, view.dy);
  }

  return {
    draw: (map) => (drawing = drawing.then(() => drawNow(map))),
    renderer: () => renderer,
    tileAt: (px, py) => (pen ? tileAt(view.w, view.h, px - view.dx, py - view.dy) : null),
    pointOf: (x, y) => {
      const [ox, oy] = tileOrigin(x, y);
      const [px, py] = [ox + W / 2 + view.dx, oy + H / 2 + view.dy];
      if (px < W || py < H || px > view.width - W || py > view.height - H) centre(x, y);
      return [ox + W / 2 + view.dx, oy + H / 2 + view.dy];
    },
    resources: () => res,
  };
}
