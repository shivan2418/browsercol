// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { debugMessage, debugMode, describeAnswer, type DebugRequest } from './debug';
import { Side } from './side';

afterEach(cleanup);

const side = (debug?: Parameters<typeof Side>[0]['debug']) => (
  <Side
    turn="1"

    info=""
    unasked={[]}
    status=""
    orders={[]}
    run={() => {}}
    saves={[]}
    saveNote=""
    save={() => {}}
    load={() => {}}
    remove={() => {}}
    exportSave={() => {}}
    importFile={() => {}}
    debug={debug}
  />
);

describe('debug mode', () => {
  it('is the ?debug parameter', () => {
    expect(debugMode(new URLSearchParams(''))).toBe(false);
    expect(debugMode(new URLSearchParams('?debug'))).toBe(true);
    expect(debugMode(new URLSearchParams('?debug=1&autoplay=3'))).toBe(true);
    expect(debugMode(new URLSearchParams('?debug=0'))).toBe(false);
    expect(debugMode(new URLSearchParams('?preset=dutch-small'))).toBe(false);
  });

  it('puts a request in the Worker message as JSON', () => {
    expect(debugMessage({ action: 'addGold', amount: 50 })).toEqual({
      k: 'debug',
      request: '{"action":"addGold","amount":50}',
    });
  });

  it('says what the Engine answered', () => {
    expect(describeAnswer('{"action":"aiView","text":"Dutch: 5 gold"}')).toBe('Dutch: 5 gold');
    expect(describeAnswer('{"action":"revealMap","reveal":true}')).toBe('Map revealed');
    expect(describeAnswer('{"action":"addGold"}')).toBe('Done: addGold');
  });
});

describe('the debug menu', () => {
  it('is not in the side panel outside debug mode', () => {
    render(side());
    expect(document.getElementById('debug')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reveal map' })).toBeNull();
  });

  it('asks for each action', () => {
    const asked: DebugRequest[] = [];
    const skipped: number[] = [];
    render(
      side({ at: [3, 4], note: 'Done: addGold', request: (r) => asked.push(r), skipTurns: (n) => skipped.push(n) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reveal map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide map' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add gold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add unit' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goods to colony' }));
    fireEvent.change(screen.getByLabelText('Turns'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip turns (AI plays)' }));
    expect(asked).toEqual([
      { action: 'revealMap', reveal: true },
      { action: 'revealMap', reveal: false },
      { action: 'aiView' },
      { action: 'addGold', amount: 1000 },
      { action: 'addUnit', type: 'model.unit.freeColonist', x: 3, y: 4 },
      { action: 'addGoods', type: 'model.goods.food', amount: 25, x: 3, y: 4 },
    ]);
    expect(skipped).toEqual([7]);
    expect(screen.getByText('Done: addGold').id).toBe('debug-note');
  });

  it('cannot put a unit or goods where no tile is selected', () => {
    render(side({ at: null, note: '', request: () => {}, skipTurns: () => {} }));
    expect((screen.getByRole('button', { name: 'Add unit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add goods to colony' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
