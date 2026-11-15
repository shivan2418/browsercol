import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test } from 'vite-plus/test';
import template from '../sw.template.js?raw';
import {
  audioList,
  cacheBuild,
  manifest,
  packGroups,
  paletteColours,
  precacheList,
  serviceWorker,
  soundEffects,
  writePacks,
  type Pack,
  type Sized,
} from '../scripts/pwa.ts';
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

test('the sound effects are precached; the music and the other audio wait (#505)', () => {
  const effects = soundEffects(
    JSON.stringify({
      sounds: {
        'sound.attack.artillery': { file: 'sound/attack/artillery.ogg', music: false },
        'sound.event.buildingComplete': { file: 'sound/event/build.ogg', music: false },
        'sound.event.loadCargo': { file: 'sound/event/build.ogg', music: false },
        'sound.intro.general': { file: 'sound/intro.ogg', music: true },
        // A file both a sound and a music entry play is music.
        'sound.event.meet': { file: 'sound/meet/a.ogg', music: true },
        'sound.event.other': { file: 'sound/meet/a.ogg', music: false },
      },
      playlist: ['music/a.ogg'],
    }),
  );
  expect(effects).toEqual(['audio/audio.json', 'audio/sound/attack/artillery.ogg', 'audio/sound/event/build.ogg']);
  const files = [
    'index.html',
    'assets/x.js',
    'audio/audio.json',
    'audio/sound/attack/artillery.ogg',
    'audio/sound/event/build.ogg',
    'audio/sound/intro.ogg',
    'audio/sound/meet/a.ogg',
    'audio/music/a.ogg',
  ];
  expect(precacheList(files, effects)).toEqual([
    './',
    './assets/x.js',
    './audio/audio.json',
    './audio/sound/attack/artillery.ogg',
    './audio/sound/event/build.ogg',
  ]);
});

test("the worker's audio download is the audio the precache leaves out (#505)", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-'));
  try {
    fs.mkdirSync(path.join(out, 'audio', 'music'), { recursive: true });
    fs.writeFileSync(path.join(out, 'audio', 'audio.json'), '{}');
    fs.writeFileSync(path.join(out, 'audio', 'boom.ogg'), 'xx');
    fs.writeFileSync(path.join(out, 'audio', 'music', 'a.ogg'), 'xxxx');
    expect(audioList(out, ['audio/audio.json', 'audio/boom.ogg'])).toEqual([['./audio/music/a.ogg', 4]]);
  } finally {
    fs.rmSync(out, { recursive: true });
  }
});

test('the cache is named for the build and its files, in characters a name can hold', () => {
  expect(cacheBuild('build 17 · 28d5f88 · 2026-11-13', 'ab12cd34')).toBe('build-17-28d5f88-2026-11-13-ab12cd34');
  expect(cacheBuild('dev · unknown', 'ab12cd34')).toBe('dev-unknown-ab12cd34');
});

test("a directory's files stay in one pack, and directories share one until it is full (#519)", () => {
  const shell: Sized[] = [
    ['./', 10],
    ['./assets/x-ab12cd34.js', 10],
    ['./art/a/one.png', 5],
    ['./art/a/two.png', 5],
    ['./art/b/one.png', 2],
    ['./art/c/one.png', 20],
    ['./art/c/deep/one.png', 1],
    ['./presets/p.json', 1],
  ];
  expect(packGroups(shell, 10).map((g) => g.map(([f]) => f))).toEqual([
    ['./art/a/one.png', './art/a/two.png'],
    ['./art/b/one.png', './art/c/one.png'],
    ['./art/c/deep/one.png', './presets/p.json'],
  ]);
});

/** A built site in a temporary directory, with the given files and contents. */
function site(files: Record<string, string>) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), text);
  }
  return out;
}

test('a pack is its files end to end, named for them; the page and assets/ stay loose (#519)', () => {
  const files = { 'index.html': 'page', 'assets/x-ab12cd34.js': 'js', 'art/a.png': 'AAA', 'presets/p.json': '{}' };
  const shell = ['./', './art/a.png', './assets/x-ab12cd34.js', './presets/p.json'];
  const out = site(files);
  const again = site(files);
  const changed = site({ ...files, 'art/a.png': 'AAB' });
  try {
    const plan = writePacks(out, shell);
    expect(plan.loose).toEqual([
      ['./', 4],
      ['./assets/x-ab12cd34.js', 2],
    ]);
    expect(plan.packs).toHaveLength(1);
    const pack = plan.packs[0]!;
    expect(pack.file).toMatch(/^\.\/packs\/[0-9a-f]{12}\.bin$/);
    expect(pack.files).toEqual([
      ['./art/a.png', 3],
      ['./presets/p.json', 2],
    ]);
    expect(fs.readFileSync(path.join(out, pack.file), 'utf8')).toBe('AAA{}');
    expect(writePacks(again, shell).packs[0]!.file).toBe(pack.file);
    expect(writePacks(changed, shell).packs[0]!.file).not.toBe(pack.file);
  } finally {
    for (const d of [out, again, changed]) fs.rmSync(d, { recursive: true });
  }
});

