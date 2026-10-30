// Copies the map art of the default Tileset into the site and writes the
// manifest the Browser UI's resolver loads: the resources.properties layers
// (data/base, then the "default" TC, then any mods given) and the art files.
// Only the keys the map draws are kept: images, with every variation of
// each, the texts of native settlement chips, and the road and population
// colours.
// Prints the art budget: file count, bytes, brotli bytes and atlas area.
// Usage: node build-art.mjs <freecol/data> <out dir> [mod dir...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseProperties, resources } from '../src/resources.ts';

const [data, out, ...mods] = process.argv.slice(2);
const MAP_KEYS =
  /^(image\.(tile|tileoverlay|tileforest|tileitem|abovetile|unit|mask)(\.|$)|color\.map\.(road$|productionBonus\.)|indianSettlementChip\.|indianAlarmChip\.|cross$)/;

const layers = [
  { dir: 'base', root: path.join(data, 'base') },
  { dir: 'default', root: path.join(data, 'default') },
  ...mods.map((m) => ({ dir: `mods/${path.basename(m)}`, root: m })),
].map(({ dir, root }) => {
  const props = parseProperties(fs.readFileSync(path.join(root, 'resources.properties'), 'utf8'))
    .filter(([key]) => MAP_KEYS.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return { dir, root, props };
});

const files = layers.flatMap(({ dir, root }) =>
  fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => /\.(png|jpe?g|gif)$/i.test(f))
    .map((f) => `${dir}/${f.split(path.sep).join('/')}`),
);
const res = resources(layers, files);

const keys = new Set(layers.flatMap(({ props }) => parseProperties(props).map(([k]) => k)));
const used = new Set();
for (const key of keys) {
  for (let n = 0; n < res.variations(key); n++) used.add(res.path(key, n));
}
used.delete(null);

const rootOf = new Map(layers.map(({ dir, root }) => [dir, root]));
fs.rmSync(out, { recursive: true, force: true });
let bytes = 0;
let brotli = 0;
let area = 0;
for (const file of used) {
  const layer = [...rootOf.keys()].find((d) => file.startsWith(`${d}/`));
  const body = fs.readFileSync(path.join(rootOf.get(layer), file.slice(layer.length + 1)));
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), body);
  bytes += body.length;
  brotli += zlib.brotliCompressSync(body).length;
  if (body.toString('ascii', 12, 16) === 'IHDR') area += body.readUInt32BE(16) * body.readUInt32BE(20);
}
const manifest = {
  layers: layers.map(({ dir, props }) => ({ dir, props })),
  files: [...used].sort((a, b) => (a < b ? -1 : 1)),
};
fs.writeFileSync(path.join(out, 'art.json'), JSON.stringify(manifest));
const mib = (n) => `${(n / 2 ** 20).toFixed(1)} MiB`;
console.log(
  `art: ${used.size} files, ${mib(bytes)}, ${mib(brotli)} brotli, ` +
    `${(area / 2048 ** 2).toFixed(1)} 2048x2048 atlas pages of pixels, ` +
    `manifest ${(fs.statSync(path.join(out, 'art.json')).size / 1024).toFixed(0)} KiB`,
);
