// React components for the WebGUI's dialogs (dialogs.ts): the confirm,
// choice, input, goods, end turn, pre-combat, negotiation and names questions and the information, error, event and message
// panels. All text, button labels included, comes localized from the
// Engine. Keys mean what they do in FreeCol's dialogs: Enter presses the
// focused button, else takes the default option; Escape closes the dialog
// as cancelled; a panel closes on either.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dialog, Dialogs } from './dialogs';
import type { TradeItem, TradeOption } from './webgui';

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
      {ask.header !== null && <h2>{ask.header}</h2>}
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

/** FreeCol's pre-combat dialog: the offence and the defence modifiers side by side, then the results. */
function PreCombat({ d }: { d: Of<'preCombat'> }) {
  const { ask } = d;
  const ok = () => d.done(true);
  const cancel = () => d.done(false);
  // Swing's dialog has no default button; Enter takes the focused one only.
  useKeys(null, cancel);
  const rows = Math.max(ask.offence.length, ask.defence.length);
  const cell = (side: { source: string; value: string }[], i: number) => (
    <>
      <td>{side[i]?.source}</td>
      <td className="value">{side[i]?.value}</td>
    </>
  );
  return (
    <>
      <table className="modifiers">
        <thead>
          <tr>
            <th colSpan={2}>{ask.attacker}</th>
            <th colSpan={2}>{ask.defender}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              {cell(ask.offence, i)}
              {cell(ask.defence, i)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{ask.finalResult}</th>
            <th className="value">{ask.offenceResult}</th>
            <th>{ask.finalResult}</th>
            <th className="value">{ask.defenceResult}</th>
          </tr>
        </tfoot>
      </table>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </>
  );
}

/** FreeCol's end turn dialog: the units still waiting, each a button that makes the unit active. */
function EndTurn({ d }: { d: Of<'endTurn'> }) {
  const { ask } = d;
  const ok = () => d.done({ status: 'ok' });
  const cancel = () => d.done({ status: 'cancel' });
  useKeys(ask.ok !== null ? ok : cancel, cancel);
  return (
    <>
      <h2>{ask.header}</h2>
      <Text text={ask.text} />
      <div className="choices waiting">
        {ask.units.map((u) => (
          <button key={u.id} data-unit={u.id} onClick={() => d.done({ status: 'select', unit: u.id })}>
            {u.name}
            <span className="note"> {u.location}</span>
          </button>
        ))}
      </div>
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

const sameItem = (a: TradeItem, b: TradeItem) => a.kind === b.kind && a.side === b.side && a.key === b.key;

/** One kind of thing that can be added to the trade: gold by amount, else one of the choices. */
function AddItem({
  o,
  items,
  add,
  label,
}: {
  o: TradeOption;
  items: TradeItem[];
  add: (i: TradeItem) => void;
  label: string;
}) {
  const choices = o.choices.filter(
    (c) => !items.some((i) => sameItem(i, { kind: o.kind, side: o.side, key: c.key, amount: 0, text: '' })),
  );
  const [amount, setAmount] = useState('1');
  const [key, setKey] = useState('');
  const chosen = choices.find((c) => c.key === key) ?? choices[0];
  const max = o.max;
  const n = Math.floor(Number(amount));
  const valid = max !== undefined ? n >= 1 && n <= max : chosen !== undefined;
  const submit = () => {
    if (!valid) return;
    if (max !== undefined) {
      add({ kind: o.kind, side: o.side, key: '', amount: n, text: `${o.label} ${n}` });
    } else if (chosen) {
      add({ kind: o.kind, side: o.side, key: chosen.key, amount: chosen.amount, text: chosen.text });
    }
  };
  return (
    <div className="trade-option" data-kind={o.kind} data-side={o.side ?? ''}>
      <span className="text">{o.label}</span>
      {o.note !== null && <span className="note">{o.note}</span>}
      {max !== undefined ? (
        <input type="number" min={1} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} />
      ) : (
        <select value={chosen?.key ?? ''} disabled={choices.length === 0} onChange={(e) => setKey(e.target.value)}>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.text}
            </option>
          ))}
        </select>
      )}
      <button data-add={o.kind} disabled={!valid} onClick={submit}>
        {label}
      </button>
    </div>
  );
}

