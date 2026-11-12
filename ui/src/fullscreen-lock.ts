// In full screen, Escape closes the menu or window on top, as it does in a window, rather than leaving full
// screen: where the browser has the Keyboard Lock API (Chromium), the page takes Escape while full screen lasts
// and the player holds it (about 2 s) to leave. Firefox and Safari have no Keyboard Lock, so nothing changes
// there: the browser keeps Escape and it leaves full screen too. The browser's own F11 full screen does not
// leave on Escape either way.

/** The part of navigator.keyboard the lock uses. */
export interface KeyboardLock {
  lock?: (keys: string[]) => Promise<void>;
  unlock?: () => void;
}

/**
 * Lock Escape when the document enters full screen and unlock it when it leaves, by any path (fullscreenchange).
 * `after` runs on each change, once the lock is asked for.
 */
export function lockEscapeInFullScreen(
  doc: Pick<Document, 'addEventListener' | 'fullscreenElement'>,
  keyboard: KeyboardLock | undefined,
  after: () => void = () => {},
): void {
  doc.addEventListener('fullscreenchange', () => {
    if (doc.fullscreenElement) void keyboard?.lock?.(['Escape'])?.catch(() => {});
    else keyboard?.unlock?.();
    after();
  });
}
