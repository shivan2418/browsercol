// Ask before the page goes away with play that no save holds (#263): Ctrl+W, a back swipe or F5 would
// throw away everything since the last save or autosave. A leave the page makes itself (back to the main
// title, opening a save, a new game) is on purpose and not asked about.

export interface LeaveGuard {
  /** The game changed: play now differs from every save. */
  changed: () => void;
  /** A save of the game as it now is has been asked for. */
  saving: () => void;
  /** That save has been stored: the game is as saved unless it changed after it was asked for. */
  saved: () => void;
  /** The page is about to leave on purpose: no question. */
  leaving: () => void;
}

/** Guard a window: its beforeunload asks while the game has changed since the last save. */
export function leaveGuard(win: EventTarget): LeaveGuard {
  let revision = 0;
  let asked = 0;
  let clean = 0;
  let leaving = false;
  win.addEventListener('beforeunload', (e) => {
    if (leaving || revision === clean) return;
    // The standard way to ask; Chromium also wants returnValue set.
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = '';
  });
  return {
    changed: () => void revision++,
    saving: () => void (asked = revision),
    saved: () => void (clean = Math.max(clean, asked)),
    leaving: () => void (leaving = true),
  };
}
