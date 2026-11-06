# BrowserCol

**FreeCol in the browser.** No install, no server: the whole game, AI
included, runs in the page.

▶ **Play it at <https://shivan2418.github.io/browsercol/>**

## How it works

The **Engine** is FreeCol's own Java code, compiled by
[TeaVM](https://teavm.org/) to two WebAssembly GC modules. The **Browser UI**
(TypeScript, React, PixiJS, Vite+) carries FreeCol's protocol messages
between them and draws the game.

```
┌─────────────── page ───────────────┐  postMessage  ┌──── Web Worker ────┐
│  Browser UI  ◀──▶  client.wasm     │ ◀───────────▶ │    server.wasm     │
│  (map, panels)     (FreeCol client)│   FreeCol XML │ (server and the AI)│
└────────────────────────────────────┘               └────────────────────┘
```

FreeCol is pinned to the commit in `freecol.sha`. Our changes to its source
are patched copies in `engine/patches/`, each listed with its reason. Terms
such as Engine, Browser UI and Tileset are defined in
[`GLOSSARY.md`](GLOSSARY.md), and design decisions are in
[`docs/adr/`](docs/adr/).

## Developing

> **Just want to play?** You don't need anything below: open
> <https://shivan2418.github.io/browsercol/> in Chrome or Firefox. Nothing to
> install.

To work on BrowserCol itself, you need Docker and [`just`](https://github.com/casey/just). Every tool
(JDK, Gradle, Node, pnpm, Playwright) runs in a Docker image through
`./dev.sh`, and nothing else is installed on the host.

```sh
./freecol.sh                            # clone FreeCol into freecol/ at freecol.sha
git config core.hooksPath .githooks     # the commit gate (see CLAUDE.md)
just install                            # the UI's packages
just dev                                # build, then a dev server with hot reload
```

`just dev` serves at http://localhost:5173 (or the next free port). It
rebuilds the Engine and reloads the page when the Java changes.

## Commands

`just` with no arguments lists every recipe. The main ones:

| Command | What it does |
| --- | --- |
| `just dev` | Vite dev server with hot reload |
| `just build` | Build `dist/`, the static site (`just build -Prelease` obfuscates the modules and hides the debug side panel at first) |
| `just preview` | Serve the built `dist/` |
| `just storybook` | Storybook at http://localhost:6006, with the game's own art |
| `just fast` | The fast checks: Engine tests, `vp check`, `vp test` |
| `just suite` | The whole suite: fast checks, build and the browser scripts |
| `just ci` | The whole suite on GitHub Actions for the committed HEAD |

### Tests

| Command | What it checks |
| --- | --- |
| `just test-engine` | JVM tests of the Engine (JUnit) |
| `just test-ui` | UI tests (`vp test`) |
| `just check` | Format, lint and type check; a lint warning fails it |
| `just browser smoke` | Play `dist/` for 10 turns in Chromium and Firefox, starting each Classic nation from the start screen |
| `just browser play` | Land, found a colony and end the turn |
| `just browser saves` | Save, reload, export, delete, import, then load the save and play on |
| `just browser tileset` | Draw the map and a colony panel with the test Tileset (`ui/tilesets/test`) |
| `just browser debug` | The debug menu's actions |
| `just browser rounds --rounds 300` | Time AI rounds and memory as the game grows |

The browser scripts run against the built `dist/` in both browsers and save
screenshots in `.cache/`. They take page parameters with `--query`, e.g.
`just browser smoke --query preset=dutch-small`.

`./ci.sh` (or the Suite workflow, `gh workflow run suite.yml --ref <branch>`)
runs the whole suite on GitHub Actions, uploads the screenshots and waits
for the result, so your machine stays free.

### Comparing with Swing FreeCol

`tools/fc-swing/` runs upstream FreeCol's Swing game at `freecol.sha`. The
jar is built with Ant in Docker into `~/.cache/freecol-swing` and runs on the
host's `java`.

```sh
just swing last        # open the newest autosave on this desktop (or a path, or a save name)
just swing-shot -s last wait:40000 shot:map key:F1 wait:3000 shot:f1
                       # on a virtual screen; PNGs in ~/.cache/freecol-swing/shots
just parity            # Swing's player actions, row by row, into docs/parity/
```

### Updating FreeCol

The Gradle build fails when `freecol/` is on any commit other than
`freecol.sha`, or on a branch. To try a newer FreeCol:

1. Run `./freecol.sh <commit, branch or tag>`. It rewrites `freecol.sha`,
   checks the commit out and lists the files in `engine/patches/` whose
   upstream changed.
2. Merge those upstream changes into the patched copies.
3. Run the whole suite, for example by committing on a branch and running
   `./ci.sh`.

### What the build does

`build.sh` builds both Engine modules in one Gradle run. It then bundles
FreeCol's rules and English strings into a data file and copies FreeCol's
translations to `strings/`, which the page fetches for the player's
language. It also copies the default Tileset's art
(`ui/scripts/build-art.ts`, which prints the art budget) and runs
`vp build` into `dist/`. Serve `dist/` from any static host: its URLs are
relative, so a sub-path such as GitHub Pages' `/<repo>/` works. Pushing a
`deploy-*` or `v*` tag deploys to GitHub Pages.

## Project layout

| Path | What's there |
| --- | --- |
| `engine/` | Gradle build of the Engine: compiles `freecol/` with TeaVM into `server.wasm` and `client.wasm` |
| `engine/patches/` | Our patched copies of FreeCol files, which replace upstream at build time; its README lists each one |
| `engine/src/main/java/browsercol/web/` | Entry points: `WorkerMain` (the server, in the Worker), `ClientMain` (the page), `Commands` (the UI's orders), `WebGUI` (FreeCol's GUI interface, answered as events to the page), `DebugActions` |
| `engine/src/main/java/browsercol/shim/` | Stand-ins for JDK classes TeaVM lacks (`java.awt`, `java.beans`, `java.net`, …) and TeaVM's reflection and substitution policies |
| `engine/src/test/` | JVM tests that run the Engine on the JVM |
| `engine/*.mjs` | Node runners for the built modules (`run-node.mjs`, `run-split-node.mjs`) and `sizes.mjs` for module sizes |
| `ui/src/` | The page and the Worker: map renderer, panels and dialogs, the `postMessage` channel, saves, fonts; tests (`*.test.ts(x)`) and stories (`*.stories.tsx`) sit beside the code |
| `ui/scripts/` | Build steps (`build-data.ts`, `build-art.ts`, `build-audio.ts`, …) and the Playwright browser scripts |
| `ui/presets/` | Quick-start presets for `?preset=` |
| `ui/tilesets/` | Tilesets: `freecol-plus`, and `test` for the tileset script |
| `ui/.storybook/` | Storybook config |
| `tools/` | Developer tools: `fc-swing/`, `teavm/` (TeaVM from source, the `Object.wait` reproducer), `swing-inventory.mjs`, `watch-engine.sh` (Engine rebuilds for `just dev`), `copy-modules.sh`, `desktop-check.sh` |
| `docs/` | `adr/` decision records, `research/` notes, `parity/` the Swing parity inventory, `teavm.md` TeaVM's quirks and our workarounds, `agents/` how coding agents use the tracker, `upstream-fixes.md` FreeCol bugs our patches fix |
| `docker/` | `dev.Dockerfile` (JDK, Gradle, Node, pnpm) and `web.Dockerfile` (Playwright with Chromium and Firefox) |
| `.githooks/` | The commit gate: `pre-commit` compiles the Engine, `commit-msg` requires an author trailer |
| `.github/workflows/` | `suite.yml` (the whole suite) and `pages.yml` (deploy to Pages on a tag) |
| `dev.sh`, `build.sh`, `ci.sh`, `freecol.sh` | Run in Docker; build `dist/`; the suite on Actions; pin and update `freecol/` |

Gitignored: `freecol/` (the upstream clone), `ui/generated/` (built modules
and data the page imports), `dist/` (the site) and `.cache/` (Gradle and pnpm
caches, screenshots).

## Playing

A push to `main` does not deploy. `just deploy` tags `origin/main` as the
next build (`build-1`, `build-2`, ...) and pushes the tag, and the Pages
workflow builds and deploys it. The page shows its build on the start screen
and in the credits. Builds are numbered rather than versioned, because the
only promise to players is that their saves keep loading (ADR 0007).
`SaveGameTest` loads every save in `engine/src/test/resources/saves/`; add one
with `just test-engine --tests '*SaveGameTest.writeAFixtureSave' -PwriteSave=<date>-<commit>`
after a change to what a save holds.

The page opens on a start screen (FreeCol's NewPanel and StartGamePanel,
single player): pick a European nation and a difficulty level, then Start
game. The game draws the map in **Tileset mode**: FreeCol's own art, looked up
by resource key as FreeCol does, so a Tileset (an art-only mod) can replace
any key. The canvas is drawn at the screen's pixel ratio, so the map stays
sharp on a HiDPI display.

Drag the map or rest the pointer at its edge to scroll, and zoom with the
wheel. Click a unit to select it; click again to cycle through a stack,
units aboard ships included. Click a tile to send the active unit there.
Click one of your colonies to open its colony panel.

| Key | Order |
| --- | --- |
| Arrows / numpad | Move one step |
| `W` | Next unit |
| `Space` | Leave the unit for this turn |
| `F` / `S` | Fortify / sentry |
| `D` | Disband |
| `P` / `C` / `R` | Plow / clear forest / build road |
| `H` | Go to a destination |
| `B` | Build a colony |
| `Enter` | End the turn |

The debug side panel has a button for each order, disabled while the active
unit can't take it.

### Saves

- **Your saves** are FreeCol's own zipped `.fsg` files, kept in the browser's
  IndexedDB by the Worker. The Worker asks the browser to keep them
  (`navigator.storage.persist()`). A loaded game continues at the same turn
  with the same unit active.
- **Autosave**: FreeCol's own autosave can't run, since the browser client
  has no in-process server. Instead the page saves into one slot named
  "Autosave", 1.5 s after the last change on your turn. Under `just dev` a
  reload resumes it.
- **Turn autosaves** follow the Saved games options in Preferences, as in
  FreeCol: `Autosave-last-turn`, `Autosave-before-last-turn`, and every N
  turns one named for the turn, e.g. `Autosave-Spring 1493`. Old ones go by
  the validity setting.
- **Export and import**: Export downloads the stored `.fsg` unchanged, and
  "Import a .fsg" adds one (`ui/src/fsg.ts` reads its `savegame.xml`).
  `tools/desktop-check.sh <FreeCol dir> <file.fsg>` runs desktop FreeCol's
  `--check-savegame` on a save.

### URL parameters

| Parameter | Effect |
| --- | --- |
| `?skipstart` | Skip the start screen and use FreeCol's defaults |
| `?preset=NAME` | Start from `ui/presets/NAME.json` (or a URL ending `.json`) |
| `?load=ID` | Load a saved game |
| `?new` / `?resume` | Start afresh / resume the autosave (in a built site too) |
| `?autoplay=N` | Auto-end N turns first |
| `?debug` | Add the debug menu |

### Presets

A preset sets what the start screen would, in JSON. Every key is optional:

```json
{ "rules": "classic",
  "difficulty": "model.difficulty.medium",
  "nation": "model.nation.english",
  "seed": 1492,
  "options": { "model.option.mapWidth": 200, "model.option.fogOfWar": false } }
```

`options` takes any game, map generator or difficulty option by its FreeCol
id. A `seed` gives the same map and starting units every time. An unknown key,
option, nation or difficulty, or a value an option doesn't take, fails the
start with a message naming it.

Shipped presets:
- `england-large`, `dutch-small` and `colony-school`.
- `ref-last-stand`: the end of the War of Independence, with the King's last
  regular surrounded. End the turn and the REF gives up.

### Debug menu

`?debug` adds a debug menu to the side panel. It can reveal or hide the map,
add gold, add a unit or goods at the selected tile, skip N turns with the AI
playing, and show the AI players' units and missions. These are FreeCol's
own `DebugUtils` actions. The server Engine runs them in the Worker
(`DebugActions.java`), because `DebugUtils` reaches into the server's game
from the client, which the browser can't do.

## Licence

BrowserCol is free software under the GNU General Public License, version 2
or (at your option) any later version, the same terms as FreeCol itself; see
[`LICENSE`](LICENSE). FreeCol's art, music and sounds keep their own licences
(mostly GPL v2, some CC BY or CC BY-SA), listed in the README next to each
file under `freecol/data/`.

## Credits

FreeCol is by the [FreeCol Team](https://github.com/FreeCol/freecol); this is
an unofficial port. The music is by Alexander Zhelanov and Stian Grenborgen
(CC BY 4.0). Some art comes from OpenGameArt, 0 A.D. and the David Rumsey
Map Collection under CC BY, CC BY-SA or CC0. The full list, with links, is in
the game's About window (Colopedia menu, or Credits on the start screen),
kept in `ui/src/credits.tsx`. BrowserCol uses TeaVM (Apache 2.0), PixiJS and
React (MIT).
