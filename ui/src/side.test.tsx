// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { Side } from './side';

afterEach(cleanup);

describe('the side panel', () => {
  it('runs a button’s command', () => {
    const ran: Command[] = [];
    render(<Side turn="1" info="" unasked={[]} status="" run={(c) => ran.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build colony (B)' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn (Enter)' }));
    expect(ran).toEqual([{ k: 'buildColony' }, { k: 'endTurn' }]);
  });

  it('lists the dialogs not asked yet, with how often', () => {
    render(
      <Side
        turn="1"
        info=""
        unasked={['showDumpCargoDialog', 'showWarehouseDialog', 'showDumpCargoDialog']}
        status=""
        run={() => {}}
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'showDumpCargoDialog x2',
      'showWarehouseDialog',
    ]);
  });

  it('lists nothing while every dialog was asked', () => {
    render(<Side turn="1" info="" unasked={[]} status="" run={() => {}} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
