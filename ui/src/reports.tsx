// The reports of the Report menu (FreeCol's report panels, Reports.java), each in a window frame
// (frame.tsx): the classic colony report, the labour report with its details, the compact labour report,
// the military, naval and cargo reports (one view, Units), and the religion, education, exploration and
// history reports. A link in a report opens a colony's panel, Europe, a tile of the map or a detail
// report; the report closes first, as only one dialog is open at a time.
//
// To add a report (#74 and the rest of #75): add its view to ReportView (webgui.ts), a body for it in
// BODIES below, and an entry in REPORTS, which is the Report menu. The Engine side is Reports.java.
import './reports.css';
import { createContext, useContext, type ReactNode } from 'react';
import type { Dialog } from './dialogs';
import { GoodsAmount, WindowFrame, type Art, type Menu } from './frame';
import type { ReportName, ReportView, UnitCount } from './webgui';

/** What a link in a report does (ClientExports.report, reportDetail and showColony, and the page's). */
export interface ReportActions {
  /** Open a report of the menu. */
  open: (name: ReportName) => void;
  /** Open the details a report links to, of a unit type (an empty id is all colonists). */
  detail: (name: ReportName, id: string) => void;
  colony: (id: string) => void;
  europe: () => void;
  /** Centre the map on a tile. */
  goTo: (at: [number, number]) => void;
}

const none = () => {};
export const ReportContext = createContext<ReportActions>({
  open: none,
  detail: none,
  colony: none,
  europe: none,
  goTo: none,
});

/** The Report menu's entries, in order: the report's name, which Commands.showReport knows, and its label. */
export const REPORTS: readonly { name: Exclude<ReportName, 'labourDetail'>; label: string }[] = [
  { name: 'colony', label: 'Colony report' },
  { name: 'labour', label: 'Labour report' },
  { name: 'compactLabour', label: 'Compact labour report' },
  { name: 'military', label: 'Military report' },
  { name: 'naval', label: 'Naval report' },
  { name: 'cargo', label: 'Cargo report' },
  { name: 'education', label: 'Education report' },
  { name: 'exploration', label: 'Exploration report' },
  { name: 'history', label: 'History report' },
  { name: 'religion', label: 'Religion report' },
];

/** The Report menu's items, each opening its report. */
export const reportMenu = (open: ReportActions['open']): Menu['items'] =>
  REPORTS.map((r) => ({ label: r.label, run: () => open(r.name) }));

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
    <img className="pic" src={src} alt={title ?? ''} title={title} data-dim={dim} data-unit={unit} />
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
          <h3>
            <Link go={() => go.colony(c.id)} data-link={c.id}>
              {c.name}
            </Link>
          </h3>
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
              <span key={g.type} className="made" title={`${g.name}: ${g.stock} in store, up to ${g.max} a turn`}>
                <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} change art={art} />
                <span className="stock">{g.stock}</span>
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
        {e.places.map((p) => (
          <div key={p.label}>
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
        {e.atSea.map((p) => (
          <div key={p.label}>
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
function Units({ e, art, go }: { e: View<'military' | 'naval' | 'cargo'>; art: Art; go: Links }) {
  const force = (f: { name: string; units: UnitCount[] }, which: string) => (
    <section data-force={which}>
      <h3>{f.name}</h3>
      <div className="row">
        {f.units.map((u) => (
          <span key={`${u.type}${u.keys[0]}`} className="made" title={u.text} data-type={u.type}>
            <Img keys={u.keys} art={art} title={u.name} />
            <span className="stock">{u.count}</span>
          </span>
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
          <h3>
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
          </h3>
          {p.units.length === 0 && <span className="muted">{e.none}</span>}
          {p.units.map((u) => (
            <div key={u.id} className="row" data-list="unit">
              <Img keys={u.keys} art={art} title={u.text} unit={u.id} />
              {u.goods.map((g) => (
                <GoodsAmount key={g.type} keys={g.keys} name={g.name} amount={g.amount} art={art} />
              ))}
              {u.cargo.map((c) => (
                <Img key={c.id} keys={c.keys} art={art} title={c.name} unit={c.id} />
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
          <h3>
            <Img keys={g.keys} art={art} title={g.name} />
            {g.name}
          </h3>
          <progress
            value={Math.min(g.immigration, g.required)}
            max={g.required}
            title={`${g.immigration} / ${g.required}, ${g.production > 0 ? '+' : ''}${g.production} a turn`}
          />
          <span className="muted" data-field="progress">
            {g.immigration} / {g.required} ({g.production > 0 ? '+' : ''}
            {g.production})
          </span>
          <div className="places">
            {g.colonies.map((c) => (
              <div key={c.id} className="place" data-colony={c.id}>
                <Link go={() => go.colony(c.id)} data-link={c.id}>
                  {c.name}
                </Link>
                <Img keys={c.building.keys} art={art} title={c.building.name} />
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
          <h3>
            <Link go={() => go.colony(c.id)} data-link={c.id}>
              {c.name}
            </Link>
            <Img keys={c.building.keys} art={art} title={c.building.name} />
          </h3>
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

type Links = Pick<ReportActions, 'colony' | 'detail' | 'europe' | 'goTo'>;
type Body<K extends ReportName> = (p: { e: View<K>; art: Art; go: Links }) => ReactNode;

/** The body of each report: every report the Engine sends needs one, or this does not compile. */
const BODIES: { [K in ReportName]: Body<K> } = {
  colony: ColonyReport,
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
};

/**
 * A report in its window. Its close button closes it, and a detail's back button opens the report it came
 * from; a link closes it, then does what it says.
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
    goTo: after(actions.goTo),
  };
  const Content = BODIES[e.report] as Body<ReportName>;
  return (
    <WindowFrame
      className="dialog"
      aria-modal="true"
      data-kind="report"
      data-report={e.report}
      title={e.title}
      close={close}
    >
      <div className="report">
        <Content e={e} art={art} go={go} />
      </div>
      <div className="buttons">
        {e.back && (
          <button data-answer="back" onClick={() => actions.open(e.back!)}>
            ◂
          </button>
        )}
        <button data-answer="close" onClick={close}>
          {e.ok}
        </button>
      </div>
    </WindowFrame>
  );
}
