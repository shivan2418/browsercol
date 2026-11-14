import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import { buildId } from './scripts/build-id.ts';
import { layerPageStyles } from './scripts/page-styles.ts';
import {
  audioList,
  cacheBuild,
  listFiles,
  manifest,
  precacheList,
  serviceWorker,
  soundEffects,
} from './scripts/pwa.ts';

/**
 * The installable app (#267): beside the built site, the web app manifest, and (#296) the service worker that
 * caches the site so the installed app starts offline.
 */
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
      const audioJson = path.join(outDir, 'audio', 'audio.json');
      const effects = fs.existsSync(audioJson) ? soundEffects(fs.readFileSync(audioJson, 'utf8')) : [];
      const shell = precacheList(listFiles(outDir), effects);
      // The build id alone cannot name the cache: two local builds of one commit share it. The files do not.
      const page = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const fingerprint = createHash('sha1')
        .update(JSON.stringify(shell) + page)
        .digest('hex')
        .slice(0, 8);
      const template = fs.readFileSync('sw.template.js', 'utf8');
      fs.writeFileSync(
        path.join(outDir, 'sw.js'),
        serviceWorker(template, cacheBuild(build, fingerprint), shell, audioList(outDir, effects)),
      );
    },
  };
}

/** index.html's own styles in their cascade layers, by their data-layer attribute (docs/adr/0008). */
function pageLayers(): Plugin {
  return { name: 'page-layers', transformIndexHtml: { order: 'pre', handler: layerPageStyles } };
}

export default defineConfig(({ command }) => {
  const build = buildId(process.env, command === 'serve');
  return {
    plugins: [pageLayers(), installable(build)],
    // Relative URLs, so the site works from any path (GitHub Pages serves it under /<repo>/).
    base: './',
    define: { __BUILD__: JSON.stringify(build) },
    // Map art from scripts/build-art.ts, copied as is.
    publicDir: 'generated/public',
    build: {
      // The game lives at <site>/play/; the landing page (ui/site/) is copied to the site's root by build.sh.
      outDir: '../dist/play',
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
      setupFiles: ['src/test-setup.ts'],
      // Vitest's 5 s default is too tight for the component tests when many workers share the machine (#304, #335);
      // select-test.ts waits up to 10 s for a drop-down list, so a test has room for two of those.
      testTimeout: 30_000,
      // theme.test.ts reads every sheet of src/ as text (the token files and the components' own); Vitest empties other CSS.
      css: { include: [/src\/[\w-]+\.css/] },
    },
  };
});
