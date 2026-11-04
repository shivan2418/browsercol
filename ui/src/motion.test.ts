import { describe, expect, it } from 'vite-plus/test';
import { BLINK_MS, blink, path, slide, type Step } from './motion';

const step = (from: [number, number], to: [number, number], unit = 'unit:1'): Step => ({
  unit,
  from,
  to,
  keys: ['colonist'],
  rgb: 1,
  chip: 'F',
  fg: 0,
});

describe('path', () => {
  it("joins one unit's steps into the tiles it goes through", () => {
    expect(path([step([3, 2], [4, 2]), step([4, 2], [5, 2])])?.tiles).toEqual([
      [3, 2],
      [4, 2],
      [5, 2],
    ]);
  });

  it('slides nothing when there are no steps, several units moved, or the steps do not follow on', () => {
    expect(path([])).toBeNull();
    expect(path([step([3, 2], [4, 2]), step([7, 7], [8, 7], 'unit:2')])).toBeNull();
    expect(path([step([3, 2], [4, 2]), step([6, 2], [7, 2])])).toBeNull();
  });
});

describe('slide', () => {
  it('starts a tile back and ends on the tile', () => {
    expect(
      slide(
        [
          [3, 2],
          [4, 2],
        ],
        0,
      ),
    ).toEqual([-128, 0]);
    expect(
      slide(
        [
          [3, 2],
          [4, 2],
        ],
        1,
      ).map(Math.abs),
    ).toEqual([0, 0]);
  });

  it('goes a step in each share of the time along a longer path', () => {
    const tiles: [number, number][] = [
      [3, 2],
      [4, 2],
      [5, 2],
    ];
    expect(slide(tiles, 0)).toEqual([-256, 0]);
    expect(slide(tiles, 0.5)).toEqual([-128, 0]);
    expect(slide(tiles, 0.75)).toEqual([-64, 0]);
    expect(slide(tiles, 1).map(Math.abs)).toEqual([0, 0]);
  });
});

describe('blink', () => {
  it('shows the unit most of the cycle and dims it for the rest', () => {
    expect(blink(0)).toBe(1);
    expect(blink(BLINK_MS * 0.9)).toBeLessThan(1);
    expect(blink(BLINK_MS)).toBe(1);
  });
});
