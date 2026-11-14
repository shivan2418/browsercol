// The installable app (#267): the web app manifest, and (#296) the service worker's file list, made at build time
// (vite.config.ts writes both beside the site). The service worker itself is ui/sw.template.js.
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
    (f) => f !== 'sw.js' && f !== 'index.html' && (keep.has(f) || !ON_DEMAND.some((d) => f.startsWith(d))),
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

/** The service worker for this build: the template with the build's name, the file list and the audio list put in. */
export function serviceWorker(template: string, build: string, shell: string[], audio: AudioFile[] = []): string {
  return template
    .replace('__BUILD__', () => JSON.stringify(build))
    .replace('__SHELL__', () => JSON.stringify(shell, null, 2))
    .replace('__AUDIO__', () => JSON.stringify(audio));
}

/** Every file under `dir`, relative to it. */
export function listFiles(dir: string, sub = ''): string[] {
  return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, rel) : [rel];
  });
}
