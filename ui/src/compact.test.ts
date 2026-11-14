// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { watchCompact } from './compact';

/** A media query list whose answer the test sets. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    set(m: boolean) {
      this.matches = m;
      for (const f of listeners) f();
    },
    listeners,
  };
}

describe('watchCompact', () => {
  it('marks the root while the screen is small, and follows a change', () => {
    const root = document.createElement('html');
    const m = fakeMedia(true);
    const stop = watchCompact(root, m as never);
    expect(root.hasAttribute('data-compact')).toBe(true);
    m.set(false);
    expect(root.hasAttribute('data-compact')).toBe(false);
    m.set(true);
    expect(root.hasAttribute('data-compact')).toBe(true);
    stop();
    expect(m.listeners.size).toBe(0);
  });

  it('leaves a large screen unmarked', () => {
    const root = document.createElement('html');
    watchCompact(root, fakeMedia(false) as never);
    expect(root.hasAttribute('data-compact')).toBe(false);
  });
});
