// FreeCol's colony panel (ColonyPanel), read-only, laid out as look E
// (docs/adr/0004): the population and the buildings on the left; the 3x3
// tiles, the net production and the construction on the right; then the
// ships in port beside the cargo of the one chosen, the units outside the
// colony, and the warehouse. Every image is found by resource key, so a
// Tileset can replace it; every text comes localized from the Engine
// (ColonyJson.java). The boxes FreeCol captions use the shared Box, and
// goods amounts the shared GoodsAmount (frame.tsx).
//
// Colonists move as in FreeCol: drag one onto a building, a tile or the box
// of units outside the colony; a click on one does nothing, and its menu
// has where it may work. Goods are picked by a click. The moves
// go to the client Engine's controller (ColonyMoves, Commands.java); the
// panel is shown again as they change the colony.
//
// The ship chosen in port is loaded the same way: a unit beside the colony, a
// colonist working in it or goods of the warehouse dropped on its cargo go aboard, and a unit or a stack
// of goods of the cargo dropped outside or on the warehouse go ashore. Goods
// move a hold's worth, or the stack; with shift held as they are picked up,
// FreeCol's partial drag, the Engine asks the amount.
//
// The build queue (BuildQueuePanel) opens as a popup from the construction: the queue
// with buttons to move or remove each item, then what the colony can build
// to add at the end, the rest (with FreeCol's reasons) behind the show all
// box, and the buy button. Every edit goes to the Engine, which sets the queue
// of the server's colony and sends the colony again.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Box, GoodsAmount, type Art } from './frame';
import { PANEL_KEYS } from './map-keys';
import { accepts, draggableProps, dropTargetProps, same, type Item, type Place } from './moves';
import { ContextMenuContext, useContextMenu } from './popup-menu';
import type { Buildable, BuildingTip, ColonyView, GoodsAmount as Goods, UnitRef } from './webgui';

/** FreeCol's tile size, which the tiles of TilesPanel are laid out by. */
const TILE_W = 128;
const TILE_H = 64;
/** Room above the tiles for art taller than its tile (forests, hills, the colony). */
const TILE_TOP = TILE_H / 2;
/** ImageLibrary.ICON_COIN, which an UpkeepLabel shows. */
const COIN = PANEL_KEYS.coin;
/** ImageLibrary.TILE_TAKEN and TILE_OWNED_BY_INDIANS, which TileViewer.displayColonyTile draws over a tile. */
const TILE_TAKEN = ['image.tile.tileTaken'];
const NATIVE_LAND = ['image.tileitem.nativeLand'];

/**
 * Draws tiles of the map as the map draws them, into a canvas in `host` (mapDrawer's drawTiles); returns
 * what removes it. Without one, the panel shows each tile's terrain and forest images.
 */
export type DrawTiles = (
  host: HTMLElement,
  centre: [number, number],
  tiles: [number, number][],
  top: number,
) => () => void;
export const ColonyTiles = createContext<DrawTiles | null>(null);

/**
 * What the player can do with the colonists and ships of a colony (Commands.work, putOutsideColony,
 * changeWorkType, boardShip, leaveShip, loadGoods, unloadGoods), by id.
 */
export interface ColonyMoves {
  /** Put a colonist to work at a building or a colony tile. */
  work(unit: string, location: string): void;
  /** Put a colonist outside the colony. */
  putOutside(unit: string): void;
  /** Change what a working colonist makes. */
  changeWork(unit: string, goods: string): void;
  /** Set the colony's build queue, by the ids of what to build, in order. */
  setQueue(colony: string, types: string[]): void;
  /** Pay for what the colony is building now. */
  buy(colony: string): void;
  /** Open the colony's warehouse dialog. */
  warehouse(colony: string): void;
  /** Close the colony's panel; the Engine may ask first, as when the colony has no colonist left, and closes it (closeColony). */
  close(colony: string): void;
  /** Put a unit beside the colony aboard a ship in port. */
  board(unit: string, ship: string): void;
  /** Take a unit off a ship in port. */
  leaveShip(unit: string): void;
  /** Load goods of a type from the warehouse onto a ship in port; ask: let the player choose the amount. */
  load(ship: string, goods: string, ask: boolean): void;
  /** Unload a stack of a ship's goods into the warehouse; ask: let the player choose how much of it. */
  unload(ship: string, goods: string, stack: number, ask: boolean): void;
}
/** Without it the panel only shows the colony. */
export const ColonyActions = createContext<ColonyMoves | null>(null);

