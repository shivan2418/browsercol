// React components for the WebGUI's dialogs (dialogs.ts): the confirm,
// choice, input, goods, end turn, pre-combat, negotiation and names questions and the information, error, event, message
// and colony (colony-panel.tsx) panels, each in a window frame (frame.tsx). All text, button labels included,
// comes localized from the
// Engine. Keys mean what they do in FreeCol's dialogs: Enter presses the
// focused button, else takes the default option; Escape, or the frame's
// close button, closes the dialog as cancelled; a panel closes on either key.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ColonyPanel } from './colony-panel';
import type { Dialog, Dialogs } from './dialogs';
import { GoodsAmount, WindowFrame, type Art } from './frame';
import type { GuiEvents, TradeItem, TradeOption } from './webgui';

export type { Art };

type At = [number, number];

/** What the turn report's buttons do (ClientExports.reportGroupBy and the others). */
export interface ReportButtons {
  groupBy: (value: number) => void;
  filter: (index: number, shown: boolean) => void;
  ignore: (index: number, ignore: boolean) => void;
}

/** An image of a game object or event, if the Tileset has one. */
function Pic({ keys, art, className = 'pic' }: { keys: readonly string[]; art: Art; className?: string }) {
  const src = art(keys);
  return src === null ? null : <img className={className} src={src} alt="" />;
}

/**
 * Answer Enter while the dialog is open, before anything else on the page
 * sees it; with no action it is still kept from the page. Enter on a button
 * of the dialog is left to the button, as in Swing. Escape is the frame's.
 */
function useEnter(enter: (() => void) | null) {
  const act = useRef(enter);
  act.current = enter;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (e.key !== 'Enter' || target?.matches('[role=dialog] button')) return;
      e.preventDefault();
      e.stopPropagation();
      act.current?.();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);
}

/** The dialog's window: its title, if it has one, and what closing it (Escape, the close button) answers. */
function Win({
  d,
  title = null,
  close,
  children,
}: {
  d: Dialog;
  title?: string | null;
  close: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <WindowFrame className="dialog" aria-modal="true" data-kind={d.kind} title={title} close={close}>
      {children}
    </WindowFrame>
  );
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
  useEnter(ask.defaultOk && ask.ok !== null ? ok : cancel);
  return (
    <Win d={d} title={ask.header} close={cancel}>
      <Text text={ask.text} />
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </Win>
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
  useEnter(byDefault >= 0 ? pick(byDefault) : ask.cancel !== null ? cancel : null);
  return (
    <Win d={d} close={cancel}>
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
    </Win>
  );
}

function Input({ d }: { d: Of<'input'> }) {
  const { ask } = d;
  const [value, setValue] = useState(ask.value ?? '');
  const ok = () => d.done(value);
  const cancel = () => d.done(null);
  useEnter(ok);
  return (
    <Win d={d} close={cancel}>
      <Text text={ask.text} />
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </Win>
  );
}

/** FreeCol's pre-combat dialog: the offence and the defence modifiers side by side, then the results. */
function PreCombat({ d }: { d: Of<'preCombat'> }) {
  const { ask } = d;
  const ok = () => d.done(true);
  const cancel = () => d.done(false);
  // Swing's dialog has no default button; Enter takes the focused one only.
  useEnter(null);
  const rows = Math.max(ask.offence.length, ask.defence.length);
  const cell = (side: { source: string; value: string }[], i: number) => (
    <>
      <td>{side[i]?.source}</td>
      <td className="value">{side[i]?.value}</td>
    </>
  );
  return (
    <Win d={d} close={cancel}>
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
    </Win>
  );
}

/** FreeCol's end turn dialog: the units still waiting, each a button that makes the unit active. */
function EndTurn({ d }: { d: Of<'endTurn'> }) {
  const { ask } = d;
  const ok = () => d.done({ status: 'ok' });
  const cancel = () => d.done({ status: 'cancel' });
  useEnter(ask.ok !== null ? ok : cancel);
  return (
    <Win d={d} title={ask.header} close={cancel}>
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
    </Win>
  );
}

function Names({ d }: { d: Of<'names'> }) {
  const { ask } = d;
  const [values, setValues] = useState(ask.fields.map((f) => f.value));
  const ok = () => d.done(values);
  const cancel = () => d.done(null);
  useEnter(ok);
  return (
    <Win d={d} close={cancel}>
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
    </Win>
  );
}

function Goods({ d, art }: { d: Of<'goods'>; art: Art }) {
  const { ask } = d;
  const [picked, setPicked] = useState<number[]>(() =>
    ask.goods.flatMap((g, i) => (g.checked ? [i] : [])).slice(0, ask.max),
  );
  const full = picked.length >= ask.max;
  const toggle = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ask.max ? [...p, i] : p));
  const ok = () => d.done([...picked].sort((a, b) => a - b));
  const cancel = () => d.done(null);
  useEnter(ok);
  return (
    <Win d={d} close={cancel}>
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
            <GoodsAmount icon={g.icon} name={g.name} amount={g.amount} art={art} />
          </label>
        ))}
      </div>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} />
    </Win>
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
  useEnter(canAccept ? reply('accept') : reply('propose'));
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
    <Win d={d} title={ask.title} close={ask.cancel !== null ? reply('reject') : null}>
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
    </Win>
  );
}

