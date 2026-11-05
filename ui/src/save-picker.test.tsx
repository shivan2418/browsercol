// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import { OpenDialog, SaveDialog } from './save-picker';

afterEach(cleanup);

test('the Open window lists the saves and opens the one picked', () => {
  const opened: number[] = [];
  let closed = 0;
  const save = { id: 4, name: 'Dutch, turn 3', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  render(<OpenDialog saves={[save]} open={(id) => opened.push(id)} close={() => closed++} />);
  fireEvent.click(document.querySelector('[data-open-save="4"]')!);
  fireEvent.click(document.querySelector('[data-open-cancel]')!);
  expect(opened).toEqual([4]);
  expect(closed).toBe(1);
});

test('the Save window saves under the name typed, or the default one when it is left empty', () => {
  const names: string[] = [];
  render(<SaveDialog title="Save Game" save={(n) => names.push(n)} close={() => {}} />);
  fireEvent.click(document.querySelector('[data-save-ok]')!);
  fireEvent.change(document.querySelector('[data-save-name]')!, { target: { value: 'Before the war' } });
  fireEvent.click(document.querySelector('[data-save-ok]')!);
  expect(names).toEqual(['', 'Before the war']);
});
