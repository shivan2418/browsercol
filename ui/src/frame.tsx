// The Browser UI's shared pieces, from look E (docs/adr/0004, #48): the
// window frame every panel and dialog sits in, the boxed section with a
// caption (FreeCol's titled borders), a goods amount with its icon, and the
// menu bar over the map with the status line. Panels build on these rather
// than on markup of their own. Their colours come from the tokens in
// theme.css; the window's, the box's and the goods' styles are beside them, in
// window-frame.css, box.css, goods.css, popup-surface.css and quiet-text.css (docs/adr/0008), the rest still in index.html.
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { inTextField, TEXT_ENTRY } from './accelerators';
import { Tip } from './controls';
import { dragging } from './drag';
import { focusFirstEntry, menuArrows, useFocusTrap } from './focus';
import type { GoodsProgress } from './webgui';
import './window-frame.css';
import './goods.css';
import './box.css';
import './heading.css';
import './popup-surface.css';
import './selection.css';
import './quiet-text.css';

/** The URL of the art for the first of some resource keys the Tileset has, or null if it has none (yet). */
export type Art = (keys: readonly string[]) => string | null;

/**
 * What a window does as it opens and closes (#270): `motion` says whether to animate, and is off for a player who asks the
 * system for reduced motion, for an automated browser (navigator.webdriver, so the browser scripts never
 * wait on an animation) and where there is no matchMedia (the unit tests).
 */
export const frameEffects: { motion: () => boolean; ms: number } = {
  motion: () =>
    typeof matchMedia === 'function' && !navigator.webdriver && !matchMedia('(prefers-reduced-motion: reduce)').matches,
  /** How long the scale-and-fade lasts; window-frame.css's frame-in and frame-out keyframes say the same. */
  ms: 120,
};

/** The frames on screen, the newest last: Escape closes only the newest. */
const frames: object[] = [];

type FrameProps = {
  /** The panel's name, in the title bar; null for none. */
  title: string | null;
  /** What the close button and Escape do; null for a window that cannot be closed (Escape then does nothing). */
  close: (() => void) | null;
  /** Letter keys that close the window too, as Escape does: E for Europe, the key that opened it. */
  closeKeys?: readonly string[];
  /** Escape asks this first: true if it used the key (clearing a search, say), and the window stays open. */
  onEscape?: () => boolean;
  /** A panel laid out at fixed sizes (the colony's): its UI scale is lowered until the whole of it fits the screen. */
  fit?: boolean;
  /**
   * The advisor's painted paper (FreeCol's InformationPanel) as the window's whole background: its image, and how
   * far down the painted figure reaches, where the text starts. Such a window is fitted to the screen too.
   */
  advisor?: { src: string; top: number } | null;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'>;

/**
 * Close the newest thing on screen that takes Escape (a window, a right-click menu) with Escape, before
 * anything else on the page sees the key; the others under it wait. Null: Escape does nothing here, and
 * is kept from what is under it. `keys` (letters, either case) close it as Escape does, but not while the
 * player types in a field or holds a modifier.
 */
export function useEscape(close: (() => void) | null, keys: readonly string[] = []) {
  const closing = useRef(close);
  closing.current = close;
  const closeKeys = useRef(keys);
  closeKeys.current = keys;
  useEffect(() => {
    const me = {};
    frames.push(me);
    const onKey = (e: KeyboardEvent) => {
      // Escape during a drag puts the thing back (drag.ts), and closes nothing.
      if (dragging()) return;
      if (frames.at(-1) !== me || !(e.key === 'Escape' || isCloseKey(e, closeKeys.current))) return;
      e.preventDefault();
      e.stopPropagation();
      closing.current?.();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => {
      frames.splice(frames.indexOf(me), 1);
      removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);
}

/** What the player types into (accelerators.ts). */
export { TEXT_ENTRY } from './accelerators';

/** Whether a key press is one of a window's close keys: no modifier, and not typed into a field. */
function isCloseKey(e: KeyboardEvent, keys: readonly string[]): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.matches(TEXT_ENTRY)) return false;
  return keys.some((k) => k.toLowerCase() === e.key.toLowerCase());
}

/** The share of the screen a fitted window may take each way, leaving a margin round it. */
const FIT_SHARE = 0.96;

/**
 * The scale a window laid out at fixed sizes is drawn at (#380, #377): the player's UI scale, or less, so the
 * whole of it lies on the screen. Cut off, such a panel loses a row (the colony's warehouse); scaled down, it
 * keeps its layout. The window's own size (offsetWidth and offsetHeight, which are in its own pixels whatever
 * its zoom) is what it measures, so the scale settles at once. Null where the window has no layout (jsdom).
 */
export function fitScale(size: { w: number; h: number }, screen: { w: number; h: number }, ui: number): number | null {
  if (!size.w || !size.h) return null;
  const fit = Math.min(ui, (screen.w * FIT_SHARE) / size.w, (screen.h * FIT_SHARE) / size.h);
  // Rounded down, so the window never comes out a pixel too big.
  return Math.floor(fit * 1000) / 1000;
}

/** Keep a fitted window's scale (--fit, which index.html's .modal > [data-fit] zooms by) as the screen, the UI scale and the window change. */
function useFitToScreen(box: { current: HTMLElement | null }, fit: boolean) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!fit || !el) return;
    const apply = () => {
      const ui = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
      const root = document.documentElement;
      const scale = fitScale(
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: root.clientWidth, h: root.clientHeight },
        ui,
      );
      if (scale !== null) el.style.setProperty('--fit', String(scale));
    };
    apply();
    addEventListener('resize', apply);
    // The UI scale and the font size, which sets a fixed-size window's own size, are set on the root's style
    // (main.tsx). (A ResizeObserver on the window would see its own change of scale, and loop.)
    const scaled = new MutationObserver(apply);
    scaled.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      removeEventListener('resize', apply);
      scaled.disconnect();
    };
  }, [box, fit]);
}