/**
 * What is being moved: a unit, or goods of the warehouse or of a stack of the
 * chosen ship's cargo (the stack's index and amount). ask: shift was held as
 * it was picked up, so the Engine asks the amount.
 */

/** The colonist or goods being moved: picked by a click, or dragged. */
interface Hand {
  /** What is picked. */
  picked: Item | null;
  pick(item: Item | null): void;
  /** Where things can be dropped, with what a drop there does; null when the panel cannot move them. */
  target(place: Place, drop: (item: Item) => void): TargetProps | null;
}
interface TargetProps {
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onClick(): void;
}
const NO_HAND: Hand = { picked: null, pick() {}, target: () => null };
const HandContext = createContext<Hand>(NO_HAND);
/** Whether shift was held on the last press on something movable, which a drag starts from. */
let shiftPressed = false;

/** The ship chosen in port, per colony, so it stays chosen as the panel is shown again. */
const chosen = new Map<string, string | null>();
/** What is picked, per colony, as the panel is shown again whenever the colony changes. */
const picks = new Map<string, Item | null>();
/** Whether the build queue is open, and whether it shows what cannot be built, per colony. */
const queues = new Map<string, { open: boolean; all: boolean }>();

function Img({
  keys,
  art,
  className,
  alt = '',
}: {
  keys: readonly string[];
  art: Art;
  className?: string;
  alt?: string;
}) {
  const src = art(keys);
  return src === null ? null : <img className={className} src={src} alt={alt} title={alt || undefined} />;
}

/**
 * Something the panel can move. With a ColonyMoves it can be dragged, and a click picks it (again puts it
 * down), or, with something else picked, goes to the place it is in. Shift held as it is picked up asks the
 * amount of goods.
 */
function useMovable(item: Item) {
  const hand = useContext(HandContext);
  const movable = hand !== NO_HAND;
  const picked = hand.picked !== null && same(hand.picked, item);
  const withShift = (shift: boolean): Item => (item.kind === 'goods' ? { ...item, ask: shift } : item);
  const drag = draggableProps(item, (e) => withShift(shiftPressed || e.shiftKey));
  return {
    // Only goods are picked by a click: a colonist is moved by a drag or its menu, and has no pick to show.
    'data-picked': movable && item.kind === 'goods' ? picked : undefined,
    draggable: movable || undefined,
    // As DragListener.mousePressed, shift on the press makes the drag partial.
    onMouseDown: (e: MouseEvent) => (shiftPressed = e.shiftKey),
    onDragStart: (e: DragEvent) => {
      drag.onDragStart(e);
      hand.pick(null);
    },
    onDragEnd: drag.onDragEnd,
    onClick: (e: MouseEvent) => {
      if (!movable || item.kind === 'unit' || (hand.picked !== null && !picked)) return;
      e.stopPropagation();
      hand.pick(picked ? null : withShift(e.shiftKey));
    },
  };
}

/**
 * A unit's image, naming its unit by id (data-unit), as the browser scripts look for it. With a ColonyMoves it
 * can be moved (useMovable).
 */
function Unit({
  u,
  art,
  className,
  children,
  inert = false,
}: {
  u: UnitRef;
  art: Art;
  className?: string;
  children?: ReactNode;
  /** Something around the unit is what moves it and opens its menu (a tile), so it does neither itself. */
  inert?: boolean;
}) {
  const movable = useMovable({ kind: 'unit', id: u.id });
  const onContextMenu = useContextMenu((m) => m.unit(u.id));
  return (
    <span className={className} data-unit={u.id} {...(inert ? undefined : { onContextMenu, ...movable })}>
      <Img keys={u.keys} art={art} className="unit" alt={u.name} />
      {children}
    </span>
  );
}

