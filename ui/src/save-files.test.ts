import { describe, expect, it } from 'vite-plus/test';
import { fakeSaveStore } from './fake-saves';
import { zip } from './fsg-fixture';
import { chooseOpenFile, chooseSaveFile, exportSaveFile, fileNameOf, importSave } from './save-files';

const XML =
  '<savedGame owner="Ana"><game turn="12"><player nationId="model.nation.english" ai="false"></game></savedGame>';

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

/** A window with the File System Access pickers, keeping what is written to the file picked. */
function pickerWindow(pick: string | null) {
  const written: { name: string; bytes: Uint8Array[]; closed: boolean }[] = [];
  const asked: unknown[] = [];
  const cancel = () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
  return {
    written,
    asked,
    window: {
      showSaveFilePicker: (options: unknown) => {
        asked.push(options);
        if (pick === null) return cancel();
        const file = { name: pick, bytes: [] as Uint8Array[], closed: false };
        written.push(file);
        return Promise.resolve({
          name: pick,
          createWritable: () =>
            Promise.resolve({
              write: (b: Uint8Array) => void file.bytes.push(b),
              close: () => void (file.closed = true),
            }),
        });
      },
      showOpenFilePicker: (options: unknown) => {
        asked.push(options);
        if (pick === null) return cancel();
        return Promise.resolve([{ getFile: () => Promise.resolve(new File(['x'], pick)) }]);
      },
    },
  };
}

describe('chooseSaveFile', () => {
  it('writes to the file the player picked, under the name they gave it', async () => {
    const w = pickerWindow('Before the war.fsg');
    const target = await chooseSaveFile('Dutch, turn 5 (1496).fsg', w.window);
    expect(target?.name).toBe('Before the war.fsg');
    await target!.write(new Uint8Array([1, 2]));
    expect(w.written).toEqual([{ name: 'Before the war.fsg', bytes: [new Uint8Array([1, 2])], closed: true }]);
    expect(w.asked).toMatchObject([{ suggestedName: 'Dutch, turn 5 (1496).fsg' }]);
  });

  it('is null when the player cancels the picker', async () => {
    expect(await chooseSaveFile('a.fsg', pickerWindow(null).window)).toBeNull();
  });

  it('downloads the file where the browser has no picker', async () => {
    const got: string[] = [];
    const target = await chooseSaveFile('a.fsg', {}, (bytes, name) => got.push(`${name} ${bytes.length}`));
    expect(target?.name).toBe('a.fsg');
    await target!.write(new Uint8Array(3));
    expect(got).toEqual(['a.fsg 3']);
  });
});

describe('chooseOpenFile', () => {
  it('gives the file the player picked', async () => {
    const w = pickerWindow('Before the war.fsg');
    expect((await chooseOpenFile(w.window))?.name).toBe('Before the war.fsg');
    expect(w.asked).toMatchObject([{ types: [{ accept: { 'application/x-freecol-save': ['.fsg'] } }] }]);
  });

  it('is null when the player cancels the picker', async () => {
    expect(await chooseOpenFile(pickerWindow(null).window)).toBeNull();
  });

  it('asks through a file input for .fsg files where the browser has no picker', async () => {
    const input = new EventTarget() as EventTarget & { type?: string; accept?: string; files: File[]; click(): void };
    input.files = [];
    input.click = () => {
      input.files = [new File(['x'], 'a.fsg')];
      input.dispatchEvent(new Event('change'));
    };
    const file = await chooseOpenFile({}, () => input as unknown as HTMLInputElement);
    expect(file?.name).toBe('a.fsg');
    expect([input.type, input.accept]).toEqual(['file', '.fsg']);
  });

  it('is null when the player cancels the file input', async () => {
    const input = new EventTarget() as EventTarget & { files: File[]; click(): void };
    input.files = [];
    input.click = () => input.dispatchEvent(new Event('cancel'));
    expect(await chooseOpenFile({}, () => input as unknown as HTMLInputElement)).toBeNull();
  });
});

describe('exportSaveFile', () => {
  it('writes a stored save, unchanged, to the file the player picks, and says so', async () => {
    const store = fakeSaveStore();
    const bytes = await zip({ 'savegame.xml': XML });
    const meta = await importSave(store, 'Dutch 1525.fsg', bytes, 1);
    const w = pickerWindow('Dutch 1525.fsg');
    const note = await exportSaveFile(store, meta, (name) => chooseSaveFile(name, w.window));
    expect(note).toBe('Exported: Dutch 1525');
    expect(w.written).toEqual([{ name: 'Dutch 1525.fsg', bytes: [bytes], closed: true }]);
    expect(w.asked).toMatchObject([{ suggestedName: 'Dutch 1525.fsg' }]);
    // What it wrote loads back: importSave accepts it.
    expect(await importSave(fakeSaveStore(), 'x.fsg', w.written[0].bytes[0], 2)).toMatchObject({ turn: 12 });
  });

  it('downloads the save where the browser has no picker', async () => {
    const store = fakeSaveStore();
    const meta = await store.put({ name: 'a/b', date: 1, turn: 1, year: 1492, nation: 'Dutch' }, new Uint8Array([9]));
    const got: [Uint8Array, string][] = [];
    const note = await exportSaveFile(store, meta, (name) =>
      chooseSaveFile(name, {}, (bytes, fileName) => void got.push([bytes, fileName])),
    );
    expect(note).toBe('Exported: a/b');
    expect(got).toEqual([[new Uint8Array([9]), 'a_b.fsg']]);
  });

  it('says nothing when the player cancels, and why when the save is gone', async () => {
    const store = fakeSaveStore();
    const meta = await store.put({ name: 'x', date: 1, turn: 1, year: 1492, nation: 'Dutch' }, new Uint8Array([9]));
    const w = pickerWindow(null);
    expect(await exportSaveFile(store, meta, (n) => chooseSaveFile(n, w.window))).toBe('');
    await store.remove(meta.id);
    const w2 = pickerWindow('x.fsg');
    expect(await exportSaveFile(store, meta, (n) => chooseSaveFile(n, w2.window))).toBe('Export failed: no such save');
  });
});