/**
 * FreeCol's remember panel positions option: when on, a window dragged somewhere opens there again, by its
 * id or its kind (Canvas's saved positions). The page sets `remember` from the Preferences, and keeps the
 * places in `places`.
 */
export const framePlaces: {
  remember: boolean;
  places: Record<string, { x: number; y: number }>;
  /** The places changed: keep them. */
  saved: () => void;
} = { remember: false, places: {}, saved: () => {} };

/**
 * A window: a title bar in the menu bar's colours, with the panel's name and
 * a close button, over the panel's body. Escape closes it too, before
 * anything else on the page sees the key.
 */
export function WindowFrame({
  title,
  close: closeNow,
  closeKeys,
  onEscape,
  fit = false,
  advisor = null,
  children,
  className,
  ...rest
}: FrameProps) {
  // The window fades out before it closes, unless it is not to animate; a second close meanwhile does nothing.
  const [motion] = useState(() => frameEffects.motion());
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = closeNow
    ? () => {
        if (!motion) return closeNow();
        if (timer.current) return;
        setClosing(true);
        timer.current = setTimeout(closeNow, frameEffects.ms);
      }
    : null;
  useEscape(
    close &&
      (() => {
        if (!onEscape?.()) close();
      }),
    closeKeys,
  );
  const box = useRef<HTMLElement>(null);
  // Tab goes round the newest window's buttons and fields while the focus is in it, not off the page.
  useFocusTrap(box);
  useFitToScreen(box, fit || advisor !== null);
  const titleId = useId();
  const attrs = rest as Record<string, unknown>;
  const placeKey =
    typeof rest.id === 'string' ? rest.id : typeof attrs['data-kind'] === 'string' ? attrs['data-kind'] : null;
  const [shift, setShift] = useState(
    () => (framePlaces.remember && placeKey && framePlaces.places[placeKey]) || { x: 0, y: 0 },
  );
  // Drag the window by its title bar (not by the close button).
  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
    const bar = e.currentTarget;
    const from = { x: e.clientX - shift.x, y: e.clientY - shift.y };
    bar.setPointerCapture?.(e.pointerId);
    const move = (m: globalThis.PointerEvent) => setShift({ x: m.clientX - from.x, y: m.clientY - from.y });
    const up = (u: globalThis.PointerEvent) => {
      if (framePlaces.remember && placeKey) {
        framePlaces.places[placeKey] = { x: u.clientX - from.x, y: u.clientY - from.y };
        framePlaces.saved();
      }
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };
  return (
    <section
      ref={box}
      role="dialog"
      aria-labelledby={title ? titleId : undefined}
      className={className ? `frame ${className}` : 'frame'}
      {...rest}
      data-fit={fit || advisor !== null || undefined}
      data-advised={advisor !== null || undefined}
      data-motion={motion ? (closing ? 'out' : 'in') : undefined}
      inert={closing || undefined}
      style={{
        ...rest.style,
        ...(advisor &&
          ({ '--advisor': `url("${advisor.src}")`, '--advisor-top': `${advisor.top}px` } as CSSProperties)),
        transform: shift.x || shift.y ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
      }}
    >
      <div className="title" onPointerDown={drag} style={{ cursor: 'move', touchAction: 'none' }}>
        {title && <h2 id={titleId}>{title}</h2>}
        {close && (
          <Tip as="button" className="close" aria-label="Close" tip="Close (Esc)" onClick={close}>
            ✕
          </Tip>
        )}
      </div>
      <div className="body">{children}</div>
    </section>
  );
}

