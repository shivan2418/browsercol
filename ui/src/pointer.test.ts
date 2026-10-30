import { describe, expect, it } from 'vite-plus/test';
import { wheelZoom } from './pointer';

const PIXEL = 0;
const LINE = 1;

describe('wheelZoom', () => {
  it("adds up a trackpad's small pixel deltas to a step", () => {
    const first = wheelZoom(0, { deltaY: -25, deltaMode: PIXEL });
    expect(first).toEqual({ steps: 0, rest: -25 });
    expect(wheelZoom(first.rest, { deltaY: -25, deltaMode: PIXEL })).toEqual({ steps: 1, rest: 0 });
  });

  it('zooms out for a wheel turned down', () => {
    expect(wheelZoom(0, { deltaY: 100, deltaMode: PIXEL })).toEqual({ steps: -1, rest: 0 });
  });

  it("counts a line delta (Firefox's mouse wheel) as a step, however small", () => {
    expect(wheelZoom(0, { deltaY: -3, deltaMode: LINE })).toEqual({ steps: 1, rest: 0 });
    expect(wheelZoom(0, { deltaY: 1, deltaMode: LINE })).toEqual({ steps: -1, rest: 0 });
  });
});
