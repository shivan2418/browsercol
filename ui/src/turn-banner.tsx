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
 * The notice to show: the turn's own, unless it is our turn and no unit is left to move in it (`idleTurn`,
 * the turn the Engine last said so in), when the player is told to end the turn.
 */
export function shownNotice(banner: TurnNotice | null, last: TurnFacts | null, idleTurn: string | null) {
  return last?.ourTurn && idleTurn === last.turn ? DONE_NOTICE : banner;
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
