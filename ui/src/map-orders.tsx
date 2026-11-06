// The order buttons over the map, bottom right, as FreeCol's CornerMapControls puts the active unit's orders
// there. They stay in normal play, where the side panel (a debug scaffold) is hidden.
import type { CSSProperties } from 'react';
import { Tip } from './controls';
import type { Art } from './frame';
import { orderOf, type Command } from './input';
import { PANEL_KEY_FAMILIES } from './map-keys';

/**
 * The buttons: the order each gives the active unit, in CornerMapControls' order, with the name of FreeCol's
 * button pictures (the order-buttons of data/base, which the action classes name in addImageIcons). Swing has no
 * button for Go to, so that one stays a text button.
 */
const BUTTONS: [string, Command, string | null][] = [
  ['Skip', { k: 'skip' }, 'done'],
  ['Fortify', { k: 'fortify' }, 'fortify'],
  ['Sentry', { k: 'sentry' }, 'sentry'],
  ['Go to', { k: 'selectDestination' }, null],
  ['Build colony', { k: 'buildColony' }, 'build'],
  ['Plow', { k: 'plow' }, 'plow'],
  ['Clear forest', { k: 'clearForest' }, 'clearForest'],
  ['Road', { k: 'road' }, 'road'],
  ['Disband', { k: 'disband' }, 'disband'],
];

/** ImageLibrary.getButtonImages: a button's picture per state, as CSS custom properties; null without the art. */
function pictures(art: Art, name: string): CSSProperties | null {
  const states = ['normal', 'highlighted', 'pressed', 'disabled'] as const;
  const srcs = states.map((state) => art([`${PANEL_KEY_FAMILIES.button}${state}.${name}`]));
  if (srcs.some((src) => !src)) return null;
  return Object.fromEntries(states.map((state, i) => [`--${state}`, `url("${srcs[i]}")`])) as CSSProperties;
}

/** The orders the active unit can take (`orders`, by the Engine's names); nothing is drawn with no active unit. */
export function MapOrders({
  orders,
  active,
  run,
  art = () => null,
}: {
  orders: readonly string[];
  active: boolean;
  run: (c: Command) => void;
  /** The image for resource keys; without it, or for a button it has no pictures for, the button shows its name. */
  art?: Art;
}) {
  if (!active) return null;
  return (
    <div id="map-orders" role="toolbar" aria-label="Unit orders">
      {BUTTONS.map(([label, c, picture]) => {
        const look = picture ? pictures(art, picture) : null;
        return (
          <Tip
            as="button"
            key={c.k}
            tip={label}
            aria-label={label}
            data-order={c.k}
            disabled={!orders.includes(orderOf(c) ?? '')}
            onClick={() => run(c)}
            {...(look ? { className: 'pictured', style: look } : {})}
          >
            {!look && label}
          </Tip>
        );
      })}
    </div>
  );
}
