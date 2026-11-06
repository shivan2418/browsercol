// A ruleset's specification as FreeCol's Specification reads it: a ruleset
// whose specification.xml has `extends="classic"` holds only what it changes,
// and is read on top of its parent. start.ts (the nations and levels) and
// options.ts (the option panels) both read it through here.

/** The data bundle's text of a file, from its alternating path and text. */
export function bundleFile(data: string[], path: string): string {
  const i = data.indexOf(`data/${path}`);
  return i < 0 ? '' : data[i + 1];
}

const parse = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

/** The rulesets a ruleset builds on, the base first and the ruleset itself last. */
export function rulesChain(data: string[], rules: string): string[] {
  const chain: string[] = [];
  for (let id: string | null = rules; id && !chain.includes(id);) {
    chain.unshift(id);
    id = parse(bundleFile(data, `rules/${id}/specification.xml`)).documentElement?.getAttribute('extends') ?? null;
  }
  return chain;
}

/** The strings files that label a ruleset: the common ones, then each ruleset's, from the base up (as FreeCol loads them). */
export function rulesStrings(data: string[], rules: string, common: string[]): string[] {
  return [...common, ...rulesChain(data, rules).map((id) => `rules/${id}/FreeColMessages.properties`)];
}

/** An element the child marks for removal: `<delete id=.../>`, or `delete="true"` on an entry. */
const deletes = (e: Element) => e.tagName === 'delete' || e.getAttribute('delete') === 'true';

const copyAttributes = (from: Element, to: Element) => {
  for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
};

/**
 * Lay a child's elements over a parent's, the way FreeCol's Specification does. An element matches
 * the parent's of the same tag and id; a section (an element with no id, such as `<nations>`) the
 * parent's of the same tag.
 *
 * - No match: it is added after the parent's.
 * - An option group is purely additive: its options and subgroups are laid over the matching ones
 *   one by one, and the parent's others stay.
 * - An option takes the child's attributes, and its entries (choices, units) if the child lists any.
 * - Any other type with `preserve="true"` keeps the parent's attributes and has its children merged.
 * - Any other type replaces the parent's.
 * - `<delete id=.../>` and `delete="true"` remove the match.
 */
function overlay(base: Element, over: Element, depth = 0): void {
  for (const c of Array.from(over.children)) {
    const id = c.getAttribute('id');
    const same = (b: Element) =>
      id === null ? b.tagName === c.tagName && b.getAttribute('id') === null : b.getAttribute('id') === id;
    const old = [...base.children].find((b) => (c.tagName === 'delete' ? same(b) : same(b) && b.tagName === c.tagName));
    if (deletes(c)) {
      if (id === null) for (const b of [...base.children].filter((b) => b.tagName === c.tagName)) b.remove();
      else old?.remove();
    } else if (!old || (id === null && depth > 0)) {
      base.append(c.cloneNode(true));
    } else if (c.tagName === 'optionGroup') {
      copyAttributes(c, old);
      overlay(old, c, depth + 1);
    } else if (c.tagName.endsWith('Option')) {
      copyAttributes(c, old);
      if (c.children.length > 0) old.replaceChildren(...[...c.children].map((n) => n.cloneNode(true)));
    } else if (depth === 0) {
      overlay(old, c, depth + 1);
    } else if (c.getAttribute('preserve') === 'true') {
      overlay(old, c, depth + 1);
    } else {
      old.replaceWith(c.cloneNode(true));
    }
  }
}

const cache = new WeakMap<string[], Map<string, Document>>();

/**
 * A ruleset's specification with the ruleset it extends laid under it. The result is shared: read it, do not change it.
 *
 * @param data The data bundle: alternating `data/<path>` and file text.
 * @param rules The ruleset's id, e.g. freecol.
 */
export function specification(data: string[], rules: string): Document {
  let byRules = cache.get(data);
  if (!byRules) cache.set(data, (byRules = new Map()));
  const known = byRules.get(rules);
  if (known) return known;

  const [first, ...rest] = rulesChain(data, rules).map((id) =>
    parse(bundleFile(data, `rules/${id}/specification.xml`)),
  );
  const doc = first ?? parse('');
  for (const over of rest) if (over.documentElement) overlay(doc.documentElement, over.documentElement);
  byRules.set(rules, doc);
  return doc;
}
