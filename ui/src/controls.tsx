// The controls a browser draws itself, from Base UI (docs/adr/0006, #259): their popups render into the
// #overlays layer at the player's UI scale, and Escape closes only the newest thing on screen. The
// wrappers keep the call sites short and the styling in one place (the .ui-* rules in form-controls.css,
// popup-surface.css and tooltip.css).
// Tooltip and NumberField build on `overlayContainer` and `OVERLAY_POSITIONER` here.
import { clsx } from 'clsx';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import {
  createElement,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { dragging } from './drag';
import { useEscape } from './frame';
import { fromTouch, offerHold, type PointerLike } from './long-press';
import './tooltip.css';
import './form-controls.css';

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
 * goes on the popup inside it instead: give that the `ui-popup` class, which popup-surface.css styles.
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
      <BaseSelect.Trigger className={clsx('ui-select', className)} {...rest}>
        <BaseSelect.Value />
        <BaseSelect.Icon className="ui-select-icon">▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      {open && <EscapeCloses close={() => setOpen(false)} />}
      <BaseSelect.Portal container={overlayContainer()}>
        <BaseSelect.Positioner {...OVERLAY_POSITIONER} alignItemWithTrigger={false} sideOffset={2}>
          <BaseSelect.Popup className="popup-surface ui-popup ui-select-popup">
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

// --- HelpButton ---

/**
 * A small ? button that opens a popover of help beside it: the button again, Escape or a click outside
 * closes it. `label` names the button for a screen reader; other attributes (data-*) go on the button.
 */
export function HelpButton({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & Omit<ComponentProps<'button'>, 'children' | 'aria-label'>) {
  const [open, setOpen] = useState(false);
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger {...rest} type="button" className="ui-help-button" aria-label={label}>
        ?
      </BasePopover.Trigger>
      {open && <EscapeCloses close={() => setOpen(false)} />}
      <BasePopover.Portal container={overlayContainer()}>
        <BasePopover.Positioner {...OVERLAY_POSITIONER} side="bottom" align="start" sideOffset={4} collisionPadding={8}>
          <BasePopover.Popup className="popup-surface ui-popup ui-help-popup">{children}</BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
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
  /** A hint for the pointer over the field and its step buttons, in place of `title`. */
  tip?: string;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'disabled' | 'className' | 'type'>;

/** Pressing a step button leaves the focus in the field, so Enter after it still answers the dialog. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/**
 * A number field in place of `<input type="number">`: our own ▲/▼ buttons beside it, and the mouse wheel over the
 * focused field steps it. Arrow keys step by `step`, Shift+arrow and Page Up/Down by ten. What is typed is passed on
 * as it is, even out of range (the caller marks or clamps it); only stepping stays within `min` and `max`. A wrapping
 * `<label>` or an `aria-label` names it; other attributes (data-*, autoFocus) go on the input.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  className,
  tip,
  ...rest
}: NumberFieldProps) {
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
      className={clsx('ui-number', className)}
    >
      <BaseNumberField.Group className="ui-number-group" render={tip ? <Tip as="div" tip={tip} /> : undefined}>
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

// ---- Tooltips (#260): Base UI's Tooltip in place of the `title` attribute ----------------------------------
// One popup for the whole page: every `Tip` is a detached trigger of the one `TooltipLayer`, so a tooltip
// moves from one element to the next, and what a hint says is data on the trigger (its payload).

/** How long a pointer rests on an element before its hint shows: shorter than the browser's (about a second). */
const TIP_DELAY = 300;

/** The one tooltip: `Tip`s anywhere on the page attach to it. */
const tipHandle = BaseTooltip.createHandle<ReactNode>();

/** Something is open that a hint would only cover: a right-click menu or a drop-down list. */
function menuOpen(): boolean {
  return document.querySelector('[role="menu"], .ui-select-popup') !== null;
}

/**
 * Whether a hint's element sits behind a window opened inside its own window, as the colony panel's octagons
 * are under its open build queue: only the window on top gives hints, as only it takes the pointer in Swing.
 * A window over another is in its own modal layer, whose backdrop already keeps the pointer from the one below.
 */
export function behindTopWindow(el: Element | null | undefined): boolean {
  // The innermost window holding the element: any window open inside it is over the element.
  const own = el?.closest('[role=dialog]');
  // A window closing (inert, as WindowFrame makes it while it fades) is over nothing.
  return own?.querySelector('[role=dialog]:not([inert])') != null;
}

/**
 * Wrap a React root whose elements use `Tip`: tips under it show the next one at once after one has shown, as
 * Swing's ToolTipManager does. (A group is the provider's: separate roots have separate groups.)
 */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={TIP_DELAY} closeDelay={0} timeout={500}>
      {children}
    </BaseTooltip.Provider>
  );
}

/**
 * The hint's popup, mounted once (inside a `TipProvider`). It does not show while a thing is being dragged
 * nor while a menu is open, and it goes at once when either starts.
 */
export function TooltipLayer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // The drag is the pointer's (drag.ts), not the browser's: its moves are seen before the page's.
    const moved = () => {
      if (dragging()) tipHandle.close();
    };
    const shut = (e: Event) => {
      // A long-press makes a contextmenu event on some browsers, and the hint it opens stays.
      if (fromTouch()) e.preventDefault();
      else tipHandle.close();
    };
    addEventListener('pointermove', moved);
    document.addEventListener('contextmenu', shut, true);
    return () => {
      removeEventListener('pointermove', moved);
      document.removeEventListener('contextmenu', shut, true);
    };
  }, []);
  return (
    <BaseTooltip.Root
      handle={tipHandle}
      disableHoverablePopup
      onOpenChange={(next, details) => {
        const at = details.trigger ?? (details.event?.target instanceof Element ? details.event.target : null);
        if (next && (dragging() || menuOpen() || behindTopWindow(at))) {
          details.cancel();
          return;
        }
        setOpen(next);
      }}
    >
      {({ payload }) => (
        <>
          {open && <EscapeCloses close={() => tipHandle.close()} />}
          <BaseTooltip.Portal container={overlayContainer()}>
            <BaseTooltip.Positioner {...OVERLAY_POSITIONER} sideOffset={6} collisionPadding={4}>
              <BaseTooltip.Popup className="popup-surface ui-popup ui-tip">{payload as ReactNode}</BaseTooltip.Popup>
            </BaseTooltip.Positioner>
          </BaseTooltip.Portal>
        </>
      )}
    </BaseTooltip.Root>
  );
}

