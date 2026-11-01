// PROTOTYPE (#48), throwaway. Look E, "FreeCol layout": the Swing client's
// own arrangement, so only colours and type are left to tune.
//   Map: menu bar on top with the status line at its right (Score ✧ Gold ✧
//   Tax ✧ Year), minimap bottom-left, info panel bottom-right, unit order
//   buttons along the bottom (CornerMapControls, InGameMenuBar).
//   Colony (ColonyPanel): population bar and buildings on the left; 3x3
//   isometric tiles, net production and the construction panel on the
//   right; then In port, Outside colony beside Cargo, and the warehouse
//   strip with its buttons along the bottom.
//   Europe (EuropePanel, wrap 3 at 30%/30%/15%): Going to America, Going to
//   Europe and the log; In port and Docks; Cargo; the market; the buttons.
//   Choice (FreeColChoiceDialog): icon, text, a column of buttons.
// The colour tokens are editable live from the "Colours" button.
import { useEffect, useState } from 'react';
import type { VariantProps } from './main';
import { art, choice, colony, europe, GOOD_NAMES, goodArt, mapStyle, money, side, signed, tileBg, UNIT_NAMES, unitArt } from './data';

type Tokens = Record<string, string>;
const PRESETS: Record<string, Tokens> = {
  parchment: {
    '--menubar': '#3b2a17',
    '--menubar-ink': '#f3e6c4',
    '--panel': '#e9dcb8',
    '--box': '#f4ead0',
    '--ink': '#2a1c0c',
    '--muted': '#6e5634',
    '--line': '#8c6c3c',
    '--head': '#5a3714',
    '--btn': '#cdb27a',
    '--btn-ink': '#2a1c0c',
    '--accent': '#8a2e12',
    '--good': '#1f6b1f',
    '--bad': '#b01e10',
  },
  dark: {
    '--menubar': '#0b0b0c',
    '--menubar-ink': '#f2f2f2',
    '--panel': '#16171a',
    '--box': '#202227',
    '--ink': '#f1f1f1',
    '--muted': '#a9abb3',
    '--line': '#3d4049',
    '--head': '#ffd60a',
    '--btn': '#2c2f36',
    '--btn-ink': '#ffffff',
    '--accent': '#ffd60a',
    '--good': '#4ade80',
    '--bad': '#ff6b6b',
  },
};
const LABELS: Record<string, string> = {
  '--menubar': 'Menu bar',
  '--menubar-ink': 'Menu bar text',
  '--panel': 'Panel',
  '--box': 'Box inside panel',
  '--ink': 'Text',
  '--muted': 'Quiet text',
  '--line': 'Borders',
  '--head': 'Headings',
  '--btn': 'Button',
  '--btn-ink': 'Button text',
  '--accent': 'Accent',
  '--good': 'Plus',
  '--bad': 'Minus',
};
const STORE = 'proto-look-e-tokens';
const loadTweaks = (): Record<string, Tokens> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Tokens>;
  } catch {
    return {};
  }
};