/**
 * A boxed section, the one way the panels draw one. Its caption (FreeCol's titled borders: "In port", "Cargo") is the
 * box's first row, so a caption that wraps pushes the content down; a part FreeCol gives no caption takes none. `as`
 * is the element, a `section` unless it is a `div`; `tip` is a hint on the box. Its variants are props: `roomy`
 * keeps an empty list's height, `spaced` puts the room of a stacked box round it (`wide`: under it only).
 */
export function Box({
  caption,
  as = 'section',
  tip,
  roomy,
  spaced,
  children,
  className,
  ...rest
}: {
  caption?: string;
  as?: 'section' | 'div';
  tip?: string;
  roomy?: boolean;
  spaced?: 'normal' | 'wide';
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'children'>) {
  const id = useId();
  return (
    <Tip
      as={as}
      tip={tip}
      aria-labelledby={caption === undefined ? undefined : id}
      className={className ? `box ${className}` : 'box'}
      data-roomy={roomy ? '' : undefined}
      data-spaced={spaced}
      {...rest}
    >
      {caption !== undefined && (
        <span className="cap" id={id}>
          {caption}
        </span>
      )}
      {children}
    </Tip>
  );
}

/**
 * A heading inside a window: an h2 (a part's title) or an h3 (a section's), in the heading colour. Its variants are
 * props: `look` (`title`: the title font and the larger size; `headline`: the centred line over a question) and
 * `space`, the room round it (`flush`, `tight`, `low`, `window`, `section`), never a panel's selector.
 */
export function Heading({
  level = 3,
  look,
  space,
  className,
  ...rest
}: {
  level?: 2 | 3;
  look?: 'title' | 'headline';
  space?: 'flush' | 'tight' | 'low' | 'window' | 'section';
} & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag className={className ? `heading ${className}` : 'heading'} data-look={look} data-space={space} {...rest} />
  );
}

/**
 * A goods icon, the first of its resource keys the Tileset has, and a number. A change (net
 * production, say) is signed: a gain shows in --good, a loss in --bad. A
 * zero is greyed out. With no art for the key, the goods' name stands in
 * for the icon.
 */
/**
 * FreeCol's goods images options, as ProductionLabel reads them: the most icons drawn for an amount
 * (guiMaxNumberOfGoodsImages), and the amount from which the number shows too
 * (guiMinNumberToDisplayGoodsCount). The page sets them from the Preferences.
 */
export const goodsIcons = { max: 7, countFrom: 7 };

/**
 * FreeColProgressBar: a bar the height of its goods icon. What is there shades it dark, what comes next turn after
 * that a lighter shade, cut off at the end (a loss draws none); the icon and "18+6/40 (Turns: 4)" sit over it.
 */
