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

describe('viewHold with a batch of steps played in turn', () => {
  it('holds a change behind the steps before it until the run that ends there is played', async () => {
    let steps = 0;
    const hold = viewHold(
      () => steps > 0,
      () => new Promise<void>(() => {}),
      () => steps,
    );
    const seen: string[] = [];
    steps = 1;
    hold.change(() => seen.push('next unit'), true, 'unit:2');
    steps = 3;
    hold.change(() => seen.push('unit 2 at its new tile'), false, 'unit:2');
    hold.change(() => seen.push('messages'), true);
    expect(seen).toEqual([]);
    // The run of steps 2 and 3 is about to play: what came in it, for its unit, comes first.
    await hold.reach(3, 'unit:2');
    expect(seen).toEqual(['next unit', 'unit 2 at its new tile']);
  });

  it('does not run a change that came after the last step of a run for another unit before the run', async () => {
    let steps = 1;
    const hold = viewHold(
      () => true,
      () => new Promise<void>(() => {}),
      () => steps,
    );
    const seen: string[] = [];
    hold.change(() => seen.push('unit 3'), true, 'unit:3');
    steps = 2;
    await hold.reach(1, 'unit:2');
    expect(seen).toEqual([]);
    await hold.reach(2, 'unit:3');
    expect(seen).toEqual(['unit 3']);
  });

  it('plays on past a unit that leaves the map (no steps, no slide), its arrival coming in order after the slides', async () => {
    let steps = 1;
    let on = true;
    let end: () => void = () => {};
    const slid = new Promise<void>((ok) => (end = ok));
    const hold = viewHold(
      () => on,
      () => slid,
      () => steps,
    );
    const seen: string[] = [];
    // The caravel sails off to Europe after unit 2's only step: it has no run, and no tile to take the camera to.
    hold.change(() => seen.push('caravel on the high seas'), true, 'unit:caravel');
    hold.change(() => seen.push('arrival message'), true);
    await hold.reach(1, 'unit:2');
    expect(seen).toEqual([]);
    on = false;
    end();
    await hold.idle();
    expect(seen).toEqual(['caravel on the high seas', 'arrival message']);
  });
});
