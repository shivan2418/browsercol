// Zip files for the tests of fsg.ts and save-files.ts.

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * A zip of the entries. `descriptor` leaves the local headers' sizes at 0, as
 * Java's ZipOutputStream does; `stored` skips the compression.
 */
export async function zip(
  entries: Record<string, string>,
  { descriptor = false, stored = false } = {},
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = enc.encode(text);
    const data = stored ? raw : await deflate(raw);
    const n = enc.encode(name);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(6, descriptor ? 8 : 0, true);
    l.setUint16(8, stored ? 0 : 8, true);
    l.setUint32(18, descriptor ? 0 : data.length, true);
    l.setUint32(22, descriptor ? 0 : raw.length, true);
    l.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, stored ? 0 : 8, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    local.push(new Uint8Array(l.buffer), n, data);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(10, Object.keys(entries).length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(e.buffer)];
  const all = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}
