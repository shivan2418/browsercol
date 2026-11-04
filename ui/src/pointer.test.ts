// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { HOLD_MS, blockBrowserMenu, pointerInput, rightClickInput, wheelZoom } from './pointer';
import { initialView } from './view';

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

describe('pointerInput Go To', () => {
  const setup = () => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas></canvas>';
    document.body.append(host);
    const preview = vi.fn();
    const go = vi.fn();
    const dispatch = vi.fn();
    const dragged = pointerInput(host, {
      view: () => initialView,
      dispatch,
      tileAt: (px) => [Math.floor(px / 10), 0],
      goto: { preview, go },
    });
    const press = (x: number, button = 0) =>
      host.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: 0, button }));
    const release = () => dispatchEvent(new MouseEvent('pointerup'));
    return { preview, go, dispatch, dragged, press, release };
  };

  it('does not send the unit on a quick click', () => {
    vi.useFakeTimers();
    const { preview, go, press, release } = setup();
    press(25);
    vi.advanceTimersByTime(HOLD_MS - 50);
    release();
    vi.advanceTimersByTime(HOLD_MS);
    expect(preview).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows the path of a held press, and sends the unit on release', () => {
    vi.useFakeTimers();
    const { preview, go, dragged, press, release } = setup();
    press(25);
    vi.advanceTimersByTime(HOLD_MS);
    expect(preview).toHaveBeenLastCalledWith([2, 0]);
    dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 0 }));
    expect(preview).toHaveBeenLastCalledWith([4, 0]);
    release();
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(go).toHaveBeenCalledWith([4, 0]);
    expect(dragged()).toBe(true);
    vi.useRealTimers();
  });

  it('starts the Go To even when the pointer moves before the hold is up, on the tile it moved to', () => {
    vi.useFakeTimers();
    const { preview, go, press, release } = setup();
    press(25);
    dispatchEvent(new MouseEvent('pointermove', { clientX: 28, clientY: 2 }));
    dispatchEvent(new MouseEvent('pointermove', { clientX: 36, clientY: 0 }));
    vi.advanceTimersByTime(HOLD_MS);
    expect(preview).toHaveBeenLastCalledWith([3, 0]);
    release();
    expect(go).toHaveBeenCalledWith([3, 0]);
    vi.useRealTimers();
  });

  it('pans only with the middle button, never the left', () => {
    vi.useFakeTimers();
    const { preview, go, dispatch, press, release } = setup();
    press(25);
    dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 0 }));
    release();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ k: 'pan' }));
    vi.advanceTimersByTime(HOLD_MS);
    expect(preview).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('pans with the middle button and does not start a Go To', () => {
    vi.useFakeTimers();
    const { preview, go, dispatch, press, release } = setup();
    press(25, 1);
    dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 0 }));
    vi.advanceTimersByTime(HOLD_MS);
    release();
    expect(dispatch).toHaveBeenCalledWith({ k: 'pan', dx: 35, dy: 0 });
    expect(preview).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
