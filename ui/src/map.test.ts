import { describe, expect, it, vi } from 'vite-plus/test';
import { backingSize, borderPaths, canvasPen, dimmed, pixelRatio, seamBleed, tileAt } from './map';

// A 2x4 map of 128x64 diamonds in staggered rows, odd rows half a tile to
// the right. Tile (0,0)'s diamond spans x 0..128 and y 0..64 with its centre
// at (64,32); tile (0,1)'s centre is at (128,64), (1,1)'s at (256,64).
describe('tileAt', () => {
  const at = (px: number, py: number) => tileAt(2, 4, px, py);

  it('finds the tile whose diamond holds a point, on even and odd rows', () => {
    expect(at(64, 32)).toEqual([0, 0]);
    expect(at(200, 20)).toEqual([1, 0]);
    expect(at(128, 64)).toEqual([0, 1]);
    expect(at(300, 64)).toEqual([1, 1]);
  });

  it("gives a box's corners to the neighbouring rows' diamonds", () => {
    // Inside (0,0)'s 128x64 box but past its right and bottom edges: (0,1).
    expect(at(128, 40)).toEqual([0, 1]);
    expect(at(100, 60)).toEqual([0, 1]);
    // Inside (1,0)'s box, low on its left: (0,1) again.
    expect(at(140, 50)).toEqual([0, 1]);
  });

  it('is null off the map, including the corners outside the edge diamonds', () => {
    expect(at(5, 5)).toBeNull();
    expect(at(321, 64)).toBeNull();
    expect(at(64, 200)).toBeNull();
    expect(at(-10, 32)).toBeNull();
  });
});

describe('pixelRatio', () => {
  it('is the device pixel ratio, or 1 without one', () => {
    expect(pixelRatio(1)).toBe(1);
    expect(pixelRatio(2)).toBe(2);
    expect(pixelRatio(1.5)).toBe(1.5);
    expect(pixelRatio(undefined)).toBe(1);
    expect(pixelRatio(0)).toBe(1);
  });
});

describe('backingSize', () => {
  it('is the CSS size at the pixel ratio, in device pixels', () => {
    expect(backingSize(1040, 900, 1)).toEqual([1040, 900]);
    expect(backingSize(1040, 900, 2)).toEqual([2080, 1800]);
    expect(backingSize(1041, 901, 1.5)).toEqual([1562, 1352]);
  });
});

describe('borderPaths', () => {
  const all = ['NE', 'SE', 'SW', 'NW'];

  it("joins a lone tile's four sides into one closed loop", () => {
    const paths = borderPaths([{ x: 0, y: 0, sides: all, rgb: 1 }]).get(1)!;
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    expect(paths[0].pts).toHaveLength(4);
  });

  it("runs one owner's border round two touching tiles as one loop, without the side they share", () => {
    // (0,0) and (0,1) share (0,0)'s SE side.
    const paths = borderPaths([
      { x: 0, y: 0, sides: ['NE', 'SW', 'NW'], rgb: 1 },
      { x: 0, y: 1, sides: ['NE', 'SE', 'SW'], rgb: 1 },
    ]).get(1)!;
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ closed: true });
    expect(paths[0].pts).toHaveLength(6);
  });

  it('keeps a border that stops at the map edge open, and each colour apart', () => {
    const byColor = borderPaths([
      { x: 0, y: 0, sides: ['NE', 'SE'], rgb: 1 },
      { x: 1, y: 0, sides: all, rgb: 2 },
    ]);
    expect(byColor.get(1)).toEqual([
      {
        pts: [
          [64, 0],
          [128, 32],
          [64, 64],
        ],
        closed: false,
      },
    ]);
    expect(byColor.get(2)).toHaveLength(1);
  });
});

describe('seamBleed', () => {
  it('overlaps nothing at a whole number of device pixels per map pixel', () => {
    expect(seamBleed(1)).toBe(0);
    expect(seamBleed(2)).toBe(0);
    expect(seamBleed(3)).toBe(0);
  });

  it('overlaps a device pixel and a half between them', () => {
    expect(seamBleed(0.5)).toBeCloseTo(3);
    expect(seamBleed(1.5)).toBeCloseTo(1);
  });
});

describe('dimmed', () => {
  it('filters a picture once and hands back the same copy after', () => {
    const filtered: string[] = [];
    const drawn: unknown[] = [];
    const context = {
      set filter(v: string) {
        filtered.push(v);
      },
      drawImage: (pic: unknown) => drawn.push(pic),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const pic = { width: 128, height: 64 } as HTMLCanvasElement;
      const first = dimmed(pic);
      expect(dimmed(pic)).toBe(first);
      expect(first).not.toBe(pic);
      expect(filtered).toEqual(['brightness(0.8)']);
      expect(drawn).toEqual([pic]);
      expect(dimmed({ width: 128, height: 64 } as HTMLCanvasElement)).not.toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('canvasPen', () => {
  /** A pen on a 400x300 canvas whose context counts the images it draws. */
  const penOnFakeCanvas = () => {
    const drawn: number[][] = [];
    const context = {
      setTransform: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      fillRect: () => {},
      clearRect: () => {},
      drawImage: (_pic: unknown, x: number, y: number) => drawn.push([x, y]),
    };
    const canvas = { style: {}, getContext: () => context };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const pic = { width: 128, height: 64 } as HTMLCanvasElement;
    const pen = canvasPen({ append: () => {} } as unknown as HTMLElement, 400, 300, false, 0);
    return { pen, pic, drawn };
  };

  it('draws only the images on the screen, and draws again only for a change', () => {
    const { pen, pic, drawn } = penOnFakeCanvas();
    try {
      pen.begin(0);
      pen.image(pic, 10, 10, false);
      pen.image(pic, 5000, 5000, false);
      pen.show(0, 0, 1);
      expect(drawn).toEqual([[10, 10]]);
      pen.show(0, 0, 1);
      expect(drawn).toHaveLength(1);
      pen.show(-5000, -5000, 1);
      expect(drawn).toEqual([
        [10, 10],
        [5000, 5000],
      ]);
      pen.show(-5000, -5000, 1);
      pen.marker(0.5);
      pen.show(-5000, -5000, 1);
      expect(drawn).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
