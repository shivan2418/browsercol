# What does FreeCol need from the JVM?

Source: local clone of FreeCol (`/home/emil/freecol-online/freecol`), `src/net/sf/freecol/`. Counts are numbers of `.java` files matching a grep, shown as client / common / server. Totals: client 359 files (82K LOC), common 350 (114K), server 96 (48K), plus `metaserver` and `tools` (not needed).

## Headline: single-player runs the server in-process, but talks to it over a real loopback TCP socket

Single-player is not a direct-call design. The client starts a `FreeColServer` object in the same JVM, which opens a real `ServerSocket`. The client then connects to it with a real `Socket`. The only socket-free connections are the server-to-AI-player ones.

Call chain (paths relative to `src/net/sf/freecol/`):
- `client/control/ConnectController.java:329` `startSinglePlayerGame()` calls `fcc.startServer(false, true, spec, null, -1)` (line 349), then `requestLogin(name, null, fcs.getHost(), fcs.getPort())` (lines 350-351).
- `client/FreeColClient.java:851-857` `startServer()` does `new FreeColServer(...)` in-process.
- `server/FreeColServer.java:249` constructor calls `createServer()` (line 270), which calls `new Server(this, host, port)` (line 294), then `this.server.start()` (line 252). The address defaults to the loopback address plus `InetAddress.getLocalHost()`, and it tries up to 10 ports starting at `FreeCol.getServerPort()`.
- `server/networking/Server.java:52` is `class Server extends Thread`. `ServerSocket` is created at line 100 and `accept()` is called at line 260.
- Client side: `client/networking/UserServerAPI.java:132` `new Connection(host, port, name)` then `conn.startReceiving()`. `common/networking/Connection.java:171-175` `createSocket()` does `new Socket().connect(...)`. The server wraps each accepted socket in `new Connection(socket, ...)` at `server/FreeColServer.java:661`.
- AI players do not use sockets. `server/FreeColServer.java:711-723` builds a pair of `server/networking/DummyConnection` objects and registers one with `Server.addDummyConnection` (`Server.java:~143`). `DummyConnection.askMessage` calls `other.handle(message)` directly, with no serialisation to a stream.

Wire protocol: XML text. `Connection` (`common/networking/Connection.java:138-144`) wraps the socket in a UTF-8 `BufferedReader` for reading and a `FreeColXMLWriter` for writing. A `ReceivingThread` (`common/networking/ReceivingThread.java`) reads messages. The `*Message.java` classes (many dozens in `common/networking/`) are constructed reflectively by tag name.

The seam: `Connection` is the single abstraction both ends use, and `DummyConnection` is already a `Connection` subclass with the socket removed. So the transport can be replaced with an in-memory pipe, or `DummyConnection` can be extended to the human player, without touching the message layer. The client and server are fully separated by messages, so there are two choices. Keep the message layer and swap only the transport (low effort, but threads remain). Or collapse it to synchronous calls (harder, because the client blocks on replies; see Threads).

Sizing: `java.net`/`channels`/`Socket` is touched by 8 / 15 / 2 files, but many only use `InetAddress` or `URL`. Real socket code is in 4 classes: `Server`, `Connection`, `MetaServer`, `FreeColServer`. `MetaServer` and metaserver registration are not needed.

## Reflection and dynamic class loading

No `ClassLoader`, `URLClassLoader` or `ServiceLoader` anywhere (0 files). Reflection is small and name-based. All targets are FreeCol's own classes, so a closed-world AOT toolchain can handle it if the classes are registered:

