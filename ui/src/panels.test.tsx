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

  it('shows only the buttons it has labels for', () => {
    const { box } = host();
    void ask(box, 'confirm', { ...confirm, ok: null, cancel: 'Done' });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Done']);
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
