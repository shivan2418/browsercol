// The Browser UI's end of the WebGUI (engine/.../web/WebGUI.java, whose
// class comment lists which GUI method sends what). The client Engine calls
// fcShow(kind, json) for an event and fcAsk(id, kind, json) for a question;
// a question is answered through the client module's answer(id, value)
// export, with null for a dialog the player closed.

/** Game objects are named by their FreeCol ids, e.g. "unit:12", "tile:345". */
export type Id = string;

/** A tile, by id and by its [x, y] on the map. */
export interface TileRef {
  tile: Id | null;
  at: [number, number] | null;
}

/** Events: shown, nothing comes back. */
export interface GuiEvents {
  refresh: Record<string, never>;
  /** force: after a move, SwingGUI keeps the selection and refocuses only if the unit is out of view. */
  activeUnit: { unit: Id | null; force: boolean; orders: string[] } & TileRef;
  /** Terrain mode: a tile is selected; the active unit is kept. */
  selectedTile: TileRef;
  /** Centre the map on a tile. */
  focus: TileRef;
  /** ok: the close button's label, as for the other panels. The tile is the object's, if it has one. */
  information: { text: string; object: Id | null; images: string[]; ok: string } & TileRef;
  error: { text: string; ok: string };
  eventPanel: { header: string; image: string | null; footer: string | null; ok: string };
  /**
   * The high scores at the game's end, text as FreeCol's header (or null). Closing the panel does
   * nothing more: there is no start screen yet, so the player keeps playing (victory) or reloads the page.
   */
  highScores: {
    text: string | null;
    scores: { score: number; headline: string; fields: { label: string; value: string }[] }[];
    ok: string;
  };
  /**
   * Model messages, or with a title the turn report; each names its source's tile, to go to. The turn
   * report is arranged by the group by option: a message with a heading starts its group. Each message has
   * the resource keys of its display object's image, best first, none if it has no image. The report's
   * messages also have the buttons of Swing's report: filter is whether the type's messages are shown
   * (null: it has no filter), filterTip and ignoreTip the buttons' tooltips (null: no such button).
   */
  messages: {
    title: string | null;
    messages: ({
      text: string;
      type: string;
      source: Id | null;
      heading: ({ text: string } & TileRef) | null;
      images: string[];
      filter: boolean | null;
      filterTip: string | null;
      /** Whether the ignore button has been pressed. */
      ignored: boolean;
      ignoreTip: string | null;
    } & TileRef)[];
    ok: string;
    /** The turn report's group by option; absent for model messages. */
    groupBy?: { label: string; value: number; choices: { value: number; text: string }[] };
    /** The report again, as it was regrouped: it replaces the open one. */
    regrouped?: boolean;
  };
  /** A dialog the Browser UI cannot show yet; the controller got FreeCol's base default. */
  unasked: { method: string };
}

export interface Choice {
  text: string;
  enabled: boolean;
  ok: boolean;
  cancel: boolean;
  default: boolean;
}

/** Questions: what is asked, and what the player answers (null: closed). */
export interface GuiQuestions {
  /**
   * An event panel the Engine waits on: the first landing's, whose closing adds the build colony tutorial.
   * It looks as the eventPanel event does; closing it answers.
   */
  event: {
    ask: { header: string; image: string | null; footer: string | null; ok: string };
    answer: true;
  };
  confirm: {
    ask: {
      text: string;
      ok: string | null;
      cancel: string | null;
      defaultOk: boolean;
      tile: Id | null;
      object: Id | null;
      /** The title Swing's dialog shows above its text, if it has one. */
      header: string | null;
    };
    answer: boolean;
  };
  choice: {
    ask: { text: string; cancel: string | null; tile: Id | null; object: Id | null; choices: Choice[] };
    /** The index of the chosen item. */
    answer: number | null;
  };
  input: {
    ask: { text: string; value: string | null; ok: string | null; cancel: string | null; tile: Id | null };
    answer: string | null;
  };
  /**
   * The end turn dialog: the units still waiting, any of which can be picked to be made the active unit
   * (the dialog closes and the turn goes on). Answers ok to end the turn, cancel to keep it.
   */
  endTurn: {
    ask: {
      header: string;
      text: string;
      ok: string | null;
      cancel: string | null;
      units: { id: Id; name: string; location: string }[];
    };
    answer: { status: 'ok' | 'cancel' } | { status: 'select'; unit: Id } | null;
  };
  /**
   * The dialog before an attack: both sides' modifiers, side by side in FreeCol's order, and the final
   * results. Answers true to attack.
   */
  preCombat: {
    ask: {
      attacker: string;
      defender: string;
      offence: { source: string; value: string }[];
      defence: { source: string; value: string }[];
      /** The label of the results. */
      finalResult: string;
      offenceResult: string;
      defenceResult: string;
      ok: string | null;
      cancel: string | null;
      tile: Id | null;
      object: Id | null;
    };
    answer: boolean;
  };
  /** Pick goods to capture or dump; at most `max` lots. */
  goods: {
    ask: {
      text: string;
      ok: string | null;
      cancel: string | null;
      max: number;
      object: Id | null;
      goods: Lot[];
    };
    /** The indexes of the lots chosen, null for a closed dialog. */
    answer: number[] | null;
  };
  /**
   * A trade, as FreeCol's negotiation dialog: the agreement's items, and what can be added to it. Answers
   * with the status and, to propose, the items the agreement should have.
   */
  negotiation: {
    ask: {
      title: string;
      text: string | null;
      /** The headings of what the other player gives and what we give, and the one between them. */
      demand: string;
      offer: string;
      exchange: string;
      version: number;
      add: string;
      send: string;
      /** Null: this offer cannot be accepted, or cancelled. */
      accept: string | null;
      cancel: string | null;
      items: TradeItem[];
      options: TradeOption[];
    };
    answer: { status: 'accept' | 'propose' | 'reject'; items: TradeItem[] } | null;
  };
  /** Text fields, each with its label and a suggestion (the new nation's names). */
  names: {
    ask: { text: string; fields: { label: string; value: string }[]; ok: string | null; cancel: string | null };
    /** The fields' values, in order; null when cancelled or closed. */
    answer: string[] | null;
  };
}

