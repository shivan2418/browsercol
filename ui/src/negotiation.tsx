// The negotiation window (#357): a meeting with another European nation, a treaty or a trade, as FreeCol's
// NegotiationDialog asks it but not laid out as Swing's is. Under a lead line and the facts there is the
// relations choice, then what each side gives, each item removable and each column with an "Add:" row whose
// pickers offer only what is valid for that side (the Engine's Negotiation says what that is, and why when
// nothing is). A treaty is read as a sentence before it is sent. An offer made to us is shown first, read-only,
// to accept, reject or counter-propose, which opens the editor filled in with it.
import { useState, type ReactNode } from 'react';
import { EscapeCloses, NumberField, Select } from './controls';
import { Box, Heading } from './frame';
import type { GuiQuestions, TradeItem, TradeKind, TradeOption } from './webgui';

type Ask = GuiQuestions['negotiation']['ask'];
type Answer = NonNullable<GuiQuestions['negotiation']['answer']>;
type Side = 'offer' | 'demand';

/** What an item is called on its row. */
const TAGS: Record<TradeKind, string> = {
  gold: 'Gold',
  stance: 'Relations',
  colony: 'Colony',
  goods: 'Goods',
  incite: 'War',
  unit: 'Unit',
};

/** The button that opens each kind's picker. */
const ADD_LABELS: Partial<Record<TradeKind, string>> = {
  gold: 'Gold',
  colony: 'Colony',
  goods: 'Goods',
  unit: 'Unit',
  incite: 'Declare war on…',
};

/** What a stance means, as the player reads it. FreeCol's own names are the buttons'. */
const STANCE_TEXT: Record<string, string> = {
  CEASE_FIRE: 'Stop fighting for now. Not yet peace.',
  PEACE: 'Neither side attacks the other.',
  ALLIANCE: 'Stand together against common enemies.',
};

const itemText = (i: TradeItem) =>
  i.kind === 'gold' ? `${i.amount} gold` : i.kind === 'incite' ? `Declare war on ${i.text}` : i.text;

const list = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** "A, B and C" of the items on one side, or "nothing". */
const said = (items: TradeItem[]) => (items.length === 0 ? 'nothing' : list(items.map(itemText)));

/** What is being picked to add: the side it is for, its kind, and what has been entered or chosen so far. */
interface Pick {
  side: Side;
  kind: TradeKind;
  amount: number | null;
  key: string;
}

/**
 * The window's content and what Enter and Escape do in it. The caller's frame (panels.tsx) adds the title bar,
 * the Enter key and the close button, which is null while the offer cannot be turned down.
 */
