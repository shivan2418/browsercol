// Runs the TeaVM-built Engine under Node: node run-node.mjs [rounds]
// Expects to be run from engine/, with FreeCol's data at ../freecol/data.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const out = 'build/generated/teavm/wasm-gc';
const data = '../freecol/data';
const files = [
  'base/roles-compat.xml',
  'base/unit-change-types-compat.xml',
  'strings/FreeColMessages.properties',
  'strings/plurals.xml',
  ...fs.readdirSync(`${data}/rules`, { recursive: true })
    .map(f => `rules/${f}`)
    .filter(f => fs.statSync(`${data}/${f}`).isFile()),
];
const args = [process.argv[2] ?? '10'];
let bytes = 0;
for (const f of files) {
  const text = fs.readFileSync(`${data}/${f}`, 'utf8');
  bytes += text.length;
  args.push(`data/${f}`, text);
}
console.log(`[node] passing ${files.length} files, ${(bytes / 1024).toFixed(0)} KiB`);

createRequire(import.meta.url)(path.resolve(`${out}/engine.wasm-runtime.js`));
const t0 = performance.now();
const teavm = await globalThis.TeaVM.wasmGC.load(path.resolve(`${out}/engine.wasm`));
console.log(`[node] wasm loaded in ${(performance.now() - t0).toFixed(0)}ms`);
// main() starts the spike on its own thread and returns at once; the
// game's threads keep Node alive through TeaVM's timers.
teavm.exports.main(args);
