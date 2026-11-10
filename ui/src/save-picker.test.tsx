// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import { OpenDialog, SaveDialog } from './save-picker';

afterEach(cleanup);

test('the Open window lists the saves and opens the one selected with Open', () => {
  const opened: number[] = [];
  let closed = 0;
  const save = { id: 4, name: 'Dutch, turn 3', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  const other = { ...save, id: 5, name: 'Other' };
  render(<OpenDialog saves={[save, other]} open={(id) => opened.push(id)} close={() => closed++} />);
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  fireEvent.click(document.querySelector('[data-open-save="5"]')!);
  expect(opened).toEqual([]);
  expect(document.querySelector('[data-open-save="5"]')!.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(document.querySelector('[data-open-selected]')!);
  fireEvent.click(document.querySelector('[data-open-cancel]')!);
  expect(opened).toEqual([5]);
  expect(closed).toBe(1);
});

test('a double click opens a save, and the arrow keys and Enter pick and open one', () => {
  const opened: number[] = [];
  const save = { id: 4, name: 'A', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  const saves = [save, { ...save, id: 5, name: 'B' }, { ...save, id: 6, name: 'C' }];
  render(<OpenDialog saves={saves} open={(id) => opened.push(id)} close={() => {}} />);
  fireEvent.doubleClick(document.querySelector('[data-open-save="6"]')!);
  const list = screen.getByRole('listbox');
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'ArrowUp' });
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(opened).toEqual([6, 5]);
  expect(document.querySelector('[data-open-save="5"]')!.getAttribute('aria-selected')).toBe('true');
});

test('a row shows the name, the date, the turn and year, and the nation apart', () => {
  const save = { id: 4, name: 'Dutch, turn 3', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  render(<OpenDialog saves={[save]} open={() => {}} close={() => {}} />);
  expect(document.querySelector('.save-name')!.textContent).toBe('Dutch, turn 3');
  expect(document.querySelector('[data-save-turn]')!.textContent).toBe('Turn 3 (1495)');
  expect(document.querySelector('[data-save-nation]')!.textContent).toBe('Dutch');
});

test('the Save window lists the existing saves for reference, and picking one saves nothing', () => {
  const names: string[] = [];
  const save = { id: 4, name: 'Before the war', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  render(<SaveDialog title="Save Game" saves={[save]} save={(n) => names.push(n)} close={() => {}} />);
  const row = document.querySelector('[data-saved="4"]')!;
  expect(row.textContent).toContain('Before the war');
  fireEvent.click(row);
  fireEvent.doubleClick(row);
  expect(names).toEqual([]);
});

test('the Open window opens a save file too, and says why one would not open', () => {
  let asked = 0;
  render(
    <OpenDialog
      saves={[]}
      open={() => {}}
      openFile={() => asked++}
      note="Could not open the file: not a zip"
      close={() => {}}
    />,
  );
  fireEvent.click(document.querySelector('[data-open-file]')!);
  expect(asked).toBe(1);
  expect(document.querySelector('#open-game')!.textContent).toContain('Could not open the file: not a zip');
});

test('the Open window offers Export save... on each save, and shows what became of it', () => {
  const exported: number[] = [];
  const save = { id: 4, name: 'Dutch, turn 3', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 };
  render(
    <OpenDialog
      saves={[save]}
      open={() => {}}
      exportSave={(id) => exported.push(id)}
      note="Exported: Dutch, turn 3"
      close={() => {}}
    />,
  );
  fireEvent.click(document.querySelector('[data-export-save="4"]')!);
  expect(exported).toEqual([4]);
  expect(document.querySelector('#open-game')!.textContent).toContain('Exported: Dutch, turn 3');
  expect(document.querySelector('[data-open-file]')).toBeNull();
});

test('the Save window saves under the name typed, or the default one when it is left empty', () => {
  const names: string[] = [];
  render(<SaveDialog title="Save Game" save={(n) => names.push(n)} close={() => {}} />);
  fireEvent.click(document.querySelector('[data-save-ok]')!);
  fireEvent.change(document.querySelector('[data-save-name]')!, { target: { value: 'Before the war' } });
  fireEvent.click(document.querySelector('[data-save-ok]')!);
  expect(names).toEqual(['', 'Before the war']);
});

test('the Save window opens with the name field focused, and Enter there presses Save', () => {
  const names: string[] = [];
  render(<SaveDialog title="Save Game" save={(n) => names.push(n)} close={() => {}} />);
  expect(document.activeElement).toBe(document.querySelector('[data-save-name]'));
  fireEvent.submit(document.querySelector('form')!);
  expect(names).toEqual(['']);
});

test('the Save window says the save stays in this browser, and Save and Download asks for a copy too', () => {
  const saves: [string, boolean][] = [];
  render(<SaveDialog title="Save Game" save={(n, d) => saves.push([n, d])} close={() => {}} />);
  expect(document.querySelector('#save-game')!.textContent).toContain('kept in this browser only');
  fireEvent.change(document.querySelector('[data-save-name]')!, { target: { value: 'Before the war' } });
  fireEvent.click(document.querySelector('[data-save-download]')!);
  fireEvent.click(document.querySelector('[data-save-ok]')!);
  expect(saves).toEqual([
    ['Before the war', true],
    ['Before the war', false],
  ]);
});
