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
