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

/**
 * Where a sliding unit is `t` (0 to 1) of the way along its tiles, each step
 * taking as long, as the pixels it is short of the last tile.
 */
export function slide(tiles: [number, number][], t: number): [number, number] {
  const [ex, ey] = tileOrigin(...tiles[tiles.length - 1]);
  const steps = tiles.length - 1;
  if (steps < 1) return [0, 0];
  const along = Math.min(1, Math.max(0, t)) * steps;
  const i = Math.min(steps - 1, Math.floor(along));
  const [fx, fy] = tileOrigin(...tiles[i]);
  const [tx, ty] = tileOrigin(...tiles[i + 1]);
  const f = along - i;
  return [fx + (tx - fx) * f - ex, fy + (ty - fy) * f - ey];
}

/** How opaque the active unit is `ms` into the blink. */
export function blink(ms: number, cycle = BLINK_MS): number {
  if (cycle <= 0) return 1;
  return (((ms % cycle) + cycle) % cycle) / cycle < SHOWN ? 1 : DIM;
}
