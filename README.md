# BrowserCol

FreeCol in the browser. The Engine is FreeCol's own Java code, compiled by
TeaVM to two Wasm GC modules. `server.wasm` (server and AI) runs in a Web
Worker and `client.wasm` runs on the page. The Browser UI (TypeScript 7,
Vite+, PixiJS) carries FreeCol's messages between them and draws the map.

- `engine/`: Gradle build of the Engine: FreeCol's source from the upstream
  clone at `freecol/`, our patched copies in `engine/patches/`, shims and the
  `browsercol.web` entry points.
- `ui/`: the Browser UI: page script, Worker script, `postMessage` channel,
  map in Tileset mode.
- `spike/`: the toolchain spike that got here, kept as a record.

## Commands

Everything runs in a Docker dev image through `./dev.sh`. Nothing is
installed on the host.

The `justfile` wraps the commands below (`just` lists its recipes). `just dev`
starts Vite's dev server with hot reload at http://localhost:5173 (it builds
first if `ui/generated/` is missing; rerun `just build` after Engine changes),
and `just preview` serves the built `dist/` there.

```sh
./dev.sh ./build.sh                  # build dist/, the static site (add -Prelease for a release build: obfuscated modules, debug side panel hidden at first)
./dev.sh -C engine gradle test       # JVM tests of the Engine
./dev.sh -C ui pnpm install --frozen-lockfile                # once, before the UI commands below
./dev.sh -C ui pnpm exec vp test           # UI tests
./dev.sh -C ui pnpm exec vp check          # format, lint and type check; a lint warning fails it
DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs   # play dist/ in Chromium and Firefox
DEV_VARIANT=web ./dev.sh node ui/scripts/play.mjs    # land, found a colony, end the turn in both
DEV_VARIANT=web ./dev.sh node ui/scripts/saves.mjs   # save, reload, export, delete, import, load the save and play on in both
DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.mjs # draw the map and a colony panel with the test Tileset (ui/tilesets/test) in both
DEV_VARIANT=web ./dev.sh node ui/scripts/rounds.mjs --rounds 300  # time AI rounds and memory as the game grows, per browser
```

To compare with the original, `tools/fc-swing/` runs upstream FreeCol's Swing
game at `freecol.sha` (the jar is built with Ant in Docker, into
`~/.cache/freecol-swing`; it runs on the host's `java`):

```sh
just swing last                      # open the newest autosave in Java FreeCol on this desktop (or a path, or a save name)
just swing-shot -s last wait:40000 shot:map key:F1 wait:3000 shot:f1   # on a virtual screen in Docker; PNGs in ~/.cache/freecol-swing/shots
```

To run the whole suite on GitHub Actions instead, start the Suite workflow
(`.github/workflows/suite.yml`) from the Actions tab or with
`gh workflow run suite.yml --ref <branch>`. It runs the commands above and
uploads the browser screenshots. `./ci.sh` does the same for the
committed HEAD of any branch and waits for the result, so the machine stays
free.

FreeCol is pinned to the commit in `freecol.sha`. `./freecol.sh` clones
`freecol/` or checks it out at that commit, and the Gradle build fails when
`freecol/` is on any other commit or on a branch. To try a newer FreeCol, run
`./freecol.sh <commit, branch or tag>`: it rewrites `freecol.sha`, checks the
commit out and lists the files in `engine/patches/` whose upstream changed,
which need those changes merged in. Then run the whole suite, e.g. by
committing on a branch and running `./ci.sh`.

`build.sh` builds both Engine modules in one Gradle run (`gradle modules`),
bundles FreeCol's rules and English strings into a data file, copies
FreeCol's translations to `strings/` (the page fetches the one the player's
language option picks), copies the map art
of the default Tileset (`ui/scripts/build-art.mjs`, which also prints the art
budget) and runs `vp build` into `dist/`. Serve `dist/` from any static host. URLs are relative, so a
sub-path such as GitHub Pages' `/<repo>/` works.

The page opens on a start screen (FreeCol's NewPanel and StartGamePanel,
single player): pick a European nation and a difficulty level, then Start
game. The choices come from the ruleset's own specification and go to the
server Engine as a preset (below). `?skipstart` skips the screen and starts
with FreeCol's defaults; `?preset=` and `?load=` skip it too. The browser
scripts use `?skipstart`, except `smoke`, which plays through the screen and
starts each Classic nation from it.

