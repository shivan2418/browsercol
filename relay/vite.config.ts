import { defineConfig } from 'vite-plus';

export default defineConfig({
  // One file for the Lambda, dist/index.mjs. The AWS SDK is left out: the
  // nodejs22.x runtime ships it. Bundled, its lazy imports split into .js chunks
  // that Lambda loads as CommonJS (no package.json there), and the Lambda failed
  // to start (#371).
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { external: [/^@aws-sdk\//], output: { format: 'es', entryFileNames: 'index.mjs' } },
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
