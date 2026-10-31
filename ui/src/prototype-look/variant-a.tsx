// PROTOTYPE (#48), throwaway. Look A, "Ledger": the layout of today's page
// (map left, side panel right, dialogs as centred windows), with calm
// light paper-and-ink surfaces, a humanist sans at 15px, and tables of
// right-aligned figures with each good's icon in a fixed column to its left.
import type { ReactNode } from 'react';
import type { VariantProps } from './main';
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
.va {
  --bg: #f6f3ec; --surface: #fffdf8; --sunk: #efeadf; --ink: #1f1c17; --muted: #6a6357; --line: #d9d1c1;
  --accent: #1f5f8b; --accent-ink: #fff; --good: #2e7d32; --bad: #b3261e; --shadow: 0 10px 40px rgb(30 25 15 / 30%);
  --fs-s: 13px; --fs: 15px; --fs-l: 18px; --fs-xl: 22px;
  font: var(--fs)/1.45 'Segoe UI', 'Noto Sans', Ubuntu, Cantarell, system-ui, sans-serif; color: var(--ink);
  font-variant-numeric: tabular-nums;
  display: flex; height: 100%; background: var(--bg);
}
.va[data-theme=dark] {
  --bg: #1b1d21; --surface: #24272d; --sunk: #1f2226; --ink: #ebe7df; --muted: #a39d92; --line: #3a3e46;
  --accent: #7cb7e6; --accent-ink: #10202c; --good: #7fd18a; --bad: #ff8a80; --shadow: 0 10px 40px rgb(0 0 0 / 60%);
}
.va .map { flex: 1; position: relative; }
.va .side { width: 320px; flex: none; background: var(--surface); border-left: 1px solid var(--line); overflow: auto; }
.va .sec { padding: 14px 16px; border-bottom: 1px solid var(--line); }
.va .label { font-size: var(--fs-s); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; font-weight: 600; }
.va .stat { display: grid; grid-template-columns: 1fr auto; row-gap: 2px; }
.va .stat dt { color: var(--muted); } .va .stat dd { margin: 0; text-align: right; font-weight: 600; }
.va .big { font-size: var(--fs-xl); font-weight: 600; }
.va .btn { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
.va .btn:hover { border-color: var(--accent); }
.va .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.va .rows { display: flex; flex-direction: column; }
.va .rows .btn { justify-content: space-between; border-radius: 0; border-width: 0 0 1px; background: transparent; padding: 7px 2px; }
.va kbd { font: 600 12px/1 ui-monospace, monospace; color: var(--muted); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 2px 5px; }
.va .orders { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.va .orders .btn { justify-content: space-between; padding: 5px 8px; }
.va .unit { display: flex; gap: 12px; align-items: center; }
.va .unit img { height: 48px; }
.va .muted { color: var(--muted); }
.va .icon { width: 24px; height: 24px; object-fit: contain; vertical-align: middle; }
.va .amt { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; white-space: nowrap; }

.va .modal { position: absolute; inset: 0; background: rgb(0 0 0 / 35%); display: flex; align-items: center; justify-content: center; padding: 24px; }
.va .win { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); max-height: 100%; display: flex; flex-direction: column; min-width: 0; }
.va .win > header { display: flex; align-items: baseline; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
.va .win > header h2 { margin: 0; font-size: var(--fs-l); }
.va .win > header .x { margin-left: auto; }
.va .win > .body { padding: 16px 20px; overflow: auto; }
.va .win > footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--sunk); border-radius: 0 0 10px 10px; }

