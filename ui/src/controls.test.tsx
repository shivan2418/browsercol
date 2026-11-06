// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import css from '../index.html?raw';
import { Select } from './controls';
import { WindowFrame } from './frame';
import { chooseOption, listed, openSelect, shown } from './select-test';

afterEach(cleanup);

const CHOICES = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: '', label: 'Nothing' },
];

function Demo({ close = () => {} }: { close?: () => void }) {
  const [v, setV] = useState('a');
  return (
    <WindowFrame title="Window" close={close}>
      <label>
        Fruit <Select value={v} onChange={setV} choices={CHOICES} />
      </label>
    </WindowFrame>
  );
}

test('a list shows the value, opens with its choices and a pick changes it', async () => {
  render(<Demo />);
  const trigger = screen.getByLabelText('Fruit');
  expect(shown(trigger)).toBe('Apple');
  await openSelect(trigger);
  expect(listed()).toEqual(['Apple', 'Banana', 'Nothing']);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(listed()).toEqual([]));
  await chooseOption(trigger, 'Nothing');
  expect(shown(trigger)).toBe('Nothing');
  expect(listed()).toEqual([]);
});

test('Escape on an open list closes the list only, not the window under it', async () => {
  const close = vi.fn();
  render(<Demo close={close} />);
  await openSelect(screen.getByLabelText('Fruit'));
  expect(listed()).toHaveLength(3);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(listed()).toEqual([]));
  expect(close).not.toHaveBeenCalled();
  // With the list shut, the next Escape closes the window as before.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
});

test('the list is drawn in #overlays, in the popup class that takes the UI scale', async () => {
  const layer = document.body.appendChild(document.createElement('div'));
  layer.id = 'overlays';
  render(<Demo />);
  await openSelect(screen.getByLabelText('Fruit'));
  const popup = layer.querySelector('.ui-popup');
  expect(popup?.querySelectorAll('[role="option"]')).toHaveLength(3);
  // index.html scales the popup, not the positioner Base UI places in real pixels.
  expect(css).toMatch(/\.ui-popup\s*\{[^}]*zoom:\s*var\(--ui-zoom, 1\)/);
  expect(css).not.toMatch(/\.ui-positioner\s*\{[^}]*zoom/);
  layer.remove();
});
