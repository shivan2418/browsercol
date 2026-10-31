import { describe, expect, it } from 'vite-plus/test';
import { fakeSaveStore } from './fake-saves';
import { defaultSaveName, keepSaves, newestFirst, newSave, type SavedInfo, type SaveMeta } from './saves';

const info: SavedInfo = { turn: 12, year: 1503, nation: 'Dutch', owner: 'Ana' };

describe('the save list', () => {
  it('names a save after the nation and turn, unless the player names it', () => {
    expect(defaultSaveName(info)).toBe('Dutch, turn 12 (1503)');
    expect(defaultSaveName({ turn: 1, year: 1492, nation: '' })).toBe('Game, turn 1 (1492)');
    expect(newSave(info, '', 5).name).toBe('Dutch, turn 12 (1503)');
    expect(newSave(info, '  ', 5).name).toBe('Dutch, turn 12 (1503)');
    expect(newSave(info, ' Before the war ', 5)).toEqual({
      name: 'Before the war',
      date: 5,
      turn: 12,
      year: 1503,
      nation: 'Dutch',
    });
  });

  it('lists the newest first, the later id first within a millisecond', () => {
    const m = (id: number, date: number) => ({ id, date }) as SaveMeta;
    expect([m(1, 10), m(2, 30), m(3, 30), m(4, 20)].sort(newestFirst).map((s) => s.id)).toEqual([3, 2, 4, 1]);
  });

  it('keeps a save’s metadata and bytes together (the in-memory stand-in for the IndexedDB store)', async () => {
    const store = fakeSaveStore();
    const a = await store.put(newSave(info, 'a', 1), new Uint8Array([1, 2]));
    const b = await store.put(newSave(info, 'b', 2), new Uint8Array([3]));
    expect((await store.list()).map((s) => [s.id, s.name, s.size])).toEqual([
      [b.id, 'b', 1],
      [a.id, 'a', 2],
    ]);
    expect([...(await store.get(a.id))!]).toEqual([1, 2]);
    await store.remove(a.id);
    expect(await store.get(a.id)).toBeNull();
    expect((await store.list()).map((s) => s.id)).toEqual([b.id]);
  });
});

describe('persistent storage', () => {
  it('asks the browser to keep the saves and reports its answer', async () => {
    expect(await keepSaves({ persist: async () => true })).toBe(true);
    expect(await keepSaves({ persist: async () => false })).toBe(false);
  });

  it('copes with no storage manager or a refused request', async () => {
    expect(await keepSaves(undefined)).toBe(false);
    expect(
      await keepSaves({
        persist: async () => {
          throw new Error('denied');
        },
      }),
    ).toBe(false);
  });
});
