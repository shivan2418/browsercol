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
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Tip } from './controls';
import { createPortal } from 'react-dom';
import { Box, GoodsAmount, GoodsProgressBar, TEXT_ENTRY, type Art } from './frame';
import { PANEL_KEYS } from './map-keys';
import { ReportContext } from './reports';
import { lane, type TargetProps } from './drag';
import { accepts, draggableProps, dropTargetProps, same, type Item, type Place } from './moves';
import { ContextMenuContext, useContextMenu } from './popup-menu';
import type { Buildable, BuildingTip, ColonyView, GoodsAmount as Goods, RebelTip, UnitRef } from './webgui';
import { useCoverage } from './coverage';

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
  /** Open the menu of the colony's units (ColonyPanel's Colony Units, the C key). */
  units(colony: string): void;
  /** Close this colony's panel and open the previous (-1) or next (1) colony's, as ColonyPanel's arrow keys do. */
  step(colony: string, by: -1 | 1): void;
  /** Close the colony's panel; the Engine may ask first, as when the colony has no colonist left, and closes it (closeColony). */
  close(colony: string): void;
  /** Equip a colonist with the role that goods of the warehouse give. */
  equip(unit: string, goods: string): void;
  /** Put a unit beside the colony aboard a ship in port. */
  board(unit: string, ship: string): void;
  /** Take a unit off a ship in port. */
  leaveShip(unit: string): void;
  /** Load goods of a type from the warehouse onto a ship in port; ask: let the player choose the amount. */
  load(ship: string, goods: string, ask: boolean): void;
  /** Unload a stack of a ship's goods into the warehouse; ask: let the player choose how much of it. */
  unload(ship: string, goods: string, stack: number, ask: boolean): void;
  /** Unload everything a ship in port carries: the units ashore, the goods into the warehouse (the U key). */
  unloadAll(ship: string): void;
  /** Top up the goods a ship in port carries from the warehouse (the L key). */
  fill(ship: string): void;
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
  target(place: Place, drop: (item: Item) => void): PlaceProps | null;
}
/** A place's props: it takes drops, and a click puts down what is picked there. */
interface PlaceProps extends TargetProps {
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
/** Whether the build queue is open, whether it shows what cannot be built, and whether its rows are names only, per colony. */
type QueueState = { open: boolean; all: boolean; compact: boolean };
const queues = new Map<string, QueueState>();
const queueOf = (id: string): QueueState => queues.get(id) ?? { open: false, all: false, compact: false };
/** Opens the colony's build queue: what a click on a building that can build does. */
const OpenQueue = createContext<() => void>(() => {});
/** What is dragged in the build queue: a queued row (by index), or buildable types from the lists. */
type QueueDrag = { from: 'queue'; index: number } | { from: 'list'; types: string[] };
const queueDrag = lane<QueueDrag>();

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
  return src === null ? null : <Tip as="img" className={className} src={src} alt={alt} tip={alt || undefined} />;
}

/** An Engine colour (0xRRGGBB, game data such as a nation's colour) as CSS. */
const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;
/**
 * ImageLibrary.getOccupationIndicatorChip's colours, the owner's nation colour and the text drawn on it, as the
 * --nation and --nation-ink properties the chip's style reads.
 */
const chipColours = (u: UnitRef) =>
  u.rgb === undefined ? undefined : ({ '--nation': hex(u.rgb), '--nation-ink': hex(u.fg ?? 0) } as CSSProperties);

