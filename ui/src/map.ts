// The map in Tileset mode: draws the operations of tileset.ts with
// PixiJS, falling back to Canvas 2D where PixiJS cannot get a renderer (some
// headless browsers). Images load by path from the art/ directory that
// scripts/build-art.mjs fills; recipes (FreeCol's masked images) are
// composited once on a canvas and cached by id. The map is FreeCol's: 128x64
// diamonds in staggered rows, odd rows half a tile to the right. It shows
// the part of the map, at the zoom, that the view state (view.ts) says, with
// the cursor and the active unit's path drawn over it.
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { resources, type ArtLayer, type Resources } from './resources';
import { overlay, scene, srcId, type Direction, type MapView, type Op, type Src } from './tileset';
import { H, W, activeUnitFacts, cursor, tileOrigin, toMap, type ViewState } from './view';

export type { MapView } from './tileset';
/** TileViewer.STATE_OFFSET_X/Y and TileBounds' unit offsets, at scale 1. */
const STATE_OFFSET_X = 25;
const STATE_OFFSET_Y = 10;
const UNIT_OFFSET = 20;
const OTHER_UNITS_OFFSET_X = -5;
const OTHER_UNITS_WIDTH = 3;
const MAX_OTHER_UNITS = 10;

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
  /** Black outline round the glyphs; off for text on a chip, whose own border frames it. */
  plain?: boolean;
}

/** The map's layers: the scene, and the cursor and path over it. */
type Layer = 0 | 1;

/** The screen's pixel ratio: how many device pixels a CSS pixel covers. */
export const pixelRatio = (dpr: number | undefined): number => (dpr && dpr > 0 ? dpr : 1);

/** The canvas's backing store size, in device pixels, for a CSS size at a pixel ratio. */
export const backingSize = (w: number, h: number, ratio: number): [number, number] => [
  Math.round(w * ratio),
  Math.round(h * ratio),
];

/** The screen's pixel ratio now, which a window moving to another screen can change. */
const screenRatio = (): number => pixelRatio(window.devicePixelRatio);

/** What draws the map: a PixiJS scene graph or a Canvas 2D context. */
interface Pen {
  readonly canvas: HTMLCanvasElement;
  /** Clear a layer, and draw on it from now on. */
  begin(layer: Layer): void;
  image(pic: Picture, x: number, y: number, dim: boolean): void;
  diamond(x: number, y: number, color: number, alpha: number): void;
  road(x: number, y: number, color: number, path: (p: PathSink) => void): void;
  rect(x: number, y: number, w: number, h: number, color: number): void;
  line(x1: number, y1: number, x2: number, y2: number, color: number, width?: number, alpha?: number): void;
  /** A filled circle of radius r with a 2-pixel outline. */
  circle(x: number, y: number, r: number, fill: number, outline: number, outlineAlpha: number): void;
  /** Text with a black outline, its top centred on (x, y) or starting there. */
  text(s: string, x: number, y: number, style: TextStyle, center: boolean): void;
  measure(s: string, style: TextStyle): number;
  /** Show the map scaled by `scale`, then moved by (dx, dy). */
  show(dx: number, dy: number, scale: number): void;
  /** Make the canvas `width` by `height` CSS pixels; show() draws it again. */
  resize(width: number, height: number): void;
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadTo(cx: number, cy: number, x: number, y: number): void;
}

/** A PathSink drawing onto a PixiJS Graphics or a Canvas 2D context, moved by (x, y). */
function offset(
  to: {
    moveTo(x: number, y: number): unknown;
    lineTo(x: number, y: number): unknown;
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): unknown;
  },
  x: number,
  y: number,
): PathSink {
  return {
    moveTo: (px, py) => to.moveTo(x + px, y + py),
    lineTo: (px, py) => to.lineTo(x + px, y + py),
    quadTo: (cx, cy, px, py) => to.quadraticCurveTo(x + cx, y + cy, x + px, y + py),
  };
}

