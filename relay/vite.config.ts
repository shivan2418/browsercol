import { defineConfig } from 'vite-plus';

export default defineConfig({
  // One file for the Lambda, dist/index.mjs, with the AWS SDK bundled in so the
  // deployed code runs the version the tests ran, not whatever the runtime ships.
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
  lint: {
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
  },
  fmt: {
    ignorePatterns: ['dist/**'],
    singleQuote: true,
    printWidth: 120,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