.va table { border-collapse: collapse; width: 100%; }
.va th { font-size: var(--fs-s); color: var(--muted); font-weight: 600; text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); }
.va td { padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.va tr:last-child td { border-bottom: 0; }
.va .num { text-align: right; }
.va .pos { color: var(--good); } .va .neg { color: var(--bad); }
.va td.ic { width: 24px; padding-right: 0; }
.va .zero td { color: var(--muted); } .va .zero img { opacity: .45; }

.va .choice { width: 520px; }
.va .choice .pics { display: flex; gap: 12px; align-items: end; float: left; margin: 0 16px 8px 0; }
.va .choice .opts { clear: both; display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.va .choice .opts .btn { justify-content: space-between; padding: 9px 12px; text-align: left; }
.va .choice .opts .hint { color: var(--muted); font-size: var(--fs-s); }
.va .choice .opts .btn.primary .hint { color: inherit; opacity: .85; }

.va .colony { width: min(1080px, 100%); }
.va .cgrid { display: grid; grid-template-columns: 330px 1fr; gap: 20px; }
.va h3 { font-size: var(--fs); margin: 0 0 6px; }
.va .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 18px; }
.va .tile { background: var(--sunk); border: 1px solid var(--line); border-radius: 6px; padding: 4px; text-align: center; font-size: var(--fs-s); position: relative; }
.va .tile.centre { border-color: var(--accent); border-width: 2px; }
.va .tile.owned { opacity: .55; }
.va .tile .terr { height: 40px; width: 80px; display: block; margin: 0 auto; }
.va .tile .who { position: absolute; top: 2px; right: 2px; height: 30px; }
.va .tile .n { font-weight: 600; }
.va .progress { height: 8px; background: var(--sunk); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.va .progress > i { display: block; height: 100%; background: var(--accent); }
.va .workers img { height: 34px; margin-right: -4px; }
.va .workers .slot { display: inline-block; width: 18px; height: 30px; border: 1px dashed var(--line); border-radius: 3px; vertical-align: bottom; margin-left: 6px; }
.va .bimg { height: 30px; width: 44px; object-fit: contain; }
.va .summary { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-bottom: 14px; }
.va .summary b { font-size: var(--fs-l); }

.va .europe { width: min(980px, 100%); }
.va .egrid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.va .ship { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.va .ship img.s { height: 46px; }
.va .people { display: flex; flex-wrap: wrap; gap: 8px; }
.va .person { display: flex; gap: 8px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px 4px 4px; background: var(--surface); }
.va .person img { height: 40px; }
`;

const Icon = ({ g }: { g: string }) => <img className="icon" src={goodArt(g)} alt={GOOD_NAMES[g]} title={GOOD_NAMES[g]} />;
const Amt = ({ a: [g, n] }: { a: Amount }) => (
  <span className="amt">
    <Icon g={g} />
    {n} <span className="muted">{GOOD_NAMES[g].toLowerCase()}</span>
  </span>
);

function Side({ open }: { open: VariantProps['open'] }) {
  return (
    <aside className="side">
      <div className="sec">
        <div className="big">{side.year}</div>
        <div className="muted">Turn {side.turn}</div>
        <dl className="stat" style={{ marginTop: 8 }}>
          <dt>Gold</dt>
          <dd>{money(side.gold)}</dd>
          <dt>Tax</dt>
          <dd>{side.tax}%</dd>
          <dt>Score</dt>
          <dd>{side.score}</dd>
        </dl>
      </div>
      <div className="sec rows">
        {side.buttons.map(([b, k]) => (
          <button key={b} className="btn">
            {b} <kbd>{k}</kbd>
          </button>
        ))}
        <button className="btn" onClick={() => open('colony')}>
          New Amsterdam <span className="muted">colony</span>
        </button>
        <button className="btn" onClick={() => open('europe')}>
          Europe <span className="muted">docks</span>
        </button>
      </div>
      <div className="sec">
        <div className="label">Active unit</div>
        <div className="unit">
          <img src={unitArt(side.unit.img)} alt="" />
          <div>
            <b>{side.unit.name}</b>
            <div className="muted">{side.unit.detail}</div>
            <div>Moves {side.unit.moves}</div>
          </div>
        </div>
      </div>
      <div className="sec">
        <div className="label">Orders</div>
        <div className="orders">
          {side.orders.map(([o, k]) => (
            <button key={o} className="btn">
              {o} <kbd>{k}</kbd>
            </button>
          ))}
        </div>
      </div>
      <div className="sec">
        <div className="label">Tile</div>
        <b>{side.tile.name}</b>
        <div className="muted">{side.tile.owner}</div>
        <div>
          {side.tile.produce.map((a) => (
            <Amt key={a[0]} a={a} />
          ))}
        </div>
      </div>
      <div className="sec">
        <div className="label">Saved games</div>
        {side.saves.map((s) => (
          <div key={s.name} style={{ marginBottom: 6 }}>
            <b>{s.name}</b>
            <div className="muted">
              Turn {s.turn}, {s.year} · {s.when}
            </div>
          </div>
        ))}
        <button className="btn">Save game</button>
      </div>
    </aside>
  );
}

function Win({ title, sub, cls, close, children, foot }: { title: string; sub?: string; cls: string; close: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="modal">
      <section className={`win ${cls}`}>
        <header>
          <h2>{title}</h2>
          {sub && <span className="muted">{sub}</span>}
          <button className="btn x" onClick={close} title="Close (Esc)">
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
        {foot && <footer>{foot}</footer>}
      </section>
    </div>
  );
}

function Choice({ close }: { close: () => void }) {
  return (
    <Win title={choice.title} cls="choice" close={close}>
      <div className="pics">
        <img src={art(choice.img)} alt="" style={{ height: 64 }} />
        <img src={art(choice.img2)} alt="" style={{ height: 48 }} />
      </div>
      <p style={{ margin: 0 }}>{choice.text}</p>
      <div className="opts">
        {choice.options.map((o, i) => (
          <button key={o.label} className={`btn ${i === 0 ? 'primary' : ''}`} onClick={close}>
            <span>{o.label}</span>
            {o.hint && <span className="hint">{o.hint}</span>}
          </button>
        ))}
      </div>
    </Win>
  );
}

function Colony({ close }: { close: () => void }) {
  const c = colony;
  const [h, hMax] = c.building.hammers;
  return (
    <Win
      title={c.name}
      sub={`Population ${c.population}`}
      cls="colony"
      close={close}
      foot={
        <>
          <button className="btn">Unload ship</button>
          <button className="btn">Change build</button>
          <button className="btn primary" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div className="summary">
        <span>
          Rebels <b>{c.rebels}%</b> <span className="muted">Royalists {c.tories}%</span>
        </span>
        <span>
          Production bonus <b>{c.bonus}</b>
        </span>
        <span>
          Food <b className="pos">{signed(c.food.made - c.food.eaten - c.food.horses)}</b>{' '}
          <span className="muted">
            ({c.food.toGrowth[0]}/{c.food.toGrowth[1]} to a new colonist)
          </span>
        </span>
        <span className="muted">{c.defence}</span>
      </div>
      <div className="cgrid">
        <div>
          <h3>Colony tiles</h3>
          <div className="tiles">
            {c.tiles.map((t, i) => (
              <div key={i} className={`tile ${t.centre ? 'centre' : ''} ${t.owned ? 'owned' : ''}`} title={t.owned ? `Owned by the ${t.owned}` : t.name}>
                <span className="terr" style={{ background: tileBg(t) }} />
                {t.worker && <img className="who" src={unitArt(t.worker)} alt={UNIT_NAMES[t.worker]} />}
                <div>{t.name}</div>
                <div>
                  {t.produce.map(([g, n]) => (
                    <span key={g} className="amt" style={{ margin: '0 2px' }}>
                      <Icon g={g} />
                      <span className="n">{n}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <h3>Warehouse</h3>
          <table>
            <thead>
              <tr>
                <th colSpan={2}>Goods</th>
                <th className="num">Stored</th>
                <th className="num">Per turn</th>
              </tr>
            </thead>
            <tbody>
              {c.warehouse.map(([g, n, d]) => (
                <tr key={g} className={n === 0 && d === 0 ? 'zero' : ''}>
                  <td className="ic">
                    <Icon g={g} />
                  </td>
                  <td>{GOOD_NAMES[g]}</td>
                  <td className="num">
                    <b style={n > c.capacity ? { color: 'var(--bad)' } : undefined}>{n}</b>
                    <span className="muted">/{c.capacity}</span>
                  </td>
                  <td className={`num ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`}>{signed(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Buildings</h3>
          <table>
            <thead>
              <tr>
                <th colSpan={2}>Building</th>
                <th>Workers</th>
                <th>Makes</th>
              </tr>
            </thead>
            <tbody>
              {c.buildings.map((b) => (
                <tr key={b.name}>
                  <td className="ic" style={{ width: 44 }}>
                    <img className="bimg" src={art(`b-${b.img}`)} alt="" />
                  </td>
                  <td>{b.name}</td>
                  <td className="workers">
                    {b.workers.map((w, i) => (
                      <img key={i} src={unitArt(w)} alt={UNIT_NAMES[w]} title={UNIT_NAMES[w]} />
                    ))}
                    {Array.from({ length: b.slots - b.workers.length }, (_, i) => (
                      <span key={i} className="slot" />
                    ))}
                    {b.slots === 0 && <span className="muted">—</span>}
                  </td>
                  <td>
                    {b.out.map(([g, n]) => (
                      <span key={g} className={n === 0 ? 'muted' : ''}>
                        {b.in?.map(([ig, ini]) => (
                          <span key={ig}>
                            <Amt a={[ig, ini]} />→{' '}
                          </span>
                        ))}
                        <Amt a={[g, n]} />
                      </span>
                    ))}
                    {b.note && <span className="muted">{b.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 18 }}>Building: {c.building.name}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 10px', alignItems: 'center' }}>
            <Icon g="hammers" />
            <div className="progress">
              <i style={{ width: `${(100 * h) / hMax}%` }} />
            </div>
            <span>
              {h}/{hMax}
            </span>
            <Icon g="tools" />
            <div className="progress">
              <i style={{ width: '100%' }} />
            </div>
            <span>
              {c.building.tools[0]}/{c.building.tools[1]}
            </span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {c.building.turns} turns · then {c.queue.join(', ')}
          </p>
        </div>
      </div>
    </Win>
  );
}

function Europe({ close }: { close: () => void }) {
  const e = europe;
  return (
    <Win
      title="Europe"
      sub={`Gold ${money(e.gold)} · Tax ${e.tax}%`}
      cls="europe"
      close={close}
      foot={
        <>
          <button className="btn">Recruit</button>
          <button className="btn">Train</button>
          <button className="btn">Purchase ship</button>
          <button className="btn primary" onClick={close}>
            Sail to the New World
          </button>
        </>
      }
    >
      <div className="egrid">
        <div>
          <h3>Market</h3>
          <table>
            <thead>
              <tr>
                <th colSpan={2}>Goods</th>
                <th className="num">We sell at</th>
                <th className="num">We buy at</th>
              </tr>
            </thead>
            <tbody>
              {e.market.map(([g, s, b, t]) => (
                <tr key={g}>
                  <td className="ic">
                    <Icon g={g} />
                  </td>
                  <td>{GOOD_NAMES[g]}</td>
                  <td className="num">
                    <b>{s}</b> {t !== 0 && <span className={t > 0 ? 'pos' : 'neg'}>{t > 0 ? '▲' : '▼'}</span>}
                  </td>
                  <td className="num">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Ships</h3>
          {e.ships.map((s) => (
            <div key={s.name} className="ship">
              <img className="s" src={unitArt(s.img)} alt="" />
              <div>
                <b>{s.name}</b>
                <div className="muted">
                  {s.state} · {s.cargo.length + s.units.length}/{s.holds} holds
                </div>
                <div>
                  {s.cargo.map((a) => (
                    <Amt key={a[0]} a={a} />
                  ))}
                  {s.units.map((u) => (
                    <span key={u} className="amt">
                      <img src={unitArt(u)} alt="" style={{ height: 28 }} /> {UNIT_NAMES[u]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <h3 style={{ marginTop: 16 }}>On the docks</h3>
          <div className="people">
            {e.docks.map((u, i) => (
              <div key={i} className="person">
                <img src={unitArt(u)} alt="" /> {UNIT_NAMES[u]}
              </div>
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>Recruit</h3>
          <table>
            <tbody>
              {e.recruits.map((r, i) => (
                <tr key={i}>
                  <td className="ic">
                    <img src={unitArt(r.unit)} alt="" style={{ height: 32 }} />
                  </td>
                  <td>{UNIT_NAMES[r.unit]}</td>
                  <td className="num">{money(r.price)} gold</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Win>
  );
}

export function VariantA({ show, theme, open }: VariantProps) {
  const close = () => open('none');
  return (
    <div className="va" data-theme={theme}>
      <style>{CSS}</style>
      <div className="map" style={mapStyle}>
        {show === 'choice' && <Choice close={close} />}
        {show === 'colony' && <Colony close={close} />}
        {show === 'europe' && <Europe close={close} />}
      </div>
      <Side open={open} />
    </div>
  );
}
