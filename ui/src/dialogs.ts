// The Browser UI's dialogs, shown one at a time in the order the WebGUI
// sends them: its questions, which the Engine waits on, and the panels its
// events show, which wait for nothing. A store, so the React components
// (panels.tsx) draw the open one and the page's keys stay off the map while
// one is open.
import type { GuiEvents, GuiQuestions } from './webgui';

/** The events shown as panels, closed by the player. */
export type PanelKind =
  | 'information'
  | 'error'
  | 'eventPanel'
  | 'indianSettlement'
  | 'messages'
  | 'highScores'
  | 'colony'
  | 'tradeRoutes'
  | 'europe';

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
  /** Queue a question; resolves to the player's answer. */
  ask: <K extends keyof GuiQuestions>(kind: K, ask: GuiQuestions[K]['ask']) => Promise<GuiQuestions[K]['answer']>;
  /** Queue a panel. */
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
  /** Called whenever the dialog on screen changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

export function dialogs(): Dialogs {
  const queue: Dialog[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;

  const make = (kind: string, payload: unknown, key: 'ask' | 'event', settle: (a: unknown) => void): Dialog => {
    const id = nextId++;
    const done = (a?: unknown) => {
      const i = queue.findIndex((d) => d.id === id);
      if (i < 0) return;
      queue.splice(i, 1);
      settle(a);
      for (const l of listeners) l();
    };
    return { id, kind, [key]: payload, done } as unknown as Dialog;
  };
  const changed = () => {
    for (const l of listeners) l();
  };
  const add = (kind: string, payload: unknown, key: 'ask' | 'event', settle: (a: unknown) => void) => {
    queue.push(make(kind, payload, key, settle));
    changed();
  };

  return {
    ask: (kind, ask) => new Promise((ok) => add(kind, ask, 'ask', ok as (a: unknown) => void)),
    show: (kind, event) => add(kind, event, 'event', () => {}),
    replace: (kind, event, same = () => true) => {
      const i = queue.findIndex((d) => d.kind === kind && same((d as unknown as { event: typeof event }).event));
      // A new dialog id, so that the panel starts afresh rather than keeping what React held.
      if (i < 0) return add(kind, event, 'event', () => {});
      queue[i] = make(kind, event, 'event', () => {});
      changed();
    },
    shown: <K extends PanelKind>(kind: K) =>
      queue.flatMap((d) => (d.kind === kind ? [(d as unknown as { event: GuiEvents[K] }).event] : [])),
    current: () => queue[0] ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
