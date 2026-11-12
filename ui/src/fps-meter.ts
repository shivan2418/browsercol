// A frame-rate meter for looking at how smoothly the page draws (?fps, or the
// Debug menu's Show Frame Rate). It counts the browser's animation frames, so it
// shows what the player sees: the frames per second over the last second, and
// the longest frame in it, the one a player feels as a stutter. Plain DOM, no
// React, so showing it adds next to nothing to what it measures.
import './fps-meter.css';

/** What the meter shows for one second of frame intervals, in milliseconds. */
export function frameStats(intervals: readonly number[]): { fps: number; worst: number } {
  const total = intervals.reduce((s, ms) => s + ms, 0);
  return {
    fps: total > 0 ? Math.round((intervals.length * 1000) / total) : 0,
    worst: intervals.length ? Math.round(Math.max(...intervals)) : 0,
  };
}

/** The meter's text: frames per second, the longest frame, and what draws the map. */
export function meterText(stats: { fps: number; worst: number }, renderer: string): string {
  return `${stats.fps} fps · worst ${stats.worst} ms · ${renderer}`;
}

export interface FpsMeter {
  shown(): boolean;
  show(on: boolean): void;
}

/** A meter in `host`'s top-left corner, hidden until shown. `renderer` names what draws the map, read each second. */
export function fpsMeter(host: HTMLElement, renderer: () => string): FpsMeter {
  const box = document.createElement('div');
  box.className = 'fps-meter';
  box.setAttribute('aria-hidden', 'true');
  let frame = 0;
  let last = 0;
  let since = 0;
  let intervals: number[] = [];
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (last) intervals.push(now - last);
    last = now;
    if (!since) since = now;
    if (now - since >= 1000) {
      box.textContent = meterText(frameStats(intervals), renderer().split(' ')[0]);
      intervals = [];
      since = now;
    }
  };
  return {
    shown: () => frame !== 0,
    show(on) {
      if (on === (frame !== 0)) return;
      if (on) {
        box.textContent = '… fps';
        host.append(box);
        last = since = 0;
        intervals = [];
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        box.remove();
      }
    },
  };
}
