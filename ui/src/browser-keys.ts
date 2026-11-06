// The browser's own keys and gestures kept out of the game (#263): space and the arrows never scroll,
// Backspace and Alt+Left never go back, `/` and `'` never open Firefox's quick find, and the page zoom
// (Ctrl+plus, Ctrl+minus, Ctrl+0, Ctrl+wheel, a trackpad pinch) steps the player's UI scale in its place.
// Text fields keep every key. One capture-phase listener of each kind, on the page.
import { wheelZoom } from './pointer';

/** Where a key means something to the browser's own widget: a text field, a select, an editable element. */
const TEXT = 'input, textarea, select, [contenteditable]';
/** What Space presses, so the filter leaves Space alone on it. */
const PRESSABLE =
  'button, a[href], summary, [role="button"], [role^="menuitem"], [role="checkbox"], [role="option"], [role="tab"], [role="switch"]';

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

const closest = (target: EventTarget | null, selector: string) =>
  target instanceof Element && !!target.closest(selector);

/** Whether a key press is one the browser would act on with a page behind it, and nothing in the game wants. */
export function isLeftoverKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target'>): boolean {
  if (closest(e.target, TEXT)) return false;
  const bare = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (e.altKey && !e.ctrlKey && !e.metaKey) return e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  if (!bare) return false;
  if (SCROLL_KEYS.has(e.key) || e.key === 'Backspace' || e.key === '/' || e.key === "'") return true;
  return e.key === ' ' && !closest(e.target, PRESSABLE);
}

/** What a page-zoom key asks for: a step in or out, or back to 100%; null for any other key. */
export function zoomKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '+' || e.key === '=') return 1;
  if (e.key === '-' || e.key === '_') return -1;
  if (e.key === '0') return 0;
  return null;
}

/** The UI scale, in percent, after a zoom key's step (+1, -1, or 0 for the reset), within what Preferences allows. */
export function steppedScale(percent: number, step: 1 | -1 | 0): number {
  return step === 0 ? 100 : Math.min(200, Math.max(50, percent + step * 10));
}

/**
 * Keep the browser's keys and page zoom off a page. `scale` takes a zoom step (+1, -1, or 0 to reset);
 * a Ctrl+wheel over `map` is the map's own zoom (pointer.ts), so it only loses the browser's zoom.
 */
export function blockBrowserKeys(page: EventTarget, map: Element, scale: (step: 1 | -1 | 0) => void): void {
  page.addEventListener(
    'keydown',
    (e) => {
      const key = e as KeyboardEvent;
      const zoom = zoomKey(key);
      if (zoom !== null) {
        key.preventDefault();
        if (!key.repeat || zoom !== 0) scale(zoom);
      } else if (isLeftoverKey(key)) key.preventDefault();
    },
    { capture: true },
  );
  let wheel = 0;
  page.addEventListener(
    'wheel',
    (e) => {
      const w = e as WheelEvent;
      // A pinch arrives as Ctrl+wheel.
      if (!w.ctrlKey) return;
      w.preventDefault();
      if (w.target instanceof Node && map.contains(w.target)) return;
      const zoom = wheelZoom(wheel, w);
      wheel = zoom.rest;
      if (zoom.steps) scale(zoom.steps as 1 | -1);
    },
    { capture: true, passive: false },
  );
}
