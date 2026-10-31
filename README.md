# FreeCol Online

FreeCol in the browser. The Engine is FreeCol's own Java code, compiled by
TeaVM to two Wasm GC modules. `server.wasm` (server and AI) runs in a Web
Worker and `client.wasm` runs on the page. The Browser UI (TypeScript 7,
Vite+, PixiJS) carries FreeCol's messages between them and draws the map.

- `engine/`: Gradle build of the Engine: FreeCol's source from the upstream
  clone at `freecol/`, our patched copies in `engine/patches/`, shims and the
  `online.freecol.web` entry points.
- `ui/`: the Browser UI: page script, Worker script, `postMessage` channel,
  map in Tileset mode.
- `spike/`: the toolchain spike that got here, kept as a record.

## Commands

Everything runs in a Docker dev image through `./dev.sh`. Nothing is
installed on the host.

```sh
./dev.sh ./build.sh                  # build dist/, the static site (add -Prelease for obfuscated modules)
./dev.sh -C engine gradle test       # JVM tests of the Engine
./dev.sh -C ui npm ci                # once, before the UI commands below
./dev.sh -C ui npx vp test           # UI tests
./dev.sh -C ui npx vp check          # format, lint and type check; a lint warning fails it
DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs   # play dist/ in Chromium and Firefox
DEV_VARIANT=web ./dev.sh node ui/scripts/play.mjs    # land, found a colony, end the turn in both
DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.mjs # draw with the test Tileset (ui/tilesets/test) in both
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
bundles FreeCol's rules and strings into a data file, copies the map art
of the default Tileset (`ui/scripts/build-art.mjs`, which also prints the art
budget) and runs `vp build` into `dist/`. Serve `dist/` from any static host. URLs are relative, so a
sub-path such as GitHub Pages' `/<repo>/` works.

The page starts a Classic game and draws the map in Tileset mode: FreeCol's
own art, found by resource key as FreeCol finds it, so a Tileset (an
art-only mod) can replace any key. The map follows the active unit, marked
with FreeCol's cursor, and the side panel shows it and the tile under the
pointer. Drag the map or rest the pointer at its edge to scroll, and zoom
with the wheel. Click one of your units to
select it (click again to cycle through a stack, units aboard ships
included), click a tile to send the active unit there, move one step with
the arrow keys or numpad, `W` for the next unit, `Space` to leave it for
this turn, `F` to fortify it, `S` to sentry it, `D` to disband it, `P` to
plow its tile, `C` to clear a forest, `R` to build a road, `H` to send it
to a destination, `B` to build a colony, `Enter` to end the turn. The side
panel has a button for each of them, disabled while the active unit may not
take that order.
`?autoplay=N` first auto-ends N turns
(debug; the smoke test uses 10). The map canvas is drawn at the screen's
pixel ratio, so the map is sharp on a HiDPI display. The browser scripts save
screenshots in `.cache/`.
