// Saved games in IndexedDB (#68). Two object stores, written in one
// transaction: `blobs` holds each save's .fsg bytes and `saves` its metadata,
// so the save list never reads a blob. Both the Worker (which writes and
// loads saves) and the page (which lists and deletes them) open it, so it
// sits behind a small interface the tests can fake.

/** What the save list shows of a save. */
export interface SaveMeta {
  id: number;
  name: string;
  /** Milliseconds since the epoch. */
  date: number;
  turn: number;
  year: number;
  nation: string;
  /** The .fsg's size in bytes. */
  size: number;
}

/** A save's metadata before the store gives it an id and measures it. */
export type NewSave = Omit<SaveMeta, 'id' | 'size'>;

export interface SaveStore {
  /** Keep a save: its metadata and its bytes, or neither. */
  put(meta: NewSave, bytes: Uint8Array): Promise<SaveMeta>;
  /** The metadata of every save, newest first. */
  list(): Promise<SaveMeta[]>;
  /** A save's bytes, or null if there is no such save. */
  get(id: number): Promise<Uint8Array | null>;
  remove(id: number): Promise<void>;
  /** Give a save another name; nothing if there is no such save. */
  rename(id: number, name: string): Promise<void>;
}

/** What the Engine reports when it has saved (ServerEngine.saveInfo). */
export interface SavedInfo {
  turn: number;
  year: number;
  nation: string;
  owner: string;
}

/** The default name of a save: the nation and the turn, as FreeCol's own save names go. */
export function defaultSaveName(info: Pick<SavedInfo, 'turn' | 'year' | 'nation'>): string {
  return `${info.nation || 'Game'}, turn ${info.turn} (${info.year})`;
}

/** The record to store for a save the Engine has made. */
export function newSave(info: SavedInfo, name: string, now: number): NewSave {
  return {
    name: name.trim() || defaultSaveName(info),
    date: now,
    turn: info.turn,
    year: info.year,
    nation: info.nation,
  };
}

/** Newest first; saves made in the same millisecond, the later id first. */
export const newestFirst = (a: SaveMeta, b: SaveMeta): number => b.date - a.date || b.id - a.id;

const DB_NAME = 'freecol-saves';
const META = 'saves';
const BLOBS = 'blobs';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when the transaction has committed, so a put is on disk when it resolves. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => fail(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => fail(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The saves in IndexedDB, from a page or a Worker. */
export function idbSaveStore(factory: IDBFactory = indexedDB): SaveStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((ok, fail) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(META, { keyPath: 'id', autoIncrement: true });
        r.result.createObjectStore(BLOBS);
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error('IndexedDB open failed'));
    }).catch((ex: unknown) => {
      opened = null; // try again next time
      throw ex;
    }));

  return {
    async put(meta, bytes) {
      const db = await open();
      const tx = db.transaction([META, BLOBS], 'readwrite');
      const saved = { ...meta, size: bytes.length };
      // The id comes from the metadata store; the blob is keyed by it, in the same transaction.
      const id = (await request(tx.objectStore(META).add(saved))) as number;
      tx.objectStore(BLOBS).put(bytes, id);
      await committed(tx);
      return { ...saved, id };
    },
    async list() {
      const db = await open();
      const all = (await request(db.transaction(META).objectStore(META).getAll())) as SaveMeta[];
      return all.sort(newestFirst);
    },
    async get(id) {
      const db = await open();
      const bytes = (await request(db.transaction(BLOBS).objectStore(BLOBS).get(id))) as Uint8Array | undefined;
      return bytes ?? null;
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction([META, BLOBS], 'readwrite');
      tx.objectStore(META).delete(id);
      tx.objectStore(BLOBS).delete(id);
      await committed(tx);
    },
    async rename(id, name) {
      const db = await open();
      const tx = db.transaction(META, 'readwrite');
      const meta = (await request(tx.objectStore(META).get(id))) as SaveMeta | undefined;
      if (meta) tx.objectStore(META).put({ ...meta, name });
      await committed(tx);
    },
  };
}

