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
//
// A finger can also move a thing in two taps: a tap on something that can be dragged picks it up (it takes
// the data-picked look, selection.css), and a tap on a place that takes it drops it there, by the place's own
// drop, as a drag onto it would. A tap on the picked thing again, on any other spot, or Escape puts it back;
// a tap on another thing picks that one instead. This is decided per pointer event, by its pointerType: a
// mouse (or a hybrid device's mouse) only drags, as before.
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import './drag.css';

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
  /** Whether a finger pressed, and whether a tap on it may pick the thing up. */
  touch: boolean;
  tap: boolean;
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
    // Dragging has begun: what was picked by a tap is not the thing in hand any more.
    putDown();
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

/** Whether a thing is being carried along by the pointer (not just picked by a tap, nor a list's item lifted). */
export const carrying = () => carry !== null;

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

/** The thing a tap picked up, its lane, and the element tapped, which wears the data-picked look. */
interface Pick {
  lane: object;
  thing: unknown;
  el: Element;
}
let pick: Pick | null = null;

/** How far, in CSS pixels, a finger may drift and still tap (the long press's own slop, long-press.ts). */
export const TAP_SLOP = 10;

/** The finger now down: it taps if it lifts without having moved far, or been held to a long-press, or been joined. */
let finger: { id: number; x: number; y: number; void: boolean } | null = null;
/** Whether the finger that just lifted tapped; read by the places and sources as the lift bubbles. */
let tapNow = false;
/** Whether a place took the tap as a drop, so the tap is no pick or put-down besides. */
let tapDropped = false;
/** When the last tap lifted: the click the browser makes of it follows within moments. */
let tappedAt = -Infinity;

/** Whether a click is the one a tap made, which the pick machinery has already handled: a thing's own click must not repeat it. */
export const fromTap = (now = Date.now()) => now - tappedAt < 700;

/** Whether something is picked up by a tap, and waits for a place. */
export const picked = () => pick !== null;

/** Put down what a tap picked up, where it was. */
function putDown() {
  if (!pick) return;
  pick.el.removeAttribute('data-picked');
  pick = null;
  removeEventListener('keydown', pickKey, true);
}

function pickKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !pick) return;
  e.preventDefault();
  e.stopPropagation();
  putDown();
}

/** Pick up what a tapped source carries, or put it down if it is the one already picked. */
function toggle(p: Press) {
  if (pick && pick.el === p.el) return putDown();
  const thing = p.lift({ shiftKey: false, altKey: false });
  putDown();
  if (thing === null || thing === undefined) return;
  pick = { lane: p.lane, thing, el: p.el };
  p.el.setAttribute('data-picked', '');
  addEventListener('keydown', pickKey, true);
}

/** The click that follows a tap which dropped something is the drop's: no button or building under it answers it. */
function swallowTap() {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener('click', swallow, true);
  setTimeout(() => removeEventListener('click', swallow, true), 600);
}

function touchDown(e: PointerEvent) {
  tapNow = false;
  tapDropped = false;
  if (e.pointerType !== 'touch') return void (finger = null);
  // A second finger makes no tap of the first.
  if (finger && finger.id !== e.pointerId) finger.void = true;
  else finger = { id: e.pointerId, x: e.clientX, y: e.clientY, void: false };
  if (pick && !pick.el.isConnected) putDown();
}

function touchMove(e: PointerEvent) {
  if (finger && finger.id === e.pointerId && Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > TAP_SLOP)
    finger.void = true;
}

function touchUp(e: PointerEvent) {
  if (!finger || finger.id !== e.pointerId) return;
  tapNow = !finger.void;
  if (tapNow) tappedAt = Date.now();
  finger = null;
}

/** After the places: a tap that dropped nothing picks up the source it pressed, or puts down what was picked. */
function tapped(e: PointerEvent) {
  const tap = tapNow;
  tapNow = false;
  const dropped = tapDropped;
  tapDropped = false;
  if (!tap || dropped || e.pointerType !== 'touch') return;
  if (press && press.touch && press.tap && !press.dragged) toggle(press);
  else putDown();
}

let listening = false;
/** The window's listeners for taps, once: they run before a press's own, and the places' (React's) between. */
function listen() {
  if (listening || typeof addEventListener !== 'function') return;
  listening = true;
  addEventListener('pointerdown', touchDown, true);
  addEventListener('pointermove', touchMove, true);
  addEventListener('pointercancel', () => (finger = null), true);
  addEventListener('pointerup', touchUp, true);
  addEventListener('pointerup', tapped);
}

/** What inside a source answers a tap itself, so the tap picks nothing up. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/** Whether a tap on `target`, inside the source `el`, is the source's: not a button or link of its own inside it. */
const ownTap = (target: Element, el: Element) => {
  const inner = target.closest?.(INTERACTIVE);
  return !inner || inner === el || !el.contains(inner);
};

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
   * @param tap Whether a finger's tap picks it up (the default); false where a tap already does what is wanted.
   */
  source(lift: (keys: Keys) => T | null, look?: (el: HTMLElement) => Element | null, tap?: boolean): SourceProps;
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
  listen();
  const mine = (takes: (thing: T) => boolean) => carry !== null && carry.lane === me && takes(carry.thing as T);
  return {
    source: (lift, look, tap = true) => ({
      'data-drag': '',
      onPointerDown: (e) => {
        if (e.button !== 0 || press?.event === e.nativeEvent) return;
        end();
        const el = e.currentTarget as HTMLElement;
        // A touch captures the pointer where it pressed; the drag needs its moves to go to what is under it.
        if (e.pointerType === 'touch') (e.target as Element).releasePointerCapture?.(e.pointerId);
        press = {
          lane: me,
          lift,
          look: look?.(el) ?? el,
          el,
          x: e.clientX,
          y: e.clientY,
          event: e.nativeEvent,
          dragged: false,
          touch: e.pointerType === 'touch',
          // A button or link inside the source keeps its own tap.
          tap: tap && ownTap(e.target as Element, el),
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
      onPointerUp: (e) => {
        if (tapNow && pick && pick.lane === me && takes(pick.thing as T) && !pick.el.contains(e.target as Node)) {
          const thing = pick.thing as T;
          putDown();
          tapDropped = true;
          swallowTap();
          return drop(thing);
        }
        if (!mine(takes)) return;
        const thing = carry!.thing as T;
        end();
        drop(thing);
      },
    }),
  };
}

/** Let go of a press that has not become a drag: a long-press took it (long-press.ts), so moving on will not drag. */
export const cancelPress = () => {
  // The finger held: it was no tap either.
  if (finger) finger.void = true;
  if (!carry) end();
};