export function GoodsProgressBar({ need, art }: { need: GoodsProgress; art: Art }) {
  const { available: have, produced: step, needed: max } = need;
  const width = (n: number) => (max > 0 ? Math.min(100, Math.max(0, (100 * n) / max)) : 100);
  const now = have >= max ? 100 : width(have);
  const next = Math.min(100 - now, width(step));
  const src = art(need.keys);
  return (
    <Tip as="span" className="need" data-goods={need.type} tip={need.name}>
      <i className="now" style={{ width: `${now}%` }} />
      {next > 0 && <i className="next" style={{ left: `${now}%`, width: `${next}%` }} />}
      {src !== null && <img className="icon" src={src} alt="" />}
      <span>{`${have}${step < 0 ? '-' : '+'}${Math.abs(step)}/${max} ${need.turns}`}</span>
    </Tip>
  );
}

export function GoodsAmount({
  keys,
  name,
  amount,
  change = false,
  expert = null,
  art,
  icons = false,
  stock = null,
  tip = name,
}: {
  /** The goods icon's resource keys, best first (image.icon.model.goods.<id>, say). */
  keys: readonly string[];
  /** The goods type's name, for the icon's alt text and tooltip. */
  name: string;
  amount: number;
  change?: boolean;
  /** What an expert would make, shown after a slash when it is more than the amount. */
  expert?: number | null;
  art: Art;
  /**
   * Draw it as FreeCol's ProductionLabel does: an icon for each of the amount (up to 7, overlapping), the
   * number centred over them (white, red for a loss, never a +) only for a loss, for more than 7, or when
   * `expert` says more is possible.
   */
  icons?: boolean;
  /**
   * With icons, what is in store, written first as the colony report's ProductionLabel does: "95+4/7", or
   * "160-40" for a loss; the number then shows whenever there is some in store.
   */
  stock?: number | null;
  /** What the hint says, the goods type's name by default. */
  tip?: string | null;
}) {
  const src = art(keys);
  const sign = amount === 0 ? 'zero' : !change ? undefined : amount > 0 ? 'gain' : 'loss';
  const text = amount < 0 ? `−${-amount}` : change && amount > 0 ? `+${amount}` : String(amount);
  if (icons) {
    // ProductionLabel: horses stack poorly, so one icon; the icons overlap by the icon's width over their count.
    const max = name === 'Horses' || keys.some((k) => k.endsWith('.horses')) ? 1 : goodsIcons.max;
    const n = Math.max(1, Math.min(Math.abs(amount), max));
    const step = 24 / (Math.abs(amount) <= max ? Math.max(1, Math.abs(amount)) : 16);
    // ProductionLabel writes the number over the middle of the pile, with no sign for a gain.
    const count = amount < 0 ? text : String(amount);
    const more = expert !== null && expert > amount && (stock === null || amount > 0);
    const number = amount < 0 || amount >= goodsIcons.countFrom || amount > max || more || (stock ?? 0) > 0;
    const label =
      stock === null
        ? more
          ? `${count}/${expert}`
          : count
        : `${stock}${amount < 0 ? '-' : '+'}${Math.abs(amount)}${more ? `/${expert}` : ''}`;
    return (
      <Tip as="span" className="goods" data-sign={sign} tip={tip}>
        {/* ProductionLabel: as wide as the wider of its icons and its number, both centred. */}
        <span className="pile" style={{ minWidth: step * (n - 1) + 24 }}>
          {Array.from({ length: n }, (_, i) =>
            src === null ? (
              i === 0 && (
                <span key={i} className="name">
                  {name}
                </span>
              )
            ) : (
              <img
                key={i}
                src={src}
                alt={i === 0 ? name : ''}
                style={{ left: `calc(50% - ${(step * (n - 1) + 24) / 2}px + ${step * i}px)` }}
              />
            ),
          )}
          {number && <span className="amount">{label}</span>}
        </span>
      </Tip>
    );
  }
  return (
    <Tip as="span" className="goods" data-sign={sign} tip={tip}>
      {src === null ? <span className="name">{name}</span> : <img src={src} alt={name} />}
      <span className="amount">{expert !== null && expert > amount ? `${text}/${expert}` : text}</span>
    </Tip>
  );
}

