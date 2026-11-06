import { expect, test } from 'vite-plus/test';
import { manifest, paletteColours } from '../scripts/pwa.ts';
import css from './theme.css?raw';

test('the manifest takes its colours from the default palette', () => {
  const m = manifest(css);
  expect(m.theme_color).toBe(paletteColours(css).menubar);
  expect(m.background_color).toBe(paletteColours(css).page);
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
});

test('the manifest uses relative URLs and puts the menu bar in the title bar', () => {
  const m = manifest(css);
  expect(m.display).toBe('standalone');
  expect(m.display_override).toEqual(['window-controls-overlay']);
  for (const url of [m.id, m.start_url, m.scope, ...m.icons.map((i) => i.src)]) expect(url).toMatch(/^(\.\/|icons\/)/);
  expect(m.icons.map((i) => i.purpose ?? 'any')).toEqual(['any', 'any', 'maskable']);
});
