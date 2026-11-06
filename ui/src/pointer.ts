// The player's pointer on the map: drags pan it, the wheel zooms it, a
// pointer resting at its edge scrolls it, and the tile under the pointer is
// hovered. Each turns into a view event (view.ts) for the page to dispatch.
import type { Id } from './webgui';
import { edgeScroll, type Tile, type ViewEvent, type ViewState } from './view';

/** Pointer at the map's edge (view.ts, edgeScroll), for EDGE_DELAY ms, scrolls it by EDGE_SPEED a frame. */
const EDGE_DELAY = 300;
const EDGE_SPEED = 16;

/** Wheel deltas, in pixels, that make one zoom step: a trackpad's small deltas add up. */
const WHEEL_STEP = 40;

/** Pixels the pointer moves between press and release that make a click a drag. */
const DRAG_PIXELS = 4;

/** Milliseconds the pointer rests on a tile, button down, before it shows where the active unit would go. */
export const HOLD_MS = 400;

/** WheelEvent.DOM_DELTA_PIXEL, which tests have no WheelEvent for. */
const DELTA_PIXEL = 0;

/**
 * Add a wheel event to the deltas so far: the zoom steps it makes (+1 in,
 * -1 out, 0 for none yet) and the deltas left over.
 */
export function wheelZoom(wheel: number, e: { deltaY: number; deltaMode: number }): { steps: number; rest: number } {
  // Line and page deltas (Firefox's mouse wheel) count as a step each.
  const sum = wheel + (e.deltaMode === DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_STEP);
  if (Math.abs(sum) < WHEEL_STEP) return { steps: 0, rest: sum };
  return { steps: sum < 0 ? 1 : -1, rest: 0 };
}

/** A pointer event's pixel on the map canvas in a host, or null before there is one. */
export function onCanvas(host: HTMLElement, e: { clientX: number; clientY: number }): [number, number] | null {
  const canvas = host.querySelector('canvas');
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

/**
 * Whether a right-click on a target keeps the browser's context menu: only in
 * a text field, where it cuts and pastes. Everywhere else the right button
 * belongs to the game.
 */
export function keepsBrowserMenu(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea');
}

/** Keep the browser's context menu off the page, except in text fields (keepsBrowserMenu). */
export function blockBrowserMenu(page: EventTarget): void {
  page.addEventListener('contextmenu', (e) => {
    if (!keepsBrowserMenu(e.target)) e.preventDefault();
  });
}

/** Keep the browser's ghost image off a dragged picture; a draggable element's own drag (a colonist chip) stays. */
export function blockImageDrag(page: EventTarget): void {
  page.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && !t.closest('[draggable="true"]')) e.preventDefault();
  });
}

/**
 * A right-click on a tile of the map in a host asks for that tile's menu, at the pointer
 * (FreeCol's TilePopup); off the map or off any tile it does nothing.
 */
export function rightClickInput(
  host: HTMLElement,
  tileAt: (px: number, py: number) => Tile | null,
  open: (tile: Tile, x: number, y: number) => void,
): void {
  host.addEventListener('contextmenu', (e) => {
    const at = onCanvas(host, e);
    const tile = at && tileAt(...at);
    if (tile) open(tile, e.clientX, e.clientY);
  });
}

export interface GotoDeps {
  /** Show the path a unit would take to a tile, or clear it with null. */
  preview: (tile: Tile | null, unit: Id | null) => void;
  go: (tile: Tile, unit: Id) => void;
}

export interface PointerDeps {
  view: () => ViewState;
  dispatch: (e: ViewEvent) => void;
  /** The tile at a pixel on the map canvas, or null off the map. */
  tileAt: (px: number, py: number) => Tile | null;
  /**
   * The Go To order: holding the pointer on a tile shows the way there (preview), and releasing it sets off (go).
   * Both name the unit the gesture started with: it belongs to that unit, not to whichever is active by then.
   */
  goto?: GotoDeps;
  /** Whether a pointer resting at the map's edge scrolls it (FreeCol's auto scroll option); always, if left out. */
  edgeScrolls?: () => boolean;
  /** Whether the map scrolls at its edge while the Go To order is held (FreeCol's map scroll on drag option). */
  dragScrolls?: () => boolean;
}

/**
 * Go To from the keyboard: G starts choosing a destination, the path to the tile under the pointer shows and
 * follows it, and a click on the map sets off. Escape or G again cancels. `active` says whether keys may start it
 * (no dialog open, a unit to move).
 */
