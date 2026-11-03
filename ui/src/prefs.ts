// The player's preferences (the Game menu's Preferences): how fast units slide
// and the active unit blinks. Kept in this browser's localStorage.

/** A speed the player picks; each preference maps it to a duration. */
export type Speed = 'off' | 'slow' | 'normal' | 'fast';
export const SPEEDS: readonly Speed[] = ['off', 'slow', 'normal', 'fast'];

/**
 * How the active unit shows: FreeCol's own, a blinking cursor (the green chevron) over a steady unit, or
 * FreeCol Online's, the whole unit blinking, Civilization I style, with no chevron.
 */
export type ActiveStyle = 'freecol' | 'online';
export const ACTIVE_STYLES: readonly ActiveStyle[] = ['freecol', 'online'];

export interface Prefs {
  /** What blinks for the active unit; the blink speed applies to either. */
  activeStyle: ActiveStyle;
  /** How fast a unit slides to its new tile. */
  animation: Speed;
  /** How fast the active unit blinks. */
  blink: Speed;
  /** Whether a faint grey wash covers the window while it lacks keyboard focus. */
  dimUnfocused: boolean;
  /** Whether the tutorial messages (hints such as how to build a colony) are shown. */
  tutorial: boolean;
}

export const DEFAULTS: Prefs = { activeStyle: 'online', animation: 'normal', blink: 'normal', dimUnfocused: true, tutorial: true };

/** A slide's length in milliseconds; 0 moves the unit at once. */
const MOVE: Record<Speed, number> = { off: 0, slow: 600, normal: 300, fast: 150 };
/** A whole blink cycle in milliseconds; 0 never blinks. */
const BLINK: Record<Speed, number> = { off: 0, slow: 2400, normal: 1400, fast: 700 };

export const moveMs = (p: Prefs): number => MOVE[p.animation];
export const blinkMs = (p: Prefs): number => BLINK[p.blink];

/** The messages the player sees: tutorial ones are dropped when the tutorial option is off. */
export function visibleMessages<T extends { type: string }>(p: Prefs, messages: T[]): T[] {
  return p.tutorial ? messages : messages.filter((m) => m.type.toUpperCase() !== 'TUTORIAL');
}

const KEY = 'freecol.prefs';

const speed = (v: unknown, fallback: Speed): Speed => (SPEEDS.includes(v as Speed) ? (v as Speed) : fallback);

/** Parse stored text; anything missing or odd falls back to the defaults. */
export function parsePrefs(text: string | null): Prefs {
  try {
    const o = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    return {
      activeStyle: ACTIVE_STYLES.includes(o.activeStyle as ActiveStyle)
        ? (o.activeStyle as ActiveStyle)
        : DEFAULTS.activeStyle,
      animation: speed(o.animation, DEFAULTS.animation),
      blink: speed(o.blink, DEFAULTS.blink),
      dimUnfocused: typeof o.dimUnfocused === 'boolean' ? o.dimUnfocused : DEFAULTS.dimUnfocused,
      tutorial: typeof o.tutorial === 'boolean' ? o.tutorial : DEFAULTS.tutorial,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage may be blocked; the preferences then last until the page closes.
  }
}
