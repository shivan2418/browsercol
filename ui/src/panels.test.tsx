// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { DialogHost } from './panels';
import type { Choice, GuiQuestions } from './webgui';

afterEach(cleanup);

const confirm: GuiQuestions['confirm']['ask'] = {
  text: 'Disband?',
  ok: 'Yes',
  cancel: 'No',
  defaultOk: false,
  tile: null,
  object: null,
  header: null,
};

const item = (text: string, more: Partial<Choice> = {}): Choice => ({
  text,
  enabled: true,
  ok: false,
  cancel: false,
  default: false,
  ...more,
});

/** The host on a fresh store, and the tiles it was asked to go to. */
function host() {
  const box = dialogs();
  const went: [number, number][] = [];
  render(<DialogHost dialogs={box} goTo={(at) => went.push(at)} />);
  return { box, went };
}

function ask<K extends keyof GuiQuestions>(box: ReturnType<typeof dialogs>, kind: K, q: GuiQuestions[K]['ask']) {
  let answer!: Promise<GuiQuestions[K]['answer']>;
  act(() => void (answer = box.ask(kind, q)));
  return answer;
}

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));

describe('the confirm dialog', () => {
  it('answers its buttons', async () => {
    const { box } = host();
    const yes = ask(box, 'confirm', confirm);
    screen.getByText('Disband?');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await yes).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    const no = ask(box, 'confirm', confirm);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(await no).toBe(false);
  });

  it('takes the default option on Enter and cancels on Escape', async () => {
    const { box } = host();
    const byDefault = ask(box, 'confirm', confirm);
    key('Enter');
    expect(await byDefault, 'cancel is the default').toBe(false);

    const ok = ask(box, 'confirm', { ...confirm, defaultOk: true });
    key('Enter');
    expect(await ok).toBe(true);

    const escaped = ask(box, 'confirm', { ...confirm, defaultOk: true });
    key('Escape');
    expect(await escaped).toBe(false);
  });

  it('shows the header Swing gives a dialog above its text', () => {
    const { box } = host();
    void ask(box, 'confirm', { ...confirm, header: 'Native demand at Jamestown' });
    expect(screen.getByRole('heading').textContent).toBe('Native demand at Jamestown');
    expect(screen.getByText('Disband?')).toBeTruthy();
  });

  it('shows only the buttons it has labels for', () => {
    const { box } = host();
    void ask(box, 'confirm', { ...confirm, ok: null, cancel: 'Done' });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Done']);
  });
});

describe('the end turn dialog', () => {
  const endTurn = {
    header: 'End turn',
    text: 'The following units are still waiting.',
    ok: 'OK',
    cancel: 'Cancel',
    units: [
      { id: 'unit:1', name: 'Free Colonist', location: 'Jamestown' },
      { id: 'unit:2', name: 'Soldier', location: 'tile 3, 4' },
    ],
  };

  it('lists the waiting units and ends the turn on ok or keeps it on cancel', async () => {
    const { box } = host();
    expect(screen.queryByRole('heading')).toBeNull();
    const ended = ask(box, 'endTurn', endTurn);
    expect(screen.getByRole('heading').textContent).toBe('End turn');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-unit'))).toEqual([
      'unit:1',
      'unit:2',
      null,
      null,
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await ended).toEqual({ status: 'ok' });
    const kept = ask(box, 'endTurn', endTurn);
    key('Escape');
    expect(await kept).toEqual({ status: 'cancel' });
  });

  it('answers the unit that is clicked', async () => {
    const { box } = host();
    const picked = ask(box, 'endTurn', endTurn);
    fireEvent.click(screen.getByRole('button', { name: /Soldier/ }));
    expect(await picked).toEqual({ status: 'select', unit: 'unit:2' });
  });
});