test('the service worker is named for the build and lists the loose files and the packs', () => {
  const sw = serviceWorker(template, "it's 17", {
    loose: [['./assets/x.js', 5]],
    packs: [{ file: './packs/abc.bin', files: [['./art/a.png', 3]] }],
  });
  expect(sw).toContain(`const BUILD = "it's 17";`);
  expect(sw).toContain('const LOOSE = [["./assets/x.js",5]];');
  expect(sw).toContain('const PACKS = [["./packs/abc.bin",[["./art/a.png",3]]]];');
  expect(sw).not.toMatch(/__[A-Z]+__/);
});

test('the service worker lists the audio with its sizes for the offline download (#505)', () => {
  const sw = serviceWorker(template, 'b', { loose: [['./', 0]], packs: [] }, [['./audio/a.ogg', 1234]]);
  expect(sw).toContain('[["./audio/a.ogg",1234]]');
  expect(sw).not.toContain('__AUDIO__');
});

const SCOPE = 'https://x.test/play/';

/**
 * The worker run against fake caches and network, with the messages it posts to its page. `served` is the network's
 * files by URL relative to the page (any other answers 'x'); `older` are the caches of builds before, by name.
 */
function worker({
  audio = [],
  failing = [],
  loose = [['./', 0]],
  packs = [],
  served = {},
  older = {},
}: {
  audio?: [string, number][];
  failing?: string[];
  loose?: Sized[];
  packs?: Pack[];
  served?: Record<string, string>;
  older?: Record<string, Map<string, Response>>;
} = {}) {
  const caches = new Map<string, Map<string, unknown>>(Object.entries(older));
  const stored = new Map<string, unknown>();
  caches.set('browsercol-b', stored);
  const posted: Record<string, unknown>[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const open = (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const c = caches.get(name)!;
    return {
      keys: async () => [...c.keys()].map((url) => ({ url })),
      match: async (url: string) => (c.get(url) as Response | undefined)?.clone(),
      put: async (url: string, r: unknown) => void c.set(url, r),
      delete: async (url: string) => c.delete(url),
    };
  };
  const fetched: string[] = [];
  /** Each fetch's cache mode, by URL. */
  const modes: Record<string, string | undefined> = {};
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    clients: { matchAll: async () => [{ postMessage: (m: Record<string, unknown>) => posted.push(m) }] },
  };
  vm.runInNewContext(serviceWorker(template, 'b', { loose, packs }, audio), {
    self,
    URL,
    Blob,
    Response,
    location: { origin: 'https://x.test' },
    caches: { open: async (name: string) => open(name), keys: async () => [...caches.keys()] },
    fetch: async (r: { url: string; init?: { cache?: string } }) => {
      fetched.push(r.url);
      modes[r.url] = r.init?.cache;
      const status = failing.some((f) => r.url.endsWith(f)) ? 404 : 200;
      return new Response(served[r.url.slice(SCOPE.length) ? `./${r.url.slice(SCOPE.length)}` : './'] ?? 'x', {
        status,
      });
    },
    Request: class {
      constructor(
        public url: string,
        public init?: { cache?: string },
      ) {}
    },
  });
  const send = async (type: string) => {
    const waits: Promise<unknown>[] = [];
    listeners.message!({ data: { type }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const install = async () => {
    const waits: Promise<unknown>[] = [];
    listeners.install!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /** A cached file's text, by URL relative to the page. */
  const text = async (file: string) => (stored.get(new URL(file, SCOPE).href) as Response | undefined)?.clone().text();
  return { stored, posted, fetched, modes, send, install, text };
}

const PACK: Pack = {
  file: './packs/abc.bin',
  files: [
    ['./art/a.png', 3],
    ['./presets/p.json', 2],
  ],
};

test('the install takes what the page loaded from the browser cache, and tells the page how far it is', async () => {
  const w = worker({
    loose: [
      ['./', 100],
      ['./assets/client-unIB02Jv.wasm', 600],
    ],
    packs: [{ file: './packs/abc.bin', files: [['./art/tile.png', 300]] }],
    served: { './packs/abc.bin': 'p'.repeat(300) },
  });
  await w.install();
  // A file named for its content never changes: the browser's copy will do. The page is checked, not fetched anew.
  expect(w.modes[`${SCOPE}assets/client-unIB02Jv.wasm`]).toBe('force-cache');
  expect(w.modes[`${SCOPE}packs/abc.bin`]).toBe('force-cache');
  expect(w.modes[SCOPE]).toBe('no-cache');
  const progress = w.posted.filter((m) => m.type === 'offline-progress');
  expect(progress[0]).toMatchObject({ state: 'saving', bytes: 0, totalBytes: 1000 });
  expect(progress.at(-1)).toMatchObject({ state: 'saved', bytes: 1000, totalBytes: 1000 });
});

test("the install splits a pack into its files, each under its own URL with its type (#519)", async () => {
  const w = worker({ packs: [PACK], served: { './packs/abc.bin': 'PNG{}' } });
  await w.install();
  expect(w.fetched.sort()).toEqual([SCOPE, `${SCOPE}packs/abc.bin`]);
  expect(await w.text('./art/a.png')).toBe('PNG');
  expect(await w.text('./presets/p.json')).toBe('{}');
  const png = w.stored.get(`${SCOPE}art/a.png`) as Response;
  expect(png.headers.get('Content-Type')).toBe('image/png');
  expect(w.stored.has(`${SCOPE}packs/abc.bin?saved`)).toBe(true);
  // The pack itself is not kept: its files are.
  expect(w.stored.has(`${SCOPE}packs/abc.bin`)).toBe(false);
});

test("a new build copies a pack the last build's cache has, and downloads it not again (#519)", async () => {
  const last = new Map<string, Response>([
    [`${SCOPE}art/a.png`, new Response('PNG')],
    [`${SCOPE}presets/p.json`, new Response('{}')],
    [`${SCOPE}packs/abc.bin?saved`, new Response('')],
  ]);
  const w = worker({ packs: [PACK], older: { 'browsercol-a': last } });
  await w.install();
  expect(w.fetched).toEqual([SCOPE]);
  expect(await w.text('./art/a.png')).toBe('PNG');
  expect(await w.text('./presets/p.json')).toBe('{}');
  expect(w.posted.at(-1)).toMatchObject({ state: 'saved', bytes: 5 });
});

test('a pack the last build kept only part of is downloaded (#519)', async () => {
  const last = new Map<string, Response>([
    [`${SCOPE}art/a.png`, new Response('PNG')],
    [`${SCOPE}packs/abc.bin?saved`, new Response('')],
  ]);
  const w = worker({ packs: [PACK], served: { './packs/abc.bin': 'PNG{}' }, older: { 'browsercol-a': last } });
  await w.install();
  expect(w.fetched).toContain(`${SCOPE}packs/abc.bin`);
  expect(await w.text('./presets/p.json')).toBe('{}');
});

test('an install that cannot get a file, or gets a pack of the wrong size, tells the page it failed', async () => {
  const missing = worker({ packs: [PACK], failing: ['abc.bin'] });
  await expect(missing.install()).rejects.toThrow('abc.bin');
  expect(missing.posted.at(-1)).toMatchObject({ type: 'offline-progress', state: 'failed' });
  const short = worker({ packs: [PACK], served: { './packs/abc.bin': 'PNG' } });
  await expect(short.install()).rejects.toThrow('3 bytes, not 5');
  expect(short.posted.at(-1)).toMatchObject({ state: 'failed' });
});

test('the worker downloads the audio it lacks, counts a failure and goes on, and reports its progress (#505)', async () => {
  const w = worker({
    audio: [
      ['./audio/a.ogg', 100],
      ['./audio/b.ogg', 200],
      ['./audio/c.ogg', 300],
    ],
    failing: ['b.ogg'],
  });
  w.stored.set('https://x.test/play/audio/a.ogg', 'x');
  await w.send('cache-audio');
  expect(w.fetched.sort()).toEqual(['https://x.test/play/audio/b.ogg', 'https://x.test/play/audio/c.ogg']);
  expect([...w.stored.keys()].sort()).toEqual(['https://x.test/play/audio/a.ogg', 'https://x.test/play/audio/c.ogg']);
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', done: 2, total: 3, bytes: 400, totalBytes: 600, failed: 1 });
  expect(w.posted.some((m) => m.state === 'working')).toBe(true);
});

test('the worker says done once every audio file is in, and drops them on request (#505)', async () => {
  const w = worker({ audio: [['./audio/a.ogg', 100]] });
  await w.send('cache-audio');
  expect(w.posted.at(-1)).toMatchObject({ state: 'done', done: 1, failed: 0 });
  await w.send('drop-audio');
  expect(w.stored.size).toBe(0);
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', done: 0 });
  await w.send('audio-status');
  expect(w.posted.at(-1)).toMatchObject({ state: 'idle', total: 1 });
});