/**
 * Goods of the warehouse, or a stack of the chosen ship's cargo, named by type (data-goods); they can be moved,
 * unless there are none. WarehousePanel shows an empty stack too, greyed by GoodsLabel; it has nothing to load.
 */
function MovableGoods({
  g,
  item,
  at,
  art,
  className,
  over,
}: {
  g: Goods;
  item: Item;
  /** The id of the colony the goods are stored in, or of the ship they are aboard (for their menu). */
  at: string;
  art: Art;
  className?: string;
  /** More than the warehouse holds (Swing's red). */
  over?: boolean;
}) {
  const movable = useMovable(item);
  const onContextMenu = useContextMenu((m) => (g.amount > 0 ? m.goods(at, g.type, g.amount) : null));
  return (
    <span
      className={className}
      data-goods={g.type}
      data-over={over}
      onContextMenu={onContextMenu}
      {...(g.amount > 0 ? movable : {})}
    >
      <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} />
    </span>
  );
}

const Units = ({ units, art }: { units: UnitRef[]; art: Art }) => units.map((u) => <Unit key={u.id} u={u} art={art} />);

/** The props that make an element a place things go to, or none when the panel cannot move them. */
function useTarget(place: Place, drop: (item: Item) => void): TargetProps | null {
  return useContext(HandContext).target(place, drop);
}

/** A ProductionLabel: the shared goods amount, named by its type (data-goods); `max` is what an expert would make. */
function Made({ g, art, change = false, max }: { g: Goods; art: Art; change?: boolean; max?: number }) {
  return (
    <span className="made-goods" data-goods={g.type}>
      <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} change={change} art={art} icons expert={max ?? null} />
    </span>
  );
}

/** A part of the panel FreeCol gives no caption, named by data-part. */
const Part = ({ part, children }: { part: string; children: ReactNode }) => (
  <section className={`box ${part}`} data-part={part}>
    {children}
  </section>
);

/** TilesPanel: the colony's 3x3, drawn as the map draws them, with who works each and what it makes. */
function Tiles({ c, art }: { c: ColonyView; art: Art }) {
  const draw = useContext(ColonyTiles);
  const ground = useRef<HTMLDivElement>(null);
  const centre = c.tiles.find((t) => t.centre)?.at ?? c.at;
  const at = JSON.stringify(c.tiles.map((t) => t.at));
  useEffect(() => {
    if (!draw || !ground.current) return;
    return draw(ground.current, centre, JSON.parse(at) as [number, number][], TILE_TOP);
  }, [draw, at, centre[0], centre[1]]);
  return (
    <section className="tiles" data-part="tiles" style={{ width: TILE_W * 3, height: TILE_H * 3 + TILE_TOP }}>
      {draw && <div className="ground" ref={ground} />}
      <div className="over" style={{ top: TILE_TOP }}>
        {c.tiles.map((t) => {
          const [x, y] = t.pos;
          return (
            <TilePlace key={t.id} t={t} style={{ left: ((2 - x + y) * TILE_W) / 2, top: ((x + y) * TILE_H) / 2 }}>
              {!draw && <Img keys={t.terrain} art={art} className="terrain" />}
              {!draw && t.forest && <Img keys={t.forest} art={art} className="forest" />}
              {t.taken && <Img keys={TILE_TAKEN} art={art} className="taken" />}
              {t.natives && <Img keys={NATIVE_LAND} art={art} className="natives" />}
              {t.workers.map((u) => (
                <Unit key={u.id} u={u} art={art} className="who" inert />
              ))}
              {t.production.length > 0 && (
                <span className="made">
                  {t.production.map((g) => (
                    <Made key={g.type} g={g} art={art} />
                  ))}
                </span>
              )}
            </TilePlace>
          );
        })}
      </div>
    </section>
  );
}