const CSS = `
.ve { --fs: 15px; --fs-s: 13px; --fs-h: 17px;
  font: var(--fs)/1.35 'Segoe UI', 'Noto Sans', Ubuntu, system-ui, sans-serif; color: var(--ink);
  font-variant-numeric: tabular-nums; height: 100%; position: relative; overflow: hidden; background: #000; }
.ve .map { position: absolute; inset: 26px 0 0 0; }
.ve .muted { color: var(--muted); }
.ve .pos { color: var(--good); } .ve .neg { color: var(--bad); }
.ve .btn { font: inherit; font-weight: 600; color: var(--btn-ink); background: var(--btn); border: 1px solid var(--line); border-radius: 4px; padding: 5px 14px; cursor: pointer; }
.ve .btn:hover { border-color: var(--accent); }
.ve .btn.ok { outline: 2px solid var(--accent); outline-offset: -3px; }
.ve .icon { width: 24px; height: 24px; object-fit: contain; vertical-align: middle; }

.ve .menubar { position: absolute; top: 0; left: 0; right: 0; height: 26px; background: var(--menubar); color: var(--menubar-ink); display: flex; align-items: center; padding: 0 6px; gap: 2px; font-size: 14px; }
.ve .menubar span.m { padding: 3px 9px; border-radius: 3px; cursor: default; }
.ve .menubar span.m:hover { background: rgb(255 255 255 / 12%); }
.ve .menubar .status { margin-left: auto; padding-right: 8px; white-space: nowrap; }
.ve .menubar .tweak { margin-left: 12px; font-size: 12px; padding: 2px 8px; }

.ve .minimap { position: absolute; left: 0; bottom: 0; width: 240px; height: 160px; background: var(--panel); border: 2px solid var(--line); border-radius: 0 6px 0 0; padding: 6px; box-sizing: border-box; }
.ve .minimap > div { width: 100%; height: 100%; background: #1d4357; position: relative; }
.ve .minimap > div i { position: absolute; left: 30%; top: 38%; width: 30%; height: 22%; background: #3c7a2c; transform: rotate(-20deg) skew(-20deg); }
.ve .minimap > div b { position: absolute; left: 39%; top: 52%; width: 5px; height: 5px; background: #ff8c1a; }
.ve .infopanel { position: absolute; right: 0; bottom: 0; width: 300px; min-height: 140px; background: var(--panel); border: 2px solid var(--line); border-radius: 6px 0 0 0; padding: 10px 12px; box-sizing: border-box; display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; align-items: center; }
.ve .infopanel img.u { height: 60px; grid-row: span 3; }
.ve .infopanel .name { font-weight: 700; }
.ve .infopanel .tile { grid-column: 1 / -1; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 6px; display: flex; justify-content: space-between; }
.ve .unitbuttons { position: absolute; left: 250px; right: 310px; bottom: 64px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }
.ve .unitbuttons .btn { padding: 4px 9px; font-size: var(--fs-s); }
.ve .unitbuttons kbd { font: 700 11px ui-monospace, monospace; opacity: .75; }

.ve .frame { position: absolute; background: var(--panel); border: 2px solid var(--line); box-shadow: 0 10px 40px rgb(0 0 0 / 55%); display: flex; flex-direction: column; }
.ve .frame > .title { background: var(--menubar); color: var(--menubar-ink); font-weight: 700; padding: 4px 10px; display: flex; justify-content: space-between; }
.ve .frame > .title button { font: inherit; background: none; border: 0; color: inherit; cursor: pointer; }
.ve .box { background: var(--box); border: 1px solid var(--line); border-radius: 3px; position: relative; padding: 18px 6px 6px; min-height: 0; overflow: auto; }
.ve .box > .cap { position: absolute; top: 2px; left: 8px; font-size: 12px; font-weight: 700; color: var(--head); text-transform: uppercase; letter-spacing: .05em; }

.ve .choice { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 480px; }
.ve .choice .body { padding: 14px 16px; display: grid; grid-template-columns: auto 1fr; gap: 14px; }
.ve .choice .opts { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; }
.ve .choice .opts .btn { text-align: left; padding: 7px 12px; }

.ve .colony { inset: 40px 30px 40px 30px; }
.ve .cbody { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 400px; grid-template-rows: auto 1fr auto auto auto; gap: 6px; padding: 6px; }
.ve .pop { grid-column: 1; display: flex; justify-content: space-between; align-items: center; padding: 2px 8px; }
.ve .pop b { font-size: var(--fs-h); }
.ve .buildings { grid-column: 1; grid-row: 2; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; align-content: start; }
.ve .bld { position: relative; height: 128px; border: 1px solid var(--line); border-radius: 3px; background: var(--box) no-repeat center 22px / auto 70px; }
.ve .bld .bn { position: absolute; left: 4px; top: 2px; font-size: var(--fs-s); font-weight: 600; }
.ve .bld .prod { position: absolute; right: 4px; top: 18px; display: flex; flex-direction: column; align-items: flex-end; font-weight: 700; }
.ve .bld .wk { position: absolute; left: 4px; bottom: 2px; display: flex; gap: 0; }
.ve .bld .wk img { height: 48px; }
.ve .bld .wk .slot { width: 22px; height: 40px; border: 1px dashed var(--line); margin: 6px 2px 0; }
.ve .upper { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ve .iso { position: relative; width: 384px; height: 192px; }
.ve .iso .t { position: absolute; width: 128px; height: 64px; }
.ve .iso .t .who { position: absolute; left: 47px; bottom: 14px; height: 44px; }
.ve .iso .t .pr { position: absolute; left: 0; right: 0; top: 18px; text-align: center; font-weight: 800; color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000; font-size: 14px; }
.ve .iso .t .pr img { width: 20px; height: 20px; vertical-align: middle; }
.ve .iso .t.owned { filter: grayscale(.7) brightness(.7); }
.ve .netprod { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; width: 100%; box-sizing: border-box; }
.ve .netprod span { display: inline-flex; align-items: center; gap: 2px; font-weight: 700; }
.ve .construction { width: 100%; box-sizing: border-box; display: grid; grid-template-columns: 80px 1fr; gap: 4px 10px; align-items: center; }
.ve .bar { height: 10px; border: 1px solid var(--line); background: var(--panel); }
.ve .bar i { display: block; height: 100%; background: var(--accent); }
.ve .inport { grid-column: 1 / -1; height: 80px; }
.ve .row2 { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ve .row2 .box { height: 80px; display: flex; gap: 6px; align-items: end; }
.ve .row2 .box img { height: 56px; }
.ve .bottom { grid-column: 1 / -1; display: flex; gap: 6px; align-items: stretch; }
.ve .warehouse { flex: 1; display: grid; grid-template-columns: repeat(16, 1fr); padding: 4px; }
.ve .warehouse > div { text-align: center; font-weight: 700; }
.ve .warehouse img { width: 32px; height: 32px; display: block; margin: 0 auto; }
.ve .warehouse .zero { opacity: .4; font-weight: 400; }

.ve .europe { inset: 40px 30px 40px 30px; }
.ve .ebody { flex: 1; min-height: 0; display: grid; grid-template-columns: 30fr 30fr 15fr; grid-template-rows: auto 1fr 1fr auto auto auto; gap: 6px; padding: 6px; }
.ve .ebody h1 { grid-column: 1 / -1; text-align: center; margin: 0; font-size: 24px; color: var(--head); }
.ve .ebody .units { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
.ve .ebody .units img { height: 60px; }
.ve .ship { display: flex; gap: 6px; align-items: center; }
.ve .market { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(16, 1fr); padding-top: 20px; }
.ve .market > div { text-align: center; border-right: 1px solid var(--line); }
.ve .market > div:last-child { border-right: 0; }
.ve .market img { width: 32px; height: 32px; display: block; margin: 0 auto; }
.ve .market b { display: block; }
.ve .ebuttons { grid-column: 1 / -1; display: flex; gap: 6px; }
.ve .log { font-size: var(--fs-s); }
.ve .log p { margin: 0 0 4px; }

.ve .tweaker { position: absolute; top: 32px; right: 8px; z-index: 50; width: 270px; background: #fff; color: #111; border: 1px solid #999; border-radius: 8px; box-shadow: 0 10px 30px rgb(0 0 0 / 40%); padding: 10px; font: 13px system-ui, sans-serif; }
.ve .tweaker label { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
.ve .tweaker input[type=color] { width: 44px; height: 22px; padding: 0; border: 1px solid #aaa; }
.ve .tweaker code { font-size: 11px; color: #555; }
.ve .tweaker .row { display: flex; gap: 6px; margin-top: 8px; }
.ve .tweaker button { font: inherit; padding: 4px 8px; }
`;

