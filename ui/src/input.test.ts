import { describe, expect, it } from 'vite-plus/test';
import { commandForKey } from './input';

const key = (key: string, code = '') => commandForKey({ key, code });

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

  it('shows Europe, as EuropeAction does', () => {
    expect(key('e', 'KeyE')).toEqual({ k: 'showEurope' });
    expect(key('E', 'KeyE')).toEqual({ k: 'showEurope' });
  });

  it('ignores other keys', () => {
    // G is the held Go To of pointer.ts, not a command.
    expect(key('g', 'KeyG')).toBeNull();
    expect(key('x', 'KeyX')).toBeNull();
    expect(key('5', 'Numpad5')).toBeNull();
  });
});
