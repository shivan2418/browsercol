// The turn change cue (#123): FreeCol shows the new year in the status line and jumps to a unit; the
// Browser UI also says it in a banner over the map. While the AI players move it says so, and when the
// player's turn starts it shows "Turn N, Spring 1493" for a moment. Once no unit is left to move only the
// info panel (info-panel.tsx) says to end the turn, as FreeCol's does.
import { useEffect, useState } from 'react';
import './turn-banner.css';

/** What the last map said about the turn. */
export interface TurnFacts {
  turn: string;
  turnLabel: string;
  ourTurn: boolean;
}

/** The player whose turn it is, as the Engine's mover event says (WebGUI.currentPlayer). */
export interface Mover {
  name: string;
  native: boolean;
  rgb: number;
  fg: number;
  ours: boolean;
}

export interface TurnNotice {
  kind: 'ai' | 'new';
  text: string;
  /** The moving player's colour, for the swatch beside the text. */
  rgb?: number;
}

/** What the banner says of the player moving: the nation, or one line for the whole native stretch. */
function moverText(m: Mover) {
  return m.native ? 'The natives are moving...' : `The ${m.name} are moving...`;
}

/**
 * The banner for a map after `prev` (null at the start of the game, which is no turn change): none, or the AI
 * moving (naming `mover`, once the Engine has said who), or a new turn.
 */
export function turnNotice(prev: TurnFacts | null, next: TurnFacts, mover: Mover | null = null): TurnNotice | null {
  if (!next.ourTurn) {
    return mover && !mover.ours
      ? { kind: 'ai', text: moverText(mover), rgb: mover.native ? undefined : mover.rgb }
      : { kind: 'ai', text: 'Other players are moving...' };
  }
  if (prev && (!prev.ourTurn || prev.turn !== next.turn)) {
    return { kind: 'new', text: `Turn ${next.turn}, ${next.turnLabel}` };
  }
  return null;
}

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

/** The least time a player's name stays on the banner, in milliseconds, so a fast turn does not flash by. */
export const MOVER_MIN_MS = 500;

/**
 * Holds each moving player's name for at least `MOVER_MIN_MS`. A player who comes while a name is held waits for
 * it; one who is replaced before its turn comes is skipped. The natives are one stretch: a native player
 * after a native player changes nothing. Our own turn clears it at once.
 */
export class MoverHold {
  private shown: Mover | null = null;
  private since = 0;
  private waiting: Mover | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onShow: (m: Mover | null) => void,
    private readonly minMs = MOVER_MIN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  push(m: Mover) {
    if (m.ours) return this.clear();
    if (this.shown?.native && m.native) {
      this.waiting = null;
      return;
    }
    const wait = this.since + this.minMs - this.now();
    if (!this.shown || wait <= 0) return this.show(m);
    this.waiting = m;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const next = this.waiting;
      this.waiting = null;
      if (next) this.show(next);
    }, wait);
  }

  /** Our turn, or a new round: nobody is moving. */
  clear() {
    clearTimeout(this.timer);
    this.waiting = null;
    if (!this.shown) return;
    this.shown = null;
    this.onShow(null);
  }

  private show(m: Mover) {
    this.shown = m;
    this.since = this.now();
    this.waiting = null;
    this.onShow(m);
  }
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
      {notice.rgb !== undefined && (
        <span className="turn-banner-swatch" style={{ background: `#${notice.rgb.toString(16).padStart(6, '0')}` }} />
      )}
      {notice.text}
    </div>
  );
}
