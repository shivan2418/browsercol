// The controls a browser draws itself, from Base UI (docs/adr/0006, #259): their popups render into the
// #overlays layer at the player's UI scale, and Escape closes only the newest thing on screen. The
// wrappers keep the call sites short and the styling in one place (the .ui-* rules in index.html).
// Tooltip and NumberField build on `overlayContainer` and `OVERLAY_POSITIONER` here.
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
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

// --- NumberField ---

type NumberFieldProps = {
  /** The number in the field, or null while it is empty. */
  value: number | null;
  /** Called with each number the field holds as it changes: null when emptied, or a number out of range or not whole when typed. */
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'disabled' | 'className' | 'type'>;

/** Pressing a step button leaves the focus in the field, so Enter after it still answers the dialog. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/**
 * A number field in place of `<input type="number">`: our own ▲/▼ buttons beside it, and the mouse wheel over the
 * focused field steps it. Arrow keys step by `step`, Shift+arrow and Page Up/Down by ten. What is typed is passed on
 * as it is, even out of range (the caller marks or clamps it); only stepping stays within `min` and `max`. A wrapping
 * `<label>` or an `aria-label` names it; other attributes (data-*, title, autoFocus) go on the input.
 */
export function NumberField({ value, onChange, min, max, step = 1, disabled, className, ...rest }: NumberFieldProps) {
  // Base UI steps on the arrows only; Page Up and Page Down step ten at a time, as a browser's spinner does.
  const page = (e: KeyboardEvent<HTMLInputElement>) => {
    rest.onKeyDown?.(e);
    const dir = e.key === 'PageUp' ? 1 : e.key === 'PageDown' ? -1 : 0;
    if (dir === 0 || e.defaultPrevented || disabled || rest.readOnly) return;
    e.preventDefault();
    const next = (value ?? min ?? 0) + dir * 10 * step;
    onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
  };
  return (
    <BaseNumberField.Root
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      allowOutOfRange
      allowWheelScrub
      className={className ? `ui-number ${className}` : 'ui-number'}
    >
      <BaseNumberField.Group className="ui-number-group">
        <BaseNumberField.Input className="ui-number-input" {...rest} onKeyDown={page} />
        <BaseNumberField.Increment
          className="ui-number-step"
          tabIndex={-1}
          onMouseDown={keepFocus}
          aria-label="Increase"
        >
          ▲
        </BaseNumberField.Increment>
        <BaseNumberField.Decrement
          className="ui-number-step"
          tabIndex={-1}
          onMouseDown={keepFocus}
          aria-label="Decrease"
        >
          ▼
        </BaseNumberField.Decrement>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}
