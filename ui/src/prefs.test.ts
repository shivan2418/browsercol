import { describe, expect, it } from 'vitest';
import { blinkMs, DEFAULTS, moveMs, parsePrefs, visibleMessages } from './prefs';
import { blink } from './motion';

describe('prefs', () => {
  it('falls back to the defaults on missing or odd text', () => {
    expect(parsePrefs(null)).toEqual(DEFAULTS);
    expect(parsePrefs('nonsense')).toEqual(DEFAULTS);
    expect(parsePrefs('{"animation":"warp","blink":"slow","activeStyle":"x"}')).toEqual({
      ...DEFAULTS,
      blink: 'slow',
    });
    expect(parsePrefs('{"activeStyle":"freecol"}').activeStyle).toBe('freecol');
  });

  it('reads the grey-out option, on unless stored off', () => {
    expect(parsePrefs(null).dimUnfocused).toBe(true);
    expect(parsePrefs('{"dimUnfocused":false}').dimUnfocused).toBe(false);
    expect(parsePrefs('{"dimUnfocused":"no"}').dimUnfocused).toBe(true);
  });

  it('drops tutorial messages unless the option is on', () => {
    const ms = [{ type: 'TUTORIAL' }, { type: 'WARNING' }];
    expect(visibleMessages(DEFAULTS, ms)).toHaveLength(2);
    expect(visibleMessages({ ...DEFAULTS, tutorial: false }, ms)).toEqual([{ type: 'WARNING' }]);
    expect(parsePrefs('{"tutorial":false}').tutorial).toBe(false);
  });

  it('maps speeds to durations, with off as 0', () => {
    expect(moveMs({ ...DEFAULTS, animation: 'off', blink: 'off' })).toBe(0);
    expect(moveMs({ ...DEFAULTS, animation: 'fast', blink: 'off' })).toBeLessThan(moveMs(DEFAULTS));
    expect(blinkMs({ ...DEFAULTS, animation: 'off', blink: 'slow' })).toBeGreaterThan(blinkMs(DEFAULTS));
  });

  it('never dims the unit when blinking is off', () => {
    expect(blink(1000, 0)).toBe(1);
  });
});
