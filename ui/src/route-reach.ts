// Which carriers can follow a trade route. FreeCol saves any route whose stops
// are the player's, and a carrier given one it cannot follow is stuck on the
// stop it cannot reach; the editor says so before it is saved.
//
// A ship reaches Europe and the colonies that are ports on the high seas. A
// wagon train stays on its landmass, which Europe is not on: it can follow a
// route whose stops are all colonies on one landmass.

/** What the Engine says of a place a stop can be at (TradeRoutes.java, place). */
export interface Reachable {
  label: string;
  /** Whether ships reach it: Europe, or a colony that is a port. */
  port: boolean;
  /** The landmass a colony is on; null for Europe. */
  land: number | null;
}

/** Which carriers can follow a route, and the stops that keep the others off it. */
export interface Reach {
  ships: boolean;
  wagons: boolean;
  /** The stops no ship reaches, by label. */
  inland: string[];
  /** Whether a stop is in Europe, where no wagon train goes. */
  europe: boolean;
  /** The stops on another landmass than the first colony's, by label. */
  across: string[];
  /** The first colony of the route, whose landmass the others are measured from. */
  first: string | null;
}

/** Which carriers can follow a route with these stops, in order. */
export function reach(stops: readonly Reachable[]): Reach {
  const inland = stops.filter((s) => !s.port).map((s) => s.label);
  const europe = stops.some((s) => s.land === null);
  const colonies = stops.filter((s) => s.land !== null);
  const land = colonies[0]?.land;
  const across = colonies.filter((s) => s.land !== land).map((s) => s.label);
  return {
    ships: inland.length === 0,
    wagons: !europe && across.length === 0,
    inland: [...new Set(inland)],
    europe,
    across: [...new Set(across)],
    first: colonies[0]?.label ?? null,
  };
}

/** Labels as a list in a sentence: "A", "A and B", "A, B and C". */
const listed = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** Why wagon trains cannot follow a route, as the end of a sentence. */
const noWagons = (r: Reach) =>
  r.europe
    ? 'wagon trains cannot go to Europe'
    : `wagon trains cannot leave ${r.first}’s landmass for ${listed(r.across)}`;

/**
 * What the editor says of a route: which carriers can follow it, or why none can. Null for a route of fewer
 * than two stops, which FreeCol refuses anyway.
 */
export function reachText(stops: readonly Reachable[]): { ok: boolean; text: string } | null {
  if (stops.length < 2) return null;
  const r = reach(stops);
  if (r.ships && r.wagons) return { ok: true, text: 'Ships and wagon trains can follow this route.' };
  if (r.ships) return { ok: true, text: `Only ships can follow this route: ${noWagons(r)}.` };
  const inland = `ships cannot reach ${listed(r.inland)}, inland`;
  if (r.wagons) return { ok: true, text: `Only wagon trains can follow this route: ${inland}.` };
  return { ok: false, text: `No carrier can follow this route: ${inland}, and ${noWagons(r)}.` };
}
