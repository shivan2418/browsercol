import { describe, expect, it } from 'vite-plus/test';
import { commandForKey } from './input';

/** Every order the Engine names, so each order's key is live. */
const ALL = [
  'buildColony',
  'fortify',
  'sentry',
  'skip',
  'disband',
  'unload',
  'plow',
  'clearForest',
  'road',
  'goto',
  'assignRoute',
];
const key = (key: string, code = '', orders = ALL) => commandForKey({ key, code }, orders);

describe('commandForKey', () => {
  it('moves with the arrow keys and the numpad, as FreeCol does', () => {
    expect(key('ArrowUp')).toEqual({ k: 'move', direction: 'N' });
    expect(key('ArrowRight')).toEqual({ k: 'move', direction: 'E' });
    expect(key('ArrowDown')).toEqual({ k: 'move', direction: 'S' });
    expect(key('ArrowLeft')).toEqual({ k: 'move', direction: 'W' });
    // By code, so it works with Num Lock on or off.
    expect(key('9', 'Numpad9')).toEqual({ k: 'move', direction: 'NE' });
    expect(key('PageDown', 'Numpad3')).toEqual({ k: 'move', direction: 'SE' });
    expect(key('1', 'Numpad1')).toEqual({ k: 'move', direction: 'SW' });
    expect(key('Home', 'Numpad7')).toEqual({ k: 'move', direction: 'NW' });
  });

  it('moves diagonally with Home, PageUp, End and PageDown, as MoveAction’s second accelerators do', () => {
    expect(key('Home', 'Home')).toEqual({ k: 'move', direction: 'NW' });
    expect(key('PageUp', 'PageUp')).toEqual({ k: 'move', direction: 'NE' });
    expect(key('End', 'End')).toEqual({ k: 'move', direction: 'SW' });
    expect(key('PageDown', 'PageDown')).toEqual({ k: 'move', direction: 'SE' });
  });

  it('clears the orders with Z and changes with Tab', () => {
    expect(key('z', 'KeyZ')).toEqual({ k: 'clearOrders' });
    expect(key('Z', 'KeyZ')).toEqual({ k: 'clearOrders' });
    expect(key('Tab', 'Tab')).toEqual({ k: 'change' });
  });

  it('selects the next unit, builds a colony and ends the turn', () => {
    expect(key('w', 'KeyW')).toEqual({ k: 'nextUnit' });
    expect(key('W', 'KeyW')).toEqual({ k: 'nextUnit' });
    expect(key('b', 'KeyB')).toEqual({ k: 'buildColony' });
    expect(key('Enter', 'Enter')).toEqual({ k: 'endTurn' });
  });

  it('gives the standing orders, with the keys the Swing client binds them to', () => {
    expect(key('f', 'KeyF')).toEqual({ k: 'fortify' });
    expect(key('F', 'KeyF')).toEqual({ k: 'fortify' });
    expect(key('s', 'KeyS')).toEqual({ k: 'sentry' });
    expect(key('S', 'KeyS')).toEqual({ k: 'sentry' });
    // Space skips the unit, as SkipUnitAction does; the next unit waits
    // for W, as WaitAction does.
    expect(key(' ', 'Space')).toEqual({ k: 'skip' });
    expect(key('d', 'KeyD')).toEqual({ k: 'disband' });
    expect(key('D', 'KeyD')).toEqual({ k: 'disband' });
    expect(key('u', 'KeyU')).toEqual({ k: 'unload' });
    expect(key('U', 'KeyU')).toEqual({ k: 'unload' });
    expect(key('p', 'KeyP')).toEqual({ k: 'plow' });
    expect(key('P', 'KeyP')).toEqual({ k: 'plow' });
    expect(key('c', 'KeyC')).toEqual({ k: 'clearForest' });
    expect(key('C', 'KeyC')).toEqual({ k: 'clearForest' });
    expect(key('r', 'KeyR')).toEqual({ k: 'road' });
    expect(key('R', 'KeyR')).toEqual({ k: 'road' });
  });

  it('asks where the active unit goes, as GotoAction does', () => {
    expect(key('h', 'KeyH')).toEqual({ k: 'selectDestination' });
    expect(key('H', 'KeyH')).toEqual({ k: 'selectDestination' });
  });

  it('opens the trade routes for the carrier, as AssignTradeRouteAction does, only when it is offered', () => {
    expect(key('a', 'KeyA', ['assignRoute'])).toEqual({ k: 'assignRoute' });
    expect(key('A', 'KeyA', ['assignRoute'])).toEqual({ k: 'assignRoute' });
    expect(key('a', 'KeyA', ['goto'])).toBeNull();
  });

  it('shows Europe, as EuropeAction does', () => {
    expect(key('e', 'KeyE')).toEqual({ k: 'showEurope' });
    expect(key('E', 'KeyE')).toEqual({ k: 'showEurope' });
  });

  it('gives an order only when the Engine offers it, as a disabled Swing action ignores its key', () => {
    // A unit with no moves left cannot found a colony, so B does nothing.
    expect(key('b', 'KeyB', ['sentry', 'skip'])).toBeNull();
    expect(key('f', 'KeyF', ['sentry', 'skip'])).toBeNull();
    expect(key('h', 'KeyH', ['sentry', 'skip'])).toBeNull();
    expect(key('s', 'KeyS', ['sentry', 'skip'])).toEqual({ k: 'sentry' });
    // Keys that are no unit's order work with no active unit at all.
    expect(key('ArrowUp', '', [])).toEqual({ k: 'move', direction: 'N' });
    expect(key('Enter', 'Enter', [])).toEqual({ k: 'endTurn' });
    expect(key('e', 'KeyE', [])).toEqual({ k: 'showEurope' });
  });

  it('ignores other keys', () => {
    // G is the held Go To of pointer.ts, not a command.
    expect(key('g', 'KeyG')).toBeNull();
    expect(key('x', 'KeyX')).toBeNull();
    expect(key('5', 'Numpad5')).toBeNull();
  });
});
