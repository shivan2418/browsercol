// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { Side } from './side';

afterEach(cleanup);

/** A button by its name, as the browser sees it. */
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('the side panel', () => {
  it('runs a button’s command', () => {
    const ran: Command[] = [];
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={(c) => ran.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build colony (B)' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn (Enter)' }));
    expect(ran).toEqual([{ k: 'buildColony' }, { k: 'endTurn' }]);
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
    render(<Side turn="1" info="" unasked={[]} status="" orders={['goto']} run={(c) => ran.push(c)} />);
    expect(button('Go to (H)').disabled, 'goto').toBe(false);
    fireEvent.click(button('Go to (H)'));
    expect(ran).toEqual([{ k: 'selectDestination' }]);
  });

  it('disables every order while no unit is active', () => {
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={() => {}} />);
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
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'showDumpCargoDialog x2',
      'showWarehouseDialog',
    ]);
  });

  it('lists nothing while every dialog was asked', () => {
    render(<Side turn="1" info="" unasked={[]} status="" orders={[]} run={() => {}} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
