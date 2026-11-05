// What the start screen keeps of the options between games and in files (#179): FreeCol's OptionsDialog
// saves the game and map generator options the player OK'd as the defaults of later new games (not the
// difficulty level's), and DifficultyDialog saves and loads a level as a file.

import { leaves, sameValue, type OptionGroup, type OptionNode, type OptionValue, type UnitEntry } from './options';

type Leaf = Exclude<OptionNode, { kind: 'group' }>;

const KEY = 'freecol.defaults.';

/** Whether a stored or loaded value is one the option takes. */
function fits(option: Leaf, v: unknown): v is OptionValue {
  switch (option.kind) {
    case 'boolean':
      return typeof v === 'boolean';
    case 'integer':
    case 'percentage':
      return typeof v === 'number' && Number.isInteger(v) && v >= option.min && v <= option.max;
    case 'select':
      return typeof v === 'number' && option.choices.some((c) => c.value === v);
    case 'string':
      return typeof v === 'string' && (!option.choices || option.choices.some((c) => c.value === v));
    case 'text':
      return typeof v === 'string';
    case 'units':
      return (
        Array.isArray(v) &&
        v.every(
          (e: Partial<UnitEntry> | null) =>
            typeof e === 'object' &&
            e !== null &&
            option.unitTypes.some((t) => t.value === e.type) &&
            option.roles.some((r) => r.value === e.role) &&
            Number.isInteger(e.number) &&
            e.number! >= 1 &&
            e.number! <= 999,
        )
      );
  }
}

/** The values in an object that are changes to the group's options: known options, a fitting value, not the group's own. */
export function validEdits(group: OptionGroup, from: unknown): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  if (typeof from !== 'object' || from === null || Array.isArray(from)) return out;
  const options = leaves(group);
  for (const [id, v] of Object.entries(from)) {
    const option = options.get(id);
    if (option && fits(option, v) && !sameValue(option.value, v)) out[id] = v;
  }
  return out;
}

/** The kind of options kept as defaults: the game options and the map generator's. */
export type DefaultsKind = 'game' | 'map';

/** The options the player OK'd for earlier games, cut to those the group still has. */
export function loadDefaults(kind: DefaultsKind, group: OptionGroup | null): Record<string, OptionValue> {
  if (!group) return {};
  try {
    return validEdits(group, JSON.parse(localStorage.getItem(KEY + kind) ?? 'null'));
  } catch {
    return {};
  }
}

/** Keep the options the player OK'd as the defaults of later games. */
export function saveDefaults(kind: DefaultsKind, edits: Record<string, OptionValue>): void {
  try {
    if (Object.keys(edits).length === 0) localStorage.removeItem(KEY + kind);
    else localStorage.setItem(KEY + kind, JSON.stringify(edits));
  } catch {
    // No storage: the options last for this game only.
  }
}

/** A difficulty level as a file: the level's id and the value of every option, as the player has it. */
export function levelFile(group: OptionGroup, edits: Record<string, OptionValue>): string {
  const options: Record<string, OptionValue> = {};
  for (const [id, o] of leaves(group)) options[id] = edits[id] ?? o.value;
  return JSON.stringify({ difficulty: group.id, options }, null, 2);
}

/**
 * The changes a level file makes to a level.
 *
 * @returns The edits (values that differ from the level's own), or an error text if the file is no level file.
 */
export function readLevelFile(
  group: OptionGroup,
  text: string,
): { edits: Record<string, OptionValue> } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'The file is not a difficulty level.' };
  }
  const options = (parsed as { options?: unknown } | null)?.options;
  if (typeof options !== 'object' || options === null) return { error: 'The file is not a difficulty level.' };
  return { edits: validEdits(group, options) };
}