| Where | What |
|---|---|
| `common/util/Introspector.java:312,329,349,372,395,405` | `Class.forName`, `getDeclaredConstructor`, `newInstance`, `Method.invoke` for get/set by name. The central helper. |
| `common/networking/Message.java:639-655` | Builds `Message` subclasses by tag name: `Introspector.getClassByName(className)`, then constructor `(Game, FreeColXMLReader)`. Covers every `*Message` class. |
| `common/model/FreeColObject.java:99-101` | `"net.sf.freecol.common.model." + type`, instantiated from XML tags. |
| `common/io/FreeColXMLReader.java:844,904,1028` | `Game.newInstance(...)`, `c.newInstance(aiMain, id)` (AI objects). |
| `common/model/Specification.java:2069,3126` | `Introspector.instantiate` for option, type and ability classes named in the rules XML. |
| `common/model/mission/MissionManager.java:90` | Constructor reflection for AI missions. |
| `server/model/ServerGame.java:228-230` | `Class.forName("net.sf.freecol.server.model." + capitalize(type))`. |
| `common/resources/ColorResource.java` | `java.lang.reflect.Field`, looking up `Color.RED` etc. by name. |
| `client/gui/plaf/FreeColLookAndFeel.java:181,201`, `client/gui/Canvas.java:1634` | Swing look-and-feel class names and an `Applet` probe. Client UI only. |
| `FreeColXMLReader.java:191`, `FreeColXMLWriter.java:218`, `Utils.java:252` | `XMLInputFactory.newInstance()`, `XMLOutputFactory.newInstance()`, `TransformerFactory.newInstance()`: JAXP factory lookups (a service-lookup point). |

Files using `java.lang.reflect` / `Class.forName` / `.newInstance(`: 2 / 8 / 1 (client / common / server) for the combined pattern, and 2 / 1 / 1 for `Class.forName` alone. The reflection is a bounded, enumerable set, but it is on the hot path of the protocol and of loading the game spec.

## Threads, synchronisation, executors

- No `ExecutorService`/`Executors` (0 files). Only raw `Thread` subclasses, `synchronized`, and `wait`/`notifyAll`. Files matching `java.util.concurrent|Thread|synchronized`: 27 / 33 / 12.
- Threads created in common/server: `server/networking/Server` (accept loop), `common/networking/ReceivingThread` (one per connection, plus `QuestionThread` and `UpdateThread` inner classes that spawn per-message threads, `ReceivingThread.java:45,99,366`), `common/resources/ResourceManager.java:145` (preload thread), `common/resources/ImageCache.java:63,290` (cleanup thread), `common/sound/SoundPlayer.java:65` (audio thread), `server/ai/AIPlayer.java:281` (a thread per AI invocation). `java.util.Timer` or a scheduler is used in 0 / 1 / 1 files.
- Blocking request/reply is built on monitors: `common/networking/NetworkReplyObject.java:85` `wait(ONE_SECOND)` and `:101` `notifyAll()`. The client sends a message and the calling thread blocks until the reply arrives. About 26 `Thread.sleep`/`wait`/`join`/`notify` call sites across the codebase.
- The Swing EDT is used heavily by the client: `SwingUtilities`/`invokeLater`/`invokeAndWait` in 9 client files.
- Consequence for a browser: it needs threads with blocking waits (real threads via Web Workers and `SharedArrayBuffer`, or a toolchain with green threads), or a transport rewrite.

## File I/O

Files touching `java.io.File`/`java.nio.file`/`FileInput/OutputStream`: 17 / 21 / 3.
- Core classes in `common/io`: `FreeColDirectories` (XDG config, data and cache directories via `user.home` and `XDG_*` env vars, lines 109-120 and 255-353), `FreeColDataFile`, `FreeColTcFile`, `FreeColModFile`, `FreeColSavegameFile`, `FreeColRules`. Also `common/resources/ResourceManager`, `common/i18n/Messages` (reads `.properties`), `option/OptionGroup` and `FileOption` (options XML), `model/HighScore`, `debug/FreeColDebugger`.
- Data: `data/` is 217 MB and 2093 files (1770 png, 126 properties, 55 jpg, 47 xml, 39 ogg, 23 fsm, 16 sza). `data/default` is 184 MB (images), `base` 15 MB, `strings` 12 MB, `mods` 3.6 MB, `maps` 2.5 MB. Resources are found by directory walking and by `java.util.zip`, not via classpath resources, so a virtual file system or preloaded bundle is needed.
- Saves (`.fsg`) are ZIP files containing XML. They are written by `server/FreeColServer` (`saveMapEditorGame` at `:821`, `saveGame` at `:857`; both take a `BufferedImage` thumbnail) and read by `FreeColSavegameFile`. `java.util.zip` appears in `FreeCol.java`, `common/io/FreeColDataFile`, `common/io/sza/SimpleZippedAnimation` and `tools/FSGConverter`.
- Mods are directories or zips under `data/mods`, loaded in single-player by `ConnectController.java:340-345`.
- `System.getProperty`/`exit`/`getenv`: 2 / 5 / 0 files. `Runtime.getRuntime`: 1 / 3 / 0.

