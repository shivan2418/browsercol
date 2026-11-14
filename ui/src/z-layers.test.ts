import { expect, test } from 'vite-plus/test';
import tokensCss from './tokens.css?raw';
import { componentSheets, pageCss } from './page-css.testing';

// The z-index scale (#504, docs/adr/0008): every z-index is a --z-* token of tokens.css. The page-level layers
// are in one order, windows (.modal) have a layer like the rest, and the regions of the page (#game, #side,
// #menubar) keep the stacking of what is in them to themselves, so a map control can never draw over a window.

const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** The page-level layers, lowest first: the order tokens.css must declare them in, with their values rising. */
const LAYERS = [
  '--z-map-notice',
  '--z-tag',
  '--z-menubar',
  '--z-window',
  '--z-menubar-raised',
  '--z-start',
  '--z-start-tag',
  '--z-update',
  '--z-loading',
  '--z-mobile-notice',
  '--z-error',
  '--z-log',
  '--z-feedback',
  '--z-tooltip',
  '--z-popup',
  '--z-dim',
  '--z-drag',
  '--z-rotate',
];

/** Local tokens, for stacking inside a component or region: they never decide what is over a window. */
const LOCAL = ['--z-raise', '--z-raise-2', '--z-raise-3', '--z-cover', '--z-cover-body'];

/** Who may use each page-level layer: every one of them is here, so a new use is a deliberate edit. */
const USERS: Record<string, string[]> = {
  '--z-map-notice': ['./reload-notice.css: .reload-notice', './turn-banner.css: .turn-banner'],
  '--z-tag': ['./feedback.css: .beta-tag.corner'],
  '--z-menubar': ['index.html: #menubar'],
  '--z-window': ['./modal.css: .modal'],
  '--z-menubar-raised': ["./europe-panel.css: body:has(.dialog[data-kind='europe']) #menubar"],
  '--z-start': ['./start-window.css: .start'],
  '--z-start-tag': [
    './feedback.css: body:has(.start) .beta-tag.corner',
    './offline-indicator.css: .offline-status.corner',
  ],
  '--z-update': ['./update-prompt.css: .update-prompt'],
  '--z-loading': ['index.html: #loading'],
  '--z-mobile-notice': ['./mobile-notice.css: #mobile-notice'],
  '--z-error': ['./errors.css: .error-banner'],
  '--z-log': ['./log.css: .modal:has(#log)'],
  '--z-feedback': ['./feedback.css: .modal:has(#feedback)'],
  '--z-tooltip': ['./colony-tips.css: .building-tip'],
  '--z-popup': ['./form-controls.css: .ui-positioner', './popup-menu.css: .popup'],
  '--z-dim': ['index.html: body::after'],
  '--z-drag': ['index.html: .drag-ghost'],
  '--z-rotate': ['./rotate-notice.css: #rotate-notice'],
};

function declarations(text: string) {
  const out: { selector: string; prop: string; value: string }[] = [];
  for (const [, selector, body] of bare(text).matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g))
      out.push({ selector: selector.trim().replace(/\s+/g, ' '), prop, value: value.trim() });
  return out;
}

/** Every z-index of the page's styles: the file, the rule's selector and the value. */
const zIndexes = [
  ...declarations(pageCss).map((d) => ({ file: 'index.html', ...d })),
  ...Object.entries(componentSheets).flatMap(([file, text]) => declarations(text).map((d) => ({ file, ...d }))),
].filter((d) => d.prop === 'z-index');

const tokenValues = new Map(
  [...bare(tokensCss).matchAll(/(--z-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const),
);

const tokenOf = (value: string) => /^var\((--z-[\w-]+)\)$/.exec(value)?.[1];

test('the z-index scale is declared in tokens.css, the page-level layers in their order', () => {
  expect([...tokenValues.keys()].filter((t) => LAYERS.includes(t))).toEqual(LAYERS);
  expect([...tokenValues.keys()].filter((t) => !LAYERS.includes(t)).sort()).toEqual([...LOCAL].sort());
  const values = LAYERS.map((t) => Number(tokenValues.get(t)));
  for (const [i, v] of values.entries()) expect(Number.isInteger(v), LAYERS[i]).toBe(true);
  expect(values, 'each layer is over the one before it').toEqual([...values].sort((a, b) => a - b));
  expect(new Set(values).size).toBe(values.length);
  // A local token is small: it only orders things inside one component, under the lowest page-level layer.
  for (const t of LOCAL) expect(Number(tokenValues.get(t)), t).toBeLessThan(Number(tokenValues.get(LAYERS[0])));
});

test('every z-index in the styles is a layer token, never a number', () => {
  expect(zIndexes.length).toBeGreaterThan(20);
  const literals = zIndexes
    .filter((d) => !tokenOf(d.value))
    .map((d) => `${d.file}: ${d.selector} { z-index: ${d.value} }`);
  expect(literals).toEqual([]);
  const unknown = zIndexes
    .map((d) => tokenOf(d.value))
    .filter((t): t is string => !!t && !LAYERS.includes(t) && !LOCAL.includes(t));
  expect(unknown).toEqual([]);
});

test('a page-level layer is used by the one thing it is for, so none is out of order', () => {
  const used: Record<string, string[]> = Object.fromEntries(LAYERS.map((t) => [t, []]));
  for (const d of zIndexes) {
    const token = tokenOf(d.value);
    if (token && LAYERS.includes(token)) used[token].push(`${d.file}: ${d.selector}`);
  }
  for (const t of LAYERS) used[t].sort();
  expect(used).toEqual(Object.fromEntries(LAYERS.map((t) => [t, [...USERS[t]].sort()])));
});

test('the regions of the page are stacking contexts, so nothing in them can rise over a window', () => {
  const rules = declarations(pageCss);
  for (const region of ['#game', '#side'])
    expect(
      rules.some((d) => d.selector === region && d.prop === 'isolation' && d.value === 'isolate'),
      `${region} isolates`,
    ).toBe(true);
  expect(
    rules.some((d) => d.selector === '#menubar' && d.prop === 'z-index' && tokenOf(d.value) === '--z-menubar'),
    '#menubar has its layer',
  ).toBe(true);
  // Windows have a layer of their own.
  expect(zIndexes.find((d) => d.selector === '.modal')?.value).toBe('var(--z-window)');
});
