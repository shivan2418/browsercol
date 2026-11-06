// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { ColonyActions, type ColonyMoves } from './colony-panel';
import { jamestown } from './colony-fixture';
import { DebugContext } from './debug';
import { dialogs } from './dialogs';
import { dragOnto } from './drag.testing';
import { europeButtons } from './europe-client';
import { CopyDetailsContext, ShowLogContext } from './log';
import { ContextMenuContext, type ContextMenus } from './popup-menu';
import type { Advisor } from './advisor';
import { DialogHost, type Art, type ReportButtons, type RouteButtons } from './panels';
import { chooseOption, listed, openSelect, shown } from './select-test';
import type { Choice, EuropeUnit, GuiEvents, GuiQuestions, TradeRouteDraft } from './webgui';

afterEach(cleanup);

/** The labels of the buttons marked as the one Enter presses. */
const enterMarked = () => [...document.querySelectorAll('[data-enter]')].map((b) => b.textContent);

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

/** The art the Tileset of these tests has: a file per key, as the page would find it. */
const files: Record<string, string> = {
  'image.unit.model.unit.caravel': 'art/caravel.png',
  'image.flavor.event.firstLanding': 'art/landing.png',
};
const art: Art = (keys) => {
  const key = keys.find((k) => k in files);
  return key ? files[key] : null;
};

/** The host on a fresh store, the tiles it was asked to go to, and what the report's buttons were asked. */
function host(
  extra: {
    command?: (entry: string) => void;
    colopedia?: (type: string) => void;
    log?: () => void;
    copy?: (e: GuiEvents['error']) => Promise<boolean>;
    advisor?: Advisor | null;
  } = {},
) {
  const { log = () => {}, copy = () => Promise.resolve(false), ...props } = extra;
  const box = dialogs();
  const went: [number, number][] = [];
  const pressed: string[] = [];
  const report: ReportButtons = {
    groupBy: (value) => pressed.push(`groupBy ${value}`),
    filter: (index, shown) => pressed.push(`filter ${index} ${shown}`),
    ignore: (index, ignore) => pressed.push(`ignore ${index} ${ignore}`),
    open: (link) => pressed.push(`open ${JSON.stringify(link)}`),
  };
  const saved: TradeRouteDraft[] = [];
  const removed: string[] = [];
  const assigned: string[] = [];
  const routes: RouteButtons = {
    save: (d) => saved.push(d),
    remove: (id) => removed.push(id),
    assign: (unit, route, show = true) => assigned.push(`${unit} ${route}${show ? '' : ' hidden'}`),
  };
  render(
    <ShowLogContext.Provider value={log}>
      <CopyDetailsContext.Provider value={copy}>
        <DialogHost dialogs={box} goTo={(at) => went.push(at)} art={art} report={report} routes={routes} {...props} />
      </CopyDetailsContext.Provider>
    </ShowLogContext.Provider>,
  );
  return { box, went, pressed, saved, removed, assigned };
}

type Message = GuiEvents['messages']['messages'][number];
const message = (text: string, more: Partial<Message> = {}): Message => ({
  text,
  type: 'DEFAULT',
  source: null,
  tile: null,
  at: null,
  heading: null,
  images: [],
  filter: null,
  filterTip: null,
  ignored: false,
  ignoreTip: null,
  ...more,
});

function ask<K extends keyof GuiQuestions>(box: ReturnType<typeof dialogs>, kind: K, q: GuiQuestions[K]['ask']) {
  let answer!: Promise<GuiQuestions[K]['answer']>;
  act(() => void (answer = box.ask(kind, q)));
  return answer;
}

