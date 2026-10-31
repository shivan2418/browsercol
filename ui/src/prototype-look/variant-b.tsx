// PROTOTYPE (#48), throwaway. Look B, "Field kit": nothing covers the map.
// One wide drawer on the right holds everything, switched by tabs (Turn,
// Colony, Europe); a question pops up as a card at the map's bottom edge.
// Dark first, 14px type, goods as icon chips with the figure under the
// icon (like FreeCol's own warehouse, but legible), dense but even spacing.
import type { ReactNode } from 'react';
import type { Show, VariantProps } from './main';
import {
  art,
  choice,
  colony,
  europe,
  GOOD_NAMES,
  goodArt,
  mapStyle,
  money,
  side,
  signed,
  tileBg,
  UNIT_NAMES,
  unitArt,
  type Amount,
} from './data';

const CSS = `
.vb {
  --bg: #0f1216; --panel: #171b21; --raise: #20262e; --raise2: #2a313b; --ink: #e9eef4; --muted: #94a0ae; --line: #2c333d;
  --accent: #f2b33d; --accent-ink: #1b1405; --good: #6fd08c; --bad: #ff7b72; --chip: #232a33;
  --fs-xs: 12px; --fs-s: 13px; --fs: 14px; --fs-l: 17px; --fs-xl: 24px;
  font: var(--fs)/1.4 Inter, 'Segoe UI', 'Noto Sans', system-ui, sans-serif; color: var(--ink);
  font-variant-numeric: tabular-nums;
  display: flex; height: 100%; background: var(--bg);
}
.vb[data-theme=light] {
  --bg: #e9edf1; --panel: #f7f9fb; --raise: #ffffff; --raise2: #eef2f6; --ink: #121820; --muted: #5b6573; --line: #d5dce4;
  --accent: #b86e00; --accent-ink: #fff; --good: #18794e; --bad: #c4321c; --chip: #eef2f6;
}
.vb .map { flex: 1; position: relative; }
.vb .drawer { width: 460px; flex: none; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
.vb .top { padding: 12px 16px 0; display: flex; justify-content: space-between; align-items: baseline; }
.vb .top .year { font-size: var(--fs-l); font-weight: 650; }
.vb .gold { display: flex; gap: 14px; color: var(--muted); }
.vb .gold b { color: var(--ink); }
.vb .tabs { display: flex; gap: 2px; padding: 10px 12px 0; border-bottom: 1px solid var(--line); }
.vb .tabs button { font: inherit; font-weight: 600; color: var(--muted); background: none; border: 0; border-bottom: 3px solid transparent; padding: 8px 12px; cursor: pointer; }
.vb .tabs button.on { color: var(--ink); border-bottom-color: var(--accent); }
.vb .pane { flex: 1; overflow: auto; padding: 14px 16px 70px; display: flex; flex-direction: column; gap: 16px; }
.vb .card { background: var(--raise); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
.vb .h { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; margin: 0 0 8px; display: flex; justify-content: space-between; }
.vb .muted { color: var(--muted); }
.vb .btn { font: inherit; font-weight: 600; color: var(--ink); background: var(--raise2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; justify-content: space-between; }
.vb .btn:hover { border-color: var(--accent); }
.vb .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.vb kbd { font: 700 11px/1 ui-monospace, monospace; color: var(--muted); background: var(--panel); border-radius: 4px; padding: 3px 5px; }
.vb .btn.primary kbd { background: rgb(0 0 0 / 18%); color: inherit; }
.vb .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.vb .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.vb .unit { display: flex; gap: 12px; align-items: center; }
.vb .unit img { height: 56px; }
.vb .unit .name { font-size: var(--fs-l); font-weight: 650; }

.vb .chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; }
.vb .chip { background: var(--chip); border-radius: 8px; padding: 6px 2px 5px; text-align: center; position: relative; }
.vb .chip img { width: 32px; height: 32px; display: block; margin: 0 auto 2px; }
.vb .chip .n { font-weight: 700; font-size: var(--fs); display: block; }
.vb .chip .d { font-size: var(--fs-xs); font-weight: 600; }
.vb .chip.zero { opacity: .38; }
.vb .chip .cap { position: absolute; left: 6px; right: 6px; bottom: 0; height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
.vb .chip .cap i { display: block; height: 100%; background: var(--muted); }
.vb .chip.full .cap i { background: var(--bad); }
.vb .pos { color: var(--good); } .vb .neg { color: var(--bad); }
.vb .pill { display: inline-flex; gap: 3px; align-items: center; background: var(--chip); border-radius: 999px; padding: 2px 8px 2px 3px; font-weight: 700; white-space: nowrap; }
.vb .pill img { width: 22px; height: 22px; }
.vb .meter { height: 10px; border-radius: 5px; background: var(--chip); overflow: hidden; display: flex; }
.vb .meter i { display: block; height: 100%; }

.vb .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.vb .tile { aspect-ratio: 1.5; border-radius: 8px; background-size: cover; background-position: center; position: relative; display: flex; align-items: end; justify-content: center; padding-bottom: 4px; }
.vb .tile.centre { outline: 2px solid var(--accent); }
.vb .tile.owned { filter: grayscale(.8) brightness(.6); }
.vb .tile .who { position: absolute; left: 4px; top: 2px; height: 36px; }
.vb .tile .pill { background: rgb(10 12 16 / 78%); color: #fff; }
.vb .blist { display: flex; flex-direction: column; }
.vb .brow { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); }
.vb .brow:first-child { border-top: 0; }
.vb .brow > img { width: 52px; height: 36px; object-fit: contain; }
.vb .brow .w img { height: 30px; margin-right: -6px; }
.vb .brow .w .slot { display: inline-block; width: 14px; height: 24px; border-radius: 3px; background: var(--chip); margin-left: 8px; vertical-align: bottom; }
.vb .brow .name { font-weight: 600; }
.vb .flow { display: flex; gap: 4px; align-items: center; }

.vb .ask { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(560px, calc(100% - 32px)); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 50px rgb(0 0 0 / 55%); padding: 16px; display: grid; grid-template-columns: auto 1fr; gap: 14px; }
.vb .ask h2 { margin: 0 0 4px; font-size: var(--fs-l); }
.vb .ask p { margin: 0; color: var(--muted); }
.vb .ask .opts { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.vb .ask .opts .btn { flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; }
.vb .ask .opts .btn small { font-weight: 400; color: var(--muted); font-size: var(--fs-s); }
.vb .ask .opts .btn.primary small { color: inherit; opacity: .8; }

.vb table { border-collapse: collapse; width: 100%; }
.vb td, .vb th { padding: 5px 6px; text-align: right; }
.vb th { font-size: var(--fs-xs); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.vb td:first-child, .vb th:first-child { text-align: left; }
.vb tbody tr:nth-child(odd) { background: var(--chip); }
.vb tbody td:first-child { border-radius: 6px 0 0 6px; } .vb tbody td:last-child { border-radius: 0 6px 6px 0; }
.vb .gname { display: flex; gap: 8px; align-items: center; }
.vb .gname img { width: 24px; height: 24px; }
.vb .people { display: flex; flex-wrap: wrap; gap: 6px; }
.vb .person { display: flex; flex-direction: column; align-items: center; width: 84px; background: var(--chip); border-radius: 8px; padding: 6px 4px; text-align: center; font-size: var(--fs-s); line-height: 1.2; }
.vb .person img { height: 44px; }
.vb .person b { color: var(--accent); }
`;