describe('the pre-combat dialog', () => {
  const preCombat = {
    attacker: 'Soldier',
    defender: 'Brave',
    offence: [{ source: 'Base offence', value: '+1.00' }],
    defence: [
      { source: 'Base defence', value: '+1.00' },
      { source: 'Fortified', value: '+50.00%' },
    ],
    finalResult: 'Final result',
    offenceResult: '1.00',
    defenceResult: '1.50',
    ok: 'OK',
    cancel: 'Cancel',
    tile: null,
    object: null,
  };

  it('lists both sides modifiers in rows and their final results', async () => {
    const { box } = host();
    const attack = ask(box, 'preCombat', preCombat);
    const rows = screen.getAllByRole('row').map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Soldier', 'Brave'],
      ['Base offence', '+1.00', 'Base defence', '+1.00'],
      ['', '', 'Fortified', '+50.00%'],
      ['Final result', '1.00', 'Final result', '1.50'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await attack).toBe(true);
  });

  it('cancels on its button or Escape, and has no default button', async () => {
    const { box } = host();
    const kept = ask(box, 'preCombat', preCombat);
    key('Enter');
    key('Escape');
    expect(await kept).toBe(false);
    const other = ask(box, 'preCombat', preCombat);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await other).toBe(false);
  });
});

describe('the choice dialog', () => {
  const choices = [item('Trade'), item('Speak', { default: true }), item('Attack', { enabled: false })];

  it('answers the index of the clicked choice; a disabled one cannot be clicked', async () => {
    const { box } = host();
    const picked = ask(box, 'choice', { text: 'Meet the natives', cancel: 'Leave', tile: null, object: null, choices });
    expect((screen.getByRole('button', { name: 'Attack' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
    expect(await picked).toBe(0);
  });

  it('takes the default choice on Enter and cancels on Escape or its cancel button', async () => {
    const { box } = host();
    const q = { text: 'Meet the natives', cancel: 'Leave', tile: null, object: null, choices };
    const byDefault = ask(box, 'choice', q);
    key('Enter');
    expect(await byDefault).toBe(1);

    const escaped = ask(box, 'choice', q);
    key('Escape');
    expect(await escaped).toBeNull();

    const left = ask(box, 'choice', q);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await left).toBeNull();
  });

  it('takes its cancel button on Enter when no item is the default', async () => {
    const { box } = host();
    const q = { text: 'Meet the natives', cancel: 'Leave', tile: null, object: null, choices: [item('Trade')] };
    const left = ask(box, 'choice', q);
    key('Enter');
    expect(await left).toBeNull();
  });

  it('answers its cancel item on Escape, else closes with null; Enter does nothing without a default', async () => {
    const { box } = host();
    const withItem = ask(box, 'choice', {
      text: 'Pick',
      cancel: null,
      tile: null,
      object: null,
      choices: [item('Go'), item('Stay', { cancel: true })],
    });
    key('Escape');
    expect(await withItem).toBe(1);

    const closed = ask(box, 'choice', {
      text: 'Who emigrates?',
      cancel: null,
      tile: null,
      object: null,
      choices: [item('A')],
    });
    key('Enter');
    screen.getByText('Who emigrates?');
    key('Escape');
    expect(await closed).toBeNull();
  });
});

describe('the input dialog', () => {
  const q = { text: 'Name the colony', value: 'Jamestown', ok: 'OK', cancel: 'Cancel', tile: null };

  it('answers the text entered on Enter, or its suggestion', async () => {
    const { box } = host();
    const named = ask(box, 'input', q);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Roanoke' } });
    key('Enter');
    expect(await named).toBe('Roanoke');

    const kept = ask(box, 'input', q);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await kept).toBe('Jamestown');
  });

  it('leaves Enter on a focused button to the button', async () => {
    const { box } = host();
    const cancelled = ask(box, 'input', q);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    act(() => void fireEvent.keyDown(cancel, { key: 'Enter' }));
    screen.getByRole('dialog');
    fireEvent.click(cancel);
    expect(await cancelled).toBeNull();
  });

  it('answers null on Escape', async () => {
    const { box } = host();
    const escaped = ask(box, 'input', q);
    key('Escape');
    expect(await escaped).toBeNull();
  });
});

describe('the goods dialog', () => {
  const lot = (name: string, checked = false) => ({
    id: name,
    type: name,
    name,
    amount: 40,
    icon: `image.icon.${name}`,
    label: `40 ${name}`,
    checked,
  });
  const q = (max: number, checked = false) => ({
    text: 'Loot Cargo',
    ok: 'OK',
    cancel: 'Cancel',
    max,
    object: null,
    goods: [lot('Rum', checked), lot('Sugar', checked), lot('Cotton', checked)],
  });

  it('answers the indexes picked, on OK or Enter', async () => {
    const { box } = host();
    const taken = ask(box, 'goods', q(3));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cotton/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Rum/ }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await taken).toEqual([0, 2]);

    const entered = ask(box, 'goods', q(3, true));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    key('Enter');
    expect(await entered).toEqual([0, 2]);
  });

  it('stops at max picks', async () => {
    const { box } = host();
    const taken = ask(box, 'goods', q(2));
    fireEvent.click(screen.getByRole('checkbox', { name: /Rum/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    const cotton = screen.getByRole('checkbox', { name: /Cotton/ });
    expect((cotton as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(cotton);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await taken).toEqual([0, 1]);
  });

  it('answers null on Cancel and Escape', async () => {
    const { box } = host();
    const cancelled = ask(box, 'goods', q(3, true));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await cancelled).toBeNull();
    const escaped = ask(box, 'goods', q(3));
    key('Escape');
    expect(await escaped).toBeNull();
  });
});

describe('the negotiation dialog', () => {
  const stance = { key: 'PEACE', amount: 0, text: 'Peace' };
  const q = (more: Partial<GuiQuestions['negotiation']['ask']> = {}): GuiQuestions['negotiation']['ask'] => ({
    title: 'Diplomatic Negotiation',
    text: 'Let us consider our diplomatic situation.',
    demand: 'Spain requires of France',
    offer: 'Spain offers France',
    exchange: 'in return for',
    version: 0,
    add: 'Add',
    send: 'Send',
    accept: null,
    cancel: 'Cancel',
    items: [],
    options: [
      { kind: 'gold', side: 'demand', label: 'Gold', note: '(90 gold available)', unique: true, max: 90, choices: [] },
      { kind: 'gold', side: 'offer', label: 'Gold', note: null, unique: true, max: 50, choices: [] },
      {
        kind: 'colony',
        side: 'offer',
        label: 'Colony',
        note: null,
        unique: false,
        choices: [
          { key: 'colony:1', amount: 0, text: 'Jamestown' },
          { key: 'colony:2', amount: 0, text: 'Plymouth' },
        ],
      },
      { kind: 'stance', side: null, label: 'Stance', note: null, unique: true, choices: [stance] },
    ],
    ...more,
  });
  const within = (side: string, kind: string) =>
    document.querySelector(`.trade-option[data-side="${side}"][data-kind="${kind}"]`) as HTMLElement;

  it('proposes what the player added, an item replacing one of a unique kind', async () => {
    const { box } = host();
    const answer = ask(box, 'negotiation', q());
    screen.getByRole('heading', { name: 'Diplomatic Negotiation' });
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();

    const gold = within('offer', 'gold');
    fireEvent.change(gold.querySelector('input')!, { target: { value: '20' } });
    fireEvent.click(gold.querySelector('button')!);
    fireEvent.change(gold.querySelector('input')!, { target: { value: '30' } });
    fireEvent.click(gold.querySelector('button')!);
    fireEvent.click(within('', 'stance').querySelector('button')!);
    const colony = within('offer', 'colony');
    fireEvent.change(colony.querySelector('select')!, { target: { value: 'colony:2' } });
    fireEvent.click(colony.querySelector('button')!);
    // Plymouth is on the table: Jamestown is what is left to add.
    expect(colony.querySelector('select')!.value).toBe('colony:1');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await answer).toEqual({
      status: 'propose',
      items: [
        { kind: 'gold', side: 'offer', key: '', amount: 30, text: 'Gold 30' },
        { kind: 'stance', side: null, key: 'PEACE', amount: 0, text: 'Peace' },
        { kind: 'colony', side: 'offer', key: 'colony:2', amount: 0, text: 'Plymouth' },
      ],
    });
  });

  it('removes an item that is clicked, and offers only the gold there is', async () => {
    const { box } = host();
    const answer = ask(
      box,
      'negotiation',
      q({ items: [{ kind: 'gold', side: 'demand', key: '', amount: 10, text: 'Gold 10' }] }),
    );
    const gold = within('demand', 'gold');
    fireEvent.change(gold.querySelector('input')!, { target: { value: '91' } });
    expect((gold.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Gold 10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await answer).toEqual({ status: 'propose', items: [] });
  });

  it('accepts an offer that has not been changed, and rejects on Cancel or Escape', async () => {
    const { box } = host();
    const offer = q({
      version: 1,
      accept: 'Accept',
      items: [{ kind: 'stance', side: null, key: 'PEACE', amount: 0, text: 'Peace' }],
    });
    const accepted = ask(box, 'negotiation', offer);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect((await accepted)?.status).toBe('accept');

    const entered = ask(box, 'negotiation', offer);
    key('Enter');
    expect((await entered)?.status).toBe('accept');

    // An edited offer cannot be accepted: Enter sends it.
    const edited = ask(box, 'negotiation', offer);
    fireEvent.click(screen.getByRole('button', { name: 'Peace' }));
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    key('Enter');
    expect(await edited).toEqual({ status: 'propose', items: [] });

    const cancelled = ask(box, 'negotiation', offer);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await cancelled)?.status).toBe('reject');
    const escaped = ask(box, 'negotiation', offer);
    key('Escape');
    expect((await escaped)?.status).toBe('reject');
  });

  it('cannot be cancelled when it has no cancel button', () => {
    const { box } = host();
    void ask(box, 'negotiation', q({ cancel: null }));
    key('Escape');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('the panels', () => {
  it('list the model messages, each going to its tile, and close on Enter', () => {
    const { box, went } = host();
    act(() =>
      box.show('messages', {
        title: 'Turn Report',
        ok: 'OK',
        messages: [
          { text: 'Jamestown has grown.', type: 'DEFAULT', source: 'colony:1', tile: 'tile:9', at: [3, 4] },
          { text: 'Taxes are up.', type: 'DEFAULT', source: null, tile: null, at: null },
        ],
      }),
    );
    screen.getByRole('heading', { name: 'Turn Report' });
    fireEvent.click(screen.getByText('Jamestown has grown.'));
    expect(went).toEqual([[3, 4]]);
    expect(screen.getByText('Taxes are up.').closest('a')).toBeNull();

    key('Enter');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('list the high scores, with their header, and close on Enter', () => {
    const { box } = host();
    act(() =>
      box.show('highScores', {
        text: 'You have won!',
        ok: 'OK',
        scores: [
          {
            score: 1234,
            headline: 'Governor Ann of New Albion',
            fields: [
              { label: 'Turn:', value: 'Spring 1600' },
              { label: 'Colonies:', value: '3' },
            ],
          },
        ],
      }),
    );
    screen.getByText('You have won!');
    screen.getByRole('heading', { name: '1234 Governor Ann of New Albion' });
    expect(screen.getByText('Colonies:').nextSibling?.textContent).toBe('3');

    key('Enter');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('come after the open dialog and close with their button', async () => {
    const { box } = host();
    const yes = ask(box, 'confirm', confirm);
    act(() => box.show('error', { text: 'Out of moves', ok: 'OK' }));
    expect(screen.queryByText('Out of moves')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await yes).toBe(true);

    screen.getByText('Out of moves');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the names dialog', () => {
  const q = {
    text: 'Declare independence?',
    fields: [
      { label: 'Nation', value: 'Free Dutch' },
      { label: 'Country', value: 'United Dutch' },
    ],
    ok: 'Liberty',
    cancel: 'Later',
  };

  it('answers the fields, as edited, on ok or Enter', async () => {
    const { box } = host();
    const edited = ask(box, 'names', q);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Newland' } });
    fireEvent.click(screen.getByRole('button', { name: 'Liberty' }));
    expect(await edited).toEqual(['Free Dutch', 'Newland']);

    const kept = ask(box, 'names', q);
    key('Enter');
    expect(await kept).toEqual(['Free Dutch', 'United Dutch']);
  });

  it('answers null on cancel or Escape', async () => {
    const { box } = host();
    const later = ask(box, 'names', q);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(await later).toBeNull();

    const escaped = ask(box, 'names', q);
    key('Escape');
    expect(await escaped).toBeNull();
  });
});
