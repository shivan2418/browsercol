// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { DialogHost } from './panels';
import type { GuiEvents } from './webgui';

afterEach(cleanup);

/** A host on a fresh store, with the tiles it was asked to go to and the entries it was asked to run. */
function host() {
  const box = dialogs();
  const went: [number, number][] = [];
  const opened: string[] = [];
  render(
    <DialogHost
      dialogs={box}
      goTo={(at) => went.push(at)}
      art={() => null}
      report={{ groupBy: () => {}, filter: () => {}, ignore: () => {} }}
      routes={{ save: () => {}, remove: () => {}, assign: () => {} }}
      open={(id) => opened.push(id)}
    />,
  );
  return { box, went, opened };
}

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));
const rows = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('the Find Settlement panel', () => {
  const event: GuiEvents['findSettlement'] = {
    title: 'Find Settlement',
    filters: ['Find all settlements', 'Find only native settlements', 'Find only European settlements'],
    settlements: [
      { id: 'colony:1', name: 'Jamestown (English)', native: false, open: true, at: [3, 4], images: [] },
      { id: 'colony:2', name: 'Plymouth (French)', native: false, open: false, at: [7, 8], images: [] },
      { id: 'indianSettlement:3', name: 'Cuzco* (Inca)', native: true, open: true, at: [10, 11], images: [] },
    ],
    ok: 'OK',
  };
  function opened() {
    const h = host();
    act(() => h.box.show('findSettlement', event));
    return h;
  }

  it('lists every settlement, centres the map on the first and on each row picked', () => {
    const { went } = opened();
    expect(rows()).toEqual(['Jamestown (English)', 'Plymouth (French)', 'Cuzco* (Inca)']);
    expect(went).toEqual([[3, 4]]);
    fireEvent.click(screen.getByRole('option', { name: 'Plymouth (French)' }));
    expect(went).toEqual([
      [3, 4],
      [7, 8],
    ]);
  });

  it('filters to natives or Europeans', () => {
    opened();
    const filter = screen.getByRole('combobox');
    fireEvent.change(filter, { target: { value: '1' } });
    expect(rows()).toEqual(['Cuzco* (Inca)']);
    fireEvent.change(filter, { target: { value: '2' } });
    expect(rows()).toEqual(['Jamestown (English)', 'Plymouth (French)']);
  });

  it('opens our colony on a double click, and closes', () => {
    const { opened: ran } = opened();
    fireEvent.doubleClick(screen.getByRole('option', { name: 'Jamestown (English)' }));
    expect(ran).toEqual(['colony:colony:1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the picked native settlement on Enter, and nothing for a foreign colony', () => {
    const { opened: ran } = opened();
    fireEvent.click(screen.getByRole('option', { name: 'Plymouth (French)' }));
    key('Enter');
    expect(ran).toEqual([]);
    fireEvent.click(screen.getByRole('option', { name: 'Cuzco* (Inca)' }));
    key('Enter');
    expect(ran).toEqual(['settlement:indianSettlement:3']);
  });

  it('steps through the rows with the arrow keys', () => {
    const { went } = opened();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(went.at(-1)).toEqual([7, 8]);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
    expect(went.at(-1)).toEqual([3, 4]);
  });
});

describe('the work production panel', () => {
  const base: GuiEvents['workProduction'] = {
    title: 'Plains tile',
    place: 'Plains',
    unit: 'Free Colonist',
    unitKeys: [],
    keys: [],
    forest: null,
    base: '3.00',
    lines: [
      { source: 'Expert Farmer', value: '×2.00' },
      { source: 'Colony bonus', value: '+1.00' },
    ],
    zero: null,
    finalResult: 'Final result',
    result: '7.00',
    unattended: null,
    ok: 'OK',
  };

  it('shows the place, the modifiers and the final result, and closes with OK', () => {
    const { box } = host();
    act(() => box.show('workProduction', base));
    expect(screen.getByRole('dialog').getAttribute('data-kind')).toBe('workProduction');
    for (const text of ['Plains tile', 'Free Colonist', '3.00', 'Expert Farmer', '×2.00', 'Final result', '7.00']) {
      screen.getByText(text);
    }
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds the zero threshold and a building’s unattended production', () => {
    const { box } = host();
    act(() =>
      box.show('workProduction', {
        ...base,
        zero: { label: 'No negative production', value: '2.00' },
        unattended: { label: 'Unattended production', place: 'Lumber Mill', base: '1.00', lines: [] },
      }),
    );
    screen.getByText('No negative production');
    screen.getByText('Unattended production');
    screen.getByText('Lumber Mill');
  });
});
