// A tab that opens when a dragged thing rests on it, so that a thing can be carried to a place on another tab
// (a phone's tab rail, where the places are not all on screen at once). The tab's own click is unchanged.
import { useEffect, useRef } from 'react';
import { carrying } from './drag';

/** How long, in milliseconds, a dragged thing rests on a tab before it opens. */
export const TAB_HOVER_MS = 500;

/**
 * The props that make a tab open once a thing dragged (drag.ts) has rested on it for a moment. Nothing happens for
 * a pointer that carries nothing, so hovering with a mouse is as before.
 *
 * @param open Show the tab.
 * @param ms How long the thing rests on it first.
 */
export function useTabHover(open: () => void, ms = TAB_HOVER_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(open);
  latest.current = open;
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return {
    onPointerEnter() {
      stop();
      if (!carrying()) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (carrying()) latest.current();
      }, ms);
    },
    onPointerLeave: stop,
    onPointerUp: stop,
  };
}