/** Ask the browser not to evict our saves when disk runs low; false where it will not say. */
export async function keepSaves(storage: Pick<StorageManager, 'persist'> | undefined): Promise<boolean> {
  try {
    return (await storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** The name of the autosave: one slot, replaced each time, so it never fills the list. */
export const AUTOSAVE_NAME = 'Autosave';

export const isAutosave = (m: Pick<SaveMeta, 'name'>): boolean => m.name === AUTOSAVE_NAME;

/** The newest autosave, or null. */
export async function latestAutosave(store: SaveStore): Promise<SaveMeta | null> {
  return (await store.list()).find(isAutosave) ?? null;
}

/** Once `kept` is stored, drop every older autosave. */
export async function dropOlderAutosaves(store: SaveStore, kept: SaveMeta): Promise<void> {
  for (const m of await store.list()) if (isAutosave(m) && m.id !== kept.id) await store.remove(m.id);
}

/**
 * FreeCol's autosave client options (InGameController.autoSaveGame): as each of the player's turns
 * begins, a last-turn save, the one before it kept as the before-last-turn save, and every `period`
 * turns a turn autosave of its own. All are named `prefix-...`; the one-slot Autosave above is apart.
 */
export interface AutosaveOptions {
  /** A turn autosave every this many turns; 0 makes none. */
  period: number;
  /** Days a turn autosave is kept; 0 keeps them. The last-turn saves are kept whatever their age. */
  validity: number;
  /** Delete the turn autosaves when a new game starts. */
  deleteOnNewGame: boolean;
  prefix: string;
  lastTurn: string;
  beforeLastTurn: string;
}

export const lastTurnSaveName = (o: AutosaveOptions): string => `${o.prefix}-${o.lastTurn}`;
export const beforeLastTurnSaveName = (o: AutosaveOptions): string => `${o.prefix}-${o.beforeLastTurn}`;

/** Whether a save is one of the turn autosaves, the last-turn saves among them. */
export const isTurnAutosave = (o: AutosaveOptions, m: Pick<SaveMeta, 'name'>): boolean =>
  m.name.startsWith(`${o.prefix}-`);

/**
 * The names of the saves to make as the player's turn begins: the last-turn save, and a turn
 * autosave named for the turn on every `period`th turn.
 *
 * @param turnLabel The turn's season and year, e.g. Spring 1493.
 */
export function turnAutosaveNames(o: AutosaveOptions, turn: number, turnLabel: string): string[] {
  const names = [lastTurnSaveName(o)];
  if (o.period >= 1 && turn % o.period === 0) names.push(`${o.prefix}-${turnLabel}`);
  return names;
}

/**
 * Once a new last-turn save `kept` is stored: the older last-turn save becomes the before-last-turn
 * save, and the older before-last-turn save goes.
 */
export async function shiftLastTurnSaves(store: SaveStore, o: AutosaveOptions, kept: SaveMeta): Promise<void> {
  const last = lastTurnSaveName(o);
  const before = beforeLastTurnSaveName(o);
  if (last === before) return;
  const all = await store.list();
  for (const m of all) if (m.name === before) await store.remove(m.id);
  // Newest first: the newest older one becomes before-last, any others go.
  let shifted = false;
  for (const m of all) {
    if (m.name !== last || m.id === kept.id) continue;
    if (shifted) await store.remove(m.id);
    else await store.rename(m.id, before);
    shifted = true;
  }
}

/** Drop the turn autosaves older than `validity` days, but not the last-turn saves (removeOutdatedAutosaves). */
export async function dropOutdatedAutosaves(store: SaveStore, o: AutosaveOptions, now: number): Promise<void> {
  if (o.validity <= 0) return;
  const keep = [lastTurnSaveName(o), beforeLastTurnSaveName(o)];
  const oldest = now - o.validity * 24 * 60 * 60 * 1000;
  for (const m of await store.list()) {
    if (isTurnAutosave(o, m) && !keep.includes(m.name) && m.date < oldest) await store.remove(m.id);
  }
}

/** Drop every turn autosave, as a new game starts with the delete option on (removeAutosaves). */
export async function dropTurnAutosaves(store: SaveStore, o: AutosaveOptions): Promise<void> {
  for (const m of await store.list()) if (isTurnAutosave(o, m)) await store.remove(m.id);
}

/**
 * Calls `fire` once, `ms` after the last call of the returned function: a
 * burst of changes makes one autosave.
 */
export function debounced(fire: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fire, ms);
  };
}
