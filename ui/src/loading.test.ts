// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { FADE_MS, fraction, loading, pending } from './loading';

describe('fraction', () => {
  it('weighs each part by its share', () => {
    expect(fraction(['data', 'engine'], {})).toBe(0);
    expect(fraction(['data', 'engine'], { data: 1 })).toBeCloseTo(1 / 7);
    expect(fraction(['data', 'engine'], { data: 1, engine: 0.5 })).toBeCloseTo(4 / 7);
    expect(fraction(['data', 'engine'], { data: 1, engine: 1 })).toBe(1);
  });
  it('counts a part the screen is not waiting for as nothing', () => {
    expect(fraction(['data'], { data: 1, engine: 0.2 })).toBe(1);
  });
});

describe('pending', () => {
  it('names the first part not done, in the order of the page', () => {
    expect(pending(['data', 'engine', 'map'], { data: 1 })).toBe('Loading the game engine');
    expect(pending(['data'], { data: 1 })).toBeNull();
  });
});

describe('loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div id="loading" data-state="loading"><div data-loading-bar></div><p data-loading-label></p></div>';
  });
  afterEach(() => vi.useRealTimers());
  const root = () => document.getElementById('loading')!;
  const loaded = () => root().querySelector<HTMLElement>('[data-loading-bar]')!.style.getPropertyValue('--loaded');
  const label = () => root().querySelector('[data-loading-label]')!.textContent;

  it('fills the bar as bytes come, and one step for a part of unknown size', () => {
    const screen = loading();
    screen.begin(['data', 'engine']);
    screen.finish('data');
    screen.progress('engine', 50, 100);
    expect(loaded()).toBe('57%');
    screen.progress('engine', 500, null);
    expect(loaded()).toBe('14%');
  });
  it('fades out when the last part is done, then goes', () => {
    const screen = loading();
    screen.begin(['data', 'map']);
    screen.finish('data');
    expect(root().dataset.state).toBe('loading');
    screen.finish('map');
    expect(root().dataset.state).toBe('leaving');
    vi.advanceTimersByTime(FADE_MS);
    expect(root().dataset.state).toBe('done');
  });
  it('comes back for a later wait, counting what has loaded already', () => {
    const screen = loading();
    screen.begin(['data', 'start']);
    screen.finish('data');
    screen.finish('start');
    vi.advanceTimersByTime(FADE_MS);
    screen.begin(['data', 'engine']);
    expect(root().dataset.state).toBe('loading');
    expect(label()).toBe('Loading the game engine');
  });
  it('stays up with the error, and says nothing once it has gone', () => {
    const screen = loading();
    screen.begin(['data']);
    screen.fail('The game could not start');
    screen.finish('data');
    expect(root().dataset.state).toBe('failed');
    expect(label()).toBe('The game could not start');

    document.body.innerHTML = '<div id="loading" data-state="done"></div>';
    loading().fail('late');
    expect(root().dataset.state).toBe('done');
  });
  it('does nothing on a page without the screen', () => {
    document.body.innerHTML = '';
    const screen = loading();
    screen.begin(['data']);
    screen.finish('data');
    screen.fail('x');
  });
});
