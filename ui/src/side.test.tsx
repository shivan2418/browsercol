// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { Side } from './side';

afterEach(cleanup);

/** A button by its name, as the browser sees it. */
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

/** The save props, for a test that does not look at them. */
const saving = () => ({
  saves: [],
  saveNote: '',
  save: () => {},
  load: () => {},
  remove: () => {},
  exportSave: () => {},
  importFile: () => {},
});

describe('the side panel', () => {
  it('shows the turn', () => {
    render(<Side turn="5 (AI playing)" info="" unasked={[]} status="" orders={[]} run={() => {}} {...saving()} />);
    expect(screen.getByText('5 (AI playing)').id).toBe('turn');
  });

  it('runs a button’s command', () => {
    const ran: Command[] = [];
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={(c) => ran.push(c)} {...saving()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build colony (B)' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn (Enter)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Declare independence' }));
    expect(ran).toEqual([{ k: 'buildColony' }, { k: 'endTurn' }, { k: 'declareIndependence' }]);
  });

  it('enables the orders the active unit can take, and disables the rest', () => {
    const ran: Command[] = [];
    render(
      <Side
        turn="1"

        info=""
        unasked={[]}
        status=""
        orders={['fortify', 'sentry', 'skip', 'disband', 'road', 'goto']}
        run={(c) => ran.push(c)}
        {...saving()}
      />,
    );
    expect(button('Fortify (F)').disabled, 'fortify').toBe(false);
    expect(button('Sentry (S)').disabled, 'sentry').toBe(false);
    expect(button('Skip (Space)').disabled, 'skip').toBe(false);
    expect(button('Disband (D)').disabled, 'disband').toBe(false);
    expect(button('Road (R)').disabled, 'road').toBe(false);
    expect(button('Go to (H)').disabled, 'goto').toBe(false);
    // A soldier cannot work its tile.
    expect(button('Plow (P)').disabled, 'plow').toBe(true);
    expect(button('Clear forest (C)').disabled, 'clear forest').toBe(true);
    fireEvent.click(button('Fortify (F)'));
    expect(ran).toEqual([{ k: 'fortify' }]);
  });

  it('runs the Go To order, which asks where the unit goes', () => {
    const ran: Command[] = [];
    render(
      <Side
        turn="1"

        info=""
        unasked={[]}
        status=""
        orders={['goto']}
        run={(c) => ran.push(c)}
        {...saving()}
      />,
    );
    expect(button('Go to (H)').disabled, 'goto').toBe(false);
    fireEvent.click(button('Go to (H)'));
    expect(ran).toEqual([{ k: 'selectDestination' }]);
  });

  it('disables every order while no unit is active', () => {
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={() => {}} {...saving()} />);
    for (const name of [
      'Fortify (F)',
      'Sentry (S)',
      'Skip (Space)',
      'Disband (D)',
      'Plow (P)',
      'Road (R)',
      'Go to (H)',
    ]) {
      expect(button(name).disabled, name).toBe(true);
    }
  });

  it('lists the dialogs not asked yet, with how often', () => {
    render(
      <Side
        turn="1"

        info=""
        unasked={['showDumpCargoDialog', 'showWarehouseDialog', 'showDumpCargoDialog']}
        status=""
        orders={[]}
        run={() => {}}
        {...saving()}
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'showDumpCargoDialog x2',
      'showWarehouseDialog',
    ]);
  });

  it('lists nothing while every dialog was asked', () => {
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={() => {}} {...saving()} />);
    expect(screen.queryByRole('list')).toBeNull();
  });

  const meta = (id: number, name: string) => ({ id, name, date: 0, turn: 7, year: 1499, nation: 'Dutch', size: 100 });

  it('saves under the name typed, then clears it', () => {
    const named: string[] = [];
    render(
      <Side
        turn="1"

        info=""
        unasked={[]}
        status=""
        orders={[]}
        run={() => {}}
        {...saving()}
        save={(n) => named.push(n)}
      />,
    );
    fireEvent.click(button('Save game'));
    fireEvent.change(screen.getByPlaceholderText('Save name (optional)'), { target: { value: 'before the war' } });
    fireEvent.click(button('Save game'));
    expect(named).toEqual(['', 'before the war']);
    expect((screen.getByPlaceholderText('Save name (optional)') as HTMLInputElement).value).toBe('');
  });

  it('lists the saves with name, turn and nation, and loads, exports or deletes one', () => {
    const done: string[] = [];
    render(
      <Side
        turn="1"

        info=""
        unasked={[]}
        status=""
        orders={[]}
        run={() => {}}
        {...saving()}
        saves={[meta(2, 'second'), meta(1, 'first')]}
        saveNote="Saved: second"
        load={(id) => done.push(`load ${id}`)}
        remove={(id) => done.push(`delete ${id}`)}
        exportSave={(id) => done.push(`export ${id}`)}
      />,
    );
    const rows = document.querySelectorAll('[data-save]');
    expect([...rows].map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^second \|.*\| turn 7 \(1499\) \| Dutch Load Export Delete$/),
      expect.stringMatching(/^first \|/),
    ]);
    expect(screen.getByText('Saved: second')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-save="1"] [data-load]')!);
    fireEvent.click(document.querySelector('[data-save="1"] [data-export]')!);
    fireEvent.click(document.querySelector('[data-save="2"] [data-delete]')!);
    expect(done).toEqual(['load 1', 'export 1', 'delete 2']);
  });

  it('hands the file chosen to import', () => {
    const got: string[] = [];
    render(
      <Side
        turn="1"

        info=""
        unasked={[]}
        status=""
        orders={[]}
        run={() => {}}
        {...saving()}
        importFile={(f) => got.push(f.name)}
      />,
    );
    const input = document.querySelector('#import-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.fsg')] } });
    expect(got).toEqual(['a.fsg']);
  });

  it('says so when there are no saves', () => {
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={() => {}} {...saving()} />);
    expect(screen.getByText('No saved games')).toBeTruthy();
  });
});
