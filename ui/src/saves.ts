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
