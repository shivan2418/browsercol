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
import americaMap from '../maps/america-1492.txt?url';

export interface NationChoice {
  /** FreeCol's id, e.g. model.nation.dutch. */
  id: string;
  /** The name, e.g. Dutch. */
  name: string;
  /** The nation type's id (model.nationType.trade), its name (Trade) and FreeCol's summary of it. */
  typeId: string;
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

/**
 * What a nation type gives a player, as FreeCol's Colopedia lists it (NationTypeDetailPanel): its starting units, and
 * its modifiers as text, e.g. "Trade Bonus: -50%". A type with no modifiers has none.
 */
export interface NationBonus {
  units: string[];
  modifiers: string[];
}

export interface StartOptions {
  nations: NationChoice[];
  /** The other nations, which the player may remove from the game (FreeCol's availability column). */
  rivals: RivalChoice[];
  /** The advantages a European nation may be given when they are selectable. */
  nationTypes: NationTypeChoice[];
  /** What a nation type gives, with or without expert starting units (the difficulty's expertStartingUnits). */
  bonus: (type: string, expert: boolean) => NationBonus;
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
  /** The URL of a map the game comes with (MAPS), imported as importMap is; importMap wins when both are set. */
  builtInMap?: string;
}

/**
 * The maps the game comes with, besides the generated one: the original DOS Colonization's America (#459), as a map
 * of our own made from the DOS game's AMER2.MP (DosMap.java).
 */
export const MAPS: { id: string; name: string; url: string }[] = [
  { id: 'america', name: 'America (1492)', url: americaMap },
];

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

/**
 * A message with FreeCol's {{tag:|country=..|people=..|default=X}} or {{plural:%n%|one=..|default=X}} reduced to its
 * default, as the Swing lists show it.
 */
function plain(message: string): string {
  return message.replace(/\{\{(?:tag|plural):[^}]*?\bdefault=([^}|]*)[^}]*\}\}/g, '$1');
}

/**
 * What a nation type's modifier does to the player, in a plain sentence, from what FreeCol's code does with it; null
 * for one this does not know, which then shows as the Colopedia shows it.
 *
 * @param scopes The keys of the modifier's scopes: a type, an ability or scope.method.<name>.
 * @param goods The goods' name when the modifier is a goods type's production bonus.
 */
export function explainModifier(
  id: string,
  value: number,
  type: string | null,
  scopes: string[],
  goods: string | null,
): string | null {
  const n = String(Math.round(Math.abs(value) * 100) / 100);
  const less = value < 0;
  if (goods !== null) {
    // An additive bonus to the goods each unit makes (a colonist on a tile or in a building).
    return type === 'additive' && !less ? `Each colonist making ${goods} makes ${n} more.` : null;
  }
  const only = (...keys: string[]) => scopes.length === keys.length && keys.every((k) => scopes.includes(k));
  if (type === 'percentage' && only()) {
    switch (id) {
      // ServerPlayer.buy and sell: the goods a trade adds to or takes from the market, which move its prices.
      case 'model.modifier.tradeBonus':
        return `Your buying and selling in Europe moves prices there ${n}% ${less ? 'less' : 'more'}.`;
      // Player.updateImmigrationRequired: the crosses the next immigrant takes.
      case 'model.modifier.religiousUnrestBonus':
        return `Each new colonist from Europe takes ${n}% ${less ? 'fewer' : 'more'} crosses.`;
      // ServerPlayer.csNativeTension: how much each thing that alarms the natives alarms them.
      case 'model.modifier.nativeAlarmModifier':
        return `Natives grow alarmed at you ${n}% ${less ? 'more slowly' : 'faster'}.`;
      // Unit.getConvertProbability: the chance that winning an attack on a native settlement wins a convert, which
      // SimpleCombatModel allows only where the attacker's nation has a missionary (and not from a ship).
      case 'model.modifier.nativeConvertBonus':
        return `Winning an attack on a native settlement that has your missionary is ${n}% ${less ? 'less' : 'more'} likely to win you a convert.`;
    }
  }
  if (id === 'model.modifier.offenceAgainst' && type === 'percentage' && only('scope.method.isIndian')) {
    return `Your units attack natives with ${n}% ${less ? 'less' : 'more'} strength.`;
  }
  // Unit.getInitialMovesLeft: movement points, three to a tile.
  if (id === 'model.modifier.movementBonus' && type === 'additive' && only('model.ability.navalUnit') && !less) {
    const tiles = value / 3;
    return Number.isInteger(tiles)
      ? `Your ships move ${tiles} more tile${tiles === 1 ? '' : 's'} a turn.`
      : `Your ships have ${n} more movement points a turn.`;
  }
  return null;
}

