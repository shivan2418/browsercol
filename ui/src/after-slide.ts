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
