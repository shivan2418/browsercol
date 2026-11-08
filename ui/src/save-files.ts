// Saves as files (#69): import a .fsg into the store, and name one for download. Where the browser has the
// File System Access API (Chromium), a save is written to, and opened from, a real file in a folder the
// player picks, as FreeCol's file chooser does (#274); elsewhere it is downloaded, and opened through a
// file input.
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

/** The File System Access pickers, which only some browsers have. */
interface PickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    id: string;
    types: typeof FSG_TYPES;
  }) => Promise<{ name: string; createWritable: () => Promise<{ write(b: Uint8Array): unknown; close(): unknown }> }>;
  showOpenFilePicker?: (options: {
    id: string;
    types: typeof FSG_TYPES;
  }) => Promise<{ getFile: () => Promise<File> }[]>;
}

const FSG_TYPES = [{ description: 'FreeCol saved game', accept: { 'application/x-freecol-save': ['.fsg'] } }];
/** The pickers start in the folder the player last picked a save in. */
const PICKER_ID = 'freecol-saves';

/** Whether the browser can write a save to a file the player picks, rather than download it. */
export const hasSavePicker = (w: object = globalThis) => typeof (w as PickerWindow).showSaveFilePicker === 'function';

const cancelled = (ex: unknown) => ex instanceof DOMException && ex.name === 'AbortError';

/** Hand the bytes to the browser as a file download. */
function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** A file a save is to be written to: its name, and how to write it. */
export interface SaveTarget {
  name: string;
  write: (bytes: Uint8Array) => Promise<void>;
}

/**
 * Ask where to write a save: the file the player picks in the browser's save picker, or, where there is none,
 * a download under the suggested name. Null when the player cancels the picker. Call it from the click or key
 * press itself: the browser shows a picker only then.
 */
export async function chooseSaveFile(
  suggestedName: string,
  w: object = globalThis,
  fallback: (bytes: Uint8Array, fileName: string) => void = download,
): Promise<SaveTarget | null> {
  const pick = (w as PickerWindow).showSaveFilePicker;
  if (!hasSavePicker(w) || !pick) {
    return { name: suggestedName, write: (bytes) => Promise.resolve(fallback(bytes, suggestedName)) };
  }
  try {
    const handle = await pick.call(w, { suggestedName, id: PICKER_ID, types: FSG_TYPES });
    return {
      name: handle.name,
      write: async (bytes) => {
        const file = await handle.createWritable();
        await file.write(bytes);
        await file.close();
      },
    };
  } catch (ex) {
    if (cancelled(ex)) return null;
    throw ex;
  }
}

/**
 * Export a stored save as a .fsg file: the file the player picks, or a download. Call it from the click itself
 * (see chooseSaveFile). Resolves to the note to show: what was exported, why it failed, or empty when the player
 * cancels the picker.
 */
export async function exportSaveFile(
  store: Pick<SaveStore, 'get'>,
  meta: Pick<SaveMeta, 'id' | 'name'>,
  choose: (suggestedName: string) => Promise<SaveTarget | null> = chooseSaveFile,
): Promise<string> {
  try {
    // The picker first, while the click still lets the browser show it.
    const target = await choose(fileNameOf(meta.name));
    if (!target) return '';
    const bytes = await store.get(meta.id);
    if (!bytes) throw new Error('no such save');
    await target.write(bytes);
    return `Exported: ${meta.name}`;
  } catch (ex) {
    return `Export failed: ${ex instanceof Error ? ex.message : String(ex)}`;
  }
}

/**
 * Ask for a save to open: the file the player picks in the browser's open picker, or, where there is none, in a
 * file input's. Null when the player cancels. Call it from the click itself, as for chooseSaveFile.
 */
export async function chooseOpenFile(
  w: object = globalThis,
  newInput: () => HTMLInputElement = () => document.createElement('input'),
): Promise<File | null> {
  const pick = (w as PickerWindow).showOpenFilePicker;
  if (typeof pick === 'function') {
    try {
      const [handle] = await pick.call(w, { id: PICKER_ID, types: FSG_TYPES });
      return handle ? await handle.getFile() : null;
    } catch (ex) {
      if (cancelled(ex)) return null;
      throw ex;
    }
  }
  const input = newInput();
  input.type = 'file';
  input.accept = '.fsg';
  return new Promise((done) => {
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    input.click();
  });
}
