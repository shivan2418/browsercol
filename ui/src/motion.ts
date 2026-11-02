// What moved between two draws of the map, and how the moving and the active
// unit look at a moment: the slide of a unit to the next tile, as FreeCol
// animates a move, and the slow blink of the active unit.
import { tileOrigin, W } from './view';
import type { Unit } from './tileset';

/** A unit that went from one tile to the next. */
export interface Move {
  from: [number, number];
  to: [number, number];
}

/** How long a unit takes to slide to the next tile, in milliseconds. */
export const MOVE_MS = 300;
/** The active unit's blink: a whole cycle, and how much of it the unit is shown. */
export const BLINK_MS = 1400;
const SHOWN = 0.6;
/** How faint the active unit gets in the dark half of the blink. */
const DIM = 0.15;

const identity = (u: Unit) => `${u.keys[0] ?? ''}|${u.rgb}|${u.chip}`;
const at = (u: { x: number; y: number }) => `${u.x},${u.y}`;

/** Whether two tiles are neighbours, by the distance between their centres. */
function adjacent(a: [number, number], b: [number, number]): boolean {
  const [ax, ay] = tileOrigin(...a);
  const [bx, by] = tileOrigin(...b);
  const d = Math.hypot(ax - bx, ay - by);
  return d > 0 && d <= W + 1;
}

/**
 * The units that moved to a neighbouring tile between two draws. The map
 * view carries no unit ids, so a unit is what it looks like (its images,
 * owner and chip): one that left a tile and one that looks the same on a
 * neighbouring tile that did not have it before are the same unit.
 */
export function moves(before: Unit[], after: Unit[]): Move[] {
  const count = (units: Unit[]) => {
    const m = new Map<string, number>();
    for (const u of units) m.set(`${at(u)}|${identity(u)}`, (m.get(`${at(u)}|${identity(u)}`) ?? 0) + 1);
    return m;
  };
  const was = count(before);
  const now = count(after);
  const left = before.filter((u) => !(now.get(`${at(u)}|${identity(u)}`) ?? 0));
  const arrived = after.filter((u) => !(was.get(`${at(u)}|${identity(u)}`) ?? 0));
  const out: Move[] = [];
  for (const to of arrived) {
    const i = left.findIndex((f) => identity(f) === identity(to) && adjacent([f.x, f.y], [to.x, to.y]));
    if (i < 0) continue;
    const [from] = left.splice(i, 1);
    out.push({ from: [from.x, from.y], to: [to.x, to.y] });
  }
  return out;
}

/** Where a sliding unit is `t` (0 to 1) of the way, as the pixels it is short of its tile. */
export function slide(move: Move, t: number): [number, number] {
  const [fx, fy] = tileOrigin(...move.from);
  const [tx, ty] = tileOrigin(...move.to);
  const left = 1 - Math.min(1, Math.max(0, t));
  return [(fx - tx) * left, (fy - ty) * left];
}

/** How opaque the active unit is `ms` into the blink. */
export function blink(ms: number, cycle = BLINK_MS): number {
  if (cycle <= 0) return 1;
  return (((ms % cycle) + cycle) % cycle) / cycle < SHOWN ? 1 : DIM;
}
