// Loads a TeaVM wasm-gc module. The runtime script is a self-contained IIFE
// that sets globalThis.TeaVM, so the page and the module Worker can both
// bring it in with a dynamic import().

declare global {
  var TeaVM: { wasmGC: { load(url: string): Promise<{ exports: unknown }> } };
}

export async function loadModule<T>(runtimeUrl: string, wasmUrl: string): Promise<T> {
  await import(/* @vite-ignore */ runtimeUrl);
  const teavm = await globalThis.TeaVM.wasmGC.load(wasmUrl);
  return teavm.exports as T;
}
