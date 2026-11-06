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

/** Whether a key press belongs to a text field, where Ctrl+X cuts and Ctrl+C copies. */
export function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('input, textarea, select, [contenteditable]');
}
