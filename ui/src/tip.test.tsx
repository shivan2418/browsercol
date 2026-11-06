// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { NumberField, Select, Tip, TipProvider } from './controls';
import * as drag from './drag';
import { WindowFrame } from './frame';
import { hint, mountLayer, shownHint } from './tip-test';

afterEach(cleanup);
beforeEach(mountLayer);

const rest = (el: Element) => {
  fireEvent.pointerEnter(el, { pointerType: 'mouse' });
  fireEvent.mouseEnter(el);
  fireEvent.pointerMove(el, { pointerType: 'mouse' });
  fireEvent.mouseMove(el);
};
const leave = (el: Element) => {
  fireEvent.pointerLeave(el, { pointerType: 'mouse' });
  fireEvent.mouseLeave(el);
};
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

test('an element with a tip shows it after a short rest, in the popup class that takes the UI scale', async () => {
  const layer = document.body.appendChild(document.createElement('div'));
  layer.id = 'overlays';
  render(
    <Tip as="button" tip={'Line one\nLine two'}>
      Go
    </Tip>,
  );
  const button = screen.getByRole('button', { name: 'Go' });
  expect(button.hasAttribute('title')).toBe(false);
  expect(await hint(button)).toBe('Line one\nLine two');
  rest(button);
  await waitFor(() => expect(layer.querySelector('.ui-popup.ui-tip')).not.toBeNull());
  layer.remove();
});

test('an element with no tip is a plain element', async () => {
  render(
    <Tip as="span" tip={undefined} data-x="1">
      Plain
    </Tip>,
  );
  rest(screen.getByText('Plain'));
  await wait(400);
  expect(shownHint()).toBeNull();
});

test('disabled stays the button’s own: the button is disabled and a tooltip trigger', () => {
  // (A real browser sends the pointer events of a disabled button, Chromium and Firefox both; jsdom does not.)
  render(
    <Tip as="button" tip="Not yet" disabled>
      Build
    </Tip>,
  );
  const button = screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute('data-base-ui-tooltip-trigger')).toBe(true);
  expect(button.hasAttribute('data-trigger-disabled')).toBe(false);
});

test('after one hint, the next shows at once', async () => {
  render(
    <TipProvider>
      <Tip as="span" tip="First">
        a
      </Tip>
      <Tip as="span" tip="Second">
        b
      </Tip>
    </TipProvider>,
  );
  const a = screen.getByText('a');
  const b = screen.getByText('b');
  rest(a);
  await waitFor(() => expect(shownHint()).toBe('First'));
  leave(a);
  rest(b);
  // The rest delay is 300 ms; the next one needs none.
  await waitFor(() => expect(shownHint()).toBe('Second'), { timeout: 150 });
});

test('no hint while something is dragged with the pointer, and one open goes at the drag’s start', async () => {
  const lane = drag.lane<string>();
  render(
    <>
      <Tip as="span" tip="Hint" {...lane.source(() => 'thing')}>
        x
      </Tip>
      <Tip as="span" tip="Other">
        z
      </Tip>
    </>,
  );
  const x = screen.getByText('x');
  const z = screen.getByText('z');
  rest(x);
  await waitFor(() => expect(shownHint()).toBe('Hint'));
  // Press and move far enough: the drag (drag.ts) starts and the hint goes.
  const fire = (el: Element, type: string, at: number) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at, clientY: 0 }));
  fire(x, 'pointerdown', 0);
  fire(x, 'pointermove', 2 * drag.THRESHOLD);
  expect(drag.dragging()).toBe(true);
  await waitFor(() => expect(shownHint()).toBeNull());
  // Over another element during the drag, nothing shows.
  leave(x);
  rest(z);
  fire(z, 'pointermove', 3 * drag.THRESHOLD);
  await wait(450);
  expect(shownHint()).toBeNull();
  // Once the drag has ended hints are back.
  fire(z, 'pointerup', 3 * drag.THRESHOLD);
  expect(drag.dragging()).toBe(false);
  leave(z);
  expect(await hint(z)).toBe('Other');
});

test('no hint while a menu is open', async () => {
  render(
    <>
      <div role="menu" />
      <Tip as="span" tip="Hint">
        y
      </Tip>
    </>,
  );
  rest(screen.getByText('y'));
  await wait(450);
  expect(shownHint()).toBeNull();
});

test('Escape closes the hint only, not the window under it', async () => {
  const close = vi.fn();
  render(
    <WindowFrame title="Window" close={close}>
      <Tip as="span" tip="Hint">
        z
      </Tip>
    </WindowFrame>,
  );
  const z = screen.getByText('z');
  rest(z);
  await waitFor(() => expect(shownHint()).toBe('Hint'));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(shownHint()).toBeNull());
  expect(close).not.toHaveBeenCalled();
});

test('a hint goes with its element when that is removed while it shows', async () => {
  const { rerender } = render(
    <Tip as="span" tip="Hint">
      v
    </Tip>,
  );
  rest(screen.getByText('v'));
  await waitFor(() => expect(shownHint()).toBe('Hint'));
  rerender(<div />);
  await waitFor(() => expect(shownHint()).toBeNull(), { timeout: 500 });
});

test('no hint while a drop-down list is open', async () => {
  render(
    <>
      <Select value="a" onChange={() => {}} choices={[{ value: 'a', label: 'Apple' }]} aria-label="Fruit" />
      <Tip as="span" tip="Hint">
        w
      </Tip>
    </>,
  );
  fireEvent.pointerDown(screen.getByLabelText('Fruit'), { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(screen.getByLabelText('Fruit'), { button: 0 });
  fireEvent.pointerUp(screen.getByLabelText('Fruit'), { button: 0, pointerType: 'mouse' });
  fireEvent.mouseUp(screen.getByLabelText('Fruit'), { button: 0 });
  await waitFor(() => expect(document.querySelector('.ui-select-popup')).not.toBeNull());
  rest(screen.getByText('w'));
  await wait(450);
  expect(shownHint()).toBeNull();
});

test('a number field gives its hint over the field, and is no type=number input', async () => {
  render(<NumberField aria-label="Low" value={3} onChange={() => {}} tip="The lowest level" />);
  const input = screen.getByRole('textbox', { name: 'Low' });
  expect(input.getAttribute('type')).not.toBe('number');
  expect(input.hasAttribute('title')).toBe(false);
  expect(await hint(input.parentElement!)).toBe('The lowest level');
});
