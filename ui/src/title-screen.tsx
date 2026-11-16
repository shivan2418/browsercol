// The title screen: what a new page shows first, over a parchment map of the crossing from the Old World to the
// New (title-map.webp, made with Meshy's text-to-image). FreeCol's MainPanel: New Game opens the start screen
// (start-screen.tsx), Continue plays the newest save, Load Game opens the saves, Options is Preferences, and Quit
// closes the tab where the browser lets a page do that. Hooks for tests and the browser scripts: [data-new-game],
// [data-continue], [data-open-saves], [data-title-options] and [data-quit].
import { useState, type ReactNode } from 'react';
import wordmark from '../brand/wordmark.svg';
import { SourceLinks, CreditsDialog } from './credits';
import { HomeScreenHint, IosSavesWarning } from './ios-notes';
import { OpenDialog, OpenFile } from './save-picker';
import { isBackgroundSave, type SaveMeta } from './saves';
import { useCoverage } from './coverage';
import { OfflineRing } from './offline-indicator';
import './title-screen.css';

/** What Quit does: close the tab. A browser closes only a tab a script opened, so the page may stay. */
function closeTab(): boolean {
  window.close();
  return window.closed;
}

export function TitleScreen({
  newGame,
  saves = [],
  open: openGame,
  openFile,
  exportSave,
  openNote = '',
  preferences,
  chosen,
  quit = closeTab,
}: {
  /** Go to the start screen to set up a new game. */
  newGame: () => void;
  /** The saved games, newest first: the first is the one Continue plays. */
  saves?: SaveMeta[];
  /** Play a saved game. */
  open?: (id: number) => void;
  /** Ask for a .fsg file and play it, as MainPanel's Open does with its file chooser. */
  openFile?: () => void;
  /** Download a save as a .fsg file. */
  exportSave?: (id: number) => void;
  /** Why the last file would not open, or what became of an export; empty for none. */
  openNote?: string;
  /** The Preferences window, given a way to close it; no Options button without it. */
  preferences?: (close: () => void) => ReactNode;
  /** The player's first choice, called inside the click: the browser lets the title music start then (#272). */
  chosen?: () => void;
  /** Close the tab; false if the browser would not. */
  quit?: () => boolean;
}) {
  useCoverage('showMainPanel');
  const [savesShown, setSavesShown] = useState(false);
  const [prefsShown, setPrefsShown] = useState(false);
  const [credits, setCredits] = useState(false);
  const [stayed, setStayed] = useState(false);
  /** A menu choice: the click is also the gesture the title music waits for. */
  const choose = (then: () => void) => () => {
    chosen?.();
    then();
  };
  const newest = saves[0];
  // Load Game opens the saves; with none, the file chooser straight away.
  const load = saves.length > 0 ? () => setSavesShown(true) : openFile;
  return (
    <div className="start title-screen" data-testid="title">
      {/* The map, sized as the page's cover: the wordmark sits in its top cartouche whatever the window's shape. */}
      <div className="title-backdrop">
        <div className="title-art">
          <h1>
            <img src={wordmark} alt="BrowserCol" />
          </h1>
          <OfflineRing />
        </div>
      </div>
      <div className="title-menu">
        <nav aria-label="Main menu">
          <button type="button" data-new-game autoFocus onClick={choose(newGame)}>
            New Game
          </button>
          {/* Played before: the newest save goes on. Never played: there is nothing to go on with. */}
          <button
            type="button"
            data-continue
            disabled={!newest || !openGame}
            onClick={choose(() => newest && openGame?.(newest.id))}
          >
            {newest && isBackgroundSave(newest) ? 'Resume your last game' : 'Continue'}
          </button>
          {openGame && load && (
            <button type="button" data-open-saves onClick={choose(load)}>
              Load Game
            </button>
          )}
          {preferences && (
            <button type="button" data-title-options onClick={choose(() => setPrefsShown(true))}>
              Options
            </button>
          )}
          <button type="button" data-quit onClick={() => setStayed(!quit())}>
            Quit
          </button>
        </nav>
        {stayed && (
          <p className="title-note" role="status">
            The browser keeps this tab open: close the tab to quit.
          </p>
        )}
        {saves.length === 0 && openNote && <OpenFile note={openNote} />}
        {saves.length > 0 && <IosSavesWarning />}
        <HomeScreenHint />
      </div>
      {openGame && savesShown && saves.length > 0 && (
        <OpenDialog
          saves={saves}
          open={openGame}
          openFile={openFile}
          exportSave={exportSave}
          note={openNote}
          close={() => setSavesShown(false)}
        />
      )}
      {prefsShown && preferences?.(() => setPrefsShown(false))}
      <SourceLinks credits={() => setCredits(true)} />
      {credits && <CreditsDialog close={() => setCredits(false)} />}
    </div>
  );
}
