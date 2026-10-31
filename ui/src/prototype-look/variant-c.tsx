// PROTOTYPE (#48), throwaway. Look C, "Big board": no side column at all.
// The map runs edge to edge under a thin top bar (date, gold) and a bottom
// command bar; the active unit is a floating card. A colony or Europe is a
// full-screen sheet with a "Back to map" bar, laid out as a board you scan
// left to right. High contrast, 17px type, big figures, numbered answers.
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

export const CSS = `
.vc {
  --bg: #000; --sheet: #0b0b0c; --card: #161618; --ink: #fff; --muted: #b9b9c0; --line: #3c3c44; --strong: #fff;
  --accent: #ffd60a; --accent-ink: #000; --good: #4ade80; --bad: #ff6b6b; --bar: rgb(0 0 0 / 82%);
  --fs-s: 15px; --fs: 17px; --fs-l: 21px; --fs-xl: 30px; --fs-num: 26px;
  font: var(--fs)/1.4 system-ui, 'Segoe UI', 'Noto Sans', sans-serif; color: var(--ink);
  font-variant-numeric: tabular-nums;
  height: 100%; position: relative; overflow: hidden; background: var(--bg);
}
.vc[data-theme=light] {
  --bg: #fff; --sheet: #fff; --card: #f2f2f4; --ink: #000; --muted: #45454d; --line: #9a9aa3; --strong: #000;
  --accent: #0040c1; --accent-ink: #fff; --good: #0a7a33; --bad: #c01818; --bar: rgb(255 255 255 / 92%);
}
.vc .map { position: absolute; inset: 0; }
.vc .muted { color: var(--muted); }
.vc .btn { font: inherit; font-weight: 700; color: var(--ink); background: var(--card); border: 2px solid var(--line); border-radius: 10px; padding: 10px 16px; cursor: pointer; display: inline-flex; gap: 10px; align-items: center; }
.vc .btn:hover, .vc .btn:focus-visible { border-color: var(--accent); outline: none; }
.vc .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.vc kbd { font: 800 13px/1 ui-monospace, monospace; border: 2px solid currentColor; border-radius: 5px; padding: 2px 5px; opacity: .8; }

.vc .topbar { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 28px; align-items: center; padding: 10px 20px; background: var(--bar); border-bottom: 2px solid var(--line); backdrop-filter: blur(6px); }
.vc .topbar .year { font-size: var(--fs-l); font-weight: 800; }
.vc .topbar .kv b { font-size: var(--fs-l); }
.vc .topbar .spacer { flex: 1; }
.vc .cmdbar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 8px; padding: 10px 20px 64px; background: var(--bar); border-top: 2px solid var(--line); flex-wrap: wrap; }
.vc .cmdbar .grow { flex: 1; }
.vc .unitcard { position: absolute; left: 20px; bottom: 150px; width: 340px; background: var(--sheet); border: 2px solid var(--line); border-radius: 14px; padding: 14px; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; }
.vc .unitcard img { height: 72px; grid-row: span 3; }
.vc .unitcard .name { font-size: var(--fs-l); font-weight: 800; }
.vc .unitcard .tile { grid-column: 1 / -1; border-top: 2px solid var(--line); padding-top: 8px; display: flex; justify-content: space-between; align-items: center; }
.vc .amt { display: inline-flex; gap: 4px; align-items: center; font-weight: 800; font-size: var(--fs-l); white-space: nowrap; }
.vc .amt img { width: 30px; height: 30px; }

.vc .sheetwrap { position: absolute; inset: 0; background: rgb(0 0 0 / 50%); display: flex; align-items: flex-end; justify-content: center; }
.vc .ask { width: min(760px, 100%); background: var(--sheet); border: 2px solid var(--line); border-bottom: 0; border-radius: 18px 18px 0 0; padding: 22px 24px 76px; }
.vc .ask .head { display: flex; gap: 18px; align-items: center; margin-bottom: 18px; }
.vc .ask h2 { margin: 0 0 4px; font-size: var(--fs-xl); }
.vc .ask p { margin: 0; }
.vc .ask .opts { display: flex; flex-direction: column; gap: 8px; }
.vc .ask .opts .btn { justify-content: flex-start; font-size: var(--fs-l); padding: 14px 16px; }
.vc .ask .opts .btn small { margin-left: auto; font-size: var(--fs-s); font-weight: 500; opacity: .85; }

.vc .full { position: absolute; inset: 0; background: var(--sheet); display: flex; flex-direction: column; }
.vc .full > header { display: flex; align-items: center; gap: 20px; padding: 12px 20px; border-bottom: 2px solid var(--line); }
.vc .full > header h1 { margin: 0; font-size: var(--fs-xl); }
.vc .full > header .facts { display: flex; gap: 22px; margin-left: auto; }
.vc .full > header .facts b { font-size: var(--fs-l); }
.vc .board { flex: 1; overflow: auto; display: grid; grid-template-columns: minmax(330px, 1fr) minmax(420px, 1.6fr); gap: 20px; padding: 20px 20px 4px; align-content: start; }
.vc h2 { font-size: var(--fs-l); margin: 0 0 10px; }
.vc .pos { color: var(--good); } .vc .neg { color: var(--bad); }

.vc .diamond { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.vc .dtile { position: relative; background: var(--card); border: 2px solid var(--line); border-radius: 10px; padding: 8px 6px 6px; text-align: center; min-height: 112px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
.vc .dtile .terr { width: 96px; height: 48px; display: block; }
.vc .dtile .who { position: absolute; right: 4px; top: 2px; height: 44px; }
.vc .dtile.centre { border-color: var(--accent); }
.vc .dtile.owned { border-style: dashed; opacity: .6; }
.vc .dtile .tname { font-size: var(--fs-s); }

.vc .bgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.vc .bcard { background: var(--card); border: 2px solid var(--line); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.vc .bcard .pic { height: 64px; overflow: hidden; display: flex; align-items: end; justify-content: space-between; }
.vc .bcard .pic > img { height: 60px; max-width: 110px; object-fit: contain; }
.vc .bcard .w { white-space: nowrap; } .vc .bcard .w img { height: 44px; margin-left: -10px; }
.vc .bcard .w .slot { display: inline-block; width: 18px; height: 36px; border: 2px dashed var(--line); border-radius: 4px; margin-left: 4px; }
.vc .bcard .bname { font-weight: 800; }
.vc .bcard .make { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.vc .bcard.idle { opacity: .55; }

.vc .strip { border-top: 2px solid var(--line); padding: 12px 20px 70px; display: grid; grid-template-columns: repeat(16, minmax(58px, 1fr)); gap: 6px; overflow-x: auto; }
.vc .good { text-align: center; background: var(--card); border: 2px solid var(--line); border-radius: 10px; padding: 6px 2px; }
.vc .good img { width: 34px; height: 34px; display: block; margin: 0 auto; }
.vc .good .n { font-size: var(--fs-l); font-weight: 800; display: block; line-height: 1.1; }
.vc .good .d { font-size: var(--fs-s); font-weight: 700; }
.vc .good.zero { opacity: .35; }
.vc .good .gl { font-size: 12px; color: var(--muted); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc .bar { height: 12px; background: var(--card); border: 2px solid var(--line); border-radius: 6px; overflow: hidden; }
.vc .bar i { display: block; height: 100%; background: var(--accent); }

.vc .market { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; }
.vc .market .good .price { font-size: var(--fs-l); font-weight: 800; }
.vc .market .good .price span { color: var(--muted); font-weight: 600; }
.vc .row { display: flex; gap: 12px; align-items: center; }
.vc .people { display: flex; gap: 10px; flex-wrap: wrap; }
.vc .person { background: var(--card); border: 2px solid var(--line); border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; align-items: center; min-width: 120px; }
.vc .person img { height: 56px; }
.vc .person b { font-size: var(--fs-l); }
`;

