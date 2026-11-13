import vm from 'node:vm';
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

test('the service worker lists the audio with its sizes for the offline download (#505)', () => {
  const sw = serviceWorker(template, 'b', ['./'], [['./audio/a.ogg', 1234]]);
  expect(sw).toContain('[["./audio/a.ogg",1234]]');
  expect(sw).not.toContain('__AUDIO__');
});

/** The worker run against a fake cache and network, with the messages it posts to its page. */
function worker(audio: [string, number][], failing: string[] = []) {
  const stored = new Map<string, string>();
  const posted: Record<string, unknown>[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const cache = {
    keys: async () => [...stored.keys()].map((url) => ({ url })),
    put: async (url: string) => void stored.set(url, 'x'),
    delete: async (url: string) => stored.delete(url),
  };
  const fetched: string[] = [];
  const self = {
    registration: { scope: 'https://x.test/play/' },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    clients: { matchAll: async () => [{ postMessage: (m: Record<string, unknown>) => posted.push(m) }] },
  };
  vm.runInNewContext(serviceWorker(template, 'b', ['./'], audio), {
    self,
    URL,
    location: { origin: 'https://x.test' },
    caches: { open: async () => cache, keys: async () => [] },
    fetch: async (r: { url: string }) => {
      fetched.push(r.url);
      return { status: failing.some((f) => r.url.endsWith(f)) ? 404 : 200 };
    },
    Request: class {
      constructor(public url: string) {}
    },
  });
  const send = async (type: string) => {
    const waits: Promise<unknown>[] = [];
    listeners.message!({ data: { type }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { stored, posted, fetched, send };
}

test('the worker downloads the audio it lacks, counts a failure and goes on, and reports its progress (#505)', async () => {
  const w = worker(
    [
      ['./audio/a.ogg', 100],
      ['./audio/b.ogg', 200],
      ['./audio/c.ogg', 300],
    ],
    ['b.ogg'],
  );
  w.stored.set('https://x.test/play/audio/a.ogg', 'x');
  await w.send('cache-audio');
  expect(w.fetched.sort()).toEqual(['https://x.test/play/audio/b.ogg', 'https://x.test/play/audio/c.ogg']);
  expect([...w.stored.keys()].sort()).toEqual(['https://x.test/play/audio/a.ogg', 'https://x.test/play/audio/c.ogg']);
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', done: 2, total: 3, bytes: 400, totalBytes: 600, failed: 1 });
  expect(w.posted.some((m) => m.state === 'working')).toBe(true);
});

test('the worker says done once every audio file is in, and drops them on request (#505)', async () => {
  const w = worker([['./audio/a.ogg', 100]]);
  await w.send('cache-audio');
  expect(w.posted.at(-1)).toMatchObject({ state: 'done', done: 1, failed: 0 });
  await w.send('drop-audio');
  expect(w.stored.size).toBe(0);
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', done: 0 });
  await w.send('audio-status');
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', total: 1 });
});
