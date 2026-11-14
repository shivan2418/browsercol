// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { HOLD_MS, blockBrowserMenu, blockImageDrag, createGotoPicker, pointerInput, rightClickInput, wheelZoom } from './pointer';
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
    const active = { unit: 'unit:1' as string | null };
    const dragged = pointerInput(host, {
      view: () => ({ ...initialView, active: active.unit ? { unit: active.unit, tile: null } : null }),
      dispatch,
      tileAt: (px) => [Math.floor(px / 10), 0],
      goto: { preview, go },
    });
    const press = (x: number, button = 0) =>
      host.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: 0, button }));
    const release = () => dispatchEvent(new MouseEvent('pointerup'));
    return { preview, go, dispatch, dragged, press, release, active };
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
    expect(preview).toHaveBeenLastCalledWith([2, 0], 'unit:1');
    dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 0 }));
    expect(preview).toHaveBeenLastCalledWith([4, 0], 'unit:1');
    release();
    expect(preview).toHaveBeenLastCalledWith(null, 'unit:1');
    expect(go).toHaveBeenCalledWith([4, 0], 'unit:1');
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
    expect(preview).toHaveBeenLastCalledWith([3, 0], 'unit:1');
    release();
    expect(go).toHaveBeenCalledWith([3, 0], 'unit:1');
    vi.useRealTimers();
  });

  it('sends nothing when the active unit changes during the hold, and clears the path', () => {
    vi.useFakeTimers();
    const { preview, go, dragged, press, release, active } = setup();
    press(25);
    vi.advanceTimersByTime(HOLD_MS);
    expect(preview).toHaveBeenLastCalledWith([2, 0], 'unit:1');
    active.unit = 'unit:2';
    dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 0 }));
    expect(preview).toHaveBeenLastCalledWith(null, 'unit:1');
    expect(preview).not.toHaveBeenCalledWith([4, 0], expect.anything());
    release();
    expect(go).not.toHaveBeenCalled();
    expect(dragged()).toBe(true);
    vi.useRealTimers();
  });

  it('sends nothing when the unit changes before the hold is up, or the release comes after the change', () => {
    vi.useFakeTimers();
    const { preview, go, press, release, active } = setup();
    press(25);
    active.unit = 'unit:2';
    vi.advanceTimersByTime(HOLD_MS);
    release();
    expect(preview).not.toHaveBeenCalledWith(expect.anything(), 'unit:2');
    expect(go).not.toHaveBeenCalled();
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

describe('blockImageDrag', () => {
  it("keeps the browser's drag ghost off a picture, but not off a draggable chip", () => {
    const page = document.createElement('div');
    page.innerHTML = '<img class="lone"><div draggable="true"><img class="chip"></div>';
    document.body.append(page);
    blockImageDrag(page);
    const drag = (target: Element) => {
      const e = new Event('dragstart', { bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(drag(page.querySelector('.lone')!)).toBe(true);
    expect(drag(page.querySelector('.chip')!)).toBe(false);
    page.remove();
  });
});

describe('createGotoPicker', () => {
  const setup = () => {
    const preview = vi.fn();
    const go = vi.fn();
    const changed = vi.fn();
    const active = { unit: 'unit:1' as string | null };
    const picker = createGotoPicker({ preview, go }, () => active.unit, changed);
    return { picker, preview, go, changed, active };
  };

  it('previews a tapped tile, moves the preview to another, and sends the unit on a second tap of the same tile', () => {
    const { picker, preview, go } = setup();
    picker.toggle();
    expect(picker.choosing()).toBe(true);
    picker.tap([3, 4]);
    expect(preview).toHaveBeenLastCalledWith([3, 4], 'unit:1');
    picker.tap([5, 4]);
    expect(preview).toHaveBeenLastCalledWith([5, 4], 'unit:1');
    expect(go).not.toHaveBeenCalled();
    picker.tap([5, 4]);
    expect(go).toHaveBeenCalledWith([5, 4], 'unit:1');
    expect(preview).toHaveBeenLastCalledWith(null, 'unit:1');
    expect(picker.choosing()).toBe(false);
  });

  it('is cancelled by the button again, by Escape, and by another active unit', () => {
    const { picker, preview, go, active } = setup();
    picker.toggle();
    picker.tap([1, 1]);
    picker.toggle();
    expect(picker.choosing()).toBe(false);
    expect(preview).toHaveBeenLastCalledWith(null, 'unit:1');

    picker.toggle();
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(picker.choosing()).toBe(false);

    picker.toggle();
    picker.tap([1, 1]);
    active.unit = 'unit:2';
    expect(picker.choosing()).toBe(false);
    picker.tap([1, 1]);
    expect(go).not.toHaveBeenCalled();
  });

  it('does not start without an active unit', () => {
    const { picker, active } = setup();
    active.unit = null;
    picker.toggle();
    expect(picker.choosing()).toBe(false);
  });
});

describe('pointerInput touch', () => {
  const setup = () => {
    const host = document.createElement('div');
    host.innerHTML = '<canvas></canvas>';
    document.body.append(host);
    const dispatch = vi.fn();
    const tap = vi.fn();
    const longPress = vi.fn();
    pointerInput(host, {
      view: () => initialView,
      dispatch,
      tileAt: (px) => [Math.floor(px / 10), 0],
      tap,
      longPress,
      goto: { preview: vi.fn(), go: vi.fn() },
    });
    const send = (type: string, target: EventTarget, pointerType: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, clientY: 0, bubbles: true });
      Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
      target.dispatchEvent(e);
    };
    return { host, dispatch, tap, longPress, send };
  };

  it('taps like a click, double-taps with detail 2, and leaves the mouse alone', () => {
    const { host, dispatch, tap, send } = setup();
    send('pointerdown', host, 'touch', 25);
    send('pointerup', window, 'touch', 25);
    send('pointerdown', host, 'touch', 26);
    send('pointerup', window, 'touch', 26);
    expect(tap.mock.calls).toEqual([
      [[2, 0], 1],
      [[2, 0], 2],
    ]);
    expect(dispatch).toHaveBeenCalledWith({ k: 'tapped', at: [2, 0] });

    // A mouse press neither taps nor hovers through the touch path.
    tap.mockClear();
    send('pointerdown', host, 'mouse', 25);
    send('pointerup', window, 'mouse', 25);
    expect(tap).not.toHaveBeenCalled();
  });

  it('pans on a drag and sets no hover for a finger', () => {
    const { host, dispatch, tap, send } = setup();
    send('pointermove', host, 'touch', 5);
    expect(dispatch.mock.calls.some(([e]) => e.k === 'hover')).toBe(false);
    send('pointerdown', host, 'touch', 100);
    send('pointermove', window, 'touch', 130);
    send('pointerup', window, 'touch', 130);
    expect(dispatch).toHaveBeenCalledWith({ k: 'pan', dx: 30, dy: 0 });
    expect(tap).not.toHaveBeenCalled();
  });

  it('drops the click the browser makes of a tap', () => {
    const { host, send } = setup();
    const clicked = vi.fn();
    host.addEventListener('click', clicked);
    send('pointerdown', host, 'touch', 25);
    send('pointerup', window, 'touch', 25);
    host.querySelector('canvas')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).not.toHaveBeenCalled();
  });
});
