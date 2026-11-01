import { expect, test } from 'vite-plus/test';
import html from '../index.html?raw';
import css from './theme.css?raw';

/** The custom properties each top-level block of theme.css sets, by its selector. */
function palettes(): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    blocks.set(selector.trim(), new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
  }
  return blocks;
}

test('every palette sets every colour token of the default one', () => {
  const blocks = palettes();
  const colours = [...blocks.get(':root')!].filter((t) => !t.startsWith('--font') && !t.startsWith('--fs'));
  expect(colours.length).toBeGreaterThan(10);
  const others = [...blocks].filter(([s]) => s !== ':root');
  expect(others.map(([s]) => s)).toContain(":root[data-theme='dark']");
  for (const [selector, tokens] of others) expect([...tokens].sort(), selector).toEqual(colours.sort());
});

test('index.html takes its colours from the tokens alone', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  // Shadows may darken whatever is under them; any other colour belongs in theme.css.
  const literals = style.split('\n').filter((l) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(l) && !/box-shadow/.test(l));
  expect(literals).toEqual([]);
});
