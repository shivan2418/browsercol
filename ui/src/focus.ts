// Keyboard focus that stays on the page. A browser tabs from the page's last
// button out to its own address bar; here Tab wraps round instead: within the
// newest open menu or window while the focus is in it, and over the whole page
// otherwise. With nothing focused Tab is left alone (the map uses it to change
// units). Menus also move their focus with the arrow keys, as Swing's do.
import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const TABBABLE = 'button, [href], input, select, textarea, [tabindex]';

/** The elements of a root Tab stops on, in page order. */
export function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      el.tabIndex >= 0 &&
      !el.closest('[hidden], [inert]') &&
      (el.checkVisibility?.() ?? true),
  );
}

/**
 * Keep a Tab press inside a root that has the focus: when the browser would take the focus out of it, take
 * it round to the root's other end. Whether the key was taken.
 */
export function wrapTab(e: KeyboardEvent, root: Element): boolean {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return false;
  const active = document.activeElement;
  if (!active || active === document.body || !root.contains(active)) return false;
  const all = tabbables(root);
  const onward = e.shiftKey
    ? all.some((el) => el !== active && el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)
    : all.some((el) => el !== active && active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (onward) return false;
  e.preventDefault();
  (e.shiftKey ? all.at(-1) : all[0])?.focus();
  return true;
}

/** The roots that hold Tab, the newest last. */
const traps: (() => HTMLElement | null)[] = [];
let installed = false;

/** Make Tab wrap round the page (and the newest trap) rather than leave it; once is enough. */
export function keepTabOnPage() {
  if (installed) return;
  installed = true;
  addEventListener(
    'keydown',
    (e) => {
      const top = traps.at(-1)?.();
      if (top && top.contains(document.activeElement)) wrapTab(e, top);
      else wrapTab(e, document.body);
    },
    { capture: true },
  );
}

/** While on, Tab inside this element wraps round within it (a menu, a window): the newest one wins. */
export function useFocusTrap(box: RefObject<HTMLElement | null>, on = true) {
  useEffect(() => {
    if (!on) return;
    keepTabOnPage();
    const get = () => box.current;
    traps.push(get);
    return () => void traps.splice(traps.indexOf(get), 1);
  }, [box, on]);
}

/** A menu's entries that can take the focus. */
function entries(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
    (el) => !(el as HTMLButtonElement).disabled,
  );
}

/** Put the focus on a menu's first entry it can take, as a menu opened from the keyboard has. */
export function focusFirstEntry(menu: HTMLElement | null) {
  if (menu) entries(menu)[0]?.focus();
}

/** Up and Down step through a menu's entries, round at the ends; Home and End go to them. */
export function menuArrows(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const all = entries(e.currentTarget);
  if (!all.length) return;
  const at = all.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'ArrowDown'
      ? (at + 1) % all.length
      : e.key === 'ArrowUp'
        ? (at <= 0 ? all.length : at) - 1
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? all.length - 1
            : null;
  if (next === null) return;
  e.preventDefault();
  all[next].focus();
}