export const Amt = ({ a: [g, n] }: { a: Amount }) => (
  <span className="amt" title={GOOD_NAMES[g]}>
    <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
    {n}
  </span>
);

export function MapChrome({ open, colony = 'colony' }: { open: VariantProps['open']; colony?: Show }) {
  return (
    <>
      <div className="topbar">
        <span className="year">{side.year}</span>
        <span className="muted">Turn {side.turn}</span>
        <span className="spacer" />
        <span className="kv">
          Gold <b>{money(side.gold)}</b>
        </span>
        <span className="kv">
          Tax <b>{side.tax}%</b>
        </span>
        <span className="kv">
          Score <b>{side.score}</b>
        </span>
        <button className="btn">Menu</button>
      </div>
      <div className="unitcard">
        <img src={unitArt(side.unit.img)} alt="" />
        <span className="name">{side.unit.name}</span>
        <span>{side.unit.detail}</span>
        <span>
          Moves <b>{side.unit.moves}</b>
        </span>
        <div className="tile">
          <span>
            <b>{side.tile.name}</b>
            <br />
            <span className="muted">{side.tile.owner}</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {side.tile.produce.map((a) => (
              <Amt key={a[0]} a={a} />
            ))}
          </span>
        </div>
      </div>
      <div className="cmdbar">
        {side.orders.slice(0, 6).map(([o, k]) => (
          <button key={o} className="btn">
            {o} <kbd>{k}</kbd>
          </button>
        ))}
        <span className="grow" />
        <button className="btn" onClick={() => open(colony)}>
          Colonies
        </button>
        <button className="btn" onClick={() => open('europe')}>
          Europe
        </button>
        <button className="btn">
          Next unit <kbd>W</kbd>
        </button>
        <button className="btn primary">
          End turn <kbd>Enter</kbd>
        </button>
      </div>
    </>
  );
}

