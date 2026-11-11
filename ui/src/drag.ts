// Dragging with the pointer: a press that moves picks a thing up, its own
// icon follows the pointer over the windows, the place under it that would
// take it is marked, and letting go there drops it. Escape, or letting go
// over nothing, puts it back where it was, with no animation.
//
// The panels drag this way rather than with the browser's drag and drop,
// whose ghost, cursors and fly-back differ from one browser to another and
// from Swing FreeCol's, where the thing's own icon follows the pointer.
//
// A lane is one kind of drag: the colony and Europe panels' units and goods
// (moves.ts), the build queue's rows, the trade route's stops. A place of a
// lane takes only what is dragged in that lane.
//
// The place under the pointer is found as the pointer's events bubble: the
// floating icon takes no pointer events, so the pointer's moves and its
// release go to what is under it, and the innermost place that takes the
// thing has it.
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';

/** The class of the place a thing is dragged over that would take it. */
export const OVER = 'over-target';

/** How far, in CSS pixels, a press must move before it is a drag, so a click is not one. */
export const THRESHOLD = 4;

/** The modifier keys as the drag starts, which can change what is picked up. */
export interface Keys {
  shiftKey: boolean;
  altKey: boolean;
}

/** A press on something that can be dragged: it becomes a drag once the pointer moves far enough. */
interface Press {
  lane: object;
  lift: (keys: Keys) => unknown;
  look: Element;
  /** The element pressed. */
  el: Element;
  x: number;
  y: number;
  /** The pointer event that pressed, so a source inside another source picks up only itself. */
  event: Event;
  /** Whether it became a drag: its release then makes no click, even after Escape put the thing back. */
  dragged: boolean;
}
/** The drag under way: its lane, what is carried, and the icon that follows the pointer. */
interface Carry {
  lane: object;
  thing: unknown;
  ghost: HTMLElement;
  /** Half the icon's size, so that the pointer holds it by its middle. */
  half: [number, number];
}

let press: Press | null = null;
let carry: Carry | null = null;
/** The place that takes the thing at the pointer's latest move, as the move bubbles; the innermost claims it. */
let claim: Element | null = null;
/** The place marked as taking the thing. */
let lit: Element | null = null;

const mark = (el: Element | null) => {
  if (el === lit) return;
  lit?.classList.remove(OVER);
  lit = el;
  lit?.classList.add(OVER);
};

/** What a copy of the dragged thing does not take from it: where it sat on the page, and how it moved there. */
const PLACED =
  /^(position|inset|top|right|bottom|left|margin|float|transform|translate|rotate|scale|zoom|transition|animation)/;
/** What the copy's root takes instead of its original's: no background, outline, shadow or border colour. */
const BARE: [string, string][] = [
  ['background', 'none'],
  ['outline', 'none'],
  ['box-shadow', 'none'],
  ['border-color', 'transparent'],
];
/**
 * What no part of the copy takes from its original, root or not: its pointer events. Every part is made to take
 * none (lookOf), as one given its original's `auto` would take the pointer's release, which would not reach the
 * place under the ghost (#358).
 */
const INERT = /^pointer-events$/;

/**
 * Give a copy the look its original has where it is drawn: the panel's styles hang on its window and its
 * data attributes, which the copy, on the page's body and without them, does not have.
 */
function lookOf(from: Element, to: Element, root: boolean) {
  const look = getComputedStyle(from);
  const style = (to as HTMLElement).style;
  for (const name of Array.from(look)) {
    if (!INERT.test(name) && !(root && PLACED.test(name))) style.setProperty(name, look.getPropertyValue(name));
  }
  style.setProperty('transition', 'none');
  style.setProperty('animation', 'none');
  style.setProperty('pointer-events', 'none');
  // Only the thing itself is carried, as a game (and FreeCol) drags the picture: not the box the page's hover
  // or pick highlight gave the original as it was pressed.
  if (root) for (const [name, value] of BARE) style.setProperty(name, value);
  for (let i = 0; i < from.children.length; i++) lookOf(from.children[i], to.children[i], false);
}

/**
 * A copy of what is dragged that follows the pointer, as it looks on the page and at its size there: the UI
 * scale (CSS zoom) of the window it came from carries over. It takes no pointer events, and the browser
 * scripts and assistive tools do not see it.
 */
function ghostOf(el: Element): { ghost: HTMLElement; half: [number, number] } {
  const box = el.getBoundingClientRect();
  const zoom = (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
  const copy = el.cloneNode(true) as HTMLElement;
  lookOf(el, copy, true);
  for (const e of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of e.getAttributeNames()) {
      if (name === 'id' || name === 'title' || name.startsWith('data-') || name.startsWith('aria-')) {
        e.removeAttribute(name);
      }
    }
  }
  const scaled = document.createElement('div');
  scaled.style.zoom = String(zoom);
  scaled.append(copy);
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.append(scaled);
  document.body.append(ghost);
  return { ghost, half: [box.width / 2, box.height / 2] };
}

const follow = (x: number, y: number) => {
  if (carry) carry.ghost.style.transform = `translate(${x - carry.half[0]}px, ${y - carry.half[1]}px)`;
};

