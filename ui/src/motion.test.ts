import { describe, expect, it } from 'vitest';
import { BLINK_MS, blink, moves, slide } from './motion';
import type { Unit } from './tileset';

const unit = (x: number, y: number, key = 'colonist'): Unit => ({
  x,
  y,
  keys: [key],
  rgb: 1,
  chip: 'F',
  fg: 0,
  stack: 1,
  fade: false,
});

describe('moves', () => {
  it('finds a unit that went to a neighbouring tile', () => {
    expect(moves([unit(3, 2)], [unit(4, 2)])).toEqual([{ from: [3, 2], to: [4, 2] }]);
    // Odd rows sit half a tile to the right: (3,2) and (3,3) are neighbours.
    expect(moves([unit(3, 2)], [unit(3, 3)])).toEqual([{ from: [3, 2], to: [3, 3] }]);
  });

  it('ignores units that stayed, appeared or jumped far', () => {
    expect(moves([unit(3, 2)], [unit(3, 2)])).toEqual([]);
    expect(moves([], [unit(4, 2)])).toEqual([]);
    expect(moves([unit(3, 2)], [unit(7, 2)])).toEqual([]);
  });

  it('follows a unit whose chip changed with the step', () => {
    expect(moves([unit(3, 2)], [{ ...unit(4, 2), chip: 'Done' }])).toEqual([{ from: [3, 2], to: [4, 2] }]);
  });

  it('does not take a different unit for the mover', () => {
    expect(moves([unit(3, 2)], [unit(4, 2, 'soldier')])).toEqual([]);
  });
});

describe('slide', () => {
  it('starts a tile back and ends on the tile', () => {
    expect(slide({ from: [3, 2], to: [4, 2] }, 0)).toEqual([-128, 0]);
    expect(slide({ from: [3, 2], to: [4, 2] }, 1).map(Math.abs)).toEqual([0, 0]);
  });
});

describe('blink', () => {
  it('shows the unit most of the cycle and dims it for the rest', () => {
    expect(blink(0)).toBe(1);
    expect(blink(BLINK_MS * 0.9)).toBeLessThan(1);
    expect(blink(BLINK_MS)).toBe(1);
  });
});
