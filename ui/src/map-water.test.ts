import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  blur,
  closeCoast,
  lakeMask,
  coverAt,
  coverOf,
  FIELD_TEXEL,
  fieldTexel,
  mapPixels,
  riverDirections,
  type RiverMap,
  programLinks,
  waterField,
  waterLook,
  waterTime,
  type WaterRecipe,
} from './map-water';
import { resources } from './resources';
import type { MapView } from './tileset';
import { tileOrigin } from './view';

describe('riverDirections', () => {
  const network = (rivers: MapView['rivers'], water: [number, number][] = []): RiverMap => {
    const tiles = Array<string>(36).fill('A');
    for (const [x, y] of water) tiles[y * 6 + x] = 'B';
    return {
      w: 6,
      h: 6,
      tiles: tiles.join(''),
      rivers,
      types: [
        { id: 'model.tile.plains', name: 'Plains', land: true, forested: false },
        { id: 'model.tile.lake', name: 'Lake', land: false, forested: false },
      ],
    };
  };
  it('drains a straight river into water across staggered rows', () => {
    const map = network(
      [
        [2, 4, 1, '1000', ''],
        [2, 3, 1, '1010', ''],
        [3, 2, 1, '1010', ''],
      ],
      [[3, 1]],
    );
    expect([...riverDirections(map).values()]).toEqual([0, 0, 0]);
  });
  it('turns through a bend rather than following the incoming heading', () => {
    const map = network(
      [
        [2, 4, 1, '1000', ''],
        [2, 3, 1, '0011', ''],
        [2, 2, 1, '0101', ''],
      ],
      [[1, 1]],
    );
    expect([...riverDirections(map).values()]).toEqual([0, 3, 3]);
  });
  it('carries a minor tributary into the major river', () => {
    const map = network(
      [
        [1, 3, 1, '2000', ''],
        [2, 2, 2, '0212', ''],
        [1, 1, 2, '0200', ''],
      ],
      [[2, 3]],
    );
    const flow = riverDirections(map);
    expect(flow.get(19)).toBe(0);
    expect(flow.get(14)).toBe(1);
    expect(flow.get(7)).toBe(1);
  });
  it('prefers the larger mouth, then the nearest equally large mouth', () => {
    const map = network(
      [
        [2, 4, 1, '1010', ''],
        [2, 3, 1, '1010', ''],
        [3, 2, 2, '2020', ''],
      ],
      [
        [1, 5],
        [3, 1],
      ],
    );
    expect(riverDirections(map).get(20)).toBe(0);
    map.rivers[2][2] = 1;
    expect(riverDirections(map).get(26)).toBe(2);
    expect(riverDirections(map).get(15)).toBe(0);
    expect(riverDirections(map).get(20)).toBe(0);
  });
  it('drains an inland river toward its largest end, independently of input order', () => {
    const map = network([
      [2, 4, 1, '1000', ''],
      [2, 3, 1, '1010', ''],
      [3, 2, 2, '0020', ''],
    ]);
    const flow = riverDirections(map);
    expect(flow.get(26)).toBe(0);
    expect(flow.get(20)).toBe(0);
    expect(flow.get(15)).toBe(-1);
    map.rivers.reverse();
    expect(riverDirections(map)).toEqual(flow);
  });
  it('orients a closed loop without a directed cycle', () => {
    const map = network([
      [2, 2, 2, '0110', ''],
      [2, 3, 1, '0011', ''],
      [2, 4, 1, '1001', ''],
      [1, 3, 1, '1100', ''],
    ]);
    const flow = riverDirections(map);
    expect(flow.get(14)).toBe(-1);
    expect(flow.get(20)).toBe(3);
    expect(flow.get(19)).toBe(0);
    expect(flow.get(26)).toBe(0);
  });
});

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
    // FreeCol+ names no painted-art recipe and keeps FreeCol's flipbook rivers.
    expect(look.recipe).toBeUndefined();
    expect(look.rivers?.mode).toBe('flipbook');
  });

  it("gives BrowserCol (#411) the playground's variant E, its climate palettes and flowing rivers", () => {
    const props = readFileSync(new URL('../tilesets/browsercol/resources.properties', import.meta.url), 'utf8');
    const look = waterLook(resources([{ dir: 'mods/browsercol', props }], []))!;
    expect(look.recipe).toEqual({
      shallows: 'climate',
      shore: 'art',
      motion: 'bands',
      deep: 'climate',
      depth: 'deeper',
      bandSpeed: 5,
      bandSpacing: 40,
      driftSpeed: 2,
      shelfWidth: 90,
      climateBlend: 3,
      clip: 1,
      clipAt: -2,
    });
    expect(look.palettes.tropical).toEqual({ deep: 0x0c3a4c, shallow: 0x40c6b9, foam: 0xe6eee6, foamAmount: 1 });
    expect(look.rivers).toEqual({ mode: 'flow', minor: 6, major: 3, streakStrength: 0.1 });
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
  const recipe: WaterRecipe = {
    shallows: 'climate',
    shore: 'drawn',
    motion: 'bands',
    deep: 'plain',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 32,
    driftSpeed: 2,
    shelfWidth: 110,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
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

  it('keeps a one-tile pond calm and does not drain it through a river or a corner', () => {
    const types = [...map.types, { id: 'model.tile.greatRiver', land: false, forested: false, name: 'River' }];
    const tiles = Array.from({ length: w * h }, () => 'A');
    tiles[3 * w] = 'B'; // edge ocean
    tiles[3 * w + 1] = 'B'; // touches the ocean at a corner only
    tiles[3 * w + 2] = 'E'; // river
    tiles[3 * w + 3] = 'B'; // pond, connected only through the river
    const lakes = lakeMask({ ...map, types, tiles: tiles.join('') });
    expect(lakes[3 * w]).toBe(0);
    expect(lakes[3 * w + 1]).toBe(1);
    expect(lakes[3 * w + 3]).toBe(1);
    // A long-side opening drains the first pool.
    tiles[2 * w + 1] = 'B';
    expect(lakeMask({ ...map, types, tiles: tiles.join('') })[3 * w + 1]).toBe(0);
  });

  it('closing fills notches without cutting land or protected sailing channels', () => {
    const cols = 31,
      rows = 31;
    const land = new Float32Array(cols * rows);
    const channels = new Uint8Array(land.length);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const k = y * cols + x;
        land[k] = y < 15 && !(x >= 13 && x <= 16 && y > 9) ? 1 : 0;
        if (x === y && y >= 15) channels[k] = 1;
      }
    const closed = closeCoast(land, channels, cols, rows, 2, 8);
    expect(closed[12 * cols + 14]).toBe(1);
    for (let k = 0; k < land.length; k++) {
      if (land[k]) expect(closed[k]).toBe(1);
      if (channels[k] && !land[k]) expect(closed[k]).toBe(0);
    }
  });

  it('rounds a drawn diagonal coast into a beach without covering a water centre', () => {
    const coast = {
      ...map,
      tiles: Array.from({ length: w * h }, (_, k) => (k % w < 4 ? 'A' : 'B')).join(''),
    };
    const f = waterField(coast, 4, () => 0, null, 'signed', recipe);
    const cover = (x: number, y: number) => f.data[4 * (Math.floor(y / f.texelY!) * f.cols + Math.floor(x / f.texel))];
    // An inward corner between the alternating diamond tips, beyond the original tile.
    expect(cover(524, 96)).toBe(255);
    // The neighbouring water tile's centre remains open for ships.
    expect(cover(576, 96)).toBe(0);
    for (let k = 0; k < f.made!.land.length; k++) if (f.made!.land[k]) expect(f.data[4 * k]).toBe(255);
  });

  it('preserves the water passage between corner-touching tiles after closing', () => {
    const tiles = Array.from({ length: w * h }, () => 'A');
    tiles[3 * w + 3] = tiles[3 * w + 4] = 'B';
    const f = waterField({ ...map, tiles: tiles.join('') }, 4, () => 0, null, 'signed', recipe);
    const [ox, oy] = tileOrigin(3, 3);
    const start = Math.floor((oy + 32) / f.texelY!) * f.cols + Math.floor((ox + 64) / f.texel);
    const end = start + 32;
    const seen = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head];
      for (const dy of [-1, 0, 1])
        for (const dx of [-1, 0, 1]) {
          const q = k + dy * f.cols + dx;
          if (q >= 0 && q < f.cols * f.rows && !seen.has(q) && f.data[4 * q] === 0) {
            seen.add(q);
            queue.push(q);
          }
        }
    }
    expect(seen.has(end)).toBe(true);
  });

  it('patches a coast explored on a big map like a fresh field, as far as the shore distance reaches (#411)', () => {
    // 20 by 60 tiles of ocean, a land block explored later: the shore distance reaches 192 map pixels, which is more
    // texel rows than columns, a recipe's texels being half as tall.
    const [bw, bh] = [20, 60];
    const land = (k: number) => k % bw >= 8 && k % bw < 12 && Math.floor(k / bw) >= 24 && Math.floor(k / bw) < 36;
    const unexplored = Array.from({ length: bw * bh }, (_, k) => (land(k) ? '.' : 'B')).join('');
    const explored = Array.from({ length: bw * bh }, (_, k) => (land(k) ? 'A' : 'B')).join('');
    const big = { w: bw, h: bh, types: map.types, tiles: unexplored };
    const before = waterField(big, texel, () => 0, null, 'signed', recipe);
    const patched = waterField({ ...big, tiles: explored }, texel, () => 0, before, 'signed', recipe);
    const fresh = waterField({ ...big, tiles: explored }, texel, () => 0, null, 'signed', recipe);
    expect(patched.data).toEqual(fresh.data);
    expect(patched.climate).toEqual(fresh.climate);
  });

  it('blends cold and temperate coasts continuously and patches exploration like a fresh field', () => {
    const types = [...map.types, { id: 'model.tile.tundra', land: true, forested: false, name: 'Tundra' }];
    const tiles = Array.from({ length: w * h }, (_, k) => (Math.floor(k / w) < 3 ? (k % w < 4 ? 'E' : 'A') : 'B')).join(
      '',
    );
    const mixed = { ...map, types, tiles };
    const f = waterField(mixed, texel, () => 0, null, 'signed', recipe);
    const row = Math.floor((4 * 32) / f.texelY!);
    for (let x = 30; x < 95; x++) {
      const k = 4 * (row * f.cols + x);
      expect(Math.abs(f.climate![k] - f.climate![k - 4])).toBeLessThan(12);
      expect(f.climate![k] + f.climate![k + 1] + f.climate![k + 2]).toBeCloseTo(255, -1);
    }
    const centre = 4 * (row * f.cols + Math.floor((4 * 128) / texel));
    expect(f.climate![centre]).toBeGreaterThan(30);
    expect(f.climate![centre + 1]).toBeGreaterThan(30);
    const explored = { ...mixed, tiles: tiles.slice(0, 35) + 'A' + tiles.slice(36) };
    const patched = waterField(explored, texel, () => 0, f, 'signed', recipe);
    const fresh = waterField(explored, texel, () => 0, null, 'signed', recipe);
    expect(patched.data).toEqual(fresh.data);
    expect(patched.climate).toEqual(fresh.climate);
    // A river explored at the coast makes the field again round its tile alone (#411), its plume as a fresh field's.
    const river = { ...explored, rivers: [[2, 2, 1, '0110', '0110']] as MapView['rivers'] };
    const withRiver = waterField(river, texel, () => 0, patched, 'signed', recipe);
    const freshRiver = waterField(river, texel, () => 0, null, 'signed', recipe);
    expect(withRiver.climate).toEqual(freshRiver.climate);
    expect(withRiver.climate).not.toEqual(fresh.climate);
    expect(withRiver.data).toEqual(freshRiver.data);
  });
});

