// FreeCol's colony panel (ColonyPanel), read-only, laid out as look E
// (docs/adr/0004): the population and the buildings on the left; the 3x3
// tiles, the net production and the construction on the right; then the
// ships in port beside the cargo of the one chosen, the units outside the
// colony, and the warehouse. Every image is found by resource key, so a
// Tileset can replace it; every text comes localized from the Engine
// (ColonyJson.java). The boxes FreeCol captions use the shared Box, and
// goods amounts the shared GoodsAmount (frame.tsx).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

/** The units' images, each naming its unit by id (data-unit), as the browser scripts look for them. */
const Units = ({ units, art }: { units: UnitRef[]; art: Art }) =>
  units.map((u) => (
    <span key={u.id} data-unit={u.id}>
      <Img keys={u.keys} art={art} className="unit" alt={u.name} />
    </span>
  ));

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
            <div
              key={t.id}
              className="tile"
              data-tile={t.id}
              data-ours={t.ours}
              title={t.name}
              style={{ left: ((2 - x + y) * TILE_W) / 2, top: ((x + y) * TILE_H) / 2 }}
            >
              {!draw && <Img keys={t.terrain} art={art} className="terrain" />}
              {!draw && t.forest && <Img keys={t.forest} art={art} className="forest" />}
              {t.taken && <Img keys={TILE_TAKEN} art={art} className="taken" />}
              {t.natives && <Img keys={NATIVE_LAND} art={art} className="natives" />}
              {t.workers.map((u) => (
                <span key={u.id} className="who" data-unit={u.id}>
                  <Img keys={u.keys} art={art} className="unit" alt={u.name} />
                  {u.occupation && <span className="chip">{u.occupation}</span>}
                </span>
              ))}
              {t.production.length > 0 && (
                <span className="made">
                  {t.production.map((g) => (
                    <Made key={g.type} g={g} art={art} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
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

export function ColonyPanel({ colony: c, art }: { colony: ColonyView; art: Art }) {
  const p = c.population;
  return (
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
              <div key={b.type} className="building" title={b.name}>
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
              </div>
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
        <Port c={c} art={art} />
        <Box caption={c.outside.title} data-part="outside" className="outside">
          <Units units={c.outside.units} art={art} />
        </Box>
        <Box caption={c.warehouse.title} data-part="warehouse" className="warehouse">
          {c.warehouse.goods.map((g) => (
            <span key={g.type} className="stored" data-goods={g.type} data-over={g.over}>
              <GoodsAmount keys={g.keys} name={g.name} amount={g.amount} art={art} />
            </span>
          ))}
        </Box>
      </div>
    </div>
  );
}
