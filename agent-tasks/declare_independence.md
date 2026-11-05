Issue #53: let the player declare independence. Today
`WebGUI.showConfirmDeclarationDialog` is reported as `unasked` and
returns the base GUI's empty list (so `declareIndependence` cancels),
and `showDeclarationPanel` is the base GUI's no-op, which drops the
callback that actually tells the server.

Where:
- `engine/src/main/java/browsercol/web/WebGUI.java`: move
  `showConfirmDeclarationDialog` out of the "Not asked yet" block,
  override `showDeclarationPanel(Runnable afterClosing)`, and update the
  class comment's table.
- `Commands.java` / `ClientMain.java`: an entry point the Browser UI
  calls to declare, calling `InGameController.declareIndependence()`
  (copy how the #49 unit orders are wired: Commands method, a
  `@JSExport` in ClientMain, a side button in `ui/src/`).
- Engine tests under `engine/src/test/java/browsercol/web/`
  (`WebGUITest.java` and `CommandsTest.java` show a test game and the
  fake Browser UI).

Source of truth: `InGameController.declareIndependence` (~line 3241 of
`freecol/src/net/sf/freecol/client/control/InGameController.java`): it
needs two non-empty names, nation then country, else it cancels;
`Player.checkDeclareIndependence` says when it is allowed (and the
controller already shows that as an information panel). The Swing
dialog is `freecol/src/net/sf/freecol/client/gui/dialog/
ConfirmDeclarationDialog.java`: copy its texts, its default names and
its order. The panel is `.../gui/panel/DeclarationPanel.java`.

Do:
- The confirm: ask with the existing `input` question kind if it can
  take two fields; if it cannot, add the smallest new question kind (in
  `ui/src/`) for two text fields with defaults, ok and cancel. A closed
  dialog returns null (cancel).
- The panel: an event with the declaration's text (Messages keys the
  Swing panel uses) shown in a React dialog; when the player closes it,
  run `afterClosing` on the client's thread, as `showEventPanel`'s ok
  does today. If the event-with-ok pattern exists already (information,
  eventPanel), reuse it.
- The button: always shown for a colonial player; the controller
  explains when it is not allowed yet.

Done when:
- A JVM test: in a started Classic game, make the declaration allowed on
  the server (raise the player's rebel share / SoL as
  `checkDeclareIndependence` needs; set it directly on the server-side
  objects), call the Commands entry point, the fake Browser UI answers
  the names and closes the panel, and the server's player is now a
  rebel (`PlayerType.REBEL`) with the new names.
- A test that cancelling the names leaves the player colonial.
- `showConfirmDeclarationDialog` is no longer reported as `unasked`.
- Engine tests, `vp check`, `vp test`, build, and play.mjs pass.
- Commit subjects like
  `WebGUI: ask for the new nation's names and show the declaration (#53)`.

Traps:
- Start writing code early: everything you need is named above. Read
  those files, not the whole code base.
- WebGUI methods run on the client's thread: copy how the other
  questions wait for their answer.
- The war of independence itself (the REF arriving) is out of scope.
- Builds take minutes; pipe long output through `tail -30`.
