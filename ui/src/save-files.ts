// Saves as files (#69): import a .fsg into the store, and name one for download.
import { readFsg } from './fsg';
import { newSave, type SaveMeta, type SaveStore } from './saves';

/** A save's name from its file name: "Dutch 1525.fsg" is "Dutch 1525". */
export const nameFromFile = (fileName: string) => fileName.replace(/\.fsg$/i, '');

/** The file name to download a save as: its name made safe, then ".fsg". */
export function fileNameOf(name: string): string {
  const safe = name
    .split('')
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c))
    .join('')
    .replace(/_{2,}/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100);
  return `${safe || 'freecol-save'}.fsg`;
}

/**
 * Keep an uploaded .fsg in the store, with the turn, year and nation read
 * from it. Rejects, with the reason, a file that is not a FreeCol save; the
 * store is then untouched.
 */
export async function importSave(
  store: SaveStore,
  fileName: string,
  bytes: Uint8Array,
  now: number,
): Promise<SaveMeta> {
  const info = await readFsg(bytes);
  return store.put(newSave(info, nameFromFile(fileName), now), bytes);
}
