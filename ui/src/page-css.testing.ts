// The page's CSS as the tests read it, as text (docs/adr/0008): index.html's own styles and each component's sheet.
import html from '../index.html?raw';

/** The CSS of index.html's <style> blocks, one after another, whatever their layer. */
export const pageCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** The token files: the theme's colours, fonts and other tokens. */
export const TOKEN_FILES = ['./theme.css', './fonts.css', './tokens.css'];

/** Every sheet of src/ (the token files and the components' own), by file. */
export const sheets = import.meta.glob<string>('./*.css', { query: '?raw', import: 'default', eager: true });

/** The components' own sheets, beside their components, by file. */
export const componentSheets = Object.fromEntries(Object.entries(sheets).filter(([f]) => !TOKEN_FILES.includes(f)));