const fontOf = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${s.font}`;

async function pixiPen(host: HTMLElement, width: number, height: number): Promise<Pen> {
  const app = new Application();
  // The canvas's backing store is at the screen's pixel ratio, so the map is
  // sharp on a HiDPI screen; autoDensity keeps its CSS size the host's box.
  await app.init({
    width,
    height,
    background: 0x000000,
    antialias: true,
    resolution: screenRatio(),
    autoDensity: true,
  });
  host.append(app.canvas);
  /**
   * The canvas's CSS size: the host's box, in CSS pixels. PixiJS rounds its
   * own to whole device pixels and leaves it alone when the backing store
   * keeps its size, so the page sets it.
   */
  const cssSize = (w: number, h: number) => {
    app.canvas.style.width = `${w}px`;
    app.canvas.style.height = `${h}px`;
  };
  cssSize(width, height);
  const world = new Container();
  const layers = [new Container(), new Container()];
  world.addChild(...layers);
  app.stage.addChild(world);
  let layer = layers[0];
  const textures = new WeakMap<Picture, Texture>();
  const texture = (pic: Picture) => {
    let t = textures.get(pic);
    if (!t) textures.set(pic, (t = Texture.from(pic)));
    return t;
  };
  const measurer = document.createElement('canvas').getContext('2d')!;
  return {
    canvas: app.canvas,
    begin: (n) => {
      layer = layers[n];
      for (const child of layer.removeChildren()) child.destroy();
    },
    image: (pic, x, y, dim) => {
      const s = new Sprite(texture(pic));
      s.position.set(x, y);
      if (dim) s.tint = 0xcccccc;
      layer.addChild(s);
    },
    diamond: (x, y, color, alpha) => {
      layer.addChild(
        new Graphics().poly([x + W / 2, y, x + W, y + H / 2, x + W / 2, y + H, x, y + H / 2]).fill({ color, alpha }),
      );
    },
    road: (x, y, color, path) => {
      const g = new Graphics();
      path(offset(g, x, y));
      layer.addChild(g.stroke({ width: H / 32, color }));
    },
    rect: (x, y, w, h, color) => {
      layer.addChild(new Graphics().rect(x, y, w, h).fill(color));
    },
    line: (x1, y1, x2, y2, color, width = 1, alpha = 1) => {
      layer.addChild(new Graphics().moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha, cap: 'round' }));
    },
    circle: (x, y, r, fill, outline, outlineAlpha) => {
      layer.addChild(
        new Graphics().circle(x, y, r).fill(fill).stroke({ width: 2, color: outline, alpha: outlineAlpha }),
      );
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
          stroke: style.plain ? undefined : { color: 0x000000, width: 2 },
        },
      });
      t.position.set(center ? x - t.width / 2 : x, y);
      layer.addChild(t);
    },
    measure: (s, style) => {
      measurer.font = fontOf(style);
      return measurer.measureText(s).width;
    },
    show: (dx, dy, scale) => {
      world.scale.set(scale);
      world.position.set(dx, dy);
    },
    // resize() takes CSS pixels: the renderer keeps its own resolution.
    resize: (w, h) => {
      app.renderer.resize(w, h, screenRatio());
      cssSize(w, h);
    },
  };
}

function canvasPen(host: HTMLElement, width: number, height: number, background = true): Pen {
  const canvas = document.createElement('canvas');
  let ratio = screenRatio();
  /** The canvas's backing store at the pixel ratio, its CSS size in CSS pixels. */
  const setSize = (w: number, h: number) => {
    width = w;
    height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const [pw, ph] = backingSize(w, h, ratio);
    canvas.width = pw;
    canvas.height = ph;
  };
  setSize(width, height);
  host.append(canvas);
  const c = canvas.getContext('2d')!;
  // Canvas 2D has no scene graph: record the drawing and replay it to pan.
  const layers: ((c: CanvasRenderingContext2D) => void)[][] = [[], []];
  let calls = layers[0];
  return {
    canvas,
    begin: (n) => {
      calls = layers[n] = [];
    },
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
    road: (x, y, color, path) =>
      calls.push((c) => {
        c.strokeStyle = css(color);
        c.lineWidth = H / 32;
        c.beginPath();
        path(offset(c, x, y));
        c.stroke();
      }),
    rect: (x, y, w, h, color) =>
      calls.push((c) => {
        c.fillStyle = css(color);
        c.fillRect(x, y, w, h);
      }),
    line: (x1, y1, x2, y2, color, width = 1, alpha = 1) =>
      calls.push((c) => {
        c.globalAlpha = alpha;
        c.strokeStyle = css(color);
        c.lineWidth = width;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
        c.globalAlpha = 1;
        c.lineCap = 'butt';
      }),
    circle: (x, y, r, fill, outline, outlineAlpha) =>
      calls.push((c) => {
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.fillStyle = css(fill);
        c.fill();
        c.globalAlpha = outlineAlpha;
        c.strokeStyle = css(outline);
        c.lineWidth = 2;
        c.stroke();
        c.globalAlpha = 1;
      }),
    text: (s, x, y, style, center) =>
      calls.push((c) => {
        c.font = fontOf(style);
        c.textAlign = center ? 'center' : 'left';
        c.textBaseline = 'top';
        if (!style.plain) {
          c.lineWidth = 2;
          c.strokeStyle = '#000';
          c.strokeText(s, x, y);
        }
        c.fillStyle = css(style.color);
        c.fillText(s, x, y);
      }),
    measure: (s, style) => {
      c.font = fontOf(style);
      return c.measureText(s).width;
    },
    show: (dx, dy, scale) => {
      // The transform carries the pixel ratio, so the drawing code works in CSS pixels.
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.fillStyle = '#000';
      if (background) c.fillRect(0, 0, width, height);
      else c.clearRect(0, 0, width, height);
      c.setTransform(scale * ratio, 0, 0, scale * ratio, dx * ratio, dy * ratio);
      for (const layer of layers) for (const call of layer) call(c);
    },
    resize: (w, h) => {
      ratio = screenRatio();
      setSize(w, h);
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

const CHIP: TextStyle = { color: 0, font: 'sans-serif', size: 10, bold: true, plain: true };
const NAME: TextStyle = { color: 0, font: 'serif', size: 13 };
/** TileViewer's fonts: simple-bold-tiny, and simple-bold+italic-smaller to emphasise. */
const POPULATION: TextStyle = { color: 0, font: 'sans-serif', size: 12, bold: true };
const POPULATION_EMPH: TextStyle = { ...POPULATION, size: 14, italic: true };
/** The turns on a path mark, in black: the stroke is black too. */
const PATH_TURNS: TextStyle = { color: 0x000000, font: 'sans-serif', size: 12 };
/** Green for this turn's steps, yellow for later turns'. */
const pathColor = (turns: number) => (turns > 0 ? 0xffff00 : 0x00ff00);

/** Draw operations on a layer, loading what they need first. */
async function paint(pen: Pen, layer: Layer, ops: Op[], pics: ReturnType<typeof pictures>) {
  const images = await Promise.all(
    ops.map((op) =>
      op.k === 'image' ? (op.fade ? pics.gray(op.src) : pics.get(op.src)).catch(() => null) : Promise.resolve(null),
    ),
  );
  /** ImageLibrary.createChip: text on a colour with a black border; returns its width. */
  const chip = (x: number, y: number, text: string, bg: number, fg: number) => {
    const pad = 6;
    const cw = Math.ceil(pen.measure(text, CHIP)) + pad;
    const ch = CHIP.size + pad;
    pen.rect(x, y, cw, ch, 0x000000);
    pen.rect(x + 1, y + 1, cw - 2, ch - 2, bg);
    pen.text(text, x + pad / 2, y + pad / 2 - 1, { ...CHIP, color: fg }, false);
    return cw;
  };
  pen.begin(layer);
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
        return pen.road(ox, oy, op.color, (p) => roadPath(op.dirs, p));
      case 'chip': {
        const x = ox + STATE_OFFSET_X;
        chip(x, oy, op.text, op.bg, op.fg);
        if (op.stack > 1) {
          const x1 = x + OTHER_UNITS_OFFSET_X;
          for (let n = 0; n < Math.min(op.stack, MAX_OTHER_UNITS); n++) {
            pen.line(x1, oy + 1.5 + 2 * n, x1 + OTHER_UNITS_WIDTH, oy + 1.5 + 2 * n, 0xffffff);
          }
        }
        return;
      }
      case 'chips': {
        let x = ox + STATE_OFFSET_X;
        // TileViewer steps by the first chip's width plus 2, whatever the others measure.
        let step = 0;
        for (const c of op.chips) {
          const cw = chip(x, oy + STATE_OFFSET_Y, c.text, shade(c.bg), shade(c.fg));
          step ||= cw + 2;
          x += step;
        }
        return;
      }
      case 'population': {
        const style = op.emph ? POPULATION_EMPH : POPULATION;
        pen.text(
          String(op.population),
          ox + W / 2,
          oy + (H - style.size) / 2,
          { ...style, color: shade(op.color) },
          true,
        );
        return;
      }
      case 'label':
        // The classic colony labels: the name below the tile.
        pen.text(op.name, ox + W / 2 + 1, oy + H, { ...NAME, color: shade(op.rgb) }, true);
        return;
      // MapViewer.displayPath: half-transparent lines 5 wide, then 20-pixel marks.
      case 'pathLine': {
        const [tx, ty] = tileOrigin(...op.to);
        pen.line(ox + W / 2, oy + H / 2, tx + W / 2, ty + H / 2, pathColor(op.turns), 5, 0.5);
        return;
      }
      case 'pathMark':
        pen.circle(ox + W / 2, oy + H / 2, 10, pathColor(op.turns), 0x000000, 0.5);
        if (op.turns > 0) pen.text(String(op.turns), ox + W / 2, oy + H / 2 - PATH_TURNS.size / 2, PATH_TURNS, true);
        return;
    }
  });
}

/** The art manifest from scripts/build-art.mjs. */
interface Art {
  layers: ArtLayer[];
  files: string[];
}

/** A map drawer for `host`, `size` screen pixels to start with, with art under `artBase` listed by its `manifest`; draws are serialised. */
export function mapDrawer(
  host: HTMLElement,
  size: [number, number],
  artBase: string,
  manifest = 'art.json',
  /** Skip PixiJS and draw with Canvas 2D, the fallback, to test it. */
  canvas2d = false,
): {
  draw(map: MapView): Promise<void>;
  /** Show the view: where it is centred, its zoom, the cursor and the active unit's path. */
  show(view: ViewState): void;
  /** Make the canvas `size` screen pixels, as its host's box changed; show() the resized view after. */
  resize(size: [number, number]): void;
  renderer(): string;
  /** The tile under a pixel of the canvas, or null off the map or before the first draw. */
  tileAt(px: number, py: number): [number, number] | null;
  /** The resolver, once the art manifest has loaded. */
  resources(): Resources | null;
  /**
   * Draw some tiles of the map as the map draws them, without units, into a new canvas in `host`, as
   * TileViewer.displayColonyTiles draws the colony panel's tiles: `centre` at (W, H + top) of a canvas
   * 3 tiles wide and 3 high plus `top` above for art taller than its tile. Returns what removes it.
   */
  drawTiles(host: HTMLElement, centre: [number, number], tiles: [number, number][], top: number): () => void;
} {
  let pen: Pen | null = null;
  let res: Resources | null = null;
  let renderer = 'none';
  let drawing = Promise.resolve();
  const pics = pictures(artBase);
  let view: ViewState | null = null;
  /** What the overlay layer shows, to redraw it only when that changes. */
  let shown = '';
  /** The map last drawn, which drawTiles draws from. */
  let drawn: MapView | null = null;

  async function init() {
    const art = (await (await fetch(artBase + manifest)).json()) as Art;
    res = resources(art.layers, art.files);
    // resize() swaps in a new array, so a changed size is a different one.
    const startSize = size;
    let p: Pen;
    try {
      if (canvas2d) throw new Error('asked for canvas2d');
      p = await pixiPen(host, ...startSize);
      renderer = 'pixi';
    } catch (ex) {
      p = canvasPen(host, ...startSize);
      renderer = `canvas2d (pixi failed: ${ex instanceof Error ? ex.message : String(ex)})`;
    }
    // The window may have changed while PixiJS started.
    if (size !== startSize) p.resize(...size);
    pen = p;
  }

  /** The overlay's operations for a view: its cursor, and the path if the map view is about its active unit. */
  const overlayOf = (v: ViewState) => overlay(cursor(v), activeUnitFacts(v)?.path ?? null, res!);

  const camera = () => {
    if (!pen || !view) return;
    const z = view.zoom;
    pen.show(size[0] / 2 - view.centre[0] * z, size[1] / 2 - view.centre[1] * z, z);
  };

  /** Redraw the overlay if it changed, then move the camera. */
  async function showNow() {
    if (!pen || !view) return;
    const ops = overlayOf(view);
    const key = JSON.stringify(ops);
    if (key !== shown) {
      shown = key;
      await paint(pen, 1, ops, pics);
    }
    camera();
  }

  async function drawNow(map: MapView) {
    drawn = map;
    if (!pen) await init();
    await paint(pen!, 0, scene(map, res!), pics);
    await showNow();
  }

  return {
    draw: (map) => (drawing = drawing.then(() => drawNow(map))),
    show: (v) => {
      view = v;
      // Pans and zooms move at once; a changed overlay waits its turn.
      camera();
      drawing = drawing.then(showNow);
    },
    resize: (s) => {
      size = s;
      pen?.resize(...s);
    },
    renderer: () => renderer,
    tileAt: (px, py) => {
      if (!pen || !view?.map) return null;
      const [mx, my] = toMap(view, [px, py]);
      return tileAt(view.map.w, view.map.h, mx, my);
    },
    resources: () => res,
    drawTiles: (host, centre, tiles, top) => {
      const map = drawn;
      const r = res;
      if (!map || !r) return () => {};
      const pen = canvasPen(host, 3 * W, 3 * H + top, false);
      const keep = new Set(tiles.map(([x, y]) => `${x},${y}`));
      // The tiles' terrain, items, roads and settlement; not the units, chips, fog or labels the map adds.
      const ops = scene(map, r).filter(
        (op) => keep.has(`${op.x},${op.y}`) && ((op.k === 'image' && op.at !== 'unit') || op.k === 'road'),
      );
      const [cx, cy] = tileOrigin(...centre);
      void paint(pen, 0, ops, pics).then(() => pen.show(W - cx, H + top - cy, 1));
      return () => pen.canvas.remove();
    },
  };
}
