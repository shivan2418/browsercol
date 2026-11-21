import { afterEach, describe, expect, it } from 'vite-plus/test';
import { inShape, mapShape, projection, setMapShape, setView, viewOfShape } from './projection';

// An Isometric shaped map (#559): 4 tiles across and 7 half-height rows, so its box is 7 wide and 7 tall, and the
// Isometric view lays it out as a rectangle of 4 tile widths and a half, and 8 half tiles.
const [w, h, rows] = [7, 7, 7];

afterEach(() => {
  setMapShape(null);
  setView('isometric');
});

describe('an Isometric shaped map', () => {
  const isoShaped = () => setMapShape({ kind: 'isometric', rows });

  it('has the tiles of its diamond, and none in the corners of its box', () => {
    isoShaped();
    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inShape(w, h, x, y)) count++;
    expect(count).toBe(4 * 7);
    expect(inShape(w, h, 0, 0)).toBe(false);
    expect(inShape(w, h, 6, 6)).toBe(false);
    expect(inShape(w, h, 3, 3)).toBe(true);
    expect(inShape(w, h, -1, 3)).toBe(false);
  });

  it('has every tile of the box in a Top-down shaped map', () => {
    expect(inShape(w, h, 0, 0)).toBe(true);
    expect(inShape(w, h, 6, 6)).toBe(true);
    expect(inShape(w, h, 7, 0)).toBe(false);
  });

  it('is a Top-down shape unless it says Isometric with rows', () => {
    expect(setMapShape({ kind: 'isometric', rows: 0 })).toBe(false);
    expect(mapShape().kind).toBe('topDown');
    expect(setMapShape({ kind: 'isometric', rows })).toBe(true);
    expect(setMapShape({ kind: 'isometric', rows })).toBe(false);
    expect(viewOfShape(mapShape())).toBe('isometric');
    expect(viewOfShape({ kind: 'topDown' })).toBe('topdown');
    expect(viewOfShape(undefined)).toBe('topdown');
  });

  it('is a rectangle on the screen in the Isometric view, filled by the boxes of its tiles', () => {
    isoShaped();
    expect(projection.mapSize(w, h)).toEqual([4 * 128 + 64, (8 * 64) / 2]);
    const [mw, mh] = projection.mapSize(w, h);
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    projection.eachTile(w, h, (x, y) => {
      const [ox, oy] = projection.origin(x, y, h);
      left = Math.min(left, ox);
      top = Math.min(top, oy);
      right = Math.max(right, ox + 128);
      bottom = Math.max(bottom, oy + 64);
    });
    expect([left, top, right, bottom]).toEqual([0, 0, mw, mh]);
  });

  it('draws each tile of the diamond once, and finds it from its middle', () => {
    isoShaped();
    const seen = new Set<string>();
    projection.eachTile(w, h, (x, y) => {
      expect(seen.has(`${x},${y}`)).toBe(false);
      seen.add(`${x},${y}`);
      expect(projection.tileAt(w, h, ...projection.centre(x, y, h))).toEqual([x, y]);
    });
    expect(seen.size).toBe(28);
    // A point in the rectangle's corner, over no tile of it, finds none.
    expect(projection.tileAt(w, h, -5, 5)).toBeNull();
  });

  it('keeps the camera in the rectangle, and its latitude runs from the top edge to the bottom', () => {
    isoShaped();
    const [mw, mh] = projection.mapSize(w, h);
    expect(projection.keepOn(w, h, [-50, -50])).toEqual([0, 0]);
    expect(projection.keepOn(w, h, [mw + 50, mh + 50])).toEqual([mw, mh]);
    expect(projection.keepOn(w, h, [10, mh / 2])).toEqual([10, mh / 2]);
    expect(projection.rowFraction(h, 100, 0)).toBe(0);
    expect(projection.rowFraction(h, 100, mh)).toBe(1);
    expect(projection.rowFraction(h, 100, mh / 4)).toBeCloseTo(0.25);
  });

  it('is a diamond in the Top-down view, drawn without its corners', () => {
    isoShaped();
    setView('topdown');
    let count = 0;
    projection.eachTile(w, h, () => count++);
    expect(count).toBe(28);
    expect(projection.tileAt(w, h, 10, 10)).toBeNull();
    expect(projection.tileAt(w, h, 3 * 64 + 10, 3 * 64 + 10)).toEqual([3, 3]);
  });

  it('is unchanged on a Top-down shaped map in the Isometric view: one big diamond', () => {
    expect(projection.mapSize(w, h)).toEqual([(14 * 128) / 2, (14 * 64) / 2]);
    expect(projection.origin(0, 0, h)).toEqual([6 * 64, 0]);
  });
});
