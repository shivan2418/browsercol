// How the moving and the active unit look at a moment: the slide of a unit
// along the tiles the Engine says it stepped to, as FreeCol animates a move,
// and the slow blink of the active unit.
import { tileOrigin } from './view';
import type { GuiEvents } from './webgui';

/** A step of a unit to the next tile, as the Engine tells of it (WebGUI.animateUnitMove). */
export type Step = GuiEvents['animateMove'];

/** A unit's slide across the map: the tiles it goes through, the first the one it set off from. */
export interface Path {
  step: Step;
  tiles: [number, number][];
}

/** How long a unit takes to slide to the next tile, in milliseconds: a step. */
export const MOVE_MS = 300;
/**
 * How long another player's unit takes to slide a tile at FreeCol's enemy or friendly move animation speed
 * (0 off, 1 slow, 2 normal, 3 fast); the player's own are as long as their own animation preference, MOVE_MS.
 */
export const OPTION_MS: readonly number[] = [0, 600, 300, 150];

/** How long a step of the path takes to slide: another player's unit by the Engine's speed, else `own`. */
export const stepMs = (step: Step, own: number): number =>
  step.speed === null ? own : (OPTION_MS[step.speed] ?? OPTION_MS[OPTION_MS.length - 1]);

/** The active unit's blink: a whole cycle, and how much of it the unit is shown. */
export const BLINK_MS = 1400;
const SHOWN = 0.6;
/** How faint the active unit gets in the dark half of the blink. */
const DIM = 0.15;

/**
 * What slides for the steps the Engine told of between two maps: one unit's
 * steps, joined into a path. Several of the player's units moving at once
 * (orders carried out as the turn turns) jump, as do steps that do not follow
 * on from each other. When other players' units moved, the one that moved last
 * slides, along its last steps; the others jump.
 */
export function path(all: Step[]): Path | null {
  let steps = all;
  const last = all[all.length - 1];
  if (last && last.speed !== null) {
    let from = all.length - 1;
    while (from > 0 && all[from - 1].unit === last.unit && all[from - 1].to.join() === all[from].from.join()) from--;
    steps = all.slice(from);
  }
  if (!steps.length || steps.some((s) => s.unit !== steps[0].unit)) return null;
  const tiles: [number, number][] = [steps[0].from];
  for (const s of steps) {
    if (s.from.join() !== tiles[tiles.length - 1].join()) return null;
    tiles.push(s.to);
  }
  return { step: steps[steps.length - 1], tiles };
}

type Point = [number, number];

/**
 * A slide laid out in time: the map points the unit passes, the first where it sets off, and when each leg
 * to the next point ends, in milliseconds from the start.
 */
export interface Track {
  points: Point[];
  ends: number[];
}

/** A path's track: from the first tile's origin through each next one, `ms` a step. */
export function track(tiles: [number, number][], ms: number): Track {
  return { points: tiles.map((t) => tileOrigin(...t)), ends: tiles.slice(1).map((_, i) => (i + 1) * ms) };
}

/** How long a track takes. */
export const length = (t: Track): number => t.ends[t.ends.length - 1] ?? 0;

/** Where on the map a unit is `ms` along its track: at the start before it, at the end after it. */
export function along({ points, ends }: Track, ms: number): Point {
  let i = 0;
  while (i < ends.length - 1 && ms >= ends[i]) i++;
  if (!ends.length) return points[0];
  const start = i ? ends[i - 1] : 0;
  const f = Math.min(1, Math.max(0, (ms - start) / (ends[i] - start || 1)));
  const [fx, fy] = points[i];
  const [tx, ty] = points[i + 1];
  return [fx + (tx - fx) * f, fy + (ty - fy) * f];
}

/**
 * What is left of a track `ms` along it, then another after it: a move made while the unit still slides
 * carries on from where it is, rather than the unit jumping to the end of the first.
 */
export function carryOn(first: Track, ms: number, next: Track): Track {
  const left = first.ends.findIndex((e) => e > ms);
  const legs = left < 0 ? [] : first.ends.slice(left).map((e) => e - ms);
  const points = [along(first, ms), ...(left < 0 ? [] : first.points.slice(left + 1)), ...next.points.slice(1)];
  const end = legs[legs.length - 1] ?? 0;
  return { points, ends: [...legs, ...next.ends.map((e) => e + end)] };
}

/** Where a sliding unit is `ms` along its track, as the pixels it is short of the track's end. */
export function slide(t: Track, ms: number): Point {
  const [x, y] = along(t, ms);
  const [ex, ey] = t.points[t.points.length - 1];
  return [x - ex, y - ey];
}

/** How opaque the active unit is `ms` into the blink. */
export function blink(ms: number, cycle = BLINK_MS): number {
  if (cycle <= 0) return 1;
  return (((ms % cycle) + cycle) % cycle) / cycle < SHOWN ? 1 : DIM;
}