/** UnitLabel's occupation chip, and for a damaged unit its repair status in red; only units outside the colony and ships in port have them. */
function Occupation({ u }: { u: UnitRef }) {
  if (!u.occupation && !u.repair) return null;
  return (
    <>
      {u.occupation && (
        <Tip as="span" className="chip" tip={u.occupationFull} style={chipColours(u)}>
          {u.occupation}
        </Tip>
      )}
      {u.repair && <span className="repair">{u.repair}</span>}
    </>
  );
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
  // The drag shows the colonist's picture, not the tile or the chip around it, and puts down what was picked.
  const drag = draggableProps(
    item,
    (keys) => {
      hand.pick(null);
      return withShift(shiftPressed || keys.shiftKey);
    },
    (el) => (item.kind === 'unit' ? el.querySelector('img.unit') : null),
  );
  return {
    // Only goods are picked by a click: a colonist is moved by a drag or its menu, and has no pick to show.
    'data-picked': movable && item.kind === 'goods' ? picked : undefined,
    ...(movable ? drag : {}),
    // As DragListener.mousePressed, shift on the press makes the drag partial.
    onMouseDown: (e: MouseEvent) => (shiftPressed = e.shiftKey),
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
  const moves = useContext(ColonyActions);
  const movable = useMovable({ kind: 'unit', id: u.id });
  const onContextMenu = useContextMenu((m) => m.unit(u.id));
  // Goods of the warehouse dropped on a colonist equip it (DefaultTransferHandler.equipUnitIfPossible).
  const target = useTarget('unit', (item) => {
    if (item.kind === 'goods') moves?.equip(u.id, item.type);
  });
  return (
    <span className={className} data-unit={u.id} {...(inert ? undefined : { onContextMenu, ...movable, ...target })}>
      <Img keys={u.keys} art={art} className="unit" alt={u.name} />
      {!inert && <Occupation u={u} />}
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
  market,
}: {
  g: Goods;
  item: Item;
  /** The id of the colony the goods are stored in, or of the ship they are aboard (for their menu). */
  at: string;
  art: Art;
  className?: string;
  /** More than the warehouse holds (Swing's red). */
  over?: boolean;
  /** Europe's prices (the colony's `market`); null after independence. */
  market: ColonyView['market'];
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
      <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} tip={priceTip(g, market) ?? g.name} />
    </span>
  );
}

/**
 * What Europe pays and asks for goods, from the Engine's Market, and what the amount held is worth at the sell
 * price; a boycotted goods type says so in place of a price. Nothing after independence (no Europe).
 */
export function priceTip(g: Goods, market: ColonyView['market']): string | null {
  const m = market?.find((p) => p.type === g.type);
  if (!m) return null;
  if (!m.enabled) return `${g.name}: ${g.amount} \u00b7 ${(m.reason ?? 'boycotted').replace(/\s*[^.!?]*\?\s*$/, '')}`;
  return `${g.name}: ${m.sell}/${m.buy} (${g.amount * m.sell})`;
}

const Units = ({ units, art }: { units: UnitRef[]; art: Art }) => units.map((u) => <Unit key={u.id} u={u} art={art} />);

