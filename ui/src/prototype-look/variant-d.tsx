// PROTOTYPE (#48), throwaway. Look D: C's "Big board" (top bar for the
// status, command bar, full-screen colony sheet) plus a colony drawer.
// Clicking a colony on the map slides in an at-a-glance drawer on the
// right: what it builds, food and growth, what needs attention, its
// stores, and quick actions. "Open colony" (or a double-click) brings up
// C's full-screen sheet. The map stays visible and playable beside it.
import type { VariantProps } from './main';
import { colony, GOOD_NAMES, goodArt, mapStyle, signed, UNIT_NAMES, unitArt } from './data';
import { Amt, Ask, Colony, CSS as C_CSS, Europe, MapChrome } from './variant-c';

const CSS = `
.vd .hot { position: absolute; top: 0; height: 100%; aspect-ratio: 738 / 700; left: 50%; transform: translateX(-50%); pointer-events: none; }
.vd .hot button { pointer-events: auto; position: absolute; left: 36.5%; top: 50.5%; width: 9%; height: 6%; border: 3px solid var(--accent); border-radius: 50%; background: transparent; cursor: pointer; animation: vdpulse 1.6s ease-in-out infinite; }
.vd .hot button.on { animation: none; box-shadow: 0 0 0 4px rgb(0 0 0 / 50%); }
@keyframes vdpulse { 50% { opacity: .35; } }
.vd .glance { position: absolute; right: 0; top: 70px; bottom: 122px; width: 400px; background: var(--sheet); border-left: 2px solid var(--line); display: flex; flex-direction: column; animation: vdin .16s ease-out; }
@keyframes vdin { from { transform: translateX(40px); opacity: 0; } }
.vd .glance > header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 2px solid var(--line); }
.vd .glance > header h2 { margin: 0; font-size: var(--fs-xl); flex: 1; }
.vd .glance .x { padding: 6px 10px; }
.vd .gbody { flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; }
.vd .facts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.vd .fact { background: var(--card); border: 2px solid var(--line); border-radius: 10px; padding: 6px 8px; }
.vd .fact span { display: block; font-size: 13px; color: var(--muted); }
.vd .fact b { font-size: var(--fs-l); }
.vd .alert { display: flex; gap: 10px; align-items: center; border-left: 4px solid var(--bad); background: var(--card); border-radius: 0 10px 10px 0; padding: 8px 10px; font-size: var(--fs-s); }
.vd .alert.warn { border-left-color: var(--accent); }
.vd .alert img { width: 30px; height: 30px; flex: none; }
.vd .alert .act { margin-left: auto; padding: 4px 10px; font-size: 14px; }
.vd .sub { font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 700; margin-bottom: 6px; }
.vd .stock { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.vd .stock .good { padding: 4px 2px; }
.vd .stock .good img { width: 28px; height: 28px; }
.vd .people { display: flex; flex-wrap: wrap; gap: 2px; }
.vd .people img { height: 44px; }
.vd .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 12px 16px; border-top: 2px solid var(--line); }
.vd .actions .btn { justify-content: space-between; padding: 9px 12px; font-size: var(--fs-s); }
.vd .actions .wide { grid-column: 1 / -1; font-size: var(--fs); }
`;

