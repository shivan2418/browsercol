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
// of units outside the colony. Clicking works too: click a colonist to pick
// it (again to put it down), then the place it goes to. A picked colonist
// that works somewhere offers the other goods it could make there. The moves
// go to the client Engine's controller (ColonyMoves, Commands.java); the
// panel is shown again as they change the colony.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Box, GoodsAmount, type Art } from './frame';
import { PANEL_KEYS } from './map-keys';
import type { ColonyView, GoodsAmount as Goods, UnitRef } from './webgui';

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

/** What the player can do with the colonists of a colony (Commands.work, putOutsideColony, changeWorkType), by id. */
export interface ColonyMoves {
  /** Put a colonist to work at a building or a colony tile. */
  work(unit: string, location: string): void;
  /** Put a colonist outside the colony. */
  putOutside(unit: string): void;
  /** Change what a working colonist makes. */
  changeWork(unit: string, goods: string): void;
}
/** Without it the panel only shows the colony. */
export const ColonyActions = createContext<ColonyMoves | null>(null);

/** The colonist being moved: picked by a click, or dragged. */
interface Hand {
  /** The unit picked. */
  picked: string | null;
  pick(unit: string | null): void;
  /** Where a unit can be dropped, with what a drop there does; null when the panel cannot move units. */
  target(drop: (unit: string) => void): TargetProps | null;
}
interface TargetProps {
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onClick(): void;
}
const NO_HAND: Hand = { picked: null, pick() {}, target: () => null };
const HandContext = createContext<Hand>(NO_HAND);
/** The unit being dragged: a drag's data cannot be read until it drops, and only by the page's own drag. */
let dragging: string | null = null;
const OVER = 'over-target';

/** The ship chosen in port, per colony, so it stays chosen as the panel is shown again. */
const chosen = new Map<string, string | null>();

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
 * A unit's image, naming its unit by id (data-unit), as the browser scripts look for it. With a ColonyMoves it
 * can be dragged, and a click picks it, or, with another unit picked, goes to the place the unit is in.
 */
function Unit({ u, art, className, children }: { u: UnitRef; art: Art; className?: string; children?: ReactNode }) {
  const hand = useContext(HandContext);
  const movable = hand !== NO_HAND;
  return (
    <span
      className={className}
      data-unit={u.id}
      data-picked={movable ? hand.picked === u.id : undefined}
      draggable={movable || undefined}
      onDragStart={(e) => {
        dragging = u.id;
        e.dataTransfer.setData('text/plain', u.id);
        e.dataTransfer.effectAllowed = 'move';
        hand.pick(null);
      }}
      onDragEnd={() => (dragging = null)}
      onClick={(e) => {
        if (!movable || (hand.picked !== null && hand.picked !== u.id)) return;
        e.stopPropagation();
        hand.pick(hand.picked === u.id ? null : u.id);
      }}
    >
      <Img keys={u.keys} art={art} className="unit" alt={u.name} />
      {children}
    </span>
  );
}

const Units = ({ units, art }: { units: UnitRef[]; art: Art }) => units.map((u) => <Unit key={u.id} u={u} art={art} />);

/** The props that make an element a place units go to, or none when the panel cannot move units. */
function useTarget(drop: (unit: string) => void): TargetProps | null {
  return useContext(HandContext).target(drop);
}

/** A ProductionLabel: the shared goods amount, named by its type (data-goods); `more` follows the number. */
function Made({ g, art, change = false, more }: { g: Goods; art: Art; change?: boolean; more?: string }) {
  return (
    <span className="made-goods" data-goods={g.type}>
      <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} change={change} art={art} />
      {more}
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
                <Unit key={u.id} u={u} art={art} className="who">
                  {u.occupation && <span className="chip">{u.occupation}</span>}
                </Unit>
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
  const target = useTarget((unit) => moves?.work(unit, t.id));
  return (
    <div
      className="tile"
      data-tile={t.id}
      data-ours={t.ours}
      data-drop={target && !t.centre ? '' : undefined}
      title={t.name}
      style={style}
      {...(t.centre ? undefined : target)}
    >
      {/* The diamond itself is what a drop or click lands on, as tiles overlap by their boxes. */}
      <span className="hit" />
      {children}
    </div>
  );
}

