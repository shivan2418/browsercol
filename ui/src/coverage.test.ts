import { afterEach, describe, expect, it } from 'vite-plus/test';
import { coverageHit, coverageHitMethod } from './coverage';

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

  it('counts a panel WebGUI also shows against its WebGUI method, with no prefix', () => {
    const hits: string[] = [];
    (globalThis as { window?: unknown }).window = { fcCoverageHit: (n: string) => hits.push(n) };
    coverageHitMethod('showColopediaPanel');
    expect(hits).toEqual(['showColopediaPanel']);
  });
});