function Tweaker({ tokens, set, reset, close }: { tokens: Tokens; set: (k: string, v: string) => void; reset: () => void; close: () => void }) {
  const css = `:root {\n${Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;
  return (
    <div className="tweaker">
      {Object.keys(LABELS).map((k) => (
        <label key={k}>
          <span>
            {LABELS[k]} <code>{k}</code>
          </span>
          <input type="color" value={tokens[k]} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
      <div className="row">
        <button onClick={() => void navigator.clipboard?.writeText(css)}>Copy as CSS</button>
        <button onClick={reset}>Reset</button>
        <button onClick={close} style={{ marginLeft: 'auto' }}>
          Close
        </button>
      </div>
    </div>
  );
}

function Chrome({ open, tweak }: { open: VariantProps['open']; tweak: () => void }) {
  return (
    <>
      <div className="menubar">
        {['Game', 'View', 'Orders', 'Report', 'Colopedia'].map((m) => (
          <span key={m} className="m">
            {m}
          </span>
        ))}
        <span className="m" onClick={() => open('colony')}>
          ▸ New Amsterdam
        </span>
        <span className="m" onClick={() => open('europe')}>
          ▸ Europe
        </span>
        <span className="status">
          Score: {side.score} ✧ Gold: {money(side.gold)} ✧ Tax: {side.tax}% ✧ Year: {side.year}
        </span>
        <button className="btn tweak" onClick={tweak}>
          Colours
        </button>
      </div>
      <div className="minimap">
        <div>
          <i />
          <b />
        </div>
      </div>
      <div className="unitbuttons">
        {side.orders.map(([o, k]) => (
          <button key={o} className="btn">
            {o} <kbd>{k}</kbd>
          </button>
        ))}
      </div>
      <div className="infopanel">
        <img className="u" src={unitArt(side.unit.img)} alt="" />
        <span className="name">{side.unit.name}</span>
        <span>{side.unit.detail}</span>
        <span>Moves: {side.unit.moves}</span>
        <div className="tile">
          <span>
            {side.tile.name}
            <br />
            <span className="muted">{side.tile.owner}</span>
          </span>
          <span>
            {side.tile.produce.map(([g, n]) => (
              <span key={g} style={{ marginLeft: 8, fontWeight: 700 }}>
                <img className="icon" src={goodArt(g)} alt={GOOD_NAMES[g]} />
                {n}
              </span>
            ))}
          </span>
        </div>
      </div>
    </>
  );
}

function Frame({ cls, title, close, children }: { cls: string; title: string; close: () => void; children: React.ReactNode }) {
  return (
    <section className={`frame ${cls}`}>
      <div className="title">
        <span>{title}</span>
        <button onClick={close} title="Close (Esc)">
          ✕
        </button>
      </div>
      {children}
    </section>
  );
}

function Choice({ close }: { close: () => void }) {
  return (
    <Frame cls="choice" title={choice.title} close={close}>
      <div className="body">
        <img src={art(choice.img)} alt="" style={{ height: 70 }} />
        <p style={{ margin: 0 }}>{choice.text}</p>
        <div className="opts">
          {choice.options.map((o) => (
            <button key={o.label} className="btn" onClick={close}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function Colony({ close }: { close: () => void }) {
  const c = colony;
  const [h, hMax] = c.building.hammers;
  // Net production: everything the colony makes or uses, as FreeCol's row shows it.
  const net: [string, number][] = [
    ['food', c.food.made - c.food.eaten - c.food.horses],
    ...c.warehouse.filter(([g, , d]) => d !== 0 && g !== 'food').map(([g, , d]) => [g, d] as [string, number]),
    ['bells', 7],
    ['hammers', 3],
    ['crosses', 1],
  ];
  return (
    <Frame cls="colony" title={`${c.name} (population ${c.population})`} close={close}>
      <div className="cbody">
        <div className="pop box" style={{ paddingTop: 6 }}>
          <span>
            Rebels <b>{c.rebels}%</b> <span className="muted">(3 members)</span>
          </span>
          <span>
            Population <b>{c.population}</b> <span className="muted">bonus {c.bonus}</span>
          </span>
          <span>
            Royalists <b>{c.tories}%</b> <span className="muted">(3 members)</span>
          </span>
        </div>
        <div className="buildings">
          {c.buildings.map((b) => (
            <div key={b.name} className="bld" style={{ backgroundImage: `url(${art(`b-${b.img}`)})` }} title={b.name}>
              <span className="bn">{b.name}</span>
              <span className="prod">
                {b.out.map(([g, n]) => (
                  <span key={g} className={n === 0 ? 'muted' : ''}>
                    <img className="icon" src={goodArt(g)} alt={GOOD_NAMES[g]} />
                    {n}
                  </span>
                ))}
              </span>
              <span className="wk">
                {b.workers.map((w, i) => (
                  <img key={i} src={unitArt(w)} alt={UNIT_NAMES[w]} title={UNIT_NAMES[w]} />
                ))}
                {Array.from({ length: b.slots - b.workers.length }, (_, i) => (
                  <span key={i} className="slot" />
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="upper">
          <div className="iso">
            {c.tiles.map((t, i) => {
              const r = Math.floor(i / 3);
              const col = i % 3;
              return (
                <div key={i} className={`t ${t.owned ? 'owned' : ''}`} style={{ left: 128 + (col - r) * 64, top: (col + r) * 32, background: tileBg(t) }} title={t.name}>
                  {t.worker && <img className="who" src={unitArt(t.worker)} alt={UNIT_NAMES[t.worker]} />}
                  {(t.worker || t.centre) && (
                    <span className="pr">
                      {t.produce.map(([g, n]) => (
                        <span key={g}>
                          <img src={goodArt(g)} alt="" />
                          {n}{' '}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="box netprod">
            <span className="cap">Net production</span>
            {net.map(([g, n]) => (
              <span key={g} className={n < 0 ? 'neg' : ''} title={GOOD_NAMES[g]}>
                <img className="icon" src={goodArt(g)} alt={GOOD_NAMES[g]} />
                {signed(n)}
              </span>
            ))}
          </div>
          <div className="box construction">
            <span className="cap">Construction</span>
            <img src={art('b-schoolhouse')} alt="" style={{ width: 80, gridRow: 'span 3' }} />
            <b>
              {c.building.name} <span className="muted">({c.building.turns} turns)</span>
            </b>
            <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center' }}>
              <img className="icon" src={goodArt('hammers')} alt="Hammers" />
              <span className="bar">
                <i style={{ width: `${(100 * h) / hMax}%` }} />
              </span>
              {h}/{hMax}
            </span>
            <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center' }}>
              <img className="icon" src={goodArt('tools')} alt="Tools" />
              <span className="bar">
                <i style={{ width: '100%' }} />
              </span>
              {c.building.tools[0]}/{c.building.tools[1]}
            </span>
          </div>
        </div>
        <div className="box inport">
          <span className="cap">In port</span>
          <span className="muted">No ships in port</span>
        </div>
        <div className="row2">
          <div className="box">
            <span className="cap">Outside colony</span>
            {c.outside.map((o) => (
              <img key={o.name} src={unitArt(o.unit)} alt={o.name} title={`${o.name} (${o.state})`} />
            ))}
          </div>
          <div className="box">
            <span className="cap">Cargo</span>
          </div>
        </div>
        <div className="bottom">
          <div className="box warehouse">
            {c.warehouse.map(([g, n]) => (
              <div key={g} className={n === 0 ? 'zero' : ''} title={GOOD_NAMES[g]} style={n > c.capacity ? { color: 'var(--bad)' } : undefined}>
                <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
                {n}
              </div>
            ))}
          </div>
          <button className="btn">Warehouse</button>
          <button className="btn">Build queue</button>
          <button className="btn">Unload</button>
          <button className="btn ok" onClick={close}>
            OK
          </button>
        </div>
      </div>
    </Frame>
  );
}

function Europe({ close }: { close: () => void }) {
  const e = europe;
  const [inPort, sailing] = e.ships;
  return (
    <Frame cls="europe" title="Europe" close={close}>
      <div className="ebody">
        <h1>Amsterdam</h1>
        <div className="box">
          <span className="cap">Going to America</span>
          <div className="units">
            <img src={unitArt(sailing.img)} alt={sailing.name} title={`${sailing.name}: ${sailing.state}`} />
          </div>
        </div>
        <div className="box">
          <span className="cap">Going to Europe</span>
        </div>
        <div className="box log" style={{ gridRow: 'span 3' }}>
          <span className="cap">Log</span>
          <p>Sold 100 coats for 900 gold (tax 4%).</p>
          <p>Bought 100 tools for 200 gold.</p>
          <p>Recruited a Petty Criminal for 588 gold.</p>
        </div>
        <div className="box">
          <span className="cap">In port</span>
          <div className="ship">
            <img src={unitArt(inPort.img)} alt="" style={{ height: 56 }} />
            <span>
              <b>{inPort.name}</b>
              <br />
              <span className="muted">
                {inPort.cargo.length + inPort.units.length}/{inPort.holds} holds
              </span>
            </span>
          </div>
        </div>
        <div className="box" style={{ gridRow: 'span 2' }}>
          <span className="cap">Docks</span>
          <div className="units">
            {e.docks.map((u, i) => (
              <img key={i} src={unitArt(u)} alt={UNIT_NAMES[u]} title={UNIT_NAMES[u]} />
            ))}
          </div>
        </div>
        <div className="box">
          <span className="cap">Cargo</span>
          <div className="units" style={{ alignItems: 'center' }}>
            {inPort.cargo.map(([g, n]) => (
              <span key={g} style={{ fontWeight: 700 }}>
                <img className="icon" src={goodArt(g)} alt={GOOD_NAMES[g]} style={{ width: 32, height: 32 }} />
                {n}
              </span>
            ))}
            {inPort.units.map((u) => (
              <img key={u} src={unitArt(u)} alt={UNIT_NAMES[u]} />
            ))}
          </div>
        </div>
        <div className="box market">
          <span className="cap">Market (sell / buy)</span>
          {e.market.map(([g, s, b]) => (
            <div key={g} title={GOOD_NAMES[g]}>
              <img src={goodArt(g)} alt={GOOD_NAMES[g]} />
              <b>
                {s}/{b}
              </b>
            </div>
          ))}
        </div>
        <div className="ebuttons">
          <button className="btn">Recruit</button>
          <button className="btn">Purchase</button>
          <button className="btn">Train</button>
          <button className="btn">Unload</button>
          <button className="btn">Sail</button>
          <span style={{ flex: 1 }} />
          <button className="btn ok" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </Frame>
  );
}

export function VariantE({ show, theme, open }: VariantProps) {
  const base = theme === 'light' ? 'parchment' : 'dark';
  const [tweaks, setTweaks] = useState(loadTweaks);
  const [tweaking, setTweaking] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(tweaks));
    } catch {
      // No storage: tweaks last until reload.
    }
  }, [tweaks]);
  const tokens = { ...PRESETS[base], ...tweaks[base] };
  const close = () => open('none');
  return (
    <div className="ve" style={tokens as React.CSSProperties}>
      <style>{CSS}</style>
      <div className="map" style={mapStyle} />
      <Chrome open={open} tweak={() => setTweaking((t) => !t)} />
      {show === 'choice' && <Choice close={close} />}
      {(show === 'colony' || show === 'glance') && <Colony close={close} />}
      {show === 'europe' && <Europe close={close} />}
      {tweaking && (
        <Tweaker
          tokens={tokens}
          set={(k, v) => setTweaks((t) => ({ ...t, [base]: { ...t[base], [k]: v } }))}
          reset={() => setTweaks((t) => ({ ...t, [base]: {} }))}
          close={() => setTweaking(false)}
        />
      )}
    </div>
  );
}
