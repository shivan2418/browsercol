import { describe, expect, it } from 'vite-plus/test';
import { isometric, mapGrid, projection, staggered, type Direction } from './projection';

// A 2x4 map of 128x64 diamonds in staggered rows, odd rows half a tile to
// the right. Tile (0,0)'s diamond spans x 0..128 and y 0..64 with its centre
// at (64,32); tile (0,1)'s centre is at (128,64), (1,1)'s at (256,64).
describe('tileAt', () => {
  const at = (px: number, py: number) => projection.tileAt(2, 4, px, py);

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

describe('the staggered grid', () => {
  it('is the grid and the projection the map draws with', () => {
    expect(mapGrid).toBe(staggered);
    expect(projection).toBe(isometric);
  });

  it("finds a tile's neighbours with FreeCol's odd and even row deltas", () => {
    expect(mapGrid.neighbour(3, 2, 'NE')).toEqual([3, 1]);
    expect(mapGrid.neighbour(3, 2, 'SW')).toEqual([2, 3]);
    expect(mapGrid.neighbour(3, 3, 'NE')).toEqual([4, 2]);
    expect(mapGrid.neighbour(3, 3, 'SW')).toEqual([3, 4]);
    expect(mapGrid.neighbour(3, 2, 'N')).toEqual([3, 0]);
    expect(mapGrid.neighbour(3, 2, 'E')).toEqual([4, 2]);
    expect(mapGrid.neighbour(3, 3, 'S')).toEqual([3, 5]);
    expect(mapGrid.neighbour(3, 3, 'W')).toEqual([2, 3]);
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
    expect(mapGrid.edges).toEqual(['NE', 'SE', 'SW', 'NW']);
    expect(mapGrid.corners).toEqual(['N', 'E', 'S', 'W']);
    expect([...mapGrid.edges, ...mapGrid.corners].sort()).toEqual([...mapGrid.directions].sort());
    expect(mapGrid.edges.map((d) => mapGrid.edgeIndex(d))).toEqual([0, 1, 2, 3]);
    expect(mapGrid.edgeIndex('N')).toBe(-1);
    expect(mapGrid.isEdge('SW')).toBe(true);
    expect(mapGrid.isEdge('W')).toBe(false);
  });

  it('numbers the tiles along its axes, a step along an edge changing one of them by one', () => {
    for (const y of [4, 5]) {
      const [u, v] = mapGrid.lattice(6, y);
      const at = (d: Direction) => mapGrid.lattice(...mapGrid.neighbour(6, y, d));
      expect(at('SE')).toEqual([u + 1, v]);
      expect(at('NW')).toEqual([u - 1, v]);
      expect(at('NE')).toEqual([u, v - 1]);
      expect(at('SW')).toEqual([u, v + 1]);
    }
  });

  it('draws the tiles row by row, each over those before it', () => {
    const seen: string[] = [];
    mapGrid.eachTile(2, 2, (x, y) => seen.push(`${x},${y}`));
    expect(seen).toEqual(['0,0', '1,0', '0,1', '1,1']);
  });
});

describe('the isometric projection', () => {
  it("puts odd rows half a tile right and each row half a tile down, from the tile's box", () => {
    expect(projection.origin(2, 0)).toEqual([256, 0]);
    expect(projection.origin(2, 3)).toEqual([320, 96]);
    expect(projection.centre(2, 3)).toEqual([384, 128]);
    expect(projection.mapSize(4, 6)).toEqual([576, 224]);
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
    expect(mapGrid.edges.map((d) => projection.edgeMidpoint(d))).toEqual([
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

  it("lays a block of tiles out as the map's diamonds, the middle one in the middle", () => {
    expect(projection.block(0, 0)).toEqual([128, 0]);
    expect(projection.block(1, 1)).toEqual([128, 64]);
    expect(projection.block(2, 0)).toEqual([0, 64]);
    expect(projection.block(0, 2)).toEqual([256, 64]);
    expect(projection.block(2, 2)).toEqual([128, 128]);
    expect(projection.blockSize()).toEqual([384, 192]);
  });
});