function Glance({ open }: { open: VariantProps['open'] }) {
  const c = colony;
  const net = c.food.made - c.food.eaten - c.food.horses;
  const grow = Math.ceil((c.food.toGrowth[1] - c.food.toGrowth[0]) / net);
  const [h, hMax] = c.building.hammers;
  const stock = c.warehouse.filter(([, n, d]) => n > 0 || d !== 0);
  const over = c.warehouse.filter(([, n, d]) => n + d > c.capacity);
  // Buildings with no workers whose input is in store.
  const idle = c.buildings.filter((b) => b.slots > 0 && b.workers.length === 0 && b.in?.some(([g]) => (c.warehouse.find((w) => w[0] === g)?.[1] ?? 0) > 0));
  const workers = [...c.tiles.flatMap((t) => (t.worker ? [t.worker] : [])), ...c.buildings.flatMap((b) => b.workers)];
  return (
    <aside className="glance">
      <header>
        <h2>{c.name}</h2>
        <button className="btn x" onClick={() => open('none')} title="Close (Esc)">
          ✕
        </button>
      </header>
      <div className="gbody">
        <div className="facts">
          <div className="fact">
            <span>Population</span>
            <b>{c.population}</b>
          </div>
          <div className="fact">
            <span>Rebels</span>
            <b>{c.rebels}%</b>
          </div>
          <div className="fact">
            <span>Food</span>
            <b className="pos">{signed(net)}</b>
          </div>
        </div>
        <div>
          <div className="sub">
            Building {c.building.name} · {c.building.turns} turns
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Amt a={['hammers', h]} />
            <span className="muted">/ {hMax}</span>
            <span style={{ flex: 1 }} />
            <span className="muted">then {c.queue[0]}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${(100 * h) / hMax}%` }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="sub">Needs attention</div>
          {over.map(([g, n, d]) => (
            <div key={g} className="alert">
              <img src={goodArt(g)} alt="" />
              <span>
                <b>
                  {GOOD_NAMES[g]} {n}/{c.capacity}
                </b>
                , {signed(d)} a turn: {n + d - c.capacity} lost at the end of turn
              </span>
              <button className="btn act">Sell</button>
            </div>
          ))}
          {idle.map((b) => {
            const [g] = b.in![0];
            return (
              <div key={b.name} className="alert warn">
                <img src={goodArt(g)} alt="" />
                <span>
                  <b>{b.name}</b> is empty: {c.warehouse.find((w) => w[0] === g)?.[1]} {GOOD_NAMES[g].toLowerCase()} waiting
                </span>
                <button className="btn act">Staff</button>
              </div>
            );
          })}
          <div className="alert warn">
            <img src={goodArt('food')} alt="" />
            <span>
              New colonist in <b>{grow} turns</b> ({c.food.toGrowth[0]}/{c.food.toGrowth[1]} food)
            </span>
          </div>
        </div>
        <div>
          <div className="sub">In store</div>
          <div className="stock">
            {stock.map(([g, n, d]) => (
              <div key={g} className="good" title={GOOD_NAMES[g]}>
                <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
                <span className="n" style={n > c.capacity ? { color: 'var(--bad)' } : undefined}>
                  {n}
                </span>
                <span className={`d ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`}>{signed(d)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="sub">
            Colonists ({workers.length}) · outside: {c.outside.map((o) => o.name).join(', ')}
          </div>
          <div className="people">
            {workers.map((w, i) => (
              <img key={i} src={unitArt(w)} alt={UNIT_NAMES[w]} title={UNIT_NAMES[w]} />
            ))}
          </div>
        </div>
      </div>
      <div className="actions">
        <button className="btn primary wide" onClick={() => open('colony')}>
          Open colony <kbd>Enter</kbd>
        </button>
        <button className="btn">
          Change build <kbd>B</kbd>
        </button>
        <button className="btn">
          Centre map <kbd>C</kbd>
        </button>
        <button className="btn">
          Unload ship <kbd>U</kbd>
        </button>
        <button className="btn">
          Next colony <kbd>Tab</kbd>
        </button>
      </div>
    </aside>
  );
}

export function VariantD({ show, theme, open }: VariantProps) {
  const close = () => open('none');
  return (
    <div className="vc vd" data-theme={theme}>
      <style>{C_CSS + CSS}</style>
      <div className="map" style={mapStyle} />
      <div className="hot">
        <button
          className={show === 'glance' ? 'on' : ''}
          title="New Amsterdam: click for a quick look, double-click to open"
          onClick={() => open('glance')}
          onDoubleClick={() => open('colony')}
        />
      </div>
      <MapChrome open={open} colony="glance" />
      {show === 'glance' && <Glance open={open} />}
      {show === 'choice' && <Ask close={close} />}
      {show === 'colony' && <Colony close={close} />}
      {show === 'europe' && <Europe close={close} />}
    </div>
  );
}
