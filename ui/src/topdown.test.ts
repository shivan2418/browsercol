import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { resources } from './resources';
import {
  currentView,
  isometric,
  mapGrid,
  neighbourOnScreen,
  projection,
  setView,
  T,
  topDown,
  type Direction,
} from './projection';
import { staticScene, unitScene, type MapView, type Op } from './tileset';
import { drawFlat, flatSrc, FLAT, lookOf, riverSides } from './topdown-art';
import { initialView, reduce, switchView, type MapFacts, type ViewEvent } from './view';

afterEach(() => {
  setView('isometric');
  vi.unstubAllGlobals();
});

// The Top-down view (#530): 64x64 squares, north up, the map a rectangle.
describe('the top-down projection', () => {
  const [w, h] = [7, 5];

  it('puts tile (x, y) at (x, y) times 64, and the whole map in a rectangle', () => {
    expect(topDown.tile).toEqual({ w: 64, h: 64 });
    expect(topDown.origin(3, 2, h)).toEqual([192, 128]);
    expect(topDown.centre(3, 2, h)).toEqual([224, 160]);
    expect(topDown.mapSize(w, h)).toEqual([448, 320]);
    expect(topDown.blockSize()).toEqual([192, 192]);
    expect(topDown.block(2, 1)).toEqual([128, 64]);
  });

  it('round-trips every tile through its middle and the points near its corners', () => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [cx, cy] = topDown.centre(x, y, h);
        for (const [dx, dy] of [
          [0, 0],
          [31, 31],
          [-31, -31],
          [31, -31],
          [-31, 31],
        ])
          expect(topDown.tileAt(w, h, cx + dx, cy + dy)).toEqual([x, y]);
      }
    }
  });

  it('hits the tile by its box, and nothing off the map', () => {
    expect(topDown.tileAt(w, h, 0, 0)).toEqual([0, 0]);
    expect(topDown.tileAt(w, h, 63.9, 63.9)).toEqual([0, 0]);
    expect(topDown.tileAt(w, h, 64, 0)).toEqual([1, 0]);
    expect(topDown.tileAt(w, h, 447, 319)).toEqual([6, 4]);
    expect(topDown.tileAt(w, h, 448, 10)).toBeNull();
    expect(topDown.tileAt(w, h, 10, 320)).toBeNull();
    expect(topDown.tileAt(w, h, -1, 10)).toBeNull();
    expect(topDown.tileAt(w, h, 10, -1)).toBeNull();
  });

  it("keeps the camera on the map's rectangle, and says how far down the rows a point is", () => {
    expect(topDown.keepOn(w, h, [100, 100])).toEqual([100, 100]);
    expect(topDown.keepOn(w, h, [-50, 900])).toEqual([0, 320]);
    expect(topDown.keepOn(w, h, [9000, -5])).toEqual([448, 0]);
    expect(topDown.rowFraction(h, 100, 0)).toBe(0);
    expect(topDown.rowFraction(h, 100, 160)).toBeCloseTo(0.5);
    expect(topDown.rowFraction(h, 100, 999)).toBe(1);
  });

  it('draws the tiles row by row, all inside the map size', () => {
    const seen: [number, number][] = [];
    topDown.eachTile(3, 2, (x, y) => seen.push([x, y]));
    expect(seen).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    const [mw, mh] = topDown.mapSize(w, h);
    topDown.eachTile(w, h, (x, y) => {
      const [ox, oy] = topDown.origin(x, y, h);
      expect(ox).toBeGreaterThanOrEqual(0);
      expect(ox + T).toBeLessThanOrEqual(mw);
      expect(oy + T).toBeLessThanOrEqual(mh);
    });
  });

  it('has no turn between the grid and the screen: the neighbour in a direction is where it shows', () => {
    setView('topdown');
    expect(currentView()).toBe('topdown');
    const dirs: Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (const d of dirs) {
      expect(projection.onScreen(d)).toBe(d);
      expect(projection.inGrid(d)).toBe(d);
      expect(neighbourOnScreen(4, 4, d)).toEqual(mapGrid.neighbour(4, 4, d));
    }
    // On the screen a neighbour's middle is a tile away in that direction: N is up, E is right.
    const at = (x: number, y: number) => projection.centre(x, y, 9);
    const [cx, cy] = at(4, 4);
    for (const d of dirs) {
      const [nx, ny] = neighbourOnScreen(4, 4, d);
      const [px, py] = at(nx, ny);
      expect([Math.sign(px - cx), Math.sign(py - cy)]).toEqual(mapGrid.neighbour(0, 0, d));
    }
    expect(projection.faces).toEqual(['N', 'E', 'S', 'W']);
    expect(projection.isFace('N')).toBe(true);
    expect(projection.isFace('NE')).toBe(false);
  });

  it('outlines a tile as a square in its box, and a smaller one about the same middle', () => {
    expect(topDown.outline([64, 128])).toEqual([
      [64, 128],
      [128, 128],
      [128, 192],
      [64, 192],
    ]);
    expect(topDown.outline([0, 0], 64, 0.5)).toEqual([
      [16, 16],
      [48, 16],
      [48, 48],
      [16, 48],
    ]);
    // The minimap's tile is `width` wide.
    expect(topDown.outline([8, 8], 4)[2]).toEqual([12, 12]);
  });

  it("gives the sides' ends and middles and the places roads and rivers leave by", () => {
    expect(topDown.edge('N')).toEqual([
      [0, 0],
      [64, 0],
    ]);
    expect(topDown.edge('E')).toEqual([
      [64, 0],
      [64, 64],
    ]);
    expect(topDown.edgeMidpoint('S')).toEqual([0, 32]);
    expect(topDown.edgeMidpoint('W')).toEqual([-32, 0]);
    expect(topDown.anchor('N')).toEqual([32, 0]);
    expect(topDown.anchor('E')).toEqual([64, 32]);
    expect(topDown.anchor('SE')).toEqual([64, 64]);
    expect(topDown.anchor('NW')).toEqual([0, 0]);
  });

  it('measures how far in a tile a point is: 0 at the middle, 1 on the square', () => {
    expect(topDown.inset(32, 32)).toBe(0);
    expect(topDown.inset(0, 32)).toBe(1);
    expect(topDown.inset(64, 0)).toBe(1);
    expect(topDown.fromAbove(3, 5)).toEqual([3, 5]);
  });

  it('counts a step by the stride: an edge step is as long here as in the Isometric view', () => {
    // An edge step is (64, 0) here and (64, 32) there, which are half of each view's stride.
    expect(topDown.stride).toEqual({ w: 2 * T, h: 2 * T });
    expect(isometric.stride).toEqual({ w: 128, h: 64 });
  });
});

