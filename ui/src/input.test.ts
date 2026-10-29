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
    expect(key(' ', 'Space')).toEqual({ k: 'nextUnit' });
    expect(key('b', 'KeyB')).toEqual({ k: 'buildColony' });
    expect(key('Enter', 'Enter')).toEqual({ k: 'endTurn' });
  });

  it('ignores other keys', () => {
    expect(key('x', 'KeyX')).toBeNull();
    expect(key('5', 'Numpad5')).toBeNull();
  });
});
