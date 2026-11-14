// A save when the page goes to the background (#510). A phone's browser freezes or discards a hidden tab without
// a word, so what the player did since the last save would be gone when they come back. The page saves to a slot of
// its own the moment it is hidden, best effort: the Engine's save and the one transaction that stores it may not
// finish if the tab is frozen right after, and then the slot keeps the save before, whole (saves.ts put is one
// transaction: a save is stored entirely or not at all, docs/adr/0007). The start screen offers the newest one.

/** The page's visibility and unload events, as a Document and a Window give them. */
export interface BackgroundEvents {
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** Two events of one leaving (a tab hidden, then the page hidden) make one save: this many ms apart at least. */
export const BACKGROUND_SAVE_GAP_MS = 2000;

/**
 * Call `save` when the page is hidden or going away, if `ready` says there is a game to save (a game that
 * is running, our turn, not over). Returns the function that stops listening.
 */
export function saveInBackground(
  { doc, win }: BackgroundEvents,
  ready: () => boolean,
  save: () => void,
  now: () => number = Date.now,
): () => void {
  let last = -Infinity;
  const go = () => {
    if (!ready() || now() - last < BACKGROUND_SAVE_GAP_MS) return;
    last = now();
    try {
      save();
    } catch (ex) {
      console.warn('background save failed:', ex);
    }
  };
  const hidden = () => {
    if (doc.visibilityState === 'hidden') go();
  };
  doc.addEventListener('visibilitychange', hidden);
  win.addEventListener('pagehide', go);
  return () => {
    doc.removeEventListener('visibilitychange', hidden);
    win.removeEventListener('pagehide', go);
  };
}
