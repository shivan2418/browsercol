/**
 * Hold what the Engine opens (a question, the colony panel) until the unit that moved has slid to its tile,
 * as SwingGUI finishes the animation before the panel shows.
 */
export function afterSlide(settled: () => Promise<void>) {
  return async <T>(open: () => T | Promise<T>): Promise<T> => {
    await settled();
    return open();
  };
}

/**
 * The view changes the Engine asks for (a new active unit, a selected tile, a focus, a map), run in the order they
 * came. One that would take the camera off the unit that slides waits until it has slid to its tile, as Swing
 * finishes the animation before it changes the view, and those after it wait their turn behind it. `idle` resolves
 * once none is waiting.
 *
 * A batch of several units' steps (orders carried out after the last move) plays one unit's run at a time, and
 * `seen` counts the steps told of: a change waiting remembers how many came before it. The map drawer says with
 * `reach` that it is about to play a run of steps up to the `end`th, of a `unit`: the changes before that run, and
 * those right after it that are for the unit, run first, so the camera comes to the unit as it sets off. The rest wait
 * for the run's slide, as before.
 */
export function viewHold(sliding: () => boolean, settled: () => Promise<void>, seen: () => number = () => 0) {
  interface Held {
    run: () => void;
    off: boolean;
    at: number;
    unit?: string;
  }
  const queue: Held[] = [];
  let working: Promise<void> | null = null;
  const go = (h: Held) => {
    try {
      h.run();
    } catch (ex) {
      console.error(ex);
    }
  };
  async function drain(): Promise<void> {
    while (queue.length) {
      const h = queue[0];
      if (h.off && sliding()) await settled();
      // `reach` may have run it while it waited.
      if (queue[0] !== h) continue;
      queue.shift();
      go(h);
    }
  }
  const start = () => {
    if (working) return;
    const w = drain().finally(() => {
      if (working === w) working = null;
    });
    working = w;
  };
  return {
    change(run: () => void, offTheUnit: boolean, unit?: string): void {
      if (!queue.length && !(offTheUnit && sliding())) return run();
      queue.push({ run, off: offTheUnit, at: seen(), unit });
      start();
    },
    /** About to play the run that ends at the `end`th step, for `unit`: run the changes that belong before it. */
    async reach(end: number, unit: string): Promise<void> {
      while (queue.length && (queue[0].at < end || (queue[0].at === end && queue[0].unit === unit))) go(queue.shift()!);
    },
    idle: async (): Promise<void> => {
      while (working) await working;
    },
  };
}

/** The pop-ups a move can raise: first contact, a rumour's outcome, the move's messages, a settlement visited. */
const MOVE_POPUPS = ['information', 'eventPanel', 'messages', 'indianSettlement'] as const;

/**
 * The handlers of the pop-ups a move can raise, each run through `hold` so it opens once the unit that moved has
 * been drawn on its new tile, and in the order the Engine sent them. FreeCol animates a move before the pop-up the
 * move causes shows (GUI.animateUnitMove); the Engine sends the move's event first, and the Browser UI would
 * otherwise open the pop-up at once while the map still has the unit on its old tile. With no slide running they
 * open at once, and a pop-up no move caused is not delayed. The Engine counts a pop-up as open from when it sent
 * it, so a Go To still waits for it (Popups.java) however long the slide holds it.
 */
export function popupsAfterMove<E extends { [K in (typeof MOVE_POPUPS)[number]]?: (event: never) => void }>(
  events: E,
  hold: Pick<ReturnType<typeof viewHold>, 'change'>,
): E {
  const held: Record<string, unknown> = { ...events };
  for (const kind of MOVE_POPUPS) {
    const open = events[kind] as ((event: unknown) => void) | undefined;
    if (open) held[kind] = (event: unknown) => hold.change(() => open(event), true);
  }
  return held as E;
}
