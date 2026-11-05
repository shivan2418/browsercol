// React components for the WebGUI's dialogs (dialogs.ts): the confirm,
// choice, input, select amount, goods, end turn, pre-combat, negotiation, names and founding father
// questions and the information, error, event, native settlement, message and colony
// (colony-panel.tsx) panels, each in a window frame (frame.tsx). All text,
// button labels included, comes localized from the Engine. Keys mean what
// they do in FreeCol's dialogs: Enter presses the focused button, else takes
// the default option; Escape, or the frame's close button, closes the
// dialog as cancelled; a panel closes on either key.
import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ColonyActions, ColonyPanel } from './colony-panel';
import { DebugContext } from './debug';
import type { Dialog, Dialogs } from './dialogs';
import { europeButtons } from './europe-client';
import { GoodsAmount, WindowFrame, type Art } from './frame';
import { draggableProps, dropTargetProps, OVER, type Item, type Place } from './moves';
import { ContextMenuContext, contextMenuHandler, useContextMenu } from './popup-menu';
import { OptionEditor } from './option-editor';
import { ReportPanel } from './reports';
import type {
  ColonyView,
  EuropeUnit,
  GuiEvents,
  ReportLink,
  SettlementEntry,
  TradeItem,
  TradeOption,
  TradeRouteDraft,
} from './webgui';

export type { Art };

type At = [number, number];

/** What the turn report's buttons do (ClientExports.reportGroupBy and the others). */
export interface ReportButtons {
  groupBy: (value: number) => void;
  filter: (index: number, shown: boolean) => void;
  ignore: (index: number, ignore: boolean) => void;
  /** Open what a heading or image links to: our colony's panel, or Europe (SwingGUI.displayObject). */
  open: (link: ReportLink) => void;
}

/** What the trade routes panel does to the player's routes (ClientExports.saveTradeRoute and deleteTradeRoute). */
export interface RouteButtons {
  save: (draft: TradeRouteDraft) => void;
  remove: (id: string) => void;
  /** Make a unit follow a route, or with null stop following one (ClientExports.assignTradeRoute). */
  assign: (unit: string, route: string | null) => void;
}

/** An image of a game object or event, if the Tileset has one. */
function Pic({ keys, art, className = 'pic' }: { keys: readonly string[]; art: Art; className?: string }) {
  const src = art(keys);
  return src === null ? null : <img className={className} src={src} alt="" />;
}

/**
 * What marks the button Enter presses, `data-enter`, which the page lights up while no button of the dialog has
 * the focus (index.html). Pass it where the button's action is the one given to useEnter.
 */
const enterMark = (on: boolean) => (on ? { 'data-enter': '' } : {});

/**
 * Answer Enter while the dialog is open, before anything else on the page
 * sees it; with no action it is still kept from the page. Enter on a button
 * of the dialog is left to the button, as in Swing, and so is Enter in the build queue (it adds what is selected). Escape is the frame's.
 */
function useEnter(enter: (() => void) | null) {
  const act = useRef(enter);
  act.current = enter;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (e.key !== 'Enter' || target?.closest('[role=dialog] button, .queue-body')) return;
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
  closeKeys,
  children,
}: {
  d: Dialog;
  title?: string | null;
  close: (() => void) | null;
  /** Keys that close the window as Escape does (frame.tsx). */
  closeKeys?: readonly string[];
  children: ReactNode;
}) {
  return (
    <WindowFrame
      className="dialog"
      aria-modal="true"
      data-kind={d.kind}
      title={title}
      close={close}
      closeKeys={closeKeys}
    >
      {children}
    </WindowFrame>
  );
}

/** FreeCol's text, its line breaks kept. */
const Text = ({ text }: { text: string }) => <p className="text">{text}</p>;

type Of<K extends Dialog['kind']> = Extract<Dialog, { kind: K }>;

/** The ok and cancel buttons of a question, each only if it has a label. */
function OkCancel(p: {
  ok: string | null;
  cancel: string | null;
  onOk: () => void;
  onCancel: () => void;
  /** The button Enter presses, if either. */
  enter?: 'ok' | 'cancel' | null;
}) {
  return (
    <div className="buttons">
      {p.ok !== null && (
        <button data-answer="ok" {...enterMark(p.enter === 'ok')} onClick={p.onOk}>
          {p.ok}
        </button>
      )}
      {p.cancel !== null && (
        <button data-answer="cancel" {...enterMark(p.enter === 'cancel')} onClick={p.onCancel}>
          {p.cancel}
        </button>
      )}
    </div>
  );
}

function Confirm({ d, colopedia }: { d: Of<'confirm'>; colopedia: (type: string) => void }) {
  const { ask } = d;
  const [help, setHelp] = useState(false);
  const ok = () => d.done(true);
  const cancel = () => d.done(false);
  const enter = ask.defaultOk && ask.ok !== null ? 'ok' : 'cancel';
  useEnter(enter === 'ok' ? ok : cancel);
  return (
    <Win d={d} title={ask.header} close={ask.escapeOk && ask.ok !== null ? ok : cancel}>
      <Text text={ask.text} />
      {help && ask.help?.text && <Text text={ask.help.text} />}
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter={enter} />
      {ask.help && (
        <div className="buttons">
          <button
            data-help
            onClick={() => {
              const { colopedia: entry } = ask.help!;
              if (entry !== null) colopedia(entry);
              else setHelp(true);
            }}
          >
            {ask.help.label}
          </button>
        </div>
      )}
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
  /** The item Enter picks; -1 for none, and for the cancel button when there is no cancel item. */
  const enterItem = byDefault >= 0 ? byDefault : ask.cancel !== null ? cancelItem : -1;
  const enterButton = byDefault < 0 && ask.cancel !== null && cancelItem < 0;
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
            {...enterMark(i === enterItem)}
            onClick={pick(i)}
          >
            {c.text}
          </button>
        ))}
      </div>
      {ask.cancel !== null && (
        <div className="buttons">
          <button data-answer="cancel" {...enterMark(enterButton)} onClick={() => d.done(null)}>
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
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter="ok" />
    </Win>
  );
}

/**
 * FreeCol's select amount dialog: the goods, and an editable box of the amounts it lists. OK takes only a whole
 * number from 0 to the most, as Swing's input verifier does.
 */
