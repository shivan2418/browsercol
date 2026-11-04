import { expect, test } from 'vite-plus/test';
import html from '../index.html?raw';
import css from './theme.css?raw';
import fontsCss from './fonts.css?raw';
import { applyTheme, FONT_SETS, PALETTES } from './theme';

/** The components' sources, by file; tests hold made-up data, such as a nation's colour from the Engine. */
const components = import.meta.glob<string>(['./*.tsx', '!./*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The custom properties each top-level block of theme.css sets, by its selector. */
function palettes(text = css): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  for (const [, selector, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
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

test('the components take their colours from the tokens alone', () => {
  expect(Object.keys(components)).toContain('./frame.tsx');
  const literals = Object.entries(components).flatMap(([file, src]) =>
    src.split('\n').flatMap((l) => (/#[0-9a-f]{3,8}\b['";]|rgba?\(|hsla?\(/i.test(l) ? [`${file}: ${l.trim()}`] : [])),
  );
  expect(literals).toEqual([]);
});

test('each palette the player can pick has its block, and the default is :root', () => {
  const blocks = palettes();
  expect(PALETTES[0].id).toBe('parchment');
  for (const p of PALETTES.slice(1)) expect(blocks.has(`:root[data-theme='${p.id}']`), p.id).toBe(true);
});

test('each font set sets both font tokens, and the default is :root', () => {
  const blocks = palettes(fontsCss);
  expect([...blocks.get(':root')!].sort()).toEqual(['--font', '--font-title']);
  for (const f of FONT_SETS.slice(1)) {
    expect([...(blocks.get(`:root[data-fonts='${f.id}']`) ?? [])].sort(), f.id).toEqual(['--font', '--font-title']);
  }
});

test('the fonts are served from our own files, never a font host', () => {
  const urls = [...fontsCss.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
  expect(urls.length).toBeGreaterThan(10);
  expect(urls.filter((u) => !u.startsWith("'./fonts/"))).toEqual([]);
});

test("the theme goes on the root element, a palette in the URL over the player's own", () => {
  const root = { dataset: {} as DOMStringMap } as HTMLElement;
  applyTheme(root, 'dark', 'cinzel-noto');
  expect(root.dataset).toEqual({ theme: 'dark' });
  applyTheme(root, 'parchment', 'cinzel-noto');
  expect(root.dataset).toEqual({});
  applyTheme(root, 'parchment', 'cinzel-noto', 'dark');
  expect(root.dataset).toEqual({ theme: 'dark' });
});

test('index.html takes its fonts from the tokens alone', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const families = style
    .split('\n')
    .filter((l) => /\bfont(-family)?:/.test(l) && !/var\(--font|inherit|font-(size|weight|style|variant)/.test(l));
  expect(families).toEqual([]);
});
