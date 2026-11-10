import { expect, test } from 'vite-plus/test';
import css from './theme.css?raw';
import fontsCss from './fonts.css?raw';
import tokensCss from './tokens.css?raw';
import html from '../index.html?raw';
import { layerPageStyles } from '../scripts/page-styles';
import { componentSheets, pageCss } from './page-css.testing';
import { applyTheme, FONT_SETS, PALETTES } from './theme';

/** The components' sources, by file; tests hold made-up data, such as a nation's colour from the Engine. */
const components = import.meta.glob<string>(['./*.tsx', '!./*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The custom properties each block of a token file sets (inside its @layer), by its selector. */
function palettes(text = css): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  for (const [, selector, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
  const style = pageCss;
  // Shadows may darken whatever is under them; any other colour belongs in theme.css.
  const literals = style
    .split('\n')
    .filter((l) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(l) && !/box-shadow|drop-shadow/.test(l));
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
  const style = pageCss;
  const families = style
    .split('\n')
    .filter((l) => /\bfont(-family)?:/.test(l) && !/var\(--font|inherit|font-(size|weight|style|variant)/.test(l));
  expect(families).toEqual([]);
});

// ---- Cascade layers and the components' own sheets (#421, docs/adr/0008) ----

/** CSS without its comments. */
const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The sheets of panels, not of a component: the reports' own rules name the dialogs they sit in and size their
 * tables in their own lengths. They are in the components layer like the rest, but the token and panel-name
 * checks below skip them (#435).
 */
const PANEL_SHEETS = ['./reports.css'];

/** Each declaration of a sheet, with the selector of the rule it is in. */
function declarations(text: string) {
  const out: { selector: string; prop: string; value: string }[] = [];
  for (const [, selector, body] of bare(text).matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g))
      out.push({ selector: selector.trim(), prop, value: value.trim() });
  return out;
}

/** A value with its var() and the calc() round them taken out: what is left is written in the sheet itself. */
function literal(value: string): string {
  let v = value;
  for (let last = ''; last !== v;) [last, v] = [v, v.replace(/var\([^()]*\)/g, 'T')];
  for (let last = ''; last !== v;) [last, v] = [v, v.replace(/calc\([^()]*T[^()]*\)/g, 'T')];
  return v;
}

test('the cascade layers are declared first, in their order, and the page puts its styles in them', () => {
  const page = bare(pageCss);
  const order = /@layer[^;{]+;/.exec(page)?.[0];
  expect(order).toBe('@layer reset, base, components, theme;');
  expect(page.indexOf(order!)).toBeLessThan(page.indexOf('{'));
  expect(html).toMatch(/<style data-layer="base">/);
  expect(html).toMatch(/<style data-layer="components">/);
  expect(layerPageStyles(html)).not.toMatch(/<style data-layer/);
});

test('the token files are in the theme layer', () => {
  for (const text of [css, fontsCss, tokensCss]) expect(bare(text).trim()).toMatch(/^@layer theme \{[\s\S]*\}$/);
});

test('the tokens give each kind a theme may change: spacing, radii, borders, the caption type and shadows', () => {
  const tokens = [...(palettes(tokensCss).get(':root') ?? [])];
  for (const kind of ['--space-', '--radius-', '--border', '--caption-size', '--caption-case', '--shadow-'])
    expect(
      tokens.some((t) => t.startsWith(kind)),
      kind,
    ).toBe(true);
});

test("each component's sheet is in the components layer, and imported by a component", () => {
  const files = Object.keys(componentSheets);
  expect(files).toEqual(expect.arrayContaining(['./window-frame.css', './goods.css', './reports.css']));
  for (const file of files) {
    expect(bare(componentSheets[file]).trim(), file).toMatch(/^@layer components \{[\s\S]*\}$/);
    expect(bare(componentSheets[file]).match(/@layer/g), file).toHaveLength(1);
    expect(
      Object.values(components).some((src) => src.includes(`import '${file}';`)),
      `${file} is imported by a component`,
    ).toBe(true);
  }
});

test("a component's sheet takes its colours, fonts, spacing, radii, borders and shadows from tokens", () => {
  const problems: string[] = [];
  for (const [file, text] of Object.entries(componentSheets)) {
    if (PANEL_SHEETS.includes(file)) continue;
    for (const { selector, prop, value } of declarations(text)) {
      // A component's own tokens, on :root, may hold a value of their own: a theme changes them there.
      if (selector === ':root' && prop.startsWith('--')) continue;
      const at = `${file}: ${selector} { ${prop}: ${value} }`;
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) problems.push(`colour: ${at}`);
      if (/^font(-family)?$/.test(prop) && !/var\(--font/.test(value)) problems.push(`font: ${at}`);
      const shape = /^(padding|margin|gap|row-gap|column-gap|border|outline|box-shadow)(-|$)|radius/.test(prop);
      if (shape && /\d*\.?\d+(px|em|rem)\b/.test(literal(value))) problems.push(`length: ${at}`);
    }
  }
  expect(problems).toEqual([]);
});

test("a component's sheet styles its own component, never a panel's", () => {
  const PANELS = /\.dialog\b|\.colony\b|\.europe|#preferences|\.options\b|\.start-window|\[data-kind/;
  const reaching = Object.entries(componentSheets)
    .filter(([file]) => !PANEL_SHEETS.includes(file))
    .flatMap(([file, text]) =>
      [...bare(text).matchAll(/([^{}]+)\{/g)]
        .map((m) => m[1].trim())
        .filter((s) => PANELS.test(s))
        .map((s) => `${file}: ${s}`),
    );
  expect(reaching).toEqual([]);
});

test('what is selected or pressed is drawn by selection.css alone, and never by the text (#437)', () => {
  // A rule whose subject (the last compound of its selector) is a selected or pressed thing, outside selection.css.
  // A bare [aria-current] is what can be picked (aria-current is 'false' until it is), and may set its room.
  const STATE =
    /\[(aria-selected='true'|aria-pressed='true'|aria-current=|data-selected|data-picked)[^\]]*\][^\s>+~]*$/;
  const subjects = (file: string, text: string) =>
    [...bare(text).matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter((s) => STATE.test(s) && !s.includes("[role='tab']"))
      .map((s) => `${file}: ${s}`);
  const others = Object.entries(componentSheets).filter(([file]) => file !== './selection.css');
  expect([...subjects('index.html', pageCss), ...others.flatMap(([file, text]) => subjects(file, text))]).toEqual([]);
  const own = declarations(componentSheets['./selection.css']).filter((d) => d.selector !== ':root');
  expect(own.filter((d) => /^font|^padding|^margin|^border-width/.test(d.prop))).toEqual([]);
});

// ---- Patterns moved out of index.html (#435): each stays in its component's sheet, and a panel never patches it ----

/** The rules that were in index.html for a pattern now beside its component: none may come back. */
const MOVED: Record<string, RegExp> = {
  // A part's own rule may still set what Heading does not (the father's grid column, a report's flex rule).
  'dialog headings (heading.css)':
    /(^|,)\s*(\.dialog|\.europe-log|\.start-window|#credits|\.dialog \.vstop|\.dialog\[data-kind='negotiation'\] \.lead)\s+h[23](\.headline)?\s*$/,
  'pictures (pic.css)':
    /^(\.dialog \.pic(\.small)?|\.dialog \.hold \.pic\.small|\.dialog \.palette \.pic|\.shop-popup \.card \.pic|\.dialog \.goods-big)$/,
  'button rows (button-row.css)':
    /^(\.dialog|\.error-banner|\.start-window|#preferences|\.dialog\[data-kind='europe'\])\s+\.buttons(\s+\[data-answer='close'\])?$/,
};

test('a moved pattern has no rule left in index.html', () => {
  const left = [...bare(pageCss).matchAll(/([^{}]+)\{/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .flatMap((s) =>
      Object.entries(MOVED)
        .filter(([, re]) => re.test(s))
        .map(([name]) => `${name}: ${s}`),
    );
  expect(left).toEqual([]);
});
