// FreeCol's option groups as the option editor shows them (#56): the model
// that DifficultyDialog and GameOptionsDialog edit. Two sources fill it:
// the Engine (OptionsJson.java) sends the game's own groups, read-only, for
// the in-game menu; the start screen has no game yet, so it reads the
// ruleset's specification in the data bundle, as start.ts does. The
// Preferences window reads FreeCol's client options from the bundle too.

import { AUTOMATIC, languageName, languages, messageFiles } from './language';

/** One entry of a unit list option: a number of units of a type in a role, as FreeCol's AbstractUnit. */
export interface UnitEntry {
  /** A unit type's id, e.g. model.unit.freeColonist. */
  type: string;
  /** A role's id, e.g. model.role.soldier. */
  role: string;
  number: number;
}

export type OptionValue = boolean | number | string | UnitEntry[];

/** Whether two option values are the same, a unit list entry by entry. */
export function sameValue(a: OptionValue | undefined, b: OptionValue | undefined): boolean {
  return a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));
}

interface Base {
  /** FreeCol's id, e.g. model.option.landPriceFactor. */
  id: string;
  label: string;
  /** The tooltip text, or null. */
  description: string | null;
}

export type OptionNode =
  | (Base & { kind: 'group'; children: OptionNode[] })
  | (Base & { kind: 'boolean'; value: boolean })
  | (Base & { kind: 'integer' | 'percentage'; value: number; min: number; max: number })
  | (Base & { kind: 'select'; value: number; choices: { value: number; label: string }[] })
  | (Base & { kind: 'string'; value: string; choices?: { value: string; label: string }[] })
  | (Base & { kind: 'text'; value: string })
  | (Base & {
      kind: 'units';
      value: UnitEntry[];
      /** The unit types and roles an entry can have. */
      unitTypes: { value: string; label: string }[];
      roles: { value: string; label: string }[];
    });

export type OptionGroup = Extract<OptionNode, { kind: 'group' }>;

