// The Browser UI's dialogs, shown one at a time in the order the WebGUI
// sends them: its questions, which the Engine waits on, and the panels its
// events show, which wait for nothing. A store, so the React components
// (panels.tsx) draw the open one and the page's keys stay off the map while
// one is open.
import type { GuiEvents, GuiQuestions } from './webgui';

/** The events shown as panels, closed by the player. */
export type PanelKind = 'information' | 'error' | 'eventPanel' | 'messages' | 'highScores';

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
  /** The dialog on screen, or null. */
  current: () => Dialog | null;
  /** Called whenever the dialog on screen changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

export function dialogs(): Dialogs {
  const queue: Dialog[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;

  const add = (kind: string, payload: unknown, key: 'ask' | 'event', settle: (a: unknown) => void) => {
    const id = nextId++;
    const done = (a?: unknown) => {
      const i = queue.findIndex((d) => d.id === id);
      if (i < 0) return;
      queue.splice(i, 1);
      settle(a);
      for (const l of listeners) l();
    };
    queue.push({ id, kind, [key]: payload, done } as unknown as Dialog);
    for (const l of listeners) l();
  };

  return {
    ask: (kind, ask) => new Promise((ok) => add(kind, ask, 'ask', ok as (a: unknown) => void)),
    show: (kind, event) => add(kind, event, 'event', () => {}),
    current: () => queue[0] ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
