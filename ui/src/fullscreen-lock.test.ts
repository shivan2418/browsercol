// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { lockEscapeInFullScreen } from './fullscreen-lock';

/** A document stand-in whose full screen element the test sets, then fires fullscreenchange. */
function fake() {
  const target = new EventTarget();
  const doc = {
    fullscreenElement: null as Element | null,
    addEventListener: target.addEventListener.bind(target),
  };
  const change = (on: boolean) => {
    doc.fullscreenElement = on ? document.body : null;
    target.dispatchEvent(new Event('fullscreenchange'));
  };
  return { doc, change };
}

describe('Escape in full screen', () => {
  it('is locked on entering full screen and unlocked on leaving', () => {
    const { doc, change } = fake();
    const keyboard = { lock: vi.fn(() => Promise.resolve()), unlock: vi.fn() };
    const after = vi.fn();
    lockEscapeInFullScreen(doc, keyboard, after);
    change(true);
    expect(keyboard.lock).toHaveBeenCalledWith(['Escape']);
    expect(keyboard.unlock).not.toHaveBeenCalled();
    change(false);
    expect(keyboard.unlock).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('survives a refused lock', async () => {
    const { doc, change } = fake();
    lockEscapeInFullScreen(doc, { lock: () => Promise.reject(new Error('no')) });
    change(true);
    await Promise.resolve();
  });

  it('does nothing where there is no Keyboard Lock API', () => {
    const { doc, change } = fake();
    const after = vi.fn();
    lockEscapeInFullScreen(doc, undefined, after);
    expect(() => {
      change(true);
      change(false);
    }).not.toThrow();
    lockEscapeInFullScreen(fake().doc, {});
    expect(after).toHaveBeenCalledTimes(2);
  });
});