const Pill = ({ a: [g, n] }: { a: Amount }) => (
  <span className="pill" title={GOOD_NAMES[g]}>
    <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
    {n}
  </span>
);

function Header() {
  return (
    <div className="top">
      <div>
        <span className="year">{side.year}</span> <span className="muted">· turn {side.turn}</span>
      </div>
      <div className="gold">
        <span>
          <b>{money(side.gold)}</b> gold
        </span>
        <span>
          tax <b>{side.tax}%</b>
        </span>
      </div>
    </div>
  );
}

function Turn() {
  return (
    <>
      <div className="card">
        <div className="unit">
          <img src={unitArt(side.unit.img)} alt="" />
          <div style={{ flex: 1 }}>
            <div className="name">{side.unit.name}</div>
            <div className="muted">{side.unit.detail}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 12 }}>
              MOVES
            </div>
            <b style={{ fontSize: 20 }}>{side.unit.moves}</b>
          </div>
        </div>
        <div className="grid3" style={{ marginTop: 10 }}>
          {side.orders.map(([o, k]) => (
            <button key={o} className="btn">
              {o} <kbd>{k}</kbd>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Under the pointer</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b>{side.tile.name}</b>
            <div className="muted">{side.tile.owner}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {side.tile.produce.map((a) => (
              <Pill key={a[0]} a={a} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid2">
        <button className="btn">
          Next unit <kbd>W</kbd>
        </button>
        <button className="btn">
          Build colony <kbd>B</kbd>
        </button>
        <button className="btn primary" style={{ gridColumn: '1 / -1' }}>
          End turn <kbd>Enter</kbd>
        </button>
      </div>
      <div className="card">
        <div className="h">
          <span>Saved games</span>
          <span>Save · Import</span>
        </div>
        {side.saves.map((s) => (
          <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>
              <b>{s.name}</b> <span className="muted">· turn {s.turn}</span>
            </span>
            <span className="muted">{s.when}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Colony() {
  const c = colony;
  const net = c.food.made - c.food.eaten - c.food.horses;
  const [h, hMax] = c.building.hammers;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 24, fontWeight: 700 }}>{c.name}</span>
        <span className="muted">pop {c.population}</span>
      </div>
      <div className="card">
        <div className="h">
          <span>Rebels {c.rebels}%</span>
          <span>Royalists {c.tories}%</span>
        </div>
        <div className="meter">
          <i style={{ width: `${c.rebels}%`, background: 'var(--accent)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <span>
            Food <b className="pos">{signed(net)}</b> <span className="muted">({c.food.made} made, {c.food.eaten} eaten)</span>
          </span>
          <span className="muted">
            {c.food.toGrowth[0]}/{c.food.toGrowth[1]} to grow
          </span>
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Warehouse</span>
          <span>cap {c.capacity}</span>
        </div>
        <div className="chips">
          {c.warehouse.map(([g, n, d]) => (
            <div key={g} className={`chip ${n === 0 && d === 0 ? 'zero' : ''} ${n > c.capacity ? 'full' : ''}`} title={GOOD_NAMES[g]}>
              <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
              <span className="n">{n}</span>
              <span className={`d ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`}>{signed(d)}</span>
              <span className="cap">
                <i style={{ width: `${Math.min(100, n)}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Tiles</span>
        </div>
        <div className="tiles">
          {c.tiles.map((t, i) => (
            <div
              key={i}
              className={`tile ${t.centre ? 'centre' : ''} ${t.owned ? 'owned' : ''}`}
              style={{ background: tileBg(t) }}
              title={t.name}
            >
              {t.worker && <img className="who" src={unitArt(t.worker)} alt={UNIT_NAMES[t.worker]} />}
              <span style={{ display: 'flex', gap: 3 }}>
                {t.produce.map((a) => (
                  <Pill key={a[0]} a={a} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Buildings</span>
        </div>
        <div className="blist">
          {c.buildings.map((b) => (
            <div key={b.name} className="brow">
              <img src={art(`b-${b.img}`)} alt="" />
              <div>
                <div className="name">{b.name}</div>
                <div className="w">
                  {b.workers.map((w, i) => (
                    <img key={i} src={unitArt(w)} alt={UNIT_NAMES[w]} title={UNIT_NAMES[w]} />
                  ))}
                  {Array.from({ length: b.slots - b.workers.length }, (_, i) => (
                    <span key={i} className="slot" />
                  ))}
                  {b.note && <span className="muted">{b.note}</span>}
                </div>
              </div>
              <div className="flow">
                {b.in?.map((a) => (
                  <Pill key={a[0]} a={a} />
                ))}
                {b.in && <span className="muted">→</span>}
                {b.out.map((a) => (
                  <Pill key={a[0]} a={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Building {c.building.name}</span>
          <span>{c.building.turns} turns</span>
        </div>
        <div className="meter">
          <i style={{ width: `${(100 * h) / hMax}%`, background: 'var(--accent)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <Pill a={['hammers', h]} />
          <span className="muted">of {hMax}</span>
          <Pill a={['tools', c.building.tools[0]]} />
          <span className="muted">of {c.building.tools[1]}</span>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            next: {c.queue[0]}
          </span>
        </div>
      </div>
    </>
  );
}

function Europe() {
  const e = europe;
  return (
    <>
      <div className="card">
        <div className="h">
          <span>Market</span>
          <span>sell / buy</span>
        </div>
        <div className="chips" style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}>
          {e.market.map(([g, s, b, t]) => (
            <div key={g} className="chip" title={GOOD_NAMES[g]}>
              <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
              <span className="n">
                {s}/{b}
              </span>
              {t !== 0 && <span className={`d ${t > 0 ? 'pos' : 'neg'}`}>{t > 0 ? '▲' : '▼'}</span>}
            </div>
          ))}
        </div>
      </div>
      {e.ships.map((s) => (
        <div key={s.name} className="card">
          <div className="unit">
            <img src={unitArt(s.img)} alt="" style={{ height: 48 }} />
            <div style={{ flex: 1 }}>
              <b>{s.name}</b>
              <div className="muted">{s.state}</div>
            </div>
            <span className="muted">
              {s.cargo.length + s.units.length}/{s.holds}
            </span>
          </div>
          {(s.cargo.length > 0 || s.units.length > 0) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              {s.cargo.map((a) => (
                <Pill key={a[0]} a={a} />
              ))}
              {s.units.map((u) => (
                <img key={u} src={unitArt(u)} alt={UNIT_NAMES[u]} title={UNIT_NAMES[u]} style={{ height: 34 }} />
              ))}
              <button className="btn primary" style={{ marginLeft: 'auto' }}>
                Sail
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="card">
        <div className="h">
          <span>Docks</span>
        </div>
        <div className="people">
          {e.docks.map((u, i) => (
            <div key={i} className="person">
              <img src={unitArt(u)} alt="" />
              {UNIT_NAMES[u]}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h">
          <span>Recruit</span>
          <span>Train</span>
        </div>
        <div className="people">
          {[...e.recruits, ...e.train].map((r, i) => (
            <div key={i} className="person" style={i === e.recruits.length ? { marginLeft: 12 } : undefined}>
              <img src={unitArt(r.unit)} alt="" />
              {UNIT_NAMES[r.unit]}
              <b>{money(r.price)}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Ask({ close }: { close: () => void }) {
  return (
    <div className="ask">
      <img src={art(choice.img)} alt="" style={{ height: 70 }} />
      <div>
        <h2>{choice.title}</h2>
        <p>{choice.text}</p>
      </div>
      <div className="opts">
        {choice.options.map((o, i) => (
          <button key={o.label} className={`btn ${i === 0 ? 'primary' : ''}`} onClick={close}>
            <span>
              {o.label} <kbd>{i + 1}</kbd>
            </span>
            {o.hint && <small>{o.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

const TABS: [Show, string][] = [
  ['none', 'Turn'],
  ['colony', 'New Amsterdam'],
  ['europe', 'Europe'],
];

export function VariantB({ show, theme, open }: VariantProps) {
  // The question floats over the map; the drawer keeps the turn tab under it.
  const tab = show === 'choice' ? 'none' : show;
  let pane: ReactNode = <Turn />;
  if (tab === 'colony') pane = <Colony />;
  if (tab === 'europe') pane = <Europe />;
  return (
    <div className="vb" data-theme={theme}>
      <style>{CSS}</style>
      <div className="map" style={mapStyle}>
        {show === 'choice' && <Ask close={() => open('none')} />}
      </div>
      <aside className="drawer">
        <Header />
        <nav className="tabs">
          {TABS.map(([s, label]) => (
            <button key={s} className={tab === s ? 'on' : ''} onClick={() => open(s)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="pane">{pane}</div>
      </aside>
    </div>
  );
}
