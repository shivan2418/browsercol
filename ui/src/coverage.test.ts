import { afterEach, describe, expect, it } from 'vite-plus/test';
import { coverageHit } from './coverage';

describe('coverageHit', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('does nothing without the scripts hook, as for a player', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => coverageHit('showAboutPanel')).not.toThrow();
  });

  it('names the Browser UI own panels with a ui: prefix for the hook', () => {
    const hits: string[] = [];
    (globalThis as { window?: unknown }).window = { fcCoverageHit: (n: string) => hits.push(n) };
    coverageHit('showAboutPanel');
    expect(hits).toEqual(['ui:showAboutPanel']);
  });
});
