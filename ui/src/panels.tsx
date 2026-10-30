// React components for the WebGUI's dialogs (dialogs.ts): the confirm,
// choice and input questions and the information, error, event and message
// panels. All text, button labels included, comes localized from the
// Engine. Keys mean what they do in FreeCol's dialogs: Enter takes the
// default option, Escape cancels; a panel closes on either.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dialog, Dialogs } from './dialogs';

type At = [number, number];

/**
 * Answer Enter and Escape while the dialog is open, before anything else
 * on the page sees them. A key with no action is still kept from the page.
 */
function useKeys(enter: (() => void) | null, escape: (() => void) | null) {
  const keys = useRef({ enter, escape });
  keys.current = { enter, escape };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = e.key === 'Enter' ? keys.current.enter : e.key === 'Escape' ? keys.current.escape : undefined;
      if (act === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      act?.();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);
}

/** FreeCol's text, its line breaks kept. */
const Text = ({ text }: { text: string }) => <p className="text">{text}</p>;

type Of<K extends Dialog['kind']> = Extract<Dialog, { kind: K }>;

function Confirm({ d }: { d: Of<'confirm'> }) {
  const { ask } = d;
  const ok = () => d.done(true);
  const cancel = () => d.done(false);
  useKeys(ask.defaultOk && ask.ok !== null ? ok : cancel, cancel);
  return (
    <>
      <Text text={ask.text} />
      <div className="buttons">
        {ask.ok !== null && (
          <button data-answer="ok" onClick={ok}>
            {ask.ok}
          </button>
        )}
        {ask.cancel !== null && (
          <button data-answer="cancel" onClick={cancel}>
            {ask.cancel}
          </button>
        )}
      </div>
    </>
  );
}

function Choice({ d }: { d: Of<'choice'> }) {
  const { ask } = d;
  const pick = (i: number) => () => d.done(i);
  const byDefault = ask.choices.findIndex((c) => c.default && c.enabled);
  const cancelItem = ask.choices.findIndex((c) => c.cancel && c.enabled);
  useKeys(
    byDefault >= 0 ? pick(byDefault) : null,
    cancelItem >= 0 ? pick(cancelItem) : ask.cancel !== null ? () => d.done(null) : null,
  );
  return (
    <>
      <Text text={ask.text} />
      <div className="choices">
        {ask.choices.map((c, i) => (
          <button
            key={i}
            data-choice={i}
            disabled={!c.enabled}
            className={c.default ? 'default' : ''}
            onClick={pick(i)}
          >
            {c.text}
          </button>
        ))}
      </div>
      {ask.cancel !== null && (
        <div className="buttons">
          <button data-answer="cancel" onClick={() => d.done(null)}>
            {ask.cancel}
          </button>
        </div>
      )}
    </>
  );
}

function Input({ d }: { d: Of<'input'> }) {
  const { ask } = d;
  const [value, setValue] = useState(ask.value ?? '');
  const ok = () => d.done(value);
  const cancel = () => d.done(null);
  useKeys(ok, cancel);
  return (
    <>
      <Text text={ask.text} />
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="buttons">
        {ask.ok !== null && (
          <button data-answer="ok" onClick={ok}>
            {ask.ok}
          </button>
        )}
        {ask.cancel !== null && (
          <button data-answer="cancel" onClick={cancel}>
            {ask.cancel}
          </button>
        )}
      </div>
    </>
  );
}

/** A panel's body, then its close button. */
function Panel({ d, children, ok }: { d: Dialog; children: ReactNode; ok: string }) {
  const close = () => (d.done as () => void)();
  useKeys(close, close);
  return (
    <>
      {children}
      <div className="buttons">
        <button data-answer="close" onClick={close}>
          {ok}
        </button>
      </div>
    </>
  );
}

/** Text that, if it is about a tile, goes there when clicked, as FreeCol's InformationPanel shows its objects. */
function About({ text, at, goTo }: { text: string; at: At | null; goTo: (at: At) => void }) {
  if (!at) return <Text text={text} />;
  return (
    <p className="text">
      <a
        href="#"
        data-at={at.join(',')}
        onClick={(e) => {
          e.preventDefault();
          goTo(at);
        }}
      >
        {text}
      </a>
    </p>
  );
}

function Body({ d, goTo }: { d: Dialog; goTo: (at: At) => void }) {
  switch (d.kind) {
    case 'confirm':
      return <Confirm d={d} />;
    case 'choice':
      return <Choice d={d} />;
    case 'input':
      return <Input d={d} />;
    case 'information':
      return (
        <Panel d={d} ok={d.event.ok}>
          <About text={d.event.text} at={d.event.at} goTo={goTo} />
        </Panel>
      );
    case 'error':
      return (
        <Panel d={d} ok={d.event.ok}>
          <Text text={d.event.text} />
        </Panel>
      );
    case 'eventPanel':
      return (
        <Panel d={d} ok={d.event.ok}>
          <h2>{d.event.header}</h2>
          {d.event.footer && <Text text={d.event.footer} />}
        </Panel>
      );
    case 'messages':
      return (
        <Panel d={d} ok={d.event.ok}>
          {d.event.title && <h2>{d.event.title}</h2>}
          {d.event.messages.map((m, i) => (
            <About key={i} text={m.text} at={m.at} goTo={goTo} />
          ))}
        </Panel>
      );
  }
}

/** The open dialog, over the page, or nothing. goTo centres the map on a tile. */
export function DialogHost({ dialogs, goTo }: { dialogs: Dialogs; goTo: (at: At) => void }) {
  const d = useSyncExternalStore(dialogs.subscribe, dialogs.current);
  if (!d) return null;
  return (
    <div className="modal">
      <div className="dialog" role="dialog" aria-modal="true" data-kind={d.kind} key={d.id}>
        <Body d={d} goTo={goTo} />
      </div>
    </div>
  );
}
