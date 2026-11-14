// An entry of Europe's lists: a unit or ship with its picture. Its styles are in europe-entry.css.
import { Tip } from './controls';
import { draggableProps, dropTargetProps, type Item } from './moves';
import { Pic, type Art } from './frame';
import { useContextMenu } from './popup-menu';
import type { EuropeUnit } from './webgui';
import './europe-entry.css';

/** A unit's drag shows its picture, not its name beside it. */
export const unitDrag = (id: string) =>
  draggableProps({ kind: 'unit', id }, undefined, (el) => el.querySelector('img'));

/** A unit or ship of Europe's panel, with its picture, the turns left of a ship at sea, and a damaged ship's repair. */
export function EuropeEntry({
  u,
  art,
  pick,
  on,
  drag,
  drop,
}: {
  u: EuropeUnit;
  art: Art;
  pick?: () => void;
  on?: boolean;
  /** Whether the unit can be dragged somewhere, as a dock's unit can board. */
  drag?: boolean;
  /** What a drop on the unit's icon does, as a ship in port takes cargo. */
  drop?: (item: Item) => void;
}) {
  const inner = (
    <>
      <Pic keys={u.images} art={art} />
      <span className="name">{u.name}</span>
      {u.turns !== undefined && <span className="turns">{u.turns}</span>}
      {u.repair && <span className="repair">{u.repair}</span>}
    </>
  );
  // A sailing ship's hint says its turns left as well as its name, a damaged ship's its repair.
  const tip = [u.name, u.turnsLabel, u.repair].filter(Boolean).join(' ');
  const props = {
    ...(drag ? unitDrag(u.id) : {}),
    ...(drop ? dropTargetProps('ship', drop) : {}),
  };
  const menu = useContextMenu((m) => m.unit(u.id));
  return pick ? (
    <Tip
      as="button"
      className="europe-entry"
      data-flat=""
      data-unit={u.id}
      tip={tip}
      aria-current={on}
      onClick={pick}
      {...menu}
      {...props}
    >
      {inner}
    </Tip>
  ) : (
    <Tip as="div" className="europe-entry" data-unit={u.id} tip={tip} {...menu} {...props}>
      {inner}
    </Tip>
  );
}
