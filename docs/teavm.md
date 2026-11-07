# TeaVM: quirks and workarounds

The Engine is FreeCol's Java code compiled by TeaVM 0.16.0 to Wasm GC
(`engine/gradle.properties` pins the version). This note is what to know when
the Engine fails to build or behaves differently from the JVM: how FreeCol
was made to compile, the TeaVM bugs we hit, and how each is worked around.

It replaces the toolchain spike's notes (issues
[#7](https://github.com/shivan2418/browsercol/issues/7) and
[#10](https://github.com/shivan2418/browsercol/issues/10)). Their
measurements of load time, download size and AI turn time from October 2026
are in git history, in `spike/README.md` before its removal.

## How FreeCol is made to compile

- **Patches.** A FreeCol file TeaVM can't take as it is gets a full copy in
  `engine/patches/`, which replaces the upstream file at build time. Every
  changed line is marked. `engine/patches/README.md` lists each file and why.
  Typical reasons: `File.toPath()`/`Files.*`, Java serialization,
  `javax.sound`, Swing, `ClassLoader.loadClass`, and JDK methods TeaVM's
  classlib lacks, such as `Color.getRGB`, `Thread.dumpStack` and
  `Runtime.maxMemory`.
- **Shims.** JDK classes TeaVM lacks are supplied as `T`-prefixed classes in
  `engine/src/main/java/browsercol/shim/`. `ShimSubstitutionPolicy` maps them
  in, but only where TeaVM has no class of its own. Shimmed: `java.awt`
  (`Rectangle`, `DisplayMode`, `HeadlessException`), `java.beans`
  (`PropertyChange*`), `java.net` (loopback-only sockets, so FreeCol's
  `Server` starts with no network), `Collator`, `CountDownLatch`,
  `TimeoutException`, and others. `FreeColPanel` is the one shim of a FreeCol
  class, not a JDK one: Wasm GC function types need a method's return class
  even when it only ever returns null, and many `GUI` methods return this
  Swing panel.
- **Reflection.** `FreeColReflectionPolicy` makes `FreeColObject` and
  `Message` subclasses findable by name, with their constructors and the
  methods FreeCol calls by name. Those are the methods named by
  `method-name=` in the rules, `Scope.getType`, and the getters and setters
  of the fields sent as partial updates. The list is explicit, because
  making every public method reflectable drags Swing into the build. A
  method missing from the list fails at run time with a logged
  `Invoke failed`, not at build time.
- **Data** reaches TeaVM's in-memory file system as `(path, text)` arguments
  to `main()`.

## Object.wait

**Symptom.** In a large program, a thread that calls `Object.wait` never
returns, and a notifier never gets the monitor. This happens with or without
a timeout. With no timer pending, Node just exits. `Thread.sleep` works.

**Cause** ([#11](https://github.com/shivan2418/browsercol/issues/11)): a
TeaVM bug in `Fiber.suspend`, still present on TeaVM master. Wasm GC threads
are coroutines: a method that may suspend checks after each call that may
suspend whether the fiber is suspending, and if so saves its locals and
returns. `Fiber.suspend` marks the fiber as suspending *before* it runs the
async operation:

```java
fiber.state = STATE_SUSPENDING;
pendingCall.callback = new AsyncCallbackImpl(pendingCall, javaThread, fiber);
call.run(pendingCall.callback);   // for wait: queue the waiter, set the timer, release the monitor
```

If `waitImpl` itself was compiled as a coroutine, its first call to a method
that may suspend looks like a suspension when it returns. It then stops
there, before setting the timer or releasing the monitor.

**Why only large programs.** TeaVM decides which methods may suspend from the
call graph, and a virtual call that may reach any suspending override counts.
In FreeCol's graph this spreads into the core classlib. A third of the
Engine's functions may suspend, including every exception constructor.
`waitImpl` calls `ArrayDeque.addLast`, which has a `new
NullPointerException()` path, so `addLast` may suspend. One logging call or
one reflective call pulls in enough of FreeCol to close this loop.

**Fix.** `engine/src/main/java/browsercol/shim/FiberSuspendFix.java` is a
`TeaVMPlugin` whose `ClassHolderTransformer` moves the state store after
`call.run`. A `complete()` called synchronously inside `call.run` still
works: it sets `isPendingResume`, and `Fiber.start` resumes once the stack
has unwound. If `Fiber.suspend` changes shape in a later TeaVM, the plugin
fails the build rather than silently doing nothing. A copy of `Fiber` in our
sources does not work, because TeaVM loads its own.

**Tools:**
- `tools/teavm/wait-repro/` reproduces the hang without FreeCol, in a 40 KB
  module: an exception class whose `fillInStackTrace` sleeps is made
  reachable but never run.

  ```sh
  ./dev.sh -C tools/teavm/wait-repro gradle generateWasmGC copyWasmGCRuntime
  ./dev.sh -C tools/teavm/wait-repro node run.mjs   # without the fix it prints only "node exiting"
  ```
- `browsercol.probe.WaitProbe` makes parts of FreeCol reachable and times a
  wait. Build it with `-Pmain=browsercol.probe.WaitProbe` and run
  `node probe.mjs` in `engine/`.
- `node run-node.mjs selftest` in `engine/` runs three wait/notify cases.

**Upstream.** Not yet reported to TeaVM. The reproducer is 30 lines and the
fix moves one line. Any `@Async` method whose `call.run` side calls a method
that may suspend is hit the same way. Four open TeaVM monitor pull requests
([#1300](https://github.com/konsoletyper/teavm/pull/1300),
[#1302](https://github.com/konsoletyper/teavm/pull/1302),
[#1304](https://github.com/konsoletyper/teavm/pull/1304),
[#1305](https://github.com/konsoletyper/teavm/pull/1305)) do **not** fix it.

## Other TeaVM bugs and limits

1. **`Class.forName` doesn't find the message classes**, although the
   reflection policy selects them. Model classes such as `TileType` are
   found. The root cause is not known. `MessageReaders` is a generated
   table mapping each message tag to its `(Game, FreeColXMLReader)`
   constructor, and the patched `Message.read` tries it before reflection.
   The JVM tests use the same table.
2. **Firefox `TypeError: bad type` in `StringInternPool.query`.** The pool
   holds interned strings by weak reference. Aalto interns XML names, and
   FreeCol made a new factory, with its own symbol table, for every reader.
   Once a table was dropped, the pool could read a cleared entry before its
   finalizer removed it. The fix: every reader shares one Aalto factory
   (patched `FreeColXMLReader`), which keeps the names alive. A pool shim
   isn't possible, because TeaVM's compiler refers to the pool's internals.
   Worth reporting upstream.
3. **An array of an interface type is an `Object[]`.** The checkcast of
   `list.toArray(new SomeInterface[0])` fails with a `ClassCastException`.
   `Market`'s transaction listeners are taken as a list instead (patched
   `Market`, `MarketWas`, #64). `TPropertyChangeSupport` makes one too and
   has not failed so far.
4. **Exception classes named only in `catch` clauses** aren't reported as
   missing. TeaVM emits an invalid `br_on_cast` for them, and V8 rejects the
   module. Shim them.
5. **Where TeaVM's classlib has its own version of a class** (`Color`,
   `Logger`), our shim is ignored. Patch the call sites instead.
6. **`SimpleReflectionPolicy`'s `extending()` and `inPackage()`** throw a
   null pointer error inside TeaVM's dependency analysis.
   `FreeColReflectionPolicy` uses null-safe predicates of its own.
7. **TeaVM's `Logger`** prints every level to stdout and has no `setLevel`.
8. **`Timer.schedule` narrows its delay to an int.** FreeCol's session
   timeout of 3,600,000 s overflowed, fired after 1 ms, and ended every
   native demand and diplomacy session at once. `ServerEngine` sets it to
   2,000,000 s (#44).
9. **`-Paggressive`** (TeaVM's `AGGRESSIVE` optimisation) produces a module
   that fails at run time. `-Prelease` (obfuscation) gives the size gain
   anyway.
10. **`Collectors.minBy`/`maxBy` throw on a null result.** TeaVM 0.16's
    `Reducer.getOpt` is `Optional.of(value)`, and the JDK's gives an empty
    Optional for null, so `.orElse(null)` returns null. FreeCol's
    `CollectionUtils.minimize` and `maximize` ended in `.collect(minBy(...))
    .orElse(null)`, and `Unit.getClosestColony` puts a null placeholder in
    its stream, which wins when no colony is near. A ship battle then threw
    a `NullPointerException` in `getRepairLocation` (#352) whenever the
    loser's player had no colony that repairs ships: "handling attack
    failed" and the error banner, on a win, a loss or a ship that evades.
    `browsercol.shim.OptionalReducerFix` (a TeaVM plugin, like `FiberSuspendFix`) turns the `Optional.of` in `Reducer.getOpt` into `ofNullable`; FreeCol's code is untouched (no patch). The stack was
    unreadable (`Throwable$FakeClass.fakeMethod` with offsets that do not
    match the name section), so it was found by putting a step marker in
    the server's `csCombat` and reading it in the "failed" event. Not yet
    reported to TeaVM.

FreeCol's own behaviour that the browser needed changed:
- The base `GUI` silently drops `invokeNowOrLater` and `invokeNowOrWait`, so
  `WebGUI` runs them at once.
- `FreeColClient` and `UserServerAPI` take a GUI factory and a connection
  factory. The client then connects through `PostMessageConnection`, which
  carries the XML a socket would, so a WebSocket can replace the Worker
  later.

## Building TeaVM from source

`tools/teavm/build-teavm.sh` builds TeaVM master plus the four monitor pull
requests and publishes the result into `.cache/teavm-repo` as
`0.17.0-SNAPSHOT`. The Engine builds against it with `-PteavmVersion` and
`-PteavmRepo`:

```sh
./dev.sh -C tools/teavm ./build-teavm.sh
./dev.sh -C engine gradle modules -PteavmVersion=0.17.0-SNAPSHOT -PteavmRepo=/work/.cache/teavm-repo
```

Add `--dependency-verification lenient`: the snapshot isn't in
`engine/gradle/verification-metadata.xml`. Without the two properties, the
build uses the version in `engine/gradle.properties`, from Maven Central. The Gradle
plugin comes from the `pluginManagement` repository in
`engine/settings.gradle`, and the libraries from `-PteavmRepo`.

## Firefox in a big empire (#353)

**Symptom** (#349's `big-empire` scenario, 30 colonies): in Firefox a save
never finished and reports took 10-57 s; Chromium saved in 0.2 s.

**Not a hang, and not the save.** A Firefox Profiler capture of the run
(`MOZ_PROFILER_STARTUP=1` with `MOZ_PROFILER_SHUTDOWN=file`, which samples
the Wasm functions of the page and the Worker in Playwright's Firefox) showed
the Worker busy for 0.5 s on the save (XML, deflate and `readAll`), then idle,
and the save in IndexedDB. The page's main thread was 100% busy for the
minutes after, so it never got to the Worker's "saved" message (nor to a
report or a click, which queue behind the same backlog).

**Where the main thread's time went.** A preset's setup is hundreds of debug
actions. The server answers them all at once, and for each the client ran
`debugApplied` and then built the whole map as JSON, sent it to the page
and had the page draw it. In Firefox that was 44% in `MapJson.of` and 33% in
the Canvas 2D map's `show`; in Chromium the same is quick. Within the draw,
setting `ctx.filter` for every tile took half (Firefox parses the filter
string on each set), and the Canvas 2D pen redrew every image of the whole
map each frame, on screen or not. The Canvas 2D pen is what Firefox uses
without WebGL, as in the Playwright image.

**Fixes.** `ClientMain.mapSoon` sends the map after a debug action no sooner
than three times what the last one cost, with the game as it is then.
`canvasPen` draws a dimmed picture from a copy made once, leaves out images
off the screen, and does not draw a frame that shows what the last one did.

Big empire, Firefox, with another full suite running on the machine, so read
the shares rather than the seconds: save never finished, now 1.5 s (0.2 s
in the page script alone); colony panel 2.6 s to 0.23 s; Europe 1.5 s to
0.84 s; reports 10-57 s to 1-9 s. Chromium is unchanged (save 0.2 s).
Production and Trade reports were still 8 s in Firefox in the scenario while
0.8 s alone, and the AI rounds there are not checked: both are open.

**The 8 s was not the reports (second pass).** The scenario declared the setup
done when the fleet, the preset's last block, was on the map. The page was
not done: the server's updates (30 colonies' XML, `Colony::readChildren` is
13% of the page's busy time) and the maps they cause keep coming for a few
more seconds, and Playwright's click on the Report menu waits behind them
(the "act" part of a report's time was 1.2 s of 1.4 s; the dialog itself
opened in 0.1 s). With the page left alone for 40 s, Firefox opens the
Production report in 0.13 s, Trade in 0.15 s and the Colony report in 0.4 s.
`Run.quiet` in `ui/scripts/scenarios.ts` now waits for 3 s without a map
before the panels are timed. Big empire, Firefox, the reports (Colony,
Military, Naval, Production, Trade) and the save, before: 1.4, 1.0, 1.2, 7.1,
5.0 s, save 1.3 s; after: 0.5-1.0, 0.2-0.4, 0.2-0.4, 0.5, 0.6 s, save 0.2-0.3 s.

**Where the page's time goes in the setup** (Firefox Profiler, 24 s, page
main thread busy 47%): drawing the Canvas 2D map on each frame 27%, handling
the server's updates 17%, `sendDebugMap` (`MapJson.of`, JSON, the event) 8%.
`MapJson.of` costs about 10 ms for the 40x80 map (55 KB) in Firefox, so the
throttle keeps it at a quarter of the time at most; a played turn sends a map
per event, a few hundred per turn.

**Profiling Firefox.** `MOZ_PROFILER_STARTUP=1 MOZ_PROFILER_STARTUP_INTERVAL=2
MOZ_PROFILER_SHUTDOWN=/work/.cache/p.json` through `./dev.sh env ...` writes
a profile at exit that holds the page's process and the Worker only when a
script ends the browser itself (a long scenario run got only the parent and
an extension process). Wasm frames show as `wasm-function[N]`: the name
section of `dist/assets/*.wasm` has the names, by function index.

**The slow setup: the script's screenshot, not the game (third pass).** In
about half the Firefox runs of `scenarios` the preset's setup took 40-214 s
instead of 10 s (six runs: 20, 138, 21, 79, 214, 77 s). Found by timing the
Worker: `ServerEngine.setup` runs the preset's actions one after the other,
and a temporary `System.out` line per action showed them taking 0-2 ms each,
then, from some action on, a steady 370 ms each (multiples of it, 740, 1100).
The Worker was idle (Firefox Profiler: `WorkerPrivate::WaitForWorkerEvents`
in 99% of its samples, GC 1 s of 40) because each action's update to the
client is a *question* (`PostMessageConnection.askMessage`, 1,900 "update"
questions in a setup) and the server waits for the client's reply. The page's
main thread was the slow side: in the same profile 65% of it was Minor GC
(3,177 nursery collections) and 30% was Playwright's `_toDebugger`
(`chrome://juggler/content/content/Runtime.js`), which converts a value
Playwright hands to the page.

The value is the return of the `__shot` function `answerDialogs` exposes to
the page (`ui/scripts/dialogs.ts`): the scenario script's `dialogShots`
returns `page.screenshot(...)`, a Buffer, and Playwright sends an exposed
function's result back to the page as JSON, a Buffer as an array of its bytes
(hundreds of thousands of numbers). Firefox's page spends seconds to minutes
allocating and tearing that down, with the page's events (the Engine's
replies) queued behind it. It happens when a dialog (the `messages` one, which
the preset's actions raise) opens while the setup runs and the script shoots
it (three shots a kind), so it comes and goes with timing, and only in the
scenario script (the other scripts pass no shot function, nor does a probe
that did the same steps). Chromium takes the array in far faster.

**Fix.** `answerDialogs` exposes a wrapper that awaits the shot and returns
nothing. Big empire, Firefox, the setup (thirty colonies on the map), before:
20, 138, 21, 79, 214, 77 s; after, five runs of the setup alone 8.5-10.8 s,
and three full scenario runs 9.9, 9.9, 10.1 s (setup quiet at 16 s). Chromium
6.6 s. The late-game timeouts of #366 (no dialog open / `waitForFunction`
120 s after turn 174, Firefox only) are very likely the same stall: a dialog
shot at a moment the page has a lot to take in. Not rerun on the late-game
fixtures.

**The terrain animation in Canvas 2D (fourth pass).** With the terrain
animation on, `animateBase` redraws the animated base tiles every tick
(125 ms), and the Canvas 2D pen, unlike Pixi's, had no `repicture()`: each
tick recorded all 3,200 tiles' draw calls again. Measured with
`performance.measure` entries (`map: base, painted`, `map: base,
repictured`, `map: show`) in a probe copy of `scenarios.ts`, Firefox, 40x80
big empire, the machine shared with other runs, so the numbers drift 30%
between runs: a base frame cost 19-23 ms (mean; max 88) and now costs 8-13 ms
(the rest is `animatedBase` walking the scene), `show` 3-4 ms on average; a
played turn in the scenario took 17-25 s of wall time and now 10-20 s; the
page's `requestAnimationFrame` gaps had p95 114-127 ms and now 87-109 ms. The
370 ms frame of the first profile was the page under the setup's backlog (the
screenshot stall above), not a frame at rest. On the desktop late game
(`desktop-late-game`, Firefox) a base frame costs 8-10 ms and the gaps are
p95 20 ms: it was never starved. The pen now keeps each image's picture in a
holder and `repicture` swaps it, and a frame sets when the next may start,
three times its own cost on (`baseNext`), so a map the machine cannot keep up
with animates more slowly instead of starving the page. Pixi's pen is
unchanged, and at its cost (a few ms) the throttle does not engage. Still
open: the scene walk (`animatedBase`, 8-10 ms) could be cached per map.

**How it was found.** The Worker was not the slow side, so the Worker's
profile only showed it waiting. Bisecting the script: a probe that did the
same steps was fast, the scenario script slow; removing `answerDialogs` made
it fast, keeping it without the shot function too, and an exposed function
alone too: only a shot function that returned the screenshot was slow.

## Firefox AI rounds against Chromium (#353)

`ai-late-game` (the AI's round-300 save), mean AI round over the first four
played turns, 1280x800, the machine shared: Chromium 11.9 s (15.9, 10.9, 9.1,
11.7), Firefox 25.1 s (30.5, 27.4, 22.7, 20.0) and 30.3 s in a second run: 2-2.5x.
The page's main thread is not the limit (`requestAnimationFrame` p95 21 ms in
Firefox during the rounds).

A Firefox Profiler capture of the server Worker over three rounds (the method
above; 22,500 samples at 5 ms, function names from the server module's name
section): the Worker is 94% in `Thread::run` under `AIPlayer` handlers, and
**none of it is our code**: 0% of the self samples are in `browsercol.*`,
`ui/src/worker.ts` or the channel; `PostMessageConnection` and XML (aalto,
jzlib) are under 1.5% together. By inclusive time: `EuropeanAIPlayer::
startWorking` 77%, `Map::searchMap` 64% (`Unit::findPath` 63%, from
`TransportMission::doMission` 37% and `checkCargoes` 22%), the
`Map$MoveCandidate` constructor 32%, `FreeColObject::getAbilities` /
`FeatureContainer::getAbilities` 26% (a `HashMap` walk, a `Stream` over a
`SpliteratorOverCollection`, TeaVM's `synchronized`: `Object::monitorEnter`,
`monitorExit` and `isEmptyMonitor` are 5.8% of the self time). By self time
by kind: FreeCol 32%, TeaVM's classlib 29% (streams, `HashMap`), its monitors
6%, and 31% in frames Firefox shows only as machine addresses (the Wasm
engine's own stubs under `getAbilities`, `Logger::log`, `searchMap`,
`Cargo::newCargo`: allocation and casts of Wasm GC objects).

So the slowdown is FreeCol's own pathfinding and feature lookups running on
Firefox's Wasm GC code, with TeaVM's streams and monitors in the path: not
something `browsercol.web` or the Worker glue can fix, and FreeCol's Java is
off limits for 1.0. Leads for after 1.0, in order of likely gain: a cache or
a plain loop in `FeatureContainer.getAbilities` (it is 26% of the Worker,
and builds a stream and takes a monitor per call), `Map.searchMap`'s
`MoveCandidate` allocation, and a TeaVM that drops the monitors of a
single-threaded program. A Chromium profile of the same rounds was not taken,
so which of these Firefox runs slower than V8 is not measured.

## Open questions

- AI rounds took about 2x longer in Chromium and 6x longer in Firefox than
  in Node (October 2026). It is not timer clamping and not map drawing.
  See the next section for Firefox against Chromium.
- Firefox spends more than 1 s compiling each module, which dominates its
  load time on a fast link.
- The `Class.forName` gap above: a TeaVM bug, or our policy?
