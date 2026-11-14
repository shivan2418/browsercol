// Small screens (docs/adr/0012): when the window's short side is under 600 CSS px, a phone in landscape, every window
// is a full-screen sheet and the map screen folds its controls. The switch is on size only; touch behaviour is
// decided per pointer event, elsewhere. The page marks <html data-compact> while it holds, so CSS keys on that one
// attribute and never repeats the query.
import { useSyncExternalStore } from 'react';

/** The window's short side is under 600 CSS px. */
export const COMPACT_QUERY = '(max-width: 599.98px), (max-height: 599.98px)';

type Media = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
const media = (): Media | null => (typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : null);

/** Whether the screen is small now. */
export const isCompact = (): boolean => media()?.matches ?? false;

/** Keeps <html data-compact> in step with the screen; returns the function that stops it. */
export function watchCompact(root: HTMLElement = document.documentElement, m: Media | null = media()): () => void {
  if (!m) return () => {};
  const apply = () => root.toggleAttribute('data-compact', m.matches);
  apply();
  m.addEventListener('change', apply);
  return () => m.removeEventListener('change', apply);
}

/** Whether the screen is small, re-rendering when that changes (a phone turned, a window resized). */
export function useCompact(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = media();
      m?.addEventListener('change', changed);
      return () => m?.removeEventListener('change', changed);
    },
    isCompact,
    () => false,
  );
}

/** Whether a window is a full-screen sheet or a centred modal (docs/adr/0012). */
export type WindowStyle = 'sheet' | 'modal';

/**
 * The questions that stay centred modals on a small screen: a short prompt the player answers at once, which fits
 * a phone in landscape with room round it (FreeCol's FreeColConfirmDialog, FreeColChoiceDialog and the input and
 * amount dialogs, and the error message). Every other window is a panel with content to read or work in (reports,
 * the colony, Europe, trade routes, Preferences, the Colopedia, the information and event panels, dialogs that
 * hold lists) and is a sheet. One rule, decided by the window's kind; a window outside the dialog queue says it
 * with WindowFrame's `modal` prop.
 */
export const MODAL_KINDS: ReadonlySet<string> = new Set(['confirm', 'choice', 'input', 'amount', 'error']);

/** What a window is: a sheet on a small screen unless it is a short prompt, else the centred window of FreeCol's layout. */
export function windowStyle(compact: boolean, modal: boolean): WindowStyle {
  return compact && !modal ? 'sheet' : 'modal';
}
