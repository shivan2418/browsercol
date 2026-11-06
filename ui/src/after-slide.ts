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
