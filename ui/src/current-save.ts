// The game being played, as .fsg bytes (#368): what the feedback report attaches. main.tsx connects it to the
// Worker once a game has begun (channel.ts snapshotter); before that, and after the game ends, there is no game.

let source: (() => Promise<Uint8Array>) | null = null;

/** Where the bytes come from; null when there is no game. */
export function setCurrentSaveSource(next: (() => Promise<Uint8Array>) | null): void {
  source = next;
}

/**
 * The current game as .fsg bytes, made by the Engine as Save does, and kept nowhere: no entry joins the save
 * list. Rejects, with the reason, when no game is running or the Engine cannot save it.
 */
export function currentSave(): Promise<Uint8Array> {
  return source ? source() : Promise.reject(new Error('No game is running'));
}
