// node run.mjs: runs the reproducer's main(). Prints "wait returned after
// ~110ms" when Object.wait works, and nothing when it hangs.
import { createRequire } from 'node:module';
import path from 'node:path';
const out = 'build/generated/teavm/wasm-gc';
createRequire(import.meta.url)(path.resolve(`${out}/repro.wasm-runtime.js`));
const teavm = await globalThis.TeaVM.wasmGC.load(path.resolve(`${out}/repro.wasm`));
teavm.exports.main([]);
process.on('exit', () => console.log('node exiting'));