## XML

- StAX (`javax.xml.stream`): `XMLInputFactory`/`XMLStreamReader`/`XMLStreamWriter` in 5 / 220 / 42 files. It is the serialisation layer for the specification, game state, saves, and the network protocol (`FreeColXMLReader`, `FreeColXMLWriter`, every `FreeColObject` read/write method).
- The implementation is chosen by JAXP's `XMLInputFactory.newInstance()` (`FreeColXMLReader.java:191`, `FreeColXMLWriter.java:218`). So the JDK's built-in implementation is used. No third-party StAX jar is bundled.
- DOM/XSLT/Schema is minor: `DocumentBuilder`/`org.w3c.dom`/`transform` in 3 common files (`common/util/Utils.java:252` Transformer; `tools/SaveGameValidator` uses `SchemaFactory`; `tools/GenerateDocumentation`). Probably removable.
- The runtime needs a working StAX pull parser and writer. A non-JDK toolchain must supply one.

## AWT / Swing inside common and server

Overall `java.awt.*`: 276 / 21 / 4 files. `javax.swing`: 213 / 11 / 0. The client is Swing throughout (MigLayout in 90 files, custom look-and-feel). That is not the target, since a browser UI must be rewritten or replaced. The concern is the model/server code that pulls AWT in.

Server (4 files, all trivial value types):
- `server/control/PreGameController.java:22` `java.awt.Color` (player colours).
- `server/generator/SimpleMapGenerator.java:37` and `server/model/ServerRegion.java:22` `java.awt.Rectangle`.
- `server/FreeColServer.java:31` `java.awt.image.BufferedImage`, only as the save-game thumbnail parameter (`:821,:857`).

Common (21 files). By import count: `Color` (9), `BufferedImage` (6), `Dimension` (5), `GraphicsEnvironment` (4), `Graphics2D` (3), `Font`/`DisplayMode`/`RenderingHints`/`Transparency`/`ImageIO` (2 each), plus `RescaleOp`, `ColorConvertOp`, `ColorSpace`, `TexturePaint`, `Toolkit`, `Point`, `Rectangle`.
- Value-type use in the model: `Nation`, `Player` (player colour), `Area`, `TradeLocation`, `Europe`, `BuildableType`, `BuildingType`, `UnitType`, `Specification`, `StringUtils`, `Messages`, `ChatMessage`, `SetColorMessage`, `ServerAPI`. These need only `Color`, `Point`, `Rectangle`, `Dimension` as data holders, so a small compat shim for those types covers most of it.
- Image pipeline in `common/resources` (`ImageResource`, `ImageCache`, `ImageUtils`, `FAFile`, `FontResource`, `ColorResource`, `ResourceManager`) plus `common/io/sza/SimpleZippedAnimation` and `ImageAnimationEvent`. These do real raster work (`BufferedImage`, `Graphics2D`, `RescaleOp`, `ImageIO`, `Font.createFont`). They are in `common` because resource loading and image scaling live there. They need either a Java 2D implementation or a replacement with a browser canvas bridge, and could be cut from a headless engine build.
- Others: `common/option/FullscreenDisplayModeOption` (`DisplayMode`, `GraphicsEnvironment`), `common/util/OSUtils`, `common/debug/DebugUtils`, `common/io/FreeColDirectories`. About 11 common files import `javax.swing` types (`JList`, `JLabel`, `ListModel`, `UIManager`, `SwingUtilities`, `JMenu*`, `filechooser.*`); this is incidental coupling in option and model classes.
- Sound: `javax.sound.sampled` in 1 / 4 / 0 files (`common/sound/SoundPlayer`, `OggVorbisDecoderFactory`, `AudioResource`); needs an audio sink.

