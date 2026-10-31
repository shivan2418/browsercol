// React components for the WebGUI's dialogs (dialogs.ts): the confirm,
// choice, input, goods and names questions and the information, error, event and message
// panels. All text, button labels included, comes localized from the
// Engine. Keys mean what they do in FreeCol's dialogs: Enter presses the
// focused button, else takes the default option; Escape closes the dialog
// as cancelled; a panel closes on either.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dialog, Dialogs } from './dialogs';

type At = [number, number];

/**
 * Answer Enter and Escape while the dialog is open, before anything else
 * on the page sees them. A key with no action is still kept from the page.
 * Enter on a button of the dialog is left to the button, as in Swing.
 */
function useKeys(enter: (() => void) | null, escape: () => void) {
  const keys = useRef({ enter, escape });
  keys.current = { enter, escape };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (e.key === 'Enter' && target?.matches('[role=dialog] button')) return;
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

/** The ok and cancel buttons of a question, each only if it has a label. */
function OkCancel(p: { ok: string | null; cancel: string | null; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="buttons">
      {p.ok !== null && (
        <button data-answer="ok" onClick={p.onOk}>
          {p.ok}
        </button>
      )}
      {p.cancel !== null && (
        <button data-answer="cancel" onClick={p.onCancel}>
          {p.cancel}
        </button>
      )}
    </div>
  );
}

function Confirm({ d }: { d: Of<'confirm'> }) {
  const { ask } = d;
  const ok = () => d.done(true);
  const cancel = () => d.done(false);
  useKeys(ask.defaultOk && ask.ok !== null ? ok : cancel, cancel);
  return (
    <>
      <Text text={ask.text} />
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </>
  );
}

function Choice({ d }: { d: Of<'choice'> }) {
  const { ask } = d;
  const pick = (i: number) => () => d.done(i);
  const byDefault = ask.choices.findIndex((c) => c.default && c.enabled);
  const cancelItem = ask.choices.findIndex((c) => c.cancel && c.enabled);
  // Swing: Escape closes with the cancel item, else null; Enter takes the
  // default item, else the cancel button if there is one.
  const cancel = cancelItem >= 0 ? pick(cancelItem) : () => d.done(null);
  useKeys(byDefault >= 0 ? pick(byDefault) : ask.cancel !== null ? cancel : null, cancel);
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
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </>
  );
}

function Names({ d }: { d: Of<'names'> }) {
  const { ask } = d;
  const [values, setValues] = useState(ask.fields.map((f) => f.value));
  const ok = () => d.done(values);
  const cancel = () => d.done(null);
  useKeys(ok, cancel);
  return (
    <>
      <Text text={ask.text} />
      {ask.fields.map((f, i) => (
        <label key={i} className="field">
          <span className="text">{f.label}</span>
          <input
            autoFocus={i === 0}
            value={values[i]}
            onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))}
          />
        </label>
      ))}
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </>
  );
}

function Goods({ d }: { d: Of<'goods'> }) {
  const { ask } = d;
  const [picked, setPicked] = useState<number[]>(() =>
    ask.goods.flatMap((g, i) => (g.checked ? [i] : [])).slice(0, ask.max),
  );
  const full = picked.length >= ask.max;
  const toggle = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ask.max ? [...p, i] : p));
  const ok = () => d.done([...picked].sort((a, b) => a - b));
  const cancel = () => d.done(null);
  useKeys(ok, cancel);
  return (
    <>
      <Text text={ask.text} />
      <div className="lots">
        {ask.goods.map((g, i) => (
          <label key={i} data-icon={g.icon}>
            <input
              type="checkbox"
              checked={picked.includes(i)}
              disabled={full && !picked.includes(i)}
              onChange={() => toggle(i)}
            />
            <span className="name">{g.name}</span>
            <span className="amount">{g.amount}</span>
          </label>
        ))}
      </div>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
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
function TileText({ text, at, goTo }: { text: string; at: At | null; goTo: (at: At) => void }) {
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
    case 'goods':
      return <Goods d={d} />;
    case 'names':
      return <Names d={d} />;
    case 'information':
      return (
        <Panel d={d} ok={d.event.ok}>
          <TileText text={d.event.text} at={d.event.at} goTo={goTo} />
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
            <TileText key={i} text={m.text} at={m.at} goTo={goTo} />
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
