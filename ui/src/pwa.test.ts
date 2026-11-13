import { expect, test } from 'vite-plus/test';
import template from '../sw.template.js?raw';
import { cacheBuild, manifest, paletteColours, precacheList, serviceWorker } from '../scripts/pwa.ts';
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

test('the precache holds the shell, the art and the presets; the audio and translations are left to load', () => {
  const list = precacheList([
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'assets/index-ab12.js',
    'assets/client-cd34.wasm',
    'icons/icon-192.png',
    'art/art.json',
    'audio/audio.json',
    'strings/en.json',
    'presets/a.json',
  ]);
  expect(list).toEqual([
    './',
    './art/art.json',
    './assets/client-cd34.wasm',
    './assets/index-ab12.js',
    './icons/icon-192.png',
    './manifest.webmanifest',
    './presets/a.json',
  ]);
});

test('the cache is named for the build and its files, in characters a name can hold', () => {
  expect(cacheBuild('build 17 · 28d5f88 · 2026-11-13', 'ab12cd34')).toBe('build-17-28d5f88-2026-11-13-ab12cd34');
  expect(cacheBuild('dev · unknown', 'ab12cd34')).toBe('dev-unknown-ab12cd34');
});

test('the service worker is named for the build and lists the shell', () => {
  const sw = serviceWorker(template, "it's 17", ['./', './assets/x.js']);
  expect(sw).toContain(`const BUILD = "it's 17";`);
  expect(sw).toContain('"./assets/x.js"');
  expect(sw).not.toContain('__BUILD__');
  expect(sw).not.toContain('__SHELL__');
});
