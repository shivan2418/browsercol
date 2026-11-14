// The installable app (#267): the web app manifest, made at build time (vite.config.ts writes it beside the site).

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
