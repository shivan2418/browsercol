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
  | { k: 'showEurope' }
  | { k: 'findSettlement' }
  | { k: 'showGameOptions' }
  | { k: 'showMapGeneratorOptions' }
  | { k: 'showDifficulty' }
  | { k: 'retire' }
  | { k: 'showHighScores' }
  | { k: 'fortify' }
  | { k: 'sentry' }
  | { k: 'skip' }
  | { k: 'disband' }
  | { k: 'unload' }
  | { k: 'plow' }
  | { k: 'clearForest' }
  | { k: 'road' }
  | { k: 'selectDestination' }
  | { k: 'tradeRoutes' }
  | { k: 'clearOrders' }
  | { k: 'change' }
  | { k: 'assignRoute' };

const BY_KEY: Record<string, Command> = {
  ArrowUp: { k: 'move', direction: 'N' },
  ArrowRight: { k: 'move', direction: 'E' },
  ArrowDown: { k: 'move', direction: 'S' },
  ArrowLeft: { k: 'move', direction: 'W' },
  // Without a numpad, MoveAction's secondary accelerators take the diagonals.
  Home: { k: 'move', direction: 'NW' },
  PageUp: { k: 'move', direction: 'NE' },
  End: { k: 'move', direction: 'SW' },
  PageDown: { k: 'move', direction: 'SE' },
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
  // UnloadAction: a carrier unloads (dumps, off a colony or Europe).
  u: { k: 'unload' },
  U: { k: 'unload' },
  p: { k: 'plow' },
  P: { k: 'plow' },
  c: { k: 'clearForest' },
  C: { k: 'clearForest' },
  r: { k: 'road' },
  R: { k: 'road' },
  // ClearOrdersAction, and ChangeAction (Tab: the same as a click on the active unit's tile).
  z: { k: 'clearOrders' },
  Z: { k: 'clearOrders' },
  Tab: { k: 'change' },
  // The Go To order, as GotoAction binds it: the player is asked where
  // the unit goes.
  h: { k: 'selectDestination' },
  H: { k: 'selectDestination' },
  // AssignTradeRouteAction opens the trade routes panel for the active carrier.
  a: { k: 'assignRoute' },
  A: { k: 'assignRoute' },
  // The Europe view, as EuropeAction binds it.
  e: { k: 'showEurope' },
  E: { k: 'showEurope' },
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

/** The orders of the active unit, by command, as the Engine names them (UnitOrders.java). */
const ORDER_OF: Partial<Record<Command['k'], string>> = {
  buildColony: 'buildColony',
  fortify: 'fortify',
  sentry: 'sentry',
  skip: 'skip',
  disband: 'disband',
  unload: 'unload',
  plow: 'plow',
  clearForest: 'clearForest',
  road: 'road',
  selectDestination: 'goto',
  assignRoute: 'assignRoute',
};

/** The Engine's name for the order a command gives the active unit, or null if it is no order. */
export function orderOf(c: Command): string | null {
  return ORDER_OF[c.k] ?? null;
}

/**
 * The command for a key press, or null if the key does nothing. An order's
 * key does nothing unless the Engine offers the order (`orders`), as the
 * Swing client ignores the key of a disabled action.
 */
export function commandForKey(e: { key: string; code: string }, orders: readonly string[]): Command | null {
  const direction = NUMPAD[e.code];
  if (direction) return { k: 'move', direction };
  const c = Object.hasOwn(BY_KEY, e.key) ? BY_KEY[e.key] : null;
  const order = c && orderOf(c);
  return order && !orders.includes(order) ? null : c;
}
