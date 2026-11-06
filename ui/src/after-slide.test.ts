import { describe, expect, it } from 'vite-plus/test';
import { afterSlide, viewHold } from './after-slide';

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

describe('viewHold', () => {
  /** A map that slides until the test ends it. */
  function slidingMap() {
    let on = false;
    let end: () => void = () => {};
    let ended = Promise.resolve();
    return {
      sliding: () => on,
      settled: () => ended,
      start: () => {
        on = true;
        ended = new Promise<void>((ok) => (end = ok));
      },
      end: () => {
        on = false;
        end();
      },
    };
  }

  it('moves the camera to the next unit only once the unit has slid to its tile', async () => {
    const map = slidingMap();
    const hold = viewHold(map.sliding, map.settled);
    const seen: string[] = [];
    map.start();
    hold.change(() => seen.push('same unit'), false);
    hold.change(() => seen.push('next unit'), true);
    expect(seen).toEqual(['same unit']);
    map.end();
    await hold.idle();
    expect(seen).toEqual(['same unit', 'next unit']);
  });

  it('keeps the changes after a held one in order behind it', async () => {
    const map = slidingMap();
    const hold = viewHold(map.sliding, map.settled);
    const seen: string[] = [];
    map.start();
    hold.change(() => seen.push('next unit'), true);
    hold.change(() => seen.push('map'), false);
    expect(seen).toEqual([]);
    map.end();
    await hold.idle();
    expect(seen).toEqual(['next unit', 'map']);
    hold.change(() => seen.push('later'), false);
    expect(seen).toEqual(['next unit', 'map', 'later']);
  });

  it('changes the view at once when no unit slides', () => {
    const hold = viewHold(
      () => false,
      () => Promise.resolve(),
    );
    const seen: string[] = [];
    hold.change(() => seen.push('next unit'), true);
    expect(seen).toEqual(['next unit']);
  });
});
