// The installable app (#267): the web app manifest and the service worker's file list, made at build time
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
    display_override: ['window-controls-overlay', 'standalone'],
    theme_color: menubar,
    background_color: page,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** The directories the service worker caches as the game loads them: large, and only some of it is ever used. */
const ON_DEMAND = ['art/', 'audio/', 'strings/', 'presets/'];

/**
 * The files the service worker caches at install, as URLs relative to the site: the page, the Engines, the data,
 * the scripts, styles and fonts (all under assets/) and the icons. `files` are the built site's files, relative
 * to it, with forward slashes.
 */
export function precacheList(files: string[]): string[] {
  const shell = files.filter((f) => f !== 'sw.js' && f !== 'index.html' && !ON_DEMAND.some((d) => f.startsWith(d)));
  return ['./', ...shell.sort().map((f) => `./${f}`)];
}

/** The service worker for this build: the template with the build's name and the file list put in. */
export function serviceWorker(template: string, build: string, shell: string[]): string {
  return template.replace('__BUILD__', () => build).replace('__SHELL__', () => JSON.stringify(shell, null, 2));
}

/** Every file under `dir`, relative to it. */
export function listFiles(dir: string, sub = ''): string[] {
  return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, rel) : [rel];
  });
}
