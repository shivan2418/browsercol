// The page's CSS as the tests read it, as text (docs/adr/0008): index.html's own styles and each component's sheet.
import html from '../index.html?raw';

/** The CSS of index.html's <style> blocks, one after another, whatever their layer. */
export const pageCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** The token files: the theme's colours, fonts and other tokens. */
export const TOKEN_FILES = ['./theme.css', './fonts.css', './tokens.css'];

/** Every sheet of src/ (the token files and the components' own), by file. */
// No type argument on import.meta.glob: Vitest keeps a module out of its file cache only when its source says
// "import.meta.glob(", and a cached one keeps the files there were when it was cached (#500). glob-cache.test.ts checks.
export const sheets = import.meta.glob('./*.css', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** The components' own sheets, beside their components, by file. */
export const componentSheets = Object.fromEntries(Object.entries(sheets).filter(([f]) => !TOKEN_FILES.includes(f)));
