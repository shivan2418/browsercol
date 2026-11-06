// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { leaveGuard } from './leave-guard';

/** Fire beforeunload on a fresh window; whether the page asked to stay. */
function asks(win: EventTarget): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  win.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('leaveGuard', () => {
  it('lets a game with no change go', () => {
    const win = new EventTarget();
    leaveGuard(win);
    expect(asks(win)).toBe(false);
  });

  it('asks once the game has changed, until a save of it is stored', () => {
    const win = new EventTarget();
    const g = leaveGuard(win);
    g.changed();
    expect(asks(win)).toBe(true);
    g.saving();
    expect(asks(win)).toBe(true);
    g.saved();
    expect(asks(win)).toBe(false);
  });

  it('keeps asking about a change made while the save was on its way', () => {
    const win = new EventTarget();
    const g = leaveGuard(win);
    g.changed();
    g.saving();
    g.changed();
    g.saved();
    expect(asks(win)).toBe(true);
  });

  it('does not ask when the page leaves on purpose', () => {
    const win = new EventTarget();
    const g = leaveGuard(win);
    g.changed();
    g.leaving();
    expect(asks(win)).toBe(false);
  });
});
