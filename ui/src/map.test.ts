import { describe, expect, it } from 'vite-plus/test';
import { tileAt } from './map';

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
