// What the start screen offers and what it sends (#55). FreeCol's NewPanel
// and StartGamePanel let a single player pick the difficulty level and the
// nation. The choices come from the ruleset's own specification and strings
// in the data bundle (the one the Engine reads), so a ruleset with other
// nations or levels shows those. The pick goes to the server Engine as a
// GamePreset's JSON, the same way ?preset= does. The map generator options
// (#57) are options of the preset like the others.

import { messageFiles } from './language';
import { bundleFile as file, rulesStrings, specification } from './specification';
import { specificationGroup, type OptionGroup, type OptionValue } from './options';

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

/** A nation the player cannot play but can leave out of the game: a rival European or a native nation. */
export interface RivalChoice {
  id: string;
  name: string;
  color: string;
  native: boolean;
}

/** A nation type (an advantage) a European nation may take. */
export interface NationTypeChoice {
  id: string;
  name: string;
  description: string;
}

/** FreeCol's National Advantages choices (NationOptions.Advantages), in the order NewPanel lists them. */
export const ADVANTAGES = ['SELECTABLE', 'FIXED', 'NONE'] as const;
export type Advantages = (typeof ADVANTAGES)[number];

export interface LevelChoice {
  /** FreeCol's id, e.g. model.difficulty.medium. */
  id: string;
  name: string;
}

export interface StartOptions {
  nations: NationChoice[];
  /** The other nations, which the player may remove from the game (FreeCol's availability column). */
  rivals: RivalChoice[];
  /** The advantages a European nation may be given when they are selectable. */
  nationTypes: NationTypeChoice[];
  /** The rulesets the data bundle has, e.g. classic and freecol. */
  rulesets: string[];
  levels: LevelChoice[];
  /** The level FreeCol starts a new game at. */
  defaultLevel: string;
  /** The selectable nations that start a new game unticked under Other nations, as FreeCol's NationOptions leaves them out; none if absent. */
  defaultUnavailable?: string[];
  /** The option groups the player may change before the game starts (#56); null if the ruleset has none. */
  groups: {
    /** A difficulty level's options. */
    level: (id: string) => OptionGroup | null;
    /** The game options. */
    game: () => OptionGroup | null;
    /** The map generator options: map size, land mass, rivers, mountains and so on. */
    mapGenerator: () => OptionGroup | null;
  };
}

/** What the player picked; a null nation is the Engine's first free one. */
export interface StartChoice {
  nation: string | null;
  difficulty: string;
  /** The options the player changed, by FreeCol's option id: what the preset's options hold. */
  options: Record<string, OptionValue>;
  /** National advantages: absent is FreeCol's default, selectable. */
  advantages?: Advantages;
  /** The nation's own advantage, picked from the nation types; absent keeps the nation's. */
  nationType?: string;
  /** Nation colours the player changed, as CSS `#rrggbb` by nation id. */
  colors?: Record<string, string>;
  /** The nations left out of the game. */
  unavailable?: string[];
  /** The map or save file the map generator imports in place of a generated map (its import file option). */
  importMap?: File;
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

/** How many European nations FreeCol's NationOptions makes available at first (FreeCol.EUROPEANS_DEFAULT). */
const EUROPEANS_DEFAULT = 4;

/**
 * The selectable European nations and the difficulty levels of a ruleset.
 *
 * @param data The data bundle: alternating `data/<path>` and file text.
 * @param rules The ruleset's id, e.g. classic.
 * @param defaultLevel The level a new game starts at.
 */
export function startOptions(data: string[], rules: string, defaultLevel = 'model.difficulty.medium'): StartOptions {
  const spec = specification(data, rules);
  const text = new Map(rulesStrings(data, rules, messageFiles(data)).flatMap((f) => [...properties(file(data, f))]));
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

  const rivals = [...spec.querySelectorAll('nations > nation')]
    .filter((n) => n.getAttribute('selectable') !== 'true' && n.getAttribute('id') !== 'model.nation.unknownEnemy')
    .filter((n) => !spec.querySelector(`european-nation-type[id="${n.getAttribute('nation-type')}"][ref="true"]`))
    .map((n): RivalChoice => {
      const id = n.getAttribute('id')!;
      const type = n.getAttribute('nation-type') ?? '';
      return {
        id,
        name: say(`${id}.name`, id),
        color: css(n.getAttribute('color')),
        native: !!spec.querySelector(`indian-nation-type[id="${type}"]`),
      };
    });
  // Swing's choices: the visible European types (all but the option-only one).
  const nationTypes = [...spec.querySelectorAll('european-nation-types > european-nation-type')]
    .map((t) => t.getAttribute('id')!)
    .filter(
      (id) =>
        id !== 'model.nationType.optionOnly' && !spec.querySelector(`european-nation-type[id="${id}"][ref="true"]`),
    )
    .map((id): NationTypeChoice => ({ id, name: say(`${id}.name`, id), description: say(`${id}.shortDescription`) }));
  const rulesets = [
    ...new Set(
      data.flatMap((p, i) => (i % 2 === 0 ? [/^data\/rules\/([^/]+)\/specification\.xml$/.exec(p)?.[1] ?? ''] : [])),
    ),
  ].filter((r) => r && r !== 'testing');

  // FreeCol's Custom level is a level to edit option by option; here any level can be changed, so it is not listed.
  const levels = [...spec.querySelectorAll('optionGroup[id="difficultyLevels"] > optionGroup')]
    .map((g) => g.getAttribute('id')!)
    .filter((id) => id !== 'model.difficulty.custom')
    .map((id): LevelChoice => ({ id, name: say(`${id}.name`, id) }));

  const groups = {
    level: (id: string) =>
      specificationGroup(data, rules, `optionGroup[id="difficultyLevels"] > optionGroup[id="${id}"]`),
    game: () => specificationGroup(data, rules, 'optionGroup[id="gameOptions"]'),
    mapGenerator: () => specificationGroup(data, rules, 'optionGroup[id="mapGeneratorOptions"]'),
  };
  // FreeCol's NationOptions makes the first four selectable European nations of the specification
  // available and the rest not (FreeCol.EUROPEANS_DEFAULT), whatever the ruleset; the spec has no flag
  // for it.
  const defaultUnavailable = nations.slice(EUROPEANS_DEFAULT).map((n) => n.id);
  return { nations, rivals, nationTypes, rulesets, levels, defaultLevel, defaultUnavailable, groups };
}

/** The GamePreset JSON for the Engine: the level, and the options changed from the level's own values. */
export function presetJson(choice: StartChoice): string {
  return JSON.stringify({
    ...(choice.nation ? { nation: choice.nation } : {}),
    difficulty: choice.difficulty,
    ...(choice.advantages && choice.advantages !== 'SELECTABLE' ? { advantages: choice.advantages } : {}),
    ...(choice.nationType ? { nationType: choice.nationType } : {}),
    ...(choice.colors && Object.keys(choice.colors).length > 0
      ? { colors: Object.fromEntries(Object.entries(choice.colors).map(([id, c]) => [id, `0x${c.replace('#', '')}`])) }
      : {}),
    ...(choice.unavailable && choice.unavailable.length > 0 ? { unavailable: choice.unavailable } : {}),
    ...(Object.keys(choice.options).length > 0 ? { options: choice.options } : {}),
  });
}
