// Copies FreeCol's music and sound effects into the site and writes the
// manifest the Browser UI's sound player loads (sound.ts): each sound's
// file, whether it plays as music, and the default playlist. The layers are
// data/base and the "default" TC, as for the art. Files are fetched only
// when played, so the budget is the site's size, not a download: it prints
// the file count and bytes.
// Usage: node build-audio.ts <freecol/data> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { audioManifest } from '../src/resources.ts';

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error('Usage: node build-audio.ts <freecol/data> <out dir>');
  process.exit(1);
}
const layers = ['base', 'default'].map((dir) => ({
  dir,
  props: fs.readFileSync(path.join(dataDir, dir, 'resources.properties'), 'utf8'),
}));
const files = layers.flatMap(({ dir }) =>
  fs
    .readdirSync(path.join(dataDir, dir), { recursive: true })
    .map((f) => `${dir}/${String(f).split(path.sep).join('/')}`),
);
const manifest = audioManifest(layers, files);
const used = new Set([...Object.values(manifest.sounds).map((s) => s.file), ...manifest.playlist]);
let bytes = 0;
for (const file of used) {
  const body = fs.readFileSync(path.join(dataDir, file));
  fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
  fs.writeFileSync(path.join(outDir, file), body);
  bytes += body.length;
}
fs.writeFileSync(path.join(outDir, 'audio.json'), JSON.stringify(manifest));
console.log(`audio.json: ${used.size} files, ${(bytes / 2 ** 20).toFixed(1)} MiB, fetched only when played`);
