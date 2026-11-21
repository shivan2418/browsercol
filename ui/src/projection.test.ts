import { describe, expect, it } from 'vite-plus/test';
import { isometric, mapGrid, neighbourOnScreen, projection, square, type Direction } from './projection';

// A 3-wide, 2-tall map (w 3, h 2) in the Isometric view. Tile (x, y)'s box is at ((x - y + 1) * 64, (x + y) * 32),
// 128x64, so (0,0) is at (64, 0), (2,0) at (192, 64), (0,1) at (0, 32) and (2,1) at (128, 96); the map is
// 320x160.
describe('tileAt', () => {
  const at = (px: number, py: number) => projection.tileAt(3, 2, px, py);

  it("finds the tile whose diamond holds a point, from each tile's middle", () => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) expect(at(...projection.centre(x, y, 2))).toEqual([x, y]);
    }
  });

  it("is exact to the diamond's edge, and gives the boxes' corners to the neighbouring tiles", () => {
    // (0,0)'s diamond spans x 64..192 and y 0..64 about (128, 32).
    expect(at(128, 1)).toEqual([0, 0]);
    expect(at(70, 32)).toEqual([0, 0]);
    // Inside (0,0)'s box but past its lower right edge: (1,0), whose middle is at (192, 64).
    expect(at(185, 55)).toEqual([1, 0]);
    // The same, past its lower left edge: (0,1), whose middle is at (64, 64).
    expect(at(70, 55)).toEqual([0, 1]);
  });

  it("is null off the map, including the corners of the map's box", () => {
    expect(at(5, 5)).toBeNull();
    expect(at(315, 5)).toBeNull();
    expect(at(5, 155)).toBeNull();
    expect(at(128, -3)).toBeNull();
    expect(at(128, 170)).toBeNull();
    expect(at(-10, 80)).toBeNull();
    expect(at(330, 80)).toBeNull();
  });

  it('round-trips every tile of a large map, at the middle and the points near each corner of its diamond', () => {
    const [w, h] = [7, 11];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [cx, cy] = projection.centre(x, y, h);
        for (const [dx, dy] of [
          [0, 0],
          [60, 0],
          [-60, 0],
          [0, 30],
          [0, -30],
        ]) {
          expect(projection.tileAt(w, h, cx + dx, cy + dy)).toEqual([x, y]);
        }
      }
    }
  });
});

describe('the square grid', () => {
  it('is the grid and the projection the map draws with', () => {
    expect(mapGrid).toBe(square);
    expect(projection).toBe(isometric);
  });

  it('finds a tile\'s neighbours with the same steps in every row ("N" is up the rows)', () => {
    for (const y of [2, 3]) {
      expect(mapGrid.neighbour(3, y, 'N')).toEqual([3, y - 1]);
      expect(mapGrid.neighbour(3, y, 'NE')).toEqual([4, y - 1]);
      expect(mapGrid.neighbour(3, y, 'E')).toEqual([4, y]);
      expect(mapGrid.neighbour(3, y, 'SE')).toEqual([4, y + 1]);
      expect(mapGrid.neighbour(3, y, 'S')).toEqual([3, y + 1]);
      expect(mapGrid.neighbour(3, y, 'SW')).toEqual([2, y + 1]);
      expect(mapGrid.neighbour(3, y, 'W')).toEqual([2, y]);
      expect(mapGrid.neighbour(3, y, 'NW')).toEqual([2, y - 1]);
    }
  });

  it('has each neighbour see the tile in the opposite direction', () => {
    for (const y of [4, 5]) {
      for (const d of mapGrid.directions) {
        const [nx, ny] = mapGrid.neighbour(7, y, d);
        expect(mapGrid.neighbour(nx, ny, mapGrid.opposite(d))).toEqual([7, y]);
      }
    }
  });

  it('splits the directions into the edge neighbours, in river style order, and the corner ones', () => {
    expect(mapGrid.edges).toEqual(['N', 'E', 'S', 'W']);
    expect(mapGrid.corners).toEqual(['NE', 'SE', 'SW', 'NW']);
    expect([...mapGrid.edges, ...mapGrid.corners].sort()).toEqual([...mapGrid.directions].sort());
    expect(mapGrid.edges.map((d) => mapGrid.edgeIndex(d))).toEqual([0, 1, 2, 3]);
    expect(mapGrid.edgeIndex('NE')).toBe(-1);
    expect(mapGrid.isEdge('S')).toBe(true);
    expect(mapGrid.isEdge('SW')).toBe(false);
  });

  it('numbers the tiles along its axes, a step along an edge changing one of them by one', () => {
    const [u, v] = mapGrid.lattice(6, 5);
    const at = (d: Direction) => mapGrid.lattice(...mapGrid.neighbour(6, 5, d));
    expect(at('E')).toEqual([u + 1, v]);
    expect(at('W')).toEqual([u - 1, v]);
    expect(at('N')).toEqual([u, v - 1]);
    expect(at('S')).toEqual([u, v + 1]);
  });
});

