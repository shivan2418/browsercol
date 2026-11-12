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
  event: { header: 'Landfall', image: 'image.flavor.event.firstLanding', footer: null, ok: 'OK' },
  choice: {
    text: 'Pick',
    cancel: 'Cancel',
    tile: null,
    object: null,
    choices: [{ text: 'A', enabled: true, ok: false, cancel: false, default: true }],
  },
  input: { text: 'Name?', value: 'Jamestown', ok: 'OK', cancel: 'Cancel', tile: null },
  amount: {
    text: 'Select the amount',
    type: 'model.goods.cloth',
    name: 'Cloth',
    keys: ['image.icon.model.goods.cloth'],
    values: [20, 40, 45],
    value: 40,
    max: 45,
    ok: 'OK',
    cancel: 'Cancel',
  },
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
    context: 'diplomatic',
    version: 0,
    tutorial: null,
    nation: 'France',
    other: 'Spain',
    stance: { key: 'WAR', name: 'War' },
    gold: { ours: 100, theirs: null },
    cancellable: true,
    items: [
      { kind: 'gold', side: 'offer', key: '', amount: 30, text: 'Gold 30' },
      { kind: 'stance', side: null, key: 'PEACE', amount: 0, text: 'Peace' },
    ],
    options: [],
  },
  endTurn: {
    header: 'End turn',
    text: 'One unit is waiting.',
    ok: 'OK',
    cancel: 'Cancel',
    units: [{ id: 'unit:2', name: 'Soldier', location: 'Jamestown' }],
  },
  preCombat: {
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
    tile: 'tile:3',
    object: 'unit:9',
  },
  warehouse: {
    title: 'Warehouse',
    ok: 'OK',
    cancel: 'Cancel',
    export: 'Export',
    canExport: true,
    labels: { goods: 'Goods', low: 'Low', high: 'High', import: 'Import' },
    tips: {
      low: 'Low level tip',
      high: 'High level tip',
      import: 'Import level tip',
      export: 'Export above',
      exported: 'Whether',
    },
    goods: [
      {
        type: 'model.goods.food',
        name: 'Food',
        keys: [],
        amount: 5,
        exported: true,
        low: 10,
        high: 90,
        import: null,
        export: 50,
        max: 100,
      },
    ],
  },
  names: {
    title: 'Declare Independence',
    text: 'Declare?',
    fields: [
      { label: 'Nation', value: 'Free Dutch' },
      { label: 'Country', value: 'United Dutch' },
    ],
    ok: 'Liberty',
    cancel: 'Later',
  },
  father: {
    title: 'Nominate Founding Father',
    ok: 'OK',
    fathers: [
      {
        id: 'model.foundingFather.adamSmith',
        kind: 'Trade',
        name: 'Adam Smith',
        description: 'Enables building of factories.',
        born: '1723-1790',
        text: 'Father of Modern Economics.',
        keys: ['image.flavor.model.foundingFather.adamSmith'],
      },
    ],
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
          event: (q) => (asked.push(q), true),
          confirm: (q) => (asked.push(q), true),
          declaration: (q) => (asked.push(q), true),
          choice: async (q) => (asked.push(q), 0),
          input: (q) => (asked.push(q), null),
          goods: (q) => (asked.push(q), [1, 0]),
          negotiation: (q) => (asked.push(q), { status: 'propose', items: [q.items[0]] }),
          names: (q) => (asked.push(q), [q.fields[0].value, 'Newland']),
          warehouse: (q) => (asked.push(q), [{ ...q.goods[0], import: null, export: 60 }]),
          endTurn: (q) => (asked.push(q), { status: 'ok' }),
          preCombat: (q) => (asked.push(q), false),
          amount: (q) => (asked.push(q), 35),
          father: (q) => (asked.push(q), 0),
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
      [7, 'endTurn'],
      [8, 'preCombat'],
      [9, 'event'],
      [10, 'amount'],
      [11, 'warehouse'],
      [12, 'father'],
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
      question.endTurn,
      question.preCombat,
      question.event,
      question.amount,
      question.warehouse,
      question.father,
    ]);
    expect(a.got).toEqual([
      [1, 'true'],
      [2, '0'],
      [3, null],
      [4, '[1,0]'],
      [5, 'propose\ngold\toffer\t\t30'],
      [6, 'Free Dutch\nNewland'],
      [7, 'ok'],
      [8, 'false'],
      [9, 'closed'],
      [10, '35'],
      [11, 'model.goods.food\ttrue\t10\t90\t-1\t60'],
      [12, '0'],
    ]);
  });

  it('answers an unknown or failing question as a closed dialog, reporting an unknown one', async () => {
    const a = answers();
    const unasked: string[] = [];
    const handlers: GuiHandlers = {
      events: { unasked: (e) => unasked.push(e.method) },
      questions: {
        event: () => true,
        declaration: () => true,
        confirm: () => {
          throw new Error('no dialog');
        },
        choice: () => null,
        input: () => null,
        goods: () => null,
        negotiation: () => null,
        names: () => null,
        father: () => null,
        warehouse: () => null,
        endTurn: () => null,
        preCombat: () => false,
        amount: () => null,
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
          event: () => true,
          declaration: () => true,
          confirm: () => false,
          choice: () => null,
          input: () => null,
          goods: () => null,
          negotiation: () => null,
          names: () => null,
          father: () => null,
          warehouse: () => null,
          endTurn: () => null,
          preCombat: () => false,
          amount: () => null,
        },
      },
      () => {},
    );

    gui.fcShow('activeUnit', '{"unit":"unit:5","tile":"tile:9"}');
    gui.fcShow('refresh', '{}');

    expect(seen).toEqual(['unit:5']);
  });
});
