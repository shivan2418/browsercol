import { describe, expect, it } from 'vite-plus/test';
import { stopWork } from './route-work';

const S = 'sugar';
const R = 'rum';
const stop = (...cargo: string[]) => ({ cargo });

describe('stopWork', () => {
  it('unloads what arrives and is not listed, and loads what is listed and did not arrive', () => {
    const route = [stop(S), stop(R), stop()];
    expect(stopWork(route, 1)).toEqual({ unload: [[S, 1]], load: [[R, 1]], keep: [] });
    expect(stopWork(route, 2)).toEqual({ unload: [[R, 1]], load: [], keep: [] });
  });

  it('takes the first stop against the last, as the route loops', () => {
    const route = [stop(R), stop(S), stop(S, S)];
    expect(stopWork(route, 0)).toEqual({ unload: [[S, 2]], load: [[R, 1]], keep: [] });
  });

  it('counts holds per goods type: two holds arriving and one leaving unloads one', () => {
    const route = [stop(S, S, R), stop(S)];
    expect(stopWork(route, 1)).toEqual({
      unload: [
        [S, 1],
        [R, 1],
      ],
      load: [],
      keep: [[S, 1]],
    });
    expect(stopWork(route, 0)).toEqual({
      unload: [],
      load: [
        [S, 1],
        [R, 1],
      ],
      keep: [[S, 1]],
    });
  });

  it('keeps what is on both lists aboard', () => {
    const route = [stop(S, R), stop(S, R)];
    expect(stopWork(route, 1)).toEqual({
      unload: [],
      load: [],
      keep: [
        [S, 1],
        [R, 1],
      ],
    });
  });

  it('has a lone stop arrive with its own list', () => {
    expect(stopWork([stop(S)], 0)).toEqual({ unload: [], load: [], keep: [[S, 1]] });
  });
});
