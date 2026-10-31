Issue #54: end the game as FreeCol does. Victory: the victory dialog
(already a question, `WebGUI.showVictoryDialog`) and then the high
scores panel. Defeat: FreeCol's game-over confirm and the high scores.
Today `showHighScoresPanel` is the base GUI's no-op, so no scores show.

Where:
- `engine/src/main/java/online/freecol/web/WebGUI.java`: override
  `showHighScoresPanel(String messageId, List<HighScore> scores)` and add
  it to the class comment's table.
- `ui/src/`: a React panel for the scores, shown from a new event, in
  the style of the existing information/eventPanel dialogs.
- Engine tests under `engine/src/test/java/online/freecol/web/`.

Source of truth:
- `InGameController.gameEndedHandler` (~line 3617) asks the server for
  high scores (`highScore(...)`) and shows the victory dialog;
  `highScoresHandler` (~3670) calls `showHighScoresPanel(key, scores)`.
  Defeat is the `modalConfirmDialog("defeated.text" ...)` /
  `"defeatedSinglePlayer.text"` calls around line 5033, which already go
  through WebGUI's confirm question.
- The panel: `freecol/src/net/sf/freecol/client/gui/panel/report/
  ReportHighScoresPanel.java`: which fields of each `HighScore` it shows
  (name, nation, score, difficulty, turn/date, retirement, ...) and its
  header text from `messageId` (null means none).

Do:
- Event `highScores` with `{text, scores: [{...fields the Swing panel
  shows...}], ok}`; text is the message for messageId or null.
- What happens after the player closes it: until the start screen
  exists, reloading the page is enough. Say in the panel's ok handler or
  a comment what you chose.

Done when:
- A JVM test forces a victory (find how the server decides one; for
  example `ServerPlayer`/`InGameController` `checkForGameOver` or the
  gameEnded message, sent to the client directly if forcing the server
  is too heavy) and sees the high scores event with the scores; and the
  same for a defeat, through the defeat confirm. Assert on the event's
  contents, not only that something was sent.
- The high scores panel lists the entries in a React panel; a vitest
  test for any formatting helper.
- Engine tests, `vp check`, `vp test`, build, and play.mjs pass.
- Commit subjects like `WebGUI: show the high scores at the game's end (#54)`.

Traps:
- Start writing code early: the methods are named above.
- High scores may be read from or saved to a file on the server side;
  in TeaVM there is no file system. If saving fails in the browser,
  catch it where it fails and note it in your report; the JVM tests
  matter most.
- Builds take minutes; pipe long output through `tail -30`.