/** The options of a group and its subgroups that take a value, by id. */
export function leaves(node: OptionNode): Map<string, Exclude<OptionNode, { kind: 'group' }>> {
  const out = new Map<string, Exclude<OptionNode, { kind: 'group' }>>();
  const walk = (n: OptionNode) => {
    if (n.kind === 'group') n.children.forEach(walk);
    else out.set(n.id, n);
  };
  walk(node);
  return out;
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

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/**
 * An option group of a ruleset's specification, such as a difficulty level
 * or the game options. Options of a kind the editor has no control for (files)
 * and groups with nothing left are left out, as the
 * Engine's OptionsJson leaves them out.
 *
 * @param data The data bundle: alternating `data/<path>` and file text.
 * @param rules The ruleset's id, e.g. classic.
 * @param selector A CSS selector for the group's element in the specification.
 * @returns The group, or null if the specification has none.
 */
export function specificationGroup(data: string[], rules: string, selector: string): OptionGroup | null {
  return xmlGroup(
    data,
    `rules/${rules}/specification.xml`,
    [...messageFiles(data), `rules/${rules}/FreeColMessages.properties`],
    selector,
  );
}

/**
 * FreeCol's client options (data/base/client-options.xml), what its Preferences dialog shows, with
 * their defaults. The hidden group of placements is left out.
 */
export function clientOptionsGroup(data: string[]): OptionGroup | null {
  return xmlGroup(data, 'base/client-options.xml', messageFiles(data), 'optionGroup[id="clientOptions"]');
}

/** An option group of an options file in the data bundle, named by a selector, labelled from the strings files. */
function xmlGroup(data: string[], path: string, strings: string[], selector: string): OptionGroup | null {
  const spec = new DOMParser().parseFromString(file(data, path), 'application/xml');
  const element = spec.querySelector(selector);
  if (!element) return null;
  const text = new Map(strings.flatMap((s) => [...properties(file(data, s))]));
  // A message's {{tag:...|default=X}} reduced to its default, as FreeCol's lists show it.
  const say = (key: string) =>
    text.get(key)?.replace(/\{\{(?:tag|plural):[^}]*?\bdefault=([^}|]*)[^}]*\}\}/g, '$1') ?? null;
  const name = (id: string) => say(`${id}.name`) ?? id;
  // The choices of a string option are listed only in the custom level; the other levels' options of the
  // same id take them from there, as the editor needs a list to pick from.
  const listed = new Map<string, string[]>();
  for (const s of spec.querySelectorAll('stringOption')) {
    const choices = [...s.children].filter((c) => c.tagName === 'choice').map((c) => c.getAttribute('value')!);
    if (choices.length > 0) listed.set(s.getAttribute('id')!, choices);
  }
  const unitTypes = [...spec.querySelectorAll('unit-type')].map((u) => ({
    value: u.getAttribute('id')!,
    label: name(u.getAttribute('id')!),
  }));
  const roles = [...spec.querySelectorAll('roles > role')].map((r) => ({
    value: r.getAttribute('id')!,
    label: name(r.getAttribute('id')!),
  }));
  const choiceLabel = (key: string) => say(key) ?? say(`${key}.name`) ?? key;

  const read = (el: Element): OptionNode | null => {
    const id = el.getAttribute('id')!;
    const base = { id, label: name(id), description: say(`${id}.shortDescription`) };
    const value = el.getAttribute('value') ?? el.getAttribute('defaultValue');
    const number = (attribute: string, otherwise: number) => {
      const v = el.getAttribute(attribute);
      return v === null ? otherwise : Number(v);
    };
    switch (el.tagName) {
      case 'optionGroup': {
        if (el.getAttribute('visible') === 'false') return null;
        const children = [...el.children].flatMap((c) => read(c) ?? []);
        return children.length > 0 ? { ...base, kind: 'group', children } : null;
      }
      case 'booleanOption':
        return { ...base, kind: 'boolean', value: value === 'true' };
      case 'integerOption':
        return {
          ...base,
          kind: 'integer',
          value: Number(value ?? 0),
          min: number('minimumValue', INT_MIN),
          max: number('maximumValue', INT_MAX),
        };
      case 'percentageOption':
        return { ...base, kind: 'percentage', value: Number(value ?? 0), min: 0, max: 100 };
      case 'selectOption':
      case 'rangeOption': {
        const localized = el.getAttribute('localizedLabels') !== 'false';
        const choices = [...el.children]
          .filter((c) => c.tagName === 'selectValue' || c.tagName === 'rangeValue')
          .map((c) => ({
            value: Number(c.getAttribute('value')),
            label: localized ? choiceLabel(c.getAttribute('label')!) : c.getAttribute('label')!,
          }));
        return { ...base, kind: 'select', value: Number(value ?? choices[0]?.value ?? 0), choices };
      }
      case 'stringOption': {
        const own = [...el.children].filter((c) => c.tagName === 'choice').map((c) => c.getAttribute('value')!);
        const values = own.length > 0 ? own : (listed.get(id) ?? []);
        return {
          ...base,
          kind: 'string',
          value: value ?? '',
          ...(values.length > 0 ? { choices: values.map((v) => ({ value: v, label: choiceLabel(v) })) } : {}),
        };
      }
      case 'textOption':
        return { ...base, kind: 'text', value: value ?? '' };
      case 'unitListOption': {
        const entries = [...el.children]
          .filter((c) => c.tagName === 'unitOption')
          .map((c): UnitEntry => ({
            type: c.querySelector('unitType')?.getAttribute('value') ?? '',
            role: c.querySelector('role')?.getAttribute('value') ?? 'model.role.default',
            number: Number(c.querySelector('number')?.getAttribute('value') ?? 1),
          }));
        return { ...base, kind: 'units', value: entries, unitTypes, roles };
      }
      case 'languageOption': {
        // FreeCol's translations, by name, after automatic (LanguageOption.initializeLanguages).
        const named = languages(data)
          .map((v) => ({ value: v, label: languageName(v) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        const automatic = say('clientOptions.gui.languageOption.autoDetectLanguage') ?? AUTOMATIC;
        // The default, clientOptions.gui.languageOption.automatic, is FreeCol's automatic.
        const v = value === null || value.endsWith(AUTOMATIC) ? AUTOMATIC : value;
        return { ...base, kind: 'string', value: v, choices: [{ value: AUTOMATIC, label: automatic }, ...named] };
      }
      default:
        return null;
    }
  };
  const group = read(element);
  return group?.kind === 'group' ? group : null;
}
