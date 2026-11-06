// The controls a browser draws itself, from Base UI (docs/adr/0006, #259): their popups render into the
// #overlays layer at the player's UI scale, and Escape closes only the newest thing on screen. The
// wrappers keep the call sites short and the styling in one place (the .ui-* rules in index.html).
// Tooltip and NumberField build on `overlayContainer` and `OVERLAY_POSITIONER` here.
import { Select as BaseSelect } from '@base-ui/react/select';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { useEscape } from './frame';

/**
 * Where Base UI's popups go: the #overlays layer the windows are in, outside the side panel, which may be
 * hidden. Undefined (the page body) where a test or a story has no such layer: Base UI waits for a null
 * container instead of falling back, so never pass null.
 */
export function overlayContainer(): HTMLElement | undefined {
  return document.getElementById('overlays') ?? undefined;
}

/**
 * What a Base UI popup needs to sit right in the overlays, to spread on its Positioner (which only has to
 * stay above the windows). The Positioner is placed in real pixels, so the player's UI scale (`--ui-zoom`)
 * goes on the popup inside it instead: give that the `ui-popup` class, which index.html styles.
 */
export const OVERLAY_POSITIONER = { className: 'ui-positioner' } as const;

/** While mounted, Escape closes this and only this: an open popup is the newest thing on screen. */
export function EscapeCloses({ close }: { close: () => void }) {
  useEscape(close);
  return null;
}

export type SelectChoice = { value: string; label: ReactNode; disabled?: boolean };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  choices: readonly SelectChoice[];
  disabled?: boolean;
  className?: string;
} & Omit<ComponentProps<'button'>, 'value' | 'onChange' | 'children' | 'className' | 'disabled'>;

/**
 * A drop-down list in place of a `<select>`: the value is a string, as a select's is, and `choices` are its
 * options. A wrapping `<label>` or an `aria-label` names it; other attributes (data-*) go on the button.
 */
export function Select({ value, onChange, choices, disabled, className, ...rest }: SelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      items={choices as SelectChoice[]}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <BaseSelect.Trigger className={className ? `ui-select ${className}` : 'ui-select'} {...rest}>
        <BaseSelect.Value />
        <BaseSelect.Icon className="ui-select-icon">▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      {open && <EscapeCloses close={() => setOpen(false)} />}
      <BaseSelect.Portal container={overlayContainer()}>
        <BaseSelect.Positioner {...OVERLAY_POSITIONER} alignItemWithTrigger={false} sideOffset={2}>
          <BaseSelect.Popup className="ui-popup ui-select-popup">
            <BaseSelect.List className="ui-select-list">
              {choices.map((c) => (
                <BaseSelect.Item
                  key={c.value}
                  value={c.value}
                  disabled={c.disabled}
                  className="ui-select-item"
                  data-value={c.value}
                >
                  <BaseSelect.ItemText>{c.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
