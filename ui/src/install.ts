// BrowserCol as an installed app (#267): the theme colour the window's title bar takes from the menu bar.

/** Make the browser's theme colour (the installed window's title bar) the palette's menu bar colour. */
export function syncThemeColor(doc: Document = document) {
  const colour = getComputedStyle(doc.documentElement).getPropertyValue('--menubar').trim();
  if (!colour) return;
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.append(meta);
  }
  meta.content = colour;
}