/** A panel's body, then its close button. */
function Panel({
  d,
  title = null,
  children,
  ok,
}: {
  d: Dialog;
  title?: string | null;
  children: ReactNode;
  ok: string;
}) {
  const close = () => (d.done as () => void)();
  useEnter(close);
  return (
    <Win d={d} title={title} close={close}>
      {children}
      <div className="buttons">
        <button data-answer="close" onClick={close}>
          {ok}
        </button>
      </div>
    </Win>
  );
}

/** An event panel's flavour image and footer; its header is the window's title. */
function EventBody({ e, art }: { e: GuiEvents['eventPanel']; art: Art }) {
  return (
    <>
      {e.image && <Pic keys={[e.image]} art={art} className="flavour" />}
      {e.footer && <Text text={e.footer} />}
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

type Messages = GuiEvents['messages'];

/**
 * The messages, each with the image of what it is about. The turn report has FreeCol's buttons for them:
 * the group by option, a filter for a message's type, and for some messages an ignore. Like Swing's, they
 * dim the messages, and tell the Engine what to do about the next turns' messages; a filtered type is
 * dimmed in all its messages. The messages are named to the Engine by their place in the report.
 */
function MessageList({
  event,
  goTo,
  art,
  report,
}: {
  event: Messages;
  goTo: (at: At) => void;
  art: Art;
  report: ReportButtons;
}) {
  const [ignored, setIgnored] = useState(() => new Set(event.messages.flatMap((m, i) => (m.ignored ? [i] : []))));
  const [shown, setShown] = useState(
    () => new Map(event.messages.flatMap((m) => (m.filter === null ? [] : [[m.type, m.filter] as const]))),
  );
  const { groupBy } = event;
  return (
    <>
      {groupBy && (
        <label className="field group-by">
          {groupBy.label}{' '}
          <select value={groupBy.value} onChange={(e) => report.groupBy(Number(e.target.value))}>
            {groupBy.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.text}
              </option>
            ))}
          </select>
        </label>
      )}
      {event.messages.map((m, i) => {
        const dim = ignored.has(i) || shown.get(m.type) === false;
        return (
          <div key={i} className="message" data-dim={dim || undefined}>
            {m.heading && <TileText heading text={m.heading.text} at={m.heading.at} goTo={goTo} />}
            <div className="row">
              <Pic keys={m.images} art={art} />
              <TileText text={m.text} at={m.at} goTo={goTo} />
              {m.ignoreTip !== null && (
                <button
                  className="ignore"
                  title={m.ignoreTip}
                  aria-pressed={ignored.has(i)}
                  onClick={() => {
                    const flag = !ignored.has(i);
                    report.ignore(i, flag);
                    setIgnored((was) => {
                      const next = new Set(was);
                      if (flag) next.add(i);
                      else next.delete(i);
                      return next;
                    });
                  }}
                >
                  x
                </button>
              )}
              {m.filterTip !== null && (
                <button
                  className="filter"
                  title={m.filterTip}
                  aria-pressed={shown.get(m.type) === false}
                  onClick={() => {
                    const now = !(shown.get(m.type) ?? true);
                    report.filter(i, now);
                    setShown((was) => new Map(was).set(m.type, now));
                  }}
                >
                  X
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Body({ d, goTo, art, report }: { d: Dialog; goTo: (at: At) => void; art: Art; report: ReportButtons }) {
  switch (d.kind) {
    case 'confirm':
      return <Confirm d={d} />;
    case 'choice':
      return <Choice d={d} />;
    case 'input':
      return <Input d={d} />;
    case 'goods':
      return <Goods d={d} art={art} />;
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
          <div className="row">
            <Pic keys={d.event.images} art={art} />
            <TileText text={d.event.text} at={d.event.at} goTo={goTo} />
          </div>
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
        <Panel d={d} title={d.event.header} ok={d.event.ok}>
          <EventBody e={d.event} art={art} />
        </Panel>
      );
    case 'event':
      return (
        <Panel d={d} title={d.ask.header} ok={d.ask.ok}>
          <EventBody e={d.ask} art={art} />
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
        <Panel d={d} title={d.event.title} ok={d.event.ok}>
          <MessageList event={d.event} goTo={goTo} art={art} report={report} />
        </Panel>
      );
    case 'colony':
      return (
        <Panel d={d} title={d.event.name} ok={d.event.ok}>
          <ColonyPanel colony={d.event} art={art} />
        </Panel>
      );
  }
}

/**
 * The open dialog, over the page, or nothing. goTo centres the map on a tile, art finds the image for
 * resource keys, report is what the turn report's buttons do.
 */
export function DialogHost({
  dialogs,
  goTo,
  art,
  report,
}: {
  dialogs: Dialogs;
  goTo: (at: At) => void;
  art: Art;
  report: ReportButtons;
}) {
  const d = useSyncExternalStore(dialogs.subscribe, dialogs.current);
  if (!d) return null;
  return (
    <div className="modal">
      <Body key={d.id} d={d} goTo={goTo} art={art} report={report} />
    </div>
  );
}
