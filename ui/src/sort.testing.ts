// The tests' reordering of a list (sort.ts): jsdom lays nothing out, so the items get boxes of their own.
import { THRESHOLD } from './drag';
import { SLIDE_MS } from './sort';

/** The height the tests give each item of a list, and the space after it. */
export const ROW = 100;

/**
 * Press an item's handle and move the pointer by `rows` items' heights (up when negative), then let go, as a
 * player's pointer would; `before` runs while the item is lifted. The list's items are laid out ROW apart.
 * The caller runs this with fake timers, which it advances past the settling.
 */
export function sortBy(handle: Element, rows: number, before: () => void = () => {}) {
  const items = Array.from(handle.closest('[data-sort]')!.parentElement!.parentElement!.children);
  items.forEach((el, j) => {
    el.getBoundingClientRect = () => ({ top: j * ROW, bottom: j * ROW + ROW - 10, left: 0, right: 100 }) as DOMRect;
  });
  const start = items.findIndex((el) => el.contains(handle)) * ROW + ROW / 2;
  const fire = (el: Element | Window, type: string, y: number) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: y }));
  fire(handle, 'pointerdown', start);
  fire(window, 'pointermove', start + THRESHOLD);
  fire(window, 'pointermove', start + rows * ROW);
  before();
  fire(window, 'pointerup', start + rows * ROW);
  return SLIDE_MS;
}

/**
 * Press a hold-like item of a grid (its own handle, among its parent's children that match `items`) and
 * move the pointer by `steps` items' widths along its row, then let go. The items are laid out in one row,
 * ROW apart; as with sortBy, the caller advances fake timers past the settling.
 */
export function slideBy(handle: Element, items: string, steps: number, before: () => void = () => {}) {
  const row = Array.from(handle.parentElement!.children).filter((el) => el.matches(items));
  row.forEach((el, j) => {
    el.getBoundingClientRect = () => ({ left: j * ROW, right: j * ROW + ROW - 10, top: 0, bottom: 40 }) as DOMRect;
  });
  const start = row.indexOf(handle) * ROW + ROW / 2;
  const fire = (el: Element | Window, type: string, x: number) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20 }));
  fire(handle, 'pointerdown', start);
  fire(window, 'pointermove', start + THRESHOLD);
  fire(window, 'pointermove', start + steps * ROW);
  before();
  fire(window, 'pointerup', start + steps * ROW);
  fire(handle, 'click', start + steps * ROW);
  return SLIDE_MS;
}
