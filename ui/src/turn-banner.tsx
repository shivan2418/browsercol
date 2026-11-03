// The turn change cue (#123): FreeCol shows the new year in the status line and jumps to a unit; the
// Browser UI also says it in a banner over the map. While the AI players move it says so, and when the
// player's turn starts it shows "Turn N, Spring 1493" for a moment.
import { useEffect, useState } from 'react';

/** What the last map said about the turn. */
export interface TurnFacts {
  turn: string;
  turnLabel: string;
  ourTurn: boolean;
}

export interface TurnNotice {
  kind: 'ai' | 'new';
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
