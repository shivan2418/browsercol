// THROWAWAY PROTOTYPE (branch prototype/trade-route-editor): builds trade-routes.html, one self-contained page,
// from template.html by inlining the FreeCol art it shows as data: URIs.
// Usage (from the repo root): ./dev.sh node tools/trade-route-proto/build.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const art = path.resolve(here, '../../ui/generated/public/art/default/resources/images');
const goods = ['food', 'sugar', 'tobacco', 'cotton', 'furs', 'lumber', 'ore', 'silver', 'horses', 'rum', 'cigars', 'cloth', 'coats', 'tradeGoods', 'tools', 'muskets'];
const files = {
  ...Object.fromEntries(goods.map((g) => [g, `goods/${g}.png`])),
  wagonTrain: 'units/wagon/wagonTrain.png',
  merchantman: 'units/ship/merchantman.png',
  galleon: 'units/ship/galleon.png',
};
const images = Object.fromEntries(
  Object.entries(files).map(([k, f]) => [k, 'data:image/png;base64,' + fs.readFileSync(path.join(art, f)).toString('base64')]),
);
const template = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const marker = '/*IMAGES*/{}';
if (!template.includes(marker)) throw new Error('template.html has no ' + marker);
const out = process.argv[2] ?? path.join(here, 'trade-routes.html');
fs.writeFileSync(out, template.replace(marker, JSON.stringify(images)));
console.log(out, fs.statSync(out).size, 'bytes');
