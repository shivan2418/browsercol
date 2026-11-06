import { expect, test } from 'vite-plus/test';
import { supportsWasmGC, WASM_GC_PROBE } from './browser-support';

test('a runtime with Wasm GC validates the probe', () => {
  // Node 24 (V8) has Wasm GC, as the browsers we support do.
  expect(WebAssembly.validate(WASM_GC_PROBE)).toBe(true);
  expect(supportsWasmGC()).toBe(true);
});

test('a browser without Wasm GC, or without WebAssembly at all, is not supported', () => {
  expect(supportsWasmGC({ validate: () => false })).toBe(false);
  expect(
    supportsWasmGC({
      validate: () => {
        throw new Error('no');
      },
    }),
  ).toBe(false);
  expect(supportsWasmGC(null)).toBe(false);
});
