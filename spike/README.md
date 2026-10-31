# Toolchain spike, stage 1: the Engine headless under TeaVM

Stage 1 of [Toolchain spike on real FreeCol code](https://github.com/shivan2418/freecol-online/issues/7): FreeCol's own server, AI and model, compiled by TeaVM 0.16.0 to Wasm GC, play a Classic single-player game in Node. The human seat is a stub that ends its turn immediately, so only the AI plays. The Worker channel, client Engine, `WebGUI` and PixiJS map are [stage 2](#toolchain-spike-stage-2-the-engine-split-in-the-browser), at the end of this file. Patch and shim counts in the stage 1 sections are as of stage 1.

## Run it

> The Engine has since moved from `spike/engine` to `engine/` at the repo root ([#13](https://github.com/shivan2418/freecol-online/issues/13)); the commands below use the new path. Its two browser modules now build in one run with `gradle modules`.

Everything runs in the dev container (`docker/dev.Dockerfile`, via `../dev.sh`). FreeCol's source and data come from the upstream clone at `../freecol`.

```sh
./dev.sh -C engine gradle generateWasmGC copyWasmGCRuntime   # debug build (add -Prelease for obfuscated)
./dev.sh -C engine node run-node.mjs 30 > /dev/null           # 30 AI rounds in Wasm; spike lines on stderr
./dev.sh -C engine node run-node.mjs selftest > /dev/null     # wait/notify self-test
./dev.sh -C engine gradle run --args=30                       # the same driver on the JVM
```

## Measurements

Measured on 2026-10-29: 16-thread desktop, Node 24.18 (V8) in Docker, JDK 21. Both runtimes use the same driver, and FreeCol's log output is discarded in both.

| | JVM (HotSpot 21) | Wasm GC (TeaVM 0.16, Node 24) |
|---|---|---|
| Wasm compile and instantiate | n/a | 110-180 ms |
| Spec loaded | 207 ms | 108-123 ms |
| New game ready (map 40x100, 12 players) | 583 ms | 351-456 ms |
| First AI round | 577 ms | 641-1057 ms |
| AI rounds 2-30: mean / median / p90 / max | 112 / 102 / 151 / 383 ms | 303 / 259 / 363 / 1337 ms |
| 30 rounds total | 3.8 s | 9.4 s |
| State at turn 31 | each AI has 1-2 colonies and 8-10 units | same |

One "round" means every AI European player and every native player takes a turn. These are early-game numbers. Late-game AI turns have not been measured.

| Download | raw | gzip -9 | brotli -11 |
|---|---|---|---|
| `engine.wasm` debug (names kept) | 13.12 MiB | 3.90 MiB | 2.19 MiB |
| `engine.wasm` `-Prelease` (obfuscated) | 10.65 MiB | 3.43 MiB | 1.86 MiB |
| `engine.wasm-runtime.js` | 0.04 MiB | 0.01 MiB | 0.01 MiB |
| Data passed in: rules, English strings, plural rules, two compatibility files | 0.73 MiB | 0.13 MiB | |

This is the server and AI only. The client Engine is not in this module yet.

## What it took

**15 FreeCol files are patched (161 changed lines).** Each one is a full copy in `engine/patches/` that replaces the upstream file at build time. Every changed line is marked `browser:`.

| File | Why |
|---|---|
| `FreeColXMLReader`, `FreeColXMLWriter` | Construct the Aalto StAX factories directly: `XMLInputFactory.newInstance()` needs `ClassLoader.loadClass`. Drop the `javax.xml.transform` pretty-printer. |
| `FreeColDataFile` | Read files in rule directories with `FileInputStream`: TeaVM cannot open `file:` URLs. |
| `Messages`, `Specification`, `Utils`, `HighScore` | `File.toPath()`/`Files.*` become `FileInputStream`/`FileOutputStream`. `Messages` also drops Swing `UIManager`. |
| `FreeColDirectories` | No POSIX permissions, no `toPath`. |
| `Utils` | Random-state save and restore use Java serialization, which TeaVM lacks. The state is no longer saved (**open issue for save/load**). Also adds a `getRGB` helper. |
| `HighScore` | `UUID(long,long)` and `UUID.compareTo` are missing. |
| `Nation`, `ChatMessage`, `SetColorMessage` | `Color.getRGB` is missing in TeaVM's `Color`. |
| `Player` | `Thread.dumpStack` is missing. |
| `FreeCol` | `Runtime.maxMemory` is missing. |
| `AudioMixerOption`, `SoundPlayer` | No `javax.sound`. The option keeps only the "automatic" choice. `SoundPlayer` just gets a cast. |

**Shims instead of patches** (`engine/src/main/java/online/freecol/shim`). JDK classes that TeaVM lacks are supplied as `T`-prefixed classes. A TeaVM `SubstitutionPolicy` maps them in, but only where TeaVM has no class of its own. The shims are `Rectangle`, `DisplayMode`, `HeadlessException`, `PropertyChangeSupport`/`Listener`/`Event`, `CountDownLatch`, `TimeoutException`, `CharConversionException`, `SAXException`, and loopback-only `InetAddress`, `Socket`, `ServerSocket` and `InetSocketAddress`. The socket shims let FreeCol's `Server` start without a network: its accept loop waits forever. No networking code is patched.

**Reflection** is declared in a TeaVM `ReflectionPolicy` (`FreeColReflectionPolicy`). It makes `FreeColObject` and `Message` subclasses findable by name, with their constructors plus the specific methods FreeCol calls by name:
- the seven methods the rules name (`method-name=` in `specification.xml`);
- `Scope`'s `getType`;
- get/set for the 17 fields sent as partial updates.

Making every public method reflectable dragged Swing and much more into the build, so the list is explicit. A method missing from it fails at run time with a logged `Invoke failed`, not at build time.

**Data** reaches the in-memory file system of TeaVM's Wasm GC target as `(path, text)` arguments to `main()`. The runner reads them from `freecol/data`.

## What broke along the way

1. **Missing exception classes named only in `catch` clauses** (`SAXException`, `UnknownHostException`) are not reported as missing. TeaVM emits an invalid `br_on_cast` for them, and V8 rejects the module. Fix: shim them. The remaining unreachable ones are in client and sound code.
2. TeaVM's `SimpleReflectionPolicy` helpers `extending()` and `inPackage()` throw a null pointer error inside TeaVM's own dependency analysis. The policy uses null-safe predicates of its own.
3. Where TeaVM's classlib has its own version of a class (`Color`, `Logger`), our shim is ignored. So `Color.getRGB` had to be patched at its call sites.
4. TeaVM's `Logger` prints every level to stdout and has no `setLevel`. Measurement runs discard stdout.
5. `-Paggressive` (TeaVM's `AGGRESSIVE` optimisation) produces a module that fails at run time with a negative timeout and a JS type error. The size gain comes from obfuscation anyway.
6. **`Object.wait` does not work** in TeaVM 0.16 Wasm GC. A thread that waits keeps the monitor and never wakes, with or without a timeout and with or without `notify`, while `Thread.sleep` works. Run `selftest` to see it. *Fixed since #11 by `FiberSuspendFix`; see "Why Object.wait hangs" below.* These open TeaVM PRs (all mergeable, filed 2026-10-10 to 12) fix related monitor bugs: [#1300](https://github.com/konsoletyper/teavm/pull/1300), [#1302](https://github.com/konsoletyper/teavm/pull/1302), [#1304](https://github.com/konsoletyper/teavm/pull/1304), [#1305](https://github.com/konsoletyper/teavm/pull/1305). The server and AI never wait on a monitor in this game. But a real client `Connection` does: `askMessage` waits in `NetworkReplyObject`. **Stage 2 hits this.**

## Not done (stage 2)

- Server Engine and AI in a Web Worker, client Engine on the main thread, joined by FreeCol messages over `postMessage`. This is blocked by item 6 above.
- Stub `WebGUI`, a Classic game started from the client, and a crude PixiJS map.
- Measurements in a real browser (Chrome and Firefox), including first load over the network.

## Building TeaVM from source

`spike/teavm/build-teavm.sh` builds TeaVM master plus the four monitor pull
requests (#1300, #1302, #1304, #1305) and publishes the build into
`.cache/teavm-repo`:

```sh
./dev.sh -C spike/teavm ./build-teavm.sh
```

## TeaVM master with the monitor PRs

Measured 2026-10-29 with a TeaVM built from source, master plus the four open
monitor pull requests, published into `.cache/teavm-repo` as version
`0.17.0-SNAPSHOT`. TeaVM master commit
`109cf91e74f0617fa779b9702377c16d7fc107a2`; the merged result in that run was
`3101c602ca7624ac4d9692fa3103f039e6029170`.
PR heads: #1300 `688bbff4d101bc6e056897c065e2047c8cabb1f5`, #1302
`02bc4296357472c91ede084d71869ca26acbc287`, #1304 `8035e487908ff15d298f6c19d43b5020160d5464`, #1305
`007eab3d6647999e481f94788addd4735163796a`.

Reproduce against the built TeaVM:

```sh
./dev.sh -C engine gradle generateWasmGC copyWasmGCRuntime -PteavmVersion=0.17.0-SNAPSHOT -PteavmRepo=/work/.cache/teavm-repo
./dev.sh -C engine node run-node.mjs selftest
./dev.sh -C engine node run-node.mjs 30
```

With that build:

- `node run-node.mjs selftest` ends at `[spike ~1500ms] selftest: done` and
  prints nothing from cases A, B and C — no `woke`, no `notified`. The waiting
  threads never wake, the notifiers never get the monitor. **TeaVM master with
  the monitor PRs still does not make `Object.wait`/`notify` work** in the
  Engine's Wasm GC build; tracker issue
  [#9](https://github.com/shivan2418/freecol-online/issues/9) stays open.
- `node run-node.mjs 30` with that build: game ready at ~393 ms, AI round mean
  317 ms (min 228, max 589), all 30 rounds finish, done at turn 31 (~9.9 s).

With TeaVM 0.16.0 (`./dev.sh -C engine gradle generateWasmGC
copyWasmGCRuntime -PteavmVersion=0.16.0`) — the same two commands:

- `selftest`: the same `[spike ~1500ms] selftest: done` and no case output.
- `30`: game ready at ~347 ms, AI round mean 267 ms (min 183, max 609), all 30
  rounds finish, done at turn 31 (~8.4 s).

To build against the locally published TeaVM, `engine/` takes
`-PteavmVersion=<version>` and `-PteavmRepo=<path>` (both default to TeaVM 0.16.0
from Maven Central when unset; the plugin comes from the `pluginManagement`
repository in `engine/settings.gradle`, the libraries from `-PteavmRepo`).

### Isolating the cause

Object.wait itself works under TeaVM 0.16.0 Wasm GC. A minimal project with
the same plugin settings, plus our shims and both policies, passes a timed wait
on the main thread and on a new thread (110 ms). So does
`online.freecol.probe.WaitProbe` (build with
`-Pmain=online.freecol.probe.WaitProbe`, run `node probe.mjs`) in this
project, as long as no FreeCol code is reachable (59 KB module). Once any of
these is reachable, the wait never returns, even though the code never runs:

| Made reachable from `WaitProbe.reach()` | module | wait |
|---|---|---|
| nothing | 0.06 MB | returns after 110 ms |
| `SpikeMain.main` | 13.8 MB | never returns |
| `new FreeColServer(...)` | 13.8 MB | never returns |
| spec loading only | 14.3 MB | never returns |
| one reflective constructor call | 13.7 MB | never returns |
| one `java.util.logging` call | 13.9 MB | never returns |
| one logging call, reflection policy off | 12.9 MB | never returns |

The same logging call in the minimal project gives a 94 KB module and a
working wait. So the trigger is something in the large FreeCol graph that
both logging and reflection pull in, not one FreeCol feature. The self-test
logs show the waiter takes the lock, calls wait, and never comes back, and
nothing throws. Not yet found: which class or method in that graph does it.

### Why Object.wait hangs

Found 2026-10-30 ([#11](https://github.com/shivan2418/freecol-online/issues/11)). It is a TeaVM bug in `Fiber.suspend`. No FreeCol class causes it. A large graph only makes it likely.

**The mechanism.** Wasm GC threads are coroutines. A method that may suspend is rewritten so that, after each call that may suspend, it checks "is the fiber suspending?". If so, it saves its locals and returns. `Fiber.suspend` (TeaVM 0.16 and master) does this:

```java
fiber.state = STATE_SUSPENDING;
pendingCall.callback = new AsyncCallbackImpl(pendingCall, javaThread, fiber);
call.run(pendingCall.callback);   // starts the async operation
```

For `Object.wait`, `call.run` is `waitImpl(timeout, nanos, callback)`. It queues the waiter, sets the timer and releases the monitor. But the fiber is already marked as suspending while that code runs. If `waitImpl` was itself rewritten as a coroutine, then its first call to a method that may suspend looks like a suspension when it returns. `waitImpl` saves its locals and returns at that point. The timer is never set and the monitor is never released, so the waiter never wakes and a notifier never gets the lock. With no timer pending, Node just exits.

**Why only large programs.** TeaVM decides which methods may suspend from the call graph. A virtual call that may reach any suspending override counts as suspending. In the FreeCol graph this spreads into the core classlib. `Throwable`'s constructors call `Class.getName`, which builds strings through virtual `StringBuilder.insert` calls, and FreeCol has `toString`s that take locks (e.g. `Connection.toString` via `getSocketName`). In the Engine's module, 5,772 of 17,615 functions may suspend, including every exception constructor. `waitImpl` calls `ArrayDeque.addLast`, which has a `new NullPointerException()` path, so `addLast` may suspend. That is where `waitImpl` stops. One logging call or one reflective call pulled in enough of the graph to close this loop. The small probe did not, and there `waitImpl` is a plain function.

It reproduces without FreeCol. Make an exception class whose `fillInStackTrace` sleeps reachable (never run it), and a timed wait on the main thread never returns, in a 40 KB module: `spike/teavm/wait-repro`.

```sh
./dev.sh -C spike/teavm/wait-repro gradle generateWasmGC copyWasmGCRuntime
./dev.sh -C spike/teavm/wait-repro node run.mjs   # prints only "node exiting"
```

**The fix.** Set the state after `call.run` returns:

```java
pendingCall.callback = new AsyncCallbackImpl(pendingCall, javaThread, fiber);
call.run(pendingCall.callback);
fiber.state = STATE_SUSPENDING;
```

A `complete()` called synchronously inside `call.run` still works: it sets `isPendingResume`, and `Fiber.start` resumes once the stack has unwound. `engine/src/main/java/online/freecol/shim/FiberSuspendFix.java` applies this to TeaVM 0.16 without a TeaVM build. It is a `TeaVMPlugin` with a `ClassHolderTransformer` that moves that one store in `Fiber.suspend`. If `Fiber.suspend` changes shape in a later TeaVM, the plugin fails the build rather than doing nothing. A copy of `Fiber` in our sources did not work: TeaVM loads its own.

With the fix, on TeaVM 0.16.0:

- `node probe.mjs` with `SpikeMain.main` reachable prints `main timed wait returned after 110ms`.
- `node run-node.mjs selftest`: all three cases work. A wakes on notify after 53 ms, C on notify after 52 ms, and B times out after 101 ms.
- `node run-node.mjs 30`: all 30 rounds finish at turn 31 (14.7 s, AI round mean 466 ms). Without the fix, on the same busy machine that day: 15.3 s, mean 486 ms. Both runs print a Node `TimeoutNegativeWarning` (-694967296 ms) that comes from somewhere else: `FreeCol.getTimeout(true)` is 3,600,000 s, and `TimedSession` hands `timeout * 1000` (3.6e9 ms, over 2^31) to `Timer.schedule`, which TeaVM narrows to an int. The timer fired after 1 ms and ended every native demand and diplomacy session at once. #44 sets the timeout to 2,000,000 s (`ServerEngine`).

`PostMessageConnection` and `Questions` wait on a monitor and are notified (#44). It works in the split Node run and in Chromium and Firefox, where `Questions.answer` is called from a JavaScript callback outside any fiber and wakes its waiter.

**Upstream.** Worth reporting to TeaVM: the bug is in TeaVM, `Fiber.suspend` is unchanged on master, the reproducer is 30 lines, and the fix is one moved line. Any `@Async` method whose `call.run` side calls a method that may suspend is hit the same way. `Thread.sleep`'s happens not to. The reproducer and this explanation are ready to file, but have not been filed.

# Toolchain spike, stage 2: the Engine split in the browser

Stage 2 of the spike ([#10](https://github.com/shivan2418/freecol-online/issues/10)) asked whether the full Engine split works in a browser. **It does**, in both Chromium and Firefox:

- The server Engine and the AI run in a Web Worker. The client Engine runs on the main thread.
- The two sides are joined only by FreeCol protocol XML over `postMessage`.
- A stub `WebGUI` starts a Classic single-player game from the client, and the AI plays round after round.
- PixiJS draws the client's view of the map crudely, one square per tile.

The human seat still only ends its turn, as in stage 1. (Since [#15](https://github.com/shivan2418/freecol-online/issues/15) the human plays its own turns; see the root README.)

## Run it

```sh
# JVM tests: the channel, and a whole split game with no TeaVM
./dev.sh -C engine gradle test

# The two modules (add -Prelease for obfuscated, size-measured builds)
./dev.sh -C engine gradle generateWasmGC copyWasmGCRuntime -Pmain=online.freecol.web.WorkerMain -Pout=server
./dev.sh -C engine gradle generateWasmGC copyWasmGCRuntime -Pmain=online.freecol.web.ClientMain -Pout=client

# The split in Node: server in a worker thread, client on the main thread
./dev.sh -C engine node run-split-node.mjs 10 > /dev/null

# The page: assemble spike/web/dist, then measure in browsers (docker/web.Dockerfile)
./dev.sh spike/web/build.sh                     # ./dev.sh env FAKE=1 ... uses fake modules
DEV_VARIANT=web ./dev.sh -C spike/web env MBPS=50 node bare-run.mjs chromium 10   # or firefox
DEV_VARIANT=web ./dev.sh -C spike/web node harness.mjs --rounds 10 --encodings br > out.json
```

- **`bare-run.mjs`** launches the browser binary with no DevTools protocol attached. The page POSTs its result back to the server. `MBPS` paces all responses over one simulated link (bandwidth only, no latency), and `ENCODING` picks identity, gzip or br (the default is br).
- **`harness.mjs`** drives Playwright. It reports transfer sizes and message traffic, but its timings are not used: with Playwright attached, Chromium's AI rounds ran about 2x slower than in a bare browser.

## Measurements

Measured 2026-10-29 on the same 16-thread desktop as stage 1:

- **Builds:** release (`-Prelease`), TeaVM 0.16.0.
- **Browsers:** headless Chromium 141 and Firefox 142 (Playwright's builds, in Docker). These are not branded desktop Chrome.
- **Serving:** brotli, a cold cache, 10 rounds per run.
- **Runs:** 4 per browser and link speed. Medians are shown.

**Download size per module**

| File | raw | gzip -9 | brotli -11 |
|---|---|---|---|
| `server.wasm` (server Engine and AI, Worker) | 12.02 MiB | 3.78 MiB | 2.03 MiB |
| `client.wasm` (client Engine, main thread) | 6.24 MiB | 1.95 MiB | 1.08 MiB |
| `*.wasm-runtime.js` (each) | 0.02 MiB | 0.01 MiB | 0.01 MiB |
| `data.json` (rules, strings, client options) | 0.78 MiB | 0.13 MiB | 0.10 MiB |
| `pixi.min.js` (PixiJS 8.14.0) | 0.68 MiB | 0.19 MiB | 0.15 MiB |
| **Transferred on first load (brotli)** | | | **3.4 MiB** |

- The page and the Worker each fetch `data.json`, so it is transferred twice.
- `server.wasm` is 13% larger than stage 1's 10.65 MiB. The likely cause is the message reader table (see below), which makes every message's constructor reachable.

**Time until a new game is ready**

Times are in ms from navigation start. They include loading the page and PixiJS.

| | Chromium | | | Firefox | | |
|---|---|---|---|---|---|---|
| link | local | 50 Mbps | 10 Mbps | local | 50 Mbps | 10 Mbps |
| client module loaded (fetch + compile) | 131 | 256 | 970 | 1173 | 1084 | 1153 |
| server module loaded in the Worker | 164 | 422 | 1784 | 1832 | 1650 | 2946 |
| client Engine ready | 498 | 626 | 1607 | 1882 | 1910 | 1970 |
| server game created | 688 | 1118 | 3467 | 2544 | 2582 | 3822 |
| **game started (map on screen)** | **1562** | **1983** | **4380** | **3626** | **3575** | **4672** |

Firefox spends more than 1 s compiling each module even on a local link. This cost dominates its load time; the download hardly matters until the link drops to 10 Mbps.

**Early-game AI turn time**

One round runs from our end of turn to our next turn: every AI European player and every native player takes a turn.

| | Chromium | Firefox | Node 24 (`run-split-node.mjs`) |
|---|---|---|---|
| first round | 1873 ms | 4462 ms | 480-730 ms |
| rounds 2-10, median | 596 ms | 1898 ms | ~320 ms |
| rounds 2-10, p90 / max | 902 / 2035 ms | 2458 / 3280 ms | 372 / 420 ms |

Stage 1 measured about 300 ms per round for the server and AI alone in Node, so the split itself costs little in Node. Chromium is about 2x Node and Firefox about 6x. The cause is not known yet:

- **Not timer clamping.** Routing TeaVM's `setTimeout(fn, 0)` thread switches through an unclamped `MessageChannel` made no measurable difference.
- **Not map drawing.** Drawing takes about 10 ms per round.

**Message volume over `postMessage`**

Sizes are UTF-8 bytes of the protocol XML.

| | to server | to client |
|---|---|---|
| setup (login, game, launch) | 4 messages, 0.2 KiB | 5 messages, 760 KiB |
| each early-game round | 14-16 messages, 0.5 KiB | 14-16 messages, 3.2-4.5 KiB |

Almost all of the 760 KiB is the login reply, which carries the whole game including its specification.

## What it took

**The channel** is `PostMessageConnection`, a `Connection` subclass used on both sides (`engine/src/main/java/online/freecol/web/`):

- **Message format.** Each message crosses as one string of the XML a socket would carry, so a WebSocket can replace the Worker later.
- **No `Object.wait`.** It replaces `ReceivingThread` and `NetworkReplyObject`, so nothing calls the broken `Object.wait`: a thread waiting for a reply polls with `Thread.sleep(1)`.
- **Ordering.** Messages are read in arrival order, and each one is handled on its own thread, as FreeCol does.

The other classes in that package:

- `ServerEngine` and `ClientEngine` set up each side.
- `WorkerMain` and `ClientMain` are the TeaVM entry points. They use JSO exports and `@JSBody` calls.
- `WebGUI` was a stub at stage 2. Since #14 it passes FreeCol's show calls to the Browser UI as events and its dialogs as questions it waits on (its class comment lists each method).

**Starting a game is a control message, not protocol.** The page posts `{k:'start'}` to the Worker, which creates the `FreeColServer`, the way upstream's `ConnectController` would in process. After that the client logs in and launches over the protocol.

**7 more FreeCol files are patched at stage 2 (20 in total), and `GUI` since (21).** Each changed line is marked `browser:`; comment blocks are marked on their first line.

| File | Why |
|---|---|
| `FreeColClient` | A browser constructor: the GUI comes from a factory. There is no Swing GUI, `ActionManager`, sound or `ResourceManager`. The action calls are null-guarded. |
| `UserServerAPI` | A connection factory, so the client connects through `PostMessageConnection` instead of a socket. |
| `Message` | `read` tries a table of readers by tag before reflection (see 2 below). |
| `InGameController` | The first-landing panel is cut, a Swing `FreeColPanel`, and with it the build-colony tutorial message. Client saving fails: it called `saveGame` on the in-process server, which reaches `ImageIO` and `File.toPath`. Saving belongs to the Worker now and is not ported. |
| `FreeColDebugger` | No save at the end of a debug run, for the same reason. |
| `FreeCol` (extended) | `quit` no longer calls `System.exit`. `fatal` no longer calls `Thread.dumpStack`. |
| `GUI` (#14) | Dialog icons come from a `dialogIcon` hook instead of the `ImageLibrary`, which the WebGUI does not have. Its override carries the game object, so a question can name it. |
| `FreeColXMLReader` (extended) | The `File` constructor no longer uses `toPath`. Every reader shares one Aalto factory (see 4 below). |

**New shims:**

- `SwingUtilities`: `invokeLater` runs tasks in order on a thread of our own.
- `ImageIcon` and `Collator` (which sorts colony names case-insensitively).
- `FreeColPanel`. This one is a stub of a FreeCol class, not of the JDK. It is the exception to the shim rule: Wasm GC function types need a method's return class even when the method only ever returns null, and many `GUI` methods return this Swing `JPanel`.

## What broke and how it was patched

1. **`Object.wait` never returns.** This is stage 1's open issue. The channel avoids it (see above), so no FreeCol networking class needed a patch.
2. **`Class.forName` does not find the message classes,** although the reflection policy selects them, so `Message.read` failed on every message. Model classes such as `TileType` are found, and selecting the message classes by name did not help either. The root cause was not found.

   The workaround is `MessageReaders`: a generated table of 103 tags, each mapped to that message's `(Game, FreeColXMLReader)` constructor, which the patched `Message.read` tries first. The JVM tests use the same table.
3. **Swing, sound and image I/O were reachable from client code.** `SoundController` reached `SoundPlayer` and `javax.sound`. `saveGame` reached `ImageIO`. `GUI` methods have `FreeColPanel` and `ImageIcon` in their signatures. All of these were cut or shimmed (see the table above).
4. **Firefox failed intermittently with `TypeError: bad type`** in about 4 of 10 runs. The crash is in TeaVM's own `StringInternPool.query`:
   - The pool holds interned strings by weak reference.
   - Aalto interns XML names, and FreeCol made a new factory, with its own symbol table, for every reader.
   - Once a symbol table was dropped, the GC cleared its names, and the pool read a cleared entry before its finalizer removed it.

   Sharing one factory keeps the names alive. Afterwards 27 of 27 Firefox runs finished. This TeaVM bug is worth reporting upstream; a pool shim was not possible, because TeaVM's compiler refers to the pool's internals.
5. **The base `GUI` silently drops `invokeNowOrLater` and `invokeNowOrWait`.** `WebGUI` runs them at once.
6. **Firefox headless has no WebGL,** and PixiJS 8 has no canvas renderer, so in Firefox the page falls back to Canvas 2D. Every result records which renderer it used.

## Open

- **Why rounds take 2-6x longer in browsers than in Node.**
- **Firefox's module compile time:** more than 1 s per module.
- **The `Class.forName` gap:** a TeaVM issue, or our policy?
- **Branded desktop Chrome and Firefox** with a visible window and a GPU, rather than headless.
