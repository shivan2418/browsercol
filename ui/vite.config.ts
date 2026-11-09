import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import { buildId } from './scripts/build-id.ts';
import { layerPageStyles } from './scripts/page-styles.ts';
import { manifest } from './scripts/pwa.ts';

/** The installable app (#267): beside the built site, the web app manifest. */
function installable(): Plugin {
  let outDir = '';
  return {
    name: 'installable',
    apply: 'build',
    configResolved: (config) => {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // Only the built site has a manifest; the dev server would answer the request with the page.
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
    ],
    closeBundle() {
      const themeCss = fs.readFileSync('src/theme.css', 'utf8');
      fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest(themeCss), null, 2));
    },
  };
}

/** index.html's own styles in their cascade layers, by their data-layer attribute (docs/adr/0008). */
function pageLayers(): Plugin {
  return { name: 'page-layers', transformIndexHtml: { order: 'pre', handler: layerPageStyles } };
}

export default defineConfig(({ command }) => ({
  plugins: [pageLayers(), installable()],
  // Relative URLs, so the site works from any path (GitHub Pages serves it under /<repo>/).
  base: './',
  define: { __BUILD__: JSON.stringify(buildId(process.env, command === 'serve')) },
  // Map art from scripts/build-art.ts, copied as is.
  publicDir: 'generated/public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // The UI's own files, and FreeCol's data, which some tests read as text (prefs.test.ts).
    fs: { allow: ['.', '../freecol/data'] },
  },
  worker: {
    format: 'es',
  },
  lint: {
    // A lint warning fails the check, so a new one cannot slip by unnoticed
    // (oxlint's own option, the same as `vp check --deny-warnings`).
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
  },
  fmt: {
    ignorePatterns: ['generated/**'],
    singleQuote: true,
    printWidth: 120,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest's 5 s default is too tight for the component tests when many workers share the machine (#304, #335);
    // select-test.ts waits up to 10 s for a drop-down list, so a test has room for two of those.
    testTimeout: 30_000,
    // theme.test.ts reads every sheet of src/ as text (the token files and the components' own); Vitest empties other CSS.
    css: { include: [/src\/[\w-]+\.css/] },
  },
}));
