// FreeCol's colony panel (ColonyPanel), read-only, laid out as look E
// (docs/adr/0004): the population and the buildings on the left; the 3x3
// tiles, the net production and the construction on the right; then the
// units in port and outside the colony, and the warehouse with the close
// button. Every image is found by resource key, so a Tileset can replace
// it; every text comes localized from the Engine (ColonyJson.java).
import type { ReactNode } from 'react';
import type { Art } from './panels';
import type { ColonyView, GoodsAmount, UnitRef } from './webgui';

/** FreeCol's tile size, which the tiles of TilesPanel are laid out by. */
const TILE_W = 128;
const TILE_H = 64;

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

/** A ProductionLabel: the goods' icon and the amount, signed for net production. */
function Goods({ g, art, text }: { g: GoodsAmount; art: Art; text?: string }) {
  return (
    <span className="goods" data-goods={g.type} title={g.name}>
      <Img keys={g.keys} art={art} className="icon" />
      {text ?? g.amount}
    </span>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** A boxed part of the panel; its caption, if any, names it. */
function Box({
  label,
  caption,
  className,
  children,
}: {
  label: string;
  caption?: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`box ${className}`} aria-label={label}>
      {caption && <span className="cap">{label}</span>}
      {children}
    </section>
  );
}

export function ColonyPanel({ colony: c, art }: { colony: ColonyView; art: Art }) {
  const p = c.population;
  return (
    <div className="colony">
      <h2>{c.name}</h2>
      <div className="cbody">
        <Box label="population" className="population">
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
        </Box>
        <div className="buildings">
          {c.buildings.map((b) => (
            <div key={b.id} className="building" title={b.name}>
              <span className="name">{b.name}</span>
              <Img keys={b.keys} art={art} className="art" />
              {b.production && (
                <span className="output">
                  <Goods
                    g={b.production}
                    art={art}
                    text={
                      b.production.max > b.production.amount ? `${b.production.amount}/${b.production.max}` : undefined
                    }
                  />
                </span>
              )}
              <span className="workers">
                <Units units={b.workers} art={art} />
                {Array.from({ length: Math.max(0, b.capacity - b.workers.length) }, (_, i) => (
                  <span key={i} className="slot" />
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="upper">
          <section className="tiles" aria-label="tiles" style={{ width: TILE_W * 3, height: TILE_H * 3 }}>
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
                  <Img keys={t.terrain} art={art} className="terrain" />
                  {t.forest && <Img keys={t.forest} art={art} className="forest" />}
                  <span className="who">
                    <Units units={t.workers} art={art} />
                  </span>
                  {t.production.length > 0 && (
                    <span className="made">
                      {t.production.map((g) => (
                        <Goods key={g.type} g={g} art={art} />
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </section>
          <Box label="production" className="net">
            {c.production.map((g) => (
              <span key={g.type} className={g.amount < 0 ? 'neg' : ''}>
                <Goods g={g} art={art} text={signed(g.amount)} />
              </span>
            ))}
          </Box>
          <Box label="construction" className="construction">
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
                      <span>{`${r.available}/${r.needed}`}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Box>
        </div>
        <Box label={c.inPort.title} caption className="port">
          <Units units={c.inPort.units} art={art} />
        </Box>
        <Box label={c.outside.title} caption className="outside">
          <Units units={c.outside.units} art={art} />
        </Box>
        <Box label={c.warehouse.title} caption className="warehouse">
          {c.warehouse.goods.map((g) => (
            <span
              key={g.type}
              className={g.amount === 0 ? 'stored zero' : 'stored'}
              data-goods={g.type}
              data-over={g.over}
              title={g.name}
            >
              <Img keys={g.keys} art={art} className="icon" />
              {g.amount}
            </span>
          ))}
        </Box>
      </div>
    </div>
  );
}
