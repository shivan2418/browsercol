// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { chosenRequest, debugEntryRequest, debugMessage, debugMode, describeAnswer, type DebugRequest } from './debug';
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
    expect(describeAnswer('{"action":"dumpTile","text":"tile:1"}')).toBe('tile:1');
    expect(describeAnswer('{"action":"traceWork","trace":true}')).toBe('Tracing work');
  });
});

describe('the tile popup entries', () => {
  it('ask for a unit by its id, or a tile by its place', () => {
    expect(debugEntryRequest('changeRole', 'unit:12')).toEqual({ action: 'changeRole', unit: 'unit:12' });
    expect(debugEntryRequest('colonyPlan', '3,4')).toEqual({ action: 'colonyPlan', x: 3, y: 4 });
    expect(debugEntryRequest('changeOwner', '3,4')).toEqual({ action: 'changeOwner', x: 3, y: 4 });
  });

  it('send the request again with what the player chose', () => {
    const last: DebugRequest = { action: 'changeOwner', x: 3, y: 4 };
    const answer = JSON.stringify({
      action: 'choose',
      for: 'changeOwner',
      key: 'owner',
      prompt: 'Select owner',
      choices: [
        { id: 'player:1', label: 'Dutch' },
        { id: 'player:2', label: 'French' },
      ],
    });
    let asked = '';
    expect(
      chosenRequest(answer, last, (p) => {
        asked = p;
        return '2';
      }),
    ).toEqual({ action: 'changeOwner', x: 3, y: 4, owner: 'player:2' });
    expect(asked).toBe('Select owner\n1. Dutch\n2. French');
    // An id typed in is taken as well; a reply that is none of them, or no reply, cancels.
    expect(chosenRequest(answer, last, () => 'player:1')).toMatchObject({ owner: 'player:1' });
    expect(chosenRequest(answer, last, () => '9')).toBeNull();
    expect(chosenRequest(answer, last, () => null)).toBeNull();
    // Any other answer is no question.
    expect(chosenRequest('{"action":"addGold"}', last, () => '1')).toBeUndefined();
  });

  it('says what the text answers hold', () => {
    expect(describeAnswer('{"action":"colonyPlan","text":"Plan"}')).toBe('Plan');
    expect(describeAnswer('{"action":"applyDisaster","avoided":true}')).toBe('Disaster avoided');
    expect(describeAnswer('{"action":"applyDisaster","avoided":false}')).toBe('Disaster applied');
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
    let resets = 0;
    render(
      side({
        at: [3, 4],
        note: 'Done: addGold',
        request: (r) => asked.push(r),
        skipTurns: (n) => skipped.push(n),
        resetSave: () => resets++,
      }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Reset save (new game)' }));
    expect(skipped).toEqual([7]);
    expect(resets).toBe(1);
    expect(screen.getByText('Done: addGold').id).toBe('debug-note');
  });

  it('cannot put a unit or goods where no tile is selected', () => {
    render(side({ at: null, note: '', request: () => {}, skipTurns: () => {}, resetSave: () => {} }));
    expect((screen.getByRole('button', { name: 'Add unit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add goods to colony' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