/** A tile of the 3x3: a diamond that takes colonists (the centre tile takes none), around what it shows. */
function TilePlace({
  t,
  style,
  children,
}: {
  t: ColonyView['tiles'][number];
  style: CSSProperties;
  children: ReactNode;
}) {
  const moves = useContext(ColonyActions);
  const target = useTarget('tile', (item) => {
    if (item.kind === 'unit') moves?.work(item.id, t.id);
  });
  // The whole tile carries the colonist working it, and opens its menu.
  const worker = t.workers[0];
  const movable = useMovable({ kind: 'unit', id: worker?.id ?? '' });
  const onContextMenu = useContextMenu((m) => (worker ? m.unit(worker.id) : m.colonyTile(t.at[0], t.at[1])));
  // The drag shows the colonist, not the tile around it.
  const onDragStart = (e: DragEvent) => {
    movable.onDragStart(e);
    const img = e.currentTarget.querySelector<HTMLElement>('.who .unit');
    if (img) e.dataTransfer.setDragImage?.(img, img.offsetWidth / 2, img.offsetHeight / 2);
  };
  const carry = worker ? { ...movable, onContextMenu, onDragStart } : { onContextMenu };
  return (
    <div
      className="tile"
      data-tile={t.id}
      data-ours={t.ours}
      data-drop={target && !t.centre ? '' : undefined}
      title={t.name}
      style={style}
      {...(t.centre ? undefined : target)}
      {...carry}
    >
      {/* The diamond itself is what a drop or click lands on, as tiles overlap by their boxes. */}
      <span className="hit" />
      {children}
    </div>
  );
}

/** ColonyInPortPanel: the ships in port, one of which is chosen. */
function InPort({ c, art, choose }: { c: ColonyView; art: Art; choose: (id: string) => void }) {
  const menus = useContext(ContextMenuContext);
  const port = c.inPort;
  const ship = chosenShip(c);
  return (
    <Box caption={port.title} data-part="port" className="port">
      {port.units.map((u) => (
        <button
          key={u.id}
          className="ship"
          data-unit={u.id}
          aria-pressed={u.id === ship?.id}
          title={u.name}
          onClick={() => choose(u.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            const menu = menus?.unit(u.id);
            if (menu) menus!.show(menu, e.clientX, e.clientY);
          }}
        >
          <Img keys={u.keys} art={art} className="unit" alt={u.name} />
        </button>
      ))}
    </Box>
  );
}

/**
 * ColonyCargoPanel: what the chosen ship carries. Units beside the colony and the warehouse's goods dropped on
 * it go aboard.
 */
function Cargo({ c, art }: { c: ColonyView; art: Art }) {
  const moves = useContext(ColonyActions);
  const ship = chosenShip(c);
  // Units beside the colony and colonists working in it board (CargoPanel accepts what the carrier can add).
  const boardable = new Set([...c.outside.units, ...workingIn(c)].map((u) => u.id));
  const target = useTarget('cargo', (item) => {
    if (!ship || !moves) return;
    if (item.kind === 'unit' && boardable.has(item.id)) moves.board(item.id, ship.id);
    else if (item.kind === 'goods' && item.from === 'warehouse') moves.load(ship.id, item.type, item.ask ?? false);
  });
  return (
    <Box
      caption={ship ? ship.cargo.title : c.inPort.cargo}
      data-part="cargo"
      className="cargo"
      data-ship={ship?.id}
      data-drop={target && ship ? '' : undefined}
      {...(ship ? target : undefined)}
    >
      {ship && (
        <>
          <Units units={ship.cargo.units} art={art} />
          {ship.cargo.goods.map((g, i) => (
            <MovableGoods
              key={i}
              g={g}
              art={art}
              at={ship.id}
              className="made-goods"
              item={{ kind: 'goods', from: 'cargo', type: g.type, index: i, amount: g.amount, ask: false }}
            />
          ))}
        </>
      )}
    </Box>
  );
}

