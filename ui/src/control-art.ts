// The art the page's form controls are drawn with (#258, docs/adr/0006): FreeCol's checkmark and
// radio dot. CSS cannot ask the art manifest for a file, so the page puts their URLs in custom
// properties on the root, and index.html uses them as masks filled with a token's colour, which
// lets the tick follow the palette.
import { PANEL_KEYS } from './map-keys';
import { cssUrl, type Art } from './frame';

/** The custom property each control image goes in, by resource key. */
export const CONTROL_ART = {
  [PANEL_KEYS.checkmark]: '--img-checkmark',
  [PANEL_KEYS.radioSelected]: '--img-radio-dot',
} as const;

/** Sets the control images on the root, for those the art has; call again when the art changes. */
export function controlArt(root: HTMLElement, art: Art) {
  for (const [key, property] of Object.entries(CONTROL_ART)) {
    const url = art([key]);
    if (url) root.style.setProperty(property, cssUrl(url));
    else root.style.removeProperty(property);
  }
}
