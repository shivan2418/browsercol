import { describe, expect, it } from 'vitest';
import { fakeSaveStore } from './fake-saves';
import { zip } from './fsg-fixture';
import { fileNameOf, importSave } from './save-files';

const XML =
  '<savedGame owner="emil"><game turn="12"><player nationId="model.nation.english" ai="false"></game></savedGame>';

describe('importSave', () => {
  it('stores the file unchanged, named after the file, with the turn, year and nation read from it', async () => {
    const store = fakeSaveStore();
    const bytes = await zip({ 'savegame.xml': XML });
    const meta = await importSave(store, 'My game.fsg', bytes, 1000);
    expect(meta).toMatchObject({ name: 'My game', date: 1000, turn: 12, year: 1503, nation: 'English' });
    expect(await store.get(meta.id)).toEqual(bytes);
    expect(await store.list()).toHaveLength(1);
  });

  it('rejects a file that is not a save and stores nothing', async () => {
    const store = fakeSaveStore();
    await expect(importSave(store, 'notes.fsg', new TextEncoder().encode('hello'), 1)).rejects.toThrow('not a zip');
    expect(await store.list()).toEqual([]);
  });
});

describe('fileNameOf', () => {
  it('makes a name safe to download as', () => {
    expect(fileNameOf('Dutch, turn 5 (1496)')).toBe('Dutch, turn 5 (1496).fsg');
    expect(fileNameOf('a/b\\c:d')).toBe('a_b_c_d.fsg');
    expect(fileNameOf('  ..  ')).toBe('freecol-save.fsg');
  });
});