/** The dialog's own buttons, without its frame's close button. */
const answers = () => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Close');

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
    expect(enterMarked()).toEqual(['No']);
    key('Enter');
    expect(await byDefault, 'cancel is the default').toBe(false);

    const ok = ask(box, 'confirm', { ...confirm, defaultOk: true });
    expect(enterMarked()).toEqual(['Yes']);
    key('Enter');
    expect(await ok).toBe(true);

    const escaped = ask(box, 'confirm', { ...confirm, defaultOk: true });
    key('Escape');
    expect(await escaped).toBe(false);
  });

  it('answers ok on Escape and on its frame’s close button when the dialog says so (first contact)', async () => {
    const { box } = host();
    const escaped = ask(box, 'confirm', { ...confirm, defaultOk: true, escapeOk: true });
    key('Escape');
    expect(await escaped, 'Escape accepts, as Swing’s first contact dialog does').toBe(true);

    const closed = ask(box, 'confirm', { ...confirm, defaultOk: true, escapeOk: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await closed).toBe(true);

    const no = ask(box, 'confirm', { ...confirm, defaultOk: true, escapeOk: true });
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(await no, 'the No button still declines').toBe(false);
  });

  it('shows the header Swing gives a dialog above its text', () => {
    const { box } = host();
    void ask(box, 'confirm', { ...confirm, header: 'Native demand at Jamestown' });
    expect(screen.getByRole('heading').textContent).toBe('Native demand at Jamestown');
    expect(screen.getByText('Disband?')).toBeTruthy();
  });

  it('has a Help button that opens the Colopedia or shows text, and does not answer', async () => {
    const opened: string[] = [];
    const { box } = host({ colopedia: (type) => opened.push(type) });
    const tax = ask(box, 'confirm', {
      ...confirm,
      help: { label: 'Help', colopedia: 'colopedia.concepts.taxes', text: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(opened).toEqual(['colopedia.concepts.taxes']);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(await tax).toBe(false);

    const contact = ask(box, 'confirm', {
      ...confirm,
      help: { label: 'Help', colopedia: null, text: 'You meet natives.' },
    });
    expect(screen.queryByText('You meet natives.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    screen.getByText('You meet natives.');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await contact).toBe(true);
  });

  it('cancels on its frame’s close button', async () => {
    const { box } = host();
    const closed = ask(box, 'confirm', { ...confirm, defaultOk: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await closed).toBe(false);
  });

  it('shows only the buttons it has labels for', () => {
    const { box } = host();
    void ask(box, 'confirm', { ...confirm, ok: null, cancel: 'Done' });
    expect(answers().map((b) => b.textContent)).toEqual(['Done']);
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
    expect(answers().map((b) => b.getAttribute('data-unit'))).toEqual(['unit:1', 'unit:2', null, null]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await ended).toEqual({ status: 'ok' });
    const kept = ask(box, 'endTurn', endTurn);
    key('Escape');
    expect(await kept).toEqual({ status: 'cancel' });
  });

  it('makes the unit that is clicked active and stays open, as Swing does', async () => {
    const entries: string[] = [];
    const { box } = host({ command: (entry) => entries.push(entry) });
    const picked = ask(box, 'endTurn', endTurn);
    fireEvent.click(screen.getByRole('button', { name: /Soldier/ }));
    fireEvent.click(screen.getByRole('button', { name: /Free Colonist/ }));
    expect(entries).toEqual(['waiting:unit:2', 'waiting:unit:1']);
    expect(screen.getByRole('heading').textContent).toBe('End turn');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await picked).toEqual({ status: 'ok' });
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
    expect(enterMarked()).toEqual([choices[1].text]);
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
    expect(enterMarked()).toEqual(['Leave']);
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
    expect(enterMarked(), 'Enter does nothing, so nothing is marked').toEqual([]);
    key('Enter');
    screen.getByText('Who emigrates?');
    key('Escape');
    expect(await closed).toBeNull();
  });
});

describe('the choose founding father dialog', () => {
  const father = (id: string, kind: string, name: string, description: string) => ({
    id,
    kind,
    name,
    description,
    born: '1700-1790',
    text: `The story of ${name}.`,
    keys: [`image.flavor.${id}`],
  });
  const q: GuiQuestions['father']['ask'] = {
    title: 'Nominate Founding Father',
    ok: 'OK',
    fathers: [
      father('adamSmith', 'Trade', 'Adam Smith', 'Enables building of factories.'),
      father('thomasJefferson', 'Political', 'Thomas Jefferson', 'Increases liberty bell production by 10%.'),
      father('hernanCortes', 'Military', 'Hernan Cortes', 'Conquered settlements always yield treasure.'),
    ],
  };

  it("has a tab per kind, shows what the open tab's father does, and nominates it", async () => {
    const { box } = host();
    const chosen = ask(box, 'father', q);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Trade', 'Political', 'Military']);
    const panel = screen.getByRole('tabpanel');
    within(panel).getByText('Enables building of factories.');
    within(panel).getByText('[1700-1790] The story of Adam Smith.');

    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    within(screen.getByRole('tabpanel')).getByText('Increases liberty bell production by 10%.');
    expect(screen.queryByText('Enables building of factories.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await chosen).toBe(1);
  });

  it('moves between tabs with the arrow keys, nominates on Enter and postpones on Escape', async () => {
    const { box } = host();
    const chosen = ask(box, 'father', q);
    const list = screen.getByRole('tablist');
    act(() => void fireEvent.keyDown(list, { key: 'ArrowLeft' }));
    within(screen.getByRole('tabpanel')).getByText('Hernan Cortes (Military)');
    key('Enter');
    expect(await chosen).toBe(2);

    const closed = ask(box, 'father', q);
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

describe('the select amount dialog', () => {
  const q = {
    text: 'Select the amount',
    type: 'model.goods.cloth',
    name: 'Cloth',
    keys: ['image.icon.model.goods.cloth'],
    values: [20, 25, 30],
    value: 25,
    max: 30,
    ok: 'OK',
    cancel: 'Cancel',
  };
  const field = () => screen.getByRole('spinbutton') as HTMLInputElement;

  it('starts at the amount selected, and answers one of the listed amounts or one typed in', async () => {
    const { box } = host();
    const kept = ask(box, 'amount', q);
    expect(field().value).toBe('25');
    key('Enter');
    expect(await kept).toBe(25);

    const listed = ask(box, 'amount', q);
    fireEvent.click(screen.getByRole('button', { name: '30' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await listed).toBe(30);

    const typed = ask(box, 'amount', { ...q, value: null });
    expect(field().value).toBe('');
    fireEvent.change(field(), { target: { value: '7' } });
    key('Enter');
    expect(await typed).toBe(7);
  });

  it('takes no amount over the most, nor one that is not whole', async () => {
    const { box } = host();
    const answered = ask(box, 'amount', q);
    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    fireEvent.change(field(), { target: { value: '31' } });
    expect(ok.disabled).toBe(true);
    key('Enter');
    screen.getByRole('dialog');
    fireEvent.change(field(), { target: { value: '2.5' } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(field(), { target: { value: '30' } });
    fireEvent.click(ok);
    expect(await answered).toBe(30);
  });

  it('answers null on cancel and on Escape', async () => {
    const { box } = host();
    const cancelled = ask(box, 'amount', q);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await cancelled).toBeNull();
    const escaped = ask(box, 'amount', q);
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
    tutorial: null,
    clear: 'Clear',
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
    fireEvent.click(within('', 'stance').querySelector('button[data-add]')!);
    const colony = within('offer', 'colony');
    await chooseOption(colony.querySelector('[role="combobox"]')!, 'Plymouth');
    fireEvent.click(colony.querySelector('button[data-add]')!);
    // Plymouth is on the table: Jamestown is what is left to add.
    expect(shown(colony.querySelector('[role="combobox"]')!)).toBe('Jamestown');
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

  it('clears one kind of item at a time, and shows the tutorial text', async () => {
    const { box } = host();
    const answer = ask(
      box,
      'negotiation',
      q({
        tutorial: 'You meet fellow Europeans.',
        items: [
          { kind: 'gold', side: 'offer', key: '', amount: 30, text: 'Gold 30' },
          { kind: 'gold', side: 'demand', key: '', amount: 10, text: 'Gold 10' },
          { kind: 'stance', side: 'offer', key: 'PEACE', amount: 0, text: 'Peace' },
        ],
      }),
    );
    screen.getByText('You meet fellow Europeans.');
    const clear = (side: string, kind: string) =>
      document.querySelector(
        `.trade-option[data-side="${side}"][data-kind="${kind}"] [data-clear]`,
      ) as HTMLButtonElement;
    expect(clear('offer', 'colony').disabled).toBe(true);
    fireEvent.click(clear('offer', 'gold'));
    expect(clear('offer', 'gold').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Gold 30' })).toBeNull();
    fireEvent.click(clear('', 'stance'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await answer).toEqual({
      status: 'propose',
      items: [{ kind: 'gold', side: 'demand', key: '', amount: 10, text: 'Gold 10' }],
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
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
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
          message('Jamestown has grown.', {
            source: 'colony:1',
            tile: 'tile:9',
            at: [3, 4],
            heading: { text: 'Jamestown', tile: 'tile:9', at: [3, 4] },
          }),
          message('Jamestown is hungry.', { type: 'WARNING', source: 'colony:1', tile: 'tile:9', at: [3, 4] }),
          message('Taxes are up.'),
        ],
      }),
    );
    screen.getByRole('heading', { name: 'Turn Report' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Jamestown']);
    fireEvent.click(screen.getByText('Jamestown has grown.'));
    expect(went).toEqual([[3, 4]]);
    expect(screen.getByText('Taxes are up.').closest('a')).toBeNull();

    key('Enter');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open the turn report with no messages, and say nothing happened', () => {
    const { box } = host();
    act(() =>
      box.show('messages', {
        title: 'Turn Report',
        ok: 'OK',
        messages: [],
        groupBy: { label: 'Group by', value: 0, choices: [{ value: 0, text: 'Nothing' }] },
      }),
    );
    screen.getByRole('heading', { name: 'Turn Report' });
    screen.getByText('Nothing happened this turn.');
  });

  it('open the colony panel or Europe from a heading or image that links to one', () => {
    const { box, went, pressed } = host();
    act(() =>
      box.show('messages', {
        title: 'Turn Report',
        ok: 'OK',
        messages: [
          message('Jamestown has grown.', {
            at: [3, 4],
            images: ['image.unit.model.unit.caravel'],
            link: { kind: 'colony', id: 'colony:1' },
            heading: { text: 'Jamestown', tile: 'tile:9', at: [3, 4], link: { kind: 'colony', id: 'colony:1' } },
          }),
          message('A ship has arrived.', {
            heading: { text: 'Europe', tile: null, at: null, link: { kind: 'europe' } },
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByText('Jamestown'));
    fireEvent.click(screen.getByText('Europe'));
    fireEvent.click(document.querySelector('a.pic-link')!);
    expect(went).toEqual([]);
    expect(pressed).toEqual([
      'open {"kind":"colony","id":"colony:1"}',
      'open {"kind":"europe"}',
      'open {"kind":"colony","id":"colony:1"}',
    ]);
  });

  it("open our colony from its name in a message's text, and go to another's", () => {
    const { box, went, pressed } = host();
    act(() =>
      box.show('messages', {
        title: 'Turn Report',
        ok: 'OK',
        messages: [
          message('Famine feared in Jamestown in 3 turns.', {
            at: [3, 4],
            parts: [
              { text: 'Famine feared in ', link: null, at: null },
              { text: 'Jamestown', link: { kind: 'colony', id: 'colony:1' }, at: null },
              { text: ' in 3 turns.', link: null, at: null },
            ],
          }),
          message('Testville was seen.', {
            at: [3, 4],
            parts: [
              { text: 'Testville', link: null, at: [7, 8] },
              { text: ' was seen.', link: null, at: null },
            ],
          }),
        ],
      }),
    );
    expect(screen.getByText('Jamestown').closest('p')?.textContent).toBe('Famine feared in Jamestown in 3 turns.');
    fireEvent.click(screen.getByText('Jamestown'));
    fireEvent.click(screen.getByText('Testville'));
    expect(pressed).toEqual(['open {"kind":"colony","id":"colony:1"}']);
    expect(went).toEqual([[7, 8]]);
  });

  it('show the image of what a message is about, the first of its keys the Tileset has', () => {
    const { box } = host();
    act(() =>
      box.show('messages', {
        title: null,
        ok: 'OK',
        messages: [
          message('The Caravel is lost.', {
            images: ['image.unit.model.unit.caravel.dutch', 'image.unit.model.unit.caravel'],
          }),
          message('Nothing to see.', { images: ['image.icon.model.goods.nothing'] }),
          message('No image at all.'),
        ],
      }),
    );
    const pics = screen.getAllByRole('presentation') as HTMLImageElement[];
    expect(pics.map((p) => p.getAttribute('src'))).toEqual(['art/caravel.png']);
    expect(pics[0].closest('.message')?.textContent).toBe('The Caravel is lost.');
  });

  it('show the image of the object an information panel is about', () => {
    const { box } = host();
    act(() =>
      box.show('information', {
        text: 'A ship.',
        object: 'unit:1',
        tile: null,
        at: null,
        images: ['image.unit.model.unit.caravel'],
        ok: 'OK',
      }),
    );
    expect(screen.getByRole('presentation').getAttribute('src')).toBe('art/caravel.png');
  });

  it('show an information panel and model messages under the advisor, but not the turn report', () => {
    const { box } = host({ advisor: { src: 'art/doctor-paper.png', top: 205 } });
    act(() => box.show('information', { text: 'A ship.', object: null, tile: null, at: null, images: [], ok: 'OK' }));
    const panel = screen.getByRole('dialog');
    expect(panel.classList.contains('advised')).toBe(true);
    expect(panel.style.getPropertyValue('--advisor')).toBe('url("art/doctor-paper.png")');
    expect(panel.style.getPropertyValue('--advisor-top')).toBe('205px');
    key('Enter');
    act(() => box.show('messages', { title: null, ok: 'OK', messages: [message('Taxes are up.')] }));
    expect(screen.getByRole('dialog').classList.contains('advised')).toBe(true);
    key('Enter');
    act(() => box.show('messages', { title: 'Turn Report', ok: 'OK', messages: [message('Taxes are up.')] }));
    expect(screen.getByRole('dialog').classList.contains('advised')).toBe(false);
  });

  it('show the flavour image of an event panel above its footer', () => {
    const { box } = host();
    act(() =>
      box.show('eventPanel', {
        header: 'Landfall',
        image: 'image.flavor.event.firstLanding',
        footer: 'Land ho!',
        ok: 'OK',
      }),
    );
    const img = screen.getByRole('presentation');
    expect(img.getAttribute('src')).toBe('art/landing.png');
    expect(img.compareDocumentPosition(screen.getByText('Land ho!')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    key('Enter');
    act(() => box.show('eventPanel', { header: 'Gone', image: 'image.flavor.nothing', footer: null, ok: 'OK' }));
    expect(screen.queryByRole('presentation'), 'an image the Tileset lacks is left out').toBeNull();
  });

  it('answers when the Engine waits on an event panel and the player closes it', async () => {
    const { box } = host();
    const closed = ask(box, 'event', {
      header: 'Landfall',
      image: 'image.flavor.event.firstLanding',
      footer: null,
      ok: 'OK',
    });
    expect(screen.getByRole('dialog').getAttribute('data-kind')).toBe('event');
    expect(screen.getByRole('presentation').getAttribute('src')).toBe('art/landing.png');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await closed).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('of a tile', () => {
    it('shows the tile, shows what an expert makes, and opens the Colopedia on its type', () => {
      const box = dialogs();
      const opened: string[] = [];
      render(
        <DialogHost
          dialogs={box}
          goTo={() => {}}
          art={art}
          report={{ groupBy: () => {}, filter: () => {}, ignore: () => {}, open: () => {} }}
          routes={{ save: () => {}, remove: () => {}, assign: () => {} }}
          colopedia={(type) => opened.push(type)}
        />,
      );
      act(() =>
        box.show('tilePanel', {
          title: 'Hills (15, 50)',
          type: 'model.tile.hills',
          keys: [],
          forest: null,
          rows: [
            { label: 'Owner:', value: 'Aztec' },
            { label: 'Movement cost:', value: '2' },
          ],
          production: [
            { type: 'model.goods.food', name: 'Food', keys: [], amount: 2, expert: 4 },
            { type: 'model.goods.ore', name: 'Ore', keys: [], amount: 4, expert: 4 },
          ],
          colonyValue: ['PROD 12.0', 'Result 40'],
          colopedia: 'Colopedia',
          ok: 'OK',
        }),
      );
      expect(screen.getByRole('dialog').getAttribute('data-kind')).toBe('tilePanel');
      // TilePanel's debug lines, when the debug menu chose a player.
      screen.getByText('PROD 12.0');
      screen.getByText('Result 40');
      screen.getByText('Hills (15, 50)');
      screen.getByText('Aztec');
      screen.getByText('2/4');
      screen.getByText('4');
      fireEvent.click(screen.getByRole('button', { name: 'Colopedia' }));
      expect(opened).toEqual(['model.tile.hills']);
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('of the Colopedia', () => {
    it('shows a terrain entry and closes with OK', () => {
      const { box } = host();
      const colopedia: GuiEvents['colopedia'] = {
        name: 'Plains',
        keys: ['image.tile.model.tile.plains.center'],
        forest: null,
        labels: {
          terrainImage: 'Terrain image',
          resource: 'Possible resource',
          movementCost: 'Movement cost',
          defenseBonus: 'Defense bonus',
          unattended: 'Unattended production',
          colonist: 'Colonist production',
          description: 'Description',
        },
        movementCost: '1',
        defence: 'None',
        resources: [{ name: 'Minerals', keys: [] }],
        unattended: [{ type: 'model.goods.food', name: 'Food', keys: [], amount: 2 }],
        colonist: [{ type: 'model.goods.food', name: 'Food', keys: [], amount: 5 }],
        description: 'Plains are large areas of land.',
        ok: 'OK',
      };
      act(() => box.show('colopedia', colopedia));
      expect(screen.getByRole('dialog').getAttribute('data-kind')).toBe('colopedia');
      for (const text of [
        'Plains',
        'Movement cost',
        'Defense bonus',
        'None',
        'Minerals',
        'Plains are large areas of land.',
      ]) {
        screen.getByText(text);
      }
      expect(screen.getAllByTitle('Food')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('of a native settlement', () => {
    const settlement = (more: Partial<GuiEvents['indianSettlement']> = {}): GuiEvents['indianSettlement'] => ({
      name: 'Cuzco',
      kind: 'Inca Capital',
      tension: 'Content',
      worthScouting: false,
      images: [],
      missionary: null,
      skill: { text: 'Expert Fur Trapper', images: ['image.unit.model.unit.caravel'] },
      mostHated: { text: 'the English', images: [] },
      wanted: [
        { text: 'Rum', images: [], tip: 'sold for 3' },
        { text: 'Tools', images: [], tip: null },
        { text: 'Muskets', images: [], tip: null },
      ],
      labels: {
        learnableSkill: 'Skill taught:',
        hatedNation: 'Most hated:',
        highlyWanted: 'Very interested in:',
        otherWanted: 'Also wanted:',
      },
      ok: 'OK',
      tile: 'tile:9',
      at: [3, 4],
      ...more,
    });

    it('shows what the player has learned and closes with OK or Escape', () => {
      const { box } = host();
      act(() => box.show('indianSettlement', settlement({ missionary: { text: 'Our Jesuit', images: [] } })));
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('data-kind')).toBe('indianSettlement');
      for (const text of [
        'Cuzco, Inca Capital (Content)',
        'Our Jesuit',
        'Expert Fur Trapper',
        'the English',
        'Rum',
        'Tools',
        'Muskets',
      ]) {
        screen.getByText(text);
      }
      expect(screen.getByText('Rum').getAttribute('title')).toBe('sold for 3');
      expect(screen.getByText('Skill taught:')).toBeTruthy();
      expect(dialog.querySelector('img')?.getAttribute('src'), 'the skill icon').toBe('art/caravel.png');
      key('Escape');
      expect(screen.queryByRole('dialog')).toBeNull();

      act(() => box.show('indianSettlement', settlement()));
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('marks a settlement worth scouting with the Tileset string', () => {
      const { box } = host();
      act(() => box.show('indianSettlement', settlement({ worthScouting: true })));
      expect(screen.getByText(/Cuzco, Inca Capital/).textContent).toContain('unscoutedIndianSettlement');
    });
  });

  describe('of the turn report', () => {
    const report = (groupBy = 0): GuiEvents['messages'] => ({
      title: 'Turn Report',
      ok: 'OK',
      groupBy: {
        label: 'Group messages by',
        value: groupBy,
        choices: [
          { value: 0, text: 'Nothing' },
          { value: 1, text: 'Type' },
          { value: 2, text: 'Source' },
        ],
      },
      messages: [
        message('The warehouse is full.', {
          type: 'WAREHOUSE_CAPACITY',
          filter: true,
          filterTip: 'Do not display this type of message (Warehouse capacity)',
          ignoreTip: 'Ignore this message (Colony: Jamestown, Goods: Food)',
        }),
        message('The rumour is gone.', { type: 'LOST_CITY_RUMOUR' }),
        message('Another warehouse is full.', {
          type: 'WAREHOUSE_CAPACITY',
          filter: true,
          filterTip: 'Do not display this type of message (Warehouse capacity)',
          ignoreTip: 'Ignore this message (Colony: Boston, Goods: Rum)',
        }),
      ],
    });
    const dim = (text: string) => screen.getByText(text).closest('.message')?.hasAttribute('data-dim');

    it('offers the group by option, and asks the Engine to regroup when it changes', async () => {
      const { box, pressed } = host();
      act(() => box.show('messages', report(0)));
      const select = screen.getByRole('combobox', { name: /Group messages by/ });
      expect(shown(select)).toBe('Nothing');
      await openSelect(select);
      expect(listed()).toEqual(['Nothing', 'Type', 'Source']);
      await chooseOption(select, 'Source');
      expect(pressed).toEqual(['groupBy 2']);
    });

    it('shows the regrouped report in the place of the open one', () => {
      const { box } = host();
      act(() => box.show('messages', report(0)));
      act(() =>
        box.replace('messages', {
          ...report(1),
          regrouped: true,
          messages: [message('The rumour is gone.', { heading: { text: 'Rumours', tile: null, at: null } })],
        }),
      );
      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Rumours']);
      expect(shown(screen.getByRole('combobox'))).toBe('Type');
      expect(screen.queryByText('The warehouse is full.')).toBeNull();
    });

    it('has no group by option for model messages', () => {
      const { box } = host();
      act(() => box.show('messages', { title: null, ok: 'OK', messages: [message('Hello.')] }));
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'X' })).toBeNull();
    });

    it('gives only the messages that have them an ignore and a filter button', () => {
      const { box } = host();
      act(() => box.show('messages', report()));
      expect(screen.getAllByRole('button', { name: 'x' })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'X' })).toHaveLength(2);
      const rumour = screen.getByText('The rumour is gone.').closest('.message')!;
      expect(rumour.querySelectorAll('button')).toHaveLength(0);
      expect(screen.getAllByRole('button', { name: 'x' })[1].getAttribute('title')).toBe(
        'Ignore this message (Colony: Boston, Goods: Rum)',
      );
    });

    it('dims an ignored message, tells the Engine, and brings it back when pressed again', () => {
      const { box, pressed } = host();
      act(() => box.show('messages', report()));
      const [first] = screen.getAllByRole('button', { name: 'x' });
      fireEvent.click(first);
      expect(pressed).toEqual(['ignore 0 true']);
      expect(dim('The warehouse is full.')).toBe(true);
      expect(dim('Another warehouse is full.'), 'only that message').toBe(false);
      fireEvent.click(first);
      expect(pressed).toEqual(['ignore 0 true', 'ignore 0 false']);
      expect(dim('The warehouse is full.')).toBe(false);
    });

    it('dims all the messages of a filtered type, tells the Engine, and shows them again when pressed again', () => {
      const { box, pressed } = host();
      act(() => box.show('messages', report()));
      const [first] = screen.getAllByRole('button', { name: 'X' });
      fireEvent.click(first);
      expect(pressed).toEqual(['filter 0 false']);
      expect(dim('The warehouse is full.')).toBe(true);
      expect(dim('Another warehouse is full.'), 'both of the type').toBe(true);
      expect(dim('The rumour is gone.'), 'not of another type').toBe(false);
      fireEvent.click(screen.getAllByRole('button', { name: 'X' })[1]);
      expect(pressed).toEqual(['filter 0 false', 'filter 2 true']);
      expect(dim('Another warehouse is full.')).toBe(false);
    });

    it('starts with the messages the Engine says are ignored or filtered out dimmed', () => {
      const { box } = host();
      const r = report();
      r.messages[0] = { ...r.messages[0], ignored: true };
      r.messages[2] = { ...r.messages[2], filter: false };
      act(() => box.show('messages', r));
      expect(dim('The warehouse is full.')).toBe(true);
      expect(dim('Another warehouse is full.')).toBe(true);
      expect(dim('The rumour is gone.')).toBe(false);
    });
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

describe('the error panel', () => {
  it('has a button for the log, as FreeCol’s ErrorPanel does', () => {
    let opened = 0;
    const { box } = host({ log: () => opened++ });
    act(() => box.show('error', { text: 'Out of moves', ok: 'OK', showLog: 'Show log file (Engine log)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show log file (Engine log)' }));
    expect(opened).toBe(1);
    // The panel stays open under the log.
    screen.getByText('Out of moves');
  });

  it('has a Copy details button that hands the panel’s event on, and says Copied', async () => {
    const copied: GuiEvents['error'][] = [];
    const { box } = host({
      copy: (e) => {
        copied.push(e);
        return Promise.resolve(true);
      },
    });
    const e = { text: 'The server can not do that.', ok: 'OK', detail: 'Not our unit', request: '<move/>' };
    act(() => box.show('error', e));
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(copied).toEqual([e]);
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

  it('answers the fields, as edited, on ok', async () => {
    const { box } = host();
    const edited = ask(box, 'names', q);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Newland' } });
    fireEvent.click(screen.getByRole('button', { name: 'Liberty' }));
    expect(await edited).toEqual(['Free Dutch', 'Newland']);
  });

  it('defaults to No: Enter does not declare', async () => {
    const { box } = host();
    const kept = ask(box, 'names', q);
    expect(enterMarked()).toEqual(['Later']);
    key('Enter');
    expect(await kept).toBeNull();
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

describe('the colony dialog', () => {
  it('has the warehouse button beside OK, at the bottom right', () => {
    const calls: string[] = [];
    const moves = new Proxy({}, { get: (_, k) => (id: string) => calls.push(`${String(k)} ${id}`) }) as ColonyMoves;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost dialogs={box} goTo={() => {}} art={art} report={{} as ReportButtons} routes={{} as RouteButtons} />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', jamestown));
    const buttons = screen.getByRole('button', { name: jamestown.warehouse.title }).parentElement!;
    expect(buttons.className).toBe('buttons');
    expect(buttons.querySelector('[data-answer="close"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: jamestown.warehouse.title }));
    expect(calls).toEqual([`warehouse ${jamestown.id}`]);
  });

  it('leaves closing to the Engine, which may ask first, and closes once it says so', () => {
    const calls: string[] = [];
    const moves = new Proxy({}, { get: (_, k) => (id: string) => calls.push(`${String(k)} ${id}`) }) as ColonyMoves;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost dialogs={box} goTo={() => {}} art={art} report={{} as ReportButtons} routes={{} as RouteButtons} />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', jamestown));
    fireEvent.click(document.querySelector('[data-answer="close"]')!);
    key('Escape');
    expect(calls).toEqual([`close ${jamestown.id}`, `close ${jamestown.id}`]);
    expect(box.shown('colony')).toHaveLength(1);
    act(() => box.remove('colony', (open) => open.id === 'colony:other'));
    expect(box.shown('colony')).toHaveLength(1);
    act(() => box.remove('colony', (open) => open.id === jamestown.id));
    expect(box.shown('colony')).toEqual([]);
    expect(box.current()).toBeNull();
  });
});

describe('the warehouse dialog', () => {
  const q: GuiQuestions['warehouse']['ask'] = {
    title: 'Warehouse',
    ok: 'OK',
    cancel: 'Cancel',
    export: 'Export',
    canExport: true,
    tips: { low: 'Low', high: 'High', import: 'Import', export: 'Export above', exported: 'Whether' },
    goods: [
      {
        type: 'model.goods.food',
        name: 'Food',
        keys: [],
        amount: 5,
        exported: false,
        low: 10,
        high: 90,
        import: 20,
        export: 50,
        max: 100,
      },
      {
        type: 'model.goods.rum',
        name: 'Rum',
        keys: [],
        amount: 0,
        exported: false,
        low: 0,
        high: 100,
        import: null,
        export: 0,
        max: 300,
      },
    ],
  };

  it('answers every goods with the levels as edited', async () => {
    const { box } = host();
    const edited = ask(box, 'warehouse', q);
    fireEvent.change(screen.getByLabelText('Food export'), { target: { value: '75' } });
    fireEvent.click(screen.getByLabelText('Food Export'));
    fireEvent.change(screen.getByLabelText('Rum high'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await edited).toEqual([
      { type: 'model.goods.food', exported: true, low: 10, high: 90, import: 20, export: 75 },
      { type: 'model.goods.rum', exported: false, low: 0, high: 100, import: null, export: 0 },
    ]);
    expect(screen.queryByLabelText('Rum import')).toBeNull();
  });

  it('cannot export without a custom house, and answers null on cancel', async () => {
    const { box } = host();
    const later = ask(box, 'warehouse', { ...q, canExport: false });
    expect((screen.getByLabelText('Food Export') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await later).toBeNull();
  });
});

describe('the trade routes panel', () => {
  const routes = (more: Partial<GuiEvents['tradeRoutes']> = {}): GuiEvents['tradeRoutes'] => ({
    title: 'Trade Routes',
    unit: null,
    assign: 'Assign Trade Route',
    unassign: 'Drop Trade Route',
    tooltips: {
      new: 'Create a new trade route.',
      edit: 'Edit an existing trade route.',
      delete: 'Delete this trade route completely.',
      deassign: 'Do not follow this trade route anymore.',
    },
    routes: [
      {
        id: 'tradeRoute:1',
        name: 'Fur run',
        silent: false,
        units: 2,
        stops: [
          { place: 'europe:1', label: 'Europe', cargo: ['model.goods.tools'] },
          { place: 'colony:7', label: 'New Amsterdam', cargo: ['model.goods.furs'] },
        ],
      },
      { id: 'tradeRoute:2', name: 'Rum run', silent: true, units: 0, stops: [] },
    ],
    places: [
      { id: 'europe:1', label: 'Europe' },
      { id: 'colony:7', label: 'New Amsterdam' },
    ],
    goods: [
      { id: 'model.goods.tools', name: 'Tools', icon: 'image.icon.model.goods.tools' },
      { id: 'model.goods.furs', name: 'Furs', icon: 'image.icon.model.goods.furs' },
    ],
    error: null,
    newRoute: 'New Trade Route',
    defaultName: 'Trade route 2',
    editRoute: 'Edit Trade Route',
    deleteRoute: 'Delete Trade Route',
    nameLabel: 'Name',
    destinationLabel: 'Destination',
    silence: 'Silence messages',
    addStop: 'Add new stop',
    removeStop: 'Remove stop',
    allColonies: 'All colonies',
    ok: 'OK',
    cancel: 'Cancel',
    ...more,
  });
  const press = (name: string | RegExp) => act(() => void fireEvent.click(screen.getByRole('button', { name })));

  it('assigns the picked route to the unit it was opened for, and drops it again', () => {
    const { box, assigned } = host();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: 'Europe', route: null } }),
      ),
    );
    expect((screen.getByRole('button', { name: 'Assign Trade Route' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Drop Trade Route' }) as HTMLButtonElement).disabled).toBe(true);
    press('Fur run (2)');
    press('Assign Trade Route');
    expect(assigned).toEqual(['unit:9 tradeRoute:1']);
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: 'Europe', route: 'tradeRoute:1' } }),
      ),
    );
    press('Drop Trade Route');
    expect(assigned).toEqual(['unit:9 tradeRoute:1', 'unit:9 null']);
  });

  it("starts with the unit's own route picked, and OK gives the unit the picked route and closes", () => {
    const { box, assigned } = host();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: null, route: 'tradeRoute:1' } }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Fur run (2)' }).getAttribute('aria-pressed')).toBe('true');
    // Its own route is already its route: OK assigns nothing.
    press('OK');
    expect(assigned).toEqual([]);
    expect(box.current()).toBeNull();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: null, route: 'tradeRoute:1' } }),
      ),
    );
    press('Rum run');
    press('OK');
    expect(assigned).toEqual(['unit:9 tradeRoute:2 hidden']);
  });

  it('gives a new route to the unit the panel was opened for', () => {
    const { box, saved } = host();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: null, route: null } }),
      ),
    );
    press('New Trade Route');
    press('Add new stop');
    press('OK');
    expect(saved[0].unit).toBe('unit:9');
  });

  it('has no assign buttons when it was not opened for a unit', () => {
    const { box } = host();
    act(() => box.replace('tradeRoutes', routes()));
    expect(screen.queryByRole('button', { name: 'Assign Trade Route' })).toBeNull();
  });

  it('lists the routes with the units that follow them, and deletes the picked one', () => {
    const { box, removed } = host();
    act(() => box.replace('tradeRoutes', routes()));
    expect(screen.getByRole('button', { name: 'Fur run (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rum run' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete Trade Route' }) as HTMLButtonElement).disabled).toBe(true);
    press('Rum run');
    press('Delete Trade Route');
    expect(removed).toEqual(['tradeRoute:2']);
  });

  it('makes a new route: a name, stops with their goods, and saves it', async () => {
    const { box, saved } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('New Trade Route');
    // It starts with the name the server would give it; nothing to save without a name.
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Trade route 2');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } });
    expect((screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tool run' } });
    await chooseOption(screen.getByRole('combobox'), 'Europe');
    press('Add new stop');
    press('Tools');
    await chooseOption(screen.getByRole('combobox'), 'New Amsterdam');
    press('Add new stop');
    press('Furs');
    press('OK');
    expect(saved).toEqual([
      {
        id: null,
        name: 'Tool run',
        silent: false,
        stops: [
          { place: 'europe:1', cargo: ['model.goods.tools'] },
          { place: 'colony:7', cargo: ['model.goods.tools', 'model.goods.furs'] },
        ],
      },
    ]);
  });

  it('edits a route and removes a stop', () => {
    const { box, saved } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('Fur run (2)');
    press('Edit Trade Route');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Fur run');
    fireEvent.click(screen.getByLabelText(/Silence messages/));
    // The first stop is edited; take it away and load tools at the colony, edited next, as well.
    press('Remove stop: Europe');
    press('Tools');
    press('OK');
    expect(saved).toEqual([
      {
        id: 'tradeRoute:1',
        name: 'Fur run',
        silent: true,
        stops: [{ place: 'colony:7', cargo: ['model.goods.furs', 'model.goods.tools'] }],
      },
    ]);
  });

  const stopAt = (i: number) => document.querySelector(`[data-stop="${i}"]`) as HTMLElement;
  const legAt = (i: number) => document.querySelector(`[data-leg="${i}"]`) as HTMLElement | null;
  const pinAt = (i: number) => stopAt(i).querySelector('.pin') as HTMLButtonElement;
  // The leg being edited.
  const edited = () => [...document.querySelectorAll('[data-leg]')].find((l) => l.hasAttribute('data-open'));
  const heldAt = (i: number) => [...legAt(i)!.querySelectorAll('[data-held]')].map((h) => h.getAttribute('data-held'));
  // A stop's worked-out chips: unload or load, goods type, and how many holds.
  const chipsAt = (i: number) =>
    [...stopAt(i).querySelectorAll('[data-work]')].map(
      (c) => `${c.getAttribute('data-work')} ${c.getAttribute('data-type')} ${c.textContent}`,
    );
  const threeStops = () => {
    const { box, saved } = host();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({
          routes: [
            {
              id: 'tradeRoute:1',
              name: 'Fur run',
              silent: false,
              units: 0,
              stops: [
                { place: 'europe:1', label: 'Europe', cargo: ['model.goods.tools'] },
                { place: 'colony:7', label: 'New Amsterdam', cargo: ['model.goods.furs'] },
                { place: 'colony:8', label: 'Jamestown', cargo: [] },
              ],
            },
          ],
          places: [
            { id: 'europe:1', label: 'Europe' },
            { id: 'colony:7', label: 'New Amsterdam' },
            { id: 'colony:8', label: 'Jamestown' },
            { id: 'colony:9', label: 'Plymouth' },
          ],
        }),
      ),
    );
    press('Fur run');
    press('Edit Trade Route');
    return saved;
  };
  const placesOf = (saved: { stops: { place: string }[] }[]) => saved[0].stops.map((s) => s.place);
  const T = 'model.goods.tools';
  const F = 'model.goods.furs';

  it("works out each stop's unloads and loads from the stop before it, round the loop", () => {
    threeStops();
    // Europe is reached from Jamestown, empty, and loads tools; New Amsterdam unloads them and loads furs;
    // Jamestown lists nothing, so it unloads the furs.
    expect(chipsAt(0)).toEqual([`load ${T} +1`]);
    expect(chipsAt(1)).toEqual([`unload ${T} −1`, `load ${F} +1`]);
    expect(chipsAt(2)).toEqual([`unload ${F} −1`]);
    // A stop that keeps what it arrived with has nothing to do.
    press('⧉ Copy New Amsterdam’s goods');
    expect(chipsAt(2)).toEqual([]);
    expect(stopAt(2).textContent).toContain('nothing to do');
  });

  it('shows each leg with where it goes, the last one back to the first stop', () => {
    threeStops();
    expect(legAt(0)!.textContent).toContain('→ New Amsterdam');
    expect(legAt(2)!.textContent).toContain('↺ back to Europe');
    expect(legAt(2)!.hasAttribute('data-back')).toBe(true);
    expect(legAt(0)!.hasAttribute('data-back')).toBe(false);
  });

  it('edits one leg at a time, with the goods under it; another leg or its Edit button moves the editing', () => {
    threeStops();
    expect(edited()).toBe(legAt(0));
    expect(legAt(0)!.querySelectorAll('[data-goods]')).toHaveLength(2);
    expect(legAt(1)!.querySelector('[data-goods]')).toBeNull();
    act(() => void fireEvent.click(within(legAt(1)!).getByRole('button', { name: 'Edit' })));
    expect(edited()).toBe(legAt(1));
    expect(legAt(0)!.querySelector('[data-goods]')).toBeNull();
    // Clicking a leg's box (not a button on it) edits it too.
    act(() => void fireEvent.click(legAt(2)!.querySelector('.ship')!));
    expect(edited()).toBe(legAt(2));
    // The goods go into the edited leg.
    press('Tools');
    expect(heldAt(2)).toEqual([T]);
  });

  it('adds holds, empties one on click, fills to the next mark on shift-click, and marks holds no carrier has', () => {
    const saved = threeStops();
    const shift = (name: string) =>
      act(() => void fireEvent.click(screen.getByRole('button', { name }), { shiftKey: true }));
    const marks = () => [...legAt(0)!.querySelectorAll('.mark')].map((m) => m.textContent);
    press('Tools');
    expect(heldAt(0)).toEqual([T, T]);
    // At three holds, shift-click fills to the mark after the fourth.
    press('Tools');
    shift('Furs');
    expect(heldAt(0)).toEqual([T, T, T, F]);
    expect(marks()).toEqual(['2']);
    act(() => void fireEvent.click(within(legAt(0)!).getAllByRole('button', { name: '× Tools' })[1]));
    expect(heldAt(0)).toEqual([T, T, F]);
    shift('Furs');
    expect(heldAt(0)).toEqual([T, T, F, F]);
    shift('Furs');
    expect(heldAt(0)).toEqual([T, T, F, F, F, F]);
    expect(marks()).toEqual(['2', '4']);
    expect(legAt(0)!.querySelector('[data-over]')).toBeNull();
    // A seventh hold: no carrier has it.
    press('Tools');
    expect([...legAt(0)!.querySelectorAll('[data-held]')].map((h) => h.hasAttribute('data-over'))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(marks()).toEqual(['2', '4', '6']);
    press('OK');
    expect(saved[0].stops[0].cargo).toEqual([T, T, F, F, F, F, T]);
  });

  it("copies the previous stop's goods, and is disabled once they are the same", () => {
    const saved = threeStops();
    // Europe's previous stop is Jamestown, round the loop.
    press('⧉ Copy Jamestown’s goods');
    expect(heldAt(0)).toEqual([]);
    expect((screen.getByRole('button', { name: 'Same goods as Jamestown' }) as HTMLButtonElement).disabled).toBe(true);
    press('⧉ Copy Europe’s goods');
    expect((screen.getByRole('button', { name: 'Same goods as Europe' }) as HTMLButtonElement).disabled).toBe(true);
    press('OK');
    expect(saved[0].stops.map((s) => s.cargo)).toEqual([[], [], []]);
  });

  it("folds a stop's leg by its number and unfolds it again; a folded leg is not edited", () => {
    threeStops();
    expect(pinAt(0).getAttribute('aria-expanded')).toBe('true');
    act(() => void fireEvent.click(pinAt(0)));
    expect(pinAt(0).getAttribute('aria-expanded')).toBe('false');
    expect(legAt(0)).toBeNull();
    // The stop row and its chips stay; no leg is being edited now.
    expect(chipsAt(0)).toEqual([`load ${T} +1`]);
    expect(edited()).toBeUndefined();
    expect(document.querySelector('[data-goods]')).toBeNull();
    act(() => void fireEvent.click(pinAt(0)));
    expect(pinAt(0).getAttribute('aria-expanded')).toBe('true');
    expect(heldAt(0)).toEqual([T]);
    // Folding another leg leaves the edited one alone.
    act(() => void fireEvent.click(within(legAt(0)!).getByRole('button', { name: 'Edit' })));
    act(() => void fireEvent.click(pinAt(2)));
    expect(legAt(2)).toBeNull();
    expect(edited()).toBe(legAt(0));
  });

  it('adds a stop after the one being edited, with the goods it leaves with, and edits it', () => {
    const saved = threeStops();
    act(() => void fireEvent.click(within(legAt(1)!).getByRole('button', { name: 'Edit' })));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'colony:9' } });
    press('Add new stop');
    expect(edited()).toBe(legAt(2));
    expect(stopAt(2).textContent).toContain('Plymouth');
    press('OK');
    expect(placesOf(saved)).toEqual(['europe:1', 'colony:7', 'colony:9', 'colony:8']);
    expect(saved[0].stops[2].cargo).toEqual([F]);
  });

  it('removes a stop by its ✕, and the stop in its place is edited next', () => {
    const saved = threeStops();
    press('Remove stop: Europe');
    expect(edited()).toBe(legAt(0));
    expect(stopAt(0).textContent).toContain('New Amsterdam');
    press('OK');
    expect(placesOf(saved)).toEqual(['colony:7', 'colony:8']);
  });

  it('moves a stop dragged onto another to its place, with its goods, folding and editing', () => {
    const saved = threeStops();
    act(() => void fireEvent.click(pinAt(1)));
    // Europe, edited, goes where Jamestown is: last.
    act(() => dragOnto(stopAt(0), stopAt(2)));
    expect(stopAt(2).classList.contains('over-target')).toBe(false);
    expect(stopAt(2).textContent).toContain('Europe');
    expect(edited()).toBe(legAt(2));
    // New Amsterdam, folded, is now first and still folded.
    expect(pinAt(0).getAttribute('aria-expanded')).toBe('false');
    // Jamestown goes first.
    act(() => dragOnto(stopAt(1), stopAt(0)));
    press('OK');
    expect(placesOf(saved)).toEqual(['colony:8', 'colony:7', 'europe:1']);
    expect(saved[0].stops.map((s) => s.cargo)).toEqual([[], [F], [T]]);
  });

  it('disables Add Stop once the route has a stop for every place', async () => {
    const { box } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('New Trade Route');
    const add = screen.getByRole('button', { name: 'Add new stop' }) as HTMLButtonElement;
    await chooseOption(screen.getByRole('combobox'), 'Europe');
    press('Add new stop');
    expect(add.disabled).toBe(false);
    press('Add new stop');
    expect(add.disabled).toBe(true);
  });

  it('has tooltips on the route buttons and says which unit it was opened for, and where', () => {
    const { box } = host();
    act(() =>
      box.replace(
        'tradeRoutes',
        routes({ unit: { id: 'unit:9', name: 'Caravel', images: [], location: 'Europe', route: 'tradeRoute:1' } }),
      ),
    );
    expect(screen.getByRole('button', { name: 'New Trade Route' }).title).toBe('Create a new trade route.');
    expect(screen.getByRole('button', { name: 'Delete Trade Route' }).title).toBe(
      'Delete this trade route completely.',
    );
    expect(screen.getByText(/Caravel Europe/)).toBeTruthy();
  });

  it('adds Europe and every colony for all colonies', () => {
    const { box, saved } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('New Trade Route');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'All' } });
    press('Add new stop');
    press('OK');
    expect(saved[0].stops.map((s) => s.place)).toEqual(['europe:1', 'colony:7']);
  });

  it("shows FreeCol's reason when a change is refused, and keeps what the player made", () => {
    const { box, saved } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('New Trade Route');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Short' } });
    press('OK');
    expect(saved).toHaveLength(1);
    // The Engine refuses and sends the panel again, with the reason.
    act(() => box.replace('tradeRoutes', routes({ error: 'A trade route needs at least two stops.' })));
    expect(screen.getByRole('alert').textContent).toBe('A trade route needs at least two stops.');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Short');
    // Cancel goes back to the routes.
    press('Cancel');
    expect(screen.getByRole('button', { name: 'Fur run (2)' })).toBeTruthy();
  });

  it('closes on Enter or Escape from the list, and goes back from the editor on Escape', () => {
    const { box } = host();
    act(() => box.replace('tradeRoutes', routes()));
    press('New Trade Route');
    key('Escape');
    expect(box.current()?.kind).toBe('tradeRoutes');
    expect(screen.getByRole('button', { name: 'Fur run (2)' })).toBeTruthy();
    key('Escape');
    expect(box.current()).toBeNull();
  });
});

describe('the Europe panel', () => {
  const unit = (id: string, name: string, more: Partial<EuropeUnit> = {}): EuropeUnit => ({
    id,
    name,
    images: ['image.unit.model.unit.caravel'],
    selected: false,
    ...more,
  });
  const caravel = unit('unit:1', 'Caravel', {
    selected: true,
    cargo: [{ kind: 'goods', id: 'model.goods.food', name: 'Food', amount: 50, images: [] }],
  });
  const galleon = unit('unit:2', 'Galleon', {
    cargo: [{ kind: 'unit', id: 'unit:9', name: 'Free Colonist', amount: 1, images: [] }],
  });
  const europe: GuiEvents['europe'] = {
    title: 'Europe',
    log: {
      heading: 'Sales',
      entries: [
        ['Purchase 20 Cloth @3', 'Price:\t60'],
        ['Sell 10 Cloth @2', 'Price:\t20', '-10%:\t2', 'Net:\t18'],
      ],
    },
    ok: 'Close',
    headings: {
      toAmerica: 'Sailing to America',
      toEurope: 'Sailing to Europe',
      inPort: 'In port',
      docks: 'Docks',
      cargo: 'Cargo',
    },
    toAmerica: [unit('unit:3', 'Merchantman')],
    toEurope: [],
    inPort: [caravel, galleon],
    docks: [unit('unit:4', 'Expert Farmer', { images: [] })],
    selected: 'unit:1',
    buttons: { train: 'Train', purchase: 'Purchase', recruit: 'Recruit', unload: 'Unload', sail: 'Set sail' },
    recruit: {
      heading: 'Recruit',
      text: 'Click on a unit to recruit it for 200 gold (1 turns)',
      price: 200,
      units: [
        { index: 0, name: 'Expert Fisherman', images: [], enabled: true },
        { index: 1, name: 'Free Colonist', images: [], enabled: true },
      ],
    },
    train: {
      heading: 'Train',
      units: [
        {
          id: 'model.unit.masterCarpenter',
          name: 'Master Carpenter',
          images: [],
          price: 500,
          priceLabel: '500 gold',
          enabled: true,
        },
        {
          id: 'model.unit.masterGunsmith',
          name: 'Master Gunsmith',
          images: [],
          price: 900,
          priceLabel: '900 gold',
          enabled: false,
        },
      ],
    },
    purchase: {
      heading: 'Purchase',
      units: [
        { id: 'model.unit.galleon', name: 'Galleon', images: [], price: 1000, priceLabel: '1000 gold', enabled: true },
      ],
    },
    market: [
      {
        id: 'model.goods.food',
        name: 'Food',
        images: [],
        sell: 1,
        buy: 2,
        inMarket: 120,
        enabled: true,
        reason: null,
      },
      {
        id: 'model.goods.rum',
        name: 'Rum',
        images: [],
        sell: 5,
        buy: 6,
        inMarket: 0,
        enabled: false,
        reason: 'The Crown is boycotting these goods until you have paid your tax arrears of 100 gold.',
      },
    ],
  };
  /** The names in one of the panel's lists. */
  const names = (list: string) =>
    [...document.querySelectorAll(`[data-list=${list}] .chip .name`)].map((n) => n.textContent);

  it('lists the ships, the docks and every goods’ prices under FreeCol’s headings', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    expect(screen.getByRole('heading', { name: 'Europe' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sailing to America' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sailing to Europe' })).toBeTruthy();
    expect(names('toAmerica')).toEqual(['Merchantman']);
    expect(names('toEurope')).toEqual([]);
    expect(names('inPort')).toEqual(['Caravel', 'Galleon']);
    expect(names('docks')).toEqual(['Expert Farmer']);
    const prices = [...document.querySelectorAll('[data-goods]')].map((g) => [
      g.getAttribute('data-goods'),
      g.querySelector('.price')?.textContent,
      g.hasAttribute('data-disabled'),
    ]);
    expect(prices).toEqual([
      ['model.goods.food', '1/2', false],
      ['model.goods.rum', '5/6', true],
    ]);
    // The art of the unit's key is shown.
    expect(document.querySelector('[data-list=toAmerica] img')?.getAttribute('src')).toBe('art/caravel.png');
  });

  it('closes on E, the key that opened it, but not while a shop list is open over it', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.click(screen.getByRole('button', { name: 'Recruit' }));
    key('e');
    expect(box.current()?.kind).toBe('europe');
    expect(document.querySelector('[data-shop=recruit]')).toBeTruthy();
    key('Escape');
    expect(document.querySelector('[data-shop]')).toBeNull();
    key('E');
    expect(box.current()).toBeNull();
  });

  /** The sales log's entries as shown: each its lines, a label and its amount joined by a space. */
  const logEntries = () =>
    [...document.querySelectorAll('[data-log] [data-entry]')].map((e) =>
      [...e.querySelectorAll('[data-line]')].map((l) =>
        [...l.querySelectorAll('span')].map((s) => s.textContent).join(' '),
      ),
    );

  it('logs in a sidebar the purchases and sales of the turn, newest last, under FreeCol’s heading', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    const log = document.querySelector<HTMLElement>('[data-log]')!;
    expect(within(log).getByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(logEntries()).toEqual([
      ['Purchase 20 Cloth @3', 'Price: 60'],
      ['Sell 10 Cloth @2', 'Price: 20', '-10%: 2', 'Net: 18'],
    ]);
  });

  it('shows the sales log empty, with its heading, when nothing was traded this turn', () => {
    const { box } = host();
    act(() => box.show('europe', { ...europe, log: { heading: 'Sales', entries: [] } }));
    const log = document.querySelector<HTMLElement>('[data-log]')!;
    expect(within(log).getByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(logEntries()).toEqual([]);
  });

  it('shows the cargo of the selected ship, and of another when it is picked', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    // The market names Food too, so look in the cargo box only.
    const cargo = () => within(document.querySelector<HTMLElement>('[data-list=cargo]')!);
    expect(names('cargo')).toEqual(['50']);
    expect(cargo().getByTitle('Food')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Galleon' }));
    expect(names('cargo')).toEqual([]);
    expect(cargo().getByTitle('Free Colonist')).toBeTruthy();
  });

  it('recruits, trains and buys from the lists its buttons open, and offers what is too dear dimmed', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      recruit: (i: number) => calls.push(`recruit ${i}`),
      train: (id: string) => calls.push(`train ${id}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    expect(document.querySelector('[data-shop]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Recruit' }));
    expect(screen.getByText(/recruit it for 200 gold/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Free Colonist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Train' }));
    expect(document.querySelector('[data-shop=recruit]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Master Carpenter/ }));
    expect(screen.getByText('500 gold')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Master Gunsmith/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Purchase' }));
    fireEvent.click(screen.getByRole('button', { name: /1000 gold/ }));
    expect(calls).toEqual(['recruit 1', 'train model.unit.masterCarpenter', 'train model.unit.galleon']);
  });

  it('presses its buttons with R, P, T and S, as EuropePanel binds them', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, { sail: (s: string) => calls.push(`sail ${s}`) });
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(document.querySelector('[data-shop=recruit]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 't' });
    expect(document.querySelector('[data-shop=train]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(document.querySelector('[data-shop=purchase]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(document.querySelector('[data-shop]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Galleon' }));
    fireEvent.keyDown(document.body, { key: 's' });
    expect(calls).toEqual(['sail unit:2']);
  });

  it('loads a unit of the docks on the picked ship, and sends that ship to the New World', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      board: (u: string, s: string) => calls.push(`board ${u} ${s}`),
      sail: (s: string) => calls.push(`sail ${s}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.click(screen.getByRole('button', { name: 'Expert Farmer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Galleon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set sail' }));
    expect(calls).toEqual(['board unit:4 unit:1', 'sail unit:2']);
  });

  it('sends a ship in port to America when it is dropped on the ships sailing there', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      board: (u: string, s: string) => calls.push(`board ${u} ${s}`),
      sail: (s: string) => calls.push(`sail ${s}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    // A unit of the docks is no ship: dropped there, it does nothing.
    act(() =>
      dragOnto(screen.getByRole('button', { name: 'Expert Farmer' }), document.querySelector('[data-list=toAmerica]')!),
    );
    expect(calls).toEqual([]);
    act(() =>
      dragOnto(screen.getByRole('button', { name: 'Galleon' }), document.querySelector('[data-list=toAmerica]')!),
    );
    expect(calls).toEqual(['sail unit:2']);
  });

  it('drags a goods of the market by its picture alone, without its prices, until Escape puts it back', () => {
    const { box } = host();
    const market = europe.market.map((g) => ({ ...g, images: ['image.unit.model.unit.caravel'] }));
    act(() => box.show('europe', { ...europe, market }));
    const good = document.querySelector('[data-goods="model.goods.food"]')!;
    fireEvent.pointerDown(good, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document.querySelector('[data-list=cargo]')!, { clientX: 20, clientY: 0 });
    const ghost = document.querySelector('.drag-ghost')!;
    expect([...ghost.querySelectorAll('*')].map((e) => e.tagName)).toEqual(['DIV', 'IMG']);
    expect(ghost.querySelector('img')!.getAttribute('src')).toBe(good.querySelector('img')!.getAttribute('src'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('.drag-ghost')).toBeNull();
    // The window is still open: Escape put the goods back, and did nothing else.
    expect(document.querySelector('[data-list=market]')).not.toBeNull();
  });

  it('turns a ship on the high seas around when it is dragged to the other list', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      redirect: (s: string, toEurope: boolean) => calls.push(`redirect ${s} ${toEurope}`),
    });
    const { box } = host();
    const sailing = [unit('unit:7', 'Merchantman'), unit('unit:8', 'Brig')];
    act(() => box.show('europe', { ...europe, toAmerica: [sailing[0]], toEurope: [sailing[1]] }));
    act(() =>
      dragOnto(document.querySelector('[data-unit="unit:7"]')!, document.querySelector('[data-list=toEurope]')!),
    );
    act(() =>
      dragOnto(document.querySelector('[data-unit="unit:8"]')!, document.querySelector('[data-list=toAmerica]')!),
    );
    expect(calls).toEqual(['redirect unit:7 true', 'redirect unit:8 false']);
  });

  it('moves cargo to another ship dropped on its icon, and sells the stack dragged, all of the type with shift and alt', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      transfer: (a: string, b: string, g: string, n: number) => calls.push(`transfer ${a} ${b} ${g} ${n}`),
      sell: (g: string, s: string, ask: boolean, n: number) => calls.push(`sell ${g} ${s} ${ask} ${n}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    const stack = () => document.querySelector('[data-cargo="goods"]')!;
    const market = () => document.querySelector('[data-list=market]')!;
    act(() => dragOnto(stack(), document.querySelector('[data-unit="unit:2"]')!));
    act(() => dragOnto(stack(), market()));
    act(() => dragOnto(stack(), market(), { shiftKey: true, altKey: true }));
    expect(calls).toEqual([
      'transfer unit:1 unit:2 model.goods.food 50',
      'sell model.goods.food unit:1 false 50',
      'sell model.goods.food unit:1 false 0',
    ]);
  });

  it('names the picked ship and its holds left over the cargo', () => {
    const { box } = host();
    act(() =>
      box.show('europe', {
        ...europe,
        inPort: [{ ...europe.inPort[0], cargoTitle: 'Cargo on Caravel (2 holds left)' }],
      }),
    );
    expect(document.querySelector('[data-list=cargo] h3')!.textContent).toBe('Cargo on Caravel (2 holds left)');
  });

  it('closes the purchase popup when a purchase leaves nothing affordable', () => {
    Object.assign(europeButtons, { train: () => {} });
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.click(screen.getByRole('button', { name: 'Train' }));
    fireEvent.click(screen.getByRole('button', { name: /Master Carpenter/ }));
    // The panel is sent again with the gold spent: every card is disabled.
    const spent = {
      ...europe,
      train: { ...europe.train, units: europe.train.units.map((o) => ({ ...o, enabled: false })) },
    };
    act(() => box.replace('europe', spent));
    expect(document.querySelector('[data-shop]')).toBeNull();
  });

  it('unloads the picked ship with the Unload button, once it has cargo', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, { unload: (s: string) => calls.push(`unload ${s}`) });
    const { box } = host();
    act(() => box.show('europe', europe));
    const button = screen.getByRole('button', { name: 'Unload' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(calls).toEqual([`unload ${europe.selected}`]);
  });

  it('unloads the picked ship with U, as the Unload button does, and only with cargo aboard', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, { unload: (s: string) => calls.push(`unload ${s}`) });
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(calls).toEqual([`unload ${europe.selected}`]);
    const empty = europe.inPort.map((u) => ({ ...u, cargo: [] }));
    act(() => box.replace('europe', { ...europe, inPort: empty }));
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(calls).toHaveLength(1);
  });

  it('has nothing to unload with no cargo aboard', () => {
    const { box } = host();
    const empty = europe.inPort.map((u) => ({ ...u, cargo: [] }));
    act(() => box.show('europe', { ...europe, inPort: empty }));
    expect((screen.getByRole('button', { name: 'Unload' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has nothing to sail with no ship in port', () => {
    const { box } = host();
    act(() => box.show('europe', { ...europe, inPort: [], selected: null }));
    expect((screen.getByRole('button', { name: 'Set sail' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('buys a goods of the market onto the ship in port, and sells its cargo', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      buy: (g: string, s: string, ask: boolean) => calls.push(`buy ${g} ${s} ${ask}`),
      sell: (g: string, s: string, ask: boolean) => calls.push(`sell ${g} ${s} ${ask}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    // The market's goods are bought onto the picked ship.
    fireEvent.click(document.querySelector('[data-goods="model.goods.food"]')!);
    expect(calls).toEqual(['buy model.goods.food unit:1 true']);
    // A stack of the cargo is sold.
    fireEvent.click(document.querySelector('[data-cargo="goods"]')!);
    expect(calls).toEqual(['buy model.goods.food unit:1 true', 'sell model.goods.food unit:1 true']);
  });

  it('adds how much the market holds to a goods tooltip in debug mode only', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    expect(document.querySelector('[data-goods="model.goods.food"]')!.getAttribute('title')).toBe('Food');
    cleanup();
    const debugBox = dialogs();
    render(
      <DebugContext.Provider value={{ on: true, request: () => {} }}>
        <DialogHost
          dialogs={debugBox}
          goTo={() => {}}
          art={art}
          report={{ groupBy() {}, filter() {}, ignore() {}, open() {} }}
          routes={{ save() {}, remove() {}, assign() {} }}
        />
      </DebugContext.Provider>,
    );
    act(() => debugBox.show('europe', europe));
    expect(document.querySelector('[data-goods="model.goods.food"]')!.getAttribute('title')).toBe(
      'Food (120 in market)',
    );
  });

  it('greys a boycotted goods, says why, and a click asks the engine (which offers to pay the arrears)', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      buy: (g: string, s: string, ask: boolean) => calls.push(`buy ${g} ${s} ${ask}`),
      sell: (g: string, s: string, ask: boolean) => calls.push(`sell ${g} ${s} ${ask}`),
    });
    const { box } = host();
    const rumAboard = {
      kind: 'goods' as const,
      id: 'model.goods.rum',
      name: 'Rum',
      amount: 20,
      images: [],
    };
    const ship = { ...europe.inPort[0], cargo: [...(europe.inPort[0].cargo ?? []), rumAboard] };
    act(() => box.show('europe', { ...europe, inPort: [ship, ...europe.inPort.slice(1)] }));
    const reason = 'The Crown is boycotting these goods until you have paid your tax arrears of 100 gold.';
    const rum = document.querySelector('[data-goods="model.goods.rum"]')!;
    expect(rum.hasAttribute('data-disabled')).toBe(true);
    expect(rum.getAttribute('title')).toBe(reason);
    // Swing's MarketLabel offers to pay the arrears when a boycotted goods is bought.
    fireEvent.click(rum);
    expect(calls).toEqual(['buy model.goods.rum unit:1 true']);
    // And EuropePanel when a boycotted stack of the cargo is sold.
    const stack = [...document.querySelectorAll('[data-cargo="goods"]')].find(
      (el) => el.getAttribute('title') === reason,
    )!;
    expect(stack.hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(stack);
    expect(calls).toEqual(['buy model.goods.rum unit:1 true', 'sell model.goods.rum unit:1 true']);
  });

  it('trades nothing with no ship in port', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      buy: (g: string, s: string, ask: boolean) => calls.push(`buy ${g} ${s} ${ask}`),
    });
    const { box } = host();
    act(() => box.show('europe', { ...europe, inPort: [], selected: null }));
    // The market's goods are not buttons then, so there is nothing to click.
    expect(document.querySelector('[data-goods="model.goods.food"]')?.tagName).toBe('DIV');
    expect(calls).toEqual([]);
  });

  it('buys the market’s goods dropped on the cargo, and sells the cargo dropped on the market, all of it unless shift asks', () => {
    const calls: string[] = [];
    Object.assign(europeButtons, {
      buy: (g: string, s: string, ask: boolean) => calls.push(`buy ${g} ${s} ${ask}`),
      sell: (g: string, s: string, ask: boolean) => calls.push(`sell ${g} ${s} ${ask}`),
    });
    const { box } = host();
    act(() => box.show('europe', europe));
    const food = () => document.querySelector('[data-goods="model.goods.food"]')!;
    const stack = () => document.querySelector('[data-cargo="goods"]')!;
    const cargo = () => document.querySelector('[data-list=cargo]')!;
    const market = () => document.querySelector('[data-list=market]')!;
    act(() => dragOnto(food(), cargo()));
    expect(calls).toEqual(['buy model.goods.food unit:1 false']);
    act(() => dragOnto(stack(), market()));
    expect(calls).toEqual(['buy model.goods.food unit:1 false', 'sell model.goods.food unit:1 false']);
    // Shift held as the drag starts has the Engine ask how many.
    calls.length = 0;
    act(() => dragOnto(food(), cargo(), { shiftKey: true }));
    act(() => dragOnto(stack(), market(), { shiftKey: true }));
    expect(calls).toEqual(['buy model.goods.food unit:1 true', 'sell model.goods.food unit:1 true']);
  });

  it('opens the Engine’s quick-action menu on a right-click of a ship, a docked unit, cargo and the market', () => {
    const asked: string[] = [];
    const shown: string[] = [];
    const menus: ContextMenus = {
      colonyTile: () => null,
      unit: (id) => (asked.push(`unit ${id}`), { title: id, entries: [] }),
      goods: (at, type, amount) => (asked.push(`goods ${at} ${type} ${amount}`), { title: type, entries: [] }),
      show: (m, x, y) => shown.push(`${m.title} ${x},${y}`),
    };
    const box = dialogs();
    render(
      <ContextMenuContext.Provider value={menus}>
        <DialogHost
          dialogs={box}
          goTo={() => {}}
          art={art}
          report={{ groupBy() {}, filter() {}, ignore() {}, open() {} }}
          routes={{ save() {}, remove() {}, assign() {} }}
        />
      </ContextMenuContext.Provider>,
    );
    act(() => box.show('europe', europe));
    const click = (selector: string) =>
      fireEvent.contextMenu(document.querySelector(selector)!, { clientX: 5, clientY: 6 });
    click('[data-list=toAmerica] [data-unit="unit:3"]');
    click('[data-list=inPort] [data-unit="unit:1"]');
    click('[data-list=docks] [data-unit="unit:4"]');
    click('[data-list=cargo] [data-cargo="goods"]');
    click('[data-list=market] [data-goods="model.goods.rum"]');
    fireEvent.click(screen.getByRole('button', { name: 'Galleon' }));
    click('[data-list=cargo] [data-cargo="unit"]');
    expect(asked).toEqual([
      'unit unit:3',
      'unit unit:1',
      'unit unit:4',
      'goods unit:1 model.goods.food 50',
      'goods europe model.goods.rum 100',
      'unit unit:9',
    ]);
    expect(shown).toHaveLength(6);
  });

  it('closes on the button and Escape, and a second panel replaces the open one', () => {
    const { box } = host();
    act(() => box.show('europe', europe));
    fireEvent.click(document.querySelector('[data-answer="close"]')!);
    expect(box.current()).toBeNull();

    act(() => box.show('europe', europe));
    act(() => box.replace('europe', { ...europe, title: 'Europe again' }));
    expect(screen.getByRole('heading', { name: 'Europe again' })).toBeTruthy();
    key('Escape');
    expect(box.current()).toBeNull();
  });
});

describe('the options panel', () => {
  const options: GuiEvents['options'] = {
    kind: 'game',
    title: 'Game Options',
    ok: 'Close',
    root: {
      id: 'gameOptions',
      kind: 'group',
      label: 'Game Options',
      description: null,
      children: [
        {
          id: 'gameOptions.map',
          kind: 'group',
          label: 'Map',
          description: null,
          children: [
            { id: 'model.option.fogOfWar', kind: 'boolean', label: 'Fog of war', description: null, value: true },
            {
              id: 'model.option.turnsToSail',
              kind: 'integer',
              label: 'Turns to sail',
              description: null,
              value: 3,
              min: 1,
              max: 10,
            },
          ],
        },
      ],
    },
  };

  it('shows the group read-only under its title', () => {
    const { box } = host();
    act(() => box.show('options', options));
    expect(screen.getByRole('heading', { name: 'Game Options' })).toBeTruthy();
    expect(screen.getByText('Map')).toBeTruthy();
    expect((screen.getByLabelText('Turns to sail') as HTMLInputElement).value).toBe('3');
    const controls = [...document.querySelectorAll<HTMLInputElement>('[data-option] input')];
    expect(controls).toHaveLength(2);
    expect(controls.every((c) => c.disabled)).toBe(true);
  });

  it('closes on the button, and the difficulty panel replaces only an open difficulty panel', () => {
    const { box } = host();
    act(() => box.show('options', options));
    fireEvent.click(document.querySelector('[data-answer="close"]')!);
    expect(box.current()).toBeNull();

    act(() => box.show('options', options));
    act(() =>
      box.replace('options', { ...options, kind: 'difficulty', title: 'Difficulty' }, (o) => o.kind === 'difficulty'),
    );
    // The difficulty panel is over the game options panel, which is still there: a panel the Engine
    // shows while another is on screen goes over it.
    expect(box.shown('options').map((o) => o.kind)).toEqual(['difficulty', 'game']);
  });
});