/** FreeCol's negotiation dialog: the trade so far (a click removes an item), what can be added, and the replies. */
function Negotiation({ d }: { d: Of<'negotiation'> }) {
  const { ask } = d;
  const [items, setItems] = useState(ask.items);
  const [changed, setChanged] = useState(false);
  const edit = (next: TradeItem[]) => {
    setItems(next);
    setChanged(true);
  };
  const add = (item: TradeItem) => {
    const unique = ask.options.some((o) => o.kind === item.kind && o.unique);
    edit([...items.filter((i) => !(unique && i.kind === item.kind)), item]);
  };
  const reply = (status: 'accept' | 'propose' | 'reject') => () => d.done({ status, items });
  // Swing: Enter accepts if it can (a new offer cannot be, nor a changed one), else sends.
  const canAccept = ask.accept !== null && !changed;
  const cancel = ask.cancel !== null ? reply('reject') : () => {};
  useKeys(canAccept ? reply('accept') : reply('propose'), cancel);
  const given = items.filter((i) => i.side === 'offer');
  // A stance is traded by both; Swing lists it with what the other player gives.
  const taken = items.filter((i) => i.side !== 'offer');
  const list = (title: string, shown: TradeItem[]) => (
    <>
      <p className="text">{title}</p>
      {shown.map((i) => (
        <button
          key={`${i.kind}/${i.side}/${i.key}`}
          className="trade-item"
          data-item={i.kind}
          onClick={() => edit(items.filter((x) => x !== i))}
        >
          {i.text}
        </button>
      ))}
    </>
  );
  const group = (side: TradeOption['side'], heading: string | null) => {
    const options = ask.options.filter((o) => o.side === side);
    if (options.length === 0) return null;
    return (
      <div className="trade-options" data-side={side ?? ''}>
        {heading !== null && <h3>{heading}</h3>}
        {options.map((o, i) => (
          <AddItem key={i} o={o} items={items} add={add} label={ask.add} />
        ))}
      </div>
    );
  };
  return (
    <>
      <h2>{ask.title}</h2>
      {ask.text !== null && <Text text={ask.text} />}
      {group('demand', ask.demand)}
      {group('offer', ask.offer)}
      {group(null, null)}
      <div className="trade-summary">
        {given.length > 0 && list(ask.offer, given)}
        {taken.length > 0 && (given.length > 0 ? list(ask.exchange, taken) : list(ask.demand, taken))}
      </div>
      <div className="buttons">
        <button data-answer="send" onClick={reply('propose')}>
          {ask.send}
        </button>
        {ask.accept !== null && (
          <button data-answer="accept" disabled={changed} onClick={reply('accept')}>
            {ask.accept}
          </button>
        )}
        {ask.cancel !== null && (
          <button data-answer="cancel" onClick={reply('reject')}>
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
function TileText({
  text,
  at,
  goTo,
  heading = false,
}: {
  text: string;
  at: At | null;
  goTo: (at: At) => void;
  /** A heading (a source's, in the turn report) rather than a paragraph. */
  heading?: boolean;
}) {
  const Tag = heading ? 'h3' : 'p';
  if (!at) return <Tag className="text">{text}</Tag>;
  return (
    <Tag className="text">
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
    </Tag>
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
    case 'negotiation':
      return <Negotiation d={d} />;
    case 'names':
      return <Names d={d} />;
    case 'endTurn':
      return <EndTurn d={d} />;
    case 'preCombat':
      return <PreCombat d={d} />;
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
    case 'highScores':
      return (
        <Panel d={d} ok={d.event.ok}>
          {d.event.text && <Text text={d.event.text} />}
          {d.event.scores.map((s, i) => (
            <div className="high-score" key={i}>
              <h2>
                {s.score} {s.headline}
              </h2>
              <dl>
                {s.fields.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </Panel>
      );
    case 'messages':
      return (
        <Panel d={d} ok={d.event.ok}>
          {d.event.title && <h2>{d.event.title}</h2>}
          {d.event.messages.map((m, i) => (
            <div key={i} className="message">
              {m.heading && <TileText heading text={m.heading.text} at={m.heading.at} goTo={goTo} />}
              <TileText text={m.text} at={m.at} goTo={goTo} />
            </div>
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
