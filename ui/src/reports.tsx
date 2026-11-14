// The reports of the Report menu (FreeCol's report panels, Reports.java), each in a window frame
// (frame.tsx): the classic colony report, the labour report with its details, the compact labour report,
// the military, naval and cargo reports (one view, Units), and the religion, education, exploration,
// history, trade, production and requirements reports. A link in a report opens a colony's panel,
// Europe, a tile of the map or a detail report; the report closes first, as only one dialog is open at
// a time.
//
// To add a report: add its view to ReportView (webgui.ts), a body for it in BODIES below, and an entry
// in REPORTS, which is the Report menu. The Engine side is Reports.java.
import './reports.css';
import {
  Fragment,
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { flag } from './flag';
import { Select, Tip } from './controls';
import type { Dialog } from './dialogs';
import {
  boycottOf,
  ButtonRow,
  GoodsAmount,
  GoodsProgressBar,
  Heading,
  WindowFrame,
  type Art,
  type Menu,
} from './frame';
import type { CompactCell, ReportName, ReportView, UnitCount } from './webgui';

/** What a link in a report does (ClientExports.report, reportDetail and showColony, and the page's). */
export interface ReportActions {
  /** Open a report of the menu. */
  open: (name: ReportName) => void;
  /** Open the details a report links to, of a unit type (an empty id is all colonists). */
  detail: (name: ReportName, id: string) => void;
  colony: (id: string) => void;
  europe: () => void;
  /** Open the Colopedia on an entry (a goods type, a founding father...). */
  colopedia: (id: string) => void;
  /** Open the difficulty level report (the Colopedia's FreeColAction link "difficultyAction"). */
  difficulty: () => void;
  /** Centre the map on a tile. */
  goTo: (at: [number, number]) => void;
}

const none = () => {};
export const ReportContext = createContext<ReportActions>({
  open: none,
  detail: none,
  colony: none,
  europe: none,
  colopedia: none,
  difficulty: none,
  goTo: none,
});

/**
 * The Report menu's entries, in order: the report's name, which Commands.showReport knows, its label, and
 * its hotkey, FreeCol's own: the plain F key (F1 religion, F2 labour, ...) and, for the five FreeCol puts
 * on Shift+F (cargo, education, exploration, history, production), Shift with it. The page takes these
 * keys from the browser while a game runs (report-keys.ts).
 */
export const REPORTS: readonly {
  name: Exclude<ReportName, 'labourDetail' | 'colopedia'>;
  label: string;
  key?: string;
}[] = [
  { name: 'colony', label: 'Colony report', key: 'F3' },
  { name: 'labour', label: 'Labour report', key: 'F2' },
  { name: 'compactLabour', label: 'Compact labour report' },
  { name: 'military', label: 'Military report', key: 'F7' },
  { name: 'naval', label: 'Naval report', key: 'F8' },
  { name: 'cargo', label: 'Cargo report', key: 'Shift+F1' },
  { name: 'congress', label: 'Continental Congress report', key: 'F6' },
  { name: 'education', label: 'Education report', key: 'Shift+F5' },
  { name: 'exploration', label: 'Exploration report', key: 'Shift+F2' },
  { name: 'foreign', label: 'Foreign affairs report', key: 'F4' },
  { name: 'history', label: 'History report', key: 'Shift+F3' },
  { name: 'indian', label: 'Native affairs report', key: 'F5' },
  { name: 'production', label: 'Production report', key: 'Shift+F4' },
  { name: 'religion', label: 'Religion report', key: 'F1' },
  { name: 'requirements', label: 'Requirements report', key: 'F12' },
  { name: 'trade', label: 'Trade report', key: 'F9' },
];

/** The section the Colopedia opens on, set by the Colopedia menu before it asks for the report. */
let colopediaStart: string | null = null;
export const startColopediaAt = (section: string | null) => {
  colopediaStart = section;
};

/** The Colopedia menu's entries, FreeCol's sections: each opens the Colopedia on it. */
export const COLOPEDIA_SECTIONS: readonly { id: string; label: string }[] = [
  { id: 'terrain', label: 'Terrain Types' },
  { id: 'resources', label: 'Bonus Resources' },
  { id: 'goods', label: 'Goods' },
  { id: 'units', label: 'Units' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'fathers', label: 'Founding Fathers' },
  { id: 'nations', label: 'Nations' },
  { id: 'nationTypes', label: 'National Advantages' },
  { id: 'concepts', label: 'Concepts' },
];

export const colopediaMenu = (open: ReportActions['open']): Menu['items'] =>
  COLOPEDIA_SECTIONS.map((s) => ({
    label: s.label,
    run: () => {
      startColopediaAt(s.id);
      open('colopedia');
    },
  }));

/** The key of the Turn Report entry: FreeCol's F11 (full screen is FreeCol's Alt+Enter, not F11). */
export const TURN_REPORT_KEY = 'F11';

/**
 * The Report menu's items, each opening its report, and the Turn Report (ReportTurnAction, after the
 * trade report as in FreeCol) which shows this turn's messages again; null while the game has not loaded.
 */
export const reportMenu = (open: ReportActions['open'], turnReport: (() => void) | null): Menu['items'] =>
  REPORTS.flatMap((r) => [
    { label: r.label, hint: r.key, run: () => open(r.name) },
    ...(r.name === 'trade'
      ? [{ label: 'Turn report', hint: TURN_REPORT_KEY, run: turnReport ?? (() => {}), disabled: !turnReport }]
      : []),
  ]);

type View<K extends ReportName> = Extract<ReportView, { report: K }>;

/** An image of a game object, if the Tileset has one. */
function Img({
  keys,
  art,
  title,
  dim,
  unit,
}: {
  keys: readonly string[];
  art: Art;
  title?: string;
  dim?: boolean;
  /** The unit it shows, by id. */
  unit?: string;
}) {
  const src = art(keys);
  return src === null ? null : (
    <Tip as="img" className="pic" src={src} alt={title ?? ''} tip={title} data-dim={flag(dim)} data-unit={unit} />
  );
}

/** A link to something, as the Swing report's link buttons. */
function Link({ children, go, ...rest }: { children: ReactNode; go: () => void } & Record<`data-${string}`, string>) {
  return (
    <button className="link" onClick={go} {...rest}>
      {children}
    </button>
  );
}

/** ReportClassicColonyPanel: per colony its name, people, goods and buildings. */
function ColonyReport({ e, art, go }: { e: View<'colony'>; art: Art; go: Links }) {
  return (
    <div className="colonies">
      {e.colonies.map((c) => (
        <section key={c.id} data-colony={c.id}>
          <Heading>
            <Link go={() => go.colony(c.id)} data-link={c.id}>
              {c.name}
            </Link>
          </Heading>
          <div className="row" data-list="colonists">
            {c.colonists.map((u) => (
              <Img key={u.id} keys={u.keys} art={art} title={u.name} unit={u.id} />
            ))}
          </div>
          <div className="row" data-list="outside">
            {c.outside.map((u) => (
              <Img key={u.id} keys={u.keys} art={art} title={u.name} unit={u.id} />
            ))}
            {c.building?.unit && <Img keys={c.building.keys} art={art} title={c.building.name} dim />}
          </div>
          <div className="row" data-list="goods">
            {c.goods.map((g) => (
              <span key={g.type} className="made" data-goods={g.type}>
                <GoodsAmount
                  keys={g.keys}
                  name={g.name}
                  amount={g.amount}
                  stock={g.stock}
                  expert={g.max}
                  icons
                  art={art}
                  tip={`${g.name}: ${g.stock} in store, up to ${g.max} a turn`}
                />
              </span>
            ))}
          </div>
          <div className="row" data-list="buildings">
            {c.buildings.map((b) => (
              <Img key={b.id} keys={b.keys} art={art} title={b.name} />
            ))}
            {c.building && !c.building.unit && <Img keys={c.building.keys} art={art} title={c.building.name} dim />}
          </div>
        </section>
      ))}
    </div>
  );
}

/** ReportCompactColonyPanel: a table with a row for each colony, a summary for each continent. */
function CompactColonyReport({ e, art, go }: { e: View<'compactColony'>; art: Art; go: Links }) {
  const head = (key: string) => (
    <tr key={key} className="heads">
      {e.columns.map((c, i) => (
        <Tip as="th" key={i} scope="col" tip={c.tip} data-left={c.left} data-dim={flag(c.dim)}>
          {c.keys && <Img keys={c.keys} art={art} />}
          {c.label}
        </Tip>
      ))}
    </tr>
  );
  const cells = (row: CompactCell[]) =>
    row.map((cell, i) => (
      <td key={i} data-left={e.columns[i].left}>
        {cell.items.map((item, j) => {
          const body = (
            <>
              {item.keys && <Img keys={item.keys} art={art} />}
              {item.text}
            </>
          );
          return item.link === null ? (
            <Tip as="span" key={j} className="item" data-tone={item.tone} data-bold={flag(item.bold)} tip={item.tip}>
              {body}
            </Tip>
          ) : (
            <Tip
              as="button"
              key={j}
              className="item link"
              data-tone={item.tone}
              data-bold={flag(item.bold)}
              tip={item.tip}
              data-link={item.link}
              onClick={() => go.colony(item.link as string)}
            >
              {body}
            </Tip>
          );
        })}
      </td>
    ));
  return (
    <table className="compact-colonies">
      <thead>{head('top')}</thead>
      {e.groups.map((g, gi) => (
        <tbody key={gi}>
          {g.rows.map((r) => (
            <tr key={r.id} data-colony={r.id}>
              {cells(r.cells)}
            </tr>
          ))}
          {g.summary && (
            <tr className="summary" data-summary="true">
              {cells(g.summary)}
            </tr>
          )}
          {head('end')}
        </tbody>
      ))}
    </table>
  );
}

/** ReportLabourPanel: each kind of person with how many there are; a click opens the details. */
function LabourReport({ e, art, go }: { e: View<'labour'>; art: Art; go: Links }) {
  return (
    <div className="labour-types">
      {e.types.map((t) => (
        <button
          key={t.id}
          className="labour-type"
          data-type={t.id}
          disabled={t.count === 0}
          onClick={() => go.detail('labourDetail', t.id)}
        >
          <Img keys={t.keys} art={art} dim={t.count === 0} />
          <span className="name">{t.name}</span>
          <span className="count">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

/** ReportLabourDetailPanel: where the people of one kind are. */
function LabourDetail({ e, art, go }: { e: View<'labourDetail'>; art: Art; go: Links }) {
  return (
    <div className="labour-detail">
      <div className="head">
        <Img keys={e.unit.keys} art={art} />
        <strong>{e.unit.name}</strong>
        <span className="count">{e.total}</span>
      </div>
      <dl>
        {e.colonies.map((c) => (
          <div key={c.id}>
            <dt>
              <Link go={() => go.colony(c.id)} data-link={c.id}>
                {c.canTrain ? `${c.name}*` : c.name}
              </Link>
            </dt>
            <dd>{c.count}</dd>
          </div>
        ))}
        {/* By place: two tiles can share a label, "Plains (north of Jamestown)". */}
        {e.places.map((p, i) => (
          <div key={i}>
            <dt>
              {p.europe || p.at ? (
                <Link go={() => (p.europe ? go.europe() : p.at && go.goTo(p.at))}>{p.label}</Link>
              ) : (
                p.label
              )}
            </dt>
            <dd>{p.count}</dd>
          </div>
        ))}
        {e.atSea.map((p, i) => (
          <div key={i}>
            <dt>{p.label}</dt>
            <dd>{p.count}</dd>
          </div>
        ))}
      </dl>
      {e.canTrain && <p className="muted">{e.canTrain}</p>}
    </div>
  );
}

/** CompactLabourReport: a table of what the colonists do, by kind or by place. */
function CompactLabour({ e, art, go }: { e: View<'compactLabour'>; art: Art; go: Links }) {
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <>
      {e.unit && (
        <div className="head">
          <Img keys={e.unit.keys} art={art} />
          <strong>{e.unit.name}</strong>
        </div>
      )}
      <table className="compact-labour">
        <thead>
          <tr>
            <td />
            <th scope="col">{e.headers.unitType}</th>
            <th scope="col">{e.headers.workingAs}</th>
            <th scope="col" colSpan={2}>
              {e.headers.colonists}
            </th>
            {e.showProduction && (
              <th scope="col" colSpan={2}>
                {e.goods ? <Img keys={e.goods} art={art} /> : e.headers.production}
              </th>
            )}
            {e.showNet && <th scope="col">{e.storedAs ? <Img keys={e.storedAs} art={art} /> : e.goods ? null : ''}</th>}
          </tr>
        </thead>
        <tbody>
          {e.groups.map((g, i) => {
            const rows = g.rows.length > 0 ? g.rows : [null];
            const span = rows.length;
            return rows.map((r, j) => (
              <tr key={`${i}.${j}`} data-group={i}>
                {j === 0 && (
                  <th rowSpan={span} scope="rowgroup">
                    {g.keys && <Img keys={g.keys} art={art} />}
                    {g.link ? (
                      <Link
                        data-link={g.link.id}
                        go={() => {
                          const l = g.link!;
                          if (l.kind === 'colony') go.colony(l.id);
                          else if (l.kind === 'europe') go.europe();
                          else go.detail('compactLabour', l.id);
                        }}
                      >
                        {g.label}
                      </Link>
                    ) : (
                      g.label
                    )}
                  </th>
                )}
                <td>{r?.unit}</td>
                <td>{r?.doing}</td>
                <td className="num" data-counted={r?.counted}>
                  {r?.count}
                </td>
                {j === 0 && (
                  <td className="num total" rowSpan={span}>
                    {g.summary.colonists}
                  </td>
                )}
                {e.showProduction && <td className="num">{r && r.production > 0 ? r.production : ''}</td>}
                {j === 0 && e.showProduction && (
                  <td className="num" rowSpan={span}>
                    {g.summary.production > 0 ? g.summary.production : ''}
                  </td>
                )}
                {j === 0 && e.showNet && (
                  <td className="num" rowSpan={span} data-sign={g.summary.net < 0 ? 'loss' : undefined}>
                    {g.summary.hasNet ? sign(g.summary.net) : ''}
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
      </table>
      {e.canTrain && <p className="muted">{e.canTrain}</p>}
    </>
  );
}

/** ReportUnitPanel: the force by kind (the king's too), then the units place by place. */
/** Units in runs of one kind (type and role, which the Engine sorts them by), a row for each run. */
function byKind<U extends { name: string }>(units: U[]): U[][] {
  const runs: U[][] = [];
  for (const u of units) {
    const run = runs.at(-1);
    if (run && run[0].name === u.name) run.push(u);
    else runs.push([u]);
  }
  return runs;
}

function Units({ e, art, go }: { e: View<'military' | 'naval' | 'cargo'>; art: Art; go: Links }) {
  const force = (f: { name: string; units: UnitCount[] }, which: string) => (
    <section data-force={which}>
      <Heading>{f.name}</Heading>
      <div className="row">
        {f.units.map((u) => (
          <Tip as="span" key={`${u.type}${u.keys[0]}`} className="made" tip={u.text} data-type={u.type}>
            <Img keys={u.keys} art={art} title={u.name} />
            <span className="stock">{u.count}</span>
          </Tip>
        ))}
      </div>
    </section>
  );
  return (
    <div className="unit-report">
      {e.ref && force(e.ref, 'ref')}
      {force(e.forces, 'ours')}
      {e.locations.map((p) => (
        <section key={p.link.id} data-place={p.link.id}>
          <Heading>
            <Link
              data-link={p.link.id}
              go={() => {
                if (p.link.kind === 'colony') go.colony(p.link.id);
                else if (p.link.kind === 'europe') go.europe();
                else if (p.link.at) go.goTo(p.link.at);
              }}
            >
              {p.label}
            </Link>
          </Heading>
          {p.units.length === 0 && <span className="muted">{e.none}</span>}
          {byKind(p.units).map((kind) => (
            <div key={kind[0].id} className="row kind" data-kind={kind[0].name}>
              {kind.map((u) => (
                <span key={u.id} className="unit" data-list="unit">
                  <Img keys={u.keys} art={art} title={u.text} unit={u.id} />
                  {/* By place: FreeCol lists cargo in loads of 100, so 200 muskets are two of them. */}
                  {u.goods.map((g, i) => (
                    <GoodsAmount key={i} keys={g.keys} name={g.name} amount={g.amount} art={art} {...boycottOf(g)} />
                  ))}
                  {u.cargo.map((c) => (
                    <Img key={c.id} keys={c.keys} art={art} title={c.name} unit={c.id} />
                  ))}
                </span>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** ReportReligiousPanel: the progress of each kind of immigration goods, and the buildings that make it. */
function ReligionReport({ e, art, go }: { e: View<'religion'>; art: Art; go: Links }) {
  return (
    <div className="religion">
      {e.goods.map((g) => (
        <section key={g.type} data-goods={g.type}>
          <Heading>
            <Img keys={g.keys} art={art} title={g.name} />
            {g.name}
          </Heading>
          <GoodsProgressBar need={g.bar} art={art} />
          <div className="places">
            {g.colonies.map((c) => (
              <div key={c.id} className="place" data-colony={c.id}>
                <Link go={() => go.colony(c.id)} data-link={c.id}>
                  {c.name}
                </Link>
                <Img keys={c.building.keys} art={art} title={c.building.name} />
                {c.production && (
                  <span className="made" data-field="production">
                    <GoodsAmount
                      keys={c.production.keys}
                      name={c.production.name}
                      amount={c.production.amount}
                      expert={c.production.max}
                      icons
                      art={art}
                    />
                  </span>
                )}
                <span className="row" data-list="workers">
                  {c.workers.map((u) => (
                    <Img key={u.id} keys={u.keys} art={art} title={u.name} unit={u.id} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** ReportEducationPanel: for each school its building, the colonists who could teach in it and those who could learn. */
function EducationReport({ e, art, go }: { e: View<'education'>; art: Art; go: Links }) {
  return (
    <div className="education">
      {e.colonies.map((c, i) => (
        <section key={`${c.id}.${i}`} data-colony={c.id}>
          <Heading>
            <Link go={() => go.colony(c.id)} data-link={c.id}>
              {c.name}
            </Link>
            <Img keys={c.building.keys} art={art} title={c.building.name} />
          </Heading>
          <fieldset data-list="teachers">
            <legend>{e.headers.teachers}</legend>
            {c.teachers.map((u) => (
              <Img key={u.id} keys={u.keys} art={art} title={u.name} unit={u.id} />
            ))}
          </fieldset>
          <fieldset data-list="students">
            <legend>{e.headers.students}</legend>
            {c.students.map((u) => (
              <Img key={u.id} keys={u.keys} art={art} title={`${u.name}: ${u.learns}`} unit={u.id} />
            ))}
          </fieldset>
        </section>
      ))}
    </div>
  );
}

/** ReportExplorationPanel: the regions that have been discovered, by whom and when. */
function ExplorationReport({ e }: { e: View<'exploration'> }) {
  return (
    <table className="exploration">
      <thead>
        <tr>
          <th scope="col">{e.headers.name}</th>
          <th scope="col">{e.headers.type}</th>
          <th scope="col">{e.headers.discoveredIn}</th>
          <th scope="col">{e.headers.discoveredBy}</th>
          <th scope="col">{e.headers.value}</th>
        </tr>
      </thead>
      <tbody>
        {e.regions.map((r, i) => (
          <tr key={i}>
            <td>{r.name}</td>
            <td>{r.type}</td>
            <td>{r.turn}</td>
            <td>{r.by}</td>
            <td className="num">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ReportHistoryPanel: what has happened to the player, turn by turn. */
function HistoryReport({ e }: { e: View<'history'> }) {
  return (
    <table className="history">
      <tbody>
        {e.events.map((h, i) => (
          <tr key={i}>
            <th scope="row">{h.turn}</th>
            <td>{h.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** ReportTradePanel: the market, what was sold, and what each colony stores and makes, for every storable goods. */
function TradeReport({ e, art, go }: { e: View<'trade'>; art: Art; go: Links }) {
  const totals: [keyof typeof e.labels, number[], boolean][] = [
    ['unitsSold', e.sold, false],
    ['beforeTaxes', e.beforeTaxes, false],
    ['afterTaxes', e.afterTaxes, false],
    ['cargoUnits', e.cargo, false],
  ];
  const number = (n: number, sign = false, key?: string) => (
    <td key={key} className="num" data-sign={n < 0 ? 'loss' : undefined}>
      {sign ? signed(n) : n}
    </td>
  );
  return (
    <table className="trade">
      <thead>
        <tr>
          <td />
          {e.goods.map((g) => (
            <Tip as="th" key={g.type} scope="col" data-goods={g.type} tip={g.name}>
              <Img keys={g.keys} art={art} title={g.name} />
              {g.sell !== null && g.buy !== null && <span className="prices">{`${g.sell}/${g.buy}`}</span>}
            </Tip>
          ))}
        </tr>
      </thead>
      <tbody>
        {totals.map(([label, values]) => (
          <tr key={label} data-row={label}>
            <th scope="row">{e.labels[label]}</th>
            {values.map((n, i) => number(n, false, e.goods[i].type))}
          </tr>
        ))}
        {e.colonies.map((c) => (
          <tr key={c.id} data-colony={c.id}>
            <th scope="row">
              <Link go={() => go.colony(c.id)} data-link={c.id}>
                {c.export ? `${c.name}*` : c.name}
              </Link>
            </th>
            {c.cells.map((cell, i) => (
              <Tip
                as="td"
                key={e.goods[i].type}
                className="num cell"
                data-sign={cell.production < 0 ? 'loss' : undefined}
                data-warn={flag(cell.warning)}
                tip={
                  cell.warning ??
                  (cell.exported !== null ? `${e.goods[i].name}: exported at ${cell.exported}` : undefined)
                }
              >
                <span className="stock" data-exported={flag(cell.exported !== null)}>
                  {cell.amount}
                </span>
                <span className="net">{signed(cell.production)}</span>
              </Tip>
            ))}
          </tr>
        ))}
        <tr data-row="totalUnits">
          <th scope="row">{e.labels.totalUnits}</th>
          {e.total.map((n, i) => number(n, false, e.goods[i].type))}
        </tr>
        <tr data-row="totalDelta">
          <th scope="row">{e.labels.totalDelta}</th>
          {e.delta.map((n, i) => number(n, true, e.goods[i].type))}
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={e.goods.length + 1} className="muted">
            {e.labels.hasCustomHouse}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** How many goods the production report compares at once (ReportProductionPanel's boxes). */
const PICKS = 4;

/** ReportProductionPanel: pick up to four goods, and see each colony's output and the buildings that make it. */
function ProductionReport({ e, art, go }: { e: View<'production'>; art: Art; go: Links }) {
  const [picks, setPicks] = useState<string[]>(() => Array(PICKS).fill(''));
  const chosen = picks.flatMap((p) => (p === '' ? [] : [Number(p)]));
  return (
    <div className="production">
      <div className="picks">
        <span>{e.labels.selectGoods}</span>
        {picks.map((p, i) => (
          <Select
            key={i}
            aria-label={`${e.labels.selectGoods} ${i + 1}`}
            value={p}
            onChange={(v) => setPicks(picks.map((q, j) => (j === i ? v : q)))}
            choices={[
              { value: '', label: e.labels.nothing },
              ...e.goods.map((g, k) => ({ value: String(k), label: g.name })),
            ]}
          />
        ))}
      </div>
      {chosen.length > 0 && (
        <table className="production-table">
          <thead>
            <tr>
              <th scope="col">{e.labels.colony}</th>
              {chosen.map((k) => (
                <th key={k} scope="colgroup" colSpan={1 + e.goods[k].buildings.length} data-goods={e.goods[k].type}>
                  <Img keys={e.goods[k].keys} art={art} title={e.goods[k].name} />
                  {e.goods[k].name}
                  {e.goods[k].buildings.map((b) => (
                    <Img key={b.id} keys={b.keys} art={art} title={b.name} />
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {e.colonies.map((c) => (
              <tr key={c.id} data-colony={c.id}>
                <th scope="row">
                  <Link go={() => go.colony(c.id)} data-link={c.id}>
                    {c.name}
                  </Link>
                </th>
                {chosen.flatMap((k) => [
                  <td key={`${k}.amount`} className="num" data-sign={c.cells[k].amount < 0 ? 'loss' : undefined}>
                    <Img keys={e.goods[k].keys} art={art} title={e.goods[k].name} />
                    {signed(c.cells[k].amount)}
                  </td>,
                  ...c.cells[k].buildings.map((units, b) => (
                    <td key={`${k}.${b}`} data-building={e.goods[k].buildings[b].id}>
                      {units?.map((u) => (
                        <Img key={u.id} keys={u.keys} art={art} title={u.name} unit={u.id} />
                      ))}
                    </td>
                  )),
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** ReportRequirementsPanel: for each colony what it lacks, and which colonies could help. */
function RequirementsReport({ e, go }: { e: View<'requirements'>; go: Links }) {
  return (
    <div className="requirements">
      {e.colonies.map((c) => (
        <section key={c.id} data-colony={c.id}>
          <Heading>
            <Link go={() => go.colony(c.id)} data-link={c.id}>
              {c.name}
            </Link>
          </Heading>
          {c.items.map((item, i) => (
            <p key={i} data-item={i}>
              {item.text}
              {/* By place: FreeCol names a colony once per misused expert, so it can come twice. */}
              {item.colonies.map((l, j) => (
                <span key={j}>
                  {j === 0 ? ' ' : ', '}
                  <Link go={() => go.colony(l.id)} data-link={l.id}>
                    {l.name}
                  </Link>
                  {l.info}
                </span>
              ))}
            </p>
          ))}
          {c.met && <p className="muted">{c.met}</p>}
        </section>
      ))}
    </div>
  );
}

/** A description with its [[id|text]] links as buttons that go to the entry. */
function Linked({ text, go }: { text: string; go: (id: string) => void }) {
  const parts = text.split(/\[\[([^|\]]+)\|([^\]]*)\]\]/);
  return (
    <>
      {parts.map((part, i) =>
        i % 3 === 0 ? (
          part
        ) : i % 3 === 1 ? (
          <Link key={i} go={() => go(part)} data-link={part}>
            {parts[i + 1]}
          </Link>
        ) : null,
      )}
    </>
  );
}

/**
 * ColopediaPanel: a tree of the sections and their entries (under a heading for each sub-category) on the
 * left, the chosen entry on the right. A link in a fact or a description goes to its entry.
 */
function Colopedia({ e, art, go: links }: { e: View<'colopedia'>; art: Art; go: Links }) {
  const where = (id: string | null) => e.sections.find((s) => s.entries.some((x) => x.id === id));
  const [start] = useState(() => {
    const wanted = e.select ?? null;
    const section = where(wanted) ?? e.sections.find((s) => s.id === colopediaStart) ?? e.sections[0];
    colopediaStart = null; // used once: a later open without the menu starts at the top
    return { section: section?.id ?? '', entry: where(wanted) ? wanted : (section?.entries[0]?.id ?? null) };
  });
  const [section, setSection] = useState(start.section);
  const [chosen, setChosen] = useState<string | null>(start.entry);
  const entry = e.sections.flatMap((s) => s.entries).find((x) => x.id === chosen);
  const go = (id: string) => {
    // A link to a FreeColAction (Reports.plain makes it [[action/NAME|text]]).
    if (id === 'action/difficultyAction') return links.difficulty();
    const s = where(id);
    if (!s) return;
    setSection(s.id);
    setChosen(id);
  };
  return (
    <div className="colopedia">
      <ul className="tree" role="tree">
        {e.sections.map((s) => (
          <li key={s.id} role="treeitem" aria-expanded={section === s.id} data-section={s.id}>
            <button
              data-node="section"
              onClick={() => {
                setSection(s.id);
                setChosen(s.entries[0]?.id ?? null);
              }}
            >
              {section === s.id ? '▾ ' : '▸ '}
              {s.name}
            </button>
            {section === s.id && (
              <ul role="group">
                {s.entries.map((x, i) => (
                  <Fragment key={x.id}>
                    {x.group !== null && x.group !== s.entries[i - 1]?.group && (
                      <li role="presentation" className="group">
                        {x.group}
                      </li>
                    )}
                    <li role="treeitem" aria-selected={chosen === x.id} data-entry={x.id}>
                      <button onClick={() => setChosen(x.id)}>
                        <Img keys={x.keys} art={art} />
                        {x.name}
                      </button>
                    </li>
                  </Fragment>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <article className="detail">
        {entry && (
          <>
            <Heading>{entry.name}</Heading>
            <Img keys={entry.keys} art={art} title={entry.name} />
            <dl>
              {entry.facts.map((f, i) => (
                <div key={i}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.value}
                    {/* By place: a fact can name one type twice (a nation's starting units, R-9EGSK). */}
                    {f.refs.map((r, j) => (
                      <span key={j} className="ref">
                        <Img keys={r.keys} art={art} />
                        <Link go={() => go(r.id)} data-link={r.id}>
                          {r.name}
                        </Link>
                        {r.note !== null && ` (${r.note})`}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            {entry.text
              .split('\n')
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>
                  <Linked text={p} go={go} />
                </p>
              ))}
          </>
        )}
      </article>
    </div>
  );
}

/**
 * ReportForeignAffairPanel: a column for each nation (its coat of arms and name) and a row for each measure, so the
 * nations compare at a glance. What we have not learnt of a nation is left blank, and its stance is coloured.
 */
function ForeignReport({ e, art }: { e: View<'foreign'>; art: Art }) {
  const l = e.labels;
  const rows = [
    ['stance', l.stance, ''],
    ['colonies', l.colonies, ''],
    ['units', l.units, ''],
    ['military', l.military, ''],
    ['naval', l.naval, ''],
    ['gold', l.gold, ''],
    ['fathers', l.fathers, ''],
    ['tax', l.tax, '%'],
    ['sol', l.sol, '%'],
  ] as const;
  return (
    <div className="foreign">
      <table>
        <thead>
          <tr>
            <td />
            {e.nations.map((n) => (
              <th key={n.id} scope="col" data-nation={n.id}>
                <Img keys={n.keys} art={art} title={n.name} />
                <span>{n.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, label, unit]) => (
            <tr key={field} data-field={field}>
              <th scope="row">{label}</th>
              {e.nations.map((n) => {
                const v = n[field];
                return (
                  <td
                    key={n.id}
                    data-nation={n.id}
                    data-stance={field === 'stance' ? n.stanceKind : undefined}
                    data-known={v !== null}
                  >
                    {v === null ? '' : `${v}${unit}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" data-field="notice">
        {e.notice}
      </p>
    </div>
  );
}

/** A label with its image, when it has one. */
function Tagged({ x, art }: { x: { text: string; keys: string[] | null }; art: Art }) {
  return x.keys && art(x.keys) ? <Img keys={x.keys} art={art} title={x.text} /> : <span>{x.text}</span>;
}

/** ReportIndianPanel: each contacted tribe, and a row for each settlement we know of. */
function IndianReport({ e, art, go }: { e: View<'indian'>; art: Art; go: Links }) {
  const l = e.labels;
  return (
    <div className="indian">
      {e.tribes.map((t) => (
        <section key={t.id} data-tribe={t.id}>
          <Heading>
            <Img keys={t.keys} art={art} title={t.kind} />
            {t.name}
          </Heading>
          <dl>
            {(
              [
                ['chieftain', l.chieftain, t.chieftain],
                ['kind', l.kind, t.kind],
                ['settlements', l.settlements, t.settlements],
                ['tension', l.tension, t.tension],
              ] as const
            ).map(([field, label, v]) => (
              <div key={field} data-field={field}>
                <dt>{label}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {t.rows.length === 0 ? (
            <p className="muted">{l.none}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {l.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.id} data-settlement={r.id}>
                    <td>
                      <Link go={() => go.goTo(r.at)} data-link={r.id}>
                        {r.name}
                      </Link>
                      {r.capital && <span className="tag">{e.labels.capital}</span>}
                      {r.scout && <span className="tag">{e.labels.scout}</span>}
                    </td>
                    <td data-cell="mission">
                      {r.mission && <Img keys={r.mission.keys} art={art} title={r.mission.text} />}
                    </td>
                    <td data-cell="alarm">{r.alarm}</td>
                    <td data-cell="skill">
                      <Tagged x={r.skill} art={art} />
                    </td>
                    <td data-cell="hated">{r.hated}</td>
                    <td data-cell="wanted">
                      {r.wanted.map((w, i) => (
                        <Tagged key={i} x={w} art={art} />
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * ReportContinentalCongressPanel: its tabs, the father being recruited first (his name, portrait and the bells
 * towards him), then a tab for each kind of father with their portraits side by side, each named with its state.
 */
function CongressReport({ e, art, go }: { e: View<'congress'>; art: Art; go: Links }) {
  const kinds = [...new Set(e.fathers.map((f) => f.kind))];
  const tabs = [e.labels.recruiting, ...kinds];
  const [open, setOpen] = useState(0);
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    ev.preventDefault();
    const next = (open + step + tabs.length) % tabs.length;
    setOpen(next);
    (ev.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  // getFoundingFatherImage: the portrait at its own size, grey (dim) for a father not yet elected.
  const portrait = (keys: string[], tip: string, dim = false) => {
    const src = art(keys);
    return src === null ? null : <Tip as="img" className="portrait" src={src} alt="" tip={tip} data-dim={flag(dim)} />;
  };
  const name = (id: string, text: string, tip: string) => (
    <Tip as="span" tip={tip}>
      <Link go={() => go.colopedia(id)} data-link={id}>
        {text}
      </Link>
    </Tip>
  );
  const kind = kinds[open - 1];
  return (
    <div className="congress">
      <div className="tabs" role="tablist" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t}
            role="tab"
            id={`congress-tab-${i}`}
            aria-selected={i === open}
            aria-controls="congress-tab"
            tabIndex={i === open ? 0 : -1}
            onClick={() => setOpen(i)}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="congress-tab" aria-labelledby={`congress-tab-${open}`}>
        {open === 0 ? (
          <section data-section="recruiting">
            {e.current ? (
              <div data-current={e.current.id}>
                {name(e.current.id, e.current.name, e.current.description)}
                {portrait(e.current.keys, e.current.description)}
                {e.current.bars.map((bar) => (
                  <GoodsProgressBar key={bar.type} need={bar} art={art} />
                ))}
              </div>
            ) : (
              <p className="muted">{e.labels.none}</p>
            )}
          </section>
        ) : (
          <section data-kind={kind}>
            {e.fathers
              .filter((f) => f.kind === kind)
              .map((f) => (
                <div key={f.id} className="father" data-father={f.id} data-state={f.state}>
                  {portrait(f.keys, f.description, f.state !== 'elected')}
                  {name(f.id, f.name, f.description)}
                  <span className="muted" data-field="status">
                    {f.status}
                  </span>
                </div>
              ))}
          </section>
        )}
      </div>
    </div>
  );
}

type Links = Pick<ReportActions, 'colony' | 'detail' | 'europe' | 'goTo' | 'colopedia' | 'difficulty'>;
type Body<K extends ReportName> = (p: { e: View<K>; art: Art; go: Links }) => ReactNode;

/** The body of each report: every report the Engine sends needs one, or this does not compile. */
/**
 * The reports whose content changes while they stay open (an entry chosen, a tab opened) have one width, so the
 * window does not jump (reports.css, `data-fixed`): their text wraps in it. Sized in em to follow the font.
 */
const FIXED_WIDTH: Partial<Record<ReportName, string>> = { colopedia: '58em', congress: '60em' };

const BODIES: { [K in ReportName]: Body<K> } = {
  colony: ColonyReport,
  compactColony: CompactColonyReport,
  labour: LabourReport,
  labourDetail: LabourDetail,
  compactLabour: CompactLabour,
  military: Units,
  naval: Units,
  cargo: Units,
  religion: ReligionReport,
  education: EducationReport,
  exploration: ExplorationReport,
  history: HistoryReport,
  trade: TradeReport,
  production: ProductionReport,
  requirements: RequirementsReport,
  foreign: ForeignReport,
  indian: IndianReport,
  congress: CongressReport,
  colopedia: Colopedia,
};

/**
 * A report in its window. Its close button closes it; a detail has a back button instead, which opens the
 * report it came from (the title bar's ✕ still closes it); a link closes it, then does what it says.
 */
export function ReportPanel({ d, e, art }: { d: Dialog; e: ReportView; art: Art }) {
  const actions = useContext(ReportContext);
  const close = () => (d.done as () => void)();
  const after = <A extends unknown[]>(f: (...a: A) => void) => {
    return (...a: A) => {
      close();
      f(...a);
    };
  };
  const go: Links = {
    colony: after(actions.colony),
    detail: (name, id) => actions.detail(name, id),
    europe: after(actions.europe),
    // The Colopedia is a report: it replaces this one, so there is nothing to close.
    colopedia: actions.colopedia,
    difficulty: after(actions.difficulty),
    goTo: after(actions.goTo),
  };
  const Content = BODIES[e.report] as Body<ReportName>;
  return (
    <WindowFrame
      className="dialog"
      aria-modal="true"
      data-kind="report"
      data-report={e.report}
      data-fixed={flag(e.report in FIXED_WIDTH)}
      style={e.report in FIXED_WIDTH ? ({ '--window-width': FIXED_WIDTH[e.report] } as CSSProperties) : undefined}
      title={e.title}
      close={close}
    >
      <div className="report">
        <Content e={e} art={art} go={go} />
      </div>
      <ButtonRow>
        {e.back ? (
          <button data-answer="back" onClick={() => actions.open(e.back!)}>
            Back
          </button>
        ) : (
          <button data-answer="close" onClick={close}>
            {e.ok}
          </button>
        )}
      </ButtonRow>
    </WindowFrame>
  );
}