## Java version and language features

- `build.xml:12` `<property name="java.target.version" value="11"/>`, used for `source` and `target` (`:109-110,128-129`). Java 11 source level.
- No records, no `var`, no text blocks, no switch expressions (0 files matching `var x =`, `"""`, or `case X ->`; the only `record` hits are Javadoc words). Lambdas and `java.util.stream` are used: streams in 17 / 51 / 13 files, `->` lambdas in 99 / 86 / 40. Classic `switch` statements in 39 / 39 / 28. Heavy use of generics, inner and anonymous classes, `java.util.logging` (80 / 81 / 43), and `java.text`/`Locale`/`ResourceBundle` (3 / 6 / 0).
- `java.beans`/`PropertyChange` appears in 40 files, mostly client and option classes.
- Net effect: plain Java 8/11 style; nothing needs a modern compiler front end.

## Third-party jars (`jars/`, `build.xml:31-50`)

| Jar | Files using it | Used for | Needed for a browser single-player build? |
|---|---|---|---|
| `miglayout-core/swing-5.3` | 90 (client GUI, `net.miginfocom`) | Swing layout | No, goes with the Swing client. |
| `commons-cli-1.4` | 1 (`FreeCol.java`) | Command-line parsing | Trivial to remove or replace. |
| `jogg-0.0.17` + `jorbis-0.0.17` | 2 (`common/sound/OggVorbisDecoderFactory`, `SoundPlayer`) | Pure-Java Ogg Vorbis decoding (39 `.ogg` files) | Replaceable: browsers decode Ogg natively (Safari excepted). |
| `cortado-0.6.0` | 2 (`client/gui/Canvas`, `gui/video/VideoComponent`) | Ogg Theora intro video in Swing | No, drop. |
| `findbugs-annotations` | 12 (`@SuppressFBWarnings`) | Static-analysis annotations only | Compile-time only; stub or delete. |
| `junit` (`test/lib`) | tests | Tests | No. |

No JDBC, JAXB, JSON library, logging framework other than `java.util.logging`, or networking library.

## Riskiest items for a browser toolchain

1. Loopback sockets plus a thread-per-connection protocol (`Server`, `Connection`, `ReceivingThread`, `NetworkReplyObject` wait/notify). Browsers have no sockets and no blocking threads. The seam is well defined (`Connection` and `DummyConnection`), but the client's synchronous ask/reply over blocked threads must be rehosted on an in-memory transport with threads or green threads, or turned into synchronous calls.
2. Raw threads, `synchronized`, `wait`/`notify`, per-message and per-AI threads. A toolchain without real or emulated threads will deadlock on the first `askMessage`.
3. Reflection by string name (`Introspector`, `Message`, `FreeColObject`, `Specification`, `ServerGame`, `MissionManager`). It works only if a closed-world compiler is given reflection metadata for all `common.model`, `common.networking`, `server.model` and AI classes. Fixable with registration tables, but easy to miss a class.
4. StAX: about 270 files depend on `javax.xml.stream`, loaded via JAXP lookup. The toolchain's class library must provide a full StAX reader and writer.
5. AWT contamination of `common`/`server`. `Color`, `Point`, `Rectangle`, `Dimension` in the model need only a small shim. But `BufferedImage`, `Graphics2D`, `ImageIO`, `Font` in `common/resources` is a real Java 2D dependency; split resources so a headless engine does not load them.
6. File-system assumptions: directory walking, XDG paths, zip saves, 217 MB of data, mods as directories. Needs a virtual FS and a lazy-loading or bundled asset strategy; data size matters for GitHub Pages delivery.
7. The Swing client (359 files, MigLayout, custom look-and-feel, EDT) is out of reach for any JVM-on-browser toolchain. The UI must be rewritten against the `FreeColClient`/`GUI`-level abstractions. This is separate from what the engine needs.
8. Lower risks: `javax.sound` plus jogg/jorbis (replace with browser audio), `java.util.logging`, `.properties` message loading (126 files), cortado video, findbugs annotations.