/**
 * Where building i of n stands in the open ground left of the right column: one to a cell of a grid as wide as
 * the ground is, each shifted by a fixed amount of its cell's slack, so they lie spread out, not in rows.
 */
function scatter(i: number, n: number): CSSProperties {
  const cols = n > 16 ? 5 : 4;
  const rows = Math.ceil(n / cols);
  const col = i % cols;
  // A fixed amount in [-0.5, 0.5) per building.
  const jitter = (k: number) => ((Math.imul(i + 1, 2654435761 + k * 40503) >>> 0) % 1000) / 1000 - 0.5;
  // Odd columns sit lower by a quarter cell, and each building moves by less than the slack its cell has.
  const left = (col + 0.5 + jitter(0) * 0.16) / cols;
  const top = (Math.floor(i / cols) + 0.5 + (col % 2) * 0.25 + jitter(1) * 0.12) / (rows + 0.25);
  return { left: `${left * 100}%`, top: `${top * 100}%` };
}

/** The colonists working in the colony's buildings and on its tiles. */
const workingIn = (c: ColonyView) => [...c.buildings.flatMap((b) => b.workers), ...c.tiles.flatMap((t) => t.workers)];

/** The ship chosen in port: the one the player chose, else the one the Engine chose first. */
function chosenShip(c: ColonyView) {
  const pick = chosen.has(c.id) ? chosen.get(c.id)! : c.inPort.selected;
  return c.inPort.units.find((u) => u.id === pick) ?? c.inPort.units.find((u) => u.id === c.inPort.selected) ?? null;
}

/** WarehousePanel: the colony's goods; a stack of the chosen ship's cargo dropped here is unloaded. */
function Warehouse({ c, art }: { c: ColonyView; art: Art }) {
  const moves = useContext(ColonyActions);
  const target = useTarget('warehouse', (item) => {
    const ship = chosenShip(c);
    if (ship && moves && item.kind === 'goods' && item.from === 'cargo') {
      moves.unload(ship.id, item.type, item.amount ?? 0, item.ask ?? false);
    }
  });
  return (
    <Box
      caption={c.warehouse.title}
      data-part="warehouse"
      className="warehouse"
      data-drop={target ? '' : undefined}
      {...target}
    >
      {c.warehouse.goods.map((g) => (
        <MovableGoods
          key={g.type}
          g={g}
          art={art}
          at={c.id}
          className="stored"
          item={{ kind: 'goods', from: 'warehouse', type: g.type, ask: false }}
          over={g.over}
        />
      ))}
    </Box>
  );
}

