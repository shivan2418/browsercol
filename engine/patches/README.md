# Engine patches

Each file here replaces the upstream FreeCol file at the same path, at the
commit pinned in `freecol.sha` (see `freecol.sh`). Mark every changed line
with `// browser:` and say why.

## The rule: keep the game behaviour around a Swing call

When a Swing or JVM-only call has to go, take out only that call. Game
behaviour next to it stays: a message, a server request, model state, a
callback. In #84 the patch of `InGameController.newLandName` commented out
the whole first landing block because `showEventPanel` returns a Swing
panel, and the landing panel and the build colony tutorial were lost with
nothing to show it. Keep the behaviour with a GUI overload that the WebGUI
implements (as `GUI.showEventPanel(..., Runnable closing)` does), or with
`WebGUI.defer`.

## Audit (#85)

Every patched file was diffed against the pinned upstream, not only the
lines marked `// browser`. Only #84's patch dropped game behaviour, and #84
restored it. The rest:

| File | Change | Class |
| --- | --- | --- |
| `client/gui/GUI.java` | dialog icons through `dialogIcon`, which the WebGUI overrides | platform: no ImageLibrary |
| `client/gui/GUI.java` | `showEventPanel` overload with a closing callback | restores #84 |
| `client/control/InGameController.java` | `saveGame` throws | dead code: the client has no in-process server, so `getFreeColServer()` is null. Saves go through the Worker (#68, #69, #154) |
| `client/control/InGameController.java` | `buildColony.badUnit` names the unit by its label | upstream bug fix |
| `client/control/InGameController.java` | first landing panel and tutorial through the new overload; key `B` | #84 |
| `client/FreeColClient.java` | browser constructor: no resources, actions, sound, shutdown hook or first GUI task | platform. The callers left of the null sound controller and action manager are Swing classes, `GUI.playSound` (the WebGUI overrides it), `PreGameController.startGame` (needs an audio playlist, which the browser has none of) and the map editor |
| `FreeCol.java` | `quit` logs instead of `System.exit` | platform |
| `server/FreeColServer.java` | `saveGame` public, no thumbnail, `Properties.store` by hand | platform: TeaVM. Only the map editor passes a thumbnail |
| `common/debug/FreeColDebugger.java` | no save at the end of a debug run | debug only, no in-process server |
| `common/networking/Message.java` | message readers by tag before reflection | platform: TeaVM |
| `client/networking/UserServerAPI.java` | connection factory | platform: postMessage channel |
| `common/util/Utils.java` | random state written by hand; reseeds the generator on save | platform: no serialization. The game goes on as a load of that save would |
| `common/util/Utils.java`, `Nation`, `SetColorMessage`, `ChatMessage` | `Utils.getRGB` for `Color.getRGB` | platform: TeaVM |
| `common/io/*`, `HighScore`, `Messages`, `Specification` | `FileInputStream` for `File.toPath`, Aalto factories, no indenting, no POSIX modes, zip entries read whole | platform: TeaVM |
| `common/i18n/Messages.java` | `FileChooser.*` keys not put in Swing's `UIManager` | Swing |
| `common/model/Market.java`, `MarketWas.java` | listeners as a list | platform: TeaVM array checkcast |
| `common/model/TradeRoute.java` | `copyIn` keeps `silent` | upstream bug fix |
| `common/option/AudioMixerOption.java`, `common/sound/SoundPlayer.java` | no mixers | platform: no `javax.sound` |
| `common/model/Player.java` | stack trace without `Thread.dumpStack` | platform: TeaVM |

The base `GUI` stubs that drop a callback (`showGameOptionsDialog`,
`showMapGeneratorOptionsDialog`, `showWarehouseDialog`, `showVictoryDialog`,
`showDeclarationPanel`, `showErrorPanel`, `showOpeningVideo`) are upstream's
headless stubs. The WebGUI overrides each one the game reaches. The map
editor and the opening video are not reached.