export function Ask({ close }: { close: () => void }) {
  return (
    <div className="sheetwrap">
      <div className="ask">
        <div className="head">
          <img src={art(choice.img)} alt="" style={{ height: 90 }} />
          <img src={art(choice.img2)} alt="" style={{ height: 60 }} />
          <div>
            <h2>{choice.title}</h2>
            <p>{choice.text}</p>
          </div>
        </div>
        <div className="opts">
          {choice.options.map((o, i) => (
            <button key={o.label} className={`btn ${i === 0 ? 'primary' : ''}`} onClick={close}>
              <kbd>{o.cancel ? 'Esc' : i + 1}</kbd> {o.label}
              {o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Colony({ close }: { close: () => void }) {
  const c = colony;
  const [h, hMax] = c.building.hammers;
  return (
    <div className="full">
      <header>
        <button className="btn" onClick={close}>
          ← Map <kbd>Esc</kbd>
        </button>
        <h1>{c.name}</h1>
        <div className="facts">
          <span>
            Pop <b>{c.population}</b>
          </span>
          <span>
            Rebels <b>{c.rebels}%</b>
          </span>
          <span>
            Food <b className="pos">{signed(c.food.made - c.food.eaten - c.food.horses)}</b>
          </span>
          <span className="muted">{c.defence}</span>
        </div>
      </header>
      <div className="board">
        <section>
          <h2>Land</h2>
          <div className="diamond">
            {c.tiles.map((t, i) => (
              <div key={i} className={`dtile ${t.centre ? 'centre' : ''} ${t.owned ? 'owned' : ''}`}>
                <span className="terr" style={{ background: tileBg(t) }} />
                {t.worker && <img className="who" src={unitArt(t.worker)} alt={UNIT_NAMES[t.worker]} title={UNIT_NAMES[t.worker]} />}
                <span className="tname">{t.owned ? `${t.owned} land` : t.name}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {t.produce.map((a) => (
                    <Amt key={a[0]} a={a} />
                  ))}
                </span>
              </div>
            ))}
          </div>
          <h2 style={{ marginTop: 20 }}>Building {c.building.name}</h2>
          <div className="row" style={{ marginBottom: 6 }}>
            <Amt a={['hammers', h]} />
            <span className="muted">/ {hMax}</span>
            <span style={{ flex: 1 }} />
            <Amt a={['tools', c.building.tools[0]]} />
            <span className="muted">/ {c.building.tools[1]}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${(100 * h) / hMax}%` }} />
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Done in {c.building.turns} turns. Then: {c.queue.join(', ')}.
          </p>
        </section>
        <section>
          <h2>Buildings</h2>
          <div className="bgrid">
            {c.buildings.map((b) => (
              <div key={b.name} className={`bcard ${b.slots > 0 && b.workers.length === 0 ? 'idle' : ''}`}>
                <div className="pic">
                  <img src={art(`b-${b.img}`)} alt="" />
                  <span className="w">
                    {b.workers.map((w, i) => (
                      <img key={i} src={unitArt(w)} alt={UNIT_NAMES[w]} title={UNIT_NAMES[w]} />
                    ))}
                    {Array.from({ length: b.slots - b.workers.length }, (_, i) => (
                      <span key={i} className="slot" />
                    ))}
                  </span>
                </div>
                <span className="bname">{b.name}</span>
                <span className="make">
                  {b.in?.map((a) => (
                    <Amt key={a[0]} a={a} />
                  ))}
                  {b.in && <span>→</span>}
                  {b.out.map((a) => (
                    <Amt key={a[0]} a={a} />
                  ))}
                  {b.note && <span className="muted">{b.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="strip">
        {c.warehouse.map(([g, n, d]) => (
          <div key={g} className={`good ${n === 0 && d === 0 ? 'zero' : ''}`} title={GOOD_NAMES[g]}>
            <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
            <span className="n" style={n > c.capacity ? { color: 'var(--bad)' } : undefined}>
              {n}
            </span>
            <span className={`d ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`}>{signed(d)}</span>
            <span className="gl">{GOOD_NAMES[g]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Europe({ close }: { close: () => void }) {
  const e = europe;
  return (
    <div className="full">
      <header>
        <button className="btn" onClick={close}>
          ← Map <kbd>Esc</kbd>
        </button>
        <h1>Europe</h1>
        <div className="facts">
          <span>
            Gold <b>{money(e.gold)}</b>
          </span>
          <span>
            Tax <b>{e.tax}%</b>
          </span>
        </div>
      </header>
      <div className="board" style={{ gridTemplateColumns: '1fr' }}>
        <section>
          <h2>
            Market <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>sell price / buy price, per unit</span>
          </h2>
          <div className="market">
            {e.market.map(([g, s, b, t]) => (
              <div key={g} className="good">
                <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
                <span className="gl" style={{ fontSize: 14 }}>
                  {GOOD_NAMES[g]}
                </span>
                <span className="price">
                  {s}
                  <span>/{b}</span>
                </span>{' '}
                {t !== 0 && <span className={t > 0 ? 'pos' : 'neg'}>{t > 0 ? '▲' : '▼'}</span>}
              </div>
            ))}
          </div>
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
          <div>
            <h2>Ships</h2>
            {e.ships.map((s) => (
              <div key={s.name} className="row" style={{ background: 'var(--card)', border: '2px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 8 }}>
                <img src={unitArt(s.img)} alt="" style={{ height: 56 }} />
                <div style={{ flex: 1 }}>
                  <b>{s.name}</b>
                  <div className="muted">{s.state}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    {s.cargo.map((a) => (
                      <Amt key={a[0]} a={a} />
                    ))}
                    {s.units.map((u) => (
                      <img key={u} src={unitArt(u)} alt={UNIT_NAMES[u]} style={{ height: 40 }} />
                    ))}
                  </div>
                </div>
                {s.state === 'In port' && <button className="btn primary">Sail</button>}
              </div>
            ))}
          </div>
          <div>
            <h2>Docks</h2>
            <div className="people">
              {e.docks.map((u, i) => (
                <div key={i} className="person">
                  <img src={unitArt(u)} alt="" />
                  {UNIT_NAMES[u]}
                </div>
              ))}
            </div>
            <h2 style={{ marginTop: 16 }}>Recruit</h2>
            <div className="people">
              {e.recruits.map((r, i) => (
                <div key={i} className="person">
                  <img src={unitArt(r.unit)} alt="" />
                  {UNIT_NAMES[r.unit]}
                  <b>{money(r.price)}</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function VariantC({ show, theme, open }: VariantProps) {
  const close = () => open('none');
  return (
    <div className="vc" data-theme={theme}>
      <style>{CSS}</style>
      <div className="map" style={mapStyle} />
      <MapChrome open={open} />
      {show === 'choice' && <Ask close={close} />}
      {show === 'colony' && <Colony close={close} />}
      {show === 'europe' && <Europe close={close} />}
    </div>
  );
}
