import { describe, expect, it } from 'vite-plus/test';
import {
  BLINK_MS,
  OPTION_MS,
  blink,
  length,
  path,
  rewind,
  runs,
  slide,
  stepMs,
  carryOn,
  track,
  type Step,
} from './motion';
import { tileOrigin } from './view';

const step = (from: [number, number], to: [number, number], unit = 'unit:1', speed: number | null = null): Step => ({
  unit,
  speed,
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

describe("another player's unit", () => {
  it('slides along its last steps, the earlier moves of others jumping', () => {
    const steps = [
      step([1, 1], [2, 1], 'unit:2', 3),
      step([7, 7], [8, 7], 'unit:3', 3),
      step([8, 7], [9, 7], 'unit:3', 3),
    ];
    expect(path(steps)?.tiles).toEqual([
      [7, 7],
      [8, 7],
      [9, 7],
    ]);
  });

  it("takes the option's speed, the player's own taking their own", () => {
    expect(OPTION_MS).toEqual([0, 528, 264, 132]);
    expect(stepMs(step([1, 1], [2, 1], 'unit:2', 1), 300)).toBe(528);
    expect(stepMs(step([1, 1], [2, 1], 'unit:2', 0), 300)).toBe(0);
    expect(stepMs(step([1, 1], [2, 1]), 450)).toBe(450);
  });
});

describe('slide', () => {
  const row = (...xs: number[]): [number, number][] => xs.map((x) => [x, 2]);

  it('starts a tile back and ends on the tile', () => {
    const t = track(row(3, 4), 300);
    expect(slide(t, 0)).toEqual([-128, 0]);
    expect(slide(t, 300).map(Math.abs)).toEqual([0, 0]);
    expect(length(t)).toBe(300);
  });

  it('eases out onto the tile: quick off the mark, slow as it lands', () => {
    const t = track(row(3, 4), 300);
    expect(slide(t, 150)).toEqual([-32, 0]);
    const moved = (a: number, b: number) => slide(t, b)[0] - slide(t, a)[0];
    expect(moved(0, 30)).toBeGreaterThan(moved(270, 300) * 5);
  });

  it('goes evenly through the tiles of a longer path, easing only onto the last', () => {
    const t = track(row(3, 4, 5), 300);
    expect(slide(t, 0)).toEqual([-256, 0]);
    expect(slide(t, 150)).toEqual([-192, 0]);
    expect(slide(t, 300)).toEqual([-128, 0]);
    expect(slide(t, 450)).toEqual([-32, 0]);
    expect(slide(t, 600).map(Math.abs)).toEqual([0, 0]);
  });

  it('takes half the time for a diagonal step, as Swing moves as many pixels a frame across a tile as down it', () => {
    // (3, 2) to (3, 3) is south-east, half a tile across and half down; (3, 2) to (3, 0) is north, a whole tile up.
    expect(
      length(
        track(
          [
            [3, 2],
            [3, 3],
          ],
          300,
        ),
      ),
    ).toBe(150);
    expect(
      length(
        track(
          [
            [3, 2],
            [3, 0],
          ],
          300,
        ),
      ),
    ).toBe(300);
    expect(length(track(row(3, 4), 300))).toBe(300);
  });

  it('is offset from where the actors are drawn: a slide that sets off before the unit is drawn on its new tile', () => {
    const t = track(row(3, 4), 300);
    expect(slide(t, 0, tileOrigin(3, 2)).map(Math.abs)).toEqual([0, 0]);
    expect(slide(t, 300, tileOrigin(3, 2))).toEqual([128, 0]);
  });

  it('carries a move made mid-slide on from where the unit is, without a jump', () => {
    const first = track(row(3, 4), 300);
    const carried = carryOn(first, 150, track(row(4, 5), 300));
    // A quarter of a tile short of 4 when the next move comes (the first eased out): 32 + 128 pixels short of 5.
    expect(slide(carried, 0)).toEqual([-160, 0]);
    expect(slide(carried, 0)[0] - slide(first, 150)[0]).toBe(-128);
    // The rest of the first leg goes at its even pace, 128 pixels in 300 ms.
    expect(slide(carried, 75)).toEqual([-128, 0]);
    expect(slide(carried, 375).map(Math.abs)).toEqual([0, 0]);
    expect(length(carried)).toBe(375);
  });

  it('starts the next move from the tile when the first slide is over', () => {
    const carried = carryOn(track(row(3, 4), 300), 400, track(row(4, 5), 300));
    expect(slide(carried, 0)).toEqual([-128, 0]);
    expect(length(carried)).toBe(300);
  });
});

describe('blink', () => {
  it('shows the unit most of the cycle and dims it for the rest', () => {
    expect(blink(0)).toBe(1);
    expect(blink(BLINK_MS * 0.9)).toBeLessThan(1);
    expect(blink(BLINK_MS)).toBe(1);
  });
});

describe('runs', () => {
  it("splits a batch into one run for each unit's consecutive steps, in the Engine's order", () => {
    const batch = [
      step([1, 1], [2, 1]),
      step([5, 5], [6, 5], 'unit:2'),
      step([6, 5], [7, 5], 'unit:2'),
      step([9, 9], [9, 8], 'unit:3'),
    ];
    expect(runs(batch).map((r) => r.map((s) => s.unit))).toEqual([['unit:1'], ['unit:2', 'unit:2'], ['unit:3']]);
  });

  it('starts a new run where a unit does not go on from where it was', () => {
    expect(runs([step([1, 1], [2, 1]), step([4, 4], [5, 4])]).length).toBe(2);
  });

  it('has no runs for no steps', () => {
    expect(runs([])).toEqual([]);
  });
});

describe('rewind', () => {
  const unit = (x: number, y: number) => ({
    x,
    y,
    keys: ['colonist'],
    rgb: 1,
    chip: 'F',
    fg: 0,
    stack: 1,
    fade: false,
  });

  it('puts the units of the runs still to play back on the tiles they set off from', () => {
    const now = [unit(2, 1), unit(7, 5)];
    const back = rewind(now, [[step([6, 5], [7, 5], 'unit:2')]]);
    expect(back.map((u) => [u.x, u.y])).toEqual([
      [2, 1],
      [6, 5],
    ]);
    expect(now.map((u) => [u.x, u.y])).toEqual([
      [2, 1],
      [7, 5],
    ]);
  });

  it('puts a unit that moved in two later runs back on where the first set off', () => {
    const back = rewind([unit(9, 9)], [[step([1, 1], [5, 5], 'unit:2')], [step([5, 5], [9, 9], 'unit:2')]]);
    expect(back.map((u) => [u.x, u.y])).toEqual([[1, 1]]);
  });

  it('adds the unit when the tile it came to shows another (it went into a colony)', () => {
    const colonist = { ...unit(7, 5), keys: ['wagon'] };
    const back = rewind([colonist], [[step([6, 5], [7, 5], 'unit:2')]]);
    expect(back.map((u) => [u.x, u.y])).toEqual([
      [7, 5],
      [6, 5],
    ]);
  });
});
