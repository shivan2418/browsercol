// What a finger or two do on the map (#510), told apart from pointer events and the time: a tap, a double-tap, a
// pan that keeps gliding after a flick, a pinch, and a long press. Pure: pointer.ts feeds it touch events (with
// their clientX/clientY and a time in ms) and acts on what it emits, so tests can drive it with no DOM.

/** Pixels a finger may move before a touch stops being a tap or a press and becomes a pan. */
export const TOUCH_SLOP = 10;
/** Milliseconds a finger rests before it is a long press. */
export const LONG_PRESS_MS = 500;
/** Milliseconds between two taps that make a double-tap. */
export const DOUBLE_TAP_MS = 350;
/** Pixels a second tap may be from the first, if the caller has no better test (the same tile). */
const DOUBLE_TAP_PX = 30;
/** Pixels a millisecond a lifted finger must be moving at to keep the map gliding. */
const GLIDE_MIN = 0.15;
/** Pixels a millisecond the glide slows to before it stops. */
const GLIDE_STOP = 0.02;
/** Milliseconds in which a glide's speed falls to 1/e. */
const GLIDE_DECAY = 300;
/** A finger that stood still this long before lifting does not flick. */
const FLICK_WINDOW = 80;

export type GestureEvent =
  /** A touch that stayed under the slop and lifted; `detail` is 2 for the second tap of a double-tap. */
  | { k: 'tap'; x: number; y: number; detail: 1 | 2 }
  /** The map moves by this many pixels with the finger (and glides on after it lifts). */
  | { k: 'pan'; dx: number; dy: number }
  | { k: 'longPress'; x: number; y: number }
  | { k: 'pinchStart' }
  /** The fingers are `ratio` times as far apart as when the pinch began, about the midpoint (x, y). */
  | { k: 'pinch'; ratio: number; x: number; y: number }
  /** A finger of the pinch lifted: the zoom snaps to a level. */
  | { k: 'pinchEnd' };

export interface Gestures {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number, t: number): void;
  up(id: number, t: number): void;
  cancel(): void;
  /** Advance time: the long press, and the glide. Call each frame while `busy()`. */
  tick(t: number): void;
  /** Whether a finger is down or the map is gliding: time matters. */
  busy(): boolean;
}

interface Finger {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export function createGestures(
  emit: (e: GestureEvent) => void,
  /** Whether two taps are on the same spot (the same tile, say); within DOUBLE_TAP_PX if left out. */
  sameSpot: (a: [number, number], b: [number, number]) => boolean = (a, b) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= DOUBLE_TAP_PX,
): Gestures {
  const fingers = new Map<number, Finger>();
  // pending: one finger, still under the slop. dead: the touch has been used (a press, a pinch): nothing more until all lift.
  let phase: 'idle' | 'pending' | 'pan' | 'pinch' | 'dead' = 'idle';
  let startT = 0;
  let lastT = 0;
  let vx = 0;
  let vy = 0;
  let glide = false;
  let glideT = 0;
  let pinchDist = 1;
  let pinchMid: [number, number] = [0, 0];
  let lastTap: { at: [number, number]; t: number } | null = null;

  const pair = () => {
    const [a, b] = [...fingers.values()];
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number],
    };
  };
  const finish = () => {
    if (!fingers.size) phase = 'idle';
  };

  return {
    down(id, x, y, t) {
      glide = false;
      fingers.set(id, { x, y, startX: x, startY: y });
      if (fingers.size === 1) {
        phase = 'pending';
        startT = lastT = t;
        vx = vy = 0;
      } else if (fingers.size === 2 && phase !== 'dead') {
        phase = 'pinch';
        const p = pair();
        pinchDist = p.dist;
        pinchMid = p.mid;
        emit({ k: 'pinchStart' });
      }
    },
    move(id, x, y, t) {
      const f = fingers.get(id);
      if (!f) return;
      const [dx, dy] = [x - f.x, y - f.y];
      f.x = x;
      f.y = y;
      if (phase === 'pinch' && fingers.size === 2) {
        const p = pair();
        const [mx, my] = [p.mid[0] - pinchMid[0], p.mid[1] - pinchMid[1]];
        pinchMid = p.mid;
        if (mx || my) emit({ k: 'pan', dx: mx, dy: my });
        emit({ k: 'pinch', ratio: p.dist / pinchDist, x: p.mid[0], y: p.mid[1] });
        return;
      }
      if (fingers.size !== 1) return;
      if (phase === 'pending' && Math.hypot(x - f.startX, y - f.startY) > TOUCH_SLOP) {
        phase = 'pan';
        // The slop is paid back at once, so the map is under the finger as it would have been.
        emit({ k: 'pan', dx: x - f.startX, dy: y - f.startY });
        lastT = t;
        return;
      }
      if (phase === 'pan') {
        const dt = Math.max(1, t - lastT);
        vx = vx * 0.5 + (dx / dt) * 0.5;
        vy = vy * 0.5 + (dy / dt) * 0.5;
        lastT = t;
        if (dx || dy) emit({ k: 'pan', dx, dy });
      }
    },
    up(id, t) {
      const f = fingers.get(id);
      if (!f) return;
      fingers.delete(id);
      if (phase === 'pinch') {
        emit({ k: 'pinchEnd' });
        phase = 'dead';
      } else if (phase === 'pending' && t - startT >= LONG_PRESS_MS) {
        // Held long enough, but no frame ran to say so (a busy page): the lift finds it a long press.
        lastTap = null;
        emit({ k: 'longPress', x: f.x, y: f.y });
      } else if (phase === 'pending') {
        const at: [number, number] = [f.x, f.y];
        const second = lastTap && t - lastTap.t <= DOUBLE_TAP_MS && sameSpot(lastTap.at, at);
        lastTap = second ? null : { at, t };
        emit({ k: 'tap', x: f.x, y: f.y, detail: second ? 2 : 1 });
      } else if (phase === 'pan') {
        const flick = t - lastT <= FLICK_WINDOW && Math.hypot(vx, vy) >= GLIDE_MIN;
        if (flick) {
          glide = true;
          glideT = t;
        }
      }
      finish();
    },
    cancel() {
      fingers.clear();
      glide = false;
      if (phase === 'pinch') emit({ k: 'pinchEnd' });
      phase = 'idle';
    },
    tick(t) {
      if (phase === 'pending' && fingers.size === 1 && t - startT >= LONG_PRESS_MS) {
        const f = [...fingers.values()][0];
        phase = 'dead';
        lastTap = null;
        emit({ k: 'longPress', x: f.x, y: f.y });
      }
      if (glide) {
        const dt = Math.min(50, Math.max(0, t - glideT));
        glideT = t;
        emit({ k: 'pan', dx: vx * dt, dy: vy * dt });
        const decay = Math.exp(-dt / GLIDE_DECAY);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) < GLIDE_STOP) glide = false;
      }
    },
    busy: () => fingers.size > 0 || glide,
  };
}
