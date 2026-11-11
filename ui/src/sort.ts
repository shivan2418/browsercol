// Reordering a list with the pointer: a press on an item's handle that moves
// lifts the item, which follows the pointer up and down while the other items
// slide out of its way, so the list shows the order it will have. Letting go
// settles the item into its gap and only then changes the order; Escape slides
// everything back. Near the edge of the window that scrolls the list, the
// window scrolls.
//
// A list is a column of items of any height, as the trade route's stops, or
// a grid of items of one size that may wrap, as a leg's holds: there an item
// follows the pointer both ways and the others step into each other's places.
//
// This is not drag.ts's lane: there a thing is carried onto a place that takes
// it, here the list itself moves. Both count as a drag (drag.ts, dragging), so
// Escape closes no window and no hint shows.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { THRESHOLD, sorting } from './drag';

/** The class of the item lifted, and of the list while one is. */
export const LIFTED = 'lifted';
export const SORTING = 'sorting';

/** How long, in ms, the items take to slide, and the lifted one to settle. */
export const SLIDE_MS = 150;

/** How near, in CSS pixels, the pointer is to the scrolling window's top or bottom before it scrolls. */
const EDGE = 32;
/** The most the window scrolls in a frame, at its very edge. */
const EDGE_SPEED = 14;

interface Sort {
  list: HTMLElement;
  items: HTMLElement[];
  from: number;
  to: number;
  /** Each item's top and bottom on the screen as the lift starts. */
  tops: number[];
  bottoms: number[];
  /** The space between two items. */
  gap: number;
  /** A grid's slots: the middle of each item on the screen as the lift starts; null for a column. */
  slots: { x: number[]; y: number[] } | null;
  /** The UI scale (CSS zoom) of the list: transforms are in its pixels, the pointer in the screen's. */
  zoom: number;
  x: number;
  y: number;
  /** The pointer on the screen as the press started, and the scroll of the window that scrolls the list. */
  startX: number;
  startY: number;
  scroller: HTMLElement | null;
  startScroll: number;
  frame: number;
  move: (from: number, to: number) => void;
}

/** How a list is laid out, and which of its children are its items. */
export interface SortOptions {
  /** Items of one size that may wrap: they move both ways. A column by default. */
  grid?: boolean;
  /** The list's items, as a selector of its children; all of them by default. */
  items?: string;
}

