Issue #51: the capture goods dialog (after a naval win: pick which of the
loser's goods to take aboard) and the dump cargo dialog (pick goods to
throw overboard) are reported as `unasked` and fall back to the base
GUI's default. Make both real questions the Browser UI answers.

Where:
- `engine/src/main/java/online/freecol/web/WebGUI.java`:
  `showCaptureGoodsDialog` and `showDumpCargoDialog` in the "Not asked
  yet" block. Move them out of it and update the class comment's table.
- `engine/src/test/java/online/freecol/web/WebGUITest.java` (or a new
  test beside it in the same style).
- `ui/src/webgui.ts` (question handlers and answer encoding),
  `ui/src/dialogs.ts` and the React panel code (`panels.tsx`), with
  tests beside them (`webgui.test.ts`, `dialogs.test.ts`,
  `panels.test.tsx`).
- `ui/scripts/dialogs.mjs`, if it lists the question kinds.

Source of truth: FreeCol's Swing versions,
`freecol/src/net/sf/freecol/client/gui/dialog/CaptureGoodsDialog.java`
and `DumpCargoDialog.java`, and how `SwingGUI` calls them and what it
hands the `DialogHandler` on OK and on cancel. Follow how the existing
questions in WebGUI are built (`confirm`, the choice questions for
`showChooseFoundingFatherDialog`/`showEmigrationDialog`), and how the
handlers get their answer through `Questions`.

Do:
- Add one new question kind for picking a subset of goods, e.g.
  `goods`: JSON `{text, ok, cancel, max, goods: [{id, type, name,
  amount, icon}]}` where `max` is how many lots fit (capture: the
  winner's free holds; dump: no limit, use the cargo count). The answer
  is the chosen indexes as a JSON array, or null when closed. `icon` is
  the goods type's resource key, so a Tileset can replace it.
- Capture goods: on OK the handler gets the chosen goods; on cancel or
  close, what Swing gives on cancel (read CaptureGoodsDialog: check
  whether that is an empty list). Never allow more than `max` picks.
- Dump cargo: the same, with the unit's goods; on cancel, Swing's cancel
  value.
- Browser UI: a React dialog listing each lot with a checkbox, name and
  amount, OK and Cancel, Enter and Escape as the other dialogs. Keep the
  look of the other dialogs.
- Document the new kind in WebGUI's class comment table.

Done when:
- Java tests: for each dialog, an answer picking some goods reaches the
  handler as exactly those goods, and a closed dialog (null) gives
  Swing's cancel value. Calling the WebGUI methods directly with a unit
  and goods from a started test game is fine; you do not need to stage a
  naval battle.
- UI tests: the handler encodes the picked indexes, null on close, and
  the dialog stops at `max`.
- `./dev.sh -C engine gradle test`, `./dev.sh -C ui pnpm exec vp check` and
  `./dev.sh -C ui pnpm exec vp test` pass.
- Commits: one for the Engine side, one for the Browser UI, e.g.
  `WebGUI: ask the capture goods and dump cargo dialogs (#51)`.

Facts already looked up (a first run spent its whole two hours reading
FreeCol and never wrote code; do not repeat that research, start writing
within your first 20 steps and commit the Engine side as soon as its
tests pass):
- Swing: `CaptureGoodsDialog.getResponse()` and
  `DumpCargoDialog.getResponse()` both return the checked goods on OK
  and an EMPTY list (not null) on cancel or close. Capture's limit is
  `winner.getSpaceLeft()`; dump has none.
- Callers: `InGameController` ~3928 (capture: the handler loots the
  chosen goods) and ~5206 (dump: the handler unloads each chosen goods
  overboard). The handler is a `DialogHandler<List<Goods>>`; call
  `handler.handle(list)` once.
- Pattern to copy: `WebGUI.showChooseFoundingFatherDialog` (~line 494),
  which asks a question and passes the answer to its handler.
- For the test, take a ship from a started game (`WebGUITest` shows how)
  and give it goods on the client side with `new Goods(game, ship,
  goodsType, amount)` or `ship.add(...)`; call the WebGUI method directly
  with a handler that records what it gets.

Traps:
- WebGUI methods are called on the client's thread and must not block
  forever: copy how the founding-father question waits and answers.
- The DialogHandler runs controller code; call it once, on every path.
- `vp check` fails on any lint warning (deny warnings is on).
- Engine builds take minutes; pipe long output through `tail -30`.
