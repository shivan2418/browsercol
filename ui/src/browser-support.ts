// Whether this browser can run the Engine. TeaVM compiles it to WebAssembly GC, which older browsers lack;
// without it the page would fail somewhere inside the module load with no word to the player.

/**
 * The smallest module that needs Wasm GC. Bytes 0-7 are the header (`\0asm`, version 1); then the type
 * section (1), 3 bytes long, holds one type: a struct (0x5f = 95) with no fields. Before Wasm GC the only
 * type was a function (0x60), so an older engine rejects it.
 */
export const WASM_GC_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 3, 1, 95, 0]);

/** True when the browser validates a Wasm GC module. */
export function supportsWasmGC(wasm: Pick<typeof WebAssembly, 'validate'> | null = globalThis.WebAssembly ?? null) {
  try {
    return wasm?.validate(WASM_GC_PROBE) === true;
  } catch {
    return false;
  }
}

/** What the loading screen says instead, on a browser without Wasm GC. */
export const UNSUPPORTED_BROWSER =
  'BrowserCol needs a newer browser: Chrome or Edge 119, Firefox 145 or Safari 18.2, or later.';
