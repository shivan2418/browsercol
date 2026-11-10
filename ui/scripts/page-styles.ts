// index.html's own styles in their cascade layers (#421, docs/adr/0008), for the page (vite.config.ts) and the
// stories (.storybook/main.js).

/**
 * Each `<style data-layer="NAME">` block of the page as a plain `<style>` with its rules in `@layer NAME`. The
 * attribute says the layer where the long block can keep its indentation: wrapping it in `@layer` by hand would
 * indent every line of it again.
 */
export function layerPageStyles(html: string): string {
  return html.replace(
    /<style data-layer="([\w-]+)">([\s\S]*?)<\/style>/g,
    (_, layer: string, css: string) => `<style>@layer ${layer} {${css}}</style>`,
  );
}
