// What the browser scripts that move units share (scenarios.ts, looks.ts): FreeCol's directions and the
// tile beside the active unit it would move onto to meet another player.
import { neighbourOnScreen, type Direction } from '../src/projection.ts';
import type { MapView } from '../src/tileset.ts';

/** FreeCol's directions: the key that moves a unit that way, on the screen (the page turns it to the grid's own). */
export const DIRECTIONS: { key: string; dir: Direction }[] = [
  { key: 'ArrowUp', dir: 'N' },
  { key: 'PageUp', dir: 'NE' },
  { key: 'ArrowRight', dir: 'E' },
  { key: 'PageDown', dir: 'SE' },
  { key: 'ArrowDown', dir: 'S' },
  { key: 'End', dir: 'SW' },
  { key: 'ArrowLeft', dir: 'W' },
  { key: 'Home', dir: 'NW' },
];

/** The tile a unit at (x, y) would attack with a key: an adjacent settlement or unit of another colour. */
export function target(m: MapView) {
  if (!m.active) return null;
  const [x, y] = m.active;
  const own = m.units.find((u) => u.x === x && u.y === y)?.rgb;
  for (const d of DIRECTIONS) {
    const [tx, ty] = neighbourOnScreen(x, y, d.dir);
    const there = m.units.find((u) => u.x === tx && u.y === ty && u.rgb !== own);
    const settlement = m.settlements.find((s) => s.x === tx && s.y === ty && s.rgb !== own);
    if (there || settlement)
      return {
        key: d.key,
        at: [tx, ty],
        what: settlement
          ? `settlement ${settlement.name}`
          : `unit ${there?.keys[0]?.replace('image.unit.model.unit.', '')}`,
      };
  }
  return null;
}