export type TradeKind = 'gold' | 'stance' | 'colony' | 'goods' | 'incite' | 'unit';

/** One thing traded. We give an "offer"; the other player gives a "demand"; a stance has no side. */
export interface TradeItem {
  kind: TradeKind;
  side: 'offer' | 'demand' | null;
  /** What names the thing: a stance, an id, a goods type; empty for gold. */
  key: string;
  amount: number;
  text: string;
}

/** What can be added: gold up to max, else one of the choices. A unique kind has one item at most. */
export interface TradeOption {
  kind: TradeKind;
  side: 'offer' | 'demand' | null;
  label: string;
  note: string | null;
  unique: boolean;
  max?: number;
  choices: { key: string; amount: number; text: string }[];
}

export interface Lot {
  id: string;
  type: string;
  name: string;
  amount: number;
  /** The goods type's resource key, so a Tileset can replace the picture. */
  icon: string;
  label: string;
  /** Checked when the dialog opens. */
  checked: boolean;
}

export interface GuiHandlers {
  /** Events without a handler are dropped. */
  events: { [K in keyof GuiEvents]?: (event: GuiEvents[K]) => void };
  /** Every question needs a handler: the Engine waits for its answer. */
  questions: {
    [K in keyof GuiQuestions]: (
      ask: GuiQuestions[K]['ask'],
    ) => GuiQuestions[K]['answer'] | Promise<GuiQuestions[K]['answer']>;
  };
}

/** How each kind of answer crosses to Java, as a string or null. */
const encode: { [K in keyof GuiQuestions]: (answer: GuiQuestions[K]['answer']) => string | null } = {
  confirm: (a) => String(a),
  event: () => 'closed',
  preCombat: (a) => String(a),
  choice: (a) => (a === null ? null : String(a)),
  input: (a) => a,
  goods: (a) => (a === null ? null : JSON.stringify(a)),
  // Java splits the answer at the line break, after the word.
  endTurn: (a) => (a === null ? null : a.status === 'select' ? `select\n${a.unit}` : a.status),
  // A status line, then a line for each item, its fields separated by tabs (no field has one).
  negotiation: (a) =>
    a === null
      ? null
      : [
          a.status,
          ...(a.status === 'propose' ? a.items.map((i) => [i.kind, i.side ?? '', i.key, i.amount].join('\t')) : []),
        ].join('\n'),
  // Java splits the answer at the line break, which a text field never holds.
  names: (a) => (a === null ? null : a.join('\n')),
};

const isKey = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

/**
 * The fcShow and fcAsk globals for the client Engine, routing to typed
 * handlers. `answer` is the client module's export.
 */
export function webGui(handlers: GuiHandlers, answer: (id: number, value: string | null) => void) {
  return {
    fcShow(kind: string, json: string): void {
      if (!isKey(handlers.events, kind)) return;
      const handle = handlers.events[kind] as (e: unknown) => void;
      handle(JSON.parse(json));
    },
    fcAsk(id: number, kind: string, json: string): void {
      // Answer in a later microtask, never inside the Engine's call.
      void Promise.resolve()
        .then(async () => {
          if (!isKey(handlers.questions, kind)) {
            handlers.events.unasked?.({ method: `ask ${kind}` });
            return null;
          }
          const handle = handlers.questions[kind] as (q: unknown) => unknown;
          const encodeAnswer = encode[kind] as (a: unknown) => string | null;
          return encodeAnswer(await handle(JSON.parse(json)));
        })
        .catch((ex: unknown) => {
          console.error(`WebGUI question ${kind} failed; answering as closed`, ex);
          return null;
        })
        .then((value) => answer(id, value));
    },
  };
}
