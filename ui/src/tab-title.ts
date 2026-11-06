// The browser tab's title (#266): "BrowserCol" on the title screen, and in a game the year, season and the
// player's nation, as the status line shows them. While it is the player's turn and the tab is hidden the
// title says so, until the tab is shown again.

const NAME = 'BrowserCol';

/** What the title needs of the last map. */
export interface TitleFacts {
  /** The season and year of the turn, e.g. Autumn 1612. */
  turnLabel: string;
  /** The id of the player's nation, e.g. model.nation.dutch. */
  nation: string;
  ourTurn: boolean;
}

/** "model.nation.dutch" as a name: "Dutch". */
function nationName(id: string): string {
  const last = id.split('.').pop() ?? '';
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** "Autumn 1612" as "1612 Autumn": the year first, so a narrow tab still shows it. */
function yearFirst(label: string): string {
  const [season, year, ...rest] = label.trim().split(/\s+/);
  return year ? [year, season, ...rest].join(' ') : label;
}

/** The title for the game as the last map showed it (null before the first map), and whether the tab is hidden. */
export function tabTitle(game: TitleFacts | null, hidden: boolean): string {
  if (!game) return NAME;
  const parts = [yearFirst(game.turnLabel), nationName(game.nation), NAME].filter(Boolean);
  if (hidden && game.ourTurn) parts.unshift('Your turn');
  return parts.join(' · ');
}
