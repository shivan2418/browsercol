// Loads a TeaVM wasm-gc module. The runtime script is a self-contained IIFE
// that sets globalThis.TeaVM, so the page and the module Worker can both
// bring it in with a dynamic import().

/** The imports TeaVM's runtime builds, of which `installImports` may replace some. */
type Imports = Record<string, Record<string, unknown>>;

declare global {
  var TeaVM: {
    wasmGC: {
      load(
        src: string | Uint8Array,
        options?: { installImports?: (imports: Imports) => void },
      ): Promise<{ exports: unknown }>;
    };
  };
}

/** Ids from this on are those of jobs posted through the channel, below it those of timers. */
const JOB_ID = 1 << 30;

/**
 * Have a fiber's resume, a new thread's start or a yield run at the next turn of the event loop, instead of through
 * `setTimeout(fn, 0)` as TeaVM's runtime does it. Every hand-off between the Engine's threads is such a resume,
 * and a browser stretches a timer that was started inside a timer to 4 ms once they nest five deep, so a move
 * that crossed a few threads before its order went out waited about 8 ms for nothing (scripts/move-latency.ts),
 * and an AI round or a preset's setup, which hand off thousands of times, waited out the same 4 ms each. A message
 * on a channel is a task with no such floor. A wait of more than nothing (Thread.sleep, a timed wait) is still a timer.
 */
export function immediateScheduler(imports: Imports): void {
  const channel = new MessageChannel();
  const jobs = new Map<number, () => void>();
  let next = JOB_ID;
  channel.port1.onmessage = (e: MessageEvent<number>) => {
    const job = jobs.get(e.data);
    if (!job) return;
    jobs.delete(e.data);
    job();
  };
  imports.teavmAsync = {
    offer(instance: unknown, fn: (instance: unknown) => void, time: number) {
      const wait = Math.max(0, time - Date.now());
      if (wait > 0) return setTimeout(() => fn(instance), wait);
      const id = next++;
      if (next >= 2 ** 31 - 1) next = JOB_ID;
      jobs.set(id, () => fn(instance));
      channel.port2.postMessage(id);
      return id;
    },
    kill(id: number) {
      if (id >= JOB_ID) jobs.delete(id);
      else clearTimeout(id);
    },
  };
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
  const teavm = await globalThis.TeaVM.wasmGC.load(onProgress ? await fetchBytes(wasmUrl, onProgress) : wasmUrl, {
    installImports: immediateScheduler,
  });
  return teavm.exports as T;
}
