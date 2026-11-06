// Test helper for the hints of src/controls.tsx (`Tip`): hover an element the way a player does and read
// what the hint says. A hint is Base UI's one popup, in a portal, after a short rest, so this mounts the
// layer once and waits for it.
import { act, fireEvent, waitFor } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { expect } from 'vite-plus/test';
import { TooltipLayer } from './controls';

let mounted = false;

export function mountLayer() {
  if (mounted) return;
  mounted = true;
  const host = document.createElement('div');
  document.body.append(host);
  act(() => createRoot(host).render(<TooltipLayer />));
}

/** What the open hint says, or null when there is none. */
export function shownHint(): string | null {
  return document.querySelector('.ui-tip')?.textContent ?? null;
}

/** Rest the pointer on an element, wait for its hint, and return the text (leaving again afterwards). */
export async function hint(el: Element): Promise<string> {
  mountLayer();
  fireEvent.pointerEnter(el, { pointerType: 'mouse' });
  fireEvent.mouseEnter(el);
  fireEvent.pointerMove(el, { pointerType: 'mouse' });
  fireEvent.mouseMove(el);
  let text = '';
  await waitFor(() => {
    const now = shownHint();
    expect(now).not.toBeNull();
    text = now!;
  });
  fireEvent.pointerLeave(el, { pointerType: 'mouse' });
  fireEvent.mouseLeave(el);
  await waitFor(() => expect(shownHint()).toBeNull());
  return text;
}
