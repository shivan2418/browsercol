// Makes the site's icons from FreeCol's own window icon (the ship Swing puts on its frame): the tab's
// favicon, the touch icon, and the 192 and 512 px icons a web app manifest asks for, one of them
// maskable (the ship inside the 70% centre, within the safe zone, on a sea-coloured square, so a launcher may crop it to a circle).
// The source is a small non-square PNG, so it is padded to a square and scaled with a bilinear filter.
// Usage: node build-icons.ts <freecol/data> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error('Usage: node build-icons.ts <freecol/data> <out dir>');
  process.exit(1);
}

/** The sea of the maskable icon: the page colour of the light theme (--page in theme.css). */
const SEA = [0x1d, 0x43, 0x57, 0xff];

interface Image {
  w: number;
  h: number;
  /** RGBA, 8 bits a channel. */
  px: Uint8Array;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decodes an 8-bit RGBA PNG without interlacing, the only kind FreeCol's icon is. */
function decode(file: Buffer): Image {
  let w = 0;
  let h = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const len = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('the icon is not an 8-bit RGBA PNG');
    } else if (type === 'IDAT') data.push(body);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = w * 4;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
      let v = x;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + i] = v & 0xff;
    }
  }
  return { w, h, px };
}

function encode(img: Image): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(img.w, 0);
  head.writeUInt32BE(img.h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  const stride = img.w * 4;
  const raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++)
    Buffer.from(img.px.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The source drawn into a size by size square, `fill` of it tall or wide at most, centred, over `background` (or clear). */
function render(src: Image, size: number, fill: number, background?: number[]): Image {
  const px = new Uint8Array(size * size * 4);
  if (background) for (let i = 0; i < px.length; i += 4) px.set(background, i);
  const scale = (size * fill) / Math.max(src.w, src.h);
  const dw = Math.round(src.w * scale);
  const dh = Math.round(src.h * scale);
  const left = Math.floor((size - dw) / 2);
  const top = Math.floor((size - dh) / 2);
  /** The source pixel at a position, clamped to the edge, with its colour weighted by its alpha. */
  const at = (x: number, y: number) => {
    const i = (Math.min(src.h - 1, Math.max(0, y)) * src.w + Math.min(src.w - 1, Math.max(0, x))) * 4;
    const a = src.px[i + 3];
    return [src.px[i] * a, src.px[i + 1] * a, src.px[i + 2] * a, a];
  };
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      const sy = (y + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const acc = [0, 0, 0, 0];
      for (const [dx, dy, wgt] of [
        [0, 0, (1 - fx) * (1 - fy)],
        [1, 0, fx * (1 - fy)],
        [0, 1, (1 - fx) * fy],
        [1, 1, fx * fy],
      ]) {
        const p = at(x0 + dx, y0 + dy);
        for (let k = 0; k < 4; k++) acc[k] += p[k] * wgt;
      }
      const alpha = acc[3];
      if (alpha <= 0) continue;
      const o = ((top + y) * size + left + x) * 4;
      // Over the background: the colour premultiplied by alpha / 255, so the result is colour * a + under * (1 - a).
      const a = alpha / 255;
      for (let k = 0; k < 3; k++) {
        const colour = acc[k] / alpha;
        px[o + k] = Math.round(background ? colour * a + px[o + k] * (1 - a) : colour);
      }
      px[o + 3] = background ? 255 : Math.round(alpha);
    }
  }
  return { w: size, h: size, px };
}

const src = decode(fs.readFileSync(path.join(dataDir, 'base/resources/images/ui/frame-icon.png')));
fs.mkdirSync(outDir, { recursive: true });
const icons: [string, Image][] = [
  ['favicon-32.png', render(src, 32, 1)],
  ['apple-touch-icon.png', render(src, 180, 0.8, SEA)],
  ['icon-192.png', render(src, 192, 1)],
  ['icon-512.png', render(src, 512, 1)],
  ['icon-maskable-512.png', render(src, 512, 0.7, SEA)],
];
for (const [name, img] of icons) fs.writeFileSync(path.join(outDir, name), encode(img));
console.log(`icons: ${icons.map(([name]) => name).join(', ')}`);
