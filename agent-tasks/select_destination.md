Issue #50: when a ship moves onto the high seas the client asks where to
sail (`showSelectDestinationDialog`). Today that is reported as
`unasked` and the base GUI's default (null) is used, so a ship cannot be
sent to Europe. Make it a real question, and check a ship can sail to
Europe and back.

Where:
- `engine/src/main/java/browsercol/web/WebGUI.java`:
  `showSelectDestinationDialog` in the "Not asked yet" block; move it out
  and update the class comment's table.
- Engine tests under `engine/src/test/java/browsercol/web/`
  (`WebGUITest.java` shows how a test game and a fake Browser UI work).
- Browser UI only if the existing `choice` question cannot show it:
  prefer reusing `choice`, so `ui/` may need no change.

Source of truth: `SwingGUI.showSelectDestinationDialog` and
`freecol/src/net/sf/freecol/client/gui/dialog/SelectDestinationDialog.java`:
which destinations it lists (Europe, colonies, settlements, ...), its
texts, and what it returns on cancel. The controller side is
`InGameController` (look for where it calls the dialog and how a
destination set on the unit makes it sail to Europe; also how a ship in
Europe sails back to the New World, `moveTo` / `sailToNewWorld` or
similar).

Do:
- Ask it as a `choice` question: one choice per destination, with
  FreeCol's label for each and the default it highlights; the answer is
  the index, and a closed dialog (null) returns null, which cancels the
  move as in Swing.
- Keep the list FreeCol's: build it with the same model calls the Swing
  dialog uses, do not invent filtering. If the Swing dialog's list
  building is in GUI-only code TeaVM cannot load, copy the logic into a
  small helper with a comment naming where it came from.

Done when:
- A JVM test, in a started Classic game: the player's ship moves onto
  the high seas, the fake Browser UI answers the destination question
  with Europe, and after ending turns the server shows the ship in
  Europe (or sailing to it, then in it). Then it sails back to the New
  World and the server shows it on a map tile. Check the server's game,
  not only the client's.
- A test that answering null cancels: the ship stays where it was.
- `showSelectDestinationDialog` is no longer reported as `unasked`.
- `./dev.sh -C engine gradle test` passes; if you touched `ui/`, also
  `vp check` and `vp test`.
- Commit subject like
  `WebGUI: ask where a ship sails, so it can reach Europe (#50)`.

Traps:
- WebGUI methods run on the client's thread: copy how the other choice
  questions wait for their answer.
- Sailing to Europe takes several turns; end turns through the same
  entry points the tests already use, with a bounded loop and a clear
  failure message.
- The Europe panel is a later ticket: do not build one.
- Engine builds take minutes; pipe long output through `tail -30`.
