# FreeCol Online

FreeCol in the browser. The Engine is FreeCol's own Java code, compiled by
TeaVM to two Wasm GC modules. `server.wasm` (server and AI) runs in a Web
Worker and `client.wasm` runs on the page. The Browser UI (TypeScript 7,
Vite+, PixiJS) carries FreeCol's messages between them and draws the map.

- `engine/`: Gradle build of the Engine: FreeCol's source from the upstream
  clone at `freecol/`, our patched copies in `engine/patches/`, shims and the
  `online.freecol.web` entry points.
- `ui/`: the Browser UI: page script, Worker script, `postMessage` channel,
  map renderer.
- `spike/`: the toolchain spike that got here, kept as a record.

## Commands

Everything runs in a Docker dev image through `./dev.sh`. Nothing is
installed on the host.

```sh
./dev.sh ./build.sh                  # build dist/, the static site (add -Prelease for obfuscated modules)
./dev.sh -C engine gradle test       # JVM tests of the Engine
./dev.sh -C ui npm ci                # once, before the UI commands below
./dev.sh -C ui npx vp test           # UI tests
./dev.sh -C ui npx vp check          # format, lint and type check
DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs   # play dist/ in Chromium and Firefox
```

`build.sh` builds both Engine modules in one Gradle run (`gradle modules`),
bundles FreeCol's rules and strings into a data file, and runs `vp build`
into `dist/`. Serve `dist/` from any static host. URLs are relative, so a
sub-path such as GitHub Pages' `/<repo>/` works.

For now the page starts a Classic game and the human auto-ends its turn.
`?autoplay=N` sets how many rounds it plays (default 10).