export function gotoKeyInput(
  host: HTMLElement,
  tileAt: (px: number, py: number) => Tile | null,
  goto: GotoDeps,
  active: () => boolean,
  /** The active unit's id: the one a Go To started now belongs to. */
  activeUnit: () => Id | null,
): void {
  let pointer: { clientX: number; clientY: number } | null = null;
  let holding: Tile | null = null;
  let choosing = false;
  /** The unit that was active when G was pressed. */
  let unit: Id | null = null;
  const tileUnder = () => {
    const at = pointer && onCanvas(host, pointer);
    return at && tileAt(...at);
  };
  const show = () => {
    // SwingGUI.changeView clears the goto path when the active unit changes: so does the choice.
    if (choosing && activeUnit() !== unit) return stop();
    const tile = tileUnder();
    if (tile && (tile[0] !== holding?.[0] || tile[1] !== holding?.[1])) {
      holding = tile;
      goto.preview(tile, unit);
    }
  };
  const stop = () => {
    if (choosing) goto.preview(null, unit);
    choosing = false;
    unit = null;
    holding = null;
    host.style.cursor = '';
  };
  addEventListener('pointermove', (e) => {
    pointer = e;
    if (choosing) show();
  });
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (choosing && e.key === 'Escape') {
      e.preventDefault();
      stop();
    } else if (e.key.toLowerCase() === 'g' && !e.repeat && (choosing || active())) {
      e.preventDefault();
      if (choosing) return stop();
      unit = activeUnit();
      if (!unit) return;
      choosing = true;
      host.style.cursor = 'crosshair';
      show();
    }
  });
  // The click that picks the tile is the Go To's, not a tile click.
  host.addEventListener(
    'click',
    (e) => {
      if (!choosing) return;
      e.stopImmediatePropagation();
      const tile = tileUnder() ?? holding;
      const goer = unit;
      const same = activeUnit() === goer;
      stop();
      if (tile && goer && same) goto.go(tile, goer);
    },
    true,
  );
  addEventListener('blur', stop);
}

/** Move the view with the middle button on the map in a host. Returns whether the last click was a drag. */
export function pointerInput(
  host: HTMLElement,
  { view, dispatch, tileAt, goto, edgeScrolls = () => true, dragScrolls = () => true }: PointerDeps,
): () => boolean {
  let wheel = 0;
  let from: [number, number] | null = null;
  /** Whether the press in progress is the middle button, the only one that pans. */
  let panning = false;
  let moved = 0;
  /** The tile the Go To order is held on, once the hold has shown its path. */
  let holding: Tile | null = null;
  /** The unit that was active when the press began: the Go To order belongs to it. */
  let unit: Id | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let heldFor = false;
  const tileUnder = (e: { clientX: number; clientY: number }) => {
    const at = onCanvas(host, e);
    return at && tileAt(...at);
  };
  /**
   * Whether the unit the press began with is no longer the active one. The Go To is then dropped, as SwingGUI.changeView
   * drops the goto path: the path is cleared and nothing is sent, however long the pointer stays down.
   */
  const cancelled = () => {
    if (unit && view().active?.unit === unit) return false;
    if (holding) goto?.preview(null, unit);
    holding = null;
    return true;
  };
  host.addEventListener('pointerdown', (e) => {
    from = [e.clientX, e.clientY];
    panning = e.button === 1;
    if (panning) e.preventDefault();
    moved = 0;
    heldFor = false;
    clearTimeout(holdTimer);
    unit = view().active?.unit ?? null;
    if (!goto || e.button !== 0) return;
    // A press held long enough starts the Go To order, on the tile the pointer is on by then: the left button
    // does not pan, so a hand that wobbles or moves on before the hold is up still gets it.
    holdTimer = setTimeout(() => {
      if (!from) return;
      heldFor = true;
      if (cancelled()) return;
      holding = tileUnder({ clientX: from[0], clientY: from[1] });
      if (holding) goto.preview(holding, unit);
    }, HOLD_MS);
  });
  addEventListener('pointermove', (e) => {
    if (!from) return;
    if (heldFor) {
      if (cancelled()) return;
      const tile = tileUnder(e);
      if (tile && (tile[0] !== holding?.[0] || tile[1] !== holding?.[1])) {
        holding = tile;
        goto?.preview(tile, unit);
      }
      return;
    }
    const [dx, dy] = [e.clientX - from[0], e.clientY - from[1]];
    moved += Math.abs(dx) + Math.abs(dy);
    from = [e.clientX, e.clientY];
    if (panning) dispatch({ k: 'pan', dx, dy });
  });
  addEventListener('pointerup', () => {
    clearTimeout(holdTimer);
    from = null;
    if (heldFor && !cancelled() && holding && unit) {
      goto?.preview(null, unit);
      goto?.go(holding, unit);
    }
    holding = null;
  });
  addEventListener('pointercancel', () => {
    clearTimeout(holdTimer);
    from = null;
    if (holding) goto?.preview(null, unit);
    holding = null;
    heldFor = false;
  });
  host.addEventListener(
    'wheel',
    (e) => {
      const at = onCanvas(host, e);
      if (!at) return;
      e.preventDefault();
      const zoom = wheelZoom(wheel, e);
      wheel = zoom.rest;
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
    // At rest, as the auto scroll option says; while the Go To order is held, as map scroll on drag says.
    const scrolls = from ? heldFor && dragScrolls() : edgeScrolls();
    const [ex, ey] = pointer && scrolls ? edgeScroll(pointer, view().viewport) : [0, 0];
    if (!ex && !ey) edgeSince = 0;
    else if (!edgeSince) edgeSince = now;
    else if (now - edgeSince >= EDGE_DELAY) dispatch({ k: 'pan', dx: ex * EDGE_SPEED, dy: ey * EDGE_SPEED });
    requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
  return () => moved > DRAG_PIXELS || heldFor;
}
