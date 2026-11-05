# Which Java-to-JS/Wasm compiler can run FreeCol's model, server and AI headless?

Ticket: shivan2418/browsercol#4. Researched 2026-10-24. Inputs: `docs/research/freecol-jvm-needs.md` (branch `research/freecol-jvm-needs`) and FreeCol source at `freecol/src`.

## Verdict

| Rank | Option | Role | One-line reason |
|---|---|---|---|
| 1 | **TeaVM 0.16.0, Wasm GC backend (JS backend as switch-over)** | Pick | Bytecode-based, real green threads with wait/notify, name-based reflection, java.awt Color/Dimension/Point already shipped, Gradle/Maven. Gap: no StAX. |
| 2 | **CheerpJ 4.x** | Fallback | Runs the JDK unmodified (StAX, threads, reflection for free), near-zero patching. Cost: CDN-hosted runtime, big download, slower startup. |
| 3 | GraalVM Web Image (`--tool:svm-wasm`) | Watch | Full JDK class library and reflection metadata model, but "early and experimental", new in 25.1 (mid-2026), threads/reflection status undocumented. |
| 4 | J2CL (Wasm) | Reject | No `java.lang.reflect`, no `Class.forName`, Bazel only, source-based. |
| 5 | JWebAssembly | Reject | No reflection, no threads, no real GC. Maintenance unclear. |

## Needs vs. options

Needs come from the JVM-needs doc. FreeCol import counts below are my own grep of `common/` + `server/`.

| Need | TeaVM (Wasm GC / JS) | J2CL | GraalVM Web Image | CheerpJ |
|---|---|---|---|---|
| Java 11 bytecode / language | Bytecode input; 0.15 requires Java 17 to *build TeaVM*, supports up to Java 25 bytecode (release notes). | Source-based (needs Bazel build of every dependency). | Full Java, Oracle GraalVM 25.1+. | Java 8/11/17 per earlier ticket. |
| `javax.xml.stream` (269 files import it) | **Missing.** `classlib/.../java/` has only awt, io, lang, math, net, nio, security, text, util; no `javax.*`. | Not emulated. | JDK `java.xml` expected to compile (standard native-image); unverified for Web Image. | Real JDK impl. |
| Reflection by name | `Class.forName` resolves via a name map built from class metadata; `getMethod`/`invoke` implemented in `TClass`/`TMethod`. Metadata is only kept for classes the compiler sees as reachable by reflection, so expect a config/transformer step. 0.15 added `Proxy`. Docs I could reach still say reflection is discouraged. | **None.** `limitations.md`: "does not support any of `java.lang.reflect.*`", nor `Enum.valueOf`. | Native Image reachability metadata (reflect-config / tracing agent). Web Image specifics undocumented. | Full. |
| Threads, wait/notify | Green threads via coroutines. `TThread.start` uses `Fiber.start`; `TObject` has own monitors with `wait`/`notify`/`notifyAll`. Wasm GC got coroutines in 0.13. Method colouring adds size/speed cost. | No threads in browser. | Undocumented; Wasm has no shared GC threads yet. | Supported (JVM-level). |
| java.awt value types | `TColor`, `TDimension`, `TPoint` exist. Missing: `Rectangle`, `java.awt.image`, `Graphics*`. | No. | JDK `java.desktop` unlikely to work headless in Wasm. | Real. |
| Other lib | `java.util.logging`, `nio.file`, `text`, `regex`, `stream`, `concurrent` (subset: no `Executors`; FreeCol needs only atomics, TimeUnit, Callable). | Partial emulation. | Full JDK. | Full. |
| Output size / speed | Dead-code elimination; small for typical apps. Wasm GC is near parity with JS (0.12 notes). No measured numbers for a 250K-line app. | Small, but not applicable. | Hello world size not published; Binaryen step. | Multi-MB runtime from CDN. |
| Build | Gradle plugin + Maven plugin. | Bazel only (no Windows). | `native-image` + Binaryen 119+, Node 25 or flag. | None: load jars at runtime. |
| Maturity | Releases 0.14.0 (2026-05-02), 0.15.0 (2026-06-14), 0.16.0 (2026-10-02); pushed 2026-10-23; 3.1k stars. | Last tag 2026-04-02; Wasm "work-in-progress". | Experimental, API may change. | Commercial, Community licence for FOSS. |

## FreeCol-specific findings

