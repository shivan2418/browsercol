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

/** A unit or ship of Europe's panel, with its picture. */
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
    </>
  );
  const props = {
    ...(drag ? unitDrag(u.id) : {}),
    ...(drop ? dropTargetProps('ship', drop) : {}),
  };
  const onContextMenu = useContextMenu((m) => m.unit(u.id));
  return pick ? (
    <Tip
      as="button"
      className="europe-entry"
      data-flat=""
      data-unit={u.id}
      tip={u.name}
      aria-current={on}
      onClick={pick}
      onContextMenu={onContextMenu}
      {...props}
    >
      {inner}
    </Tip>
  ) : (
    <Tip as="div" className="europe-entry" data-unit={u.id} tip={u.name} onContextMenu={onContextMenu} {...props}>
      {inner}
    </Tip>
  );
}