/** A menu of the menu bar: its name and its entries, which may be none yet. */
export interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** A switch, shown ticked when on. */ checked?: boolean;
  /** Its hotkey, as shown beside it. */ hint?: string;
  /** Its entries, if it is a submenu (Swing's JMenu): picking it opens them below it, and `run` is not used. */
  sub?: MenuItem[];
}

export interface Menu {
  name: string;
  items: MenuItem[];
}

/** FreeCol's menus (InGameMenuBar), in its order; menus.ts and reports.tsx give them entries. */
export const MENUS: readonly string[] = ['Game', 'View', 'Orders', 'Report', 'Colopedia'];

/**
 * The bar across the top of the map: the menus on the left and FreeCol's
 * status line (Score ✧ Gold ✧ Tax ✧ Year) on the right. A menu with entries
 * opens on a click and closes on a pick, a click elsewhere or Escape.
 */
export function MenuBar({ menus, status }: { menus: Menu[]; status: string }) {
  const [open, setOpen] = useState<string | null>(null);
  /** The submenu that is opened, by its label. */
  const [sub, setSub] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  // An open menu has the focus on its first entry; the arrows and Tab go round its entries.
  useFocusTrap(dropdown, open !== null);
  useEffect(() => focusFirstEntry(dropdown.current), [open]);
  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node && bar.current?.contains(e.target))) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
    };
    addEventListener('pointerdown', away, { capture: true });
    addEventListener('keydown', onKey, { capture: true });
    return () => {
      removeEventListener('pointerdown', away, { capture: true });
      removeEventListener('keydown', onKey, { capture: true });
    };
  }, [open]);
  // Alt with a menu's first letter opens it, as Swing's mnemonics do (Alt+G for Game); again closes it.
  const names = menus.filter((m) => m.items.length > 0).map((m) => m.name);
  const mnemonic = useRef(names);
  mnemonic.current = names;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || inTextField(e.target)) return;
      const name = mnemonic.current.find((n) => e.code === `Key${n[0].toUpperCase()}`);
      if (!name) return;
      e.preventDefault();
      setOpen((now) => (now === name ? null : name));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <nav className="menubar" ref={bar}>
      <div role="menubar">
        {menus.map((m) => (
          <div className="menu" key={m.name}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === m.name}
              // While a menu is open, pointing at another title opens that one, as a desktop menu bar does.
              onPointerEnter={() => {
                if (open === null || open === m.name || m.items.length === 0) return;
                setSub(null);
                setOpen(m.name);
              }}
              onClick={() => {
                setSub(null);
                setOpen(open === m.name || m.items.length === 0 ? null : m.name);
              }}
            >
              {m.name}
            </button>
            {open === m.name && (
              <div
                className="popup-surface"
                role="menu"
                aria-label={m.name}
                ref={dropdown}
                onKeyDown={(e) => {
                  // Left and Right step to the menu beside, as a desktop menu bar does.
                  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!step || e.altKey || e.ctrlKey || e.metaKey) return menuArrows(e);
                  e.preventDefault();
                  setSub(null);
                  setOpen(names[(names.indexOf(m.name) + step + names.length) % names.length]);
                }}
              >
                {m.items.map((item) => {
                  const entry = (e: MenuItem, nested: boolean) => (
                    <button
                      role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      className={nested ? 'nested' : undefined}
                      key={e.label}
                      disabled={e.disabled}
                      aria-checked={e.checked}
                      aria-haspopup={e.sub ? 'menu' : undefined}
                      aria-expanded={e.sub ? sub === e.label : undefined}
                      onClick={() => {
                        if (e.sub) return setSub(sub === e.label ? null : e.label);
                        setOpen(null);
                        setSub(null);
                        e.run();
                      }}
                    >
                      {e.checked !== undefined && <span className="tick">{e.checked ? '✓' : ''}</span>}
                      {e.label}
                      {e.sub && <span className="hint">▸</span>}
                      {e.hint && <kbd className="hint">{e.hint}</kbd>}
                    </button>
                  );
                  return (
                    <Fragment key={item.label}>
                      {entry(item, false)}
                      {item.sub && sub === item.label && item.sub.map((e) => entry(e, true))}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <span id="statusLine" className="status">
        {status}
      </span>
    </nav>
  );
}
