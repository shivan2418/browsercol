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
 */
export function viewHold(sliding: () => boolean, settled: () => Promise<void>) {
  let held: Promise<void> | null = null;
  return {
    change(run: () => void, offTheUnit: boolean): void {
      if (!held && !(offTheUnit && sliding())) return run();
      const next = (held ?? settled()).then(run).catch((ex: unknown) => console.error(ex));
      held = next;
      void next.then(() => {
        if (held === next) held = null;
      });
    },
    idle: (): Promise<void> => held ?? Promise.resolve(),
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
