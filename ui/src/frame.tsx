// The Browser UI's shared pieces, from look E (docs/adr/0004, #48): the
// window frame every panel and dialog sits in, the boxed section with a
// caption (FreeCol's titled borders), a goods amount with its icon, and the
// menu bar over the map with the status line. Panels build on these rather
// than on markup of their own. Their colours come from the tokens in
// theme.css, through the classes index.html styles.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/** The URL of the art for the first of some resource keys the Tileset has, or null if it has none (yet). */
export type Art = (keys: readonly string[]) => string | null;

/** The frames on screen, the newest last: Escape closes only the newest. */
const frames: object[] = [];

type FrameProps = {
  /** The panel's name, in the title bar; null for none. */
  title: string | null;
  /** What the close button and Escape do; null for a window that cannot be closed (Escape then does nothing). */
  close: (() => void) | null;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'>;

/**
 * Close the newest thing on screen that takes Escape (a window, a right-click menu) with Escape, before
 * anything else on the page sees the key; the others under it wait. Null: Escape does nothing here, and
 * is kept from what is under it.
 */
export function useEscape(close: (() => void) | null) {
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    const me = {};
    frames.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || frames.at(-1) !== me) return;
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

/**
 * A window: a title bar in the menu bar's colours, with the panel's name and
 * a close button, over the panel's body. Escape closes it too, before
 * anything else on the page sees the key.
 */
export function WindowFrame({ title, close, children, className, ...rest }: FrameProps) {
  useEscape(close);
  const titleId = useId();
  const [shift, setShift] = useState({ x: 0, y: 0 });
  // Drag the window by its title bar (not by the close button).
  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
    const bar = e.currentTarget;
    const from = { x: e.clientX - shift.x, y: e.clientY - shift.y };
    bar.setPointerCapture?.(e.pointerId);
    const move = (m: globalThis.PointerEvent) => setShift({ x: m.clientX - from.x, y: m.clientY - from.y });
    const up = () => {
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
      role="dialog"
      aria-labelledby={title ? titleId : undefined}
      className={className ? `frame ${className}` : 'frame'}
      {...rest}
      style={{ ...rest.style, transform: shift.x || shift.y ? `translate(${shift.x}px, ${shift.y}px)` : undefined }}
    >
      <div className="title" onPointerDown={drag} style={{ cursor: 'move', touchAction: 'none' }}>
        {title && <h2 id={titleId}>{title}</h2>}
        {close && (
          <button className="close" aria-label="Close" title="Close (Esc)" onClick={close}>
            ✕
          </button>
        )}
      </div>
      <div className="body">{children}</div>
    </section>
  );
}

/** A box with a small caption at its top-left, like FreeCol's titled borders ("In port", "Cargo"). */
export function Box({
  caption,
  children,
  className,
  ...rest
}: { caption: string; children?: ReactNode } & Omit<HTMLAttributes<HTMLElement>, 'children'>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className ? `box ${className}` : 'box'} {...rest}>
      <span className="cap" id={id}>
        {caption}
      </span>
      {children}
    </section>
  );
}

/**
 * A goods icon, the first of its resource keys the Tileset has, and a number. A change (net
 * production, say) is signed: a gain shows in --good, a loss in --bad. A
 * zero is greyed out. With no art for the key, the goods' name stands in
 * for the icon.
 */
export function GoodsAmount({
  keys,
  name,
  amount,
  change = false,
  expert = null,
  art,
  icons = false,
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
   * number only for a loss, for more than 7, or when `expert` says more is possible.
   */
  icons?: boolean;
}) {
  const src = art(keys);
  const sign = amount === 0 ? 'zero' : !change ? undefined : amount > 0 ? 'gain' : 'loss';
  const text = amount < 0 ? `−${-amount}` : change && amount > 0 ? `+${amount}` : String(amount);
  if (icons) {
    // ProductionLabel: horses stack poorly, so one icon; the icons overlap by the icon's width over their count.
    const max = name === 'Horses' || keys.some((k) => k.endsWith('.horses')) ? 1 : 7;
    const n = Math.max(1, Math.min(Math.abs(amount), max));
    const step = 24 / (Math.abs(amount) <= max ? Math.max(1, Math.abs(amount)) : 16);
    const number = amount < 0 || amount > max || (expert !== null && expert > amount);
    return (
      <span className="goods" data-sign={sign} title={name}>
        <span className="pile" style={{ width: step * (n - 1) + 24 }}>
          {Array.from({ length: n }, (_, i) =>
            src === null ? (
              i === 0 && (
                <span key={i} className="name">
                  {name}
                </span>
              )
            ) : (
              <img key={i} src={src} alt={i === 0 ? name : ''} style={{ left: step * i }} />
            ),
          )}
        </span>
        {number && <span className="amount">{expert !== null && expert > amount ? `${text}/${expert}` : text}</span>}
      </span>
    );
  }
  return (
    <span className="goods" data-sign={sign} title={name}>
      {src === null ? <span className="name">{name}</span> : <img src={src} alt={name} />}
      <span className="amount">{expert !== null && expert > amount ? `${text}/${expert}` : text}</span>
    </span>
  );
}

/** A menu of the menu bar: its name and its entries, which may be none yet. */
export interface Menu {
  name: string;
  items: {
    label: string;
    run: () => void;
    disabled?: boolean;
    /** A switch, shown ticked when on. */ checked?: boolean;
    /** Its hotkey, as shown beside it. */ hint?: string;
  }[];
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
  const bar = useRef<HTMLElement>(null);
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
  return (
    <nav className="menubar" ref={bar}>
      <div role="menubar">
        {menus.map((m) => (
          <div className="menu" key={m.name}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === m.name}
              onClick={() => setOpen(open === m.name || m.items.length === 0 ? null : m.name)}
            >
              {m.name}
            </button>
            {open === m.name && (
              <div role="menu" aria-label={m.name}>
                {m.items.map((item) => (
                  <button
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    key={item.label}
                    disabled={item.disabled}
                    aria-checked={item.checked}
                    onClick={() => {
                      setOpen(null);
                      item.run();
                    }}
                  >
                    {item.checked !== undefined && <span className="tick">{item.checked ? '✓' : ''}</span>}
                    {item.label}
                    {item.hint && <kbd className="hint">{item.hint}</kbd>}
                  </button>
                ))}
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