type TipTag = 'input' | 'progress' | 'span' | 'div' | 'img' | 'button' | 'li' | 'td' | 'th' | 'section' | 'label';

type TipProps<T extends TipTag> = {
  /** The element to draw. */
  as: T;
  /** What the hint says (a string's lines split with a newline), or what it shows; nothing, and the element has no hint. */
  tip: ReactNode;
  /** The element, as `ref` is on a plain one. */
  ref?: Ref<HTMLElement>;
} & Omit<ComponentProps<T>, 'ref' | 'as'>;

/**
 * An element with a hint, in place of `title`. Give `aria-label` too where the element has no text of its
 * own, as a button with an icon: a hint is for the pointer, a label for a screen reader.
 */
export function Tip<T extends TipTag>({ as, tip, ...rest }: TipProps<T>) {
  const made = useId();
  if (tip === null || tip === undefined || tip === false || tip === '') return createElement(as, rest);
  // `disabled` is the element's: on a trigger it would mean "no tooltip", so it goes on the element it renders.
  const { disabled, ...others } = rest as {
    disabled?: boolean;
    id?: string;
    onPointerDownCapture?: (e: PointerLike & { nativeEvent: object }) => void;
  };
  const id = others.id ?? made;
  // A finger has no hover: a long-press shows the hint (or, where the element has a menu too, heads the menu), and
  // the next press anywhere closes it.
  const hold = (e: PointerLike & { nativeEvent: object }) => {
    others.onPointerDownCapture?.(e);
    offerHold(e, {
      kind: 'tip',
      text: typeof tip === 'string' ? tip : undefined,
      fire: () => {
        tipHandle.open(id);
        addEventListener('pointerdown', () => tipHandle.close(), { capture: true, once: true });
      },
    });
  };
  return (
    <BaseTooltip.Trigger
      handle={tipHandle}
      payload={tip}
      delay={TIP_DELAY}
      render={createElement(as, disabled === undefined ? null : { disabled })}
      {...others}
      id={id}
      // An input keeps its text selection and keyboard; anything else keeps the browser's own long-press off.
      data-hold={as === 'input' ? undefined : ''}
      onPointerDownCapture={hold}
    />
  );
}
