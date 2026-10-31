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
  information: { text: string; object: Id | null; ok: string } & TileRef;
  error: { text: string; ok: string };
  eventPanel: { header: string; image: string | null; footer: string | null; ok: string };
  /** Model messages, or with a title the turn report; each names its source's tile, to go to. */
  messages: {
    title: string | null;
    messages: ({ text: string; type: string; source: Id | null } & TileRef)[];
    ok: string;
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
  confirm: {
    ask: {
      text: string;
      ok: string | null;
      cancel: string | null;
      defaultOk: boolean;
      tile: Id | null;
      object: Id | null;
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
  choice: (a) => (a === null ? null : String(a)),
  input: (a) => a,
  goods: (a) => (a === null ? null : JSON.stringify(a)),
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
