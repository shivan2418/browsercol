// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { Select, Tip, TipProvider } from './controls';
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

test('no hint while something is dragged, and one open goes at the drag’s start', async () => {
  render(
    <Tip as="span" tip="Hint">
      x
    </Tip>,
  );
  const x = screen.getByText('x');
  rest(x);
  await waitFor(() => expect(shownHint()).toBe('Hint'));
  fireEvent.dragStart(x);
  await waitFor(() => expect(shownHint()).toBeNull());
  leave(x);
  rest(x);
  await wait(450);
  expect(shownHint()).toBeNull();
  // Once the drag has ended hints are back.
  fireEvent.dragEnd(x);
  leave(x);
  expect(await hint(x)).toBe('Hint');
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