let press: {
  list: HTMLElement;
  index: number;
  x: number;
  y: number;
  move: Sort['move'];
  options: SortOptions;
} | null = null;
let sort: Sort | null = null;
/** An item that was lifted and is still settling: its list changes order once it is in its gap. */
let settling: ReturnType<typeof setTimeout> | null = null;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The nearest window around an element that scrolls up and down, or none. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const y = getComputedStyle(e).overflowY;
    if ((y === 'auto' || y === 'scroll') && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

const shift = (el: HTMLElement, dx: number, dy: number, zoom: number) => {
  el.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx / zoom}px, ${dy / zoom}px)`;
};

/** How far, in screen pixels, the pointer has taken the lifted item from where it was. */
const offset = (s: Sort) => s.y - s.startY + (s.scroller ? (s.scroller.scrollTop - s.startScroll) * s.zoom : 0);

/** The height an item takes in the list, with the space after it. */
const room = (s: Sort, j: number) => s.bottoms[j] - s.tops[j] + s.gap;

/** How far, in screen pixels, the lifted item is from its gap at `to`: the rooms of the items it passes. */
function gapAt(s: Sort, to: number) {
  let px = 0;
  for (let j = Math.min(s.from, to); j <= Math.max(s.from, to); j++) if (j !== s.from) px += room(s, j);
  return to > s.from ? px : -px;
}

/** The slot an item at j takes while the lifted one is held over `to`: the one next to it, for those it passed. */
const slotOf = (s: Sort, j: number) => (j > s.from && j <= s.to ? j - 1 : j < s.from && j >= s.to ? j + 1 : j);

/** Where the lifted item of a grid would go: the slot nearest its middle; the others step aside. */
function layoutGrid(s: Sort, slots: NonNullable<Sort['slots']>) {
  const dx = s.x - s.startX;
  const dy = offset(s);
  const x = slots.x[s.from] + dx;
  const y = slots.y[s.from] + dy;
  const far = (k: number) => Math.hypot(x - slots.x[k], y - slots.y[k]);
  let to = s.from;
  for (let k = 0; k < s.items.length; k++) if (far(k) < far(to)) to = k;
  s.to = to;
  s.items.forEach((el, j) => {
    if (j === s.from) return shift(el, dx, dy, s.zoom);
    const k = slotOf(s, j);
    shift(el, slots.x[k] - slots.x[j], slots.y[k] - slots.y[j], s.zoom);
  });
}

/** Where the lifted item, moved by dy, would go, and the other items out of its way. */
function layout(s: Sort) {
  if (s.slots) return layoutGrid(s, s.slots);
  const dy = offset(s);
  // The lifted item goes to the gap nearest where it is held, which items of any height make the same way.
  let to = s.from;
  for (let j = 0; j < s.items.length; j++) {
    if (Math.abs(dy - gapAt(s, j)) < Math.abs(dy - gapAt(s, to))) to = j;
  }
  s.to = to;
  const h = room(s, s.from);
  s.items.forEach((el, j) => {
    if (j === s.from) return shift(el, 0, dy, s.zoom);
    shift(el, 0, j > s.from && j <= to ? -h : j < s.from && j >= to ? h : 0, s.zoom);
  });
}

/** Scroll the window under the list while the pointer rests near its edge. */
function edgeScroll() {
  const s = sort;
  if (!s) return;
  s.frame = 0;
  if (!s.scroller) return;
  const r = s.scroller.getBoundingClientRect();
  const near = s.y < r.top + EDGE ? s.y - (r.top + EDGE) : s.y > r.bottom - EDGE ? s.y - (r.bottom - EDGE) : 0;
  if (near === 0) return;
  const before = s.scroller.scrollTop;
  s.scroller.scrollTop += Math.sign(near) * Math.ceil((Math.min(Math.abs(near), EDGE) / EDGE) * EDGE_SPEED);
  if (s.scroller.scrollTop === before) return;
  layout(s);
  s.frame = requestAnimationFrame(edgeScroll);
}

function lift(p: NonNullable<typeof press>) {
  const items = Array.from(p.list.children).filter(
    (el) => !p.options.items || el.matches(p.options.items),
  ) as HTMLElement[];
  const boxes = items.map((el) => el.getBoundingClientRect());
  const scroller = scrollerOf(p.list);
  sort = {
    list: p.list,
    items,
    from: p.index,
    to: p.index,
    tops: boxes.map((b) => b.top),
    bottoms: boxes.map((b) => b.bottom),
    gap: boxes.length > 1 ? Math.max(0, boxes[1].top - boxes[0].bottom) : 0,
    slots: p.options.grid
      ? { x: boxes.map((b) => (b.left + b.right) / 2), y: boxes.map((b) => (b.top + b.bottom) / 2) }
      : null,
    zoom: (p.list as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1,
    x: p.x,
    y: p.y,
    startX: p.x,
    startY: p.y,
    scroller,
    startScroll: scroller?.scrollTop ?? 0,
    frame: 0,
    move: p.move,
  };
  const slide = reduced() ? 'none' : `transform ${SLIDE_MS}ms ease`;
  items.forEach((el, j) => (el.style.transition = j === p.index ? 'none' : slide));
  items[p.index].classList.add(LIFTED);
  p.list.classList.add(SORTING);
  sorting(true);
  getSelection()?.removeAllRanges();
}

function moving(e: PointerEvent) {
  if (!press) return;
  if (!sort) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
    lift(press);
  }
  const s = sort!;
  s.x = e.clientX;
  s.y = e.clientY;
  layout(s);
  if (!s.frame) s.frame = requestAnimationFrame(edgeScroll);
}

/** Put the items where they end up, then, once they are there, the list in its new order (none on Escape). */
function settle(commit: boolean) {
  const s = sort;
  stopListening();
  press = null;
  if (!s) return;
  sort = null;
  if (s.frame) cancelAnimationFrame(s.frame);
  const to = commit ? s.to : s.from;
  const lifted = s.items[s.from];
  const quick = reduced();
  lifted.style.transition = quick ? 'none' : `transform ${SLIDE_MS}ms ease`;
  s.to = to;
  if (s.slots) shift(lifted, s.slots.x[to] - s.slots.x[s.from], s.slots.y[to] - s.slots.y[s.from], s.zoom);
  else shift(lifted, 0, gapAt(s, to), s.zoom);
  if (!commit) s.items.forEach((el, j) => j !== s.from && shift(el, 0, 0, s.zoom));
  const done = () => {
    settling = null;
    // The new order and the items back in their places in one frame, so nothing jumps.
    flushSync(() => {
      if (to !== s.from) s.move(s.from, to);
    });
    for (const el of s.items) {
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove(LIFTED);
    }
    s.list.classList.remove(SORTING);
    sorting(false);
  };
  if (quick) done();
  else settling = setTimeout(done, SLIDE_MS);
}

/** The browser's click on what the lifted item was pressed on: it belongs to the drag, not to a button. */
function swallow(e: MouseEvent) {
  removeEventListener('click', swallow, true);
  e.preventDefault();
  e.stopPropagation();
}

function released() {
  if (sort) {
    addEventListener('click', swallow, true);
    setTimeout(() => removeEventListener('click', swallow, true));
  }
  settle(true);
}

function key(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !sort) return;
  e.preventDefault();
  e.stopPropagation();
  settle(false);
}

const cancelled = () => settle(false);

function stopListening() {
  removeEventListener('pointermove', moving, true);
  removeEventListener('pointerup', released, true);
  removeEventListener('pointercancel', cancelled, true);
  removeEventListener('keydown', key, true);
  removeEventListener('blur', cancelled);
}

/** Whether an item is lifted or settling: the list is not to change under it meanwhile. */
export const sortBusy = () => sort !== null || settling !== null;

/**
 * The props of an item's handle in a list that can be reordered: the item is the list's child that holds
 * the handle, and the list is the element `list` names.
 *
 * @param index The item's place among the list's items.
 * @param list The list, from the handle.
 * @param move Put the item at `from` at `to`.
 * @param options The list's layout, and which of its children are its items.
 */
export function sortHandle(
  index: number,
  list: (handle: HTMLElement) => HTMLElement | null,
  move: (from: number, to: number) => void,
  options: SortOptions = {},
) {
  return {
    'data-sort': '',
    onPointerDown(e: ReactPointerEvent) {
      if (e.button !== 0 || press || sortBusy()) return;
      const l = list(e.currentTarget as HTMLElement);
      if (!l) return;
      // A touch captures the pointer where it pressed; the moves are wanted wherever they go.
      if (e.pointerType === 'touch') (e.target as Element).releasePointerCapture?.(e.pointerId);
      press = { list: l, index, x: e.clientX, y: e.clientY, move, options };
      addEventListener('pointermove', moving, true);
      addEventListener('pointerup', released, true);
      addEventListener('pointercancel', cancelled, true);
      addEventListener('keydown', key, true);
      addEventListener('blur', cancelled);
    },
    onDragStart(e: { preventDefault(): void }) {
      e.preventDefault();
    },
  };
}
