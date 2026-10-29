import { defineConfig } from 'vite-plus';

export default defineConfig({
  // Relative URLs, so the site works from any path (GitHub Pages serves it under /<repo>/).
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    ignorePatterns: ['generated/**'],
    singleQuote: true,
    printWidth: 120,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
