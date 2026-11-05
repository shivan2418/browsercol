// The order buttons over the map, bottom right, as FreeCol's CornerMapControls puts the active unit's orders
// there. They stay in normal play, where the side panel (a debug scaffold) is hidden.
import { orderOf, type Command } from './input';

/** The buttons: the order each gives the active unit, in CornerMapControls' order. */
const BUTTONS: [string, Command][] = [
  ['Skip', { k: 'skip' }],
  ['Fortify', { k: 'fortify' }],
  ['Sentry', { k: 'sentry' }],
  ['Go to', { k: 'selectDestination' }],
  ['Build colony', { k: 'buildColony' }],
  ['Plow', { k: 'plow' }],
  ['Clear forest', { k: 'clearForest' }],
  ['Road', { k: 'road' }],
  ['Disband', { k: 'disband' }],
];

/** The orders the active unit can take (`orders`, by the Engine's names); nothing is drawn with no active unit. */
export function MapOrders({
  orders,
  active,
  run,
}: {
  orders: readonly string[];
  active: boolean;
  run: (c: Command) => void;
}) {
  if (!active) return null;
  return (
    <div id="map-orders" role="toolbar" aria-label="Unit orders">
      {BUTTONS.map(([label, c]) => (
        <button key={c.k} data-order={c.k} disabled={!orders.includes(orderOf(c) ?? '')} onClick={() => run(c)}>
          {label}
        </button>
      ))}
    </div>
  );
}
