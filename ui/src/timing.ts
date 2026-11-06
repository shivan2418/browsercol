// Debug: the page's `?slidetiming` parameter marks the way from a move order to
// the first frame of the unit's slide on the performance timeline (#312), for
// scripts/slide-timing.ts to read. Without it the marks are not made.

const on = typeof location !== 'undefined' && new URLSearchParams(location.search).has('slidetiming');

/** Mark a point on the way to a slide, as `slide: <name>`, when the page times slides. */
export function slideMark(name: string): void {
  if (on) performance.mark(`slide: ${name}`);
}
