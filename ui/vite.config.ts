import { defineConfig } from 'vite-plus';

export default defineConfig({
  // Relative URLs, so the site works from any path (GitHub Pages serves it under /<repo>/).
  base: './',
  // Map art from scripts/build-art.mjs, copied as is.
  publicDir: 'generated/public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
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
    // theme.test.ts reads theme.css as text; Vitest empties other CSS.
    css: { include: [/theme\.css/] },
  },
});