describe('switching the Map view', () => {
  const facts = (more: Partial<MapFacts> = {}): MapFacts => ({
    w: 20,
    h: 20,
    types: [],
    tiles: '',
    owners: '',
    players: [],
    active: null,
    activeUnit: null,
    ...more,
  });
  const events: ViewEvent[] = [
    { k: 'map', map: facts() },
    { k: 'resize', width: 640, height: 480 },
  ];
  const play = (...more: ViewEvent[]) => [...events, ...more].reduce(reduce, initialView);

  it('keeps the camera on the tile it was centred on, both ways', () => {
    const at: [number, number] = [5, 11];
    const iso = play({ k: 'centre', at: projection.centre(...at, 20) });
    const top = switchView(iso, 'topdown');
    expect(currentView()).toBe('topdown');
    expect(top.centre).toEqual(topDown.centre(...at, 20));
    const back = switchView(top, 'isometric');
    expect(currentView()).toBe('isometric');
    expect(back.centre).toEqual(isometric.centre(...at, 20));
  });

  it('does nothing when the view is on that already', () => {
    const v = play();
    expect(switchView(v, 'isometric')).toBe(v);
  });

  it("keeps the camera on the map's rectangle in the Top-down view", () => {
    const top = switchView(play(), 'topdown');
    const far = reduce(top, { k: 'centre', at: [90000, -90000] });
    expect(far.centre[0]).toBeLessThanOrEqual(20 * T);
    expect(far.centre[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('the placeholder art', () => {
  const type = (id: string, land = true, forested = false) => ({ id: `model.tile.${id}`, land, forested });

  it('gives each terrain a colour, and hills, mountains, forest and marsh a marker', () => {
    expect(lookOf(type('hills')).marker).toBe('hills');
    expect(lookOf(type('mountains')).marker).toBe('mountains');
    expect(lookOf(type('mixedForest', true, true)).marker).toBe('forest');
    expect(lookOf(type('swamp')).marker).toBe('marsh');
    expect(lookOf(type('plains')).marker).toBe('none');
    expect(lookOf(type('plains')).colour).not.toBe(lookOf(type('ocean', false)).colour);
    // A type it has no colour for is told apart by land and water.
    expect(lookOf(type('unheardOf', true)).colour).not.toBe(lookOf(type('unheardOf', false)).colour);
    expect(lookOf(null).colour).toBe(0);
  });

  it('names the picture by what it shows, and draws it a tile big', () => {
    const name = flatSrc(0x7bbd4c, 'hills', riverSides('1010', ['N', 'E', 'S', 'W']));
    expect(name).toBe(`${FLAT}7bbd4c:hills:NS`);
    expect(riverSides('0000', ['N', 'E', 'S', 'W'])).toBe('');
    // A canvas that takes any drawing call and keeps the fills it was asked for.
    const fills: unknown[] = [];
    const context = new Proxy(
      {},
      {
        get: (_, key) => (typeof key === 'string' && key !== 'fillStyle' ? () => {} : undefined),
        set: (_, key, value) => {
          if (key === 'fillStyle') fills.push(value);
          return true;
        },
      },
    );
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const pic = drawFlat(name);
    expect([pic.width, pic.height]).toEqual([T, T]);
    // The ground first, in the type's colour.
    expect(fills[0]).toBe('rgb(123, 189, 76)');
  });
});

describe('the top-down scene', () => {
  const props = `
image.unit.model.unit.caravel=resources/caravel.png
image.tileitem.model.resource.ore=resources/ore.png
image.tileoverlay.model.tile.hills=resources/hills0.png
image.tile.model.tile.plains.center=resources/plains0.png
color.map.road=urn:color:0x804000
`;
  const res = resources(
    [{ dir: 'default', props }],
    ['caravel', 'ore', 'hills0', 'plains0'].map((f) => `default/resources/${f}.png`),
  );
  const map: MapView = {
    w: 3,
    h: 2,
    turn: 'Spring 1492',
    turnLabel: 'Spring 1492',
    nation: 'model.nation.dutch',
    statusLine: '',
    ourTurn: true,
    colonial: true,
    europe: true,
    types: [
      { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
      { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
      { id: 'model.tile.hills', land: true, forested: false, name: 'Hills' },
    ],
    tiles: 'ABC' + 'A.A',
    seen: '111' + '110',
    owners: '......',
    players: [],
    rivers: [[0, 0, 1, '0100', '0000']],
    roads: [[0, 1, 150]],
    items: [
      [2, 0, 400, 'centered', 'image.tileitem.model.resource.ore'],
      [0, 0, 300, 'tile', 'image.tileitem.model.resource.ore'],
    ],
    settlements: [],
    units: [
      { x: 1, y: 0, keys: ['image.unit.model.unit.caravel'], rgb: 0xff8000, chip: '-', fg: 0, stack: 1, fade: false },
    ],
    active: [1, 0],
    activeUnit: null,
  };
  const of = (ops: Op[], x: number, y: number) => ops.filter((op) => op.x === x && op.y === y);
  const imageSrc = (op: Op | undefined) => (op?.k === 'image' ? op.src : undefined);
  const isFlat = (op: Op) => op.k === 'image' && typeof op.src === 'string' && op.src.startsWith(FLAT);
  const ground = () => {
    const s = staticScene(map, res);
    return [...s.base, ...s.below, ...s.above];
  };

  it('draws a flat tile for every tile, with no animated base, transitions or art for diamonds', () => {
    setView('topdown');
    expect(staticScene(map, res).base).toEqual([]);
    const tiles = ground().filter(isFlat);
    expect(tiles).toHaveLength(6);
    for (const op of tiles) expect(op.k === 'image' && op.at).toBe('tile');
    // The river on (0, 0), whose style 0100 crosses the E side; the unexplored (1, 1) is black.
    expect(imageSrc(of(tiles, 0, 0)[0])).toBe(flatSrc(lookOf(map.types[0]).colour, 'none', 'E'));
    expect(imageSrc(of(tiles, 1, 1)[0])).toBe(flatSrc(0, 'none', ''));
    // No diamond overlay for the hills: they are marked on the tile.
    expect(ground().some((op) => imageSrc(op) === 'default/resources/hills0.png')).toBe(false);
  });

  it('draws what is centred on a tile smaller, centred, and leaves out what fills a diamond', () => {
    setView('topdown');
    const fitted = (x: number, y: number) => of(ground(), x, y).filter((op) => !isFlat(op) && op.k === 'image');
    expect(fitted(2, 0)).toHaveLength(1);
    const op = fitted(2, 0)[0];
    expect(op.k === 'image' && op.at).toBe('center');
    const src = imageSrc(op);
    expect(typeof src !== 'string' && src?.id).toContain('fit:');
    // The item that fills a tile on (0, 0) is left out.
    expect(fitted(0, 0)).toHaveLength(0);
  });

  it('draws the road, and the units fitted on the tile', () => {
    setView('topdown');
    expect(of(ground(), 0, 1).some((op) => op.k === 'road')).toBe(true);
    const unit = unitScene(map, res).find((op) => op.k === 'image');
    expect(unit?.k === 'image' && unit.at).toBe('center');
  });

  it('draws the Isometric scene as before in the other view', () => {
    // Without the river, whose art the test's few pictures leave out.
    const iso = staticScene({ ...map, rivers: [] }, res);
    expect(iso.below.some((op) => imageSrc(op) === 'default/resources/plains0.png')).toBe(true);
    expect([...iso.base, ...iso.below, ...iso.above].some(isFlat)).toBe(false);
  });
});
