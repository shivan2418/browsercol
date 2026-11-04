// The turn change cue (#123): FreeCol shows the new year in the status line and jumps to a unit; the
// Browser UI also says it in a banner over the map. While the AI players move it says so, and when the
// player's turn starts it shows "Turn N, Spring 1493" for a moment. Once no unit is left to move it says
// to end the turn, as FreeCol's info panel does.
import { useEffect, useState } from 'react';

/** What the last map said about the turn. */
export interface TurnFacts {
  turn: string;
  turnLabel: string;
  ourTurn: boolean;
}

export interface TurnNotice {
  kind: 'ai' | 'new' | 'done';
  text: string;
}

/** The banner for a map after `prev` (null at the start of the game, which is no turn change): none, or the AI moving, or a new turn. */
export function turnNotice(prev: TurnFacts | null, next: TurnFacts): TurnNotice | null {
  if (!next.ourTurn) return { kind: 'ai', text: 'Other players are moving...' };
  if (prev && (!prev.ourTurn || prev.turn !== next.turn)) {
    return { kind: 'new', text: `Turn ${next.turn}, ${next.turnLabel}` };
  }
  return null;
}

/** FreeCol's end turn panel (infoPanel.endTurn): every unit has moved, so Enter ends the turn. */
export const DONE_NOTICE: TurnNotice = { kind: 'done', text: 'All units have moved. Press Enter to end the turn.' };

/**
 * Whether no unit is left to move in the turn of the last map. `heard` is the map the Engine said no unit
 * is active after (null for the start of the game), or undefined when a unit is active. The Engine says it
 * before the map of a new turn (its active unit event comes first), so a "no unit" heard while the others
 * moved counts for our turn that follows; one heard in our own turn counts for that turn only, as at the
 * end of a turn it is ending.
 */
export function isIdle(heard: TurnFacts | null | undefined, last: TurnFacts | null) {
  if (heard === undefined || !last?.ourTurn) return false;
  return !heard?.ourTurn || heard.turn === last.turn;
}

/** The notice to show: the turn's own, unless no unit is left to move in our turn, when the player is told to end it. */
export function shownNotice(banner: TurnNotice | null, last: TurnFacts | null, heard: TurnFacts | null | undefined) {
  return isIdle(heard, last) ? DONE_NOTICE : banner;
}

/** How long the new turn notice stays, in milliseconds. */
export const NEW_TURN_MS = 2500;

/** The notice over the map; a new turn's notice goes away by itself. */
export function TurnBanner({ notice }: { notice: TurnNotice | null }) {
  const [hidden, setHidden] = useState<TurnNotice | null>(null);
  useEffect(() => {
    if (notice?.kind !== 'new') return;
    const t = setTimeout(() => setHidden(notice), NEW_TURN_MS);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice || notice === hidden) return null;
  return (
    <div
      role="status"
      className={`turn-banner ${notice.kind}`}
      style={notice.kind === 'new' ? { animationDuration: `${NEW_TURN_MS}ms` } : undefined}
    >
      {notice.text}
    </div>
  );
}