/** FreeCol's ModifierFormat: a sign, the value without trailing zeros, and % for a percentage; × for a multiplier. */
function modifierValue(value: number, type: string | null): string {
  const n = String(Math.round(Math.abs(value) * 100) / 100);
  if (type === 'multiplicative') return `\u00d7${n}`;
  return `${value < 0 ? '-' : '+'}${n}${type === 'percentage' ? '%' : ''}`;
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
        typeId: type,
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
  // A nation type with the ones it extends, the type itself first.
  const lineage = (id: string): Element[] => {
    const out: Element[] = [];
    for (let t = spec.querySelector(`european-nation-type[id="${id}"]`); t && !out.includes(t);) {
      out.push(t);
      const parent = t.getAttribute('extends');
      t = parent ? spec.querySelector(`european-nation-type[id="${parent}"]`) : null;
    }
    return out;
  };
  // EuropeanNationType.getStartingUnits: the units by their id, the type's own over its parent's, and the expert
  // ones over the others when the difficulty gives expert starting units.
  const bonus = (type: string, expert: boolean): NationBonus => {
    const types = lineage(type).reverse();
    const units = new Map<string, Element>();
    for (const pass of expert ? [false, true] : [false]) {
      for (const t of types) {
        for (const u of t.querySelectorAll(':scope > unit')) {
          if ((u.getAttribute('expert-starting-units') === 'true') === pass) units.set(u.getAttribute('id') ?? '', u);
        }
      }
    }
    const unitText = [...units.values()].map((u) => {
      const name = say(`${u.getAttribute('type')}.name`, u.getAttribute('type') ?? '');
      const role = u.getAttribute('role');
      return role && role !== 'model.role.default' ? `${name} (${say(`${role}.name`, role)})` : name;
    });
    // Each modifier as a plain sentence (explainModifier); one it does not know as the Colopedia shows it
    // (ColopediaGameObjectTypePanel.getModifierComponent): a goods type's bonus by the goods' name, any other by the
    // modifier's name and its scope (ModifierFormat.getFeatureAsString), e.g. "Movement Bonus (Naval unit): +3".
    const modifiers = types.flatMap((t) =>
      [...t.querySelectorAll(':scope > modifier')].map((m) => {
        const id = m.getAttribute('id') ?? '';
        const value = Number(m.getAttribute('value'));
        const type = m.getAttribute('type');
        const goods = spec.querySelector(`goods-type[id="${id}"]`) ? say(`${id}.name`, id) : null;
        const keys = [...m.querySelectorAll(':scope > scope')].map(
          (sc) =>
            sc.getAttribute('type') ??
            sc.getAttribute('ability-id') ??
            (sc.getAttribute('method-name') ? `scope.method.${sc.getAttribute('method-name')}` : ''),
        );
        const plainly = explainModifier(id, value, type, keys, goods);
        if (plainly) return plainly;
        const scopes = goods === null ? keys.map((k) => say(`${k}.name`, k)) : [];
        const name = (goods ?? say(`${id}.name`, id)) + (scopes.length ? ` (${scopes.join(', ')})` : '');
        return `${name}: ${modifierValue(value, type)}`;
      }),
    );
    return { units: unitText, modifiers };
  };
  return { nations, rivals, nationTypes, bonus, rulesets, levels, defaultLevel, defaultUnavailable, groups };
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
