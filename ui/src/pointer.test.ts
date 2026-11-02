// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { blockBrowserMenu, rightClickInput, wheelZoom } from './pointer';

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

describe('rightClickInput', () => {
  const setup = (tileAt: (px: number, py: number) => [number, number] | null) => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas></canvas>';
    document.body.append(host);
    host.querySelector('canvas')!.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    const opened: unknown[] = [];
    rightClickInput(host, tileAt, (tile, x, y) => opened.push([tile, x, y]));
    const click = (x: number, y: number) =>
      host
        .querySelector('canvas')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }),
        );
    return { host, opened, click };
  };

  it("opens the menu of the tile under the pointer, at the pointer's place on the page", () => {
    const seen: unknown[] = [];
    const { host, opened, click } = setup((px, py) => (seen.push([px, py]), [3, 4]));
    click(130, 90);
    expect(seen).toEqual([[30, 40]]);
    expect(opened).toEqual([[[3, 4], 130, 90]]);
    host.remove();
  });

  it('does nothing off the map', () => {
    const { host, opened, click } = setup(() => null);
    click(130, 90);
    expect(opened).toEqual([]);
    host.remove();
  });
});