describe('the isometric projection', () => {
  it('turns the grid an eighth: the first tile at the top, east down to the right, south down to the left', () => {
    expect(projection.origin(0, 0, 2)).toEqual([64, 0]);
    expect(projection.origin(1, 0, 2)).toEqual([128, 32]);
    expect(projection.origin(0, 1, 2)).toEqual([0, 32]);
    expect(projection.origin(2, 1, 2)).toEqual([128, 96]);
    expect(projection.centre(2, 1, 2)).toEqual([192, 128]);
    expect(projection.mapSize(3, 2)).toEqual([320, 160]);
    expect(projection.mapSize(80, 50)).toEqual([8320, 4160]);
  });

  it('puts every tile of the map inside the map size, with its last tile touching an edge', () => {
    const [w, h] = [5, 9];
    const [mw, mh] = projection.mapSize(w, h);
    const boxes = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) boxes.push(projection.origin(x, y, h));
    expect(Math.min(...boxes.map((b) => b[0]))).toBe(0);
    expect(Math.max(...boxes.map((b) => b[0] + 128))).toBe(mw);
    expect(Math.min(...boxes.map((b) => b[1]))).toBe(0);
    expect(Math.max(...boxes.map((b) => b[1] + 64))).toBe(mh);
  });

  it('draws the tiles along the diagonals, back to front and each from west to east', () => {
    const seen: string[] = [];
    projection.eachTile(3, 2, (x, y) => seen.push(`${x},${y}`));
    expect(seen).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    // Each tile once, and none drawn before a tile it is in front of (smaller x + y, or the same and further west).
    const all: string[] = [];
    projection.eachTile(6, 4, (x, y) => all.push(`${x},${y}`));
    expect(new Set(all).size).toBe(24);
    const order = all.map((k) => k.split(',').map(Number));
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1], order[i]];
      expect(a[0] + a[1] < b[0] + b[1] || (a[0] + a[1] === b[0] + b[1] && a[0] - a[1] < b[0] - b[1])).toBe(true);
    }
  });

  it("shows the grid direction in the screen direction an eighth round: the diamond's faces are the edge neighbours", () => {
    expect(projection.faces).toEqual(['NE', 'SE', 'SW', 'NW']);
    expect(mapGrid.edges.map((d) => projection.onScreen(d))).toEqual(projection.faces);
    for (const d of mapGrid.directions) expect(projection.inGrid(projection.onScreen(d))).toBe(d);
    expect(projection.isFace('NW')).toBe(true);
    expect(projection.isFace('W')).toBe(false);
  });

  it("finds the neighbour a picture's direction points to, where it shows on the screen", () => {
    // The screen's NE of (3, 3) is the one up and to the right of it: the grid's N.
    expect(neighbourOnScreen(3, 3, 'NE')).toEqual([3, 2]);
    expect(neighbourOnScreen(3, 3, 'SE')).toEqual([4, 3]);
    expect(neighbourOnScreen(3, 3, 'N')).toEqual([2, 2]);
    expect(neighbourOnScreen(3, 3, 'E')).toEqual([4, 2]);
    // And it is where the screen shows it, a diagonal step half a tile each way and a corner step a tile across.
    const here = projection.origin(3, 3, 8);
    for (const [d, dx, dy] of [
      ['NE', 64, -32],
      ['SE', 64, 32],
      ['SW', -64, 32],
      ['NW', -64, -32],
      ['N', 0, -64],
      ['E', 128, 0],
      ['S', 0, 64],
      ['W', -128, 0],
    ] as const) {
      const [nx, ny] = neighbourOnScreen(3, 3, d);
      const there = projection.origin(nx, ny, 8);
      expect([there[0] - here[0], there[1] - here[1]]).toEqual([dx, dy]);
    }
  });

  it('outlines a tile as a diamond in its box, and a smaller one about the same middle', () => {
    expect(projection.outline([0, 0])).toEqual([
      [64, 0],
      [128, 32],
      [64, 64],
      [0, 32],
    ]);
    expect(projection.outline([10, 20], 8, 0.5)).toEqual([
      [14, 21],
      [16, 22],
      [14, 23],
      [12, 22],
    ]);
  });

  it("gives an edge's two ends from the anchors and its middle from the tile's", () => {
    expect(projection.edge('NE')).toEqual([projection.anchor('N'), projection.anchor('E')]);
    expect(projection.edge('NW')).toEqual([projection.anchor('W'), projection.anchor('N')]);
    expect(projection.faces.map((d) => projection.edgeMidpoint(d))).toEqual([
      [32, -16],
      [32, 16],
      [-32, 16],
      [-32, -16],
    ]);
  });

  it('measures how far in a tile a point is, and sees offsets from above', () => {
    expect(projection.inset(64, 32)).toBe(0);
    expect(projection.inset(128, 32)).toBe(1);
    expect(projection.inset(64, 16)).toBe(0.5);
    expect(projection.fromAbove(3, 4)).toEqual([3, 8]);
  });

  it("keeps the camera on the map's diamond, pulling a point outside it in toward the middle", () => {
    const [mw, mh] = projection.mapSize(4, 4);
    expect(projection.keepOn(4, 4, [mw / 2, mh / 2])).toEqual([mw / 2, mh / 2]);
    expect(projection.keepOn(4, 4, [mw / 2, 10])).toEqual([mw / 2, 10]);
    // The box's corner is off the diamond; the point comes in along the line to the middle, to its edge.
    expect(projection.keepOn(4, 4, [0, 0])).toEqual([mw / 4, mh / 4]);
    expect(projection.keepOn(4, 4, [mw * 2, mh / 2])).toEqual([mw, mh / 2]);
  });

  it('says how far down the rows a point is, which runs across the screen', () => {
    const h = 6;
    expect(projection.rowFraction(h, ...projection.centre(2, 0, h))).toBeCloseTo(0.5 / h);
    expect(projection.rowFraction(h, ...projection.centre(0, 5, h))).toBeCloseTo(5.5 / h);
    expect(projection.rowFraction(h, ...projection.centre(9, 5, h))).toBeCloseTo(5.5 / h);
  });

  it("lays a block of tiles out as the map's diamonds, the middle one in the middle", () => {
    expect(projection.block(1, 1)).toEqual([128, 64]);
    // The block's first tile (its north-west corner on the grid) is at the top, as the map's first tile is.
    expect(projection.block(0, 0)).toEqual([128, 0]);
    expect(projection.block(2, 0)).toEqual([256, 64]);
    expect(projection.block(0, 2)).toEqual([0, 64]);
    expect(projection.block(2, 2)).toEqual([128, 128]);
    expect(projection.blockSize()).toEqual([384, 192]);
    // As the map lays tiles: a step east of the middle is the same as on the map.
    const [mx, my] = projection.block(1, 1);
    const [ex, ey] = projection.block(2, 1);
    const [ox, oy] = projection.origin(5, 5, 9);
    const [px, py] = projection.origin(6, 5, 9);
    expect([ex - mx, ey - my]).toEqual([px - ox, py - oy]);
  });
});
