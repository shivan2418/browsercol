// FreeCol's accelerators for the Game menu and the View menu's full screen (FreeColMessages.properties,
// `*.accelerator`), as a map from a key event to the menu entry it runs. main.tsx runs the entry.

/** The menu entries that have an accelerator the page binds. */
export type Accelerator = 'new' | 'open' | 'save' | 'saveAndExit' | 'quit' | 'preferences' | 'centre' | 'fullScreen';

/** The parts of a KeyboardEvent the mapping reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Ctrl (or Cmd) and a letter, with no other modifier. */
const CTRL_KEYS: Record<string, Accelerator> = {
  n: 'new',
  o: 'open',
  s: 'save',
  x: 'saveAndExit',
  q: 'quit',
  p: 'preferences',
  c: 'centre',
};

/** The entry a key press is the accelerator of, or null for any other key. */
export function acceleratorFor(e: KeyLike): Accelerator | null {
  // changeWindowedModeAction: Alt+Enter. F11 is the browser's own full screen key, which the page takes over.
  if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return 'fullScreen';
  if (e.key === 'F11' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return 'fullScreen';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return CTRL_KEYS[e.key.toLowerCase()] ?? null;
  return null;
}

/** What the player types into: a key pressed there is text, not a shortcut. A number field's input is an `input`; its step buttons count too. */
export const TEXT_ENTRY = 'input, textarea, select, [role="combobox"], [contenteditable], .ui-number-step';

/** Whether a key press belongs to a text field: there it types (and Ctrl+X cuts, Ctrl+C copies), so no game key runs. */
export function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(TEXT_ENTRY);
}
