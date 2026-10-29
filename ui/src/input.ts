// The player's keys, mapped to the client Engine's player commands
// (engine/.../web/Commands.java). Arrow keys and the numpad move the active
// unit one step, as FreeCol's MoveAction keys do.

/** FreeCol's Direction names. */
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type Command = { k: 'move'; direction: Direction } | { k: 'nextUnit' } | { k: 'buildColony' } | { k: 'endTurn' };

const BY_KEY: Record<string, Command> = {
  ArrowUp: { k: 'move', direction: 'N' },
  ArrowRight: { k: 'move', direction: 'E' },
  ArrowDown: { k: 'move', direction: 'S' },
  ArrowLeft: { k: 'move', direction: 'W' },
  w: { k: 'nextUnit' },
  W: { k: 'nextUnit' },
  ' ': { k: 'nextUnit' },
  b: { k: 'buildColony' },
  B: { k: 'buildColony' },
  Enter: { k: 'endTurn' },
};

// Numpad keys by code, the same with Num Lock on or off.
const NUMPAD: Record<string, Direction> = {
  Numpad8: 'N',
  Numpad9: 'NE',
  Numpad6: 'E',
  Numpad3: 'SE',
  Numpad2: 'S',
  Numpad1: 'SW',
  Numpad4: 'W',
  Numpad7: 'NW',
};

/** The command for a key press, or null if the key does nothing. */
export function commandForKey(e: { key: string; code: string }): Command | null {
  const direction = NUMPAD[e.code];
  if (direction) return { k: 'move', direction };
  return Object.hasOwn(BY_KEY, e.key) ? BY_KEY[e.key] : null;
}