describe('waterTime', () => {
  it('moves the ripples a little every moment, each offset within one turn of its texture', () => {
    const speed = 1;
    const a = waterTime(speed, 1000);
    const b = waterTime(speed, 1100);
    expect(b.swell).not.toEqual(a.swell);
    expect(b.chop).not.toEqual(a.chop);
    for (const ms of [0, 1000, 1e6, 1e9])
      for (const v of [...waterTime(speed, ms).swell, ...waterTime(speed, ms).chop]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    expect(waterTime(speed, 1e9).lap).toBeLessThan(2 * Math.PI);
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

describe('coverOf', () => {
  /** A tile-sized picture of one alpha all over, read back through a fake canvas. */
  const picture = (alpha: number) => ({ width: 128, height: 64, alpha }) as unknown as HTMLCanvasElement;
  const fakeDocument = () => {
    let drawn = 0;
    const g = {
      drawImage: (p: { alpha: number }) => (drawn = p.alpha),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(4 * w * h).map((_, i) => (i % 4 === 3 ? Math.round(drawn * 255) : 0)),
      }),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => g }) });
  };

  it("is a picture's own alpha, or what pictures over each other leave uncovered taken from one", () => {
    fakeDocument();
    try {
      const half = picture(0.5);
      const fifth = picture(0.2);
      expect(coverAt(coverOf([half]), 64, 32)).toBeCloseTo(0.5, 2);
      // 1 - (1 - 0.5)(1 - 0.2)
      const both = coverOf([half, fifth]);
      expect(coverAt(both, 0, 0)).toBeCloseTo(0.6, 2);
      expect(coverAt(both, 127, 63)).toBeCloseTo(0.6, 2);
      // The same pictures again: the same cover, made once.
      expect(coverOf([half, fifth])).toBe(both);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