/** ColonyInPortPanel and ColonyCargoPanel: the ships in port, and what the chosen one carries. */
function Port({ c, art }: { c: ColonyView; art: Art }) {
  const port = c.inPort;
  const [pick, setPick] = useState(() => (chosen.has(c.id) ? chosen.get(c.id)! : port.selected));
  const ship = port.units.find((u) => u.id === pick) ?? port.units.find((u) => u.id === port.selected) ?? null;
  const choose = (id: string) => {
    chosen.set(c.id, id);
    setPick(id);
  };
  return (
    <>
      <Box caption={port.title} data-part="port" className="port">
        {port.units.map((u) => (
          <button
            key={u.id}
            className="ship"
            data-unit={u.id}
            aria-pressed={u.id === ship?.id}
            title={u.name}
            onClick={() => choose(u.id)}
          >
            <Img keys={u.keys} art={art} className="unit" alt={u.name} />
          </button>
        ))}
      </Box>
      <Box caption={ship ? ship.cargo.title : port.cargo} data-part="cargo" className="cargo">
        {ship && (
          <>
            <Units units={ship.cargo.units} art={art} />
            {ship.cargo.goods.map((g) => (
              <Made key={g.type} g={g} art={art} />
            ))}
          </>
        )}
      </Box>
    </>
  );
}

/** A building that takes colonists. */
function BuildingPlace({ b, children }: { b: ColonyView['buildings'][number]; children: ReactNode }) {
  const moves = useContext(ColonyActions);
  const target = useTarget((unit) => b.id !== null && moves?.work(unit, b.id));
  return (
    <div className="building" data-building={b.id} data-drop={target ? '' : undefined} title={b.name} {...target}>
      {children}
    </div>
  );
}

/** OutsideColonyPanel: the units on the colony's tile, and where a colonist working in the colony is put. */
function Outside({ c, art }: { c: ColonyView; art: Art }) {
  const moves = useContext(ColonyActions);
  const working = new Set(
    [...c.buildings.flatMap((b) => b.workers), ...c.tiles.flatMap((t) => t.workers)].map((u) => u.id),
  );
  // Only a colonist working in the colony is put outside; one already there has nowhere to go.
  const target = useTarget((unit) => working.has(unit) && moves?.putOutside(unit));
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

/** What the picked colonist makes where it works, and the other goods it could make there. */
function WorkChoice({ c, picked, art }: { c: ColonyView; picked: string; art: Art }) {
  const moves = useContext(ColonyActions);
  const u = [...c.buildings.flatMap((b) => b.workers), ...c.tiles.flatMap((t) => t.workers)].find(
    (w) => w.id === picked,
  );
  if (!moves || !u?.choices || u.choices.length < 2) return null;
  return (
    <Part part="work">
      <Unit u={u} art={art} />
      {u.choices.map((g) => (
        <button
          key={g.type}
          className="choice"
          data-goods={g.type}
          aria-pressed={g.type === u.work}
          title={g.name}
          onClick={() => moves.changeWork(u.id, g.type)}
        >
          <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} />
        </button>
      ))}
    </Part>
  );
}

export function ColonyPanel({ colony: c, art }: { colony: ColonyView; art: Art }) {
  const p = c.population;
  const moves = useContext(ColonyActions);
  const [picked, setPicked] = useState<string | null>(null);
  // A unit that has left the colony, or been disbanded, is no longer picked.
  const here = JSON.stringify(c).includes(`"id":"${picked}"`);
  const hand: Hand = !moves
    ? NO_HAND
    : {
        picked: here ? picked : null,
        pick: setPicked,
        target: (drop) => ({
          onDragOver: (e) => {
            if (dragging === null) return;
            e.preventDefault();
            e.currentTarget.classList.add(OVER);
          },
          onDragLeave: (e) => e.currentTarget.classList.remove(OVER),
          onDrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove(OVER);
            const unit = dragging;
            dragging = null;
            if (unit !== null) drop(unit);
          },
          onClick: () => {
            if (here && picked !== null) {
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
          <div className="buildings">
            {c.buildings.map((b) =>
              b.site ? (
                // EmptyBuildingSite: the plot's image, nothing more.
                <div key={b.type} className="building site" data-site={b.type} title={b.name}>
                  <Img keys={b.keys} art={art} className="art" />
                </div>
              ) : (
                <BuildingPlace key={b.type} b={b}>
                  <span className="name">{b.name}</span>
                  <Img keys={b.keys} art={art} className="art" />
                  <span className="output">
                    {b.production && (
                      <Made
                        g={b.production}
                        art={art}
                        more={b.production.max > b.production.amount ? `/${b.production.max}` : undefined}
                      />
                    )}
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
              ),
            )}
          </div>
          <div className="upper">
            <Tiles c={c} art={art} />
            <Part part="net">
              {c.production.map((g) => (
                <Made key={g.type} g={g} art={art} change />
              ))}
            </Part>
            <Part part="construction">
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
            </Part>
          </div>
          {hand.picked !== null && <WorkChoice c={c} picked={hand.picked} art={art} />}
          <Port c={c} art={art} />
          <Outside c={c} art={art} />
          <Box caption={c.warehouse.title} data-part="warehouse" className="warehouse">
            {c.warehouse.goods.map((g) => (
              <span key={g.type} className="stored" data-goods={g.type} data-over={g.over}>
                <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} />
              </span>
            ))}
          </Box>
        </div>
      </div>
    </HandContext.Provider>
  );
}
