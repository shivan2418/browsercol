# Engine patches

Each file here replaces the upstream FreeCol file at the same path, at the
commit pinned in the repo root's `freecol.sha` (see the repo root's
`freecol.sh`). Mark every changed line with `// browser:` and say why. An
upstream bug fix is marked `// online:` instead, and gets a row in
`docs/upstream-fixes.md`, the log of FreeCol bugs we fix.

## The rule: keep the game behaviour around a Swing call

When a Swing or JVM-only call has to go, take out only that call. Keep the
game behaviour next to it: a message, a server request, model state, a
callback. Restore it with a GUI overload that the WebGUI implements, or with
`WebGUI.defer`.

In #84 a patch commented out a whole block because one call in it returned
a Swing panel. The first landing panel and the build colony tutorial went
with it, and nothing reported the loss.

## Audit (#85)

All 25 patched files (119 `// browser` markers) were diffed against the
pinned upstream, including unmarked lines. Only the first landing patch
dropped game behaviour, and #84 had already restored it. No other change
drops a message, a server request, model state or a callback.

| File | Change | Class |
| --- | --- | --- |
| `client/gui/GUI.java` | Dialog icons come from `dialogIcon`, which the WebGUI overrides. | platform |
| `client/gui/GUI.java` | A `showEventPanel` overload that takes a closing callback. | restores #84 |
| `client/control/InGameController.java` | First landing panel and tutorial go through that overload. The tutorial names the key `B`. | restores #84 |
| `client/control/InGameController.java` | `saveGame` throws. It never runs: both it and its autosave caller check `getFreeColServer()`, which is null in the browser because the server runs in a Web Worker, apart from the client. Saves go through that Worker instead (#68, #69, #154). | unreached |
| `client/control/InGameController.java` | `buildColony.badUnit` names the unit by its label, not its null name. | upstream bug fix |
| `client/FreeColClient.java` | A browser constructor without resources, mods, image quality, actions, sound, the shutdown hook, the uncaught exception handler or the first GUI task. See below. | platform |
| `FreeCol.java` | `quit` logs instead of calling `System.exit`. `MEMORY_MAX` uses `totalMemory`. | platform |
| `server/FreeColServer.java` | `saveGame` is public, refuses a thumbnail and writes the properties by hand. Only the map editor passes a thumbnail. | platform |
| `common/debug/FreeColDebugger.java` | No save at the end of a debug run. | debug only |
| `common/util/Utils.java` | The random state is written by hand, and saving reseeds the live generator from itself. | deliberate model change, see below |
| `common/networking/Message.java` | Message readers by tag, tried before reflection. | platform |
| `client/networking/UserServerAPI.java` | A connection factory for the postMessage channel. | platform |
| `Utils`, `Nation`, `SetColorMessage`, `ChatMessage` | `Utils.getRGB` replaces `Color.getRGB`. | platform |
| `common/io/*`, `HighScore`, `Messages`, `Specification` | `FileInputStream` replaces `File.toPath`; Aalto factories; no indenting; no POSIX modes; zip entries read whole. | platform |
| `common/i18n/Messages.java` | `FileChooser.*` keys no longer go to Swing's `UIManager`. | Swing |
| `common/i18n/Messages.java` | English descriptions the rules do not bear out are replaced (`CLARIFIED`): Brebeuf's. | online |
| `common/model/Market.java`, `MarketWas.java` | Listeners as a list, not an array. | platform |
| `common/model/TradeRoute.java` | `copyIn` keeps `silent`. | upstream bug fix |
| `common/option/AudioMixerOption.java`, `common/sound/SoundPlayer.java` | No mixers. | platform |
| `common/model/Player.java` | A stack trace without `Thread.dumpStack`. | platform |
| `common/model/Player.java` | `addFather` sets Paine's bells bonus to the tax at once (#169). | upstream bug fix |
| `server/model/Session.java` | The constructor drops a completed session with the same key instead of throwing (#173). | upstream bug fix |

"Platform" means the change works around TeaVM, Swing, `javax.sound` or the
lack of a local file system, and the game plays the same.

**FreeColClient.** The browser client has a null sound controller and a
null action manager. Outside Swing classes, they are used in these places:

- `GUI.playSound`, which the WebGUI overrides.
- `PreGameController.startGame`, only when there is an audio playlist. The
  Engine has none: the Browser UI plays the audio itself, from files under
  `audio/` that the Engine never sees (#157). If audio resources ever reach
  the Engine's resource manager, this call will throw a
  NullPointerException.
- The map editor, which the browser does not reach.

**Random state.** Desktop FreeCol saves the generator's state without
touching it. The browser cannot read a `Random`'s seed, so it reseeds the
generator from itself and saves that seed. After a save, the game draws
different numbers than an unsaved game would. It draws the same numbers as
a game loaded from that save, so saving and loading still agree.

The base `GUI` methods that take a callback and drop it
(`showGameOptionsDialog`, `showMapGeneratorOptionsDialog`,
`showWarehouseDialog`, `showVictoryDialog`, `showDeclarationPanel`,
`showErrorPanel`, `showOpeningVideo`) are upstream's headless stubs. The
WebGUI overrides each one the game reaches. The browser never reaches the
map editor or the opening video.
