// What the start screen offers and what it sends (#55). FreeCol's NewPanel
// and StartGamePanel let a single player pick the difficulty level and the
// nation. The choices come from the ruleset's own specification and strings
// in the data bundle (the one the Engine reads), so a ruleset with other
// nations or levels shows those. The pick goes to the server Engine as a
// GamePreset's JSON, the same way ?preset= does.

export interface NationChoice {
  /** FreeCol's id, e.g. model.nation.dutch. */
  id: string;
  /** The name, e.g. Dutch. */
  name: string;
  /** The nation type's name, e.g. Trade, and what it means for the player. */
  type: string;
  description: string;
  /** The nation's colour as CSS. */
  color: string;
}

export interface LevelChoice {
  /** FreeCol's id, e.g. model.difficulty.medium. */
  id: string;
  name: string;
}

export interface StartOptions {
  nations: NationChoice[];
  levels: LevelChoice[];
  /** The level FreeCol starts a new game at. */
  defaultLevel: string;
}

/** What the player picked; a null nation is the Engine's first free one. */
export interface StartChoice {
  nation: string | null;
  difficulty: string;
}

/** The data bundle's text of a file, from its alternating path and text. */
function file(data: string[], path: string): string {
  const i = data.indexOf(`data/${path}`);
  return i < 0 ? '' : data[i + 1];
}

/** A .properties file's lines, as FreeCol reads them: key=value, # comments. */
function properties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.startsWith('#')) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

/** A message with FreeCol's {{tag:|country=..|people=..|default=X}} reduced to its default, as the Swing lists show it. */
function plain(message: string): string {
  return message.replace(/\{\{tag:[^}]*?\bdefault=([^}|]*)[^}]*\}\}/g, '$1');
}

/** `0xrrggbb`, as the specification writes a colour, as CSS. */
function css(color: string | null): string {
  return `#${(color ?? '0x888888').replace(/^0x/i, '').padStart(6, '0')}`;
}

/**
 * The selectable European nations and the difficulty levels of a ruleset.
 *
 * @param data The data bundle: alternating `data/<path>` and file text.
 * @param rules The ruleset's id, e.g. classic.
 * @param defaultLevel The level a new game starts at.
 */
export function startOptions(data: string[], rules: string, defaultLevel = 'model.difficulty.medium'): StartOptions {
  const spec = new DOMParser().parseFromString(file(data, `rules/${rules}/specification.xml`), 'application/xml');
  const text = new Map([
    ...properties(file(data, 'strings/FreeColMessages.properties')),
    ...properties(file(data, `rules/${rules}/FreeColMessages.properties`)),
  ]);
  const say = (key: string, otherwise = '') => plain(text.get(key) ?? otherwise);

  const nations = [...spec.querySelectorAll('nations > nation')]
    .filter((n) => n.getAttribute('selectable') === 'true')
    .map((n): NationChoice => {
      const id = n.getAttribute('id')!;
      const type = n.getAttribute('nation-type') ?? '';
      return {
        id,
        name: say(`${id}.name`, id),
        type: say(`${type}.name`),
        description: say(`${type}.shortDescription`),
        color: css(n.getAttribute('color')),
      };
    });

  // FreeCol's Custom level is edited option by option, which this screen does not offer.
  const levels = [...spec.querySelectorAll('optionGroup[id="difficultyLevels"] > optionGroup')]
    .map((g) => g.getAttribute('id')!)
    .filter((id) => id !== 'model.difficulty.custom')
    .map((id): LevelChoice => ({ id, name: say(`${id}.name`, id) }));

  return { nations, levels, defaultLevel };
}

/** The GamePreset JSON for the Engine. */
export function presetJson(choice: StartChoice): string {
  return JSON.stringify({
    ...(choice.nation ? { nation: choice.nation } : {}),
    difficulty: choice.difficulty,
  });
}
