// Test helpers for the drop-down lists of src/controls.tsx: open one the way a player does, read its
// choices and pick one. The list opens a frame after the press and is in a portal, so these wait for it
// and look in the document, not in the dialog.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

/** Open a drop-down list (its button) with the pointer, and wait until its options are on screen. */
export async function openSelect(trigger: Element) {
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseUp(trigger, { button: 0 });
  });
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
  await waitFor(() => expect(options()).not.toEqual([]));
}

/** The options of the open list, in order (none when it is shut: Base UI keeps a shut list's items, hidden, for typing on the button). */
export function listed(): string[] {
  return options().map((o) => o.textContent ?? '');
}

/** The option elements of the open list (not the options of a panel's own listbox). */
function options(): HTMLElement[] {
  return screen
    .queryAllByRole('listbox')
    .filter((l) => l.closest('.ui-select-popup'))
    .flatMap((l) => within(l).queryAllByRole('option'));
}

/** What a drop-down list's button shows. */
export function shown(trigger: Element): string {
  return trigger.textContent?.replace(/▾$/, '') ?? '';
}

/** Open a drop-down list and pick the option with this text. */
export async function chooseOption(trigger: Element, text: string) {
  await openSelect(trigger);
  const item = options().find((o) => o.textContent === text);
  if (!item) throw new Error(`No option "${text}" in ${JSON.stringify(listed())}`);
  await act(async () => {
    fireEvent.pointerDown(item, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(item, { button: 0 });
    fireEvent.pointerUp(item, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseUp(item, { button: 0 });
    fireEvent.click(item, { button: 0 });
  });
  await waitFor(() => expect(listed()).toEqual([]));
}
