// The player's keys, mapped to the client Engine's player commands
// (engine/.../web/Commands.java). Arrow keys and the numpad move the active
// unit one step, as FreeCol's MoveAction keys do, and the orders have the
// keys the Swing client binds them to.

/** FreeCol's Direction names. */
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type Command =
  | { k: 'move'; direction: Direction }
  | { k: 'nextUnit' }
  | { k: 'buildColony' }
  | { k: 'endTurn' }
  | { k: 'declareIndependence' }
  | { k: 'fortify' }
  | { k: 'sentry' }
  | { k: 'skip' }
  | { k: 'disband' }
  | { k: 'plow' }
  | { k: 'clearForest' }
  | { k: 'road' }
  | { k: 'selectDestination' };

const BY_KEY: Record<string, Command> = {
  ArrowUp: { k: 'move', direction: 'N' },
  ArrowRight: { k: 'move', direction: 'E' },
  ArrowDown: { k: 'move', direction: 'S' },
  ArrowLeft: { k: 'move', direction: 'W' },
  w: { k: 'nextUnit' },
  W: { k: 'nextUnit' },
  b: { k: 'buildColony' },
  B: { k: 'buildColony' },
  Enter: { k: 'endTurn' },
  // The standing orders, with the keys the Swing client binds them to:
  // FortifyAction, SentryAction, SkipUnitAction, DisbandUnitAction and
  // the ImprovementActions. Space skips the unit, as SkipUnitAction does;
  // the next unit waits for W, as WaitAction does.
  f: { k: 'fortify' },
  F: { k: 'fortify' },
  s: { k: 'sentry' },
  S: { k: 'sentry' },
  ' ': { k: 'skip' },
  d: { k: 'disband' },
  D: { k: 'disband' },
  p: { k: 'plow' },
  P: { k: 'plow' },
  c: { k: 'clearForest' },
  C: { k: 'clearForest' },
  r: { k: 'road' },
  R: { k: 'road' },
  // The Go To order, as GotoAction binds it: the player is asked where
  // the unit goes.
  h: { k: 'selectDestination' },
  H: { k: 'selectDestination' },
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
