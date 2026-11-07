// Makes the site's icons from BrowserCol's own icon (ui/brand, #307): the tab's favicon as SVG with a
// 32 px PNG fallback, the touch icon, and the 192 and 512 px icons a web app manifest asks for, one of them maskable.
// The brand directory holds three drawings of one icon: icon-small.svg is drawn for 16 to 32 px (heavier
// lines, solid land), icon.svg for 48 px and up, and icon-maskable.svg has it inside the centre 80% on an
// opaque square, so a launcher may crop it to a circle; iOS fills a touch icon's transparency with black,
// so the touch icon is made from it too.
// Usage: node build-icons.ts <brand dir> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const [brandDir, outDir] = process.argv.slice(2);
if (!brandDir || !outDir) {
  console.error('Usage: node build-icons.ts <brand dir> <out dir>');
  process.exit(1);
}

const svg = (name: string) => fs.readFileSync(path.join(brandDir, name), 'utf8');
/** The drawing rendered as a size by size PNG. */
const png = (source: string, size: number) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.mkdirSync(outDir, { recursive: true });
const small = svg('icon-small.svg');
const large = svg('icon.svg');
const maskable = svg('icon-maskable.svg');
const icons: [string, Buffer | string][] = [
  ['favicon.svg', small],
  ['favicon-32.png', png(small, 32)],
  ['apple-touch-icon.png', png(maskable, 180)],
  ['icon-192.png', png(large, 192)],
  ['icon-512.png', png(large, 512)],
  ['icon-maskable-512.png', png(maskable, 512)],
];
for (const [name, data] of icons) fs.writeFileSync(path.join(outDir, name), data);
console.log(`icons: ${icons.map(([name]) => name).join(', ')}`);
