// The advisor over FreeCol's information panels (InformationPanel): a painted figure leaning over a sheet of
// paper, the panel's whole background, with the text set below the figure. Which figure depends on the player,
// as ImageLibrary.getInformationPanelSkin picks it: the nation's own if the art has one, the general once the
// player is a rebel, else the doctor.

import { PANEL_KEY_FAMILIES } from './map-keys';

/** A skin image and how far down its paper the text starts (its insets.top string resource). */
export interface Advisor {
  src: string;
  top: number;
}

const KEY = PANEL_KEY_FAMILIES.advisor;

/**
 * ImageLibrary.determineInformationPanelSkinKey and getInformationPanelSkinTopInset, for a player of the nation
 * (model.nation.spanish) who is still colonial or not. Null until the art has the skin.
 */
export function advisor(
  art: (keys: readonly string[]) => string | null,
  string: (key: string) => string,
  nation: string,
  colonial: boolean,
): Advisor | null {
  // Player.getNationResourceKey: the nation id's last part.
  const own = colonial ? `${KEY}.${nation.slice(nation.lastIndexOf('.') + 1)}` : `${KEY}.rebel`;
  const key = art([own]) ? own : KEY;
  const src = art([key]);
  if (!src) return null;
  const top = Number.parseInt(string(`${key}.insets.top`), 10);
  return { src, top: Number.isNaN(top) ? 0 : top };
}
