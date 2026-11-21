import { expect, test } from 'vite-plus/test';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  FREECOL_ISOMETRIC_SIZES,
  FREECOL_MAP_SIZES,
  LEFT_OUT,
  MAPS,
  MAP_SHAPE,
  freecolMapName,
  sized,
  shapedFor,
} from './start';

/** A zip file's entry, as text (the same as start.test.ts reads a map's properties with). */
function unzipEntry(zip: Buffer, name: string): string {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${name} not found`);
}

test("the start screen lists every map as FreeCol made it too, as an Isometric shaped map, with its file's size", () => {
  const dir = '../freecol/data/maps/isometric';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.fsm') && f !== LEFT_OUT);
  expect(Object.keys(FREECOL_ISOMETRIC_SIZES).sort()).toEqual(files.sort());
  expect(Object.keys(FREECOL_ISOMETRIC_SIZES).sort()).toEqual(Object.keys(FREECOL_MAP_SIZES).sort());
  for (const f of files) {
    const props = unzipEntry(fs.readFileSync(`${dir}/${f}`), 'savegame.properties');
    const w = Number(/map\.width=(\d+)/.exec(props)?.[1]);
    const h = Number(/map\.height=(\d+)/.exec(props)?.[1]);
    expect([f, w, h]).toEqual([f, ...FREECOL_ISOMETRIC_SIZES[f]!]);
    const entry = MAPS.find((m) => m.id === `isometric/${f}`);
    expect(entry?.name).toBe(sized(freecolMapName(f), [w, h], true));
    expect(entry?.shape).toBe('isometric');
    // The same number of tiles as the Top-down version.
    const [tw, th] = FREECOL_MAP_SIZES[f]!;
    expect(Math.abs(tw * th - w * h)).toBeLessThan(2 * w);
  }
});

test('the Top-down shaped maps are the Top-down view, America too', () => {
  const topDown = MAPS.filter((m) => m.shape === 'topDown');
  expect(topDown.length).toBe(Object.keys(FREECOL_MAP_SIZES).length + 1);
  expect(MAPS.filter((m) => m.shape === 'isometric').length).toBe(Object.keys(FREECOL_ISOMETRIC_SIZES).length);
  expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
  expect(MAPS.some((m) => m.id.endsWith(LEFT_OUT))).toBe(false);
});

test("a new game's map is shaped for the Map view it is started in, unless the preset says otherwise", () => {
  expect(JSON.parse(shapedFor('', 'isometric'))).toEqual({ options: { [MAP_SHAPE]: 1 } });
  expect(JSON.parse(shapedFor('', 'topdown'))).toEqual({ options: { [MAP_SHAPE]: 0 } });
  expect(JSON.parse(shapedFor('{"difficulty":"d","options":{"a":1}}', 'topdown'))).toEqual({
    difficulty: 'd',
    options: { a: 1, [MAP_SHAPE]: 0 },
  });
  const own = '{"options":{"model.option.mapShape":0}}';
  expect(shapedFor(own, 'isometric')).toBe(own);
});
