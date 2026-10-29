import { describe, expect, it } from 'vite-plus/test';
import { tileAt } from './map';

// FreeCol's map is a diamond grid stored as staggered rows: odd rows sit
// half a tile to the right. The crude map draws each tile as a 10x5 brick.
const layout = { size: 10, w: 4, h: 6 };

describe('tileAt', () => {
  it('finds the tile under the pointer on even and odd rows', () => {
    expect(tileAt(layout, 1, 1)).toEqual([0, 0]);
    expect(tileAt(layout, 19, 4)).toEqual([1, 0]);
    // Row 1 starts 5px in: x=7 is its first tile, x=4 is outside it.
    expect(tileAt(layout, 7, 6)).toEqual([0, 1]);
    expect(tileAt(layout, 16, 9)).toEqual([1, 1]);
    expect(tileAt(layout, 39, 29)).toEqual([3, 5]);
  });

  it('is null off the map', () => {
    expect(tileAt(layout, 4, 6)).toBeNull();
    expect(tileAt(layout, 40, 1)).toBeNull();
    expect(tileAt(layout, 1, 30)).toBeNull();
    expect(tileAt(layout, -1, 1)).toBeNull();
  });
});
