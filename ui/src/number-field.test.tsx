// @vitest-environment jsdom
// The number field of src/controls.tsx (#261): what replaces the browser's spinner.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test } from 'vite-plus/test';
import { NumberField } from './controls';
import { TEXT_ENTRY } from './frame';

afterEach(cleanup);

function Harness({ start = 5, min = 0, max = 10 }: { start?: number | null; min?: number; max?: number }) {
  const [value, setValue] = useState<number | null>(start);
  return (
    <>
      <NumberField aria-label="Amount" value={value} onChange={setValue} min={min} max={max} />
      <output>{value === null ? 'empty' : value}</output>
    </>
  );
}

const field = () => screen.getByLabelText<HTMLInputElement>('Amount');
const out = () => document.querySelector('output')?.textContent;

test('the ▲ and ▼ buttons step the value, up to the most and down to the least', () => {
  render(<Harness start={9} />);
  fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
  expect(out()).toBe('10');
  fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
  expect(out()).toBe('10');
  for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
  expect(out()).toBe('0');
});

test('the arrow keys step, and Page Up and Page Down step by ten', () => {
  render(<Harness start={5} min={0} max={100} />);
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(out()).toBe('6');
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(out()).toBe('4');
  fireEvent.keyDown(field(), { key: 'PageUp' });
  expect(out()).toBe('14');
  fireEvent.keyDown(field(), { key: 'PageDown' });
  expect(out()).toBe('4');
});

test('the wheel over the focused field steps it', () => {
  render(<Harness start={5} />);
  field().focus();
  fireEvent.wheel(field(), { deltaY: -100 });
  expect(out()).toBe('6');
  fireEvent.wheel(field(), { deltaY: 100 });
  fireEvent.wheel(field(), { deltaY: 100 });
  expect(out()).toBe('4');
});

test('what is typed is passed on even out of range, and emptying passes null', () => {
  render(<Harness start={5} />);
  fireEvent.change(field(), { target: { value: '11' } });
  expect(out()).toBe('11');
  fireEvent.change(field(), { target: { value: '' } });
  expect(out()).toBe('empty');
});

test('a key typed in the field is text, not a shortcut, and so is one on a step button', () => {
  render(<Harness />);
  expect(field().matches(TEXT_ENTRY)).toBe(true);
  expect(screen.getByRole('button', { name: 'Increase' }).matches(TEXT_ENTRY)).toBe(true);
});
