// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { choose, fromTouch, HOLD_MS, offerHold, resetHold, SLOP, type Offer } from './long-press';

const touch = (id = 1, x = 100, y = 100) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
const fake = (kind: Offer['kind'], text?: string) => {
  const fire = vi.fn();
  return { fire, offer: { kind, text, fire } as Offer };
};
const pointer = (type: string, id: number, x: number, y: number) => {
  const e = new Event(type) as Event & Record<string, unknown>;
  Object.assign(e, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
  window.dispatchEvent(e);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetHold();
  vi.useRealTimers();
});

describe('long-press', () => {
  it('fires after the hold, at where the finger is', () => {
    const a = fake('menu');
    offerHold(touch(1, 30, 40), a.offer);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(a.fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a.fire).toHaveBeenCalledWith({ x: 30, y: 40 }, undefined);
  });

  it('ignores a mouse and a pen', () => {
    const a = fake('menu');
    offerHold({ ...touch(), pointerType: 'mouse' }, a.offer);
    offerHold({ ...touch(), pointerType: 'pen' }, a.offer);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(a.fire).not.toHaveBeenCalled();
  });

  it('is cancelled by a lift, a cancel, and a move past the slop', () => {
    for (const end of [
      () => pointer('pointerup', 1, 100, 100),
      () => pointer('pointercancel', 1, 100, 100),
      () => pointer('pointermove', 1, 100 + SLOP + 1, 100),
    ]) {
      const a = fake('menu');
      offerHold(touch(), a.offer);
      vi.advanceTimersByTime(HOLD_MS - 10);
      end();
      vi.advanceTimersByTime(HOLD_MS);
      expect(a.fire).not.toHaveBeenCalled();
    }
  });

  it('survives a move within the slop', () => {
    const a = fake('menu');
    offerHold(touch(), a.offer);
    pointer('pointermove', 1, 100 + SLOP - 2, 100);
    vi.advanceTimersByTime(HOLD_MS);
    expect(a.fire).toHaveBeenCalledOnce();
  });

  it('is cancelled by a second finger', () => {
    const a = fake('menu');
    offerHold(touch(), a.offer);
    pointer('pointerdown', 2, 200, 200);
    vi.advanceTimersByTime(HOLD_MS);
    expect(a.fire).not.toHaveBeenCalled();
  });

  it('does a menu over a tip, and the tip heads the menu', () => {
    const event = {};
    const tip = fake('tip', 'Unit: Free Colonist');
    const menu = fake('menu');
    offerHold({ ...touch(), nativeEvent: event }, tip.offer);
    offerHold({ ...touch(), nativeEvent: event }, menu.offer);
    vi.advanceTimersByTime(HOLD_MS);
    expect(tip.fire).not.toHaveBeenCalled();
    expect(menu.fire).toHaveBeenCalledWith({ x: 100, y: 100 }, 'Unit: Free Colonist');
  });

  it('does the innermost of two tips', () => {
    const inner = fake('tip', 'inner');
    const outer = fake('tip', 'outer');
    expect(choose([outer.offer, inner.offer])).toBe(inner.offer);
  });

  it('knows a contextmenu event that a touch made', () => {
    const a = fake('menu');
    expect(fromTouch()).toBe(false);
    offerHold(touch(), a.offer);
    expect(fromTouch()).toBe(true);
    vi.advanceTimersByTime(HOLD_MS);
    pointer('pointerup', 1, 100, 100);
    vi.advanceTimersByTime(100);
    expect(fromTouch()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(fromTouch()).toBe(false);
  });
});