export function useNegotiation(
  ask: Ask,
  done: (answer: Answer | null) => void,
  enterMark: (on: boolean) => { 'data-enter'?: string },
): { content: ReactNode; enter: (() => void) | null; close: (() => void) | null } {
  const offered = ask.version > 0 || ask.context === 'contact';
  /** The server's first offer: our own proposal of peace, which is sent as Swing's Send sends it. */
  const first = ask.context === 'contact' && ask.version === 0;
  const [mode, setMode] = useState<'answer' | 'edit'>(offered ? 'answer' : 'edit');
  const [counter, setCounter] = useState(false);
  const [items, setItems] = useState(ask.items);
  const [pick, setPick] = useState<Pick | null>(null);

  const reply =
    (status: Answer['status'], sent: TradeItem[] = items) =>
    () =>
      done({ status, items: sent });
  const trade = ask.context === 'trade';

  /** Gold that its side cannot pay. */
  const overdrawn = (i: TradeItem) => {
    const limit = i.side === 'offer' ? ask.gold.ours : ask.gold.theirs;
    return i.kind === 'gold' && (i.amount < 1 || (limit !== null && i.amount > limit));
  };
  const problems = items
    .filter(overdrawn)
    .map((i) => `${i.side === 'offer' ? ask.nation : ask.other} cannot pay ${i.amount} gold.`);

  const unique = (kind: TradeKind) => ask.options.some((o) => o.kind === kind && o.unique);
  const add = (item: TradeItem) => {
    setItems([...items.filter((i) => !(unique(item.kind) && i.kind === item.kind)), item]);
    setPick(null);
  };
  const remove = (item: TradeItem) => setItems(items.filter((i) => i !== item));
  const choose = (key: string | null) => {
    const c = ask.options.find((o) => o.kind === 'stance')?.choices.find((x) => x.key === key);
    setItems([
      ...items.filter((i) => i.kind !== 'stance'),
      ...(c ? [{ kind: 'stance' as const, side: null, key: c.key, amount: 0, text: c.text }] : []),
    ]);
  };

  /** The choices of a picker that are still to add. */
  const left = (o: TradeOption) =>
    o.unique
      ? o.choices
      : o.choices.filter((c) => !items.some((i) => i.kind === o.kind && i.side === o.side && i.key === c.key));
  const optionFor = (p: Pick) => ask.options.find((o) => o.kind === p.kind && o.side === p.side);
  const amountError = (p: Pick, o: TradeOption) => {
    const n = p.amount;
    const have = p.side === 'offer' ? ask.gold.ours : ask.gold.theirs;
    const who = p.side === 'offer' ? ask.nation : ask.other;
    if (n === null) return 'Enter an amount.';
    if (!Number.isInteger(n)) return 'Whole gold coins only.';
    if (n < 1) return 'At least 1 gold.';
    if (n > (o.max ?? Infinity))
      return have === null ? `${who} cannot pay that much.` : `${who} only has ${have} gold.`;
    return '';
  };
  const picked = (p: Pick) => {
    const o = optionFor(p);
    if (!o) return null;
    if (o.max !== undefined) {
      return amountError(p, o) === ''
        ? { kind: p.kind, side: p.side, key: '', amount: p.amount ?? 0, text: `Gold ${p.amount}` }
        : null;
    }
    const c = left(o).find((x) => x.key === p.key) ?? left(o)[0];
    return c ? { kind: p.kind, side: p.side, key: c.key, amount: c.amount, text: c.text } : null;
  };
  const addPicked = () => {
    const item = pick && picked(pick);
    if (item) add(item);
  };
  const open = (side: Side, kind: TradeKind) => {
    const o = ask.options.find((x) => x.kind === kind && x.side === side);
    const have = items.find((i) => i.kind === kind && i.side === side);
    const room = side === 'offer' ? ask.gold.ours : (ask.gold.theirs ?? 100);
    setPick(
      pick?.side === side && pick.kind === kind
        ? null
        : { side, kind, amount: have?.amount ?? Math.min(100, room), key: o ? (left(o)[0]?.key ?? '') : '' },
    );
  };

  const who = (side: Side) => (side === 'offer' ? ask.nation : ask.other);
  const treasury = (side: Side) => {
    const g = side === 'offer' ? ask.gold.ours : ask.gold.theirs;
    return g === null ? 'unknown' : `${g} gold`;
  };

  const lead = (title: string, text: string) => (
    <div className="lead">
      <Heading look="title" space="tight">
        {title}
      </Heading>
      <p className="text">{text}</p>
    </div>
  );
  const facts = (
    <div className="facts">
      <span>
        Relations now: <b>{ask.stance.name}</b>
      </span>
      <span>
        Our treasury: <b>{treasury('offer')}</b>
      </span>
      <span>
        {ask.other}'s treasury: <b>{treasury('demand')}</b>
      </span>
    </div>
  );
  const tutorial = ask.tutorial !== null && <p className="text">{ask.tutorial}</p>;

  // ---- Their offer, read-only ----
  if (mode === 'answer') {
    const stance = items.find((i) => i.kind === 'stance');
    const sides = (side: Side, title: string) => {
      const shown = items.filter((i) => i.side === side);
      return (
        <section className="col" aria-label={title} data-side={side}>
          <h4>{title}</h4>
          <ul className="items">
            {shown.length === 0 && <li className="empty">Nothing</li>}
            {shown.map((i) => (
              <li key={`${i.kind}/${i.key}`} data-item={i.kind}>
                <span className="tag">{TAGS[i.kind]}</span>
                <span className="txt">{itemText(i)}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    };
    const cant = items.some((i) => i.side === 'offer' && overdrawn(i));
    const startCounter = () => {
      setMode('edit');
      setCounter(true);
      setPick(null);
    };
    return {
      content: (
        <>
          {first
            ? lead(
                `You have met ${ask.other}. They propose peace.`,
                'Accept peace, or counter-propose with your own terms. This first offer cannot be turned down.',
              )
            : ask.version > 0 && ask.context === 'contact'
              ? lead(`${ask.other} answers your counter-proposal`, 'You can accept, turn it down, or counter again.')
              : lead(
                  `${ask.other} proposes ${trade ? 'a trade' : 'a treaty'}`,
                  'They have sent this offer. You can take it, turn it down, or answer with your own.',
                )}
          {tutorial}
          {facts}
          {ask.context !== 'trade' && (
            <Box as="div" spaced="wide" caption="Relations between us">
              {stance ? (
                <p className="relations">
                  They propose <b>{stance.text}</b>. {STANCE_TEXT[stance.key] ?? ''}
                </p>
              ) : (
                <p className="relations">They do not propose a change in relations.</p>
              )}
            </Box>
          )}
          <div className="cols">
            {sides('offer', 'We would give')}
            {sides('demand', `${ask.other} would give`)}
          </div>
          <div className="buttons">
            <span className="hint">{cant ? 'You cannot afford this.' : ''}</span>
            {!first && (
              <button data-answer="cancel" onClick={reply('reject', ask.items)}>
                Reject offer
              </button>
            )}
            <button data-answer="counter" onClick={startCounter}>
              Counter-propose
            </button>
            {/* The first offer is a proposal of ours that has still to be sent (Swing's Send). */}
            <button
              data-answer={first ? 'send' : 'accept'}
              {...enterMark(true)}
              disabled={cant}
              onClick={first ? reply('propose', ask.items) : reply('accept', ask.items)}
            >
              Accept offer
            </button>
          </div>
        </>
      ),
      enter: cant ? null : first ? reply('propose', ask.items) : reply('accept', ask.items),
      close: ask.cancellable ? reply('reject', ask.items) : null,
    };
  }

  // ---- The editor ----
  const stanceOption = ask.options.find((o) => o.kind === 'stance');
  const stance = items.find((i) => i.kind === 'stance');
  /** A first meeting keeps peace in the treaty: only what is added to it can be changed. */
  const locked = ask.context === 'contact';
  const empty = items.length === 0;
  const hint = problems[0] ?? (empty ? `Add something to the ${trade ? 'trade' : 'treaty'} first.` : '');
  const blocked = problems.length > 0 || empty;
  const send = reply('propose');

  const column = (side: Side) => {
    const title = side === 'offer' ? 'We give' : `${ask.other} gives`;
    const here = items.filter((i) => i.side === side);
    const options = ask.options.filter((o) => o.side === side);
    const buttons = options.filter((o) => (o.max !== undefined ? o.max >= 1 : o.choices.length > 0));
    const why = options.filter((o) => o.empty !== null).map((o) => o.empty);
    const open2 = pick?.side === side ? pick : null;
    return (
      <section className="col" aria-label={title} data-side={side}>
        <h4>{title}</h4>
        <div className="sub">
          {who(side)} treasury: {treasury(side)}
        </div>
        <ul className="items">
          {here.length === 0 && <li className="empty">Nothing yet</li>}
          {here.map((i) => {
            return (
              <li key={`${i.kind}/${i.key}`} data-item={i.kind} className={overdrawn(i) ? 'bad' : undefined}>
                <span className="tag">{TAGS[i.kind]}</span>
                <span className="txt">{itemText(i)}</span>
                <button className="rm" aria-label={`Remove ${itemText(i)}`} onClick={() => remove(i)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {buttons.length > 0 && (
          <div className="adds">
            <span className="cap2">Add:</span>
            {buttons.map((o) => (
              <button
                key={o.kind}
                data-add={o.kind}
                aria-expanded={open2?.kind === o.kind}
                onClick={() => open(side, o.kind)}
              >
                {o.kind === 'gold' && here.some((i) => i.kind === 'gold')
                  ? 'Change gold'
                  : (ADD_LABELS[o.kind] ?? o.label)}
              </button>
            ))}
          </div>
        )}
        {why.map((w) => (
          <p key={w} className="why">
            {w}
          </p>
        ))}
        {open2 && pickerBox(open2)}
      </section>
    );
  };

  /** The picker of what is being added: gold by amount, else one of the choices. */
  const pickerBox = (p: Pick) => {
    const o = optionFor(p);
    if (!o) return null;
    const other = items.find((i) => i.kind === p.kind && o.unique && i.side !== p.side);
    const choices = left(o);
    const error = o.max !== undefined ? amountError(p, o) : '';
    const item = picked(p);
    const replaces = other && (
      <span className="full why">
        Only one {o.label.toLowerCase()} can be in a treaty: this replaces {itemText(other)}.
      </span>
    );
    return (
      <div className="picker" data-picker={p.kind}>
        <EscapeCloses close={() => setPick(null)} />
        {o.max !== undefined ? (
          <>
            <span className="full">
              Gold from {who(p.side)}
              {p.side === 'offer' || ask.gold.theirs !== null
                ? ` (up to ${p.side === 'offer' ? ask.gold.ours : ask.gold.theirs})`
                : ''}
            </span>
            <NumberField
              aria-label="Gold amount"
              min={1}
              max={o.max}
              value={p.amount}
              onChange={(amount) => setPick({ ...p, amount })}
              autoFocus
            />
          </>
        ) : (
          <>
            <span className="full">
              {p.kind === 'colony'
                ? `${who(p.side)}'s colonies`
                : p.kind === 'incite'
                  ? `${who(p.side)} would declare war on…`
                  : p.kind === 'unit'
                    ? `Units ${who(p.side)} can hand over`
                    : `Goods ${who(p.side)} can hand over`}
            </span>
            <Select
              aria-label={o.label}
              value={choices.find((c) => c.key === p.key)?.key ?? choices[0]?.key ?? ''}
              onChange={(key) => setPick({ ...p, key })}
              choices={choices.map((c) => ({ value: c.key, label: c.text }))}
            />
          </>
        )}
        <button data-confirm={p.kind} disabled={item === null} onClick={addPicked}>
          {items.some((i) => i.kind === p.kind && i.side === p.side && o.unique) ? 'Change' : 'Add'}
        </button>
        <button data-cancel={p.kind} onClick={() => setPick(null)}>
          Cancel
        </button>
        {error !== '' && (
          <span className="err" role="alert">
            {error}
          </span>
        )}
        {replaces}
      </div>
    );
  };

  const summary = (
    <p className="summary" aria-live="polite">
      {stance && (
        <>
          Relations become <b>{stance.text}</b>.{' '}
        </>
      )}
      We give <b>{said(items.filter((i) => i.side === 'offer'))}</b>; {ask.other} gives{' '}
      <b>{said(items.filter((i) => i.side === 'demand'))}</b>.
    </p>
  );

  const sendLabel =
    counter || ask.context === 'contact'
      ? 'Send counter-offer'
      : trade
        ? 'Propose trade'
        : ask.context === 'tribute'
          ? 'Make demand'
          : 'Propose treaty';
  const walkAway = ask.cancellable && ask.context !== 'contact';

  return {
    content: (
      <>
        {counter
          ? lead(
              `Your counter-proposal to ${ask.other}`,
              `You are countering ${ask.other}'s offer. Their terms are filled in; change what you like.`,
            )
          : ask.context === 'contact'
            ? lead(`Your counter-proposal to ${ask.other}`, 'Peace stays in the treaty; add what you ask for or offer.')
            : trade
              ? lead(`Trade with ${ask.other}`, 'Swap goods, units or gold.')
              : ask.context === 'tribute'
                ? lead(
                    `Demand of ${ask.other}`,
                    `Say what ${ask.other} is to give. If ${ask.other} agrees, it happens at once.`,
                  )
                : lead(
                    `Treaty with ${ask.other}`,
                    `Say what each side gives. If ${ask.other} agrees, it all happens at once.`,
                  )}
        {tutorial}
        {facts}
        {stanceOption && (
          <Box as="div" spaced="wide" caption="Relations between us">
            <div className="stance" role="group" aria-label="Relations">
              {!locked && (
                <button aria-pressed={stance === undefined} data-stance="" onClick={() => choose(null)}>
                  No change
                  <small>Stay at {ask.stance.name.toLowerCase()}.</small>
                </button>
              )}
              {stanceOption.choices.map((c) => (
                <button
                  key={c.key}
                  aria-pressed={stance?.key === c.key}
                  data-stance={c.key}
                  disabled={locked}
                  onClick={() => choose(c.key)}
                >
                  {c.text}
                  <small>{STANCE_TEXT[c.key]}</small>
                </button>
              ))}
            </div>
            <p className="why">
              To go to war, attack one of their units or colonies. A treaty cannot declare war: it would do exactly what
              an attack does.
            </p>
          </Box>
        )}
        <div className="cols">
          {column('offer')}
          {column('demand')}
        </div>
        {summary}
        <div className="buttons">
          <span className="hint">{hint}</span>
          {counter && (
            <button
              data-answer="back"
              onClick={() => {
                setMode('answer');
                setCounter(false);
                setItems(ask.items);
                setPick(null);
              }}
            >
              Back to their offer
            </button>
          )}
          {walkAway && (
            <button data-answer="cancel" onClick={reply('reject')}>
              {trade ? 'Leave the trade' : 'Walk away'}
            </button>
          )}
          <button data-answer="send" {...enterMark(true)} disabled={blocked} onClick={send}>
            {sendLabel}
          </button>
        </div>
      </>
    ),
    // Enter adds what is being picked, else sends.
    enter: pick ? (picked(pick) ? addPicked : null) : blocked ? null : send,
    close: ask.cancellable ? reply('reject') : null,
  };
}
