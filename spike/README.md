# Toolchain spike, stage 1: the Engine headless under TeaVM

Stage 1 of [Toolchain spike on real FreeCol code](https://github.com/shivan2418/freecol-online/issues/7): FreeCol's own server, AI and model, compiled by TeaVM 0.16.0 to Wasm GC, play a Classic single-player game in Node. The human seat is a stub that ends its turn immediately, so only the AI plays. The Worker channel, client Engine, `WebGUI` and PixiJS map are stage 2.

## Run it

Everything runs in the dev container (`docker/dev.Dockerfile`, via `../dev.sh`). FreeCol's source and data come from the upstream clone at `../freecol`.

```sh
./dev.sh -C spike/engine gradle generateWasmGC copyWasmGCRuntime   # debug build (add -Prelease for obfuscated)
./dev.sh -C spike/engine node run-node.mjs 30 > /dev/null           # 30 AI rounds in Wasm; spike lines on stderr
./dev.sh -C spike/engine node run-node.mjs selftest > /dev/null     # wait/notify self-test
./dev.sh -C spike/engine gradle run --args=30                       # the same driver on the JVM
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
6. **`Object.wait` does not work** in TeaVM 0.16 Wasm GC. A thread that waits keeps the monitor and never wakes, with or without a timeout and with or without `notify`, while `Thread.sleep` works. Run `selftest` to see it. These open TeaVM PRs (all mergeable, filed 2026-10-10 to 12) fix related monitor bugs: [#1300](https://github.com/konsoletyper/teavm/pull/1300), [#1302](https://github.com/konsoletyper/teavm/pull/1302), [#1304](https://github.com/konsoletyper/teavm/pull/1304), [#1305](https://github.com/konsoletyper/teavm/pull/1305). The server and AI never wait on a monitor in this game. But a real client `Connection` does: `askMessage` waits in `NetworkReplyObject`. **Stage 2 hits this.**

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
./dev.sh -C spike/engine gradle generateWasmGC copyWasmGCRuntime -PteavmVersion=0.17.0-SNAPSHOT -PteavmRepo=/work/.cache/teavm-repo
./dev.sh -C spike/engine node run-node.mjs selftest
./dev.sh -C spike/engine node run-node.mjs 30
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

With TeaVM 0.16.0 (`./dev.sh -C spike/engine gradle generateWasmGC
copyWasmGCRuntime -PteavmVersion=0.16.0`) — the same two commands:

- `selftest`: the same `[spike ~1500ms] selftest: done` and no case output.
- `30`: game ready at ~347 ms, AI round mean 267 ms (min 183, max 609), all 30
  rounds finish, done at turn 31 (~8.4 s).

To build against the locally published TeaVM, `spike/engine` takes
`-PteavmVersion=<version>` and `-PteavmRepo=<path>` (both default to TeaVM 0.16.0
from Maven Central when unset; the plugin comes from the `pluginManagement`
repository in `spike/engine/settings.gradle`, the libraries from `-PteavmRepo`).

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
