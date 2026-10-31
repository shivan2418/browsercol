// The debug menu: shown in debug mode only (`?debug`), in the side panel.
import { useState } from 'react';
import { GOODS_TYPES, UNIT_TYPES, type DebugRequest } from './debug';

export interface DebugMenuProps {
  /** The tile the pointer selected, or null for none: where units and goods go. */
  at: [number, number] | null;
  /** What the last action answered, or what went wrong. */
  note: string;
  request: (r: DebugRequest) => void;
  /** Skip this many turns with the AI playing. */
  skipTurns: (n: number) => void;
}

export function DebugMenu({ at, note, request, skipTurns }: DebugMenuProps) {
  const [gold, setGold] = useState('1000');
  const [unit, setUnit] = useState(UNIT_TYPES[0]);
  const [goods, setGoods] = useState(GOODS_TYPES[0]);
  const [amount, setAmount] = useState('100');
  const [turns, setTurns] = useState('5');
  const num = (s: string) => Math.trunc(Number(s));
  return (
    <div id="debug">
      <strong>Debug</strong>
      <div>
        <button data-debug="reveal" onClick={() => request({ action: 'revealMap', reveal: true })}>
          Reveal map
        </button>
        <button data-debug="hide" onClick={() => request({ action: 'revealMap', reveal: false })}>
          Hide map
        </button>
        <button data-debug="aiView" onClick={() => request({ action: 'aiView' })}>
          AI view
        </button>
      </div>
      <div>
        <input aria-label="Gold" size={6} value={gold} onChange={(e) => setGold(e.target.value)} />
        <button data-debug="gold" onClick={() => request({ action: 'addGold', amount: num(gold) })}>
          Add gold
        </button>
      </div>
      <div>
        At {at ? `${at[0]},${at[1]}` : 'no tile (click one)'}:
        <div>
          <input aria-label="Unit type" list="debug-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <button
            data-debug="unit"
            disabled={!at}
            onClick={() => at && request({ action: 'addUnit', type: unit, x: at[0], y: at[1] })}
          >
            Add unit
          </button>
        </div>
        <div>
          <input aria-label="Goods type" list="debug-goods" value={goods} onChange={(e) => setGoods(e.target.value)} />
          <input aria-label="Amount" size={5} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button
            data-debug="goods"
            disabled={!at}
            onClick={() => at && request({ action: 'addGoods', type: goods, amount: num(amount), x: at[0], y: at[1] })}
          >
            Add goods to colony
          </button>
        </div>
      </div>
      <div>
        <input aria-label="Turns" size={4} value={turns} onChange={(e) => setTurns(e.target.value)} />
        <button data-debug="skip" onClick={() => skipTurns(num(turns))}>
          Skip turns (AI plays)
        </button>
      </div>
      <datalist id="debug-units">
        {UNIT_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="debug-goods">
        {GOODS_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <pre id="debug-note">{note}</pre>
    </div>
  );
}