function Amount({ d, art }: { d: Of<'amount'>; art: Art }) {
  const { ask } = d;
  const [value, setValue] = useState(ask.value === null ? '' : String(ask.value));
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= ask.max;
  const ok = () => valid && d.done(n);
  const cancel = () => d.done(null);
  useEnter(ok);
  return (
    <Win d={d} close={cancel}>
      <Text text={ask.text} />
      <div className="amount" data-goods={ask.type ?? undefined}>
        <Pic keys={ask.keys} art={art} className="icon" />
        <input
          type="number"
          autoFocus
          min={0}
          max={ask.max}
          step={1}
          aria-label={ask.name ?? undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="choices amounts">
        {ask.values.map((v) => (
          <button key={v} data-amount={v} aria-pressed={String(v) === value} onClick={() => setValue(String(v))}>
            {v}
          </button>
        ))}
      </div>
      <div className="buttons">
        {ask.ok !== null && (
          <button data-answer="ok" data-enter="" disabled={!valid} onClick={ok}>
            {ask.ok}
          </button>
        )}
        {ask.cancel !== null && (
          <button data-answer="cancel" onClick={cancel}>
            {ask.cancel}
          </button>
        )}
      </div>
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

/**
 * FreeCol's end turn dialog: the units still waiting, each a button that makes the unit active (and opens its
 * colony or Europe) while the dialog stays open.
 */
function EndTurn({ d, pick }: { d: Of<'endTurn'>; pick: (unit: string) => void }) {
  const { ask } = d;
  const ok = () => d.done({ status: 'ok' });
  const cancel = () => d.done({ status: 'cancel' });
  useEnter(ask.ok !== null ? ok : cancel);
  return (
    <Win d={d} title={ask.header} close={cancel}>
      <Text text={ask.text} />
      <div className="choices waiting">
        {ask.units.map((u) => (
          <button key={u.id} data-unit={u.id} onClick={() => pick(u.id)}>
            {u.name}
            <span className="note"> {u.location}</span>
          </button>
        ))}
      </div>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter={ask.ok !== null ? 'ok' : 'cancel'} />
    </Win>
  );
}

/**
 * ChooseFoundingFatherDialog: a tab per father, named by its kind, and the open tab's father as
 * FatherDetailPanel shows it: name and kind, portrait, what it does, then its years and story. OK nominates
 * the open tab's father; closing postpones the choice.
 */
function Father({ d, art }: { d: Of<'father'>; art: Art }) {
  const { ask } = d;
  const [open, setOpen] = useState(0);
  const f = ask.fathers[open];
  const ok = () => d.done(open);
  useEnter(ok);
  const onKey = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (open + step + ask.fathers.length) % ask.fathers.length;
    setOpen(next);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <Win d={d} title={ask.title} close={() => d.done(null)}>
      <div className="tabs" role="tablist" onKeyDown={onKey}>
        {ask.fathers.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            id={`father-tab-${i}`}
            aria-selected={i === open}
            aria-controls="father-detail"
            tabIndex={i === open ? 0 : -1}
            data-father={t.id}
            onClick={() => setOpen(i)}
          >
            {t.kind}
          </button>
        ))}
      </div>
      {f && (
        <div className="father" role="tabpanel" id="father-detail" aria-labelledby={`father-tab-${open}`}>
          <h3>
            {f.name} ({f.kind})
          </h3>
          <Pic keys={f.keys} art={art} className="portrait" />
          <div className="about">
            <p className="effect">{f.description}</p>
            <p className="story">
              [{f.born}] {f.text}
            </p>
          </div>
        </div>
      )}
      <div className="buttons">
        <button data-answer="ok" data-enter="" onClick={ok}>
          {ask.ok}
        </button>
      </div>
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
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter="ok" />
    </Win>
  );
}

