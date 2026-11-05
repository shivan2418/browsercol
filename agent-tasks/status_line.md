Issue #80: the Browser UI shows only a bare turn number ("Turn: 5").
Show what FreeCol's status line shows, score, gold, tax and the year
("Spring 1493"), in the side panel in place of the turn line, and keep it
up to date. There is no gh in the sandbox, so this
brief is the spec.

Source of truth: FreeCol's `InGameMenuBar.paintComponent`
(freecol/src/net/sf/freecol/client/gui/menu/InGameMenuBar.java ~line 311),
which builds the text from the message `menuBar.statusLine`
(freecol/data/strings/FreeColMessages.properties line 275):
`StringTemplate.template("menuBar.statusLine")` with `%gold%`
(player.getGold()), `%tax%` (player.getTax()), `%score%`
(player.getScore()) and `%year%` (game.getTurn().getLabel()), then
replaces "|" with "✧".

Where:
- Engine: `engine/src/main/java/browsercol/web/MapJson.java` ~line 123
  builds the map JSON the Browser UI pulls; it already sends
  `"turn"` and `"ourTurn"`. Add a `"statusLine"` field: the message built
  exactly as InGameMenuBar builds it (copy the template code; `Messages`
  is already imported there or in WebGUI). MapJson.of gets the player
  and game already.
- Engine: `WebGUI.java` has `refresh()` (~line 278), which sends the
  `refresh` event that makes the Browser UI pull the map again. FreeCol
  calls `gui.updateMenuBar()` when the gold changes mid-turn (e.g.
  InGameController ~593 and ~4765); override `updateMenuBar()` in
  WebGUI to send the same `refresh` event, so the line updates then too.
- Browser UI: `ui/src/main.tsx` line 158 sets `side.turn` from the map
  view `m.turn`; `ui/src/side.tsx` line 52 shows `Turn: <span
  id="turn">`. Show the status line there instead (keep `id="turn"` on
  an element holding the turn number, or update the browser scripts
  that read `#turn`: grep ui/scripts for `#turn` first), keeping the
  "(AI playing)" note. Add `statusLine` to the map view type.

Done when:
- MapJsonTest: a new test checks `statusLine` against the player's gold,
  tax and score and the turn's label (build the expected text with the
  same StringTemplate, and also assert a literal piece such as the gold
  number appears). Then change the player's gold (player.modifyGold)
  and check the JSON follows.
- WebGUITest (or wherever WebGUI events are tested): `updateMenuBar()`
  sends a `refresh` event.
- side.test.tsx: the side panel shows the status line it is given.
- `./dev.sh -C engine gradle test`, `./dev.sh -C ui pnpm exec vp check`,
  `./dev.sh -C ui pnpm exec vp test` pass; run smoke.mjs and play.mjs once
  (they read the turn) and say what they printed.
- Commits: one for the Engine, one for the Browser UI, e.g.
  `MapJson: send FreeCol's status line (#80)`.

Out of scope: a top bar or menu bar (a later job), styling.

Traps:
- Don't invent the wording: use the message key, so it reads as
  FreeCol's ("Score: 0 ✧ Gold: 1000 ✧ Tax: 0% ✧ Year: Spring 1493").
- `vp check` fails on any lint warning (deny warnings is on).
- Engine builds take minutes; pipe long output through `tail -30`.
- Start writing code within your first 20 steps; this brief already
  names every file you need.
