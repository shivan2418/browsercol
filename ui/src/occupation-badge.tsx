// UnitLabel's occupation badge, and a damaged unit's repair status (colony panel). Its styles are in occupation-badge.css.
import type { CSSProperties } from 'react';
import { Tip } from './controls';
import type { UnitRef } from './webgui';
import './occupation-badge.css';

/** An Engine colour (0xRRGGBB, game data such as a nation's colour) as CSS. */
const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;
/**
 * ImageLibrary.getOccupationIndicatorChip's colours, the owner's nation colour and the text drawn on it, as the
 * --nation and --nation-ink properties the badge's style reads.
 */
const badgeColours = (u: UnitRef) =>
  u.rgb === undefined ? undefined : ({ '--nation': hex(u.rgb), '--nation-ink': hex(u.fg ?? 0) } as CSSProperties);

/** UnitLabel's occupation badge, and for a damaged unit its repair status in red; only units outside the colony and ships in port have them. */
export function Occupation({ u }: { u: UnitRef }) {
  if (!u.occupation && !u.repair) return null;
  return (
    <>
      {u.occupation && (
        <Tip as="span" className="occupation-badge" tip={u.occupationFull} style={badgeColours(u)}>
          {u.occupation}
        </Tip>
      )}
      {u.repair && <span className="repair">{u.repair}</span>}
    </>
  );
}
