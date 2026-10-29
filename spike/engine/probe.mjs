import { createRequire } from 'node:module';
import path from 'node:path';
const out = 'build/generated/teavm/wasm-gc';
createRequire(import.meta.url)(path.resolve(`${out}/engine.wasm-runtime.js`));
const teavm = await globalThis.TeaVM.wasmGC.load(path.resolve(`${out}/engine.wasm`));
teavm.exports.main(process.argv.slice(2));
