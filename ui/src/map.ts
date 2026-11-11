// The map in Tileset mode: draws the operations of tileset.ts with
// PixiJS, falling back to Canvas 2D where PixiJS cannot get a renderer (some
// headless browsers). Images load by path from the art/ directory that
// scripts/build-art.ts fills; recipes (FreeCol's masked images) are
// composited once on a canvas and cached by id. The map is FreeCol's: 128x64
// diamonds in staggered rows, odd rows half a tile to the right. It shows
// the part of the map, at the zoom, that the view state (view.ts) says, with
// the cursor and the active unit's path drawn over it.
import {
  AlphaFilter,
  Application,
  CanvasTextMetrics,
  Container,
  Culler,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { Atlas, ChunkLayer, pictureKey, staticDrawing, tilemapBackend } from './map-tilemap';
import { riverDrawing, RiverSurface } from './map-rivers';
import type { FieldReply, FieldRequest } from './water-field.worker';
import {
  canDrawWater,
  coverOf,
  fieldTexel,
  programLinks,
  coverAt,
  paintedWaterAtlas,
  waterField,
  waterLook,
  WaterSurface,
  type WaterField,
  type WaterLook,
} from './map-water';
import { resources, type ArtLayer, type Resources } from './resources';
import {
  FADE,
  isAnimated,
  isCursorMarker,
  NO_MODES,
  overlay,
  passOf,
  scene,
  srcId,
  staticScenes,
  STILL,
  TICK_MS,
  unitOps,
  unitScene,
  viewModeOps,
  debugOverlayOps,
  NO_OVERLAY,
  TINT_ALPHA,
  type ColonyLabels,
  type ViewModes,
  type Direction,
  type MapView,
  type Op,
  type Animated,
  type WaterLayers,
  type Recipe,
  type Src,
  type StaticScene,
  type TerrainAnimation,
  type Ticks,
  type WaterDrawing,
} from './tileset';
import type { ActiveStyle } from './prefs';
import {
  BLINK_MS,
  MOVE_MS,
  blink,
  length,
  path,
  slide,
  stepMs,
  carryOn,
  track,
  type Path,
  type Step,
  type Track,
} from './motion';
import { slideMark } from './timing';
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

/**
 * How many frames of the animated water's composited pictures are kept, the ones drawn most lately: enough for every
 * frame of the beaches and rivers on a screen, without keeping every frame of every one the map has (#408).
 */
export const KEPT_FRAMES = 800;
/** Frames kept for each animated picture on the screen: two of FreeCol's 21-frame cycles, the recipes in them too. */
const FRAMES_EACH = 2 * 21 * 2;

/**
 * Images by path and recipes by id, loaded and composited once; and the animated water's pictures, a canvas each that
 * animate() draws the next frame on (#408).
 */
export function pictures(base: string, load: (path: string) => Promise<Picture> = loadImage(base)) {
  const cache = new Map<string, Promise<Picture>>();
  const compose = async (src: Recipe, get: (src: Src) => Promise<Picture>): Promise<Picture> => {
    const c = canvas(W, H);
    const g = c.getContext('2d')!;
    for (const step of src.steps) {
      if ('mask' in step || 'cut' in step) {
        g.globalCompositeOperation = 'mask' in step ? 'destination-in' : 'destination-out';
        g.drawImage(await get('mask' in step ? step.mask : step.cut), 0, 0, W, H);
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
    if (isAnimated(src)) return live(src);
    const id = srcId(src);
    let p = cache.get(id);
    if (!p) cache.set(id, (p = typeof src === 'string' ? file(src) : compose(src, get)));
    return p;
  };
  /** An image file, or one of the masks made here rather than loaded (tileset.ts fadeFrom). */
  const file = (path: string): Promise<Picture> =>
    path.startsWith(FADE) ? Promise.resolve(fadeMask(path.slice(FADE.length) as Direction)) : load(path);

  /**
   * The animated water's frames, composited, by id, the most lately drawn last: the frames and the recipes they are
   * made of (an ocean frame masked to a beach's shape, which beaches of the same frame share). The images they are
   * made of are kept for good, as all images are.
   */
  const frames = new Map<string, Promise<Picture>>();
  /** How many frames are kept: KEPT_FRAMES, or more for more animated pictures on the screen, two cycles of each. */
  let keptFrames = KEPT_FRAMES;
  const frame = (src: Src): Promise<Picture> => {
    if (typeof src === 'string') return get(src);
    if (isAnimated(src)) throw new Error(`an animated picture in a frame: ${src.id}`);
    let p = frames.get(src.id);
    if (p) frames.delete(src.id);
    else p = compose(src, (s) => (typeof s === 'string' ? get(s) : compose(s as Recipe, frame)));
    frames.set(src.id, p);
    for (const id of frames.keys()) {
      if (frames.size <= keptFrames) break;
      frames.delete(id);
    }
    return p;
  };
  /**
   * A river's or delta's picture at a tick, drawn straight on its canvas (#410): the water's frame, kept
   * in the shape (which has the water's alpha); the pebbles under it; the whole kept in the fade and the tile. The shape, pebbles and fade are
   * the same canvases for every frame, so a frame costs no canvas of its own.
   */
  const paint = async (c: HTMLCanvasElement, l: WaterLayers, t: Ticks): Promise<HTMLCanvasElement> => {
    const [water, shape, under, keep] = await Promise.all([get(l.water(t)), get(l.shape), get(l.under), get(l.keep)]);
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'copy';
    g.drawImage(water, 0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(shape, 0, 0, W, H);
    g.globalCompositeOperation = 'destination-over';
    g.drawImage(under, 0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(keep, 0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return c;
  };
  const tickKey = (t: Ticks) => `${t.water}:${t.river}`;
  /** Each animated picture's canvas, and the frame it shows. */
  const lives = new Map<string, Promise<HTMLCanvasElement>>();
  const liveOf = new WeakMap<Picture, { anim: Animated; shows: string }>();
  /** The frame the animated pictures show now: new ones start at it. */
  let ticks: Ticks = STILL;
  const live = (anim: Animated): Promise<HTMLCanvasElement> => {
    let p = lives.get(anim.id);
    if (!p) {
      const at = ticks;
      p = (
        anim.layers
          ? paint(canvas(W, H), anim.layers, at)
          : frame(anim.animate(at)).then((pic) => {
              const c = canvas(pic.width, pic.height);
              c.getContext('2d')!.drawImage(pic, 0, 0);
              return c;
            })
      ).then((c) => {
        liveOf.set(c, { anim, shows: tickKey(at) });
        return c;
      });
      lives.set(anim.id, p);
    }
    return p;
  };
  /**
   * Show the animated pictures among `shown` at frame `t`: each one not at it yet is drawn again, on its own canvas,
   * the one every tile it is on draws. Returns those drawn again.
   */
  const animate = async (t: Ticks, shown: Iterable<Picture>): Promise<Picture[]> => {
    ticks = t;
    const key = tickKey(t);
    const due: [HTMLCanvasElement, { anim: Animated; shows: string }][] = [];
    let live = 0;
    for (const pic of new Set(shown)) {
      const l = liveOf.get(pic);
      if (l) live++;
      if (l && l.shows !== key) due.push([pic as HTMLCanvasElement, l]);
    }
    keptFrames = Math.max(KEPT_FRAMES, live * FRAMES_EACH);
    const next = await Promise.all(
      due.map(([c, l]) => (l.anim.layers ? paint(c, l.anim.layers, t) : frame(l.anim.animate(t)))),
    );
    due.forEach(([c, l], i) => {
      // A layered picture is drawn already.
      if (!l.anim.layers) {
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(next[i], 0, 0);
      }
      l.shows = key;
    });
    return due.map(([c]) => c);
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
  /** Let go of the animated pictures the scene no longer has (another map's, ground explored over). */
  const retain = (ops: Op[]) => {
    const ids = new Set(ops.flatMap((op) => (op.k === 'image' && isAnimated(op.src) ? [op.src.id] : [])));
    for (const id of lives.keys()) if (!ids.has(id)) lives.delete(id);
  };
  return { get, gray, animate, retain, kept: () => frames.size, live: () => lives.size };
}

const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/**
 * tileset.ts fadeFrom: a tile's mask, opaque along its side facing `d` (NE, SE, SW or NW), fading at right angles to
 * that side to nothing at the line through the tile's centre, so the whole side is as opaque.
 */
function fadeMask(d: Direction): HTMLCanvasElement {
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  const [[ax, ay], [bx, by]] = SIDES[d as keyof typeof SIDES];
  const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
  // The side's normal, pointing into the tile, as long as the way from the side to the centre.
  const len = Math.hypot(bx - ax, by - ay);
  let [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
  if (nx * (W / 2 - mx) + ny * (H / 2 - my) < 0) [nx, ny] = [-nx, -ny];
  const dist = nx * (W / 2 - mx) + ny * (H / 2 - my);
  const fade = g.createLinearGradient(mx, my, mx + nx * dist, my + ny * dist);
  fade.addColorStop(0.1, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  return c;
}

/** An image file under `base`, decoded. */
const loadImage = (base: string) => (path: string) => {
  const img = new Image();
  img.src = base + path;
  return img.decode().then(() => img);
};

interface TextStyle {
  color: number;
  font: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  /** Black outline round the glyphs; off for text on a chip, whose own border frames it. */
  plain?: boolean;
}

/**
 * The map's layers: the scene under the units, the cursor and path over it, the units that move or blink, the cover
 * being lifted off ground just explored, the animated water and rivers under the scene (5), the other units (6), and
 * the scene over the units (7). A move that changes only units draws 6 and 2 again, and leaves the rest of the scene.
 */
type Layer = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/**
 * The order the layers are stacked in, bottom first: the animated base tiles (5) under all, as MapViewer paints them
 * first, then the scene with the units between its two parts, and the unit cursor (4) between the overlay and the
 * units that move or blink.
 */
const STACK: readonly Layer[] = [5, 0, 6, 7, 1, 4, 2, 3];

/** The animated base: the water and rivers, which MapViewer paints first. */
const BASE_LAYER: Layer = 5;

/** The layers drawn only when the static scene changes: the animated base, the scene under the units and over them. */
const STATIC_LAYERS: readonly Layer[] = [5, 0, 7];

/** The screen's pixel ratio: how many device pixels a CSS pixel covers. */
export const pixelRatio = (dpr: number | undefined): number => (dpr && dpr > 0 ? dpr : 1);

/** The canvas's backing store size, in device pixels, for a CSS size at a pixel ratio. */
export const backingSize = (w: number, h: number, ratio: number): [number, number] => [
  Math.round(w * ratio),
  Math.round(h * ratio),
];

/** The screen's pixel ratio now, which a window moving to another screen can change. */
const screenRatio = (): number => pixelRatio(window.devicePixelRatio);

/** What draws the shader water under the map (map-water.ts). */
export interface WaterPen {
  /** The biggest field, in texels across or down, the GPU takes. */
  readonly maxField: number;
  /**
   * Draw the water in this look under the map from now on, painting `art` (FreeCol's water art, paintedWaterAtlas);
   * false if the GPU cannot build its shader.
   */
  start(look: WaterLook, art: Picture): boolean;
  /** The water's field of the map now. */
  field(f: WaterField): void;
  /** Move the water to where it is at `ms`, and the rivers' ripples if `riversMoving`, and draw the map again. */
  time(ms: number, riversMoving?: boolean): void;
  /** Draw these rivers over the water from now on, or none; false if the GPU cannot build their shader. */
  rivers?(next: RiverSurface | null): boolean;
}

/** What draws the map: a PixiJS scene graph or a Canvas 2D context. */
interface Pen {
  readonly canvas: HTMLCanvasElement;
  /** What draws it, for the page's renderer() (the browser scripts print it). */
  readonly name?: string;
  /** Clear a layer, and draw on it from now on. */
  begin(layer: Layer): void;
  /** The tile and pass (tileset.ts passOf) the draws after this belong to, which a pen drawing in chunks needs. */
  tile?(x: number, y: number, pass: number): void;
  /** `tile`: a whole tile's picture, which the pen overlaps its neighbours by a device pixel when the map is scaled between pixels. */
  image(pic: Picture, x: number, y: number, dim: boolean, tile?: boolean): void;
  /** The pictures of a layer on the screen, which the animated water draws the next frame of (#408). */
  shown(layer: Layer): Iterable<Picture>;
  /** A count that moves on when more of a layer comes on the screen, whose pictures may show an old frame. */
  shownVersion(layer: Layer): number;
  /** These pictures' pixels changed: draw them again. */
  redrawn(pics: Picture[]): void;
  diamond(x: number, y: number, color: number, alpha: number): void;
  /** `key`: what the path is, the same for the same path, so a pen may draw it once as a picture. */
  road(
    x: number,
    y: number,
    color: number,
    path: (p: PathSink) => void,
    width?: number,
    alpha?: number,
    key?: string,
  ): void;
  rect(x: number, y: number, w: number, h: number, color: number, alpha?: number): void;
  line(x1: number, y1: number, x2: number, y2: number, color: number, width?: number, alpha?: number): void;
  /** Polylines with rounded corners, stroked as one shape so their overlaps don't darken. */
  outline(paths: Polyline[], color: number, width: number, alpha: number): void;
  /** A filled circle of radius r with a 2-pixel outline. */
  circle(x: number, y: number, r: number, fill: number, outline: number, outlineAlpha: number): void;
  /** Text with a black outline, its top centred on (x, y) or starting there. */
  text(s: string, x: number, y: number, style: TextStyle, center: boolean): void;
  /** Text with its ink (the glyphs as drawn, not the font's box) centred on (x, y), such as a number in a circle. */
  label(s: string, x: number, y: number, style: TextStyle): void;
  measure(s: string, style: TextStyle): number;
  /** Move the third layer by (dx, dy) map pixels and fade it to `alpha`. */
  actors(dx: number, dy: number, alpha: number): void;
  /** Fade the fifth layer, FreeCol's blinking unit cursor, to `alpha`. */
  marker(alpha: number): void;
  /** Fade the fourth layer, the cover being lifted off ground just explored, to `alpha`. */
  fade(alpha: number): void;
  /** Show the map scaled by `scale`, then moved by (dx, dy). */
  show(dx: number, dy: number, scale: number): void;
  /** The shader water (#409), on a pen that can draw it: none on the Canvas 2D pen or PixiJS's Canvas renderer. */
  readonly water?: WaterPen;
  /** Make the canvas `width` by `height` CSS pixels; show() draws it again. */
  resize(width: number, height: number): void;
}

/**
 * The map grid's line: MapViewer strokes it black, one pixel wide. Each tile draws all four sides, so a side shared
 * by two tiles is drawn twice and shows at about twice this alpha: a thin, low-contrast line.
 */
const GRID_WIDTH = 1;
const GRID_ALPHA = 0.2;

/** The room round a shape drawn as a picture for the tilemap's atlas, for a stroke past the tile's edge. */
const SHAPE_PAD = 4;

/**
 * How much wider and taller than itself a tile's picture is drawn, in map pixels, at a scale `k` (the map's, times
 * the screen's pixel ratio). The pictures are hard-edged diamonds that meet exactly at whole pixels; at any other
 * scale the edge pixels are covered partly by each of two tiles, which leaves the black behind the map showing as a
 * faint line along every tile. A device pixel and a half of overlap hides it.
 */
export function seamBleed(k: number): number {
  return Math.abs(k - Math.round(k)) < 1e-3 ? 0 : 1.5 / k;
}

/** Points in map pixels; a closed one ends where it starts, without repeating the first point. */
export interface Polyline {
  pts: [number, number][];
  closed: boolean;
}

/** How far back from a corner a border's rounding starts, as a share of the shorter side at it. */
const BORDER_ROUNDING = 0.35;

/** A polyline whose corners are cut by quadratic curves, BORDER_ROUNDING of the way along each side. */
function roundedPath(p: PathSink, { pts, closed }: Polyline) {
  const n = pts.length;
  if (n < 2) return;
  const toward = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const corner = (i: number) => {
    const [prev, at, next] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]];
    return { at, from: toward(at, prev, BORDER_ROUNDING), to: toward(at, next, BORDER_ROUNDING) };
  };
  if (closed) {
    const first = corner(0);
    p.moveTo(...first.to);
    for (let i = 1; i <= n; i++) {
      const c = i === n ? first : corner(i);
      p.lineTo(...c.from);
      p.quadTo(...c.at, ...c.to);
    }
  } else {
    p.moveTo(...pts[0]);
    for (let i = 1; i < n - 1; i++) {
      const c = corner(i);
      p.lineTo(...c.from);
      p.quadTo(...c.at, ...c.to);
    }
    p.lineTo(...pts[n - 1]);
  }
}

/**
 * Join the owners' border sides into polylines, one list per colour: a side meeting another at a
 * corner continues into it, so a border is one stroke rather than a row of sides with dots where
 * their round ends overlap.
 */
export function borderPaths(ops: { x: number; y: number; sides: string[]; rgb: number }[]): Map<number, Polyline[]> {
  const byColor = new Map<number, [string, string][]>();
  const points = new Map<string, [number, number]>();
  const key = (x: number, y: number) => {
    const k = `${x},${y}`;
    points.set(k, [x, y]);
    return k;
  };
  for (const op of ops) {
    const [ox, oy] = tileOrigin(op.x, op.y);
    let segs = byColor.get(op.rgb);
    if (!segs) byColor.set(op.rgb, (segs = []));
    for (const d of op.sides) {
      const [a, b] = SIDES[d as 'NE' | 'SE' | 'SW' | 'NW'];
      segs.push([key(ox + a[0], oy + a[1]), key(ox + b[0], oy + b[1])]);
    }
  }
  const out = new Map<number, Polyline[]>();
  for (const [rgb, segs] of byColor) {
    const at = new Map<string, number[]>();
    segs.forEach(([a, b], i) => {
      for (const k of [a, b]) {
        const l = at.get(k);
        if (l) l.push(i);
        else at.set(k, [i]);
      }
    });
    const used = segs.map(() => false);
    const free = (k: string) => (at.get(k) ?? []).filter((i) => !used[i]);
    const walk = (start: string): Polyline => {
      const keys = [start];
      let end = start;
      for (;;) {
        const next = free(end)[0];
        if (next === undefined) break;
        used[next] = true;
        const [a, b] = segs[next];
        end = a === end ? b : a;
        keys.push(end);
      }
      const closed = keys.length > 2 && end === start;
      if (closed) keys.pop();
      return { pts: keys.map((k) => points.get(k)!), closed };
    };
    const paths: Polyline[] = [];
    // Open ends first (an odd count of sides meets there), so each open border is one polyline.
    for (const [k, l] of at) if (l.length % 2) while (free(k).length) paths.push(walk(k));
    segs.forEach(([a], i) => {
      if (!used[i]) paths.push(walk(a));
    });
    out.set(rgb, paths);
  }
  return out;
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

/**
 * The canvas's pixels per CSS pixel at FreeCol's graphics quality: the screen's at normal and above,
 * one at the lowest.
 */
const ratioAt = (quality: number): number => (quality <= 0 ? 1 : screenRatio());

/** A Text with a black outline, its top centred on (x, y) or starting there. */
/**
 * Where to draw `s` so its ink is centred on (x, y): the left end of its alphabetic baseline. The font's box puts
 * a digit's ink below its middle, so centring the box leaves a number low in its circle.
 */
function inkCentred(c: CanvasRenderingContext2D, s: string, x: number, y: number, style: TextStyle) {
  c.font = fontOf(style);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  const m = c.measureText(s);
  return {
    left: x - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
    baseline: y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
  };
}

function makeText(s: string, x: number, y: number, style: TextStyle, center: boolean): Text {
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
  return t;
}

async function pixiPen(host: HTMLElement, width: number, height: number, quality: number): Promise<Pen> {
  const app = new Application();
  // The canvas's backing store is at the screen's pixel ratio, so the map is
  // sharp on a HiDPI screen; autoDensity keeps its CSS size the host's box.
  await app.init({
    width,
    height,
    background: 0x000000,
    // FreeCol's graphics quality: low and lowest draw without antialiasing.
    antialias: quality >= 20,
    resolution: ratioAt(quality),
    autoDensity: true,
    // No render loop: the map is drawn only when something on it changed (see redraw).
    autoStart: false,
  });
  app.ticker.stop();
  // The page handles the pointer itself (pointer.ts): PixiJS need not hit-test the map's objects on every move.
  app.stage.eventMode = 'none';
  app.stage.interactiveChildren = false;
  host.append(app.canvas);
  let queued = 0;
  /**
   * What to cull again before the next draw, as what is on the screen may have changed: everything when the camera
   * moved, a layer when it was drawn. Culling walks every object it is given, and a slide, a blink or the water's
   * next frame changes nothing of what is on the screen.
   */
  let cullAll = true;
  const toCull = new Set<Container>();
  /**
   * How far past the screen's edges the map is culled, in screen pixels, and where the map was then: a pan within half
   * of it culls nothing again (#407). Culling walks every unit, cursor and label on the map, which on a big map cost
   * more than a frame on a slow machine.
   */
  const MARGIN = 400;
  let culledAt: { x: number; y: number; scale: number; w: number; h: number } | null = null;
  /** How many times the whole map was culled: what the sprites on the screen may have changed with. */
  let culls = 0;
  /** Draw the map at the next frame, once however many changes come before it; what lies off the screen is skipped. */
  const redraw = (cull: Container | 'all' | null = 'all', camera = false) => {
    if (cull === 'all') {
      // A camera move within MARGIN / 2 of where the map was last culled, at the same scale and size, culls nothing
      // again, as what is on the screen now was in the margin then.
      const s = app.renderer.screen;
      const near =
        camera &&
        culledAt !== null &&
        culledAt.scale === world.scale.x &&
        culledAt.w === s.width &&
        culledAt.h === s.height &&
        Math.abs(world.position.x - culledAt.x) <= MARGIN / 2 &&
        Math.abs(world.position.y - culledAt.y) <= MARGIN / 2;
      if (!near) cullAll = true;
    } else if (cull) toCull.add(cull);
    queued ||= requestAnimationFrame(() => {
      queued = 0;
      settle();
      const s = app.renderer.screen;
      const area = new Rectangle(s.x - MARGIN, s.y - MARGIN, s.width + 2 * MARGIN, s.height + 2 * MARGIN);
      if (cullAll) {
        culledAt = { x: world.position.x, y: world.position.y, scale: world.scale.x, w: s.width, h: s.height };
        culls++;
      }
      // A hidden layer is left as it was culled: showing it again culls it (fade).
      for (const c of cullAll ? layers : toCull) if (c.visible) Culler.shared.cull(c, area, false);
      cullAll = false;
      toCull.clear();
      app.render();
    });
  };
  /**
   * The layer being drawn: what it is drawn with this time, in order, and what it held before, by what each one
   * shows. A map from the Engine mostly draws what was there already, so an object drawn again in the same place is
   * kept rather than made again (a Text is drawn to a texture of its own), and a layer that comes out the same is
   * left as it was, so PixiJS need not gather its draws again.
   */
  let drawing: { layer: Container; objects: Container[]; spare: Map<string, Container[]> } | null = null;
  /** Put what the layer being drawn holds now in place, and destroy what it held that was not drawn again. */
  const settle = () => {
    if (collecting) {
      const c = collecting;
      collecting = null;
      c.end();
      chunkView();
      redraw(null);
      return;
    }
    if (!drawing) return;
    const { layer, objects, spare } = drawing;
    drawing = null;
    const old = layer.children;
    if (objects.length !== old.length || objects.some((o, i) => o !== old[i])) {
      layer.removeChildren();
      if (objects.length) layer.addChild(...objects);
      redraw(layer);
    }
    for (const left of spare.values()) for (const o of left) o.destroy();
  };
  /** Draw an object on the layer being drawn, culled when off the screen: the one it held showing `key`, else `make`'s. */
  const add = (key: string | null, make: () => Container) => {
    if (collecting) {
      const [ox, oy] = tileOrigin(...at);
      collecting.push(at, pass, {
        key: key ?? `?${unkeyed++}`,
        x: ox,
        y: oy,
        dim: false,
        tile: false,
        make,
        // Room for labels and chips that spill off their tile.
        box: [ox - W, oy - 2 * H, 3 * W, 4 * H],
      });
      return;
    }
    const o = (key !== null && drawing?.spare.get(key)?.pop()) || make();
    o.cullable = true;
    if (drawing) drawing.objects.push(o);
    else {
      layer.addChild(o);
      redraw(layer);
    }
  };
  /** What an object shows, to find it again: its kind and what it was drawn with. */
  const keys = new WeakMap<Container, string>();
  const keyed = <T extends Container>(key: string, o: T): T => {
    keys.set(o, key);
    return o;
  };
  /** The camera, the actors' offset and the layers' alphas last drawn: setting them again draws nothing. */
  let shown = '';
  let actorsAt = '';
  let markerAlpha = -1;
  let fadeAlpha = -1;
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
  // Each layer its own render group: moving or fading one (the slide, the blink) does not rebuild the others' draws.
  const layers = Array.from({ length: 8 }, () => new Container({ isRenderGroup: true }));
  // The actors are few and slide off the tile they were culled at: they are never culled.
  layers[2].cullableChildren = false;
  world.addChild(...STACK.map((n) => layers[n]));
  app.stage.addChild(world);
  let layer = layers[0];
  const textures = new WeakMap<Picture, Texture>();
  /** What each picture's sprite shows, for the animated water to find the pictures on the screen. */
  const spritePics = new WeakMap<Container, Picture>();
  const texture = (pic: Picture) => {
    let t = textures.get(pic);
    if (!t) textures.set(pic, (t = Texture.from(pic)));
    return t;
  };
  const measurer = document.createElement('canvas').getContext('2d')!;
  /**
   * A length rounded to whole device pixels at `scale`: the world's place, and the actors' offset within it, so a
   * sliding unit lands on the same pixels as the map under it and the pixel art stays as sharp as when it rests.
   */
  const snap = (n: number, scale: number) => {
    const k = scale * app.renderer.resolution;
    return Math.round(n * k) / k;
  };
  /** The tile sprites that overlap their neighbours, and so are resized when the map's scale changes. */
  const bleeding = new Set<Sprite>();
  const bleed = (s: Sprite) => {
    const b = seamBleed(world.scale.x * app.renderer.resolution);
    s.position.set(s.x + (s.width - W) / 2 - b / 2, s.y + (s.height - H) / 2 - b / 2);
    s.width = W + b;
    s.height = H + b;
  };
  // On WebGL, the static layers (the animated base, the scene under the units and over them) as tilemaps per chunk
  // (map-tilemap.ts); on PixiJS's Canvas or WebGPU renderer, as sprites like the other layers.
  const chunkLayers = new Map<Layer, ChunkLayer>();
  const scaleK = () => world.scale.x * app.renderer.resolution;
  const atlas = staticDrawing(app.renderer) === 'tilemap' ? new Atlas() : null;
  // The animated base on pages of its own, smaller ones: the water's next frame sends its pages to the GPU again.
  const baseAtlas = atlas ? new Atlas(1024) : null;
  /** A picture of a shape on a tile, drawn once, for the tilemap's atlas: the fog's diamond, a road. */
  const shapes = new Map<string, HTMLCanvasElement>();
  const shape = (key: string, draw: (g: CanvasRenderingContext2D) => void) => {
    let c = shapes.get(key);
    if (!c) {
      c = Object.assign(document.createElement('canvas'), { width: W + 2 * SHAPE_PAD, height: H + 2 * SHAPE_PAD });
      const g = c.getContext('2d')!;
      g.translate(SHAPE_PAD, SHAPE_PAD);
      draw(g);
      shapes.set(key, c);
    }
    return c;
  };
  if (atlas && baseAtlas) {
    const backend = tilemapBackend(atlas, dimmed, seamBleed);
    for (const n of STATIC_LAYERS)
      chunkLayers.set(
        n,
        new ChunkLayer(layers[n], n === BASE_LAYER ? tilemapBackend(baseAtlas, dimmed, seamBleed) : backend),
      );
  }
  /** The static layer being drawn in chunks, the tile its draws belong to, and a count to key what has no key. */
  let collecting: ChunkLayer | null = null;
  let at: [number, number] = [0, 0];
  let pass = 0;
  let unkeyed = 0;
  const pushImage = (pic: Picture, x: number, y: number, dim: boolean, tile: boolean) => {
    const whole = tile && pic.width === W && pic.height === H;
    collecting!.push(at, pass, {
      key: pictureKey(pic, x, y, dim),
      pic,
      x,
      y,
      dim,
      tile: whole,
      box: whole ? [x - 4, y - 4, W + 8, H + 8] : [x, y, pic.width, pic.height],
    });
  };
  /**
   * Tell the chunks what is on the screen, in map pixels, what to keep built round it, and what to build ahead when
   * the page is idle: a quarter of the screen past each edge, within what is kept.
   */
  const chunkView = () => {
    if (!chunkLayers.size) return;
    const k = world.scale.x;
    const s = app.renderer.screen;
    const x = -world.position.x / k;
    const y = -world.position.y / k;
    const [w, h] = [s.width / k, s.height / k];
    const view = new Rectangle(x - 32, y - 32, w + 64, h + 64);
    const keep = new Rectangle(x - w / 2, y - h / 2, 2 * w, 2 * h);
    const ahead = new Rectangle(x - w / 4, y - h / 4, 1.5 * w, 1.5 * h);
    for (const c of chunkLayers.values()) c.setView(view, keep, ahead);
  };
  /** The shader water, under the animated base, once start() gives it a look. */
  let surface: WaterSurface | null = null;
  let rivers: RiverSurface | null = null;
  const gl = atlas ? (app.renderer as unknown as { gl: WebGLRenderingContext }).gl : null;
  const water: WaterPen | undefined =
    gl && canDrawWater(gl)
      ? {
          maxField: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
          start: (look, art) => {
            surface?.surface.destroy();
            surface = new WaterSurface(look, art);
            const mesh = surface.surface.mesh;
            let ok = programLinks(gl, surface.surface.program);
            if (ok) {
              // A first draw with it, now, and WebGL's word on it: PixiJS only logs what goes wrong there.
              // Under the animated base (5), which draws the coasts' sand over it.
              world.addChildAt(mesh, world.getChildIndex(layers[5]));
              // The clipped beach: the water drawn again right over the sand (5), under the scene's transitions (0).
              const over = surface.surface.overlay;
              const overProgram = surface.surface.overlayProgram;
              if (over && overProgram) {
                ok = programLinks(gl, overProgram);
                if (ok) world.addChildAt(over, world.getChildIndex(layers[5]) + 1);
              }
              for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
              app.render();
              ok = !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
            }
            if (!ok) {
              world.removeChild(mesh);
              if (surface.surface.overlay) world.removeChild(surface.surface.overlay);
              surface.surface.destroy();
              surface = null;
              return false;
            }
            redraw(null);
            return true;
          },
          field: (f) => {
            surface?.surface.setField(f);
            rivers?.surface.setField(f);
            redraw(null);
          },
          time: (ms, riversMoving = false) => {
            surface?.setTime(ms);
            rivers?.setTime(ms, riversMoving);
            redraw(null);
          },
          rivers: (next) => {
            rivers?.surface.destroy();
            rivers = null;
            if (next) {
              if (!programLinks(gl, next.surface.program)) {
                next.surface.destroy();
                return false;
              }
              rivers = next;
              world.addChildAt(next.surface.mesh, world.getChildIndex(layers[0]));
            }
            redraw(null);
            return true;
          },
        }
      : undefined;
  return {
    canvas: app.canvas,
    name: atlas ? 'pixi' : `pixi (${app.renderer.name}: sprites)`,
    water,
    tile: (x, y, p) => {
      at = [x, y];
      pass = p;
    },
    begin: (n) => {
      settle();
      const chunks = chunkLayers.get(n);
      if (chunks) {
        layer = layers[n];
        collecting = chunks;
        chunks.begin();
        return;
      }
      layer = layers[n];
      const spare = new Map<string, Container[]>();
      // Popped from the end: the last of the same kind drawn before is found first, so keep them in reverse.
      for (const o of layer.children.toReversed()) {
        const key = keys.get(o);
        if (key === undefined) continue;
        const same = spare.get(key);
        if (same) same.push(o);
        else spare.set(key, [o]);
      }
      // What has no key is not kept; it is destroyed with the rest left over.
      const unkeyed = layer.children.filter((o) => !keys.has(o));
      if (unkeyed.length) spare.set('', unkeyed);
      drawing = { layer, objects: [], spare };
      redraw(layer);
    },
    image: (pic, x, y, dim, tile) => {
      if (collecting) return pushImage(pic, x, y, dim, !!tile);
      const t = texture(pic);
      const key = `i${t.uid},${x},${y},${dim}`;
      add(key, () => {
        const s = keyed(key, new Sprite(t));
        spritePics.set(s, pic);
        s.position.set(x, y);
        if (dim) s.tint = 0xcccccc;
        if (tile && pic.width === W && pic.height === H) {
          bleeding.add(s);
          bleed(s);
        }
        return s;
      });
    },
    shown: (n) => {
      const chunks = chunkLayers.get(n);
      if (chunks) return chunks.shownPictures();
      const pics = new Set<Picture>();
      for (const s of layers[n].children) {
        const pic = !s.culled && spritePics.get(s);
        if (pic) pics.add(pic);
      }
      return pics;
    },
    shownVersion: (n) => chunkLayers.get(n)?.shownVersion ?? culls,
    redrawn: (pics) => {
      for (const a of [atlas, baseAtlas]) a?.repaint(pics);
      for (const pic of pics) textures.get(pic)?.source.update();
      redraw(null);
    },
    diamond: (x, y, color, alpha) => {
      if (collecting && atlas) {
        const pic = shape(`d${color},${alpha}`, (g) => {
          g.globalAlpha = alpha;
          g.fillStyle = css(color);
          g.beginPath();
          g.moveTo(W / 2, 0);
          g.lineTo(W, H / 2);
          g.lineTo(W / 2, H);
          g.lineTo(0, H / 2);
          g.fill();
        });
        return pushImage(pic, x - SHAPE_PAD, y - SHAPE_PAD, false, false);
      }
      const key = `d${x},${y},${color},${alpha}`;
      add(key, () =>
        keyed(
          key,
          new Graphics().poly([x + W / 2, y, x + W, y + H / 2, x + W / 2, y + H, x, y + H / 2]).fill({ color, alpha }),
        ),
      );
    },
    road: (x, y, color, path, width = H / 32, alpha = 1, key) => {
      if (collecting && atlas && key) {
        const pic = shape(`r${key},${color},${width},${alpha}`, (g) => {
          g.globalAlpha = alpha;
          g.strokeStyle = css(color);
          g.lineWidth = width;
          g.beginPath();
          path(offset(g, 0, 0));
          g.stroke();
        });
        return pushImage(pic, x - SHAPE_PAD, y - SHAPE_PAD, false, false);
      }
      add(null, () => {
        const g = new Graphics();
        path(offset(g, x, y));
        return g.stroke({ width, color, alpha });
      });
    },
    rect: (x, y, w, h, color, alpha = 1) => {
      const key = `r${x},${y},${w},${h},${color},${alpha}`;
      add(key, () => keyed(key, new Graphics().rect(x, y, w, h).fill({ color, alpha })));
    },
    line: (x1, y1, x2, y2, color, width = 1, alpha = 1) => {
      const key = `l${x1},${y1},${x2},${y2},${color},${width},${alpha}`;
      add(key, () =>
        keyed(key, new Graphics().moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha, cap: 'round' })),
      );
    },
    outline: (paths, color, width, alpha) => {
      const g = new Graphics();
      for (const path of paths) {
        roundedPath(offset(g, 0, 0), path);
        if (path.closed) g.closePath();
      }
      // Stroked opaque and faded as a whole: a stroke's own overlaps would otherwise blend twice.
      g.stroke({ width, color, cap: 'round', join: 'round' });
      g.filters = [new AlphaFilter({ alpha })];
      add(null, () => g);
    },
    circle: (x, y, r, fill, outline, outlineAlpha) => {
      const key = `c${x},${y},${r},${fill},${outline},${outlineAlpha}`;
      add(key, () =>
        keyed(key, new Graphics().circle(x, y, r).fill(fill).stroke({ width: 2, color: outline, alpha: outlineAlpha })),
      );
    },
    text: (s, x, y, style, center) => {
      const key = `t${s}|${JSON.stringify(style)},${x},${y},${center}`;
      add(key, () => keyed(key, makeText(s, x, y, style, center)));
    },
    label: (s, x, y, style) => {
      const key = `l${s}|${JSON.stringify(style)},${x},${y}`;
      add(key, () => {
        const t = makeText(s, 0, 0, style, false);
        // Pixi draws the baseline the font's ascent (and half the outline) below the text's top.
        const { left, baseline } = inkCentred(measurer, s, x, y, style);
        const edge = style.plain ? 0 : 1;
        t.position.set(left - edge, baseline - CanvasTextMetrics.measureText(s, t.style).fontProperties.ascent - edge);
        return keyed(key, t);
      });
    },
    measure: (s, style) => {
      measurer.font = fontOf(style);
      return measurer.measureText(s).width;
    },
    actors: (dx, dy, alpha) => {
      [dx, dy] = [snap(dx, world.scale.x), snap(dy, world.scale.x)];
      const key = `${dx},${dy},${alpha}`;
      if (key === actorsAt) return;
      actorsAt = key;
      layers[2].position.set(dx, dy);
      layers[2].alpha = alpha;
      redraw(null);
    },
    fade: (alpha) => {
      if (alpha === fadeAlpha) return;
      fadeAlpha = alpha;
      layers[3].alpha = alpha;
      // Faded out, the cover is hidden: PixiJS would still draw it, and cull it at each pan, and after a big reveal
      // (the whole map at once) it is thousands of pictures (#419).
      const shown = alpha > 0;
      const again = shown && !layers[3].visible;
      layers[3].visible = shown;
      redraw(again ? layers[3] : null);
    },
    marker: (alpha) => {
      if (alpha === markerAlpha) return;
      markerAlpha = alpha;
      layers[4].alpha = alpha;
      redraw(null);
    },
    show: (dx, dy, scale) => {
      const key = `${dx},${dy},${scale}`;
      if (key === shown) return;
      shown = key;
      const rescaled = world.scale.x !== scale;
      world.scale.set(scale);
      if (rescaled)
        for (const s of bleeding) {
          if (s.destroyed) bleeding.delete(s);
          else bleed(s);
        }
      world.position.set(snap(dx, 1), snap(dy, 1));
      if (rescaled) for (const c of chunkLayers.values()) c.rescale(scaleK());
      chunkView();
      redraw('all', !rescaled);
    },
    // resize() takes CSS pixels: the renderer keeps its own resolution.
    resize: (w, h) => {
      app.renderer.resize(w, h, ratioAt(quality));
      cssSize(w, h);
      chunkView();
      redraw();
    },
  };
}

/**
 * How the map draws its water: the shader water when the Tileset has a look for it and the pen can draw it, its
 * ripples load, and the GPU builds its shader; else FreeCol's frames (#408), as on a netbook whose GPU cannot.
 */
export async function waterDrawingFor(
  look: WaterLook | null,
  water: WaterPen | undefined,
  /** FreeCol's ocean, high seas and lake art, unprojected (paintedWaterAtlas), which the shader paints. */
  art: () => Promise<Picture>,
): Promise<WaterDrawing> {
  if (!look || !water) return 'flipbook';
  try {
    if (water.start(look, await art())) return 'surface';
    console.warn("the GPU could not build the shader water's shader; the water is drawn from its frames");
  } catch (ex) {
    console.warn('the shader water could not start; the water is drawn from its frames', ex);
  }
  return 'flipbook';
}

/** Each picture's dimmed copy (ImageLibrary's darker tiles of fog), made on first use. */
const dimmedCopies = new WeakMap<Picture, HTMLCanvasElement>();
export function dimmed(pic: Picture): Picture {
  let copy = dimmedCopies.get(pic);
  if (!copy) {
    copy = Object.assign(document.createElement('canvas'), { width: pic.width, height: pic.height });
    const g = copy.getContext('2d')!;
    g.filter = 'brightness(0.8)';
    g.drawImage(pic, 0, 0);
    dimmedCopies.set(pic, copy);
  }
  return copy;
}

export function canvasPen(host: HTMLElement, width: number, height: number, background = true, quality = 20): Pen {
  const canvas = document.createElement('canvas');
  let ratio = ratioAt(quality);
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
  // An image carries the box it covers, so show() can leave out those off the screen: a big map is thousands of
  // images, and Firefox spent seconds on every frame drawing them all (#353).
  type Call = ((c: CanvasRenderingContext2D) => void) & {
    box?: [number, number, number, number];
    /** An image's picture. */
    pic?: Picture;
  };
  const layers: Call[][] = Array.from({ length: 8 }, () => []);
  /** The pictures each layer drew last time, and how many times the canvas was drawn. */
  const shownPics: Set<Picture>[] = Array.from({ length: 8 }, () => new Set());
  let shows = 0;
  let fog = 1;
  let mark = 1;
  let actor = { dx: 0, dy: 0, alpha: 1 };
  let calls = layers[0];
  // What the canvas shows, so a frame that changes nothing is not drawn again.
  let shownKey = '';
  let changed = true;
  const push = (call: Call, box?: Call['box']) => {
    if (box) call.box = box;
    changed = true;
    calls.push(call);
  };
  return {
    canvas,
    begin: (n) => {
      changed = true;
      calls = layers[n] = [];
    },
    image: (pic, x, y, dim, tile) => {
      const call: Call = (c) => {
        // A dimmed picture is drawn from a copy made once: setting the context's filter for every tile took
        // half of Firefox's time in a big map, since it parses the filter string each time.
        const src = dim ? dimmed(pic) : pic;
        const b = tile && pic.width === W && pic.height === H ? seamBleed(c.getTransform().a) : 0;
        if (b) c.drawImage(src, x - b / 2, y - b / 2, W + b, H + b);
        else c.drawImage(src, x, y);
      };
      call.pic = pic;
      push(call, [x, y, pic.width, pic.height]);
    },
    shown: (n) => shownPics[n],
    shownVersion: () => shows,
    redrawn: () => {
      changed = true;
    },
    diamond: (x, y, color, alpha) =>
      push((c) => {
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
    road: (x, y, color, path, width = H / 32, alpha = 1) =>
      push((c) => {
        c.globalAlpha = alpha;
        c.strokeStyle = css(color);
        c.lineWidth = width;
        c.beginPath();
        path(offset(c, x, y));
        c.stroke();
        c.globalAlpha = 1;
      }),
    rect: (x, y, w, h, color, alpha = 1) =>
      push((c) => {
        c.globalAlpha = alpha;
        c.fillStyle = css(color);
        c.fillRect(x, y, w, h);
        c.globalAlpha = 1;
      }),
    line: (x1, y1, x2, y2, color, width = 1, alpha = 1) =>
      push((c) => {
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
    outline: (paths, color, width, alpha) =>
      push((c) => {
        c.globalAlpha = alpha;
        c.strokeStyle = css(color);
        c.lineWidth = width;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        for (const path of paths) {
          roundedPath(offset(c, 0, 0), path);
          if (path.closed) c.closePath();
        }
        c.stroke();
        c.globalAlpha = 1;
        c.lineCap = 'butt';
        c.lineJoin = 'miter';
      }),
    circle: (x, y, r, fill, outline, outlineAlpha) =>
      push((c) => {
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
      push((c) => {
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
    label: (s, x, y, style) =>
      push((c) => {
        const { left, baseline } = inkCentred(c, s, x, y, style);
        if (!style.plain) {
          c.lineWidth = 2;
          c.strokeStyle = '#000';
          c.strokeText(s, left, baseline);
        }
        c.fillStyle = css(style.color);
        c.fillText(s, left, baseline);
      }),
    measure: (s, style) => {
      c.font = fontOf(style);
      return c.measureText(s).width;
    },
    actors: (dx, dy, alpha) => {
      actor = { dx, dy, alpha };
    },
    fade: (alpha) => {
      fog = alpha;
    },
    marker: (alpha) => {
      mark = alpha;
    },
    show: (dx, dy, scale) => {
      const key = `${dx},${dy},${scale},${actor.dx},${actor.dy},${actor.alpha},${fog},${mark}`;
      if (!changed && key === shownKey) return;
      changed = false;
      shownKey = key;
      // What is on the screen, in map pixels, with a tile and a bit of room for what slides and bleeds.
      const left = -dx / scale - 2 * W;
      const top = -dy / scale - 2 * H;
      const right = (width - dx) / scale + 2 * W;
      const bottom = (height - dy) / scale + 2 * H;
      // The transform carries the pixel ratio, so the drawing code works in CSS pixels.
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.fillStyle = '#000';
      if (background) c.fillRect(0, 0, width, height);
      else c.clearRect(0, 0, width, height);
      c.setTransform(scale * ratio, 0, 0, scale * ratio, dx * ratio, dy * ratio);
      shows++;
      STACK.forEach((n) => {
        const layer = layers[n];
        const drawn = (shownPics[n] = new Set());
        c.save();
        if (n === 2) {
          c.translate(actor.dx, actor.dy);
          c.globalAlpha = actor.alpha;
        }
        if (n === 3) c.globalAlpha = fog;
        if (n === 4) c.globalAlpha = mark;
        for (const call of layer) {
          const b = call.box;
          // The slide moves the third layer by up to its offset: that much room too.
          const ox = n === 2 ? actor.dx : 0;
          const oy = n === 2 ? actor.dy : 0;
          if (b && (b[0] + ox > right || b[0] + ox + b[2] < left || b[1] + oy > bottom || b[1] + oy + b[3] < top))
            continue;
          if (call.pic) drawn.add(call.pic);
          call(c);
        }
        c.restore();
      });
    },
    resize: (w, h) => {
      ratio = ratioAt(quality);
      changed = true;
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

/** The diamond's sides, by the neighbour they face. */
const SIDES: Record<'NE' | 'SE' | 'SW' | 'NW', [[number, number], [number, number]]> = {
  NE: [CORNERS.N, CORNERS.E],
  SE: [CORNERS.E, CORNERS.S],
  SW: [CORNERS.S, CORNERS.W],
  NW: [CORNERS.W, CORNERS.N],
};

/** How long a map waits for a slide's first frame before it is painted anyway. */
const FIRST_FRAME_MS = 100;

/** How long a slide that set off early waits at its end for the map that has the unit there, before it ends anyway. */
const EARLY_WAIT_MS = 2000;

/** How long the black takes to fade from a tile just explored, as a multiple of a slide's time. */
const EXPLORE_FADE_SLIDES = 1;

const CHIP: TextStyle = { color: 0, font: 'sans-serif', size: 10, bold: true, plain: true };
const NAME: TextStyle = { color: 0, font: 'serif', size: 13 };
/** TileViewer's fonts: simple-bold-tiny, and simple-bold+italic-smaller to emphasise. */
const POPULATION: TextStyle = { color: 0, font: 'sans-serif', size: 12, bold: true };
const POPULATION_EMPH: TextStyle = { ...POPULATION, size: 14, italic: true };
/** The turns on a path mark, in black with no outline: a black stroke would only fatten them. */
const PATH_TURNS: TextStyle = { color: 0x000000, font: 'sans-serif', size: 12, plain: true };
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
  const firstBorder = ops.findIndex((o) => o.k === 'border');
  ops.forEach((op, i) => {
    pen.tile?.(op.x, op.y, passOf.get(op) ?? 0);
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
        pen.image(img, ox + Math.trunc(dx), oy + Math.trunc(dy), !!op.dim, op.at === 'tile');
        return;
      }
      case 'fog':
        return pen.diamond(ox, oy, 0x000000, 0.2);
      case 'road':
        return pen.road(ox, oy, op.color, (p) => roadPath(op.dirs, p), undefined, undefined, `road:${op.dirs.join()}`);
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
      case 'grid':
        return pen.road(
          ox,
          oy,
          0x000000,
          (p) => {
            p.moveTo(W / 2, 0);
            p.lineTo(W, H / 2);
            p.lineTo(W / 2, H);
            p.lineTo(0, H / 2);
            p.lineTo(W / 2, 0);
          },
          GRID_WIDTH,
          GRID_ALPHA,
        );
      case 'border':
        // All the borders at once, at the first: joined up, they have no seams at the tiles' corners.
        if (i === firstBorder) {
          const borders = ops.filter((o): o is Extract<Op, { k: 'border' }> => o.k === 'border');
          for (const [rgb, paths] of borderPaths(borders)) pen.outline(paths, rgb, 4, 0.8);
        }
        return;
      case 'modernLabel': {
        // MapViewer.createLabel's paddings: 15 across, 10 down, 5 between lines; the boxes 3 apart.
        const [hPad, vPad, linePad, spacing] = [15, 10, 5, 3];
        const bg = shade(op.rgb);
        const font: TextStyle = { ...NAME, plain: true, color: shade(op.fg) };
        const styles = op.lines.map((_, i) => (i === 0 ? font : { ...font, size: 10 }));
        const width = Math.max(...op.lines.map((l, i) => pen.measure(l, styles[i]))) + hPad;
        const height = vPad + styles.reduce((h, s, i) => h + s.size + (i > 0 ? linePad : 0), 0);
        const left = op.left;
        const leftW = !left ? 0 : 'capital' in left ? height : pen.measure(left.text, font) + hPad;
        let x = ox + W / 2 - width / 2 - (left ? leftW + spacing : 0);
        const y = oy + H - height / 2;
        if (left) {
          pen.rect(x, y, leftW, height, bg, 0.5);
          if ('capital' in left) {
            // createCapitalLabel: a pentagram.
            const r = (height - 10) / 2;
            const at = (k: number): [number, number] => [
              height / 2 + r * Math.cos(((-90 + 144 * k) * Math.PI) / 180),
              height / 2 + r * Math.sin(((-90 + 144 * k) * Math.PI) / 180),
            ];
            pen.road(
              x,
              y,
              0xffffff,
              (p) => {
                p.moveTo(...at(0));
                for (let k = 1; k <= 5; k++) p.lineTo(...at(k));
              },
              undefined,
              undefined,
              `capital:${height}`,
            );
          } else {
            pen.text(left.text, x + leftW / 2, y + vPad / 2, left.italic ? { ...font, italic: true } : font, true);
          }
          x += leftW + spacing;
        }
        pen.rect(x, y, width, height, bg, 0.5);
        let ty = y + vPad / 2;
        op.lines.forEach((l, i) => {
          pen.text(l, x + width / 2, ty, styles[i], true);
          ty += styles[i].size + linePad;
        });
        const right = op.right;
        if (right) {
          x += width + spacing;
          if ('mission' in right) {
            // createReligiousMissionLabel: a cross on the missionary's colour, ringed for an expert.
            const m = right.mission;
            pen.rect(x, y, height, height, shade(m.rgb), 0.5);
            const [cx, top, bottom, bar] = [x + height / 2, y + 5, y + height - 5, (height - 10) / 3];
            pen.line(cx, top, cx, bottom, shade(m.fg), 2);
            pen.line(cx - bar, top + bar, cx + bar, top + bar, shade(m.fg), 2);
            if (m.expert) {
              const r = height / 2 - 4;
              pen.road(
                x,
                y,
                shade(m.fg),
                (p) => {
                  p.moveTo(height / 2 + r, height / 2);
                  for (let k = 1; k <= 24; k++)
                    p.lineTo(
                      height / 2 + r * Math.cos((k * Math.PI) / 12),
                      height / 2 + r * Math.sin((k * Math.PI) / 12),
                    );
                },
                undefined,
                undefined,
                `ring:${height}`,
              );
            }
          } else {
            const rw = pen.measure(right.text, font) + hPad;
            pen.rect(x, y, rw, height, bg, 0.5);
            pen.text(right.text, x + rw / 2, y + vPad / 2, font, true);
          }
        }
        return;
      }
      case 'tileName':
        pen.text(op.name, ox + W / 2, oy + H / 2 - NAME.size / 2, { ...NAME, size: 11 }, true);
        return;
      case 'tint':
        return pen.diamond(ox, oy, op.rgb, TINT_ALPHA);
      case 'debugText': {
        // TileViewer draws the text at the tile's middle; a tile with several lines stacks them there.
        const step = NAME.size - 1;
        const top = oy + H / 2 - (step * op.lines.length) / 2;
        op.lines.forEach((line, n) => pen.text(line, ox + W / 2, top + n * step, { ...NAME, size: 11 }, true));
        return;
      }
      case 'pathMark':
        pen.circle(ox + W / 2, oy + H / 2, 10, pathColor(op.turns), 0x000000, 0.5);
        if (op.turns > 0) pen.label(String(op.turns), ox + W / 2, oy + H / 2, PATH_TURNS);
        return;
    }
  });
}

/**
 * Time a step of drawing the map from `start` to now, for a performance observer (scripts/perf.ts) to see. It is
 * cleared from the timeline at once, which the observer still gets, so a long game does not pile them up.
 */
function measure(name: string, start: number) {
  performance.measure(name, { start });
  performance.clearMeasures(name);
}

/** The art manifest from scripts/build-art.ts. */
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
  /** FreeCol's graphics quality option: 0 lowest, 10 low, 20 normal, up to 40. */
  quality = 20,
  /** Called once the art manifest has loaded (the loading screen's art step). */
  onManifest: () => void = () => {},
): {
  draw(map: MapView): Promise<void>;
  /** A step the Engine says a unit took; it slides when the next map is drawn. */
  moved(step: Step): void;
  /**
   * Resolves once the steps told of have been drawn and the unit has slid to its tile, as SwingGUI's animation
   * is over before the dialogs a move brings open; at most `maxMs` later, should no map come.
   */
  settled(maxMs?: number): Promise<void>;
  /** Whether a unit slides now, or a step told of waits for its map: what settled() waits for. */
  sliding(): boolean;
  /** Show the view: where it is centred, its zoom, the cursor and the active unit's path. */
  show(view: ViewState): void;
  /** Make the canvas `size` screen pixels, as its host's box changed; show() the resized view after. */
  resize(size: [number, number]): void;
  renderer(): string;
  /**
   * How long a slide takes (0: units jump), a whole blink of the active unit (0: it stays shown), and what
   * blinks: FreeCol's cursor over a steady unit, or the unit itself.
   */
  setMotion(moveMs: number, blinkMs: number, style: ActiveStyle): void;
  /** Which of the terrain animates (FreeCol's terrain animations and graphics quality options); off shows the still map. */
  setTerrainAnimation(mode: TerrainAnimation): void;
  /** FreeCol's colony labels option; the map is drawn again when it changes. */
  setColonyLabels(labels: ColonyLabels): void;
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
  /** What redraws each open drawTiles canvas from the scene of a new map. */
  const panels = new Set<(ops: Op[]) => void>();
  /** The steps the Engine told of since the last map was asked to be drawn. */
  let steps: Step[] = [];
  /**
   * The unit sliding along its tiles now, when it set off, and its track from there. A slide that set off on the
   * Engine's word of the step, before the map that has the unit on its new tile came, is `early` until that map is
   * drawn: it does not end before then, and the map does not start it again.
   */
  let sliding: { path: Path; since: number; track: Track; early: boolean } | null = null;
  /**
   * The unit the actors' layer holds, and the tile it is drawn on: a slide offsets the layer from there. A step of
   * that unit off that tile can slide at once, before the map that has it on its new tile is drawn.
   */
  let actor: { tile: [number, number]; keys: string; rgb: number } | null = null;
  /** When the active unit's blink started: when its slide ended, so a unit that has just come shows before it dims. */
  let blinkFrom = 0;
  /** The tiles explored last time, and the black being lifted off some newly explored since `since`. */
  let exploredTiles = new Set<string>();
  /** The static scene of each map, kept while maps change only units. */
  const statics = staticScenes();
  /** The static scene in the layers now (5, 0 and 7), to draw them again only when it changes. */
  let painted: StaticScene | null = null;
  /** The scene drawn last time: its static part and its units. */
  let last: { ground: StaticScene; units: Op[] } | null = null;
  let lifting: { since: number } | null = null;
  let frame = 0;
  let moveMs = MOVE_MS;
  let colonyLabels: ColonyLabels = 1;
  let blinkMs = BLINK_MS;
  let activeStyle: ActiveStyle = 'online';
  let terrain: TerrainAnimation = 'off';
  /** The frame of the animated water last drawn, and what of the base was on the screen then; whether it is being drawn. */
  let baseKey = '';
  let baseBusy = false;
  /** When the animated water may be drawn again (#353). */
  let baseNext = 0;
  /** How the water is drawn: as the shader water once the pen and the Tileset can (#409). */
  let waterDrawing: WaterDrawing = 'flipbook';
  /** The shader water's field last made, and the map and tiles it was made from. */
  let field: WaterField | null = null;
  let fieldOf = '';
  /** The Tileset's water look, null for FreeCol's frames. */
  let look: WaterLook | null = null;
  /** The banks of the rivers the river mesh draws, in place of the ground's river ops; null without the mesh. */
  let riverBase: Op[] | null = null;
  let riverKey = '';
  /** The key of the river mesh drawn now, '' for none. */
  let riverMesh = '';

  async function init() {
    const art = (await (await fetch(artBase + manifest)).json()) as Art;
    res = resources(art.layers, art.files);
    onManifest();
    // resize() swaps in a new array, so a changed size is a different one.
    const startSize = size;
    let p: Pen;
    try {
      if (canvas2d) throw new Error('asked for canvas2d');
      p = await pixiPen(host, ...startSize, quality);
      renderer = p.name ?? 'pixi';
    } catch (ex) {
      p = canvasPen(host, ...startSize, true, quality);
      renderer = `canvas2d (pixi failed: ${ex instanceof Error ? ex.message : String(ex)})`;
    }
    // The window may have changed while PixiJS started.
    if (size !== startSize) p.resize(...size);
    pen = p;
    look = waterLook(res);
    const waterArt = async () =>
      paintedWaterAtlas(
        await Promise.all(
          ['ocean', 'highSeas', 'lake'].map((kind) => pics.get(res!.path(`image.tile.model.tile.${kind}.center`)!)),
        ),
      );
    waterDrawing = await waterDrawingFor(look, p.water, waterArt);
  }

  async function riversNow(map: MapView, ground: StaticScene) {
    if (!pen?.water?.rivers) return;
    const enabled = waterDrawing === 'surface';
    const key = enabled ? `${map.w}:${map.h}:${map.tiles}:${JSON.stringify(map.rivers)}` : '';
    if (key === riverKey) return;
    riverKey = key;
    if (!enabled) {
      riverBase = null;
      riverMesh = '';
      pen.water.rivers(null);
      return;
    }
    const start = performance.now();
    const drawing = await riverDrawing(map, ground.base, pics.get, riverMesh);
    if (drawing.key && drawing.key === riverMesh) {
      // The same rivers: the mesh drawn stays, under the banks of the ground as it is now.
      riverBase = drawing.banks;
    } else if (!drawing.geometry || !drawing.atlas) {
      riverBase = null;
      riverMesh = '';
      pen.water.rivers(null);
    } else {
      const next = new RiverSurface(
        { geometry: drawing.geometry, atlas: drawing.atlas },
        await pics.get(res!.path('image.tile.model.tile.ocean.center')!),
        look!,
      );
      if (field) next.surface.setField(field);
      const shown = pen.water.rivers(next);
      riverBase = shown ? drawing.banks : null;
      riverMesh = shown ? drawing.key : '';
    }
    measure('map: rivers', start);
  }

  /**
   * The field is made by a worker (water-field.worker.ts) where the browser has one, so a move that explores a coast
   * drops no frames on it (#411); else here. One request at a time, the latest map state queued behind it. The map
   * waits for it before painting the ground just explored, so no water tile shows there without its water.
   */
  let fieldWorker: Worker | null | undefined;
  let fieldReply: ((r: FieldReply | null) => void) | null = null;
  const coverIds = new WeakMap<Float32Array, number>();
  const sentCovers = new Set<number>();
  let nextCoverId = 1;
  let fieldWanted: [MapView, StaticScene] | null = null;
  let fieldWork: Promise<void> | null = null;
  const workerOf = (): Worker | null => {
    if (fieldWorker !== undefined) return fieldWorker;
    try {
      fieldWorker = new Worker(new URL('./water-field.worker.ts', import.meta.url), { type: 'module' });
      fieldWorker.onmessage = (e: MessageEvent<FieldReply>) => fieldReply?.(e.data);
      fieldWorker.onerror = (e) => {
        console.warn('the water field worker failed; the field is made on the page', e.message);
        fieldWorker?.terminate();
        fieldWorker = null;
        fieldReply?.(null);
      };
    } catch {
      fieldWorker = null;
    }
    return fieldWorker;
  };

  /**
   * Give the shader water the field of a map, when its tiles changed: the land, and what covers the water tiles at
   * the shore (their sand, and the land and beach their transitions bring onto them), where the shallows and foam meet.
   * Resolves once the latest map's field is in.
   */
  function waterFieldNow(map: MapView, ground: StaticScene): Promise<void> {
    fieldWanted = [map, ground];
    fieldWork ??= (async () => {
      try {
        while (fieldWanted) {
          const [m, g] = fieldWanted;
          fieldWanted = null;
          await makeField(m, g);
        }
      } finally {
        fieldWork = null;
      }
    })();
    return fieldWork;
  }

  async function makeField(map: MapView, ground: StaticScene) {
    const key = `${map.w}x${map.h}:${map.tiles}:${JSON.stringify(map.rivers)}`;
    if (!pen?.water || !look || key === fieldOf) return;
    const water = pen.water;
    const climateBlend = look.climateBlend;
    const start = performance.now();
    const shores = [...ground.base, ...ground.below].filter(
      (op): op is Extract<Op, { k: 'image' }> => op.k === 'image' && op.shore === true,
    );
    const pictures = await Promise.all(shores.map((op) => pics.get(op.src).catch(() => null)));
    const covering = new Map<number, Picture[]>();
    shores.forEach((op, i) => {
      const pic = pictures[i];
      if (!pic || pic.width !== W || pic.height !== H) return;
      const at = op.y * map.w + op.x;
      covering.set(at, [...(covering.get(at) ?? []), pic]);
    });
    const covers = new Map<number, Float32Array>();
    for (const [at, list] of covering) covers.set(at, coverOf(list));
    const texel = fieldTexel(map.w, map.h, water.maxField);
    const worker = workerOf();
    let next: WaterField | null | undefined;
    if (worker) {
      const request: FieldRequest = {
        reset: field === null,
        map: { w: map.w, h: map.h, types: map.types, tiles: map.tiles, rivers: map.rivers },
        texel,
        covers: [],
        newCovers: [],
        climateBlend,
      };
      for (const [at, a] of covers) {
        let id = coverIds.get(a);
        if (id === undefined) coverIds.set(a, (id = nextCoverId++));
        if (!sentCovers.has(id)) {
          sentCovers.add(id);
          request.newCovers.push([id, a]);
        }
        request.covers.push([at, id]);
      }
      const reply = new Promise<FieldReply | null>((resolve) => (fieldReply = resolve));
      worker.postMessage(request);
      measure('map: water field', start);
      const r = await reply;
      fieldReply = null;
      if (r) next = r.field ?? field;
      else sentCovers.clear(); // The worker failed: made here instead, below.
    }
    if (next === undefined) {
      // Made again only round the tiles that changed since the last.
      next = waterField(
        map,
        texel,
        (x, y, u, v) => {
          const a = covers.get(y * map.w + x);
          return a ? coverAt(a, u, v) : 0;
        },
        field,
        climateBlend,
      );
      measure('map: water field', start);
    }
    if (!next || pen?.water !== water) return;
    if (next !== field) water.field(next);
    field = next;
    // Only once it is made: a field that failed is made again with the next map.
    fieldOf = key;
    measure('map: water field (made)', start);
  }

  /** The overlay's operations for a view: its cursor, and the path if the map view is about its active unit. */
  const overlayOf = (v: ViewState) => overlay(cursor(v), v.preview ?? activeUnitFacts(v)?.path ?? null, res!);

  /** The View menu's ops, kept until the map or the switches change: a whole map of them is dear to compare. */
  let modeCache: {
    map: ViewState['map'];
    modes: ViewModes;
    overlay: ViewState['overlay'];
    ops: Op[];
    id: number;
  } = {
    map: null,
    modes: NO_MODES,
    overlay: NO_OVERLAY,
    ops: [],
    id: 0,
  };
  const modeOpsOf = (v: ViewState) => {
    const c = modeCache;
    if (
      c.map === v.map &&
      c.modes.grid === v.modes.grid &&
      c.modes.borders === v.modes.borders &&
      c.modes.tileText === v.modes.tileText &&
      c.overlay === v.overlay
    )
      return c;
    return (modeCache = {
      map: v.map,
      modes: v.modes,
      overlay: v.overlay,
      ops: v.map ? [...viewModeOps(v.map, v.modes), ...debugOverlayOps(v.overlay)] : [],
      id: c.id + 1,
    });
  };

  const camera = () => {
    if (!pen || !view) return;
    const now = performance.now();
    // The active unit blinks, but not while a unit slides; a slide ends once its time is up, and the active unit
    // goes back to the actors' layer to blink.
    if (sliding && now - sliding.since >= length(sliding.track) + (sliding.early ? EARLY_WAIT_MS : 0)) {
      sliding = null;
      blinkFrom = now;
      drawing = drawing.then(() => (drawn && last ? paintScene(drawn, last.ground, last.units) : undefined));
    }
    // What blinks is the unit cursor in FreeCol's style, else the unit; with blinking off the cursor stays, as the only mark.
    // The tile cursor, shown when no unit is left to move, blinks on its own.
    const tileCursor = view.mode === 'terrain' && !!view.selected;
    const cursorBlinks = activeStyle === 'freecol' || blinkMs <= 0 || tileCursor;
    const alpha =
      !sliding && ((view.mode === 'units' && view.active) || tileCursor) ? blink(now - blinkFrom, blinkMs) : 1;
    if (sliding) {
      const [dx, dy] = slide(sliding.track, now - sliding.since, actor ? tileOrigin(...actor.tile) : undefined);
      pen.actors(dx, dy, 1);
    } else {
      pen.actors(0, 0, cursorBlinks ? 1 : alpha);
    }
    // The unit cursor waits on the tile the unit comes to until it is there, as Swing draws no cursor while it slides.
    pen.marker(cursorBlinks && !sliding ? alpha : 0);
    if (lifting && now - lifting.since >= moveMs * EXPLORE_FADE_SLIDES) lifting = null;
    pen.fade(lifting ? 1 - (now - lifting.since) / (moveMs * EXPLORE_FADE_SLIDES) : 0);
    const z = view.zoom;
    const [cx, cy] = following(now) ?? view.centre;
    const shownAt = performance.now();
    pen.show(size[0] / 2 - cx * z, size[1] / 2 - cy * z, z);
    measure('map: show', shownAt);
  };

  /**
   * Where the camera is while the view is centred on the tile a unit slides to: on the unit, so the map scrolls
   * under it and the camera comes to the tile with it, rather than jumping a tile ahead as the slide sets off.
   * Null when no slide is under way or the view is centred elsewhere.
   */
  function following(now: number): [number, number] | null {
    if (!sliding || !view) return null;
    const [ex, ey] = sliding.track.points[sliding.track.points.length - 1];
    const [cx, cy] = view.centre;
    if (cx !== ex + W / 2 || cy !== ey + H / 2) return null;
    // In whole map pixels, as the actors' offset is: the unit stays still on the screen.
    const [dx, dy] = slide(sliding.track, now - sliding.since).map(Math.round);
    return [cx + dx, cy + dy];
  }

  /** The frame the animated water and rivers are at now. */
  const ticksNow = (): Ticks => {
    if (terrain === 'off') return STILL;
    const t = Math.floor(performance.now() / TICK_MS);
    return { water: t, river: terrain === 'all' ? t : 0 };
  };

  /**
   * Show the animated water's next frame when its tick has come, or when more of the base came on the screen: the
   * animated pictures on the screen are drawn again, each once however many tiles show it (#408).
   */
  function animateBase() {
    if (!drawn || !pen || baseBusy || performance.now() < baseNext) return;
    const t = ticksNow();
    const key = `${t.water}:${t.river}:${pen.shownVersion(BASE_LAYER)}`;
    if (key === baseKey) return;
    baseKey = key;
    baseBusy = true;
    const start = performance.now();
    void pics
      .animate(t, pen.shown(BASE_LAYER))
      .then((changed) => {
        if (changed.length) {
          pen?.redrawn(changed);
          // The Canvas 2D pen draws again only when shown.
          camera();
        }
        measure('map: water', start);
        // What the animated pictures hold, for scripts/rivers-bench.ts: frames kept (each a tile-sized canvas) and live pictures.
        performance.mark('map: pictures', { detail: { kept: pics.kept(), live: pics.live() } });
      })
      .finally(() => {
        baseBusy = false;
        // A frame that cost a slow machine much waits three times as long before the next (#353); one that cost
        // little, as on the screen of any machine it should, waits for nothing but its tick.
        const end = performance.now();
        baseNext = end + 3 * (end - start);
      });
  }

  /** Every frame: the slide and the blink move on, and show the camera again. */
  function tick() {
    frame = requestAnimationFrame(tick);
    animateBase();
    // The shader water moves at the screen's frame rate; with the terrain's animation off, it stands still.
    if (waterDrawing === 'surface' && terrain !== 'off') pen?.water?.time(performance.now(), terrain === 'all');
    if (sliding || lifting || (view?.mode === 'units' && view.active) || (view?.mode === 'terrain' && view.selected))
      camera();
  }

  /** Redraw the overlay if it changed, then move the camera. */
  async function showNow() {
    if (!pen || !view) return;
    const modes = modeOpsOf(view);
    const ops = overlayOf(view);
    const key = `${modes.id}|${JSON.stringify(ops)}`;
    if (key !== shown) {
      shown = key;
      await paint(pen, 1, [...modes.ops, ...ops.filter((op) => !isCursorMarker(op))], pics);
      await paint(pen, 4, ops.filter(isCursorMarker), pics);
    }
    camera();
  }

  /**
   * Draw the scene, with one unit on its own in the actors' layer: the sliding one, else the active one, to blink.
   * Nothing else is in that layer, so nothing else slides or blinks. The static scene is drawn again only when it is
   * not the one the layers hold.
   */
  async function paintScene(map: MapView, ground: StaticScene, units: Op[], slide = sliding?.path ?? null) {
    const start = performance.now();
    const kept = painted === ground;
    const unitAt = (tile: string) => (op: Op) => `${op.x},${op.y}` === tile;
    let actors: Op[] = [];
    let rest = units;
    let holds: typeof actor = null;
    if (slide) {
      const { step, tiles } = slide;
      const [x, y] = tiles[tiles.length - 1];
      const shown = map.units.find((u) => u.x === x && u.y === y);
      holds = { tile: [x, y], keys: step.keys.join(), rgb: step.rgb };
      if (shown && shown.rgb === step.rgb && shown.keys.join() === step.keys.join()) {
        const isActor = unitAt(`${x},${y}`);
        actors = units.filter(isActor);
        rest = units.filter((op) => !isActor(op));
      } else {
        // The tile shows another unit (the one that came went into a colony, onto a ship, or under a stronger unit):
        // the one that came slides in on its own, over it, and is gone once there.
        const { keys, rgb, chip, fg } = step;
        actors = unitOps({ x, y, keys, rgb, chip, fg, stack: 1, fade: false }, res!);
      }
    } else if (map.active) {
      const [x, y] = map.active;
      const shown = map.units.find((u) => u.x === x && u.y === y);
      holds = shown ? { tile: [x, y], keys: shown.keys.join(), rgb: shown.rgb } : null;
      const isActor = unitAt(map.active.join(','));
      actors = units.filter(isActor);
      rest = units.filter((op) => !isActor(op));
    }
    if (painted !== ground) {
      // Not kept until all three are drawn: a draw cut short leaves them to be drawn again.
      painted = null;
      await riversNow(map, ground);
      await paint(pen!, 5, riverBase ?? ground.base, pics);
      await paint(pen!, 0, ground.below, pics);
      await paint(pen!, 7, ground.above, pics);
      painted = ground;
    }
    await paint(pen!, 6, rest, pics);
    await paint(pen!, 2, actors, pics);
    // The layer and its offset change together: no frame draws between them.
    actor = holds;
    camera();
    measure(kept ? 'map: paint, kept' : 'map: paint', start);
  }

  /**
   * Resolves once the slide that started last has had its first frame drawn, or after FIRST_FRAME_MS when no frame
   * comes (a hidden tab gets none). A map waits for it before it is painted: the Engine sends the map in the same task
   * as the step, and a paint there would hold the unit's setting off back by as long as it takes.
   */
  let firstFrame: Promise<void> | null = null;

  /** A slide has started: show its first frame. */
  function started() {
    slideMark('start');
    const shown = new Promise<void>((ok) => {
      requestAnimationFrame(() => {
        slideMark('frame');
        // Once the frame is on the screen: the browser draws it after its animation frame callbacks.
        setTimeout(ok, 0);
      });
      setTimeout(ok, FIRST_FRAME_MS);
    });
    firstFrame = shown;
    void shown.then(() => {
      if (firstFrame === shown) firstFrame = null;
    });
    camera();
  }

  /**
   * Slide the player's unit as soon as the Engine tells of its step, rather than once the map that has it on its
   * new tile is drawn: the actors' layer holds it on the tile it steps off (it is the active unit), or it is sliding
   * there now and carries on. Other steps slide when their map is drawn.
   */
  function slideEarly(step: Step) {
    if (!pen || moveMs <= 0 || step.speed !== null || !drawn?.ourTurn) return;
    const now = performance.now();
    const next = track([step.from, step.to], moveMs);
    const tiles: [number, number][] = [step.from, step.to];
    const prev = sliding;
    if (prev) {
      const end = prev.path.tiles[prev.path.tiles.length - 1];
      if (prev.path.step.unit !== step.unit || end.join() !== step.from.join()) return;
      sliding = { path: { step, tiles }, since: now, track: carryOn(prev.track, now - prev.since, next), early: true };
    } else {
      if (!actor || actor.tile.join() !== step.from.join()) return;
      if (actor.keys !== step.keys.join() || actor.rgb !== step.rgb) return;
      sliding = { path: { step, tiles }, since: now, track: next, early: true };
    }
    started();
  }

  async function drawNow(map: MapView, moved: Step[]) {
    const before = drawn;
    drawn = map;
    if (!pen) await init();
    // What slides is what the Engine says the player's unit did, during their turn. A map with no steps (the server
    // often sends several in a row) leaves a slide under way alone.
    // Another player's unit slides at the Engine's speed for it, whoever's turn it is.
    const found = path(moved);
    const stepTime = found ? stepMs(found.step, moveMs) : 0;
    const way = found && stepTime > 0 && (found.step.speed !== null || map.ourTurn) ? found : null;
    // A map that changes only units keeps the static scene, and the layers it is drawn in.
    const start = performance.now();
    const ground = statics(map, res!, colonyLabels, waterDrawing);
    const kept = ground === last?.ground;
    const units = unitScene(map, res!);
    measure(kept ? 'map: scene, kept' : 'map: scene', start);
    if (!kept) {
      if (waterDrawing === 'surface') await waterFieldNow(map, ground);
      pics.retain(ground.base);
      const ops = [...ground.base, ...ground.below, ...ground.above];
      // The panels draw no units.
      panels.forEach((render) => render(ops));
    }
    // A slide that set off early, on the Engine's word of the step, goes on: this map puts the unit on the tile it
    // slides to, and the slide is offset from there. A map from before the step leaves the unit on its old tile.
    const early = sliding?.early ? sliding : null;
    if (early && (!way || way.step.unit === early.path.step.unit)) {
      await paintScene(map, ground, units, moved.length ? (way ?? early.path) : null);
      // A map with the earlier of several steps the unit was told to take leaves the slide early: the map with the
      // last is still to come.
      const to = (p: Path) => p.tiles[p.tiles.length - 1].join();
      if (moved.length && (!way || to(way) === to(early.path))) {
        early.early = false;
        slideMark('painted');
      }
    } else if (way) {
      // Else the slide starts once the actors' layer holds the unit on its new tile.
      await paintScene(map, ground, units, way);
      slideMark('painted');
      const now = performance.now();
      const next = track(way.tiles, stepTime);
      // A move made while the same unit still slides to where this one sets off from carries on from where it is.
      const prev = sliding;
      const carry =
        prev &&
        prev.path.step.unit === way.step.unit &&
        prev.path.tiles[prev.path.tiles.length - 1].join() === way.tiles[0].join();
      sliding = {
        path: way,
        since: now,
        track: carry ? carryOn(prev.track, now - prev.since, next) : next,
        early: false,
      };
      started();
    } else await paintScene(map, ground, units);
    // Ground that was explored since the last draw fades in out of the black, rather than appearing. A kept static
    // scene has the same tiles explored.
    const fresh = new Set<string>();
    if (!kept) {
      const known = new Set<string>();
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] === '.') continue;
        const t = `${i % map.w},${Math.floor(i / map.w)}`;
        known.add(t);
        if (before && !exploredTiles.has(t)) fresh.add(t);
      }
      exploredTiles = known;
    }
    // What fades is the unexplored tile's own picture, so the ground shows through from under it.
    const lastOps =
      last && fresh.size ? [...last.ground.base, ...last.ground.below, ...last.units, ...last.ground.above] : [];
    const covers = lastOps.filter((op) => op.k === 'image' && fresh.has(`${op.x},${op.y}`));
    last = { ground, units };
    // A redraw that explores nothing more (the server often sends several maps in a row) leaves a fade under way alone.
    if (covers.length) {
      await paint(pen!, 3, covers, pics);
      lifting = moveMs > 0 ? { since: performance.now() } : null;
    }
    await showNow();
    if (!frame) frame = requestAnimationFrame(tick);
  }

  return {
    setMotion(m, b, style) {
      moveMs = m;
      blinkMs = b;
      activeStyle = style;
    },
    setTerrainAnimation(mode) {
      terrain = mode;
    },
    setColonyLabels(labels) {
      if (labels === colonyLabels) return;
      colonyLabels = labels;
      const again = drawn;
      if (again) drawing = drawing.then(() => drawNow(again, []));
    },
    draw: (map) => {
      // The steps belong to this map: they came before it, and those after it go with the next.
      const moved = steps;
      steps = [];
      if (moved.length) slideMark('map');
      const shown = firstFrame;
      return (drawing = drawing.then(() => shown).then(() => drawNow(map, moved)));
    },
    moved: (step) => {
      if (!steps.length) slideMark('step');
      steps.push(step);
      slideEarly(step);
    },
    sliding: () => sliding !== null || steps.length > 0,
    settled: async (maxMs = 5000) => {
      const until = performance.now() + maxMs;
      while (performance.now() < until) {
        await drawing;
        // Timed rather than waiting on the animation frames, which a hidden tab does not get.
        const left = sliding ? length(sliding.track) - (performance.now() - sliding.since) : 0;
        if (steps.length === 0 && left <= 0) return;
        await new Promise((ok) => setTimeout(ok, Math.max(16, left)));
      }
    },
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
      const pen = canvasPen(host, 3 * W, 3 * H + top, false);
      const keep = new Set(tiles.map(([x, y]) => `${x},${y}`));
      const [cx, cy] = tileOrigin(...centre);
      // The tiles' terrain, items, roads and settlement; not the units, chips, fog or labels the map adds.
      const render = (all: Op[]) => {
        const ops = all.filter(
          (op) => keep.has(`${op.x},${op.y}`) && ((op.k === 'image' && op.at !== 'unit') || op.k === 'road'),
        );
        void paint(pen, 0, ops, pics).then(() => pen.show(W - cx, H + top - cy, 1));
      };
      // Drawn from the map last drawn, and again with each map after it: a colony just founded is not in the one
      // drawn before the panel opened.
      if (drawn && res) render(scene(drawn, res, colonyLabels));
      panels.add(render);
      return () => {
        panels.delete(render);
        pen.canvas.remove();
      };
    },
  };
}
