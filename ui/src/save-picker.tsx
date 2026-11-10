// FreeCol's open-a-saved-game choice (OpenAction, MainPanel's Open and Continue Playing): the saves in
// the browser's store, newest first, to pick one from. Shown in the start screen and, as a window, from
// Game > Open. Hooks for the browser scripts: [data-save-picker] on the list and [data-open-save=ID] on
// each save's button. A .fsg file on disk opens through [data-open-file], as FreeCol's file chooser (#274).
import { ButtonRow, WindowFrame } from './frame';
import type { SaveMeta } from './saves';
import { useCoverage } from './coverage';

/** A save's line: its name, when it was made, the turn and the nation. */
export const saveSummary = (s: SaveMeta) =>
  `${s.name} | ${new Date(s.date).toLocaleString()} | turn ${s.turn} (${s.year}) | ${s.nation}`;

export function SaveList({
  saves,
  open,
  exportSave,
}: {
  saves: SaveMeta[];
  open: (id: number) => void;
  /** Download a save as a .fsg file; no Export button without it. */
  exportSave?: (id: number) => void;
}) {
  if (saves.length === 0) return <p className="quiet">No saved games</p>;
  return (
    <ul className="save-picker" data-save-picker>
      {saves.map((s) => (
        <li key={s.id}>
          <button type="button" data-open-save={s.id} onClick={() => open(s.id)}>
            {saveSummary(s)}
          </button>
          {exportSave && (
            <button type="button" data-export-save={s.id} onClick={() => exportSave(s.id)}>
              Export save...
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Open a .fsg file the player picks, and what became of the last one, if it would not open. */
export function OpenFile({ openFile, note }: { openFile?: () => void; note?: string }) {
  return (
    <p>
      {openFile && (
        <button type="button" data-open-file onClick={openFile}>
          Open a file...
        </button>
      )}{' '}
      {note && <span data-open-note>{note}</span>}
    </p>
  );
}

/** Game > Open: the saves in a window, and a save file to open in place of them. */
export function OpenDialog({
  saves,
  open,
  openFile,
  exportSave,
  note,
  close,
}: {
  saves: SaveMeta[];
  open: (id: number) => void;
  /** Ask for a .fsg file and open it. */
  openFile?: () => void;
  /** Download a save as a .fsg file. */
  exportSave?: (id: number) => void;
  /** Why the last file would not open, or what became of an export; empty for none. */
  note?: string;
  close: () => void;
}) {
  useCoverage('showLoadDialog');
  return (
    <WindowFrame title="Open Game" close={close} id="open-game" className="dialog">
      <SaveList saves={saves} open={open} exportSave={exportSave} />
      {(openFile || note) && <OpenFile openFile={openFile} note={note} />}
      <ButtonRow>
        <button type="button" data-open-cancel onClick={close}>
          Cancel
        </button>
      </ButtonRow>
    </WindowFrame>
  );
}

/**
 * Game > Save and Game > Save and Exit where the browser cannot write a file the player picks: the name the save
 * is kept under, which the player may change. The save stays in the browser, which can clear it, so the window
 * says so and offers a downloaded copy too.
 */
export function SaveDialog({
  title,
  save,
  close,
}: {
  title: string;
  /** Save under this name (an empty one is the default name: nation and turn), and download a copy if asked. */
  save: (name: string, download: boolean) => void;
  close: () => void;
}) {
  useCoverage('showSaveDialog');
  return (
    <WindowFrame title={title} close={close} id="save-game" className="dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          save(typeof name === 'string' ? name : '', submitter?.hasAttribute('data-save-download') ?? false);
        }}
      >
        <label>
          Name: <input name="name" data-save-name placeholder="Default: nation and turn" autoFocus autoComplete="off" />
        </label>
        <p className="quiet" data-save-where>
          The save is kept in this browser only. Clearing the browser's data deletes it, so download a copy of any game
          you want to keep.
        </p>
        <ButtonRow>
          <button type="button" data-save-cancel onClick={close}>
            Cancel
          </button>
          {/* Save first: Enter in the name field presses the form's first submit button. */}
          <button type="submit" data-save-ok>
            Save
          </button>
          <button type="submit" data-save-download>
            Save and Download
          </button>
        </ButtonRow>
      </form>
    </WindowFrame>
  );
}
