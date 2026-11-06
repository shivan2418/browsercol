// THROWAWAY PROTOTYPE (branch prototype/cargo-holds, never main): what a carrier's cargo hold could look like,
// inspired by the 1994 Mac Colonization's hold slots, in this project's FreeCol art and theme tokens. Four
// variants that differ in structure, each drawn in the colony panel's cargo box, the Europe docks' cargo box and
// the info panel. Read-only: nothing drags.
//
// The view does not send a carrier's capacity, only the holds left inside the cargo title ("Cargo on Caravel
// (1 hold left)", cargoPanel.cargoAndSpace). The sample loads carry it hard-coded; the real one needs the Engine
// to send `space` (Unit.getCargoCapacity) beside `spaceLeft`.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Box, type Art } from './frame';

// ---------------------------------------------------------------------------------------------------- the data

export type Cargo =
  | { kind: 'goods'; type: string; name: string; amount: number; keys: string[] }
  | { kind: 'unit'; name: string; keys: string[] };

export interface Load {
  /** The carrier's name and picture. */
  name: string;
  keys: string[];
  /** Holds in all: NOT in the view today (see the header). */
  capacity: number;
  /** What is aboard, one entry per hold taken: units first, then goods stacks of at most 100. */
  cargo: Cargo[];
  /** The info panel's status line. */
  status: string;
  wagon?: boolean;
}

const unitKeys = (k: string) => [`image.unit.model.unit.${k}`];
const goods = (type: string, name: string, amount: number): Cargo => ({
  kind: 'goods',
  type,
  name,
  amount,
  keys: [`image.icon.model.goods.${type}`],
});
const unit = (k: string, name: string): Cargo => ({ kind: 'unit', name, keys: unitKeys(k) });

export const LOADS: Load[] = [
  { name: 'Galleon', keys: unitKeys('galleon'), capacity: 6, cargo: [], status: 'Moves: 6' },
  {
    name: 'Merchantman',
    keys: unitKeys('merchantman'),
    capacity: 4,
    cargo: [unit('freeColonist', 'Free Colonist'), goods('furs', 'Furs', 100), goods('sugar', 'Sugar', 37)],
    status: 'Moves: 5',
  },
  {
    name: 'Caravel',
    keys: unitKeys('caravel'),
    capacity: 2,
    cargo: [goods('muskets', 'Muskets', 100), goods('horses', 'Horses', 100)],
    status: 'Moves: 4',
  },
  {
    name: 'Wagon Train',
    keys: unitKeys('wagonTrain'),
    capacity: 2,
    cargo: [goods('cigars', 'Cigars', 100), goods('cloth', 'Cloth', 45)],
    status: 'Moves: 1',
    wagon: true,
  },
];

const left = (l: Load) => l.capacity - l.cargo.length;
/** FreeCol's cargoPanel.cargoAndSpace, as the view sends it. */
export const cargoTitle = (l: Load) => `Cargo on ${l.name} (${left(l)} ${left(l) === 1 ? 'hold' : 'holds'} left)`;

export type Context = 'colony' | 'europe' | 'info';

// ------------------------------------------------------------------------------------------------ the variants

interface HoldProps {
  load: Load;
  art: Art;
  context: Context;
}

function Pic({ keys, art, alt, className }: { keys: string[]; art: Art; alt: string; className?: string }) {
  const src = art(keys);
  return src ? <img src={src} alt={alt} className={className} draggable={false} /> : <span>{alt}</span>;
}

/** The holds in order: what is aboard, then null for each empty one. */
const slots = (l: Load): (Cargo | null)[] => [...l.cargo, ...Array<null>(Math.max(0, left(l))).fill(null)];

