import { describe, expect, it } from 'vitest';
import { blinkMs, DEFAULTS, moveMs, parsePrefs } from './prefs';
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

  it('maps speeds to durations, with off as 0', () => {
    expect(moveMs({ ...DEFAULTS, animation: 'off', blink: 'off' })).toBe(0);
    expect(moveMs({ ...DEFAULTS, animation: 'fast', blink: 'off' })).toBeLessThan(moveMs(DEFAULTS));
    expect(blinkMs({ ...DEFAULTS, animation: 'off', blink: 'slow' })).toBeGreaterThan(blinkMs(DEFAULTS));
  });

  it('never dims the unit when blinking is off', () => {
    expect(blink(1000, 0)).toBe(1);
  });
});
