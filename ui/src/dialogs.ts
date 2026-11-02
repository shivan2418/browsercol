// The Browser UI's dialogs, shown one at a time in the order the WebGUI
// sends them: its questions, which the Engine waits on, and the panels its
// events show, which wait for nothing. A dialog the Engine shows while a
// panel is on screen goes over it, as Swing's panels do: a question asked
// from a panel (the select amount dialog from the colony panel, say) shows
// at once, and so does a panel shown in reply (the explanation a command
// gives when it refuses a drop), each after any already over that panel,
// and the panel again once they are closed. Otherwise dialogs come in the
// order sent. A store, so the React components
// (panels.tsx) draw the open one and the page's keys stay off the map while
// one is open.
import type { GuiEvents, GuiQuestions } from './webgui';

/** The events shown as panels, closed by the player. */
export type PanelKind =
  | 'information'
  | 'error'
  | 'eventPanel'
  | 'indianSettlement'
  | 'tilePanel'
  | 'colopedia'
  | 'messages'
  | 'highScores'
  | 'colony'
  | 'tradeRoutes'
  | 'europe'
  | 'options'
  | 'report';

type Asked = {
  [K in keyof GuiQuestions]: { kind: K; ask: GuiQuestions[K]['ask']; done: (a: GuiQuestions[K]['answer']) => void };
}[keyof GuiQuestions];

type Shown = { [K in PanelKind]: { kind: K; event: GuiEvents[K]; done: () => void } }[PanelKind];

/** An open dialog: done answers or closes it, once; later calls do nothing. */
export type Dialog = (Asked | Shown) & { id: number };

// The store's members are plain functions, not methods: none of them uses
// `this`, so they can be handed on their own, as React's useSyncExternalStore
// does with the store's subscribe and current.
export interface Dialogs {
  /** Ask a question; it goes over the panel on screen, if there is one; resolves to the player's answer. */
  ask: <K extends keyof GuiQuestions>(kind: K, ask: GuiQuestions[K]['ask']) => Promise<GuiQuestions[K]['answer']>;
  /** Show a panel; it goes over the panel on screen, if there is one. */
  show: <K extends PanelKind>(kind: K, event: GuiEvents[K]) => void;
  /**
   * Put a panel in the place of the first of its kind that is queued or open and that `same` says it is
   * (any, by default), as the same panel shown differently; queue it if there is none.
   */
  replace: <K extends PanelKind>(kind: K, event: GuiEvents[K], same?: (open: GuiEvents[K]) => boolean) => void;
  /** The events of the panels of a kind that are queued or open, in order. */
  shown: <K extends PanelKind>(kind: K) => GuiEvents[K][];
  /** The dialog on screen, or null. */
  current: () => Dialog | null;
  /** The panel the dialog on screen is over, which stays on screen under it, or null. */
  under: () => Dialog | null;
  /** Called whenever the dialog on screen changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

export function dialogs(): Dialogs {
  const queue: Dialog[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;
  /** The panels a dialog was put in front of: they were on screen. */
  const covered = new Set<number>();

  const make = (kind: string, payload: unknown, key: 'ask' | 'event', settle: (a: unknown) => void): Dialog => {
    const id = nextId++;
    const done = (a?: unknown) => {
      const i = queue.findIndex((d) => d.id === id);
      if (i < 0) return;
      queue.splice(i, 1);
      covered.delete(id);
      settle(a);
      for (const l of listeners) l();
    };
    return { id, kind, [key]: payload, done } as unknown as Dialog;
  };
  const changed = () => {
    for (const l of listeners) l();
  };
  const add = (kind: string, payload: unknown, key: 'ask' | 'event', settle: (a: unknown) => void) => {
    // The first panel in the queue: the one on screen, or the one the dialogs at the head of the queue are over.
    const panel = queue.findIndex((d) => !('ask' in d));
    // A dialog goes in front of that panel when the panel was on screen: a question asked while it was, as
    // Swing's modal dialogs do, or a panel the Engine shows in reply to the player. Otherwise it waits its turn.
    const over = panel >= 0 && (panel === 0 || covered.has(queue[panel].id));
    if (over) covered.add(queue[panel].id);
    queue.splice(over ? panel : queue.length, 0, make(kind, payload, key, settle));
    changed();
  };

  return {
    ask: (kind, ask) => new Promise((ok) => add(kind, ask, 'ask', ok as (a: unknown) => void)),
    show: (kind, event) => add(kind, event, 'event', () => {}),
    replace: (kind, event, same = () => true) => {
      const i = queue.findIndex((d) => d.kind === kind && same((d as unknown as { event: typeof event }).event));
      // A new dialog id, so that the panel starts afresh rather than keeping what React held.
      if (i < 0) return add(kind, event, 'event', () => {});
      const next = make(kind, event, 'event', () => {});
      if (covered.has(queue[i].id)) {
        covered.delete(queue[i].id);
        covered.add(next.id);
      }
      queue[i] = next;
      changed();
    },
    shown: <K extends PanelKind>(kind: K) =>
      queue.flatMap((d) => (d.kind === kind ? [(d as unknown as { event: GuiEvents[K] }).event] : [])),
    current: () => queue[0] ?? null,
    under: () => {
      // A panel is covered while a dialog is in front of it; it is behind the head of the queue.
      return queue.slice(1).find((d) => covered.has(d.id)) ?? null;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
