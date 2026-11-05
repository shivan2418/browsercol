import { describe, expect, it } from 'vite-plus/test';
import { afterSlide } from './after-slide';

/** A map whose slide ends when the test says so. */
function sliding() {
  let end: () => void = () => {};
  const settled = () => new Promise<void>((ok) => (end = ok));
  return { settled, end: () => end() };
}

describe('afterSlide', () => {
  it('opens the colony panel only once the ship has slid in', async () => {
    const map = sliding();
    const opened: string[] = [];
    const done = afterSlide(map.settled)(() => opened.push('colony'));
    await Promise.resolve();
    expect(opened).toEqual([]);
    map.end();
    await done;
    expect(opened).toEqual(['colony']);
  });

  it('opens at once when no slide is running', async () => {
    const opened: string[] = [];
    await afterSlide(() => Promise.resolve())(() => opened.push('colony'));
    expect(opened).toEqual(['colony']);
  });

  it('returns what the question answers', async () => {
    expect(await afterSlide(() => Promise.resolve())(() => Promise.resolve('ok'))).toBe('ok');
  });
});
