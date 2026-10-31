import { describe, expect, it } from 'vite-plus/test';
import { webGui, type GuiHandlers } from './webgui';

function answers() {
  const got: [number, string | null][] = [];
  let arrived: () => void = () => {};
  return {
    got,
    next: () => new Promise<void>((ok) => (arrived = ok)),
    answer: (id: number, value: string | null) => {
      got.push([id, value]);
      arrived();
    },
  };
}

const question = {
  confirm: {
    text: 'Disband?',
    ok: 'Yes',
    cancel: 'No',
    defaultOk: true,
    tile: 'tile:1',
    object: 'unit:2',
    header: null,
  },
  choice: {
    text: 'Pick',
    cancel: 'Cancel',
    tile: null,
    object: null,
    choices: [{ text: 'A', enabled: true, ok: false, cancel: false, default: true }],
  },
  input: { text: 'Name?', value: 'Jamestown', ok: 'OK', cancel: 'Cancel', tile: null },
  goods: {
    text: 'Loot Cargo',
    ok: 'OK',
    cancel: 'Cancel',
    max: 2,
    object: 'unit:2',
    goods: [
      {
        id: 'model.goods.rum',
        type: 'model.goods.rum',
        name: 'Rum',
        amount: 40,
        icon: 'image.icon.model.goods.rum',
        label: '40 Rum',
        checked: false,
      },
    ],
  },
  negotiation: {
    title: 'Diplomatic Negotiation',
    text: 'Let us talk.',
    demand: 'France requires of Spain',
    offer: 'France offers Spain',
    exchange: 'in return for',
    version: 0,
    add: 'Add',
    send: 'Send',
    accept: null,
    cancel: 'Cancel',
    items: [
      { kind: 'gold', side: 'offer', key: '', amount: 30, text: 'Gold 30' },
      { kind: 'stance', side: null, key: 'PEACE', amount: 0, text: 'Peace' },
    ],
    options: [],
  },
  names: {
    text: 'Declare?',
    fields: [
      { label: 'Nation', value: 'Free Dutch' },
      { label: 'Country', value: 'United Dutch' },
    ],
    ok: 'Liberty',
    cancel: 'Later',
  },
};

describe('webGui', () => {
  it('hands each question to its handler and encodes the answer for Java', async () => {
    const a = answers();
    const asked: unknown[] = [];
    const gui = webGui(
      {
        events: {},
        questions: {
          confirm: (q) => (asked.push(q), true),
          choice: async (q) => (asked.push(q), 0),
          input: (q) => (asked.push(q), null),
          goods: (q) => (asked.push(q), [1, 0]),
          negotiation: (q) => (asked.push(q), { status: 'propose', items: [q.items[0]] }),
          names: (q) => (asked.push(q), [q.fields[0].value, 'Newland']),
        },
      },
      a.answer,
    );

    for (const [id, kind] of [
      [1, 'confirm'],
      [2, 'choice'],
      [3, 'input'],
      [4, 'goods'],
      [5, 'negotiation'],
      [6, 'names'],
    ] as const) {
      const arrived = a.next();
      gui.fcAsk(id, kind, JSON.stringify(question[kind]));
      expect(a.got.length, 'never answers inside the Engine call').toBe(id - 1);
      await arrived;
    }

    expect(asked).toEqual([
      question.confirm,
      question.choice,
      question.input,
      question.goods,
      question.negotiation,
      question.names,
    ]);
    expect(a.got).toEqual([
      [1, 'true'],
      [2, '0'],
      [3, null],
      [4, '[1,0]'],
      [5, 'propose\ngold\toffer\t\t30'],
      [6, 'Free Dutch\nNewland'],
    ]);
  });

  it('answers an unknown or failing question as a closed dialog, reporting an unknown one', async () => {
    const a = answers();
    const unasked: string[] = [];
    const handlers: GuiHandlers = {
      events: { unasked: (e) => unasked.push(e.method) },
      questions: {
        confirm: () => {
          throw new Error('no dialog');
        },
        choice: () => null,
        input: () => null,
        goods: () => null,
        negotiation: () => null,
        names: () => null,
      },
    };
    const gui = webGui(handlers, a.answer);
    const quiet = console.error;
    console.error = () => {};
    try {
      let arrived = a.next();
      gui.fcAsk(1, 'monarch', '{}');
      await arrived;
      arrived = a.next();
      gui.fcAsk(2, 'confirm', JSON.stringify(question.confirm));
      await arrived;
    } finally {
      console.error = quiet;
    }

    expect(a.got).toEqual([
      [1, null],
      [2, null],
    ]);
    expect(unasked).toEqual(['ask monarch']);
  });

  it('routes events to their handlers and drops the rest', () => {
    const seen: unknown[] = [];
    const gui = webGui(
      {
        events: { activeUnit: (e) => seen.push(e.unit) },
        questions: {
          confirm: () => false,
          choice: () => null,
          input: () => null,
          goods: () => null,
          negotiation: () => null,
          names: () => null,
        },
      },
      () => {},
    );

    gui.fcShow('activeUnit', '{"unit":"unit:5","tile":"tile:9"}');
    gui.fcShow('refresh', '{}');

    expect(seen).toEqual(['unit:5']);
  });
});
