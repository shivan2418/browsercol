import { describe, expect, it, vi } from 'vite-plus/test';
import {
  backingSize,
  borderPaths,
  canvasPen,
  dimmed,
  KEPT_FRAMES,
  pictures,
  pixelRatio,
  seamBleed,
  tileAt,
  waterDrawingFor,
  type WaterPen,
} from './map';
import type { WaterLook } from './map-water';
import type { Animated, Src, Ticks } from './tileset';

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

describe('pictures', () => {
  /** Pictures over fake canvases: each remembers what was drawn on it last, by the image's path. */
  const setup = () => {
    const fake = (id = ''): HTMLCanvasElement => {
      const c = { width: 128, height: 64, id, last: '' };
      return Object.assign(c, {
        getContext: () => ({
          clearRect: () => {},
          drawImage: (pic: { id: string; last: string }) => (c.last = pic.last || pic.id),
          globalCompositeOperation: '',
          globalAlpha: 1,
        }),
      }) as unknown as HTMLCanvasElement;
    };
    vi.stubGlobal('document', { createElement: () => fake() });
    return pictures('', (path) => Promise.resolve(fake(path)));
  };
  const ocean = (t: Ticks): string => `ocean${t.water % 3}.png`;
  const beach = (t: Ticks): Src => ({
    id: `beach:${ocean(t)}`,
    steps: [{ draw: ocean(t) }, { mask: 'mask.png' }],
  });
  const anim = (name: string, f: (t: Ticks) => Src): Animated => ({ id: `anim:${name}`, animate: f });
  const shows = (c: unknown) => (c as { last: string }).last;

  it('gives every tile showing the same animated water one canvas, which each frame draws on once', async () => {
    const pics = setup();
    try {
      const a = await pics.get(anim('ocean', ocean));
      expect(await pics.get(anim('ocean', ocean))).toBe(a);
      expect(shows(a)).toBe('ocean0.png');
      expect(await pics.animate({ water: 1, river: 0 }, [a, a])).toEqual([a]);
      expect(shows(a)).toBe('ocean1.png');
      // The same frame again: nothing to draw.
      expect(await pics.animate({ water: 1, river: 0 }, [a])).toEqual([]);
      // A picture that is not animated is left alone.
      const still = await pics.get('grass.png');
      expect(await pics.animate({ water: 2, river: 0 }, [a, still])).toEqual([a]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draws only the animated pictures it is given: the ones on the screen', async () => {
    const pics = setup();
    try {
      const a = await pics.get(anim('ocean', ocean));
      const b = await pics.get(anim('beach', beach));
      expect(await pics.animate({ water: 1, river: 0 }, [b])).toEqual([b]);
      expect(shows(a)).toBe('ocean0.png');
      // Off the screen until now, it catches up once it comes on it.
      expect(await pics.animate({ water: 1, river: 0 }, [a, b])).toEqual([a]);
      expect(shows(a)).toBe('ocean1.png');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cuts a recipe's cut step away where it is opaque, and keeps only where a mask step is", async () => {
    const ops: string[] = [];
    const ctx = {
      globalCompositeOperation: '',
      globalAlpha: 1,
      drawImage: (pic: { id: string }) => ops.push(`${ctx.globalCompositeOperation} ${pic.id}`),
    };
    const fake = (id = '') => ({ width: 128, height: 64, id, getContext: () => ctx }) as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: () => fake() });
    try {
      const pics = pictures('', (path) => Promise.resolve(fake(path)));
      await pics.get({ id: 'sand', steps: [{ draw: 'beach.png' }, { cut: 'shore.png' }, { mask: 'tile.png' }] });
      expect(ops).toEqual(['source-over beach.png', 'destination-out shore.png', 'destination-in tile.png']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lets go of the animated pictures a new scene no longer has', async () => {
    const pics = setup();
    try {
      const a = anim('ocean', ocean);
      await pics.get(a);
      await pics.get(anim('beach', beach));
      expect(pics.live()).toBe(2);
      pics.retain([{ k: 'image', x: 0, y: 0, src: a, at: 'tile' }]);
      expect(pics.live()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("draws a river's frame straight on its canvas, with no composited frame kept (#410)", async () => {
    const drawn: string[] = [];
    const fake = (id = '') => {
      const c = { width: 128, height: 64, id };
      let op = 'source-over';
      return Object.assign(c, {
        getContext: () => ({
          clearRect: () => {},
          drawImage: (pic: { id: string }) => drawn.push(`${op} ${pic.id}`),
          set globalCompositeOperation(v: string) {
            op = v;
          },
          globalAlpha: 1,
        }),
      }) as unknown as HTMLCanvasElement;
    };
    vi.stubGlobal('document', { createElement: () => fake() });
    try {
      const pics = pictures('', (path) => Promise.resolve(fake(path)));
      const river: Animated = {
        id: 'anim:river',
        animate: (t) => ({ id: `river:${t.river}`, steps: [{ draw: `water${t.river}.png` }] }),
        layers: {
          water: (t) => `water${t.river}.png`,
          shape: 'shape.png',
          under: 'pebbles.png',
          keep: { id: 'keep', steps: [{ draw: 'fade.png' }] },
        },
      };
      const a = await pics.get(river);
      // The fade is composited once (a recipe), then the frame is drawn through it.
      expect(drawn.slice(1)).toEqual([
        'copy water0.png',
        'destination-in shape.png',
        'destination-over pebbles.png',
        'destination-in ',
      ]);
      drawn.length = 0;
      expect(await pics.animate({ water: 0, river: 1 }, [a])).toEqual([a]);
      expect(drawn[0]).toBe('copy water1.png');
      expect(pics.kept()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** `n` animated shores, each a frame that never comes again at each tick, on the screen for `ticks` ticks. */
  const shores = async (pics: ReturnType<typeof setup>, n: number, ticks: number) => {
    const many = Array.from({ length: n }, (_, i) =>
      anim(`shore${i}`, (t) => ({ id: `shore${i}:${t.water}`, steps: [{ draw: `ocean${t.water}.png` }] })),
    );
    const live = await Promise.all(many.map((m) => pics.get(m)));
    for (let w = 1; w <= ticks; w++) await pics.animate({ water: w, river: 0 }, live);
  };

  it("keeps no more than KEPT_FRAMES of the water's composited frames", async () => {
    const pics = setup();
    try {
      await shores(pics, 5, (2 * KEPT_FRAMES) / 5);
      expect(pics.kept()).toBe(KEPT_FRAMES);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps more frames for more animated pictures on the screen: two cycles of each', async () => {
    const pics = setup();
    try {
      await shores(pics, 40, 100);
      expect(pics.kept()).toBeGreaterThan(KEPT_FRAMES);
      expect(pics.kept()).toBeLessThan(40 * 100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('waterDrawingFor', () => {
  const look = { swell: 'swell.png', chop: 'chop.png' } as WaterLook;
  const pic = {} as HTMLImageElement;
  const load = () => Promise.resolve(pic);
  const pen = (start: WaterPen['start']): WaterPen => ({ maxField: 4096, start, field: () => {}, time: () => {} });

  it('draws the shader water when the Tileset has a look, the pen can draw it and the GPU builds its shader', async () => {
    const start = vi.fn(() => true);
    expect(await waterDrawingFor(look, pen(start), load)).toBe('surface');
    expect(start).toHaveBeenCalledWith(look, pic, pic);
  });

  it("falls back to FreeCol's frames without a look, or on a pen that cannot draw it", async () => {
    expect(
      await waterDrawingFor(
        null,
        pen(() => true),
        load,
      ),
    ).toBe('flipbook');
    expect(await waterDrawingFor(look, undefined, load)).toBe('flipbook');
  });

  it("falls back to FreeCol's frames when the shader does not compile or link, or anything on the way fails", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        await waterDrawingFor(
          look,
          pen(() => false),
          load,
        ),
      ).toBe('flipbook');
      const broken = () => {
        throw new Error('WebGL program error');
      };
      expect(await waterDrawingFor(look, pen(broken), load)).toBe('flipbook');
      expect(
        await waterDrawingFor(
          look,
          pen(() => true),
          () => Promise.reject(new Error('404')),
        ),
      ).toBe('flipbook');
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });
});