/** A: one square bevelled wooden slot per hold, in a fixed row; empty holds are dark recesses. */
function Slots({ load, art, context }: HoldProps) {
  return (
    <div className="ch-slots" data-context={context} role="list" aria-label={cargoTitle(load)}>
      {slots(load).map((c, i) =>
        c ? (
          <div key={i} className="ch-slot" data-kind={c.kind} role="listitem" title={c.name}>
            <Pic keys={c.keys} art={art} alt={c.name} />
            {c.kind === 'goods' && <b className="ch-amt">{c.amount}</b>}
          </div>
        ) : (
          <div key={i} className="ch-slot" data-empty="" role="listitem" title="Empty hold" />
        ),
      )}
    </div>
  );
}

/**
 * B: a manifest, one line per hold taken, with a bar for how full its stack is out of 100; the empty holds
 * fold into one line of hollow squares, so an empty galleon is one line, not six.
 */
function Manifest({ load, art, context }: HoldProps) {
  const empty = left(load);
  return (
    <div className="ch-manifest" data-context={context}>
      {load.cargo.map((c, i) => (
        <div key={i} className="ch-line" data-kind={c.kind} title={c.name}>
          <span className="ch-icon">
            <Pic keys={c.keys} art={art} alt={c.name} />
          </span>
          <span className="ch-name">{c.name}</span>
          {c.kind === 'goods' ? (
            <>
              <span className="ch-bar" aria-hidden>
                <i style={{ width: `${c.amount}%` }} />
              </span>
              <b className="ch-num">{c.amount}</b>
            </>
          ) : (
            <span className="ch-passenger">passenger</span>
          )}
        </div>
      ))}
      {empty > 0 && (
        <div className="ch-line ch-free">
          <span className="ch-pips" aria-hidden>
            {Array.from({ length: empty }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <span className="ch-name">
            {empty} empty {empty === 1 ? 'hold' : 'holds'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * C: a cutaway of the hull from the side, with a compartment per hold between bulkheads; a wagon train's bed
 * sits on two wheels instead.
 */
function Cutaway({ load, art, context }: HoldProps) {
  const n = load.capacity;
  const W = 100; // one compartment, in viewBox units
  const stern = 14;
  const bow = load.wagon ? 34 : 70;
  const total = stern + n * W + bow;
  const H = load.wagon ? 118 : 110;
  const x0 = stern;
  const x1 = stern + n * W;
  // The hold's interior: deck at y 22, floor at y 86.
  const top = 22;
  const floor = 86;
  const hull = load.wagon
    ? `M ${x0 - 8} ${top - 6} H ${x1 + 8} V ${floor + 6} H ${x0 - 8} Z`
    : `M 0 ${top - 12} L ${x0} ${top - 4} H ${x1} L ${total} ${top - 18} ` +
      `C ${total - 18} ${floor - 10}, ${x1 + 10} ${floor + 20}, ${x1 - 30} ${floor + 16} ` +
      `H ${x0 + 30} C ${x0 + 6} ${floor + 16}, 2 ${floor}, 0 ${top - 12} Z`;
  return (
    <div
      className="ch-cutaway"
      data-context={context}
      style={{ '--ratio': `${total} / ${H}` } as CSSProperties}
      role="list"
      aria-label={cargoTitle(load)}
    >
      <svg viewBox={`0 0 ${total} ${H}`} preserveAspectRatio="none" aria-hidden>
        {load.wagon ? (
          <>
            <path className="ch-tongue" d={`M ${x1 + 8} ${floor - 6} L ${total} ${floor + 4}`} />
            <path className="ch-hull" d={hull} />
            {[x0 + 40, x1 - 40].map((cx) => (
              <g key={cx}>
                <circle className="ch-wheel" cx={cx} cy={floor + 12} r={18} />
                <circle className="ch-hub" cx={cx} cy={floor + 12} r={5} />
              </g>
            ))}
          </>
        ) : (
          <>
            <path className="ch-water" d={`M 0 ${floor + 6} H ${total}`} />
            <path className="ch-hull" d={hull} />
          </>
        )}
        <rect className="ch-inside" x={x0} y={top} width={n * W} height={floor - top} />
        {Array.from({ length: n - 1 }, (_, i) => (
          <path key={i} className="ch-bulkhead" d={`M ${x0 + (i + 1) * W} ${top} V ${floor}`} />
        ))}
        <path className="ch-deck" d={`M ${x0 - (load.wagon ? 8 : 0)} ${top} H ${x1 + (load.wagon ? 8 : 0)}`} />
      </svg>
      <div
        className="ch-rooms"
        style={{
          left: `${(x0 / total) * 100}%`,
          width: `${((n * W) / total) * 100}%`,
          top: `${(top / H) * 100}%`,
          height: `${((floor - top) / H) * 100}%`,
          gridTemplateColumns: `repeat(${n}, 1fr)`,
        }}
      >
        {slots(load).map((c, i) => (
          <div key={i} className="ch-room" data-kind={c?.kind} data-empty={c ? undefined : ''} role="listitem">
            {c && <Pic keys={c.keys} art={art} alt={c.name} />}
            {c?.kind === 'goods' && <b className="ch-amt">{c.amount}</b>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * D: a compact strip: a round pip per hold with the goods or unit as a mini icon in it, its ring a gauge of the
 * amount out of 100 (the number is in the tooltip), then holds used out of all. Meant for the info panel; drawn
 * the same in the bigger boxes.
 */
function Strip({ load, art, context }: HoldProps) {
  return (
    <div className="ch-strip" data-context={context} aria-label={cargoTitle(load)}>
      <span className="ch-pipsrow">
        {slots(load).map((c, i) => (
          <span
            key={i}
            className="ch-pip"
            data-kind={c?.kind}
            data-empty={c ? undefined : ''}
            title={c ? (c.kind === 'goods' ? `${c.amount} ${c.name}` : c.name) : 'Empty hold'}
            style={{ '--fill': c?.kind === 'goods' ? c.amount : 100 } as CSSProperties}
          >
            <span>{c && <Pic keys={c.keys} art={art} alt={c.name} />}</span>
          </span>
        ))}
      </span>
      <span className="ch-count">
        {load.cargo.length}/{load.capacity}
      </span>
    </div>
  );
}

export const VARIANTS = [
  {
    id: 'slots',
    label: 'A · Hold slots',
    note: 'A fixed row of bevelled wooden slots, one per hold, as on the Mac',
    Hold: Slots,
  },
  {
    id: 'manifest',
    label: 'B · Manifest',
    note: 'A line per hold with a fill bar out of 100; empty holds fold into one line',
    Hold: Manifest,
  },
  {
    id: 'cutaway',
    label: 'C · Cutaway',
    note: "The hull from the side, a compartment per hold; a wagon's bed on wheels",
    Hold: Cutaway,
  },
  {
    id: 'strip',
    label: 'D · Pip strip',
    note: 'A compact strip of round pips; each ring fills with the amount out of 100; then used/all',
    Hold: Strip,
  },
] as const;

export type VariantId = (typeof VARIANTS)[number]['id'];

// ------------------------------------------------------------------------------------------------ the contexts

type FrameProps = { load: Load; art: Art; children: ReactNode };

/** The colony panel's cargo box: 400 px wide under the right column, captioned with the title. */
function InColony({ load, children }: FrameProps) {
  return (
    <div className="colony" style={{ width: 400 }}>
      <Box caption={cargoTitle(load)} className="cargo" data-part="cargo">
        {children}
      </Box>
    </div>
  );
}

/** The Europe panel's cargo box: a cell of its grid, 429 x 182 at the screen's usual size. */
function InEurope({ load, children }: FrameProps) {
  return (
    <div className="europe" style={{ display: 'block', width: 429 }}>
      <section className="box cargo" data-list="cargo" style={{ height: 182, boxSizing: 'border-box' }}>
        <h3>{cargoTitle(load)}</h3>
        {children}
      </section>
    </div>
  );
}

/** The info panel in the map's bottom-right corner, unskinned (the art build has no image.skin.InfoPanel yet). */
function InInfo({ load, art, children }: FrameProps) {
  const src = art(load.keys);
  return (
    <div style={{ position: 'relative', width: 310, height: 170, '--info-panel-w': '310px' } as CSSProperties}>
      <section id="info-panel" className="info-unit" aria-label="Information">
        <div className="info-picture">{src && <img src={src} alt="" />}</div>
        <div className="info-text">
          <p className="info-label">{load.name}</p>
          <p className="info-moves">{load.status}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

const CONTEXTS: { id: Context; label: string; Frame: (p: FrameProps) => ReactNode }[] = [
  { id: 'colony', label: 'Colony panel: cargo box', Frame: InColony },
  { id: 'europe', label: 'Europe: cargo box on the docks', Frame: InEurope },
  { id: 'info', label: 'Info panel, bottom right of the map', Frame: InInfo },
];

// ------------------------------------------------------------------------------------------------ the page

export function CargoHoldPrototype({
  variant,
  context,
  setVariant,
  art,
}: {
  variant: VariantId;
  context: Context | 'all';
  setVariant: (v: VariantId) => void;
  art: Art;
}) {
  // Shown at once, and kept in the arg (which round-trips through Storybook's channel) as well.
  const [shown, setShown] = useState(variant);
  useEffect(() => setShown(variant), [variant]);
  const current = useRef(shown);
  current.current = shown;
  const at = Math.max(
    0,
    VARIANTS.findIndex((v) => v.id === shown),
  );
  const v = VARIANTS[at];
  const step = (d: number) => {
    const i = VARIANTS.findIndex((x) => x.id === current.current);
    const next = VARIANTS[(Math.max(0, i) + d + VARIANTS.length) % VARIANTS.length].id;
    current.current = next;
    setShown(next);
    setVariant(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const Hold = v.Hold;
  return (
    <div className="ch-page">
      <style>{CSS}</style>
      {CONTEXTS.filter((c) => context === 'all' || c.id === context).map(({ id, label, Frame }) => (
        <section key={id} className="ch-context" data-context={id}>
          <h2>{label}</h2>
          <div className="ch-row">
            {LOADS.map((l) => (
              <Frame key={l.name} load={l} art={art}>
                <Hold load={l} art={art} context={id} />
              </Frame>
            ))}
          </div>
        </section>
      ))}
      <nav className="ch-switch" aria-label="Variant">
        <button onClick={() => step(-1)} aria-label="Previous variant">
          ←
        </button>
        <span>
          <b>{v.label}</b>
          <small>{v.note}</small>
        </span>
        <button onClick={() => step(1)} aria-label="Next variant">
          →
        </button>
      </nav>
    </div>
  );
}

// The prototype's own styles, all from the theme's tokens.
const CSS = `
.ch-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 16px 20px 110px;
  background: var(--page);
  font-family: var(--font);
  font-size: var(--fs);
  color: var(--ink);
}
.ch-context {
  margin-bottom: 18px;
}
.ch-context h2 {
  margin: 0 0 6px;
  font-size: var(--fs-s);
  font-weight: 700;
  color: var(--menubar-ink);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.ch-row .colony .cargo {
  min-height: 52px;
}
.ch-row .colony .cargo > :not(.cap) {
  flex: 1 1 100%;
}
.ch-row .colony .cargo > .ch-cutaway {
  flex: 0 1 auto;
}
.ch-row .europe .cargo h3 {
  font-size: var(--fs);
  color: var(--head);
}
.ch-row #info-panel {
  background-color: var(--panel);
}
.ch-switch {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  background: var(--menubar);
  color: var(--menubar-ink);
  border: 2px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 6px 18px var(--backdrop);
}
.ch-switch span {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 340px;
  text-align: center;
}
.ch-switch small {
  font-size: 12px;
  opacity: 0.8;
}
.ch-switch button {
  font: inherit;
  font-size: 20px;
  line-height: 1;
  width: 36px;
  height: 32px;
  background: var(--btn);
  color: var(--btn-ink);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
}

/* ---- A: hold slots ---- */
.ch-slots {
  --slot: 46px;
  display: inline-flex;
  flex: 0 0 auto !important;
  gap: 4px;
  padding: 4px;
  width: max-content;
  background: var(--head);
  border-radius: 3px;
  box-shadow:
    inset 1px 1px 0 color-mix(in srgb, var(--btn) 60%, transparent),
    inset -1px -1px 0 color-mix(in srgb, var(--ink) 70%, transparent);
}
.ch-slots[data-context='europe'] {
  --slot: 58px;
  margin-top: 6px;
}
.ch-slots[data-context='info'] {
  --slot: 30px;
  gap: 2px;
  padding: 2px;
  margin-top: 4px;
}
.ch-slot {
  position: relative;
  box-sizing: border-box;
  width: var(--slot);
  height: var(--slot);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--btn);
  border: 2px solid;
  border-color: color-mix(in srgb, var(--btn) 55%, white) color-mix(in srgb, var(--btn) 45%, black)
    color-mix(in srgb, var(--btn) 45%, black) color-mix(in srgb, var(--btn) 55%, white);
}
.ch-slot img {
  max-width: 78%;
  max-height: 70%;
  object-fit: contain;
  image-rendering: pixelated;
}
.ch-slot[data-kind='goods'] img {
  height: 52%;
  width: auto;
  margin-bottom: 22%;
}
.ch-slot[data-kind='unit'] img {
  max-height: 92%;
}
.ch-slot[data-empty] {
  background: color-mix(in srgb, var(--head) 55%, black);
  border-color: color-mix(in srgb, var(--head) 40%, black) color-mix(in srgb, var(--head) 80%, white)
    color-mix(in srgb, var(--head) 80%, white) color-mix(in srgb, var(--head) 40%, black);
  box-shadow: inset 2px 2px 4px rgb(0 0 0 / 45%);
}
.ch-amt {
  position: absolute;
  right: 2px;
  bottom: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--btn-ink);
}
.ch-slots[data-context='europe'] .ch-amt {
  font-size: 13px;
}
.ch-slots[data-context='info'] .ch-amt {
  font-size: 9px;
  right: 1px;
}

/* ---- B: manifest ---- */
.ch-manifest {
  display: grid;
  gap: 2px;
  width: 100%;
}
.ch-manifest[data-context='colony'] {
  grid-template-columns: 1fr 1fr;
  gap: 2px 10px;
}
.ch-line {
  display: grid;
  grid-template-columns: 26px 1fr 1fr 30px;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 4px;
  border-bottom: 1px dotted var(--line);
  font-size: var(--fs-s);
}
.ch-manifest[data-context='info'] .ch-line {
  grid-template-columns: 18px 1fr 1fr 24px;
  height: 18px;
  gap: 4px;
  font-size: 11px;
}
.ch-manifest[data-context='colony'] .ch-line {
  grid-template-columns: 22px 1fr 40px 26px;
  height: 22px;
  gap: 4px;
}
.ch-icon {
  display: flex;
  justify-content: center;
  align-self: stretch;
  min-height: 0;
  overflow: hidden;
}
.ch-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.ch-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-bar {
  height: 8px;
  background: color-mix(in srgb, var(--line) 25%, var(--box));
  border: 1px solid var(--line);
}
.ch-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
}
.ch-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ch-passenger {
  grid-column: span 2;
  font-style: italic;
  color: var(--muted);
}
.ch-free {
  grid-template-columns: auto 1fr !important;
  color: var(--muted);
  border-bottom: 0;
}
.ch-manifest[data-context='colony'] .ch-free {
  grid-column: 1 / -1;
}
.ch-pips {
  display: flex;
  gap: 3px;
}
.ch-pips i {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--line);
  border-radius: 1px;
}

/* ---- C: cutaway ---- */
.ch-cutaway {
  position: relative;
  aspect-ratio: var(--ratio);
  max-width: 100%;
  height: var(--hull-h);
  max-height: var(--hull-h);
  --hull-h: 72px;
}
.ch-cutaway[data-context='europe'] {
  --hull-h: 130px;
  margin: 4px auto 0;
}
.ch-cutaway[data-context='info'] {
  --hull-h: 52px;
  margin-top: 4px;
}
.ch-cutaway svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.ch-hull {
  fill: var(--head);
  stroke: color-mix(in srgb, var(--head) 60%, black);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.ch-inside {
  fill: color-mix(in srgb, var(--head) 45%, black);
}
.ch-bulkhead {
  stroke: var(--btn);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}
.ch-deck {
  stroke: var(--btn);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}
.ch-water {
  stroke: var(--link);
  stroke-width: 2;
  stroke-dasharray: 6 4;
  vector-effect: non-scaling-stroke;
  opacity: 0.6;
}
.ch-wheel {
  fill: var(--btn);
  stroke: color-mix(in srgb, var(--head) 60%, black);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.ch-hub {
  fill: var(--head);
}
.ch-tongue {
  stroke: var(--head);
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
}
.ch-rooms {
  position: absolute;
  display: grid;
}
.ch-room {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  min-height: 0;
  margin: 0 2px;
  padding: 2px 0 1px;
  overflow: hidden;
}
/* A taken compartment is lit: pale planking behind the goods; an empty one stays dark. */
.ch-room:not([data-empty]) {
  background: linear-gradient(color-mix(in srgb, var(--btn) 70%, var(--head)), var(--btn));
}
.ch-room img {
  flex: 1 1 auto;
  min-height: 0;
  max-width: 90%;
  object-fit: contain;
}
.ch-room .ch-amt {
  position: static;
  flex: none;
  font-size: 11px;
}
.ch-cutaway[data-context='europe'] .ch-amt {
  font-size: 13px;
}
.ch-cutaway[data-context='info'] .ch-amt {
  font-size: 9px;
}

/* ---- D: pip strip ---- */
.ch-strip {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ch-strip[data-context='info'] {
  margin-top: 4px;
}
.ch-strip[data-context='europe'] {
  margin-top: 6px;
}
.ch-pipsrow {
  display: inline-flex;
  gap: 3px;
}
.ch-pip {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 3px;
  border-radius: 50%;
  /* The ring is the stack's gauge: how far round it goes is the amount out of 100. */
  background: conic-gradient(var(--accent) calc(var(--fill) * 1%), color-mix(in srgb, var(--line) 35%, transparent) 0);
}
.ch-pip[data-kind='unit'] {
  background: var(--line);
}
.ch-pip > span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--box);
  border-radius: 50%;
  overflow: hidden;
}
.ch-strip[data-context='europe'] .ch-pip {
  width: 40px;
  height: 40px;
  padding: 4px;
}
.ch-strip[data-context='info'] .ch-pip {
  width: 23px;
  height: 23px;
  padding: 2.5px;
}
.ch-strip[data-context='info'] .ch-pipsrow {
  gap: 2px;
}
.ch-pip img {
  max-width: 76%;
  max-height: 76%;
  object-fit: contain;
}
.ch-pip[data-kind='unit'] img {
  max-height: 96%;
  margin-top: 15%;
}
.ch-pip[data-empty] {
  background: none;
  border: 1.5px dashed var(--line);
  opacity: 0.7;
}
.ch-pip[data-empty] > span {
  background: none;
}
.ch-count {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: var(--fs-s);
}
`;
