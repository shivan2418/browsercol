/** One goods type and how many holds of it. */
export type Work = [goods: string, holds: number];

/** How many holds of each goods type a cargo list has, in the order the types first appear. */
export const holdsOf = (cargo: readonly string[]) => {
  const n = new Map<string, number>();
  for (const g of cargo) n.set(g, (n.get(g) ?? 0) + 1);
  return n;
};

/**
 * What a carrier does at stop i, as FreeCol's: a stop's list is what the carrier leaves with, so against the
 * stop before's (the last one for the first stop, as the route loops) a goods type the stop does not list is
 * unloaded, all of it (InGameController.unloadUnitAtStop), and one it lists is kept aboard, all of it, even
 * beyond the holds listed; a listed goods is loaded only up to its holds (loadUnitAtStop). Each list entry is
 * one full hold (TradeRouteStop.getCompactCargo), so holds are counted per goods type. This is the route's
 * plan; real amounts depend on the colony's stock and warehouse levels.
 */
export function stopWork(stops: readonly { cargo: readonly string[] }[], i: number) {
  const n = stops.length;
  const before = holdsOf(stops[(i - 1 + n) % n].cargo);
  const after = holdsOf(stops[i].cargo);
  const unload: Work[] = [];
  const load: Work[] = [];
  const keep: Work[] = [];
  for (const [g, k] of before) (after.has(g) ? keep : unload).push([g, k]);
  for (const [g, k] of after) if (k > (before.get(g) ?? 0)) load.push([g, k - (before.get(g) ?? 0)]);
  return { unload, load, keep };
}
