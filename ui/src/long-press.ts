// Long-press: a finger held still on something for about half a second. On touch it stands in for what a mouse
// does with a right-click (a menu) and with hovering (a tooltip), neither of which a finger has.
//
// Elements offer what they would do when pressed (from a pointerdown capture handler, outermost first); the one press recognizer waits, and when the hold completes
// it does the most specific offer: a menu over a tooltip, and the innermost of its kind. A tooltip's text then
// heads the menu, so an element with both loses nothing. Only touch is recognized, event by event, so a
// mouse (or a hybrid device's mouse) keeps right-click and hover as they are.
import { cancelPress, dragging } from './drag';

/** How long a finger holds before it is a long-press, in milliseconds (the platforms' own are 400 to 500). */
export const HOLD_MS = 500;

/** How far, in CSS pixels, the finger may drift while it holds. A drag (drag.ts) starts well inside it. */
export const SLOP = 10;

/** Where the hold was. */
export interface At {
  x: number;
  y: number;
}

/** What an element would do on a long-press. */
export interface Offer {
  /** A menu is done in preference to a tip. */
  kind: 'menu' | 'tip';
  /** The tooltip's words, when it has plain ones: they head a menu offered by the same press. */
  text?: string;
  /** Do it; a menu gets the text of the tip that was offered with it, if any. */
  fire(at: At, heading?: string): void;
}

/** The parts of a pointer event the recognizer reads. */
export interface PointerLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

interface Hold {
  /** The pointer event that pressed, so the same press offered by several elements counts once. */
  event: object;
  pointerId: number;
  x: number;
  y: number;
  offers: Offer[];
  timer: ReturnType<typeof setTimeout>;
}

let hold: Hold | null = null;
/** When the last long-press fired, as a touch's own contextmenu event follows it (Android) and must not open a second menu. */
let firedAt = -Infinity;
/** Whether a touch is down on something that offers a hold, and has not moved, lifted or fired yet. */
let touching = false;

/** The contextmenu event Chromium makes of a long-press comes with or just after the hold: the hold has done it. */
const CONTEXT_GRACE_MS = 1000;

/** Whether a touch long-press made this contextmenu event (and it should do nothing but not show the browser's menu). */
export function fromTouch(now = Date.now()): boolean {
  return touching || now - firedAt < CONTEXT_GRACE_MS;
}

/** The last offer of a kind: elements offer outermost first (a capture handler's order), so it is the innermost. */
const innermost = (offers: Offer[], kind: Offer['kind']) => offers.findLast((o) => o.kind === kind);

/** The offer the hold does: a menu if any was offered, else a tip; the innermost of its kind. */
export function choose(offers: Offer[]): Offer | undefined {
  return innermost(offers, 'menu') ?? innermost(offers, 'tip');
}

function listen(on: boolean) {
  const f = on ? addEventListener : removeEventListener;
  f('pointermove', moved, true);
  f('pointerup', ended, true);
  f('pointercancel', ended, true);
  f('pointerdown', another, true);
  f('scroll', abandon, true);
  f('blur', abandon);
}

function abandon() {
  touching = false;
  if (!hold) return;
  clearTimeout(hold.timer);
  hold = null;
  listen(false);
}

function moved(e: PointerEvent) {
  if (!hold || e.pointerId !== hold.pointerId) return;
  if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP || dragging()) abandon();
}

function ended(e: PointerEvent) {
  if (hold && e.pointerId === hold.pointerId) abandon();
}

/** A second finger is a pinch or a two-finger gesture, not a hold. */
function another(e: PointerEvent) {
  if (hold && e.pointerId !== hold.pointerId) abandon();
}

/** The click a lifted finger makes after a long-press belongs to the hold, not to what was held. */
function swallowClick() {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener('click', swallow, true);
  setTimeout(() => removeEventListener('click', swallow, true), 600);
}

function fire(h: Hold) {
  if (hold !== h) return;
  const at = { x: h.x, y: h.y };
  abandon();
  // From here the grace period stands in for the touch.
  firedAt = Date.now();
  if (dragging()) return;
  const offer = choose(h.offers);
  if (!offer) return;
  // Once the hold is a menu or a tip the press is not the start of a drag any more.
  cancelPress();
  swallowClick();
  const tip = h.offers.findLast((o) => o.kind === 'tip' && o.text);
  offer.fire(at, offer.kind === 'menu' ? tip?.text : undefined);
}

/**
 * A press of an element that would do something on a long-press: call it from the element's pointerdown. Mouse
 * and pen are ignored; the same event offered by an element and the ones around it is one hold.
 */
export function offerHold(e: PointerLike & { nativeEvent?: object }, offer: Offer, delay = HOLD_MS) {
  if (e.pointerType !== 'touch') return;
  const event = e.nativeEvent ?? e;
  if (hold && hold.event === event) {
    hold.offers.push(offer);
    return;
  }
  abandon();
  touching = true;
  const h: Hold = { event, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offers: [offer], timer: undefined! };
  h.timer = setTimeout(() => fire(h), delay);
  hold = h;
  listen(true);
}

/** Forget any hold under way and the touch state (for tests). */
export function resetHold() {
  abandon();
  touching = false;
  firedAt = -Infinity;
}

/** What an element spreads to offer a hold; the offer may depend on the press, or be null for none. */
export interface HoldProps {
  /** Capture, so the drag's own `onPointerDown` on the same element is not replaced. */
  onPointerDownCapture(e: PointerLike & { nativeEvent: object }): void;
  /** CSS keeps the browser's own long-press (callout, selection) off it. */
  'data-hold': '';
}

export function holdProps(offer: (e: PointerLike) => Offer | null): HoldProps {
  return {
    onPointerDownCapture: (e) => {
      const o = e.pointerType === 'touch' ? offer(e) : null;
      if (o) offerHold(e, o);
    },
    'data-hold': '',
  };
}
