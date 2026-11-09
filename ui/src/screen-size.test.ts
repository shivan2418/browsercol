// A window never grows past the screen, at any UI scale (#380). Inside an element that --ui-zoom scales (the menu
// bar, the side panel, the windows and the controls' popups), vw and vh are scaled with it: 94vh is 117% of the
// screen at 125%. Those rules size themselves by --screen-w and --screen-h, which divide by the zoom.
import { expect, test } from 'vite-plus/test';
import { pageCss, sheets as srcSheets } from './page-css.testing';

const components = import.meta.glob<string>(['./*.tsx', '!./*.test.tsx', '!./*.stories.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * The rules that may use the viewport's units as they are: those of elements outside every scaled one (the page, the start screen, the loading screen, the right-click menu and the error
 * banner, which are drawn at the browser's own scale).
 */
const UNSCALED = new Set([
  'body',
  '.popup',
  '.error-banner',
  '.start-window',
  '.start-window.new-game',
  ".new-game .more-options [role='tabpanel']",
  '#loading [data-loading-frame]',
]);

/** A length in the viewport's units: 94vh, 100dvh, 50vmin and the like. */
const VIEWPORT = /\b\d+(\.\d+)?[dsl]?v(w|h|i|b|min|max)\b/;

const sheets = { 'index.html': pageCss, ...srcSheets };

/** Each rule of a sheet with a viewport unit in it: its selector and the declaration. */
function viewportRules(css: string) {
  const out: { selector: string; declaration: string }[] = [];
  // Without comments and statements such as the order of the cascade layers, which are no part of a selector.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[\w-]+[^;{}]*;/g, '');
  for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      if (VIEWPORT.test(declaration)) out.push({ selector: selector.trim(), declaration: declaration.trim() });
    }
  }
  return out;
}

test.each(Object.entries(sheets))('%s caps no scaled window by a bare vw or vh', (_, css) => {
  // The tokens themselves are defined from the viewport: on the root, and again on a window scaled by its own --fit.
  const bare = viewportRules(css).filter((r) => !UNSCALED.has(r.selector) && !r.declaration.startsWith('--screen-'));
  expect(bare).toEqual([]);
});

test('the screen tokens divide the viewport by the UI scale', () => {
  const root = viewportRules(sheets['index.html']).filter((r) => r.selector === ':root');
  expect(root.map((r) => r.declaration).sort()).toEqual([
    '--screen-h: calc(100dvh / var(--ui-zoom, 1))',
    '--screen-w: calc(100vw / var(--ui-zoom, 1))',
  ]);
});

test('no component sets a size in the viewport units inline', () => {
  const inline = Object.entries(components).filter(([, src]) => /['"`][^'"`\n]*\b\d+[dsl]?v[wh]\b/.test(src));
  expect(inline.map(([file]) => file)).toEqual([]);
});
