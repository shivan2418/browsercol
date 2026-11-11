import { expect, it } from 'vite-plus/test';
import { zipEntry } from './fsg';
import { crc32, zipStored } from './zip';

it('computes the standard CRC-32', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

it('writes a zip its entries can be read back from, in any order and with UTF-8 text', async () => {
  const zip = zipStored({ 'a.txt': 'héllo', 'b.bin': new Uint8Array([0, 255, 7]) });
  expect(new TextDecoder().decode((await zipEntry(zip, 'a.txt'))!)).toBe('héllo');
  expect(await zipEntry(zip, 'b.bin')).toEqual(new Uint8Array([0, 255, 7]));
  expect(await zipEntry(zip, 'c')).toBeNull();
});

it('writes an empty zip with no entries', async () => {
  expect(await zipEntry(zipStored({}), 'a')).toBeNull();
});