- StAX is the single hard gap for TeaVM. But only `FreeColXMLReader` and `FreeColXMLWriter` touch the factories/reader/writer; 262 of the 269 files import only `XMLStreamException`. So the work is: supply `javax.xml.stream` API classes plus an implementation, not touch 270 files. Options: (a) Aalto-xml (pushed 2026-10-13) or Woodstox (pushed 2026-10-20) compiled by TeaVM with a stax-api jar; untested, may hit reflection/ServiceLoader in factory lookup, so construct the factory directly; (b) a hand-written subset (FreeCol uses a narrow reader/writer surface). Estimate: 1-3 weeks, either way.
- `javax.xml.transform` is used in only `Utils.java` and `FreeColXMLWriter.java` (pretty-print); replace.
- `java.awt.Color/Dimension` are covered. `Rectangle`/`Point` in `common/resources`, `ImageCache`, `ImageUtils`, `SimpleZippedAnimation` (client-ish). A small shim of `Rectangle` and removing `java.awt.image` uses in `server/FreeColServer`, `SimpleMapGenerator`, `ServerRegion` is needed (check which classes).
- Threads: TeaVM turns blocking calls into coroutine suspends. FreeCol's `wait`/`notify` (NetworkReplyObject) and the socket server need replacing anyway. Cleanest is the in-memory `DummyConnection`-style transport, making the server loop single-threaded-friendly; keep green threads as the safety net.
- Reflection: FreeCol uses name-based `Class.forName`/`getMethod` over a closed set of model/message classes. This matches TeaVM's reachable-class metadata model; budget a reflection config listing `net.sf.freecol.common.model.*`, message classes, `ServerGame` handlers.
- Sound (`javax.sound.sampled`, 15 files), `java.util.jar`, files: client-side or I/O; stub in headless engine.

## Patch estimate (headless common + server + AI)

| Option | Estimate |
|---|---|
| TeaVM | Moderate. StAX layer, in-memory transport replacing sockets/threads, AWT `Rectangle` shim, file/resource loading via bundled resources, reflection config, stubs for sound/jar. Roughly 20-40 source files touched, mostly outside `model/`; the 250K-line core stays. Unknown: compile time and size of the whole graph, Wasm GC bugs (0.16 fixed "invalid modules" cases). |
| CheerpJ | Near zero for headless. Packaging changes only. |
| Web Image | Probably low code patching, high toolchain risk; needs a spike. |
| J2CL | Very high: rewrite all reflection (Introspector, Message, Specification), super-source StAX, Bazel build of FreeCol. |
| JWebAssembly | Not viable. |

## Top risks

1. TeaVM StAX: no JDK implementation; third-party StAX compiled by TeaVM is unproven.
2. TeaVM reflection metadata: must verify `Class.forName`+`getMethod` on FreeCol's names with a spike; docs I reached are contradictory (older docs say no reflection, source code says implemented).
3. Coroutine transformation cost on a hot AI loop; speed of full-game AI turns unmeasured.
4. Web Image licence/edition conflicting (docs: Oracle GraalVM; Phoronix: Community 25.1.3), and unknown thread/reflection support.
5. CheerpJ fallback depends on their CDN and licence terms (decided in an earlier ticket).

## Suggested spike (1 day)

Compile `common` + `server` model with TeaVM Wasm GC; load a saved game via a stub StAX; call `Class.forName("net.sf.freecol.common.model.Unit")` + `getMethod`; run one AI turn in Node and report wasm size and time.

## Not verified

teavm.org docs pages (404 at guessed URLs; used release notes and source); CheerpJ.com (403); Web Image threads/reflection. Whether Aalto/Woodstox compile under TeaVM.

## Sources

- TeaVM releases: https://github.com/konsoletyper/teavm/releases (0.16.0 2026-10-02)
- TeaVM classlib tree: https://github.com/konsoletyper/teavm/tree/master/classlib/src/main/java/org/teavm/classlib/java (awt, lang/TThread, lang/TObject, lang/TClass, lang/reflect/TMethod)
- TeaVM overview: https://teavm.org/docs/intro/overview.html
- J2CL limitations: https://github.com/google/j2cl/blob/master/docs/limitations.md ; repo https://github.com/google/j2cl
- Web Image: https://www.graalvm.org/dev/reference-manual/web-image/ ; https://www.phoronix.com/news/GraalVM-Community-25.1.3
- JWebAssembly: https://github.com/i-net-software/JWebAssembly
- Aalto: https://github.com/FasterXML/aalto-xml ; Woodstox: https://github.com/FasterXML/woodstox
