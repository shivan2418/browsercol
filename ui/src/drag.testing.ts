// The tests' drags: a player's pointer, as events.
import { THRESHOLD, type Keys } from './drag';

/**
 * Drag one element onto another as a player's pointer would, for the tests: press, move far enough onto the
 * place, and let go there. The mouse's own events come after the pointer's, as a browser sends them.
 */
export function dragOnto(from: Element, onto: Element, keys: Partial<Keys> = {}) {
  const fire = (el: Element, type: string, x: number) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, ...keys }));
  fire(from, 'pointerdown', 0);
  fire(from, 'mousedown', 0);
  fire(onto, 'pointermove', 2 * THRESHOLD);
  fire(onto, 'pointerup', 2 * THRESHOLD);
  fire(onto, 'mouseup', 2 * THRESHOLD);
}