/** WarehouseDialog: a row of levels for each goods; OK sends all of them, the Engine saves what changed. */
function Warehouse({ d, art }: { d: Of<'warehouse'>; art: Art }) {
  const { ask } = d;
  const [rows, setRows] = useState(ask.goods);
  const set = (i: number, change: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(v)) || 0));
  const ok = () =>
    d.done(
      rows.map((r) => ({
        type: r.type,
        exported: r.exported,
        low: r.low,
        high: r.high,
        import: r.import,
        export: r.export,
      })),
    );
  const cancel = () => d.done(null);
  useEnter(ok);
  const level = (i: number, field: 'low' | 'high' | 'import' | 'export', max: number, tip: string) => (
    <input
      type="number"
      min={0}
      max={max}
      aria-label={`${rows[i].name} ${field}`}
      title={tip}
      value={rows[i][field] ?? 0}
      onChange={(e) => set(i, { [field]: num(e.target.value, max) })}
    />
  );
  return (
    <Win d={d} title={ask.title} close={cancel}>
      <div className="warehouse-goods">
        {rows.map((g, i) => (
          <fieldset key={g.type} data-goods={g.type}>
            <legend>{g.name}</legend>
            <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} />
            {level(i, 'low', 100, ask.tips.low)}
            {level(i, 'high', 100, ask.tips.high)}
            {g.import !== null && level(i, 'import', g.max, ask.tips.import)}
            <label title={ask.tips.exported}>
              <input
                type="checkbox"
                aria-label={`${g.name} ${ask.export}`}
                checked={g.exported}
                disabled={!ask.canExport}
                onChange={(e) => set(i, { exported: e.target.checked })}
              />
              {ask.export}
            </label>
            {level(i, 'export', g.max, ask.tips.export)}
          </fieldset>
        ))}
      </div>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter="ok" />
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
            <GoodsAmount keys={[g.icon]} name={g.name} amount={g.amount} art={art} />
          </label>
        ))}
      </div>
      <OkCancel ok={ask.ok} cancel={ask.cancel} onOk={ok} onCancel={cancel} enter="ok" />
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
  clear,
  clearLabel,
}: {
  o: TradeOption;
  items: TradeItem[];
  add: (i: TradeItem) => void;
  label: string;
  /** Take away every item of this kind and side. */
  clear: () => void;
  clearLabel: string;
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
      <button
        data-clear={o.kind}
        disabled={!items.some((i) => i.kind === o.kind && i.side === (o.side ?? i.side))}
        onClick={clear}
      >
        {clearLabel}
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
          <AddItem
            key={i}
            o={o}
            items={items}
            add={add}
            label={ask.add}
            clearLabel={ask.clear}
            clear={() => edit(items.filter((x) => !(x.kind === o.kind && x.side === (o.side ?? x.side))))}
          />
        ))}
      </div>
    );
  };
  return (
    <Win d={d} title={ask.title} close={ask.cancel !== null ? reply('reject') : null}>
      {ask.text !== null && <Text text={ask.text} />}
      {ask.tutorial !== null && <Text text={ask.tutorial} />}
      {group('demand', ask.demand)}
      {group('offer', ask.offer)}
      {group(null, null)}
      <div className="trade-summary">
        {given.length > 0 && list(ask.offer, given)}
        {taken.length > 0 && (given.length > 0 ? list(ask.exchange, taken) : list(ask.demand, taken))}
      </div>
      <div className="buttons">
        <button data-answer="send" {...enterMark(!canAccept)} onClick={reply('propose')}>
          {ask.send}
        </button>
        {ask.accept !== null && (
          <button data-answer="accept" {...enterMark(canAccept)} disabled={changed} onClick={reply('accept')}>
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

/** The colony panel; its warehouse and OK buttons sit in the right column, under the ships in port. */
function ColonyDialog({ d, e, art }: { d: Dialog; e: ColonyView; art: Art }) {
  const moves = useContext(ColonyActions);
  // With the means to move, the Engine closes the panel, once the player may (Commands.closeColonyPanel).
  const close = moves ? () => moves.close(e.id) : () => (d.done as () => void)();
  const debug = useContext(DebugContext);
  useEnter(close);
  return (
    <Win d={d} title={e.name} close={close}>
      <ColonyPanel
        colony={e}
        art={art}
        footer={
          <PanelButtons
            ok={e.ok}
            close={close}
            extra={moves ? { label: e.warehouse.title, run: () => moves.warehouse(e.id) } : null}
            lead={
              // ColonyPanel's debug "Trace work" button: log this colony's occupation decisions.
              debug.on ? (
                <button data-debug="traceWork" onClick={() => debug.request({ action: 'traceWork', colony: e.id })}>
                  Trace work
                </button>
              ) : null
            }
          />
        }
      />
    </Win>
  );
}

/** A panel's close button, with an optional second button beside it. */
function PanelButtons({
  ok,
  close,
  extra = null,
  lead = null,
}: {
  ok: string;
  close: () => void;
  extra?: { label: string; run: () => void } | null;
  lead?: ReactNode;
}) {
  return (
    <div className="buttons">
      {lead}
      {extra && <button onClick={extra.run}>{extra.label}</button>}
      <button data-answer="close" data-enter="" onClick={close}>
        {ok}
      </button>
    </div>
  );
}

function Panel({
  d,
  title = null,
  children,
  ok,
  extra = null,
  lead = null,
  closeKeys,
}: {
  d: Dialog;
  title?: string | null;
  children: ReactNode;
  ok: string;
  /** A second button beside OK. */
  extra?: { label: string; run: () => void } | null;
  /** Buttons at the left of the footer, with OK alone at the right. */
  lead?: ReactNode;
  /** Keys that close the panel as Escape does (frame.tsx). */
  closeKeys?: readonly string[];
}) {
  const close = () => (d.done as () => void)();
  useEnter(close);
  return (
    <Win d={d} title={title} close={close} closeKeys={closeKeys}>
      {children}
      <PanelButtons ok={ok} close={close} extra={extra} lead={lead} />
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
            {m.heading &&
              (m.heading.link ? (
                <h3 className="text">
                  <a
                    href="#"
                    data-link={m.heading.link.kind}
                    onClick={(e) => {
                      e.preventDefault();
                      report.open(m.heading!.link!);
                    }}
                  >
                    {m.heading.text}
                  </a>
                </h3>
              ) : (
                <TileText heading text={m.heading.text} at={m.heading.at} goTo={goTo} />
              ))}
            <div className="row">
              {m.link && art(m.images) !== null ? (
                <a
                  href="#"
                  className="pic-link"
                  data-link={m.link.kind}
                  onClick={(e) => {
                    e.preventDefault();
                    report.open(m.link!);
                  }}
                >
                  <Pic keys={m.images} art={art} />
                </a>
              ) : (
                <Pic keys={m.images} art={art} />
              )}
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

type Routes = GuiEvents['tradeRoutes'];
type Stop = TradeRouteDraft['stops'][number] & { label: string };
type Draft = Omit<TradeRouteDraft, 'stops'> & { stops: Stop[] };

/** The route the player last tried to save, which the Engine refused: the editor opens on it again. */
let refused: Draft | null = null;

/**
 * FreeCol's trade route input panel: a route's name, its stops (stops are selected, several with ctrl or
 * shift, to remove them, to say which goods they load, or to drag them elsewhere in the route), where to add
 * one, and silence. Saving leaves the panel to the Engine, which sends
 * the routes again.
 */
function RouteEditor({
  e,
  start,
  art,
  save,
  cancel,
}: {
  e: Routes;
  start: Draft;
  art: Art;
  save: (d: Draft) => void;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(start);
  // The selected stops, in order, as Swing's multi-select list has them; shift selects from the anchor.
  const [sel, setSel] = useState<number[]>(start.stops.length > 0 ? [0] : []);
  const [anchor, setAnchor] = useState(0);
  const [place, setPlace] = useState('');
  const ok = () => draft.name.trim() !== '' && save(draft);
  useEnter(ok);
  // The goods shown are the first selected stop's, as Swing's cargo panel shows them.
  const stop = sel.length === 0 ? undefined : draft.stops[sel[0]];
  const label = (id: string) => e.places.find((p) => p.id === id)?.label ?? id;
  const pick = (i: number, ev: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (ev.shiftKey) {
      const [lo, hi] = anchor < i ? [anchor, i] : [i, anchor];
      setSel(draft.stops.map((_, j) => j).filter((j) => j >= lo && j <= hi));
      return;
    }
    setAnchor(i);
    if (ev.ctrlKey || ev.metaKey) {
      setSel(sel.includes(i) ? sel.filter((j) => j !== i) : [...sel, i].sort((a, b) => a - b));
    } else {
      setSel([i]);
    }
  };
  const add = () => {
    // As Swing's: after the last selected stop, with the goods the first loads; all colonies means Europe and every colony.
    const ids = place === '' ? e.places.map((p) => p.id) : [place];
    const made = ids.map((id) => ({ place: id, label: label(id), cargo: [...(stop?.cargo ?? [])] }));
    const where = sel.length === 0 ? draft.stops.length : sel[sel.length - 1] + 1;
    setDraft({ ...draft, stops: [...draft.stops.slice(0, where), ...made, ...draft.stops.slice(where)] });
    setSel([where + made.length - 1]);
    setAnchor(where + made.length - 1);
  };
  const remove = () => {
    if (sel.length === 0) return;
    const stops = draft.stops.filter((_, i) => !sel.includes(i));
    setDraft({ ...draft, stops });
    // As Swing's, the stop under the last one removed is selected, so the player can go on removing.
    const next = Math.min(sel[sel.length - 1] - sel.length + 1, stops.length - 1);
    setSel(stops.length === 0 ? [] : [next]);
    setAnchor(Math.max(next, 0));
  };
  // The stops being dragged: the selection when a selected stop is picked up, else that stop alone.
  const dragged = useRef<number[]>([]);
  const lift = (i: number, ev: ReactDragEvent) => {
    dragged.current = sel.includes(i) ? sel : [i];
    setSel(dragged.current);
    ev.dataTransfer.setData('text/plain', draft.stops[i].label);
    ev.dataTransfer.effectAllowed = 'move';
  };
  // As Swing's: the dragged stops go before the stop they are dropped on, or to the end, and stay selected.
  const drop = (before: number | null, ev: ReactDragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove(OVER);
    const moved = dragged.current;
    dragged.current = [];
    if (moved.length === 0) return;
    const end = before ?? draft.stops.length;
    const rest = (from: number, to: number) => draft.stops.slice(from, to).filter((_, k) => !moved.includes(from + k));
    const head = rest(0, end);
    const stops = [...head, ...moved.map((i) => draft.stops[i]), ...rest(end, draft.stops.length)];
    setDraft({ ...draft, stops });
    setSel(moved.map((_, k) => head.length + k));
    setAnchor(head.length);
  };
  // The place a stop would drop on is marked, as the colony panel's are.
  const over = (ev: ReactDragEvent) => {
    if (dragged.current.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.add(OVER);
  };
  const leave = (ev: ReactDragEvent) => ev.currentTarget.classList.remove(OVER);
  // As Swing's, each press loads another hold of the goods type at every selected stop; a held one is taken off one copy at a time.
  const load = (goods: string) =>
    setDraft({
      ...draft,
      stops: draft.stops.map((s, i) => (sel.includes(i) ? { ...s, cargo: [...s.cargo, goods] } : s)),
    });
  const unload = (goods: string) =>
    setDraft({
      ...draft,
      stops: draft.stops.map((s, i) => {
        const at = s.cargo.indexOf(goods);
        return sel.includes(i) && at >= 0 ? { ...s, cargo: s.cargo.filter((_, k) => k !== at) } : s;
      }),
    });
  const goodsName = (id: string) => e.goods.find((g) => g.id === id);
  return (
    <>
      {e.error !== null && (
        <p className="text error" role="alert">
          {e.error}
        </p>
      )}
      <label className="field">
        <span className="text">{e.nameLabel}</span>
        <input autoFocus value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} />
      </label>
      <label className="field">
        <input
          type="checkbox"
          checked={draft.silent}
          onChange={(ev) => setDraft({ ...draft, silent: ev.target.checked })}
        />{' '}
        {e.silence}
      </label>
      <div
        className="stops"
        onKeyDown={(ev) => {
          // As Swing's keyTyped: Delete removes the selected stops.
          if (ev.key === 'Delete') remove();
        }}
        onDragOver={over}
        onDragLeave={leave}
        onDrop={(ev) => drop(null, ev)}
      >
        {draft.stops.map((s, i) => (
          <button
            key={i}
            data-stop={i}
            aria-pressed={sel.includes(i)}
            onClick={(ev) => pick(i, ev)}
            draggable
            onDragStart={(ev) => lift(i, ev)}
            onDragEnd={() => (dragged.current = [])}
            onDragOver={over}
            onDragLeave={leave}
            onDrop={(ev) => drop(i, ev)}
          >
            <span className="name">{s.label}</span>
            {s.cargo.map((g, k) => (
              <span key={k} className="cargo">
                <Pic keys={[goodsName(g)?.icon ?? g]} art={art} className="pic small" />
                {goodsName(g)?.name ?? g}
              </span>
            ))}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="text">
          {e.destinationLabel}{' '}
          <select value={place} onChange={(ev) => setPlace(ev.target.value)}>
            <option value="">{e.allColonies}</option>
            {e.places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button data-answer="addStop" disabled={draft.stops.length >= e.places.length} onClick={add}>
          {e.addStop}
        </button>
        <button data-answer="removeStop" disabled={sel.length === 0} onClick={remove}>
          {e.removeStop}
        </button>
      </div>
      <div className="goods">
        {e.goods.map((g) => (
          <button key={g.id} data-goods={g.id} disabled={stop === undefined} onClick={() => load(g.id)}>
            <Pic keys={[g.icon]} art={art} className="pic small" />
            {g.name}
          </button>
        ))}
      </div>
      <div className="held">
        {(stop?.cargo ?? []).map((g, k) => (
          <button key={k} data-held={g} aria-label={`× ${goodsName(g)?.name ?? g}`} onClick={() => unload(g)}>
            <Pic keys={[goodsName(g)?.icon ?? g]} art={art} className="pic small" />
            {goodsName(g)?.name ?? g}
          </button>
        ))}
      </div>
      <div className="buttons">
        <button data-answer="ok" data-enter="" disabled={draft.name.trim() === ''} onClick={ok}>
          {e.ok}
        </button>
        <button data-answer="cancel" onClick={cancel}>
          {e.cancel}
        </button>
      </div>
    </>
  );
}

/** FreeCol's trade route panel: the routes, with the units that follow each, to create, edit and delete. */
function RoutesPanel({ d, art, routes }: { d: Of<'tradeRoutes'>; art: Art; routes: RouteButtons }) {
  const e = d.event;
  // A refused change leaves the editor open on what the player made of the route.
  const [editing, setEditing] = useState<Draft | null>(e.error !== null ? refused : null);
  const [picked, setPicked] = useState<string | null>(null);
  const close = () => d.done();
  const route = e.routes.find((r) => r.id === picked);
  // As TradeRoutePanel's, a new route has the name the server gives it until the player changes it.
  const blank: Draft = { id: null, name: e.defaultName, silent: false, stops: [] };
  const edit = (r: Routes['routes'][number]): Draft => ({
    id: r.id,
    name: r.name,
    silent: r.silent,
    stops: r.stops.map((s) => ({ place: s.place, label: s.label, cargo: [...s.cargo] })),
  });
  useEnter(editing === null ? close : null);
  if (editing !== null) {
    const leave = () => {
      refused = null;
      setEditing(null);
    };
    return (
      <Win d={d} title={e.editRoute} close={leave}>
        <RouteEditor
          e={e}
          start={editing}
          art={art}
          save={(draft) => {
            refused = draft;
            routes.save({
              id: draft.id,
              name: draft.name.trim(),
              silent: draft.silent,
              stops: draft.stops.map((s) => ({ place: s.place, cargo: s.cargo })),
            });
          }}
          cancel={leave}
        />
      </Win>
    );
  }
  return (
    <Win d={d} title={e.title} close={close}>
      {e.unit?.location != null && (
        <p className="text unit">
          <Pic keys={e.unit.images} art={art} className="pic small" /> {e.unit.name} {e.unit.location}
        </p>
      )}
      <div className="routes">
        {e.routes.map((r) => (
          <button key={r.id} data-route={r.id} aria-pressed={r.id === picked} onClick={() => setPicked(r.id)}>
            {r.units > 0 ? `${r.name}  (${r.units})` : r.name}
          </button>
        ))}
      </div>
      <div className="buttons">
        <button data-answer="new" title={e.tooltips.new} onClick={() => setEditing(blank)}>
          {e.newRoute}
        </button>
        {e.unit && (
          <>
            <button
              data-answer="assign"
              disabled={!route || route.id === e.unit.route}
              onClick={() => route && e.unit && routes.assign(e.unit.id, route.id)}
            >
              {e.assign}
            </button>
            <button
              data-answer="unassign"
              title={e.tooltips.deassign}
              disabled={e.unit.route === null}
              onClick={() => e.unit && routes.assign(e.unit.id, null)}
            >
              {e.unassign}
            </button>
          </>
        )}
        <button
          data-answer="edit"
          title={e.tooltips.edit}
          disabled={!route}
          onClick={() => route && setEditing(edit(route))}
        >
          {e.editRoute}
        </button>
        <button
          data-answer="delete"
          title={e.tooltips.delete}
          disabled={!route}
          onClick={() => route && routes.remove(route.id)}
        >
          {e.deleteRoute}
        </button>
        <button data-answer="close" data-enter="" onClick={close}>
          {e.ok}
        </button>
      </div>
    </Win>
  );
}

type Europe = GuiEvents['europe'];

/**
 * Goods dragged in Europe move as the stack picked up, as Swing's DragListener moves a label's amount; shift held at the
 * start of the drag has the Engine ask how many, shift and alt together drag all of the type.
 */
const goodsDrag = (item: Item) => {
  const props = draggableProps(
    item,
    (e) => ({ ...item, ask: e.shiftKey && !e.altKey, all: e.shiftKey && e.altKey }) as Item,
  );
  // The drag shows the goods alone, not the price or amount beside them.
  const onDragStart = (e: ReactDragEvent<HTMLElement>) => {
    props.onDragStart(e);
    const img = e.currentTarget.querySelector<HTMLElement>('img');
    if (img) e.dataTransfer.setDragImage?.(img, img.offsetWidth / 2, img.offsetHeight / 2);
  };
  return { ...props, onDragStart };
};

/** A unit or ship of Europe's panel, with its picture. */
function UnitChip({
  u,
  art,
  pick,
  on,
  drag,
  drop,
}: {
  u: EuropeUnit;
  art: Art;
  pick?: () => void;
  on?: boolean;
  /** Whether the unit can be dragged somewhere, as a dock's unit can board. */
  drag?: boolean;
  /** What a drop on the unit's icon does, as a ship in port takes cargo. */
  drop?: (item: Item) => void;
}) {
  const inner = (
    <>
      <Pic keys={u.images} art={art} />
      <span className="name">{u.name}</span>
    </>
  );
  const props = {
    ...(drag ? draggableProps({ kind: 'unit', id: u.id }) : {}),
    ...(drop ? dropTargetProps('ship', drop) : {}),
  };
  const onContextMenu = useContextMenu((m) => m.unit(u.id));
  return pick ? (
    <button
      className="chip"
      data-unit={u.id}
      title={u.name}
      aria-pressed={on}
      onClick={pick}
      onContextMenu={onContextMenu}
      {...props}
    >
      {inner}
    </button>
  ) : (
    <div className="chip" data-unit={u.id} title={u.name} onContextMenu={onContextMenu} {...props}>
      {inner}
    </div>
  );
}

/**
 * Europe, arranged as EuropePanel arranges it: the ships sailing to America and to Europe, the
 * ships in port with the cargo of the one picked, the docks, and the market with each goods' sell/buy price
 * (MarketLabel's). The gold is beside the title.
 *
 * The market trades as it does in Swing: a goods of the market dropped on the cargo of a ship in port is
 * bought, and a stack of that cargo dropped on the market is sold. Clicking does the same, and the Engine
 * asks how much of it, as the select amount dialog does. A goods that is boycotted is dimmed, and says
 * why.
 */
/** The key that opens Europe (input.ts) closes it too. */
const EUROPE_KEYS = ['e'] as const;

function EuropePanel({ d, art }: { d: Of<'europe'>; art: Art }) {
  const e: Europe = d.event;
  const menus = useContext(ContextMenuContext);
  const debug = useContext(DebugContext);
  const [picked, setPicked] = useState(e.selected);
  const [shop, setShop] = useState<'recruit' | 'train' | 'purchase' | null>(null);
  // After a purchase that leaves nothing affordable the popup closes, as Swing's does.
  const bought = useRef(false);
  useEffect(() => {
    if (!bought.current) return;
    bought.current = false;
    if (shop && !(shop === 'recruit' ? e.recruit.units : e[shop].units).some((o) => o.enabled)) setShop(null);
  }, [e]);
  // The sales log keeps its newest entry, the last, in view.
  const logRef = useRef<HTMLElement>(null);
  const logCount = e.log.entries.length;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [logCount]);
  const ship = e.inPort.find((u) => u.id === picked) ?? null;
  // In debug mode the tooltip also gives how much the market holds, as MarketLabel does in DebugMode.MENUS.
  const marketTitle = (g: Europe['market'][number]) =>
    debug.on ? `${g.reason ?? g.name} (${g.inMarket} in market)` : (g.reason ?? g.name);
  const closeShop = () => setShop(null);
  // EuropePanel's button keys: R recruit, P purchase, T train, S sail, while Europe is the newest window.
  const keyAct = useRef<(key: string) => void>(() => {});
  keyAct.current = (key) => {
    const kind = ({ r: 'recruit', p: 'purchase', t: 'train' } as const)[key as 'r' | 'p' | 't'];
    if (kind) setShop(shop === kind ? null : kind);
    else if (key === 's' && ship) europeButtons.sail(ship.id);
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.repeat) return;
      if (ev.target instanceof Element && ev.target.matches('input, textarea, select, [contenteditable]')) return;
      const windows = document.querySelectorAll('.dialog[data-kind]');
      if (windows[windows.length - 1]?.getAttribute('data-kind') !== 'europe') return;
      keyAct.current(ev.key.toLowerCase());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  /** The recruit, train or purchase list: a popup over the panel, a card of one size for each unit. */
  const shopPopup = (kind: 'recruit' | 'train' | 'purchase') => (
    <div className="modal shop-modal">
      <WindowFrame className="dialog shop-popup" data-shop={kind} title={e[kind].heading} close={closeShop}>
        {kind === 'recruit' && <p className="text">{e.recruit.text}</p>}
        <div className="cards">
          {kind === 'recruit'
            ? e.recruit.units.map((r) => (
                <button
                  key={r.index}
                  className="card offer"
                  data-recruit={r.index}
                  disabled={!r.enabled}
                  onClick={() => {
                    bought.current = true;
                    europeButtons.recruit(r.index);
                  }}
                >
                  <Pic keys={r.images} art={art} />
                  <span className="name">{r.name}</span>
                  <span className="price" />
                </button>
              ))
            : e[kind].units.map((o) => (
                <button
                  key={o.id}
                  className="card offer"
                  data-offer={o.id}
                  disabled={!o.enabled}
                  onClick={() => {
                    bought.current = true;
                    europeButtons.train(o.id);
                  }}
                >
                  <Pic keys={o.images} art={art} />
                  <span className="name">{o.name}</span>
                  <span className="price">{o.priceLabel}</span>
                </button>
              ))}
        </div>
      </WindowFrame>
    </div>
  );
  const list = (
    heading: string,
    kind: string,
    units: EuropeUnit[],
    pick?: (u: EuropeUnit) => () => void,
    drag?: boolean,
    drop?: (item: Item) => void,
    place: Place = 'sailing',
    unitDrop?: (u: EuropeUnit) => (item: Item) => void,
  ) => (
    <section className="box" data-list={kind} {...(drop ? dropTargetProps(place, drop) : {})}>
      <h3>{heading}</h3>
      <div className="chips">
        {units.map((u) => (
          <UnitChip key={u.id} u={u} art={art} pick={pick?.(u)} on={u.id === picked} drag={drag} drop={unitDrop?.(u)} />
        ))}
      </div>
    </section>
  );
  /** What the market says of a goods type: whether it can be traded, and why not. */
  const trade = new Map(e.market.map((g) => [g.id, g]));
  /** Buy a goods of the market onto the ship in port. */
  const buy = (goodsTypeId: string, ask = true) => {
    if (ship) europeButtons.buy(goodsTypeId, ship.id, ask);
  };
  /** Sell a stack of the ship's cargo. */
  const sell = (goodsTypeId: string, ask = true, stack = 0) => {
    if (ship) europeButtons.sell(goodsTypeId, ship.id, ask, stack);
  };
  /** The right-click menu of a ship's cargo: a unit's own, or goods' sale. */
  const cargoMenu = (c: { kind: 'unit' | 'goods'; id: string; amount: number }) =>
    contextMenuHandler(menus, (m) =>
      c.kind === 'unit' ? m.unit(c.id) : ship ? m.goods(ship.id, c.id, c.amount) : null,
    );
  /** The right-click menu of the market's goods: buying onto a ship in port. */
  const marketMenu = (goodsTypeId: string) => contextMenuHandler(menus, (m) => m.goods('europe', goodsTypeId, 100));
  /** What a drop on the cargo does: the market's goods are bought, a unit of the docks boards. */
  const onCargo = (item: Item) => {
    if (item.kind === 'goods' && item.from === 'market') buy(item.type, item.ask === true);
    else if (item.kind === 'unit' && ship) europeButtons.board(item.id, ship.id);
  };
  /** What a drop on the docks does: a unit aboard the ship comes ashore. */
  const onDocks = (item: Item) => {
    if (item.kind === 'unit' && ship?.cargo?.some((c) => c.kind === 'unit' && c.id === item.id)) {
      europeButtons.leave(item.id);
    }
  };
  /**
   * What a drop on the ships sailing to America or to Europe does: a ship in port is sent, as the Sail button does
   * (the Engine asks where), and a ship on the high seas is turned around.
   */
  const onSailing = (toEurope: boolean) => (item: Item) => {
    if (item.kind !== 'unit') return;
    if (e.inPort.some((u) => u.id === item.id)) europeButtons.sail(item.id);
    else if ((toEurope ? e.toAmerica : e.toEurope).some((u) => u.id === item.id))
      europeButtons.redirect(item.id, toEurope);
  };
  /** What a drop on a ship's icon in port does: a unit boards it, goods load onto it, bought or from another ship. */
  const onShip = (target: EuropeUnit) => (item: Item) => {
    if (item.kind === 'unit') europeButtons.board(item.id, target.id);
    else if (item.from === 'market') europeButtons.buy(item.type, target.id, item.ask === true);
    else if (item.from === 'cargo' && ship && ship.id !== target.id) {
      europeButtons.transfer(ship.id, target.id, item.type, item.all ? 0 : (item.amount ?? 0));
    }
  };
  /** What a drop on the market does: the stack of the cargo is sold, or all of the type with shift and alt. */
  const onMarket = (item: Item) => {
    if (item.kind === 'goods' && item.from === 'cargo')
      sell(item.type, item.ask === true, item.all ? 0 : (item.amount ?? 0));
  };
  const footer = (
    <>
      {(['recruit', 'train', 'purchase'] as const).map((kind) => (
        <button
          key={kind}
          data-europe={kind}
          aria-pressed={shop === kind}
          onClick={() => setShop(shop === kind ? null : kind)}
        >
          {e.buttons[kind]}
        </button>
      ))}
      <button
        data-europe="unload"
        disabled={!ship?.cargo?.length}
        onClick={() => ship && europeButtons.unload(ship.id)}
      >
        {e.buttons.unload}
      </button>
      <button data-europe="sail" disabled={!ship} onClick={() => ship && europeButtons.sail(ship.id)}>
        {e.buttons.sail}
      </button>
    </>
  );
  return (
    // E, which opened Europe from the map, closes it again (not while a shop popup or a question is over it).
    <Panel d={d} ok={e.ok} lead={footer} closeKeys={EUROPE_KEYS}>
      <div className="europe-title">
        <h2>{e.title}</h2>
      </div>
      {shop && shopPopup(shop)}
      <div className="europe-body">
        <div className="europe-top">
          <div className="europe">
            {list(e.headings.toAmerica, 'toAmerica', e.toAmerica, undefined, true, onSailing(false))}
            {list(e.headings.toEurope, 'toEurope', e.toEurope, undefined, true, onSailing(true))}
            {list(
              e.headings.inPort,
              'inPort',
              e.inPort,
              (u) => () => setPicked(u.id),
              true,
              undefined,
              undefined,
              (u) => onShip(u),
            )}
            {list(
              e.headings.docks,
              'docks',
              e.docks,
              ship ? (u) => () => europeButtons.board(u.id, ship.id) : undefined,
              ship !== null,
              onDocks,
              'docks',
            )}
            <section className="box cargo" data-list="cargo" {...(ship ? dropTargetProps('cargo', onCargo) : {})}>
              <h3>{ship?.cargoTitle ?? e.headings.cargo}</h3>
              <div className="chips">
                {ship?.cargo?.map((c, i) => {
                  const goods = trade.get(c.id);
                  // A boycotted stack is still a button: selling it asks to pay the arrears, as Swing does.
                  const sellable = c.kind === 'goods';
                  const drag =
                    c.kind === 'unit'
                      ? draggableProps({ kind: 'unit', id: c.id })
                      : goodsDrag({ kind: 'goods', from: 'cargo', type: c.id, index: i, amount: c.amount });
                  const inner = (
                    <>
                      <Pic keys={c.images} art={art} />
                      {c.kind === 'goods' && <span className="name">{c.amount}</span>}
                    </>
                  );
                  return sellable ? (
                    <button
                      key={`${c.kind}/${c.id}`}
                      className="chip"
                      data-cargo={c.kind}
                      data-disabled={goods?.enabled === false || undefined}
                      title={goods?.reason ?? c.name}
                      onClick={() => sell(c.id)}
                      onContextMenu={cargoMenu(c)}
                      {...drag}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div
                      key={`${c.kind}/${c.id}`}
                      className="chip"
                      data-cargo={c.kind}
                      title={goods?.reason ?? c.name}
                      onContextMenu={cargoMenu(c)}
                      {...(c.kind === 'unit' ? drag : {})}
                    >
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <aside className="europe-log" data-log ref={logRef}>
            <h3>{e.log.heading}</h3>
            {e.log.entries.map((lines, i) => (
              // FreeCol's lines tab a label from its amount ("Price:\t200"): the amount goes right.
              <div key={i} className="entry" data-entry>
                {lines.map((line, j) => (
                  <div key={j} className="line" data-line>
                    {line.split('\t').map((part, k) => (
                      <span key={k}>{part}</span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </aside>
        </div>
        <section className="box market" data-list="market" {...dropTargetProps('market', onMarket)}>
          <div className="goods">
            {e.market.map((g) => {
              // A boycotted goods is still a button with a ship in port: buying it asks to pay the
              // arrears, as Swing's MarketLabel does.
              const buyable = ship !== null;
              const drag = goodsDrag({ kind: 'goods', from: 'market', type: g.id });
              const inner = (
                <>
                  <Pic keys={g.images} art={art} />
                  <span className="price">
                    {g.sell}/{g.buy}
                  </span>
                </>
              );
              return buyable ? (
                <button
                  key={g.id}
                  className="good"
                  data-goods={g.id}
                  data-disabled={!g.enabled || undefined}
                  title={marketTitle(g)}
                  onClick={() => buy(g.id)}
                  onContextMenu={marketMenu(g.id)}
                  {...drag}
                >
                  {inner}
                </button>
              ) : (
                <div
                  key={g.id}
                  className="good"
                  data-goods={g.id}
                  data-disabled={!g.enabled || undefined}
                  title={marketTitle(g)}
                  onContextMenu={marketMenu(g.id)}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Panel>
  );
}

/** A native settlement as IndianSettlementPanel lays it out: the settlement and its missionary, then what is known. */
function SettlementBody({
  e,
  art,
  string,
}: {
  e: GuiEvents['indianSettlement'];
  art: Art;
  string: (key: string) => string;
}) {
  const entry = (item: SettlementEntry, tip: string | null = null) => (
    <span className="entry" title={tip ?? undefined}>
      <Pic keys={item.images} art={art} />
      {item.text}
    </span>
  );
  return (
    <div className="settlement">
      <div className="entry">
        <Pic keys={e.images} art={art} />
        <span>
          {e.name}, {e.kind}
          {e.tension && ` (${e.tension})`}
          {e.worthScouting && string('unscoutedIndianSettlement')}
        </span>
      </div>
      {e.missionary && entry(e.missionary)}
      <h3>{e.labels.learnableSkill}</h3>
      {entry(e.skill)}
      <h3>{e.labels.hatedNation}</h3>
      {entry(e.mostHated)}
      <h3>{e.labels.highlyWanted}</h3>
      {entry(e.wanted[0], e.wanted[0].tip)}
      <h3>{e.labels.otherWanted}</h3>
      <div className="wanted">
        {e.wanted.slice(1).map((w, i) => (
          <Fragment key={i}>{entry(w, w.tip)}</Fragment>
        ))}
      </div>
    </div>
  );
}

/** A tile as TilePanel lays it out, with a button to the Colopedia's entry on its terrain. */
function TileBody({ e, art }: { e: GuiEvents['tilePanel']; art: Art }) {
  return (
    <div className="tile-panel">
      <h2>{e.title}</h2>
      <div className="terrain-image">
        <Pic keys={e.keys} art={art} />
        {e.forest && <Pic keys={e.forest} art={art} />}
      </div>
      <dl>
        {e.rows.map((r) => (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="production">
        {e.production.map((g) => (
          <GoodsAmount key={g.type} keys={g.keys} name={g.name} amount={g.amount} expert={g.expert} art={art} />
        ))}
      </div>
    </div>
  );
}

/**
 * FindSettlementPanel: a list of settlements under a filter (all, natives, Europeans). Picking a row centres
 * the map on it; Enter or a double click opens its colony or native settlement panel, as in Swing, and
 * closes this one.
 */
export function FindSettlement({
  d,
  art,
  goTo,
  open,
}: {
  d: Of<'findSettlement'>;
  art: Art;
  goTo: (at: At) => void;
  open: (id: string) => void;
}) {
  const e = d.event;
  const [filter, setFilter] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = e.settlements.filter((s) => filter === 0 || s.native === (filter === 1));
  // As Swing keeps the selection over a filter change, and falls back to the first row.
  const selected = shown.find((s) => s.id === picked) ?? shown[0] ?? null;
  const at = selected?.at;
  useEffect(() => {
    if (at) goTo(at);
    // goTo changes with each render of the page; only a different row moves the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  const close = () => (d.done as () => void)();
  const choose = (s: (typeof shown)[number] | null) => {
    if (!s?.open) return;
    close();
    open(`${s.native ? 'settlement' : 'colony'}:${s.id}`);
  };
  useEnter(selected ? () => choose(selected) : close);
  const onKey = (ev: ReactKeyboardEvent) => {
    const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || !selected) return;
    ev.preventDefault();
    const next = shown[Math.min(shown.length - 1, Math.max(0, shown.indexOf(selected) + step))];
    setPicked(next.id);
    (ev.currentTarget.querySelector(`[data-id="${CSS.escape(next.id)}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <Win d={d} title={e.title} close={close}>
      <div className="settlements" role="listbox" aria-label={e.title} onKeyDown={onKey}>
        {shown.map((s) => (
          <button
            key={s.id}
            role="option"
            data-id={s.id}
            aria-selected={s === selected}
            tabIndex={s === selected ? 0 : -1}
            onClick={() => setPicked(s.id)}
            onDoubleClick={() => {
              setPicked(s.id);
              choose(s);
            }}
          >
            <Pic keys={s.images} art={art} />
            {s.name}
          </button>
        ))}
      </div>
      <select aria-label={e.title} value={filter} onChange={(ev) => setFilter(Number(ev.target.value))}>
        {e.filters.map((label, i) => (
          <option key={i} value={i}>
            {label}
          </option>
        ))}
      </select>
      <PanelButtons ok={e.ok} close={close} />
    </Win>
  );
}

/** One modifier line of WorkProductionPanel: its source and its signed value. */
function ModifierRows({ lines }: { lines: { source: string; value: string }[] }) {
  return (
    <>
      {lines.map((m, i) => (
        <tr key={i}>
          <td>{m.source}</td>
          <td className="value">{m.value}</td>
        </tr>
      ))}
    </>
  );
}

/**
 * WorkProductionPanel: how a colonist's output is reached. The place and the colonist, the base production,
 * each modifier, the zero threshold if production would go negative, and the final result; a building adds
 * what it makes unattended.
 */
function WorkProduction({ d, art }: { d: Of<'workProduction'>; art: Art }) {
  const e = d.event;
  return (
    <Panel d={d} ok={e.ok}>
      <div className="work-production">
        <h2>{e.title}</h2>
        <div className="row">
          <div className="terrain-image">
            <Pic keys={e.keys} art={art} />
            {e.forest && <Pic keys={e.forest} art={art} />}
          </div>
          <Pic keys={e.unitKeys} art={art} />
          <span>{e.unit}</span>
        </div>
        <table className="modifiers">
          <tbody>
            <tr>
              <td>{e.place}</td>
              <td className="value">{e.base}</td>
            </tr>
            <ModifierRows lines={e.lines} />
            {e.zero && (
              <tr>
                <td>{e.zero.label}</td>
                <td className="value">{e.zero.value}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>{e.finalResult}</th>
              <th className="value">{e.result}</th>
            </tr>
          </tfoot>
        </table>
        {e.unattended && (
          <table className="modifiers unattended">
            <caption>{e.unattended.label}</caption>
            <tbody>
              <tr>
                <td>{e.unattended.place}</td>
                <td className="value">{e.unattended.base}</td>
              </tr>
              <ModifierRows lines={e.unattended.lines} />
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}

/** The Colopedia's terrain entry as TerrainDetailPanel lays it out. */
function TerrainBody({ e, art }: { e: GuiEvents['colopedia']; art: Art }) {
  const goods = (list: GuiEvents['colopedia']['unattended']) => (
    <dd>
      {list.map((g) => (
        <GoodsAmount key={g.type} keys={g.keys} name={g.name} amount={g.amount} art={art} />
      ))}
    </dd>
  );
  return (
    <div className="terrain">
      <h2>{e.name}</h2>
      <dl>
        <dt>{e.labels.terrainImage}</dt>
        <dd className="terrain-image">
          <Pic keys={e.keys} art={art} />
          {e.forest && <Pic keys={e.forest} art={art} />}
        </dd>
        {e.resources.length > 0 && (
          <>
            <dt>{e.labels.resource}</dt>
            <dd>
              {e.resources.map((r) => (
                <span className="entry" key={r.name}>
                  <Pic keys={r.keys} art={art} />
                  {r.name}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>{e.labels.movementCost}</dt>
        <dd>{e.movementCost}</dd>
        <dt>{e.labels.defenseBonus}</dt>
        <dd>{e.defence}</dd>
        <dt>{e.labels.unattended}</dt>
        {goods(e.unattended)}
        <dt>{e.labels.colonist}</dt>
        {goods(e.colonist)}
        <dt>{e.labels.description}</dt>
        <dd>
          <Text text={e.description} />
        </dd>
      </dl>
    </div>
  );
}

function Body({
  d,
  goTo,
  art,
  string,
  report,
  routes,
  colopedia,
  command,
}: {
  d: Dialog;
  goTo: (at: At) => void;
  art: Art;
  colopedia: (type: string) => void;
  command: (entry: string) => void;
  string: (key: string) => string;
  report: ReportButtons;
  routes: RouteButtons;
}) {
  switch (d.kind) {
    case 'europe':
      return <EuropePanel d={d} art={art} />;
    case 'options':
      return (
        <Panel d={d} title={d.event.title} ok={d.event.ok}>
          {d.event.root && <OptionEditor root={d.event.root} editable={false} />}
        </Panel>
      );
    case 'tradeRoutes':
      return <RoutesPanel d={d} art={art} routes={routes} />;
    case 'confirm':
      return <Confirm d={d} colopedia={colopedia} />;
    case 'choice':
      return <Choice d={d} />;
    case 'input':
      return <Input d={d} />;
    case 'amount':
      return <Amount d={d} art={art} />;
    case 'goods':
      return <Goods d={d} art={art} />;
    case 'warehouse':
      return <Warehouse d={d} art={art} />;
    case 'negotiation':
      return <Negotiation d={d} />;
    case 'names':
      return <Names d={d} />;
    case 'father':
      return <Father d={d} art={art} />;
    case 'endTurn':
      return <EndTurn d={d} pick={(unit) => command(`waiting:${unit}`)} />;
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
    case 'tilePanel':
      return (
        <Panel d={d} ok={d.event.ok} extra={{ label: d.event.colopedia, run: () => colopedia(d.event.type) }}>
          <TileBody e={d.event} art={art} />
        </Panel>
      );
    case 'findSettlement':
      return <FindSettlement d={d} art={art} goTo={goTo} open={command} />;
    case 'workProduction':
      return <WorkProduction d={d} art={art} />;
    case 'colopedia':
      return (
        <Panel d={d} ok={d.event.ok}>
          <TerrainBody e={d.event} art={art} />
        </Panel>
      );
    case 'indianSettlement':
      return (
        <Panel d={d} ok={d.event.ok}>
          <SettlementBody e={d.event} art={art} string={string} />
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
    case 'report':
      return <ReportPanel d={d} e={d.event} art={art} />;
    case 'colony':
      return <ColonyDialog d={d} e={d.event} art={art} />;
  }
}

/**
 * The open dialog, over the page, or nothing. goTo centres the map on a tile, art finds the image for
 * resource keys, string reads a string resource, report is what the turn report's buttons do, routes what
 * the trade routes panel's do.
 */
export function DialogHost({
  dialogs,
  goTo,
  art,
  string = (key) => key,
  report,
  routes,
  colopedia = () => {},
  command = () => {},
}: {
  dialogs: Dialogs;
  goTo: (at: At) => void;
  art: Art;
  /** Open the Colopedia on a tile type. */
  colopedia?: (type: string) => void;
  /** Run a menu entry of the Engine (Commands.menuEntry), as the end turn dialog's pick of a unit does. */
  command?: (entry: string) => void;
  /** A string resource of the Tileset. */
  string?: (key: string) => string;
  report: ReportButtons;
  routes: RouteButtons;
}) {
  const d = useSyncExternalStore(dialogs.subscribe, dialogs.current);
  const under = useSyncExternalStore(dialogs.subscribe, dialogs.under);
  if (!d) return null;
  return (
    <div className="modal">
      {under && (
        <Body
          key={under.id}
          d={under}
          goTo={goTo}
          art={art}
          string={string}
          report={report}
          routes={routes}
          colopedia={colopedia}
          command={command}
        />
      )}
      <Body
        key={d.id}
        d={d}
        goTo={goTo}
        art={art}
        string={string}
        report={report}
        routes={routes}
        colopedia={colopedia}
        command={command}
      />
    </div>
  );
}
