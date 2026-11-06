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

Both properties default to TeaVM 0.16.0 from Maven Central. The Gradle
plugin comes from the `pluginManagement` repository in
`engine/settings.gradle`, and the libraries from `-PteavmRepo`.

## Open questions

- AI rounds took about 2x longer in Chromium and 6x longer in Firefox than
  in Node (October 2026). It is not timer clamping and not map drawing.
- Firefox spends more than 1 s compiling each module, which dominates its
  load time on a fast link.
- The `Class.forName` gap above: a TeaVM bug, or our policy?
