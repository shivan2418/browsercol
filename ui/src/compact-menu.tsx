// The menu bar on a small screen (docs/adr/0012): the menus fold into one ☰ button, top left, with the status line
// beside it. It opens the same menus as the wide bar (frame.tsx gives them) as one list: a menu's name opens its entries
// under it, and a submenu opens under its entry. Escape, a tap elsewhere and the arrow keys work as in the wide bar.
import { Fragment, useEffect, useRef, useState } from 'react';
import { inTextField } from './accelerators';
import { focusFirstEntry, menuArrows, useFocusTrap } from './focus';
import type { MenuBarProps, MenuItem } from './frame';

export function CompactMenuBar({ menus, status, trailing }: MenuBarProps) {
  const [open, setOpen] = useState(false);
  /** The menu whose entries are shown, and the submenu inside it, by label. */
  const [group, setGroup] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useFocusTrap(list, open);
  useEffect(() => focusFirstEntry(list.current), [open]);
  const close = () => {
    setOpen(false);
    setGroup(null);
    setSub(null);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node && bar.current?.contains(e.target))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    addEventListener('pointerdown', away, { capture: true });
    addEventListener('keydown', onKey, { capture: true });
    return () => {
      removeEventListener('pointerdown', away, { capture: true });
      removeEventListener('keydown', onKey, { capture: true });
    };
  }, [open]);
  // Alt with a menu's first letter opens the list at that menu, as the wide bar's mnemonics do.
  const names = menus.filter((m) => m.items.length > 0).map((m) => m.name);
  const mnemonic = useRef(names);
  mnemonic.current = names;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || inTextField(e.target)) return;
      const name = mnemonic.current.find((n) => e.code === `Key${n[0].toUpperCase()}`);
      if (!name) return;
      e.preventDefault();
      setSub(null);
      setOpen(true);
      setGroup((now) => (now === name ? null : name));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const entry = (e: MenuItem, deep: boolean) => (
    <button
      data-flat=""
      role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className={deep ? 'nested deep' : 'nested'}
      key={e.label}
      disabled={e.disabled}
      aria-checked={e.checked}
      aria-haspopup={e.sub ? 'menu' : undefined}
      aria-expanded={e.sub ? sub === e.label : undefined}
      onClick={() => {
        if (e.sub) return setSub(sub === e.label ? null : e.label);
        close();
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
    <nav className="menubar compact" ref={bar}>
      <button
        type="button"
        className="menu-toggle"
        data-flat=""
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ☰
      </button>
      <span id="statusLine" className="status">
        {status}
      </span>
      {trailing}
      {open && (
        <div className="popup-surface" role="menu" aria-label="Menu" ref={list} onKeyDown={menuArrows}>
          {menus
            .filter((m) => m.items.length > 0)
            .map((m) => (
              <Fragment key={m.name}>
                <button
                  data-flat=""
                  role="menuitem"
                  className="group"
                  aria-haspopup="menu"
                  aria-expanded={group === m.name}
                  onClick={() => {
                    setSub(null);
                    setGroup(group === m.name ? null : m.name);
                  }}
                >
                  {m.name}
                  <span className="hint">{group === m.name ? '▾' : '▸'}</span>
                </button>
                {group === m.name &&
                  m.items.map((item) => (
                    <Fragment key={item.label}>
                      {entry(item, false)}
                      {item.sub && sub === item.label && item.sub.map((e) => entry(e, true))}
                    </Fragment>
                  ))}
              </Fragment>
            ))}
        </div>
      )}
    </nav>
  );
}
