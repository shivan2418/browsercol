// The player's pointer on the map: drags pan it, the wheel zooms it, a
// pointer resting at its edge scrolls it, and the tile under the pointer is
// hovered. Each turns into a view event (view.ts) for the page to dispatch.
import { edgeScroll, type Tile, type ViewEvent, type ViewState } from './view';

/** Pointer at the map's edge (view.ts, edgeScroll), for EDGE_DELAY ms, scrolls it by EDGE_SPEED a frame. */
const EDGE_DELAY = 300;
const EDGE_SPEED = 16;

/** Wheel deltas, in pixels, that make one zoom step: a trackpad's small deltas add up. */
const WHEEL_STEP = 40;

/** WheelEvent.DOM_DELTA_PIXEL, which tests have no WheelEvent for. */
const DELTA_PIXEL = 0;

/**
 * Add a wheel event to the deltas so far: the zoom steps it makes (+1 in,
 * -1 out, 0 for none yet) and the deltas left over.
 */
export function wheelZoom(wheel: number, e: { deltaY: number; deltaMode: number }): { steps: number; wheel: number } {
  // Line and page deltas (Firefox's mouse wheel) count as a step each.
  const sum = wheel + (e.deltaMode === DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_STEP);
  if (Math.abs(sum) < WHEEL_STEP) return { steps: 0, wheel: sum };
  return { steps: sum < 0 ? 1 : -1, wheel: 0 };
}

/** A pointer event's pixel on the map canvas in a host, or null before there is one. */
export function onCanvas(host: HTMLElement, e: { clientX: number; clientY: number }): [number, number] | null {
  const canvas = host.querySelector('canvas');
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

export interface PointerDeps {
  view: () => ViewState;
  dispatch: (e: ViewEvent) => void;
  /** The tile at a pixel on the map canvas, or null off the map. */
  tileAt: (px: number, py: number) => Tile | null;
}

/** Move the view with the pointer on the map in a host. Returns whether the last click was a drag. */
export function pointerInput(host: HTMLElement, { view, dispatch, tileAt }: PointerDeps): () => boolean {
  let wheel = 0;
  let from: [number, number] | null = null;
  let moved = 0;
  host.addEventListener('pointerdown', (e) => {
    from = [e.clientX, e.clientY];
    moved = 0;
  });
  addEventListener('pointermove', (e) => {
    if (!from) return;
    const [dx, dy] = [e.clientX - from[0], e.clientY - from[1]];
    moved += Math.abs(dx) + Math.abs(dy);
    from = [e.clientX, e.clientY];
    dispatch({ k: 'pan', dx, dy });
  });
  addEventListener('pointerup', () => (from = null));
  host.addEventListener(
    'wheel',
    (e) => {
      const at = onCanvas(host, e);
      if (!at) return;
      e.preventDefault();
      const zoom = wheelZoom(wheel, e);
      wheel = zoom.wheel;
      if (zoom.steps) dispatch({ k: 'zoom', steps: zoom.steps, at });
    },
    { passive: false },
  );

  // The pointer over the map, and since when it has been at an edge.
  let pointer: [number, number] | null = null;
  let edgeSince = 0;
  host.addEventListener('pointermove', (e) => {
    pointer = onCanvas(host, e);
    const at = pointer && tileAt(...pointer);
    const was = view().hover;
    if (at?.[0] !== was?.[0] || at?.[1] !== was?.[1]) dispatch({ k: 'hover', at: at ?? null });
  });
  host.addEventListener('pointerleave', () => {
    pointer = null;
    if (view().hover) dispatch({ k: 'hover', at: null });
  });
  const scroll = (now: number) => {
    const [ex, ey] = pointer && !from ? edgeScroll(pointer, view().viewport) : [0, 0];
    if (!ex && !ey) edgeSince = 0;
    else if (!edgeSince) edgeSince = now;
    else if (now - edgeSince >= EDGE_DELAY) dispatch({ k: 'pan', dx: ex * EDGE_SPEED, dy: ey * EDGE_SPEED });
    requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
  return () => moved > 4;
}
