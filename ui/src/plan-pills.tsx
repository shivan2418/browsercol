// A trade route stop's plan: the goods a carrier unloads, loads and keeps aboard there, one pill each (the route
// panel's, src/panels.tsx). Its styles are in plan-pills.css.
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
}: {
  kind: Kind;
  goods: string;
  holds: number;
  icon: ReactNode;
  name: string;
}) {
  return (
    <Tip
      as="span"
      className="plan-pill"
      data-work={kind}
      data-type={goods}
      tip={`${VERB[kind]} ${holds > 1 ? `${holds} holds of ` : ''}${name} (the plan: real amounts depend on the colony's stock and export level)`}
    >
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
}: {
  unload: Work[];
  load: Work[];
  keep: Work[];
  icon: (goods: string) => ReactNode;
  nameOf: (goods: string) => string;
}) {
  const group = (kind: Kind, list: Work[], arrow: string) =>
    list.length > 0 && (
      <span className="plan-group" data-group={kind}>
        <span className="plan-arrow" aria-hidden="true">
          {arrow}
        </span>
        {list.map(([g, k]) => (
          <PlanPill key={`${kind} ${g}`} kind={kind} goods={g} holds={k} icon={icon(g)} name={nameOf(g)} />
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
