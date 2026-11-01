// PROTOTYPE (#48), throwaway: serve or build only the panel-looks page.
//   npm run prototype-look        dev server on http://localhost:5199/prototype-look.html
import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: './',
  publicDir: false,
  cacheDir: '../.cache/vite-prototype-look',
  server: { host: true, port: 5199, open: false },
  build: {
    outDir: '../.cache/prototype-look',
    emptyOutDir: true,
    rollupOptions: { input: 'prototype-look.html' },
  },
});