/** The props that make an element a place things go to, or none when the panel cannot move them. */
function useTarget(place: Place, drop: (item: Item) => void): PlaceProps | null {
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

/** ColonyPanel's wood with the population's octagons (ImageLibrary.getColonyUpperRightBackground). */
const OCTAGONS = PANEL_KEYS.colonyOctagons;
/** Where each octagon is in that image, at its 1x size: the top two empty, the lower two with the muskets and the crown. */
const OCTAGON_AT = { size: [66, 6], change: [372, 6], rebels: [66, 152], royalists: [372, 152] } as const;

/**
 * ColonyPanel's upperRightPanel: the tiles, the net production and the construction, with the octagons
 * paintComponent writes the population in, round the tiles (the colony's size, its preferred size change, and the
 * shares of rebels and royalists); RebelToolTip shows while the pointer rests on it, as in Swing.
 */
function Board({ c, art, children }: { c: ColonyView; art: Art; children: ReactNode }) {
  const p = c.population;
  const wood = art([OCTAGONS]);
  const octagon = (part: keyof typeof OCTAGON_AT, text: string) => {
    const [x, y] = OCTAGON_AT[part];
    return (
      <span
        className={`octagon ${part}`}
        data-part={part}
        style={wood === null ? undefined : { backgroundImage: `url(${wood})`, backgroundPosition: `-${x}px -${y}px` }}
      >
        {text}
      </span>
    );
  };
  return (
    <Tip as="div" className="board" data-part="population" tip={<RebelTipBox tip={p.tip} art={art} />}>
      {octagon('size', String(p.size))}
      {octagon('change', p.sizeChange)}
      {octagon('rebels', `${p.rebelPercent}%`)}
      {octagon('royalists', `${100 - p.rebelPercent}%`)}
      {children}
    </Tip>
  );
}

/**
 * RebelToolTip, as a hint (Tip): the rebels and royalists with their counts and shares; each liberty goods type with
 * what the colony makes of it; the bar towards the next rebel; and the turns to the next rebel, to 50% and to 100%,
 * with how many colonists the colony can take or should lose at its bonus.
 */
function RebelTipBox({ tip, art }: { tip: RebelTip; art: Art }) {
  const { bar } = tip;
  const width = (n: number) => `${Math.max(0, Math.min(100, (100 * n) / Math.max(1, bar.max)))}%`;
  return (
    <div className="rebel-tip">
      {tip.members.map(([label, count, share]) => (
        <div key={label} className="tip-row">
          <span>{label}</span>
          <span className="num">{count}</span>
          <span className="num">{share}</span>
        </div>
      ))}
      {tip.liberty.map((g) => (
        <div key={g.type} className="tip-row" data-goods={g.type}>
          <span>{g.name}</span>
          <span className="span2">
            <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} icons />
          </span>
        </div>
      ))}
      {/* FreeColProgressBar: what is there, darker, and what comes next turn, lighter, under the icon and its text. */}
      <div className="tip-bar">
        <i className="value" style={{ width: width(bar.value) }} />
        <i className="step" style={{ left: width(bar.value), width: width(Math.max(0, bar.step)) }} />
        <span className="label">
          <Img keys={bar.keys} art={art} className="icon" />
          {bar.text}
        </span>
      </div>
      {tip.turns.map(([label, value]) => (
        <div key={label} className="tip-row">
          <span>{label}</span>
          <span className="span2 num">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** A part of the panel FreeCol gives no caption, named by data-part. */
const Part = ({ part, title, children }: { part: string; title?: string; children: ReactNode }) => (
  <Tip as="section" className={`box ${part}`} data-part={part} tip={title}>
    {children}
  </Tip>
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
  const carry = worker ? { ...movable, onContextMenu } : { onContextMenu };
  return (
    <Tip
      as="div"
      className="tile"
      data-tile={t.id}
      data-ours={t.ours}
      data-drop={target && !t.centre ? '' : undefined}
      tip={t.name}
      style={style}
      {...(t.centre ? undefined : target)}
      {...carry}
    >
      {/* The diamond itself is what a drop or click lands on, as tiles overlap by their boxes. */}
      <span className="hit" />
      {children}
    </Tip>
  );
}

/** ColonyInPortPanel: the ships in port, one of which is chosen. */
function InPort({ c, art, choose }: { c: ColonyView; art: Art; choose: (id: string) => void }) {
  const port = c.inPort;
  const ship = chosenShip(c);
  return (
    <Box caption={port.title} data-part="port" className="port">
      {port.units.map((u) => (
        <ShipIcon key={u.id} c={c} u={u} art={art} chosen={u.id === ship?.id} choose={choose} />
      ))}
    </Box>
  );
}

/**
 * A ship's icon in the port list. Dropped on, it takes what its cargo box does: a colonist beside the colony or
 * working in it boards, and goods of the warehouse are loaded.
 */
function ShipIcon({
  c,
  u,
  art,
  chosen,
  choose,
}: {
  c: ColonyView;
  u: ColonyView['inPort']['units'][number];
  art: Art;
  chosen: boolean;
  choose: (id: string) => void;
}) {
  const menus = useContext(ContextMenuContext);
  const moves = useContext(ColonyActions);
  const boardable = new Set([...c.outside.units, ...workingIn(c)].map((x) => x.id));
  const target = useTarget('cargo', (item) => {
    if (!moves) return;
    if (item.kind === 'unit' && boardable.has(item.id)) moves.board(item.id, u.id);
    else if (item.kind === 'goods' && item.from === 'warehouse') moves.load(u.id, item.type, item.ask ?? false);
  });
  return (
    <Tip
      as="button"
      className="ship"
      data-unit={u.id}
      data-drop={target ? '' : undefined}
      aria-pressed={chosen}
      tip={u.name}
      onClick={() => choose(u.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        const menu = menus?.unit(u.id);
        if (menu) menus!.show(menu, e.clientX, e.clientY);
      }}
      {...target}
    >
      <Img keys={u.keys} art={art} className="unit" alt={u.name} />
      <Occupation u={u} />
    </Tip>
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
              market={c.market}
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
          market={c.market}
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
  const openQueue = useContext(OpenQueue);
  const target = useTarget('building', (item) => {
    if (item.kind === 'unit' && b.id !== null) moves?.work(item.id, b.id);
  });
  const [over, setOver] = useState<DOMRect | null>(null);
  return (
    <div
      className="building"
      data-building={b.id}
      data-builds={b.builds || undefined}
      data-drop={target ? '' : undefined}
      aria-label={b.name}
      style={style}
      onMouseEnter={(e) => setOver(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setOver(null)}
      onMouseDown={() => setOver(null)}
      {...target}
      onClick={(e) => {
        target?.onClick();
        // BuildingPanel: a building that can build opens the build queue (unless the click was on a worker).
        if (moves && b.builds && !(e.target as HTMLElement).closest('.unit')) openQueue();
      }}
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
function BuildableLabel({ b, art, compact = false }: { b: Buildable; art: Art; compact?: boolean }) {
  if (compact) return <span className="name">{b.name}</span>;
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
 * The colony panel's keys go to the colony only while its dialog is the newest window (not under the warehouse
 * dialog or a question), and not while the player types in a field or holds a modifier.
 */
function useColonyKey(on: (key: string) => void) {
  const handler = useRef(on);
  handler.current = on;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
      if (e.target instanceof Element && e.target.matches(TEXT_ENTRY)) return;
      const windows = document.querySelectorAll('.dialog[data-kind]');
      const top = windows[windows.length - 1];
      if (top && top.getAttribute('data-kind') !== 'colony') return;
      handler.current(e.key);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

/**
 * BuildQueuePanel: edit the colony's build queue, and pay for the build. What the colony is building (the
 * children) is the button that opens it.
 */
function BuildQueue({ c, art, children }: { c: ColonyView; art: Art; children: ReactNode }) {
  useCoverage('showBuildQueuePanel');
  const moves = useContext(ColonyActions);
  const { colopedia } = useContext(ReportContext);
  /** Right-click on a building or unit of a list opens its Colopedia entry (BuildQueuePanel). */
  const aboutIt = (type: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    colopedia(type);
  };
  const [, redraw] = useState(0);
  const state = queueOf(c.id);
  const set = (s: QueueState) => {
    queues.set(c.id, s);
    redraw((n) => n + 1);
  };
  // Ctrl- or shift-click selects rows (queued by index, buildable by type); Enter adds the selected buildables and
  // Delete removes the selected queued rows, as BuildQueuePanel's lists do.
  const [selQueue, setSelQueue] = useState<number[]>([]);
  const [selList, setSelList] = useState<string[]>([]);
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const q = c.queue;
  // B opens the build queue (ColonyPanel's buildQueueCmd).
  useColonyKey((key) => {
    if (moves && key.toLowerCase() === 'b' && !state.open) set({ ...state, open: true });
  });
  if (!moves) return <Part part="construction">{children}</Part>;
  const ids = q.queue.map((b) => b.type);
  const move = (from: number, to: number) => {
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    moves.setQueue(c.id, next);
  };
  const multi = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => e.ctrlKey || e.metaKey || e.shiftKey;
  /** Drop on a queue position: reorder a queued row, or insert buildables there. */
  const dropAt = (d: QueueDrag, at: number) => {
    if (d.from === 'queue') move(d.index, d.index < at ? at - 1 : at);
    else moves.setQueue(c.id, [...ids.slice(0, at), ...d.types, ...ids.slice(at)]);
    setSelList([]);
  };
  const lists = [
    { part: 'buildings', title: q.buildingsTitle, items: q.buildings },
    { part: 'units', title: q.unitsTitle, items: q.units },
  ];
  return (
    <>
      <Tip
        as="section"
        className="box construction"
        data-part="construction"
        role="button"
        tabIndex={0}
        aria-label={q.title}
        tip={q.title}
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
      </Tip>
      {state.open && (
        <>
          <div className="queue-backdrop" onClick={() => set({ ...state, open: false })} />
          <div
            className="queue-body"
            role="dialog"
            aria-label={q.title}
            tabIndex={-1}
            ref={(el) => {
              if (el && !el.contains(document.activeElement)) el.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && selList.length > 0) {
                e.preventDefault();
                moves.setQueue(c.id, [...ids, ...selList]);
                setSelList([]);
              } else if (e.key === 'Delete' && selQueue.length > 0) {
                e.preventDefault();
                moves.setQueue(
                  c.id,
                  ids.filter((_, j) => !selQueue.includes(j)),
                );
                setSelQueue([]);
              }
            }}
          >
            <Tip
              as="button"
              className="queue-close"
              aria-label="close"
              tip="close"
              onClick={() => set({ ...state, open: false })}
            >
              ✕
            </Tip>
            <Box caption={q.title} data-part="queued" className="queued">
              <ol
                {...queueDrag.target(
                  () => true,
                  (d) => dropAt(d, ids.length),
                )}
              >
                {q.queue.map((b, i) => (
                  <li
                    key={`${b.type}:${i}`}
                    data-queued={b.type}
                    data-locked={b.reason !== null || undefined}
                    onContextMenu={aboutIt(b.type)}
                    data-selected={selQueue.includes(i) || undefined}
                    {...queueDrag.source(() => ({ from: 'queue', index: i }))}
                    {...queueDrag.target(
                      () => true,
                      (d) => dropAt(d, i),
                    )}
                    onClick={(e) => {
                      if (multi(e)) setSelQueue(toggle(selQueue, i));
                    }}
                  >
                    <Tip as="button" disabled={i === 0} aria-label="up" tip="up" onClick={() => move(i, i - 1)}>
                      ↑
                    </Tip>
                    <Tip
                      as="button"
                      disabled={i === ids.length - 1}
                      aria-label="down"
                      tip="down"
                      onClick={() => move(i, i + 1)}
                    >
                      ↓
                    </Tip>
                    <Tip
                      as="button"
                      aria-label="remove"
                      tip="remove"
                      onClick={() =>
                        moves.setQueue(
                          c.id,
                          ids.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ✕
                    </Tip>
                    <BuildableLabel b={b} art={art} compact={state.compact} />
                  </li>
                ))}
              </ol>
            </Box>
            {lists.map(({ part, title, items }) => (
              <Box key={part} caption={title} data-part={part} className="can-build">
                <ul
                  // A queued row dropped back on a list leaves the queue.
                  {...queueDrag.target(
                    (d) => d.from === 'queue',
                    (d) => {
                      if (d.from === 'queue') {
                        moves.setQueue(
                          c.id,
                          ids.filter((_, j) => j !== d.index),
                        );
                      }
                    },
                  )}
                >
                  {items
                    .filter((b) => state.all || b.reason === null)
                    .map((b) => (
                      <li
                        key={b.type}
                        data-buildable={b.type}
                        data-locked={b.reason !== null || undefined}
                        onContextMenu={aboutIt(b.type)}
                        data-selected={selList.includes(b.type) || undefined}
                        // Dragging one of several selected buildables takes them all.
                        {...(b.reason === null
                          ? queueDrag.source(() => ({
                              from: 'list',
                              types: selList.includes(b.type) ? selList : [b.type],
                            }))
                          : {})}
                      >
                        <Tip
                          as="button"
                          disabled={b.reason !== null}
                          tip={b.reason ?? b.name}
                          onClick={(e) => {
                            if (multi(e)) {
                              setSelList(toggle(selList, b.type));
                              return;
                            }
                            setSelList([]);
                            moves.setQueue(c.id, [...ids, b.type]);
                          }}
                        >
                          <BuildableLabel b={b} art={art} compact={state.compact} />
                        </Tip>
                      </li>
                    ))}
                </ul>
              </Box>
            ))}
            <label className="show-all">
              <input type="checkbox" checked={state.all} onChange={(e) => set({ ...state, all: e.target.checked })} />
              {q.showAll}
            </label>
            <label className="show-all compact">
              <input
                type="checkbox"
                checked={state.compact}
                onChange={(e) => set({ ...state, compact: e.target.checked })}
              />
              {q.compact}
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
  const moves = useContext(ColonyActions);
  const [picked, show] = useState<Item | null>(() => picks.get(c.id) ?? null);
  const setPicked = (item: Item | null) => {
    picks.set(c.id, item);
    show(item);
  };
  // Left and Right step to the previous and next colony (ColonyPanel's name box), W opens the warehouse and C the
  // menu of the colony's units.
  useColonyKey((key) => {
    if (!moves) return;
    if (key === 'ArrowLeft') moves.step(c.id, -1);
    else if (key === 'ArrowRight') moves.step(c.id, 1);
    else if (key.toLowerCase() === 'w') moves.warehouse(c.id);
    else if (key.toLowerCase() === 'c') moves.units(c.id);
  });
  // A unit that has left the colony, or been disbanded, or goods that are gone, are no longer picked.
  // The ship chosen in port is kept in chosen; this draws the panel again as another is chosen.
  const [, redraw] = useState(0);
  const choose = (id: string) => {
    chosen.set(c.id, id);
    redraw((n) => n + 1);
  };
  const openQueue = () => {
    queues.set(c.id, { ...queueOf(c.id), open: true });
    redraw((n) => n + 1);
  };
  const here = picked !== null && isHere(c, picked);
  // ColonyPanel's U and L keys act on the ship chosen in port (the buttons are there at zero size).
  useColonyKey((key) => {
    const ship = chosenShip(c);
    if (!moves || !ship) return;
    if (key.toLowerCase() === 'u') moves.unloadAll(ship.id);
    else if (key.toLowerCase() === 'l') moves.fill(ship.id);
  });
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
    <OpenQueue.Provider value={openQueue}>
      <HandContext.Provider value={hand}>
        <div className="colony">
          <div className="cbody">
            <div className="buildings">
              {c.buildings.map((b, i) => {
                const at = scatter(i, c.buildings.length);
                return b.site ? (
                  // EmptyBuildingSite: the plot's image, nothing more.
                  <Tip as="div" key={b.type} className="building site" data-site={b.type} tip={b.name} style={at}>
                    <Img keys={b.keys} art={art} className="art" />
                  </Tip>
                ) : (
                  <BuildingPlace key={b.type} b={b} art={art} style={at}>
                    <span className="name">{b.name}</span>
                    <Img keys={b.keys} art={art} className="art" />
                    <span className="output">
                      {b.production && <Made g={b.production} art={art} max={b.production.max} />}
                      {b.upkeep !== null && (
                        // BuildingPanel's UpkeepLabel: the coin, with the upkeep.
                        <Tip as="span" className="upkeep" tip={String(b.upkeep)}>
                          <Img keys={[COIN]} art={art} className="icon" />
                          {b.upkeep}
                        </Tip>
                      )}
                    </span>
                    <span className="workers">
                      {/* Empty places are left blank: no box, outline or shadow. */}
                      <Units units={b.workers} art={art} />
                    </span>
                  </BuildingPlace>
                );
              })}
            </div>
            <div className="upper">
              <Board c={c} art={art}>
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
                        <span>{c.construction.name}</span>
                        {c.construction.required.map((r) => (
                          <GoodsProgressBar key={r.type} need={r} art={art} />
                        ))}
                      </div>
                    </>
                  )}
                </BuildQueue>
              </Board>
              <InPort c={c} art={art} choose={choose} />
              {footer}
            </div>
            <Outside c={c} art={art} />
            <Cargo c={c} art={art} />
            <Warehouse c={c} art={art} />
          </div>
        </div>
      </HandContext.Provider>
    </OpenQueue.Provider>
  );
}
