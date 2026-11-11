// FreeCol's InfoPanel (#216), in the map's bottom-right corner as CornerMapControls puts it: the active unit's
// picture, its description and moves, and for a carrier what it has aboard (fillUnitPanel); once no unit is left
// to move in our turn, the end turn message and button (fillEndPanel). A press on the unit panel centres the map
// on the unit, as the panel's mouse listener does. The tile mode (terrain view) is not drawn yet. Once the art has
// it, FreeCol's skin is the panel's background: a desk with a skull on it, over a sheet of paper.
import type { CSSProperties, ReactNode } from 'react';
import { Tip } from './controls';
import { cssUrl, type Art } from './frame';
import { PANEL_KEYS } from './map-keys';
import type { ActiveUnit } from './tileset';

export interface InfoPanelProps {
  /** The active unit, once a map view about it has come. */
  unit: ActiveUnit | null;
  /** Whether no unit is left to move in our turn (isIdle in turn-banner.tsx). */
  idle: boolean;
  /** The end turn message and button label from the last map; FreeCol's English until one has come. */
  endTurn?: { text: string; button: string };
  art: Art;
  /** Centre the map on the active unit. */
  centre: () => void;
  endTurnNow: () => void;
}

/** FreeCol's English, for a map from before the Engine sent its own. */
export const END_TURN = { text: 'Press enter in order to end the turn.', button: 'End Turn' };

/** InfoPanel's two modes the Browser UI has: the unit, and the end turn message; otherwise an empty panel. */
export function InfoPanel({ unit, idle, endTurn = END_TURN, art, centre, endTurnNow }: InfoPanelProps) {
  if (unit) return <UnitPanel unit={unit} art={art} centre={centre} />;
  return (
    <Skinned art={art}>
      {idle && (
        <div className="info-end">
          <p>{endTurn.text}</p>
          <button onClick={endTurnNow}>{endTurn.button}</button>
        </div>
      )}
    </Skinned>
  );
}

/** The panel's box, with FreeCol's skin behind it once the art has it. */
function Skinned({
  art,
  className,
  onPointerDown,
  children,
}: {
  art: Art;
  className?: string;
  onPointerDown?: () => void;
  children: ReactNode;
}) {
  const skin = art([PANEL_KEYS.infoPanel]);
  const classes = [className, skin && 'skinned'].filter(Boolean).join(' ');
  return (
    <section
      id="info-panel"
      aria-label="Information"
      className={classes || undefined}
      style={skin ? ({ '--skin': cssUrl(skin) } as CSSProperties) : undefined}
      onPointerDown={onPointerDown}
    >
      {children}
    </section>
  );
}

function UnitPanel({ unit, art, centre }: { unit: ActiveUnit; art: Art; centre: () => void }) {
  const src = art(unit.keys);
  return (
    <Skinned art={art} className="info-unit" onPointerDown={centre}>
      <div className="info-picture">{src && <img src={src} alt="" />}</div>
      <div className="info-text">
        <p className="info-label">{unit.label}</p>
        <p className="info-moves">{unit.status}</p>
        {unit.units.length > 0 && (
          <ul className="info-units" aria-label="Units aboard">
            {unit.units.map((u, i) => {
              const pic = art(u.keys);
              return (
                <Tip as="li" key={i} tip={u.name}>
                  {pic ? <img src={pic} alt={u.name} /> : u.name}
                </Tip>
              );
            })}
          </ul>
        )}
        {unit.goods.length > 0 && (
          <ul className="info-goods" aria-label="Goods aboard">
            {unit.goods.map((g, i) => {
              const pic = art(g.keys);
              return (
                <Tip as="li" key={i} tip={g.name}>
                  {pic ? (
                    <>
                      <img src={pic} alt={g.name} />
                      <span>{g.amount}</span>
                    </>
                  ) : (
                    g.name
                  )}
                </Tip>
              );
            })}
          </ul>
        )}
      </div>
    </Skinned>
  );
}