/** A building that takes colonists; with the pointer over it, its tooltip. */
function BuildingPlace({
  b,
  art,
  style,
  children,
}: {
  b: ColonyView['buildings'][number];
  art: Art;
  style: CSSProperties;
  children: ReactNode;
}) {
  const moves = useContext(ColonyActions);
  const target = useTarget('building', (item) => {
    if (item.kind === 'unit' && b.id !== null) moves?.work(item.id, b.id);
  });
  const [over, setOver] = useState<DOMRect | null>(null);
  return (
    <div
      className="building"
      data-building={b.id}
      data-drop={target ? '' : undefined}
      aria-label={b.name}
      style={style}
      onMouseEnter={(e) => setOver(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setOver(null)}
      onMouseDown={() => setOver(null)}
      {...target}
    >
      {children}
      {over && b.tip && <BuildingTipBox b={b} tip={b.tip} art={art} at={over} />}
    </div>
  );
}

/** The widest a building's tooltip is laid out for, to put it left of the building when the right has no room. */
const TIP_W = 280;

/**
 * BuildingToolTip: the building's name; the input and the output, each against what it could be when the input
 * runs short (a building that makes nothing leaves the row empty, as Swing does); the building; each worker with
 * what they make, or a teacher with their student; a placeholder per empty place; and the breeding note.
 */
function BuildingTipBox({
  b,
  tip,
  art,
  at,
}: {
  b: ColonyView['buildings'][number];
  tip: BuildingTip;
  art: Art;
  at: DOMRect;
}) {
  const left = at.right + 8 + TIP_W <= window.innerWidth ? at.right + 8 : Math.max(8, at.left - 8 - TIP_W);
  const { input, output } = tip;
  return createPortal(
    <div className="building-tip" role="tooltip" data-tip={b.id} style={{ left, top: Math.max(8, at.top) }}>
      <b className="tip-name">{b.name}</b>
      {output && (
        <div className="tip-production">
          {input && (
            // Swing's input label: against what is needed, or only the icon when the building takes none this turn.
            <span className="tip-input" data-goods={input.type}>
              <GoodsAmount
                keys={input.keys}
                name={input.name}
                amount={input.amount}
                expert={input.amount > 0 ? input.max : null}
                art={art}
                icons
              />
            </span>
          )}
          {input && <span className="arrow">→</span>}
          <span className="tip-output" data-goods={output.type}>
            <GoodsAmount
              keys={output.keys}
              name={output.name}
              amount={output.amount}
              expert={output.max}
              art={art}
              icons
            />
          </span>
        </div>
      )}
      <Img keys={b.keys} art={art} className="art" />
      <div className="tip-workers">
        {tip.workers.map((w) => (
          <span key={w.id} className="tip-worker" data-unit={w.id}>
            <Img keys={w.keys} art={art} className="unit" alt={w.name} />
            {w.made && <GoodsAmount keys={w.made.keys} name={w.made.name} amount={w.made.amount} art={art} icons />}
            {w.progress !== null && <span className="progress">{w.progress}</span>}
            {w.student && <Img keys={w.student.keys} art={art} className="unit student" alt={w.student.name} />}
          </span>
        ))}
        {Array.from({ length: Math.max(0, b.capacity - b.workers.length) }, (_, i) => (
          <Img key={i} keys={[PLACEHOLDER]} art={art} className="placeholder" />
        ))}
      </div>
      {tip.breeding && <p className="breeding">{tip.breeding}</p>}
    </div>,
    document.body,
  );
}

/** BuildingToolTip's empty place: image.unit.placeholder. */
const PLACEHOLDER = 'image.unit.placeholder';

/** OutsideColonyPanel: the units on the colony's tile, and where a colonist working in the colony is put. */
function Outside({ c, art }: { c: ColonyView; art: Art }) {
  const moves = useContext(ColonyActions);
  const working = new Set(workingIn(c).map((u) => u.id));
  const aboard = new Set(c.inPort.units.flatMap((s) => s.cargo.units).map((u) => u.id));
  // A colonist working in the colony is put outside, and a unit aboard a ship goes ashore; one already
  // outside has nowhere to go.
  const target = useTarget('outside', (item) => {
    if (item.kind !== 'unit' || !moves) return;
    if (working.has(item.id)) moves.putOutside(item.id);
    else if (aboard.has(item.id)) moves.leaveShip(item.id);
  });
  return (
    <Box
      caption={c.outside.title}
      data-part="outside"
      className="outside"
      data-drop={target ? '' : undefined}
      {...target}
    >
      <Units units={c.outside.units} art={art} />
    </Box>
  );
}

/** A buildable with its image, name and the goods it takes; a locked one says what it lacks. */
function BuildableLabel({ b, art }: { b: Buildable; art: Art }) {
  return (
    <>
      <Img keys={b.keys} art={art} className="buildable-icon" />
      <span className="name">{b.name}</span>
      {b.required.map((g) => (
        <Made key={g.type} g={g} art={art} />
      ))}
      {b.reason !== null && <span className="reason muted">{b.reason}</span>}
    </>
  );
}

/**
 * BuildQueuePanel: edit the colony's build queue, and pay for the build. What the colony is building (the
 * children) is the button that opens it.
 */
function BuildQueue({ c, art, children }: { c: ColonyView; art: Art; children: ReactNode }) {
  const moves = useContext(ColonyActions);
  const [state, setState] = useState(() => queues.get(c.id) ?? { open: false, all: false });
  const set = (s: { open: boolean; all: boolean }) => {
    queues.set(c.id, s);
    setState(s);
  };
  const q = c.queue;
  if (!moves) return <Part part="construction">{children}</Part>;
  const ids = q.queue.map((b) => b.type);
  const move = (from: number, to: number) => {
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    moves.setQueue(c.id, next);
  };
  const lists = [
    { part: 'buildings', title: q.buildingsTitle, items: q.buildings },
    { part: 'units', title: q.unitsTitle, items: q.units },
  ];
  return (
    <>
      <section
        className="box construction"
        data-part="construction"
        role="button"
        tabIndex={0}
        aria-label={q.title}
        title={q.title}
        aria-expanded={state.open}
        onClick={() => set({ ...state, open: !state.open })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            set({ ...state, open: !state.open });
          }
        }}
      >
        {children}
      </section>
      {state.open && (
        <>
          <div className="queue-backdrop" onClick={() => set({ ...state, open: false })} />
          <div className="queue-body" role="dialog" aria-label={q.title}>
            <button
              className="queue-close"
              aria-label="close"
              title="close"
              onClick={() => set({ ...state, open: false })}
            >
              ✕
            </button>
            <Box caption={q.title} data-part="queued" className="queued">
              <ol>
                {q.queue.map((b, i) => (
                  <li key={`${b.type}:${i}`} data-queued={b.type} data-locked={b.reason !== null || undefined}>
                    <button disabled={i === 0} aria-label="up" title="up" onClick={() => move(i, i - 1)}>
                      ↑
                    </button>
                    <button
                      disabled={i === ids.length - 1}
                      aria-label="down"
                      title="down"
                      onClick={() => move(i, i + 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label="remove"
                      title="remove"
                      onClick={() =>
                        moves.setQueue(
                          c.id,
                          ids.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ✕
                    </button>
                    <BuildableLabel b={b} art={art} />
                  </li>
                ))}
              </ol>
            </Box>
            {lists.map(({ part, title, items }) => (
              <Box key={part} caption={title} data-part={part} className="can-build">
                <ul>
                  {items
                    .filter((b) => state.all || b.reason === null)
                    .map((b) => (
                      <li key={b.type} data-buildable={b.type} data-locked={b.reason !== null || undefined}>
                        <button
                          disabled={b.reason !== null}
                          title={b.reason ?? b.name}
                          onClick={() => moves.setQueue(c.id, [...ids, b.type])}
                        >
                          <BuildableLabel b={b} art={art} />
                        </button>
                      </li>
                    ))}
                </ul>
              </Box>
            ))}
            <label className="show-all">
              <input type="checkbox" checked={state.all} onChange={(e) => set({ ...state, all: e.target.checked })} />
              {q.showAll}
            </label>
            {q.buy && (
              <button className="buy" disabled={!q.buy.enabled} onClick={() => moves.buy(c.id)}>
                {q.buy.label}
                <span className="muted">{` (${q.buy.price})`}</span>
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Whether what was picked is still where it was picked up. */
function isHere(c: ColonyView, item: Item) {
  if (item.kind === 'unit') return JSON.stringify(c).includes(`"id":"${item.id}"`);
  if (item.from === 'warehouse') return c.warehouse.goods.some((g) => g.type === item.type && g.amount > 0);
  if (item.index === undefined) return false;
  const g = chosenShip(c)?.cargo.goods[item.index];
  return g?.type === item.type && g.amount === item.amount;
}

export function ColonyPanel({ colony: c, art, footer }: { colony: ColonyView; art: Art; footer?: ReactNode }) {
  const p = c.population;
  const moves = useContext(ColonyActions);
  const [picked, show] = useState<Item | null>(() => picks.get(c.id) ?? null);
  const setPicked = (item: Item | null) => {
    picks.set(c.id, item);
    show(item);
  };
  // A unit that has left the colony, or been disbanded, or goods that are gone, are no longer picked.
  // The ship chosen in port is kept in chosen; this draws the panel again as another is chosen.
  const [, redraw] = useState(0);
  const choose = (id: string) => {
    chosen.set(c.id, id);
    redraw((n) => n + 1);
  };
  const here = picked !== null && isHere(c, picked);
  const hand: Hand = !moves
    ? NO_HAND
    : {
        picked: here ? picked : null,
        pick: setPicked,
        target: (place, drop) => ({
          ...dropTargetProps(place, drop),
          onClick: () => {
            if (here && picked !== null && accepts(place, picked)) {
              setPicked(null);
              drop(picked);
            }
          },
        }),
      };
  return (
    <HandContext.Provider value={hand}>
      <div className="colony">
        <div className="cbody">
          <div className="buildings">
            {c.buildings.map((b, i) => {
              const at = scatter(i, c.buildings.length);
              return b.site ? (
                // EmptyBuildingSite: the plot's image, nothing more.
                <div key={b.type} className="building site" data-site={b.type} title={b.name} style={at}>
                  <Img keys={b.keys} art={art} className="art" />
                </div>
              ) : (
                <BuildingPlace key={b.type} b={b} art={art} style={at}>
                  <span className="name">{b.name}</span>
                  <Img keys={b.keys} art={art} className="art" />
                  <span className="output">
                    {b.production && <Made g={b.production} art={art} max={b.production.max} />}
                    {b.upkeep !== null && (
                      // BuildingPanel's UpkeepLabel: the coin, with the upkeep.
                      <span className="upkeep" title={String(b.upkeep)}>
                        <Img keys={[COIN]} art={art} className="icon" />
                        {b.upkeep}
                      </span>
                    )}
                  </span>
                  <span className="workers">
                    <Units units={b.workers} art={art} />
                    {Array.from({ length: Math.max(0, b.capacity - b.workers.length) }, (_, i) => (
                      <span key={i} className="slot" />
                    ))}
                  </span>
                </BuildingPlace>
              );
            })}
          </div>
          <div className="upper">
            <Part part="population">
              <Img keys={p.rebelShield} art={art} className="shield" />
              <span>
                {p.rebels} <b>{`${p.rebelPercent}%`}</b>
              </span>
              <span>
                {p.total} <span className="muted">{p.bonus}</span>
              </span>
              <span>
                {p.royalists} <b>{`${100 - p.rebelPercent}%`}</b>
              </span>
              <Img keys={p.royalistShield} art={art} className="shield" />
            </Part>
            <Tiles c={c} art={art} />
            <Part part="net">
              {c.production.map((g) => (
                <Made key={g.type} g={g} art={art} change />
              ))}
            </Part>
            <BuildQueue c={c} art={art}>
              {c.construction === null ? (
                <span className="muted">{c.nothing}</span>
              ) : (
                <>
                  <Img keys={c.construction.keys} art={art} className="buildable" />
                  <div className="needs">
                    <b>{c.construction.name}</b>
                    {c.construction.turns !== null && <span className="muted">{c.construction.turns}</span>}
                    {c.construction.required.map((r) => (
                      <span key={r.type} className="need" data-goods={r.type} title={r.name}>
                        <Img keys={r.keys} art={art} className="icon" />
                        <span className="bar">
                          <i style={{ width: `${Math.min(100, (100 * r.available) / Math.max(1, r.needed))}%` }} />
                        </span>
                        {/* FreeColProgressBar's text: what is there, what comes next turn, and what is needed. */}
                        <span>{`${r.available}${r.produced < 0 ? '-' : '+'}${Math.abs(r.produced)}/${r.needed}`}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </BuildQueue>
            <InPort c={c} art={art} choose={choose} />
            {footer}
          </div>
          <Outside c={c} art={art} />
          <Cargo c={c} art={art} />
          <Warehouse c={c} art={art} />
        </div>
      </div>
    </HandContext.Provider>
  );
}
