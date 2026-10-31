Issue #43: `engine/run-split-node.mjs` never defines the `fcShow`/`fcAsk`
globals that the client Engine now calls (`ClientMain`'s `@JSBody`
methods, used by `WebGUI`). The client throws "fcShow is not defined" at
game start and the split run hangs.

Where: `engine/run-split-node.mjs` only. Do not change the Engine's Java.

Source of truth: how the Browser UI answers the same calls,
`ui/src/webgui.ts` (the `fcShow`/`fcAsk` handlers and the question kinds),
and `ClientMain.java` for the function that takes an answer back (find how
`webgui.ts` replies to an `fcAsk` id and call the same export from Node).

Do:
- Define `globalThis.fcShow(kind, json)`: log nothing by default (a
  `--verbose` flag or env var may log), never throw.
- Define `globalThis.fcAsk(id, kind, json)`: answer every question with
  FreeCol's default answer for its kind, the one a player who just clicks
  OK/the default would give (look at the kinds `webgui.ts` and its test
  know; for a confirm, take the choice that keeps the game going and does
  not send ships to Europe). Answer asynchronously (as the browser does)
  if answering inside the call deadlocks; say which you chose and why.
- Log any kind it does not know, once per kind, and answer it with the
  safest default.

Done when:
- After `./dev.sh ./build.sh` (builds both modules), `./dev.sh -C engine
  node run-split-node.mjs 10` runs all 10 rounds to "finished" with exit 0.
  Put the last lines of that output in your report.
- One commit, subject like
  `run-split-node.mjs: define fcShow and fcAsk, so the split game starts (#43)`.

Traps:
- Building the modules takes several minutes; pipe the build through
  `tail -20`.
- The runner is run from `engine/` (`-C engine`), paths are relative to it.