/** Before the page sees a move: start the drag once the press has moved far enough, and move the icon. */
function moving(e: PointerEvent) {
  claim = null;
  if (press && !press.dragged) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
    const { lane, lift, look } = press;
    const thing = lift(e);
    if (thing === null || thing === undefined) return end();
    press.dragged = true;
    carry = { lane, thing, ...ghostOf(look) };
    document.body.dataset.dragging = '';
    getSelection()?.removeAllRanges();
  }
  if (carry) follow(e.clientX, e.clientY);
}

/** After the page has seen a move: mark the place that claimed the thing, or none. */
function moved() {
  if (carry) mark(claim);
}

/** Whether a list's item is lifted to reorder it (sort.ts): that is a drag too. */
let sortingNow = false;
export const sorting = (on: boolean) => {
  sortingNow = on;
  if (on) document.body.dataset.dragging = '';
  else if (!carry) delete document.body.dataset.dragging;
};

/** Whether a thing is being dragged: Escape is the drag's then, and closes no window (frame.tsx's useEscape). */
export const dragging = () => carry !== null || sortingNow;

/** Escape puts the thing back, and does nothing else; the press ends as the pointer lets go. */
function key(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !carry) return;
  e.preventDefault();
  e.stopPropagation();
  putBack();
}

/** Take away the icon and the mark: nothing is dragged any more. */
function putBack() {
  carry?.ghost.remove();
  carry = null;
  mark(null);
  claim = null;
  delete document.body.dataset.dragging;
}

/** What was dragged last, whose click the drag's release makes. */
let source: Element | null = null;

/**
 * The browser clicks the closest element that holds both where a drag was pressed and where it was let go:
 * that click is the drag's, not one on what was dragged or what holds it. Any other click goes through.
 */
function swallow(e: MouseEvent) {
  removeEventListener('click', swallow, true);
  if (!(e.target instanceof Node && source !== null && e.target.contains(source))) return;
  e.preventDefault();
  e.stopPropagation();
}

const released = () => end();

/** End the press or drag, dropping nothing: what a drop does is done by the place, before this. */
function end() {
  const dragged = press?.dragged ? press.el : null;
  putBack();
  press = null;
  removeEventListener('pointermove', moving, true);
  removeEventListener('pointermove', moved);
  removeEventListener('pointerup', released);
  removeEventListener('pointercancel', released, true);
  removeEventListener('keydown', key, true);
  removeEventListener('blur', released);
  if (dragged) {
    source = dragged;
    addEventListener('click', swallow, true);
    setTimeout(() => removeEventListener('click', swallow, true));
  }
}

/** The props of something that can be dragged. */
export interface SourceProps {
  'data-drag': '';
  onPointerDown(e: ReactPointerEvent): void;
  onDragStart(e: ReactDragEvent): void;
}

/** The props of a place that can take what is dragged. */
export interface TargetProps {
  onPointerMove(e: ReactPointerEvent): void;
  onPointerUp(e: ReactPointerEvent): void;
}

/** One kind of drag, whose places take only what is dragged in it. */
export interface Lane<T> {
  /**
   * The props of something that can be dragged.
   *
   * @param lift What it carries, as the drag starts with these keys held, or null to drag nothing.
   * @param look The element whose copy follows the pointer, out of the one pressed; that one by default.
   */
  source(lift: (keys: Keys) => T | null, look?: (el: HTMLElement) => Element | null): SourceProps;
  /**
   * The props of a place that can take what is dragged.
   *
   * @param takes Whether it takes the thing; one that does not leaves it to the place around it.
   * @param drop What a drop there does.
   */
  target(takes: (thing: T) => boolean, drop: (thing: T) => void): TargetProps;
}

/** A new kind of drag. */
export function lane<T>(): Lane<T> {
  const me = {};
  const mine = (takes: (thing: T) => boolean) => carry !== null && carry.lane === me && takes(carry.thing as T);
  return {
    source: (lift, look) => ({
      'data-drag': '',
      onPointerDown: (e) => {
        if (e.button !== 0 || press?.event === e.nativeEvent) return;
        end();
        const el = e.currentTarget as HTMLElement;
        // A touch captures the pointer where it pressed; the drag needs its moves to go to what is under it.
        if (e.pointerType === 'touch') (e.target as Element).releasePointerCapture(e.pointerId);
        press = {
          lane: me,
          lift,
          look: look?.(el) ?? el,
          el,
          x: e.clientX,
          y: e.clientY,
          event: e.nativeEvent,
          dragged: false,
        };
        addEventListener('pointermove', moving, true);
        addEventListener('pointermove', moved);
        addEventListener('pointerup', released);
        addEventListener('pointercancel', released, true);
        addEventListener('keydown', key, true);
        addEventListener('blur', released);
      },
      // The browser's own drag of an image or a selection would end the pointer's events.
      onDragStart: (e) => e.preventDefault(),
    }),
    target: (takes, drop) => ({
      onPointerMove: (e) => {
        if (claim === null && mine(takes)) claim = e.currentTarget;
      },
      onPointerUp: () => {
        if (!mine(takes)) return;
        const thing = carry!.thing as T;
        end();
        drop(thing);
      },
    }),
  };
}
