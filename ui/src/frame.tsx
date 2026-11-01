// The Browser UI's shared pieces, from look E (docs/adr/0004, #48): the
// window frame every panel and dialog sits in, the boxed section with a
// caption (FreeCol's titled borders), a goods amount with its icon, and the
// menu bar over the map with the status line. Panels build on these rather
// than on markup of their own. Their colours come from the tokens in
// theme.css, through the classes index.html styles.
import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

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
 * A window: a title bar in the menu bar's colours, with the panel's name and
 * a close button, over the panel's body. Escape closes it too, before
 * anything else on the page sees the key.
 */
export function WindowFrame({ title, close, children, className, ...rest }: FrameProps) {
  const closing = useRef(close);
  closing.current = close;
  const titleId = useId();
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
  return (
    <section
      role="dialog"
      aria-labelledby={title ? titleId : undefined}
      className={className ? `frame ${className}` : 'frame'}
      {...rest}
    >
      <div className="title">
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
  art,
}: {
  /** The goods icon's resource keys, best first (image.icon.model.goods.<id>, say). */
  keys: readonly string[];
  /** The goods type's name, for the icon's alt text and tooltip. */
  name: string;
  amount: number;
  change?: boolean;
  art: Art;
}) {
  const src = art(keys);
  const sign = amount === 0 ? 'zero' : !change ? undefined : amount > 0 ? 'gain' : 'loss';
  const text = amount < 0 ? `−${-amount}` : change && amount > 0 ? `+${amount}` : String(amount);
  return (
    <span className="goods" data-sign={sign} title={name}>
      {src === null ? <span className="name">{name}</span> : <img src={src} alt={name} />}
      <span className="amount">{text}</span>
    </span>
  );
}

/** A menu of the menu bar: its name and its entries, which may be none yet. */
export interface Menu {
  name: string;
  items: { label: string; run: () => void; disabled?: boolean }[];
}

/** FreeCol's menus (InGameMenuBar), in its order. Later tickets give them entries. */
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
                    role="menuitem"
                    key={item.label}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      item.run();
                    }}
                  >
                    {item.label}
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
