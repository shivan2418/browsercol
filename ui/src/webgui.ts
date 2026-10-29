// The Browser UI's end of the WebGUI (engine/.../web/WebGUI.java, whose
// class comment lists which GUI method sends what). The client Engine calls
// fcShow(kind, json) for an event and fcAsk(id, kind, json) for a question;
// a question is answered through the client module's answer(id, value)
// export, with null for a dialog the player closed.

/** Game objects are named by their FreeCol ids, e.g. "unit:12", "tile:345". */
export type Id = string;

/** Events: shown, nothing comes back. */
export interface GuiEvents {
  refresh: Record<string, never>;
  activeUnit: { unit: Id | null; tile: Id | null };
  information: { text: string; object: Id | null };
  error: { text: string };
  eventPanel: { header: string; image: string | null; footer: string | null };
  messages: { messages: { text: string; type: string; source: Id | null }[] };
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
          if (!isKey(handlers.questions, kind)) return null;
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
