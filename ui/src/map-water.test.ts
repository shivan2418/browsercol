import { describe, expect, it } from 'vite-plus/test';
import { blur, FIELD_TEXEL, fieldTexel, mapPixels, programLinks, waterField, waterLook, waterTime } from './map-water';
import { resources } from './resources';
import type { MapView } from './tileset';
import { tileOrigin } from './view';

describe('waterLook', () => {
  it("is none for a Tileset without the shader water's ripples: FreeCol's own", () => {
    expect(waterLook(resources([{ dir: 'default', props: 'image.tile.model.tile.ocean.center=o.png' }], []))).toBe(
      null,
    );
  });

  it("reads the look from the Tileset's shader.water keys, with numbers it leaves out at their defaults", () => {
    const props = `
shader.water.swell=water/swell.png
shader.water.chop=water/chop.png
shader.water.ocean=urn:color:0x0c3646
shader.water.highSeas=urn:color:0x092838
shader.water.lake=urn:color:0x0e3742
shader.water.shallow=urn:color:0x2b6a70
shader.water.foam=urn:color:0xd8e2d6
shader.water.light=urn:color:0x9fc8cc
shader.water.ocean.roughness="0.4"
shader.water.lake.foam="0.1"
shader.water.lake.speed="0.3"
shader.water.chopSize="96"
`;
    const look = waterLook(resources([{ dir: 'mods/plus', props }], []))!;
    expect(look).toMatchObject({
      swell: 'mods/plus/water/swell.png',
      chop: 'mods/plus/water/chop.png',
      ocean: 0x0c3646,
      highSeas: 0x092838,
      foam: 0xd8e2d6,
      chopSize: 96,
    });
    // Each kind of water its own roughness, foam and speed, or the defaults: lakes calm, with no breaking foam.
    expect(look.roughness).toEqual({ ocean: 0.4, highSeas: 0.8, lake: 0.3 });
    expect(look.foamStrength).toEqual({ ocean: 1, highSeas: 1, lake: 0.1 });
    expect([look.speed, look.lakeSpeed]).toEqual([1, 0.3]);
  });
});

describe('fieldTexel', () => {
  it('is FIELD_TEXEL map pixels, or more for a map too big for the GPU to take at that', () => {
    expect(fieldTexel(40, 100)).toBe(FIELD_TEXEL);
    // 200 tiles across is 25664 map pixels: 7 to a texel would fit 4096, but no fewer than 8.
    expect(fieldTexel(200, 120)).toBe(8);
    expect(fieldTexel(200, 120, 2048)).toBe(13);
    expect(Math.ceil(mapPixels(200, 120)[0] / fieldTexel(200, 120, 2048))).toBeLessThanOrEqual(2048);
  });
});

