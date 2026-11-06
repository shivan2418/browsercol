import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import { buildId } from './scripts/build-id.ts';
import { listFiles, manifest, precacheList, serviceWorker } from './scripts/pwa.ts';

/** The installable app (#267): beside the built site, the manifest and the service worker that caches it. */
function installable(build: string): Plugin {
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
      const shell = precacheList(listFiles(outDir));
      // The commit alone cannot name the cache where it is unknown (a build outside the repository): the files do too.
      const page = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const fingerprint = createHash('sha1')
        .update(JSON.stringify(shell) + page)
        .digest('hex')
        .slice(0, 8);
      const template = fs.readFileSync('sw.template.js', 'utf8');
      fs.writeFileSync(path.join(outDir, 'sw.js'), serviceWorker(template, `${build}-${fingerprint}`, shell));
    },
  };
}

const build = buildId();

export default defineConfig({
  plugins: [installable(build)],
  // Relative URLs, so the site works from any path (GitHub Pages serves it under /<repo>/).
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
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
    // theme.test.ts reads theme.css and fonts.css as text; Vitest empties other CSS.
    css: { include: [/(theme|fonts)\.css/] },
  },
});
