import { describe, expect, it } from 'vite-plus/test';
import { createGestures, DOUBLE_TAP_MS, LONG_PRESS_MS, TOUCH_SLOP, type GestureEvent } from './touch-gestures';

const setup = (sameSpot?: (a: [number, number], b: [number, number]) => boolean) => {
  const events: GestureEvent[] = [];
  const g = createGestures((e) => events.push(e), sameSpot);
  return { g, events };
};

describe('createGestures', () => {
  it('makes a touch that stays under the slop a tap', () => {
    const { g, events } = setup();
    g.down(1, 100, 100, 0);
    g.move(1, 100 + TOUCH_SLOP - 1, 100, 20);
    g.up(1, 50);
    expect(events).toEqual([{ k: 'tap', x: 100 + TOUCH_SLOP - 1, y: 100, detail: 1 }]);
    expect(g.busy()).toBe(false);
  });

  it('makes two quick taps on one spot a double-tap, and a third a single one again', () => {
    const { g, events } = setup();
    const tap = (t: number, x = 50) => {
      g.down(1, x, 50, t);
      g.up(1, t + 40);
    };
    tap(0);
    tap(200);
    tap(400);
    expect(events.map((e) => e.k === 'tap' && e.detail)).toEqual([1, 2, 1]);
  });

  it('keeps a slow or distant second tap single', () => {
    const { g, events } = setup();
    g.down(1, 50, 50, 0);
    g.up(1, 40);
    g.down(1, 50, 50, DOUBLE_TAP_MS + 100);
    g.up(1, DOUBLE_TAP_MS + 140);
    g.down(1, 300, 50, DOUBLE_TAP_MS + 200);
    g.up(1, DOUBLE_TAP_MS + 240);
    expect(events.map((e) => e.k === 'tap' && e.detail)).toEqual([1, 1, 1]);
  });

  it('asks the caller whether two taps are on the same spot', () => {
    const { g, events } = setup(() => true);
    g.down(1, 0, 0, 0);
    g.up(1, 10);
    g.down(1, 90, 90, 100);
    g.up(1, 110);
    expect(events.map((e) => e.k === 'tap' && e.detail)).toEqual([1, 2]);
  });

  it('pans past the slop, paying back the slop at once', () => {
    const { g, events } = setup();
    g.down(1, 0, 0, 0);
    g.move(1, 5, 0, 10);
    expect(events).toEqual([]);
    g.move(1, 20, 0, 20);
    g.move(1, 30, 5, 30);
    expect(events).toEqual([
      { k: 'pan', dx: 20, dy: 0 },
      { k: 'pan', dx: 10, dy: 5 },
    ]);
    g.up(1, 600);
    expect(events.some((e) => e.k === 'tap')).toBe(false);
  });

  it('glides after a flick, slowing down to a stop', () => {
    const { g, events } = setup();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 5; i++) g.move(1, i * 20, 0, i * 10);
    g.up(1, 55);
    expect(g.busy()).toBe(true);
    events.length = 0;
    let first = 0;
    let last = 0;
    for (let t = 70; g.busy() && t < 20000; t += 16) {
      const n = events.length;
      g.tick(t);
      const e = events[n];
      if (e?.k === 'pan') {
        first ||= e.dx;
        last = e.dx;
      }
    }
    expect(g.busy()).toBe(false);
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(first);
  });

  it('does not glide when the finger rested before lifting', () => {
    const { g } = setup();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 5; i++) g.move(1, i * 20, 0, i * 10);
    g.up(1, 400);
    expect(g.busy()).toBe(false);
  });

  it('stops a glide at the next touch', () => {
    const { g } = setup();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 5; i++) g.move(1, i * 20, 0, i * 10);
    g.up(1, 55);
    g.down(1, 0, 0, 60);
    g.tick(80);
    g.up(1, 90);
    expect(g.busy()).toBe(false);
  });

  it('opens a long press once, and then no tap', () => {
    const { g, events } = setup();
    g.down(1, 7, 8, 0);
    g.tick(LONG_PRESS_MS - 1);
    expect(events).toEqual([]);
    g.tick(LONG_PRESS_MS);
    g.tick(LONG_PRESS_MS + 100);
    g.up(1, LONG_PRESS_MS + 200);
    expect(events).toEqual([{ k: 'longPress', x: 7, y: 8 }]);
  });

  it('makes a lift after the long-press time a long press when no frame ticked', () => {
    const { g, events } = setup();
    g.down(1, 7, 8, 0);
    g.up(1, LONG_PRESS_MS + 300);
    expect(events).toEqual([{ k: 'longPress', x: 7, y: 8 }]);
  });

  it('does not long-press a finger that moved on', () => {
    const { g, events } = setup();
    g.down(1, 0, 0, 0);
    g.move(1, 30, 0, 100);
    g.tick(LONG_PRESS_MS + 10);
    expect(events.some((e) => e.k === 'longPress')).toBe(false);
  });

  it('pinches about the midpoint, ends on a lift, and ignores the finger left', () => {
    const { g, events } = setup();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 5);
    g.move(2, 300, 100, 10);
    g.up(1, 20);
    g.move(2, 0, 0, 30);
    g.up(2, 40);
    expect(events).toEqual([
      { k: 'pinchStart' },
      { k: 'pan', dx: 50, dy: 0 },
      { k: 'pinch', ratio: 2, x: 200, y: 100 },
      { k: 'pinchEnd' },
    ]);
    expect(g.busy()).toBe(false);
  });
});
