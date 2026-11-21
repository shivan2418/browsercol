// The Top-down view's placeholder terrain (#530): a flat colour per terrain type, a simple marker for hills, mountains,
// forest and marsh, a light grid line, and a river as lines to the sides it crosses. It is made here, in code, as plain
// shapes: no art is loaded for it, and it stands in until the view has real art (which gets its own design).
import { T } from './projection';
import type { Direction } from './projection';

/** The prefix of a picture's name that draw() makes rather than loads: `flat:<colour>:<marker>:<river>`. */
export const FLAT = 'flat:';

/** What marks a terrain type besides its colour. */
export type Marker = 'none' | 'hills' | 'mountains' | 'forest' | 'marsh';

const COLOURS: Record<string, number> = {
  plains: 0xc8b85a,
  grassland: 0x7bbd4c,
  prairie: 0xa5c455,
  savannah: 0xc4b660,
  marsh: 0x6e9a78,
  swamp: 0x587a62,
  desert: 0xe0cd8f,
  tundra: 0xaab9a6,
  arctic: 0xf2f6fa,
  hills: 0x9aa35f,
  mountains: 0x8d887c,
  ocean: 0x4a78c4,
  highSeas: 0x2f56a0,
  lake: 0x5e92d2,
  greatRiver: 0x5e92d2,
  unexplored: 0x000000,
};
const FOREST = 0x3d7a43;
const LAND = 0x7bbd4c;
const WATER = 0x4a78c4;
/** The river's colour. */
const RIVER = 0x6fa8e8;

/** The last word of a tile type's id: `model.tile.mixedForest` is `mixedForest`. */
const nameOf = (id: string) => id.slice(id.lastIndexOf('.') + 1);

/** A tile type's placeholder look: its colour and its marker. */
export function lookOf(type: { id: string; land: boolean; forested: boolean } | null): {
  colour: number;
  marker: Marker;
} {
  if (!type) return { colour: COLOURS.unexplored, marker: 'none' };
  const name = nameOf(type.id);
  const known = COLOURS[name];
  if (type.forested) return { colour: FOREST, marker: 'forest' };
  const marker: Marker =
    name === 'hills'
      ? 'hills'
      : name === 'mountains'
        ? 'mountains'
        : name === 'marsh' || name === 'swamp'
          ? 'marsh'
          : 'none';
  return { colour: known ?? (type.land ? LAND : WATER), marker };
}

/** The sides of a tile a river crosses, as river style digits say (`faces` in order) of the grid's N, E, S and W. */
export const riverSides = (style: string, faces: readonly Direction[]): string =>
  faces.filter((_, i) => style[i] !== undefined && style[i] !== '0').join('');

/** The name of a flat tile's picture. `river` is '' for none, else the sides it crosses ('-' for a river with none). */
export const flatSrc = (colour: number, marker: Marker, river = ''): string =>
  `${FLAT}${colour.toString(16).padStart(6, '0')}:${marker}:${river}`;

/** A colour as CSS, a share of the way to black (negative) or white (positive). */
const shade = (c: number, by: number) => {
  const mix = (v: number) => Math.round(by < 0 ? v * (1 + by) : v + (255 - v) * by);
  return `rgb(${mix((c >> 16) & 255)}, ${mix((c >> 8) & 255)}, ${mix(c & 255)})`;
};

/** The picture a flat tile's name stands for, T by T. */
export function drawFlat(name: string): HTMLCanvasElement {
  const [colour, marker, river] = name.slice(FLAT.length).split(':');
  const c = Number.parseInt(colour, 16);
  const canvas = Object.assign(document.createElement('canvas'), { width: T, height: T });
  const g = canvas.getContext('2d')!;
  g.fillStyle = shade(c, 0);
  g.fillRect(0, 0, T, T);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const dark = shade(c, -0.35);
  const mark = (path: () => void, fill?: string) => {
    g.beginPath();
    path();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.strokeStyle = dark;
    g.lineWidth = 2;
    g.stroke();
  };
  if (marker === 'hills') {
    for (const [x, y] of [
      [20, 40],
      [44, 38],
      [32, 24],
    ])
      mark(() => g.arc(x, y, 9, Math.PI, 2 * Math.PI));
  } else if (marker === 'mountains') {
    for (const [x, y, s] of [
      [22, 44, 16],
      [42, 44, 20],
    ])
      mark(
        () => {
          g.moveTo(x - s, y);
          g.lineTo(x, y - s * 1.4);
          g.lineTo(x + s, y);
          g.closePath();
        },
        shade(c, 0.35),
      );
  } else if (marker === 'forest') {
    for (const [x, y] of [
      [20, 22],
      [44, 22],
      [32, 42],
    ])
      mark(() => g.arc(x, y, 8, 0, 2 * Math.PI), shade(c, -0.25));
  } else if (marker === 'marsh') {
    for (const [x, y] of [
      [20, 24],
      [42, 30],
      [28, 46],
    ]) {
      mark(() => {
        g.moveTo(x - 6, y);
        g.lineTo(x + 6, y);
        g.moveTo(x - 3, y + 4);
        g.lineTo(x + 3, y + 4);
      });
    }
  }
  if (river) {
    g.strokeStyle = shade(RIVER, 0);
    g.lineWidth = 7;
    g.beginPath();
    const sides = river === '-' ? '' : river;
    const to: Record<string, [number, number]> = { N: [T / 2, 0], E: [T, T / 2], S: [T / 2, T], W: [0, T / 2] };
    if (!sides) g.arc(T / 2, T / 2, 5, 0, 2 * Math.PI);
    for (const d of sides) {
      g.moveTo(T / 2, T / 2);
      g.lineTo(...to[d]);
    }
    g.stroke();
  }
  // The light grid line: the tile's right and bottom edges.
  g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(T - 0.5, 0);
  g.lineTo(T - 0.5, T);
  g.moveTo(0, T - 0.5);
  g.lineTo(T, T - 0.5);
  g.stroke();
  return canvas;
}