Then the page starts a Classic game and draws the map in Tileset mode: FreeCol's
own art, found by resource key as FreeCol finds it, so a Tileset (an
art-only mod) can replace any key. The map follows the active unit, marked
with FreeCol's cursor, and the side panel shows it and the tile under the
pointer. The menu bar over the map has FreeCol's menus and its status line
(the score, the gold, the tax and the year); the side panel, a debug
scaffold, shows the turn. Drag the map or rest the
pointer at its edge to scroll, and zoom with the wheel. Click one of your
colonies to open its colony panel (also opened after founding one), which
shows what FreeCol's does, read-only: buildings (with empty plots and
upkeep), the tiles drawn as the map draws them and who works them, units
outside, ships in port and the cargo of the one clicked, the warehouse, net
production, population and the current build, and follows the colony as it
changes. Click one of your
units to select it (click again to cycle through a stack, units aboard ships
included; not in a colony, where a click opens the panel, as in FreeCol), click a tile to send the active unit there, move one step with
the arrow keys or numpad, `W` for the next unit, `Space` to leave it for
this turn, `F` to fortify it, `S` to sentry it, `D` to disband it, `P` to
plow its tile, `C` to clear a forest, `R` to build a road, `H` to send it
to a destination, `B` to build a colony, `Enter` to end the turn. The side
panel has a button for each of them, disabled while the active unit may not
take that order.
The side panel also saves the game under a name and lists the saved games
(name, date, turn, nation) with a Load, an Export and a Delete button each. Saves live
in the browser's IndexedDB, written by the Worker, and the Worker asks the
browser to keep them (`navigator.storage.persist()`). A save is FreeCol's own
zipped `.fsg` with the active unit, so a loaded game continues at the same
turn with the same unit active; Load reloads the page on `?load=ID`. FreeCol's
own autosave never runs (the browser client has no in-process server), so the
page autosaves instead: 1.5 s after the last change on the player's turn it
saves into one slot named "Autosave", replacing the last. Under `just dev` a
reload (a rebuild, say) resumes that autosave; `?new` starts afresh, and
`?resume` resumes in a built site too. The debug panel's "Reset save" deletes
the autosave and starts a new game; an autosave the Engine can no longer read
is dropped the same way.
The page also makes FreeCol's own autosaves as each of the player's turns
begins, by its Saved games options in Preferences: `Autosave-last-turn`, the
one before it kept as `Autosave-before-last-turn`, and every N turns
(autosave period) one named for the turn, e.g. `Autosave-Spring 1493`. Turn
autosaves older than the validity in days go as the page loads, and all of
them as a new game starts if "Delete autosaves files" is on. A loaded game's
first turn and an `?autoplay` run make none.
With the "Save game dialog" option at Always, loading a save first shows
FreeCol's Loading Save game window: single player is the one choice, the
multiplayer ones shown unavailable; Cancel starts a new game instead. At
Multiplayer only (FreeCol's default) it never shows, as browser games are
single player.
Export downloads the stored `.fsg` unchanged, and "Import a .fsg" adds one
to the list: the turn, year and nation come from the file's `savegame.xml`
(`ui/src/fsg.ts`, read in the page; a file that is not a FreeCol save is
refused with a message). `tools/desktop-check.sh <FreeCol dir> <file.fsg>`
runs desktop FreeCol's `--check-savegame` on a save, e.g. one exported here
(`saves.mjs --keep-export DIR` keeps the script's).
`?autoplay=N` first auto-ends N turns
(debug; the smoke test uses 10). The map canvas is drawn at the screen's
pixel ratio, so the map is sharp on a HiDPI display. The browser scripts save
screenshots in `.cache/`.

`?preset=NAME` is the debug quick start: it skips the start screen and
starts from `ui/presets/NAME.json` (shipped as `presets/NAME.json`; a URL
ending `.json` works too). A preset sets what the start screen will set, in
JSON, and every key is optional:

```json
{ "rules": "classic",
  "difficulty": "model.difficulty.medium",
  "nation": "model.nation.english",
  "seed": 1492,
  "options": { "model.option.mapWidth": 200, "model.option.fogOfWar": false } }
```

`options` takes any game, map generator or difficulty option by its FreeCol
id and a boolean, whole number or string. The same preset with a `seed`
gives the same map and starting units every time (FreeCol's own `--seed`
only reseeds a loaded game, so the Engine seeds a new one itself). An
unknown key, option, nation or difficulty, or a value the option does not
take, fails the start with a message naming it. `england-large` and
`dutch-small` ship, and `colony-school`. `ref-last-stand` is the end of the
War of Independence: the Dutch have declared, and the King's last regular
stands surrounded by their army; end the turn and the REF gives up. The browser scripts take page parameters:
`DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs --query preset=dutch-small`
and the same `--query` for `play.mjs`.

`?debug` adds a debug menu to the side panel: reveal or hide the map, add
gold, add a unit or goods at the selected tile (goods go to the colony
there), skip N turns with the AI playing, and show the AI players' units and
missions. It combines with `?preset=` and `?autoplay=`. The actions are
FreeCol's own debug actions (`DebugUtils`), run by the server Engine in the
Worker as requests (`engine/.../DebugActions.java`), because `DebugUtils`
reaches into the server's game from the client, which the browser cannot do.
`DEV_VARIANT=web ./dev.sh node ui/scripts/debug.mjs` checks them in the
built site.

## Licence

BrowserCol is free software under the GNU General Public License,
version 2 or (at your option) any later version, the same terms as FreeCol
itself; see `LICENSE`. FreeCol's art, music and sounds keep their own
licences (mostly GPL v2, some CC BY or CC BY-SA), listed in the README next
to each file under `freecol/data/`.

## Credits

FreeCol is by the FreeCol Team (https://github.com/FreeCol/freecol); this
is an unofficial port. The game's music is by Alexander Zhelanov and Stian
Grenborgen (CC BY 4.0), and some art comes from OpenGameArt, 0 A.D. and the
David Rumsey Map Collection under CC BY, CC BY-SA or CC0. The full list,
with links, is in the game's About window (Colopedia menu, or Credits on the
start screen), kept in `ui/src/credits.tsx`. The Browser UI uses TeaVM
(Apache 2.0), PixiJS and React (MIT).
