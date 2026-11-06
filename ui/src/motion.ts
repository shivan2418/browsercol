// How the moving and the active unit look at a moment: the slide of a unit
// along the tiles the Engine says it stepped to, as FreeCol animates a move,
// and the slow blink of the active unit.
import { H, W, tileOrigin } from './view';
import type { GuiEvents } from './webgui';

/** A step of a unit to the next tile, as the Engine tells of it (WebGUI.animateUnitMove). */
export type Step = GuiEvents['animateMove'];

/** A unit's slide across the map: the tiles it goes through, the first the one it set off from. */
export interface Path {
  step: Step;
  tiles: [number, number][];
}

/** How often SwingGUI's UnitMoveAnimation moves a sliding unit on: its ANIMATION_DELAY, in milliseconds. */
const SWING_FRAME_MS = 33;

/**
 * How long a step across a row or a column takes to slide at FreeCol's move animation speed (0 off, 1 slow,
 * 2 normal, 3 fast), in milliseconds, as UnitMoveAnimation moves it: 2^(speed + 1) pixels a frame down a tile and
 * twice that across it, so a tile H pixels high and W wide takes H / 2^(speed + 1) frames. A diagonal step, half a
 * tile each way, takes half of it (see track). At zoom 1: 528, 264 and 132 ms.
 */
export const swingStepMs = (speed: number): number => (speed <= 0 ? 0 : (H / 2 ** (speed + 1)) * SWING_FRAME_MS);

/**
 * How long a unit takes to slide a tile at each of FreeCol's move animation speeds, the index (0 off, 1 slow,
 * 2 normal, 3 fast): another player's unit at the enemy or friendly move animation speed the Engine gives, the
 * player's own at their own animation preference, which has the same choices.
 */
export const OPTION_MS: readonly number[] = [0, 1, 2, 3].map(swingStepMs);

/** How long a step takes to slide at FreeCol's default speed, fast: a step. */
export const MOVE_MS = OPTION_MS[3];

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

/**
 * A path's track: from the first tile's origin through each next one, `ms` a step across a row or a column and half
 * that a diagonal step, as SwingGUI's UnitMoveAnimation moves a unit as many pixels a frame across a tile as down it,
 * and a diagonal step is half a tile each way.
 */
export function track(tiles: [number, number][], ms: number): Track {
  const points = tiles.map((t) => tileOrigin(...t));
  let at = 0;
  const ends = points.slice(1).map(([x, y], i) => {
    const [fx, fy] = points[i];
    return (at += ms * Math.min(1, Math.max(Math.abs(x - fx) / W, Math.abs(y - fy) / H)));
  });
  return { points, ends };
}

/** How long a track takes. */
export const length = (t: Track): number => t.ends[t.ends.length - 1] ?? 0;

/** How far through the last leg the unit is at a share `f` of its time: quick off the mark, and settling onto the tile. */
export const easeOut = (f: number): number => 1 - (1 - f) * (1 - f);

/**
 * Where on the map a unit is `ms` along its track: at the start before it, at the end after it. The last leg eases
 * out; the legs before it are even, so a unit going on along a path does not slow at each tile.
 */
export function along({ points, ends }: Track, ms: number): Point {
  let i = 0;
  while (i < ends.length - 1 && ms >= ends[i]) i++;
  if (!ends.length) return points[0];
  const start = i ? ends[i - 1] : 0;
  const linear = Math.min(1, Math.max(0, (ms - start) / (ends[i] - start || 1)));
  const f = i === ends.length - 1 ? easeOut(linear) : linear;
  const [fx, fy] = points[i];
  const [tx, ty] = points[i + 1];
  return [fx + (tx - fx) * f, fy + (ty - fy) * f];
}

/**
 * What is left of a track `ms` along it, then another after it: a move made while the unit still slides
 * carries on from where it is, rather than the unit jumping to the end of the first. The rest of the leg it is on
 * goes at that leg's even pace, rather than slowing as the leg eased out.
 */
export function carryOn(first: Track, ms: number, next: Track): Track {
  const left = first.ends.findIndex((e) => e > ms);
  const here = along(first, ms);
  let legs: number[] = [];
  if (left >= 0) {
    const legStart = left ? first.ends[left - 1] : 0;
    const [fx, fy] = first.points[left];
    const [tx, ty] = first.points[left + 1];
    const whole = Math.hypot(tx - fx, ty - fy);
    const rest = whole ? ((first.ends[left] - legStart) * Math.hypot(tx - here[0], ty - here[1])) / whole : 0;
    legs = first.ends.slice(left).map((e) => e - first.ends[left] + rest);
  }
  const points = [here, ...(left < 0 ? [] : first.points.slice(left + 1)), ...next.points.slice(1)];
  const end = legs[legs.length - 1] ?? 0;
  return { points, ends: [...legs, ...next.ends.map((e) => e + end)] };
}

/**
 * Where a sliding unit is `ms` along its track, as the pixels it is off the map point `at`: where the actors' layer
 * draws it, the track's end unless said otherwise.
 */
export function slide(t: Track, ms: number, at: Point = t.points[t.points.length - 1]): Point {
  const [x, y] = along(t, ms);
  return [x - at[0], y - at[1]];
}

/** How opaque the active unit is `ms` into the blink. */
export function blink(ms: number, cycle = BLINK_MS): number {
  if (cycle <= 0) return 1;
  return (((ms % cycle) + cycle) % cycle) / cycle < SHOWN ? 1 : DIM;
}
