// FreeCol's right-click menus (TilePopup, QuickActionMenu) in the Browser UI.
// The Engine builds a menu's entries (Menus.java) and runs the one picked by
// its id; this file draws a menu where the pointer was, closes it on Escape,
// on a press elsewhere and once an entry has run, and gives the colony
// panel's colonists and goods a right-click that opens theirs.
import { flag } from './flag';
import { focusFirstEntry, menuArrows, useFocusTrap } from './focus';
import { useEscape, type Art } from './frame';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useCoverage } from './coverage';
import { fromTouch, holdProps, type HoldProps } from './long-press';
import './popup-menu.css';

/** One entry: its id (the Engine runs it), its label, and how it is drawn (Menus.java). */
export interface MenuEntry {
  id: string;
  label: string;
  enabled: boolean;
  /** A line above the entry. */
  gap?: boolean;
  /** Set under the entry above, as a ship's cargo is. */
  indent?: boolean;
  /** A resource key for an icon drawn before the label, as a work entry's goods. */
  icon?: string;
  /** Resource keys, best first, for an icon that has several (a unit's image). */
  icons?: string[];
}

/** The entries a shift-click asks an amount for: load onto, unload and the market's load onto (Commands.menuEntry). */
const ASKS = /^(load|unload|buy|sell):/;

/** A menu as the Engine sends it. */
export interface MenuData {
  title: string;
  /** A line over the entries, which a long-press gives the tooltip's text of what was held. */
  heading?: string;
  entries: MenuEntry[];
}

/** A menu open on the page, at the pointer's place in the viewport. */
export interface Popup {
  menu: MenuData;
  x: number;
  y: number;
}

/** Read the Engine's menu JSON: "null" (no menu) is null. */
export function parseMenu(json: string): MenuData | null {
  return JSON.parse(json) as MenuData | null;
}

/** Keep a menu of this size, opened at a point, inside the viewport. */
export function clampMenu(at: [number, number], size: [number, number], viewport: [number, number]): [number, number] {
  return [Math.max(0, Math.min(at[0], viewport[0] - size[0])), Math.max(0, Math.min(at[1], viewport[1] - size[1]))];
}

/** The image of an entry's icon, if it has one and the Tileset draws it. */
function icon(art: Art | undefined, e: MenuEntry): string | null {
  const keys = e.icons ?? (e.icon ? [e.icon] : []);
  return art && keys.length > 0 ? art(keys) : null;
}

/**
 * The open menu. A pick closes it, then runs the entry; Escape (before any dialog sees it) and a press
 * anywhere outside close it too.
 */
export function PopupMenu({
  popup,
  run,
  close,
  art,
}: {
  popup: Popup;
  run: (id: string) => void;
  close: () => void;
  art?: Art;
}) {
  useCoverage('showPopupMenu');
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<[number, number]>([popup.x, popup.y]);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setAt(clampMenu([popup.x, popup.y], [r.width, r.height], [innerWidth, innerHeight]));
  }, [popup]);
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node && box.current?.contains(e.target))) closing.current();
    };
    addEventListener('pointerdown', away, { capture: true });
    return () => removeEventListener('pointerdown', away, { capture: true });
  }, []);
  // Escape closes the menu first, and the dialog under it only the next time.
  useEscape(close);
  // The keyboard starts on the first entry; the arrows and Tab go round the entries, not off the page.
  useFocusTrap(box);
  useEffect(() => focusFirstEntry(box.current), [popup]);
  return (
    <div
      className="popup popup-surface"
      role="menu"
      aria-label={popup.menu.title}
      ref={box}
      style={{ left: at[0], top: at[1] }}
      onKeyDown={menuArrows}
    >
      {popup.menu.heading && <div className="heading">{popup.menu.heading}</div>}
      {popup.menu.entries.map((e, i) => (
        <button
          key={i}
          data-flat=""
          role="menuitem"
          data-entry={e.id}
          data-gap={flag(e.gap)}
          data-indent={flag(e.indent)}
          disabled={!e.enabled}
          onClick={(click) => {
            close();
            // A shift-click on a goods entry asks how many (QuickActionMenu's promptForGoods).
            run(click.shiftKey && ASKS.test(e.id) ? `${e.id},ask` : e.id);
          }}
        >
          {icon(art, e) && <img className="icon" src={icon(art, e)!} alt="" />}
          {e.label}
        </button>
      ))}
    </div>
  );
}

/** What the colony panel's right-clicks open: the Engine's menus, and where they show. */
export interface ContextMenus {
  /** The quick action menu of one of our colonists or ships, or null for none. */
  unit(id: string): MenuData | null;
  /** The menu of a tile of the colony's grid, at its map position. */
  colonyTile(x: number, y: number): MenuData | null;
  /** The quick action menu of goods in a colony (by id) or aboard a ship (by id). */
  goods(location: string, type: string, amount: number): MenuData | null;
  show(menu: MenuData, x: number, y: number): void;
}
/** Without it the panel's colonists and goods have no right-click menu. */
export const ContextMenuContext = createContext<ContextMenus | null>(null);

/** What an element spreads to open a menu: on a right-click, and on a touch's long-press (long-press.ts). */
export interface ContextMenuProps extends HoldProps {
  onContextMenu(e: MouseEvent): void;
}

/** The props that open a menu on a right-click or a long-press, or none when the page has no menus to give. */
export function useContextMenu(get: (menus: ContextMenus) => MenuData | null) {
  return contextMenuHandler(useContext(ContextMenuContext), get);
}

/** The same props, for a panel that makes one per item of a list (a hook cannot be called in a loop). */
export function contextMenuHandler(
  menus: ContextMenus | null,
  get: (menus: ContextMenus) => MenuData | null,
): ContextMenuProps | undefined {
  if (!menus) return undefined;
  return {
    ...holdProps(() => ({
      kind: 'menu',
      fire: ({ x, y }, heading) => {
        const menu = get(menus);
        if (menu) menus.show(heading ? { ...menu, heading } : menu, x, y);
      },
    })),
    onContextMenu: (e) => {
      e.preventDefault();
      // A long-press makes a contextmenu event on some browsers: the hold has opened (or will open) the menu.
      if (fromTouch()) return;
      const menu = get(menus);
      if (menu) menus.show(menu, e.clientX, e.clientY);
    },
  };
}
