// FreeCol's open-a-saved-game choice (OpenAction, MainPanel's Open and Continue Playing): the saves in
// the browser's store, newest first, to pick one from. Shown in the start screen and, as a window, from
// Game > Open. Hooks for the browser scripts: [data-save-picker] on the list, [data-open-save=ID] on each
// save's row (click selects, double click opens), [data-open-selected] and [data-export-save=ID] on the buttons
// under it, which act on the selected save (#450). A .fsg file on disk opens through [data-open-file], as FreeCol's file chooser (#274).
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ButtonRow, WindowFrame } from './frame';
import './save-picker.css';
import type { SaveMeta } from './saves';
import { useCoverage } from './coverage';
import { IosSavesWarning } from './ios-notes';

const when = (s: SaveMeta) => new Date(s.date).toLocaleString();

/** A save as a row: its name, and under it when it was made, its turn and year, and its nation. */
function SaveRowText({ save }: { save: SaveMeta }) {
  return (
    <>
      <span className="save-head">
        <span className="save-name">{save.name}</span>
        <span className="save-nation" data-save-nation>
          {save.nation}
        </span>
      </span>
      <span className="save-meta">
        <span data-save-date>{when(save)}</span>
        <span data-save-turn>
          Turn {save.turn} ({save.year})
        </span>
      </span>
    </>
  );
}

/**
 * The saves to pick from, as FreeCol's file chooser lists them: a click selects a row, a double click or Enter
 * opens it, the arrow keys move the selection, and Open and Export save... under the list act on it. The newest
 * save is selected at first.
 */
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
  const [picked, setPicked] = useState<number | null>(null);
  if (saves.length === 0) return <p className="quiet">No saved games</p>;
  const selected = saves.find((s) => s.id === picked) ?? saves[0];
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      const next = saves[Math.min(saves.length - 1, Math.max(0, saves.indexOf(selected) + step))];
      setPicked(next.id);
      (e.currentTarget.querySelector(`[data-open-save="${next.id}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === 'Enter') {
      // Not the window's default button: Enter on the list opens the selected save.
      e.preventDefault();
      e.stopPropagation();
      open(selected.id);
    }
  };
  return (
    <>
      <div className="save-picker" role="listbox" aria-label="Saved games" data-save-picker onKeyDown={onKey}>
        {saves.map((s) => (
          <div
            key={s.id}
            className="save-row"
            role="option"
            data-open-save={s.id}
            aria-selected={s === selected}
            tabIndex={s === selected ? 0 : -1}
            onClick={() => setPicked(s.id)}
            onDoubleClick={() => open(s.id)}
          >
            <SaveRowText save={s} />
          </div>
        ))}
      </div>
      <div className="save-actions">
        <button type="button" data-open-selected onClick={() => open(selected.id)}>
          Open
        </button>
        {exportSave && (
          <button type="button" data-export-save={selected.id} onClick={() => exportSave(selected.id)}>
            Export save...
          </button>
        )}
      </div>
    </>
  );
}

/** The saves that exist, for reference, in Game > Save: the same rows, which are not to be picked. */
function SavedGames({ saves }: { saves: SaveMeta[] }) {
  if (saves.length === 0) return null;
  return (
    <>
      <p className="quiet save-list-caption">Saved games in this browser</p>
      <div className="save-list" role="list" aria-label="Saved games" data-save-list>
        {saves.map((s) => (
          <div key={s.id} className="save-row" role="listitem" data-saved={s.id}>
            <SaveRowText save={s} />
          </div>
        ))}
      </div>
    </>
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
    <div className="modal">
      <WindowFrame title="Open Game" close={close} id="open-game" className="dialog">
        <SaveList saves={saves} open={open} exportSave={exportSave} />
        <IosSavesWarning />
        {(openFile || note) && <OpenFile openFile={openFile} note={note} />}
        <ButtonRow>
          <button type="button" data-open-cancel onClick={close}>
            Cancel
          </button>
        </ButtonRow>
      </WindowFrame>
    </div>
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
  saves = [],
  close,
}: {
  title: string;
  /** The saves there are, shown for reference; picking one does nothing. */
  saves?: SaveMeta[];
  /** Save under this name (an empty one is the default name: nation and turn), and download a copy if asked. */
  save: (name: string, download: boolean) => void;
  close: () => void;
}) {
  useCoverage('showSaveDialog');
  return (
    <div className="modal">
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
            Name:{' '}
            <input name="name" data-save-name placeholder="Default: nation and turn" autoFocus autoComplete="off" />
          </label>
          <SavedGames saves={saves} />
          <p className="quiet" data-save-where>
            The save is kept in this browser only. Clearing the browser's data deletes it, so download a copy of any
            game you want to keep.
          </p>
          <IosSavesWarning />
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
    </div>
  );
}
