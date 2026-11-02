// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { blockBrowserMenu, wheelZoom } from './pointer';

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

describe('blockBrowserMenu', () => {
  const rightClick = (target: Element) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("keeps the browser's menu off the map and panels, but not off text fields", () => {
    const page = document.createElement('div');
    page.innerHTML = '<canvas></canvas><div class="panel"><span>Jamestown</span><input><textarea></textarea></div>';
    document.body.append(page);
    blockBrowserMenu(page);
    expect(rightClick(page.querySelector('canvas')!)).toBe(true);
    expect(rightClick(page.querySelector('span')!)).toBe(true);
    expect(rightClick(page.querySelector('input')!)).toBe(false);
    expect(rightClick(page.querySelector('textarea')!)).toBe(false);
    page.remove();
  });
});
