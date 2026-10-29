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
  confirm: { text: 'Disband?', ok: 'Yes', cancel: 'No', defaultOk: true, tile: 'tile:1', object: 'unit:2' },
  choice: {
    text: 'Pick',
    cancel: 'Cancel',
    tile: null,
    object: null,
    choices: [{ text: 'A', enabled: true, ok: false, cancel: false, default: true }],
  },
  input: { text: 'Name?', value: 'Jamestown', ok: 'OK', cancel: 'Cancel', tile: null },
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
        },
      },
      a.answer,
    );

    for (const [id, kind] of [
      [1, 'confirm'],
      [2, 'choice'],
      [3, 'input'],
    ] as const) {
      const arrived = a.next();
      gui.fcAsk(id, kind, JSON.stringify(question[kind]));
      expect(a.got.length, 'never answers inside the Engine call').toBe(id - 1);
      await arrived;
    }

    expect(asked).toEqual([question.confirm, question.choice, question.input]);
    expect(a.got).toEqual([
      [1, 'true'],
      [2, '0'],
      [3, null],
    ]);
  });

  it('answers an unknown or failing question as a closed dialog', async () => {
    const a = answers();
    const handlers: GuiHandlers = {
      events: {},
      questions: {
        confirm: () => {
          throw new Error('no dialog');
        },
        choice: () => null,
        input: () => null,
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
  });

  it('routes events to their handlers and drops the rest', () => {
    const seen: unknown[] = [];
    const gui = webGui(
      {
        events: { activeUnit: (e) => seen.push(e.unit) },
        questions: { confirm: () => false, choice: () => null, input: () => null },
      },
      () => {},
    );

    gui.fcShow('activeUnit', '{"unit":"unit:5","tile":"tile:9"}');
    gui.fcShow('refresh', '{}');

    expect(seen).toEqual(['unit:5']);
  });
});
