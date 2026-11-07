// Copies the map art of the default Tileset into the site and writes the
// manifest the Browser UI's resolver loads: the resources.properties layers
// (data/base, then the "default" TC, then any mods given) and the art files.
// Only the keys the map draws are kept: images, with every variation of
// each, the texts of native settlement chips, and the road, population and
// mission chip colours; and the keys the panels show (map-keys.ts): the
// images of what a message is about, and of the event panel.
// Prints the art budget: file count, bytes, brotli bytes and atlas area.
// Usage: node build-art.ts <freecol/data> <out dir> [--manifest <file>] [mod dir...]
// The manifest is art.json unless --manifest names another file; the option
// may come before or after the mod directories. Files already in the out dir
// stay, so a Tileset built with mods can share the default Tileset's
// directory.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { isArtKey, SIGNATURE_FONT_FILE, SIGNATURE_FONT_KEY } from '../src/map-keys.ts';
import { parseProperties, resources } from '../src/resources.ts';

const args = process.argv.slice(2);
const dataDir = args[0];
const outDir = args[1];
const usage = 'Usage: node build-art.ts <freecol/data> <out dir> [--manifest <file>] [mod dir...]';
if (!dataDir || !outDir) {
  console.error(usage);
  process.exit(1);
}
/** The mod directories to add as layers. */
const modDirs = [];
/** The manifest file to write: art.json unless --manifest names another. */
let manifestFile = 'art.json';
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--manifest') {
    const file = args[++i];
    if (!file) {
      console.error('--manifest needs a file name');
      process.exit(1);
    }
    manifestFile = file;
  } else if (args[i].startsWith('--')) {
    console.error(`unknown option: ${args[i]}`);
    process.exit(1);
  } else {
    modDirs.push(args[i]);
  }
}
const layers = [
  { dir: 'base', root: path.join(dataDir, 'base') },
  { dir: 'default', root: path.join(dataDir, 'default') },
  ...modDirs.map((mod) => ({ dir: `mods/${path.basename(mod)}`, root: mod })),
].map(({ dir, root }) => {
  const props = parseProperties(fs.readFileSync(path.join(root, 'resources.properties'), 'utf8'))
    .filter(([key]) => isArtKey(key))
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
const used = new Set<string | null>();
for (const key of keys) {
  for (let n = 0; n < res.variations(key); n++) used.add(res.path(key, n));
}
used.delete(null);

const rootOf = new Map(layers.map(({ dir, root }) => [dir, root]));
let bytes = 0;
let brotli = 0;
let area = 0;
for (const file of used as Set<string>) {
  const layer = [...rootOf.keys()].find((d) => file.startsWith(`${d}/`));
  const body = fs.readFileSync(path.join(rootOf.get(layer!)!, file.slice(layer!.length + 1)));
  fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
  fs.writeFileSync(path.join(outDir, file), body);
  bytes += body.length;
  brotli += zlib.brotliCompressSync(body).length;
  if (body.toString('ascii', 12, 16) === 'IHDR') area += body.readUInt32BE(16) * body.readUInt32BE(20);
}
// The signature font is a file the page fetches when the Declaration opens (DeclarationPanel's animatedfont.signature).
const base = layers[0];
const signature = parseProperties(fs.readFileSync(path.join(base.root, 'resources.properties'), 'utf8')).find(
  ([key]) => key === SIGNATURE_FONT_KEY,
)?.[1];
if (!signature) throw new Error(`${SIGNATURE_FONT_KEY} is not in ${base.root}/resources.properties`);
if (`${base.dir}/${signature}` !== SIGNATURE_FONT_FILE) throw new Error(`the signature font moved to ${signature}`);
fs.mkdirSync(path.dirname(path.join(outDir, SIGNATURE_FONT_FILE)), { recursive: true });
fs.copyFileSync(path.join(base.root, signature), path.join(outDir, SIGNATURE_FONT_FILE));
const manifest = {
  layers: layers.map(({ dir, props }) => ({ dir, props })),
  files: [...(used as Set<string>)].sort((a, b) => (a < b ? -1 : 1)),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, manifestFile), JSON.stringify(manifest));
const mib = (n: number) => `${(n / 2 ** 20).toFixed(1)} MiB`;
console.log(
  `${manifestFile}: ${used.size} files, ${mib(bytes)}, ${mib(brotli)} brotli, ` +
    `${(area / 2048 ** 2).toFixed(1)} 2048x2048 atlas pages of pixels, ` +
    `manifest ${(fs.statSync(path.join(outDir, manifestFile)).size / 1024).toFixed(0)} KiB`,
);
