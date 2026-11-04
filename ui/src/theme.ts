// The theme the player picks in Preferences: a palette of colours (theme.css) and a font set (fonts.css).
// Each is an attribute on the page's root element, which those files' blocks key on.

export const PALETTES = [
  { id: 'parchment', label: 'Parchment' },
  { id: 'dark', label: 'Dark' },
] as const;
export type Palette = (typeof PALETTES)[number]['id'];

/** The font sets; the first is the default, on :root in fonts.css. */
export const FONT_SETS = [{ id: 'cinzel-noto', label: 'Cinzel titles, Noto Sans text' }] as const;
export type FontSet = (typeof FONT_SETS)[number]['id'];

export const isPalette = (v: unknown): v is Palette => PALETTES.some((p) => p.id === v);
export const isFontSet = (v: unknown): v is FontSet => FONT_SETS.some((f) => f.id === v);

/**
 * Put the theme on the root element. The default palette and font set need no attribute, as :root holds
 * them. A palette named in the URL (?theme=dark) wins over the player's.
 */
export function applyTheme(root: HTMLElement, palette: Palette, fonts: FontSet, urlPalette: string | null = null) {
  const p = urlPalette ?? palette;
  if (p === PALETTES[0].id) delete root.dataset.theme;
  else root.dataset.theme = p;
  if (fonts === FONT_SETS[0].id) delete root.dataset.fonts;
  else root.dataset.fonts = fonts;
}
