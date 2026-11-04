import { describe, expect, it, vi } from 'vite-plus/test';
import { fakeSaveStore } from './fake-saves';
import {
  AUTOSAVE_NAME,
  debounced,
  defaultSaveName,
  dropOlderAutosaves,
  dropOutdatedAutosaves,
  dropTurnAutosaves,
  isTurnAutosave,
  shiftLastTurnSaves,
  turnAutosaveNames,
  type AutosaveOptions,
  keepSaves,
  latestAutosave,
  newestFirst,
  newSave,
  type SavedInfo,
  type SaveMeta,
} from './saves';

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
    await store.rename(b.id, 'c');
    expect((await store.list()).map((s) => s.name)).toEqual(['c', 'a']);
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

describe('autosave', () => {
  const info = { turn: 3, year: 1494, nation: 'Dutch' };
  const put = (store: ReturnType<typeof fakeSaveStore>, name: string) =>
    store.put(newSave({ ...info, owner: 'me' }, name, Date.now()), new Uint8Array([1]));

  it('finds the newest autosave among other saves', async () => {
    const store = fakeSaveStore();
    await put(store, AUTOSAVE_NAME);
    await put(store, 'Mine');
    const last = await put(store, AUTOSAVE_NAME);
    await put(store, 'Other');
    expect((await latestAutosave(store))?.id).toBe(last.id);
  });

  it('is null with no autosave', async () => {
    const store = fakeSaveStore();
    await put(store, 'Mine');
    expect(await latestAutosave(store)).toBeNull();
  });

  it('drops older autosaves and keeps the named saves', async () => {
    const store = fakeSaveStore();
    await put(store, AUTOSAVE_NAME);
    const mine = await put(store, 'Mine');
    const kept = await put(store, AUTOSAVE_NAME);
    await dropOlderAutosaves(store, kept);
    expect((await store.list()).map((m) => m.id)).toEqual([kept.id, mine.id].sort((a, b) => b - a));
  });

  it('debounces a burst into one call', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const poke = debounced(fire, 100);
    poke();
    vi.advanceTimersByTime(50);
    poke();
    vi.advanceTimersByTime(99);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('FreeCol’s autosaves', () => {
  const o: AutosaveOptions = {
    period: 1,
    validity: 30,
    deleteOnNewGame: false,
    prefix: 'Autosave',
    lastTurn: 'last-turn',
    beforeLastTurn: 'before-last-turn',
  };
  const DAY = 24 * 60 * 60 * 1000;
  const put = (store: ReturnType<typeof fakeSaveStore>, name: string, date = 0) =>
    store.put(newSave({ turn: 3, year: 1494, nation: 'Dutch', owner: 'me' }, name, date), new Uint8Array([1]));
  const names = async (store: ReturnType<typeof fakeSaveStore>) => (await store.list()).map((m) => m.name).sort();

  it('makes the last-turn save each turn, and a turn autosave every period turns', () => {
    expect(turnAutosaveNames(o, 3, 'Spring 1494')).toEqual(['Autosave-last-turn', 'Autosave-Spring 1494']);
    expect(turnAutosaveNames({ ...o, period: 2 }, 3, 'Spring 1494')).toEqual(['Autosave-last-turn']);
    expect(turnAutosaveNames({ ...o, period: 2 }, 4, 'Autumn 1494')).toEqual([
      'Autosave-last-turn',
      'Autosave-Autumn 1494',
    ]);
    expect(turnAutosaveNames({ ...o, period: 0, prefix: 'Auto' }, 4, 'Autumn 1494')).toEqual(['Auto-last-turn']);
  });

  it('tells the turn autosaves by their prefix, apart from the one-slot autosave and the player’s saves', () => {
    expect(isTurnAutosave(o, { name: 'Autosave-last-turn' })).toBe(true);
    expect(isTurnAutosave(o, { name: 'Autosave-Spring 1494' })).toBe(true);
    expect(isTurnAutosave(o, { name: AUTOSAVE_NAME })).toBe(false);
    expect(isTurnAutosave(o, { name: 'Mine' })).toBe(false);
  });

  it('moves the old last-turn save to before-last-turn, dropping the old before-last-turn save', async () => {
    const store = fakeSaveStore();
    const older = await put(store, 'Autosave-before-last-turn');
    const last = await put(store, 'Autosave-last-turn');
    await put(store, 'Mine');
    const kept = await put(store, 'Autosave-last-turn');
    await shiftLastTurnSaves(store, o, kept);
    expect(await names(store)).toEqual(['Autosave-before-last-turn', 'Autosave-last-turn', 'Mine']);
    const ids = Object.fromEntries((await store.list()).map((m) => [m.name, m.id]));
    expect(ids['Autosave-before-last-turn']).toBe(last.id);
    expect(ids['Autosave-last-turn']).toBe(kept.id);
    expect(await store.get(older.id)).toBeNull();
  });

  it('keeps the first last-turn save as it is', async () => {
    const store = fakeSaveStore();
    const kept = await put(store, 'Autosave-last-turn');
    await shiftLastTurnSaves(store, o, kept);
    expect(await names(store)).toEqual(['Autosave-last-turn']);
  });

  it('drops turn autosaves older than the validity, but not the last-turn saves or other saves', async () => {
    const store = fakeSaveStore();
    const now = 100 * DAY;
    await put(store, 'Autosave-Spring 1494', now - 31 * DAY);
    await put(store, 'Autosave-Autumn 1494', now - 29 * DAY);
    await put(store, 'Autosave-last-turn', now - 40 * DAY);
    await put(store, 'Autosave-before-last-turn', now - 40 * DAY);
    await put(store, 'Mine', now - 40 * DAY);
    await put(store, AUTOSAVE_NAME, now - 40 * DAY);
    await dropOutdatedAutosaves(store, { ...o, validity: 0 }, now);
    expect((await store.list()).length).toBe(6);
    await dropOutdatedAutosaves(store, o, now);
    expect(await names(store)).toEqual([
      AUTOSAVE_NAME,
      'Autosave-Autumn 1494',
      'Autosave-before-last-turn',
      'Autosave-last-turn',
      'Mine',
    ]);
  });

  it('drops every turn autosave as a new game starts', async () => {
    const store = fakeSaveStore();
    await put(store, 'Autosave-Spring 1494');
    await put(store, 'Autosave-last-turn');
    await put(store, 'Mine');
    await put(store, AUTOSAVE_NAME);
    await dropTurnAutosaves(store, o);
    expect(await names(store)).toEqual([AUTOSAVE_NAME, 'Mine']);
  });
});
