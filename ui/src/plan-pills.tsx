// A trade route stop's plan: the goods a carrier unloads, loads and keeps aboard there, one pill each (the route
// panel's, src/panels.tsx). In Europe a carrier sells what it unloads and buys what it loads, and the pills say
// so. Its styles are in plan-pills.css.
import type { ReactNode } from 'react';
import { Tip } from './controls';
import type { Work } from './route-work';
import './plan-pills.css';

type Kind = 'unload' | 'load' | 'keep';
const VERB: Record<Kind, string> = { unload: 'Unload', load: 'Load', keep: 'Keep aboard' };
const SIGN: Record<Kind, string> = { unload: '−', load: '+', keep: '=' };

/** One goods and how many holds of it, coloured by what is done with it. */
function PlanPill({
  kind,
  goods,
  holds,
  icon,
  name,
  europe,
}: {
  kind: Kind;
  goods: string;
  holds: number;
  icon: ReactNode;
  name: string;
  europe: boolean;
}) {
  const verb = europe && kind !== 'keep' ? (kind === 'load' ? 'Buy' : 'Sell') : null;
  const tip = !europe
    ? `${VERB[kind]} ${holds > 1 ? `${holds} holds of ` : ''}${name} (the plan: real amounts depend on the colony's stock and export level)`
    : kind === 'load'
      ? `Buy ${holds * 100} ${name} at the market's price, while the gold lasts`
      : kind === 'unload'
        ? `Sell the ${name} on board, less tax`
        : `Keep the ${name} aboard`;
  return (
    <Tip as="span" className="plan-pill" data-work={kind} data-type={goods} tip={tip}>
      {verb && <span className="plan-verb">{verb}</span>}
      {icon}
      {SIGN[kind]}
      {holds}
    </Tip>
  );
}

/** What a stop unloads, loads and keeps; "nothing to do" when it does neither of the first two. */
export function PlanPills({
  unload,
  load,
  keep,
  icon,
  nameOf,
  europe = false,
}: {
  unload: Work[];
  load: Work[];
  keep: Work[];
  icon: (goods: string) => ReactNode;
  nameOf: (goods: string) => string;
  /** Whether the stop is Europe, where a carrier buys and sells. */
  europe?: boolean;
}) {
  const group = (kind: Kind, list: Work[], arrow: string) =>
    list.length > 0 && (
      <span className="plan-group" data-group={kind}>
        <span className="plan-arrow" aria-hidden="true">
          {arrow}
        </span>
        {list.map(([g, k]) => (
          <PlanPill
            key={`${kind} ${g}`}
            kind={kind}
            goods={g}
            holds={k}
            icon={icon(g)}
            name={nameOf(g)}
            europe={europe}
          />
        ))}
      </span>
    );
  const idle = unload.length + load.length === 0;
  return (
    <div className="plan-pills">
      {unload.length + load.length + keep.length === 0 ? (
        <span className="muted">nothing to do</span>
      ) : (
        <>
          {group('unload', unload, '↓ off')}
          {group('load', load, '↑ on')}
          {group('keep', keep, 'kept')}
          {idle && <span className="muted">nothing to do</span>}
        </>
      )}
    </div>
  );
}
