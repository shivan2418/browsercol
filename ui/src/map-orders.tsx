// The order buttons over the map, bottom right, as FreeCol's CornerMapControls puts the active unit's orders
// there. They stay in normal play, where the side panel (a debug scaffold) is hidden.
import type { CSSProperties } from 'react';
import { Tip } from './controls';
import { cssUrl, type Art } from './frame';
import { orderOf, type Command } from './input';
import { PANEL_KEY_FAMILIES } from './map-keys';
import './map-orders.css';

/**
 * The buttons: the order each gives the active unit, in CornerMapControls' order, with the name of FreeCol's
 * button pictures (the order-buttons of data/base, which the action classes name in addImageIcons). Swing has no
 * Go to button (the order is G, the Orders menu, or a click on the map), so a row with a mouse has none either.
 */
const BUTTONS: [string, Command, string][] = [
  ['Skip', { k: 'skip' }, 'done'],
  ['Fortify', { k: 'fortify' }, 'fortify'],
  ['Sentry', { k: 'sentry' }, 'sentry'],
  ['Build colony', { k: 'buildColony' }, 'build'],
  ['Plow', { k: 'plow' }, 'plow'],
  ['Clear forest', { k: 'clearForest' }, 'clearForest'],
  ['Road', { k: 'road' }, 'road'],
  ['Disband', { k: 'disband' }, 'disband'],
];

/**
 * The buttons a touch screen adds, as it has no W, Tab or G key: Wait (WaitAction, the next unit waits), Go to
 * (GotoAction, then a tap on the destination) and Next unit on tile (ChangeAction, FreeCol's name for Tab). Wait has
 * FreeCol's picture; the others have none in order-buttons and show their names.
 */
const WAIT: [string, Command, string] = ['Wait', { k: 'nextUnit' }, 'wait'];
const TOUCH_BUTTONS: [string, Command, string][] = [
  ['Go to', { k: 'selectDestination' }, 'goto'],
  ['Next unit on tile', { k: 'change' }, 'change'],
];

/** Whether the device has a touch screen, with a mouse as well or not: any pointer of it is coarse (a finger). */
export function hasTouch(): boolean {
  return (
    (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) || navigator.maxTouchPoints > 0
  );
}

/** ImageLibrary.getButtonImages: a button's picture per state, as CSS custom properties; null without the art. */
function pictures(art: Art, name: string): CSSProperties | null {
  const states = ['normal', 'highlighted', 'pressed', 'disabled'] as const;
  const srcs = states.map((state) => art([`${PANEL_KEY_FAMILIES.button}${state}.${name}`]));
  if (srcs.some((src) => !src)) return null;
  return Object.fromEntries(states.map((state, i) => [`--${state}`, cssUrl(srcs[i] as string)])) as CSSProperties;
}

/** The orders the active unit can take (`orders`, by the Engine's names); nothing is drawn with no active unit. */
export function MapOrders({
  orders,
  active,
  run,
  art = () => null,
  touch = false,
  choosing = false,
  goTo = () => {},
}: {
  orders: readonly string[];
  active: boolean;
  run: (c: Command) => void;
  /** The image for resource keys; without it, or for a button it has no pictures for, the button shows its name. */
  art?: Art;
  /** The device has a touch screen: Wait, Go to and Next unit on tile are added (hasTouch). */
  touch?: boolean;
  /** A Go To is waiting for the destination (a tap on the map): the Go to button is pressed, and cancels it. */
  choosing?: boolean;
  /** The Go to button: starts choosing a destination, or cancels it. */
  goTo?: () => void;
}) {
  if (!active) return null;
  return (
    <div id="map-orders" role="toolbar" aria-label="Unit orders">
      {[...(touch ? [WAIT] : []), ...BUTTONS, ...(touch ? TOUCH_BUTTONS : [])].map(([label, c, picture]) => {
        const order = orderOf(c);
        const picking = c.k === 'selectDestination';
        const look = pictures(art, picture);
        return (
          <Tip
            as="button"
            key={c.k}
            tip={label}
            aria-label={label}
            data-order={c.k}
            disabled={order !== null && !orders.includes(order) && !(picking && choosing)}
            onClick={() => (picking ? goTo() : run(c))}
            {...(picking ? { 'aria-pressed': choosing } : {})}
            {...(look ? { className: 'pictured', style: look } : {})}
          >
            {!look && label}
          </Tip>
        );
      })}
    </div>
  );
}
