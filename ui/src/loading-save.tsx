// FreeCol's LoadingSavegameDialog (#153), shown as a saved game loads when the
// save game dialog option (showSavegameSettings) says so: ConnectController
// asks how to host the loaded game, single player or a multiplayer server with
// its name, address and port. The browser runs no server others can join, so
// single player is the one choice; the multiplayer ones are shown, unavailable,
// as FreeCol lays them out. In the start screen's window (start-screen.tsx).
// Hooks for the browser scripts: [data-loading-save] on the window,
// [data-load-ok] and [data-load-cancel] on its buttons.
import type { SaveMeta } from './saves';
import { NumberField } from './controls';
import { ButtonRow, Heading } from './frame';
import './start-window.css';
import { useCoverage } from './coverage';

/** FreeCol's choices of the save game dialog option. */
export const SHOW_SAVEGAME_SETTINGS = { never: 0, multiplayer: 1, always: 2 } as const;

/**
 * Whether the dialog shows as a save loads (ConnectController.startSavedGame): always, or for a
 * multiplayer game when the option says multiplayer only. The browser's games are single player.
 */
export function showsLoadingSave(option: number, singlePlayer = true): boolean {
  return option === SHOW_SAVEGAME_SETTINGS.always || (!singlePlayer && option === SHOW_SAVEGAME_SETTINGS.multiplayer);
}

export function LoadingSaveDialog({
  save,
  load,
  cancel,
}: {
  /** What the save list says of the save, if the page could read it. */
  save: SaveMeta | null;
  load: () => void;
  cancel: () => void;
}) {
  useCoverage('showLoadingSavegameDialog');
  return (
    <div className="start" data-loading-save>
      <form
        className="start-window"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <h1>BrowserCol</h1>
        <Heading level={2} space="window">
          Loading Save game
        </Heading>
        {save && (
          <p className="quiet loading-save-name">
            {save.name}: turn {save.turn} ({save.year}), {save.nation}
          </p>
        )}
        <fieldset>
          <legend>Game</legend>
          <label>
            <input type="radio" name="hosting" checked readOnly /> Single player
          </label>
          <label>
            <input type="radio" name="hosting" disabled /> Private multiplayer
          </label>
          <label>
            <input type="radio" name="hosting" disabled /> Public multiplayer
          </label>
          <p className="quiet">The browser plays single player games only.</p>
        </fieldset>
        <fieldset>
          <legend>Server</legend>
          <label>
            Server Name: <input type="text" disabled />
          </label>
          <label>
            IP Address: <input type="text" disabled />
          </label>
          <label>
            Port: <NumberField value={null} onChange={() => {}} disabled />
          </label>
        </fieldset>
        <ButtonRow space="window">
          <button type="button" data-load-cancel onClick={cancel}>
            Cancel
          </button>
          <button type="submit" autoFocus data-load-ok>
            OK
          </button>
        </ButtonRow>
      </form>
    </div>
  );
}
