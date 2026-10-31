// An in-memory SaveStore for the tests, where there is no IndexedDB.
import { newestFirst, type SaveMeta, type SaveStore } from './saves';

export function fakeSaveStore(): SaveStore & { blobs: Map<number, Uint8Array> } {
  const metas = new Map<number, SaveMeta>();
  const blobs = new Map<number, Uint8Array>();
  let last = 0;
  return {
    blobs,
    put: async (meta, bytes) => {
      const saved = { ...meta, id: ++last, size: bytes.length };
      metas.set(saved.id, saved);
      blobs.set(saved.id, bytes);
      return saved;
    },
    list: async () => [...metas.values()].sort(newestFirst),
    get: async (id) => blobs.get(id) ?? null,
    remove: async (id) => {
      metas.delete(id);
      blobs.delete(id);
    },
  };
}
