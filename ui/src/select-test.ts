// Test helpers for the drop-down lists of src/controls.tsx: open one the way a player does, read its
// choices and pick one. The list opens a frame after the press and is in a portal, so these wait for it
// and look in the document, not in the dialog.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

/**
 * How long to wait for the list to open or shut. Testing Library's 1 s default is too short when dozens of
 * workers share the machine (#304, #335): Base UI mounts the popup a frame after the press and unmounts it
 * after its exit transition, and a starved worker gets those frames late. The test timeout (vite.config.ts) is longer.
 */
const LIST_TIMEOUT = 10_000;

/** A mouse press and release on an element. */
function press(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseUp(el, { button: 0 });
}

/**
 * Open a drop-down list (its button) with the pointer, and wait until its options are on screen. A list that is
 * already open stays open: pressing its button again would shut it, and a test that opens the list to read it and
 * then picks from it (chooseOption) would race the closing, which a loaded machine loses (#304, #335).
 */
export async function openSelect(trigger: Element) {
  if (trigger.getAttribute('aria-expanded') !== 'true') await act(async () => press(trigger));
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'), { timeout: LIST_TIMEOUT });
  await waitFor(() => expect(options()).not.toEqual([]), { timeout: LIST_TIMEOUT });
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
    press(item);
    fireEvent.click(item, { button: 0 });
  });
  await waitFor(() => expect(listed()).toEqual([]), { timeout: LIST_TIMEOUT });
}
