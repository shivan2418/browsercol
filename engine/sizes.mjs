// Prints raw, gzip -9 and brotli -11 sizes of the given files.
import fs from 'node:fs';
import zlib from 'node:zlib';
const mb = n => (n / 1048576).toFixed(2) + ' MiB';
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  const gz = zlib.gzipSync(b, { level: 9 }).length;
  const br = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  console.log(`${f}: raw ${mb(b.length)}, gzip ${mb(gz)}, brotli ${mb(br)}`);
}