describe('blur', () => {
  it('spreads a value round it, keeping a flat field flat', () => {
    const flat = new Float32Array(25).fill(0.5);
    blur(flat, 5, 5, 1);
    expect([...flat].every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
    const dot = new Float32Array(25);
    dot[12] = 9;
    blur(dot, 5, 5, 1);
    // A 3x3 box: a ninth each, nothing further out.
    expect(dot[12]).toBeCloseTo(1);
    expect(dot[6]).toBeCloseTo(1);
    expect(dot[0]).toBe(0);
    expect(dot.reduce((a, b) => a + b, 0)).toBeCloseTo(9);
  });
});

describe('waterField', () => {
  // 8x8 tiles: the high seas in the first column, a lake at (5,5), land at (4,2), unexplored at (6,1), the rest ocean.
  const w = 8;
  const h = 8;
  const tiles = Array.from({ length: w * h }, (_, i) => {
    const [x, y] = [i % w, Math.floor(i / w)];
    if (x === 0) return 'C';
    if (x === 5 && y === 5) return 'D';
    if (x === 4 && y === 2) return 'A';
    if (x === 6 && y === 1) return '.';
    return 'B';
  }).join('');
  const map: Pick<MapView, 'w' | 'h' | 'types' | 'tiles'> = {
    w,
    h,
    types: [
      { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
      { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
      { id: 'model.tile.highSeas', land: false, forested: false, name: 'High Seas' },
      { id: 'model.tile.lake', land: false, forested: false, name: 'Lake' },
    ],
    tiles,
  };
  const texel = 8;
  /** The field's RGBA at a tile's centre. */
  const centre = (f: ReturnType<typeof waterField>, x: number, y: number) => {
    const [ox, oy] = tileOrigin(x, y);
    const k = Math.floor((oy + 32) / texel) * f.cols + Math.floor((ox + 64) / texel);
    return f.data.slice(4 * k, 4 * k + 4);
  };

  it('covers the whole map, a texel per `texel` map pixels', () => {
    const f = waterField(map, texel, () => 0);
    const [pw, ph] = mapPixels(w, h);
    expect([f.cols, f.rows, f.texel]).toEqual([Math.ceil(pw / texel), Math.ceil(ph / texel), texel]);
    expect(f.data.length).toBe(4 * f.cols * f.rows);
  });

  it('marks land, the depth of the water, and where there is water at all', () => {
    const f = waterField(map, texel, () => 0);
    const [land, depth, , water] = [0, 1, 2, 3];
    // Land: no water.
    expect(centre(f, 4, 2)[land]).toBe(255);
    expect(centre(f, 4, 2)[water]).toBe(0);
    // Open ocean: water, at the ocean's depth, a half.
    expect(centre(f, 3, 6)[water]).toBe(255);
    expect(centre(f, 3, 6)[depth]).toBe(128);
    expect(centre(f, 3, 6)[land]).toBe(0);
    // The high seas are deeper, a lake shallower; both fade into the ocean round them.
    expect(centre(f, 0, 4)[depth]).toBeGreaterThan(128);
    expect(centre(f, 5, 5)[depth]).toBeLessThan(128);
    // Unexplored: no water and no land.
    expect(centre(f, 6, 1)[water]).toBe(0);
    expect(centre(f, 6, 1)[land]).toBe(0);
  });

  it('says how near land is, fading out from it', () => {
    const f = waterField(map, texel, () => 0);
    const near = (x: number, y: number) => centre(f, x, y)[2];
    expect(near(4, 2)).toBeGreaterThan(near(4, 4));
    expect(near(4, 4)).toBeGreaterThanOrEqual(near(2, 6));
  });

  it('makes again only round the tiles that changed, coming out as a field made afresh would', () => {
    const coast = (x: number, y: number, u: number, v: number) => (x === 3 && y === 3 && v < 20 ? 1 : 0);
    const first = waterField(map, texel, coast);
    expect(waterField(map, texel, coast, first)).toBe(first);
    // Land explored at (6,1), and (2,6) turned to land.
    const later = {
      ...map,
      tiles: map.tiles
        .split('')
        .map((c, i) => (i === 1 * w + 6 || i === 6 * w + 2 ? 'A' : c))
        .join(''),
    };
    const fresh = waterField(later, texel, coast);
    const again = waterField(later, texel, coast, waterField(map, texel, coast));
    expect([...again.data]).toEqual([...fresh.data]);
  });

  it("counts a coast's sand as land, as much as it covers, where it is on its tile", () => {
    const asked: [number, number][] = [];
    // Sand over the top half of the ocean tile at (2,4).
    const f = waterField(map, texel, (x, y, u, v) => {
      if (x !== 2 || y !== 4) return 0;
      asked.push([u, v]);
      return v < 32 ? 1 : 0;
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every(([u, v]) => u >= 0 && u <= 128 && v >= 0 && v <= 64)).toBe(true);
    const [ox, oy] = tileOrigin(2, 4);
    const at = (px: number, py: number) => f.data[4 * (Math.floor(py / texel) * f.cols + Math.floor(px / texel))];
    expect(at(ox + 64, oy + 12)).toBe(255);
    expect(at(ox + 64, oy + 52)).toBe(0);
  });
});

describe('waterTime', () => {
  it('moves the ripples a little every moment, each offset within one turn of its texture', () => {
    const look = 1;
    const a = waterTime(look, 1000);
    const b = waterTime(look, 1100);
    expect(b.swell).not.toEqual(a.swell);
    expect(b.chop).not.toEqual(a.chop);
    for (const ms of [0, 1000, 1e6, 1e9])
      for (const v of [...waterTime(look, ms).swell, ...waterTime(look, ms).chop]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    expect(waterTime(look, 1e9).lap).toBeLessThan(2 * Math.PI);
  });

  it('stands still at a speed of 0', () => {
    expect(waterTime(0, 5000)).toEqual(waterTime(0, 0));
  });
});

describe('programLinks', () => {
  /** A WebGL context that fails to compile a shader whose source says so, to link, or throws, as told. */
  const gl = (fail: 'compile' | 'link' | 'throw' | null) => {
    const deleted: string[] = [];
    const ctx = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      createShader: (type: number) => ({ type, source: '' }),
      shaderSource: (s: { source: string }, source: string) => (s.source = source),
      compileShader: () => {
        if (fail === 'throw') throw new Error('context lost');
      },
      getShaderParameter: (s: { source: string }) => !(fail === 'compile' && s.source.includes('bad')),
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => fail !== 'link',
      deleteProgram: () => deleted.push('program'),
      deleteShader: () => deleted.push('shader'),
    };
    return { ctx: ctx as unknown as WebGLRenderingContext, deleted };
  };

  it('is true for a program the GPU compiles and links, and cleans up after itself', () => {
    const { ctx, deleted } = gl(null);
    expect(programLinks(ctx, { vertex: 'v', fragment: 'f' })).toBe(true);
    expect(deleted.sort()).toEqual(['program', 'shader', 'shader']);
  });

  it('is false when a shader does not compile, the program does not link, or the context throws', () => {
    expect(programLinks(gl('compile').ctx, { vertex: 'v', fragment: 'bad' })).toBe(false);
    expect(programLinks(gl('link').ctx, { vertex: 'v', fragment: 'f' })).toBe(false);
    expect(programLinks(gl('throw').ctx, { vertex: 'v', fragment: 'f' })).toBe(false);
  });
});
