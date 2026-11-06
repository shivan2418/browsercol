// Loads a TeaVM wasm-gc module. The runtime script is a self-contained IIFE
// that sets globalThis.TeaVM, so the page and the module Worker can both
// bring it in with a dynamic import().

declare global {
  var TeaVM: { wasmGC: { load(src: string | Uint8Array): Promise<{ exports: unknown }> } };
}

/** A fetch of `url` whose bytes are counted as they come: `onProgress(loaded, total)`, total null if the size is not told. */
export async function fetchBytes(
  url: string,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} gave ${res.status}`);
  const length = Number(res.headers.get('content-length'));
  const total = length > 0 ? length : null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/**
 * Load the module. With `onProgress` the page fetches the bytes itself to count them; without, TeaVM fetches
 * and compiles them as they stream.
 */
export async function loadModule<T>(
  runtimeUrl: string,
  wasmUrl: string,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<T> {
  await import(/* @vite-ignore */ runtimeUrl);
  const teavm = await globalThis.TeaVM.wasmGC.load(onProgress ? await fetchBytes(wasmUrl, onProgress) : wasmUrl);
  return teavm.exports as T;
}
