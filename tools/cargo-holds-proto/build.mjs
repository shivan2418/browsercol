// THROWAWAY PROTOTYPE (branch prototype/cargo-holds): builds cargo-holds.html, one self-contained page, from
// template.html by inlining the FreeCol art it shows as data: URIs.
// Usage (from the repo root): ./dev.sh node tools/cargo-holds-proto/build.mjs [out.html]
// Needs ui/generated/public/art (./build.sh, or a copy from the main checkout).
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const art = path.resolve(here, '../../ui/generated/public/art/default/resources/images');
const files = {
  furs: 'goods/furs.png',
  sugar: 'goods/sugar.png',
  muskets: 'goods/muskets.png',
  horses: 'goods/horses.png',
  cigars: 'goods/cigars.png',
  cloth: 'goods/cloth.png',
  freeColonist: 'units/civilian/freeColonist.png',
  galleon: 'units/ship/galleon.png',
  merchantman: 'units/ship/merchantman.png',
  caravel: 'units/ship/caravel.png',
  wagonTrain: 'units/wagon/wagonTrain.png',
};
const images = Object.fromEntries(
  Object.entries(files).map(([k, f]) => [
    k,
    'data:image/png;base64,' + fs.readFileSync(path.join(art, f)).toString('base64'),
  ]),
);
const template = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const marker = '/*IMAGES*/{}';
if (!template.includes(marker)) throw new Error('template.html has no ' + marker);
const out = process.argv[2] ?? path.join(here, 'cargo-holds.html');
fs.writeFileSync(out, template.replace(marker, JSON.stringify(images)));
console.log(out, fs.statSync(out).size, 'bytes');
