// What the browser scripts that move units share (scenarios.ts, looks.ts): FreeCol's directions and the
// tile beside the active unit it would move onto to meet another player.
import type { MapView } from '../src/tileset.ts';

/** FreeCol's directions: the key that moves a unit that way, and the step from a tile (its row's parity matters). */
export const DIRECTIONS: { key: string; odd: [number, number]; even: [number, number] }[] = [
  { key: 'ArrowUp', odd: [0, -2], even: [0, -2] },
  { key: 'PageUp', odd: [1, -1], even: [0, -1] },
  { key: 'ArrowRight', odd: [1, 0], even: [1, 0] },
  { key: 'PageDown', odd: [1, 1], even: [0, 1] },
  { key: 'ArrowDown', odd: [0, 2], even: [0, 2] },
  { key: 'End', odd: [0, 1], even: [-1, 1] },
  { key: 'ArrowLeft', odd: [-1, 0], even: [-1, 0] },
  { key: 'Home', odd: [0, -1], even: [-1, -1] },
];

/** The tile a unit at (x, y) would attack with a key: an adjacent settlement or unit of another colour. */
export function target(m: MapView) {
  if (!m.active) return null;
  const [x, y] = m.active;
  const own = m.units.find((u) => u.x === x && u.y === y)?.rgb;
  const [odd, even] = [(d: (typeof DIRECTIONS)[number]) => d.odd, (d: (typeof DIRECTIONS)[number]) => d.even];
  for (const d of DIRECTIONS) {
    const [dx, dy] = (y & 1 ? odd : even)(d);
    const [tx, ty] = [x + dx, y + dy];
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
