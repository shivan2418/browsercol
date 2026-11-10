# Players' saves are the compatibility contract; deploys are numbered builds

BrowserCol is a hosted page: everyone who opens it gets the latest deploy, and nobody can stay on an older one. Nothing pins to a BrowserCol version, so a semantic version would carry no promise. The one thing an update can break for a player is a game they saved: a save in their browser, or an `.fsg` they exported, that no longer loads. So saves are the contract, and deploys are just numbered builds: `build-N` tags, made by `tools/deploy.sh` (`just deploy`), shown on the page as "build N · <commit>" so a bug report names the code it came from.

A save's format already has its own version. Each FreeCol save records `SAVEGAME_VERSION` (14 at the pinned commit), and FreeColServer refuses those below `MINIMUM_SAVEGAME_VERSION` and upgrades older ones as it reads them. Three things can still break a save without that number moving: our patched copies in `engine/patches/` changing what a model class reads or writes, a new FreeCol pin in `freecol.sha`, and the IndexedDB schema in `ui/src/saves.ts` (database version 1) that holds the browser's saves.

## Considered Options

- **Semantic versions (`v0.1.0`):** rejected. Major, minor and patch tell a dependent whether upgrading is safe, and a player has no upgrade to choose. Reserving the major number for save breaks would bump it for engine internals players never see, when the save already records its format.
- **A version per format (BrowserCol's own save version):** not yet. FreeCol's number covers the game XML; until we change the format ourselves, a second number would only repeat it.
- **Dates as build names:** rejected. Two deploys on one day need a suffix, and "build 12" is shorter to quote in a report.

## Consequences

- `SaveGameTest.everySaveFromAnEarlierBuildStillLoadsAndPlays` loads every save in `engine/src/test/resources/saves/`, plays a round and saves again. A change that fails it needs a migration on load, never a deleted or regenerated fixture.
- After a change to what a save holds (a patched model class, a new FreeCol pin), add a fixture from the build before the change, with `-PwriteSave=<date>-<commit>`.
- A change that must break old saves bumps `SAVEGAME_VERSION` with an upgrade step, as FreeCol does, or, failing that, shows the player a clear "made by an older version" message rather than a load error.
- A change to the IndexedDB stores raises the database version in `idbSaveStore` and moves the old stores' saves over in `onupgradeneeded`.
- A push to `main` that changes the landing page deploys only that page, around the latest build's game; only a `build-*` tag changes the game (#374).
