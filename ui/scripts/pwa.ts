// The installable app (#267): the web app manifest, and (#296) the service worker's file list, made at build time
// (vite.config.ts writes both beside the site). The service worker itself is ui/sw.template.js.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** What the manifest takes from the default palette (src/theme.css, the first :root block). */
export function paletteColours(themeCss: string): { menubar: string; page: string } {
  const block = /:root\s*\{([^}]*)\}/.exec(themeCss.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
  const token = (name: string) => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  const menubar = token('menubar');
  const page = token('page');
  if (!menubar || !page) throw new Error('theme.css sets no --menubar or --page in :root');
  return { menubar, page };
}

/** The web app manifest. Every URL is relative, as the site is served under a path on GitHub Pages. */
export function manifest(themeCss: string) {
  const { menubar, page } = paletteColours(themeCss);
  return {
    id: './',
    name: 'BrowserCol',
    short_name: 'BrowserCol',
    description: 'FreeCol in the browser: the colonization strategy game, played offline once installed.',
    start_url: './',
    scope: './',
    display: 'standalone',
    // In the installed app the menu bar sits in the title bar's place, beside the window's own buttons.
    display_override: ['window-controls-overlay'],
    theme_color: menubar,
    background_color: page,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/**
 * The directories the service worker caches as the game loads them, not at install: the music (93 MB) and the
 * translations (61 languages; English is in the data bundle). A game plays without them: offline, a track never
 * heard is silent, and the page loads again the translation it uses once the worker is in (src/install.ts).
 * Everything else, the art of every Tileset and the sound effects included, is cached at install, so one visit is a
 * whole game offline.
 */
const ON_DEMAND = ['audio/', 'strings/'];

/**
 * The sound effects (#505): audio/'s index and every file only a sound that is not music plays (audio/audio.json's
 * `music: false`), relative to the game's page. They are under a megabyte, so they are cached at install; the music
 * waits for the player's say.
 */
export function soundEffects(audioJson: string): string[] {
  const index = JSON.parse(audioJson) as {
    sounds: Record<string, { file: string; music: boolean }>;
    playlist: string[];
  };
  const music = new Set([
    ...index.playlist,
    ...Object.values(index.sounds)
      .filter((s) => s.music)
      .map((s) => s.file),
  ]);
  const effects = new Set(
    Object.values(index.sounds)
      .filter((s) => !s.music && !music.has(s.file))
      .map((s) => s.file),
  );
  return ['audio/audio.json', ...[...effects].map((f) => `audio/${f}`)];
}

/**
 * The files the service worker caches at install (#296), as URLs relative to the game's page: the page, the
 * Engines, the data, the scripts, styles, fonts and maps (all under assets/), the art, the presets, the icons and
 * the sound effects. `files` are the built game's files, relative to it, with forward slashes; `effects` are
 * soundEffects().
 */
export function precacheList(files: string[], effects: string[] = []): string[] {
  const keep = new Set(effects);
  const shell = files.filter(
    (f) =>
      f !== 'sw.js' &&
      f !== 'index.html' &&
      !f.startsWith('packs/') &&
      (keep.has(f) || !ON_DEMAND.some((d) => f.startsWith(d))),
  );
  return ['./', ...shell.sort().map((f) => `./${f}`)];
}

/** The cache's name for a build: the build id ("build 17 · 28d5f88 · 2026-11-13") with only safe characters. */
export function cacheBuild(build: string, fingerprint: string): string {
  return `${build.replace(/[^\w.]+/g, '-')}-${fingerprint}`;
}

/** A music file the player can have the worker download for offline play (#505): its URL and size in bytes. */
export type AudioFile = [file: string, bytes: number];

/**
 * The audio files under `outDir` that the precache leaves out (the music), by name, for the worker's download (the
 * cache-audio message). `effects` are soundEffects(), cached at install.
 */
export function audioList(outDir: string, effects: string[] = []): AudioFile[] {
  const dir = path.join(outDir, 'audio');
  if (!fs.existsSync(dir)) return [];
  const precached = new Set(effects);
  return listFiles(dir)
    .filter((f) => !precached.has(`audio/${f}`))
    .sort()
    .map((f) => [`./audio/${f}`, fs.statSync(path.join(dir, f)).size]);
}

/** A file and its size in bytes. */
export type Sized = [file: string, bytes: number];

/** A pack (#519): shell files laid end to end in one file, which the worker splits by their sizes. */
export interface Pack {
  /** The pack's URL relative to the page, named for its contents: './packs/<hash>.bin'. */
  file: string;
  files: Sized[];
}

/** The shell as the worker fetches it: the files it fetches one by one, and the packs. */
export interface ShellPlan {
  loose: Sized[];
  packs: Pack[];
}

/** A pack is closed once it holds this much; it is the unit a new build downloads again when one file in it changes. */
export const PACK_BYTES = 3_000_000;

/**
 * The shell files that go in packs: all but the page and assets/. The page has to be the build's own, and assets/'
 * names change with their contents, so the browser's cache usually has them from the page's own load.
 */
const packed = (file: string) => file !== './' && !file.startsWith('./assets/');

/** The directory a file's pack is chosen by: its own, cut to five levels (art/default/resources/images/terrain). */
const packDir = (file: string) => file.slice(2).split('/').slice(0, -1).slice(0, 5).join('/');

/**
 * The packed shell files in packs (#519): a directory's files stay together, and directories in order share a pack
 * until it holds `target` bytes, so a file changed in one directory leaves the packs of the others as they were.
 */
export function packGroups(shell: Sized[], target = PACK_BYTES): Sized[][] {
  const groups: Sized[][] = [];
  let current: Sized[] = [];
  let bytes = 0;
  let dir: string | undefined;
  for (const entry of shell.filter(([f]) => packed(f))) {
    const d = packDir(entry[0]);
    if (d !== dir && bytes >= target) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    dir = d;
    current.push(entry);
    bytes += entry[1];
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Write the packs under `outDir`/packs and say how the worker fetches the shell (precacheList's URLs; './' is the
 * page). A pack's name is the hash of its files' names and contents, so a new build with the same files has the same
 * pack, and its worker copies the files from the last build's cache instead of downloading them.
 */
export function writePacks(outDir: string, shell: string[]): ShellPlan {
  const local = (f: string) => path.join(outDir, f === './' ? 'index.html' : f.slice(2));
  const sized: Sized[] = shell.map((f) => [f, fs.statSync(local(f)).size]);
  const dir = path.join(outDir, 'packs');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const packs = packGroups(sized).map((files) => {
    const contents = files.map(([f]) => fs.readFileSync(local(f)));
    const hash = createHash('sha1');
    files.forEach(([f, n], i) => hash.update(`${f}\0${n}\0`).update(contents[i]!));
    const file = `./packs/${hash.digest('hex').slice(0, 12)}.bin`;
    fs.writeFileSync(local(file), Buffer.concat(contents));
    return { file, files };
  });
  return { loose: sized.filter(([f]) => !packed(f)), packs };
}

/**
 * The service worker for this build: the template with the build's name, the shell as loose files and packs, each
 * file with its size (for the progress the page shows), and the audio list put in.
 */
export function serviceWorker(
  template: string,
  build: string,
  shell: ShellPlan,
  audio: AudioFile[] = [],
): string {
  return template
    .replace('__BUILD__', () => JSON.stringify(build))
    .replace('__LOOSE__', () => JSON.stringify(shell.loose))
    .replace('__PACKS__', () => JSON.stringify(shell.packs.map((p) => [p.file, p.files])))
    .replace('__AUDIO__', () => JSON.stringify(audio));
}

/** Every file under `dir`, relative to it. */
export function listFiles(dir: string, sub = ''): string[] {
  return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, rel) : [rel];
  });
}
