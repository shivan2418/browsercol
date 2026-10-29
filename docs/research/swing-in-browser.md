# Can FreeCol's Swing client run unmodified in the browser?

Ticket: shivan2418/freecol-online#3. Researched 2026-10-24.

**Verdict: PLAUSIBLE, with a spike required.** CheerpJ is the only credible route. It runs unmodified Swing/AWT jars from static hosting, and its free licence covers FreeCol as a FOSS project. The open risks (performance of the Java2D map renderer, startup size, `-Xmx2G`) can only be settled by running FreeCol in it.

## FreeCol facts (local, `/home/emil/freecol-online/freecol`)
- `build.xml:12`: `java.target.version` = 11. Java 11 bytecode.
- Third-party jars (`jars/`): commons-cli, cortado, jogg, jorbis, miglayout-core/swing, findbugs-annotations. All pure Java.
- `javax.sound` is used in 5 source files. `java.awt.Toolkit`/`GraphicsEnvironment` are used in GUI.java, ImageLibrary.java, FontResource.java and others.
- The launcher sets `-Xmx2G` (`build.xml` lines 602, 1036).

## CheerpJ (Leaning Technologies)
- **Version and Java support:** 4.3 supports Java 8, 11 and 17. Java 17 began as a preview in 4.1 (May 2025). Java 21 is "planned". 5.0 is described as "on the horizon". I found no announcement of 5.0 shipping. Sources: [4.3 post](https://labs.leaningtech.com/blog/cheerpj-4.3), [4.0 post](https://labs.leaningtech.com/blog/cheerpj-4.0), [overview source](https://raw.githubusercontent.com/leaningtech/labs/main/sites/cheerpj/src/content/docs/00-overview.mdx). FreeCol needs Java 11, which is supported since 4.0 ("complete and unmodified build of OpenJDK"). The overview page lists "Java 8, 11 and 17" in one place but only SE 8 and 11 in its runtime section, so which Java 17 pieces are stable is unclear. This does not matter for FreeCol.
- **How it works:** a Java-to-JS/Wasm JIT working on bytecode, plus an OpenJDK-based runtime. Both are written in C++ and compiled with Cheerp (overview). Swing and AWT are in the runtime. Reflection, dynamic class loading, multi-threading, audio, clipboard and printing are listed as supported. Third-party look-and-feels work. The 4.0 post says JavaFX and SWT are unsupported, and the [FAQ](https://raw.githubusercontent.com/leaningtech/labs/main/sites/cheerpj/src/content/docs/20-faq.md) says sockets are unavailable in browsers. Neither matters for single-player FreeCol.
- **Swing fidelity:** the 4.3 post says it runs unmodified Swing and shows FlatLaf and "a complex Swing application". Demos exist for SwingSet3, FlatLaf and Pixelitor ([leaningtech GitHub](https://github.com/leaningtech)). I found no published fidelity benchmarks or a known-issues list for Java2D, fonts or `GraphicsEnvironment`. FreeCol's custom map painting, fonts and Toolkit calls are the unverified part.
- **Performance:** no benchmark numbers are published. The 4.0 post claims "significant performance improvements" and says Minecraft 1.2.5 (via [browsercraft](https://github.com/leaningtech/browsercraft), a demo capped at 3 minutes) runs "with satisfactory performance on most mid range machines". Performance is still described as a constraint for demanding apps. FreeCol's AI turns and map rendering are CPU-heavy, so this must be measured.
- **Startup and size:** runtime modules load on demand, and the browser caches them. The [startup guide](https://raw.githubusercontent.com/leaningtech/labs/main/sites/cheerpj/src/content/docs/11-guides/Startup-time-optimization.md) says "typically 10-20MB for many apps" for the initial download. There are no timing figures. `preloadResources` (profiled with `cjGetRuntimeResources()`) parallelises the fetches. FreeCol's own jar and resources (several tens of MB, unmeasured) come on top of this.
- **Filesystem** ([guide](https://raw.githubusercontent.com/leaningtech/labs/main/sites/cheerpj/src/content/docs/11-guides/filesystem.mdx)):
  - `/app/` is a read-only mount of the web server root. Jars and data served next to the page are readable from Java, and jar paths take the `/app/` prefix.
  - `/files/` is persistent read-write storage and is Java's default mount. The docs do not name the backing store, so IndexedDB is unconfirmed in the docs I read. Saves and the user data dir would go here.
  - `/files/uploads/` and `/files/downloads/` (4.3+) provide import/export of save games. `/str/` is a transient JS-writable area.
  - Code using relative `File` paths needs files copied from `/app/` to `/files/`.
- **Static hosting:** pages must be served over http(s), not `file://` (FAQ). The page loads the CheerpJ loader script from Leaning Technologies' CDN (`cheerpjInit`, `cheerpjCreateDisplay`, `cheerpjRunJar`). GitHub Pages is fine. I did not verify any cross-origin-isolation (COOP/COEP) requirement, which GitHub Pages cannot set. This is a spike item.
- **Memory:** nothing in the docs states a heap limit or how `-Xmx2G` maps. The spike should check it.

### Licence (precise)
Source: [CheerpJ licensing doc](https://raw.githubusercontent.com/leaningtech/labs/main/sites/cheerpj/src/content/docs/23-licensing.md). The cheerpj.com pages themselves returned HTTP 403 (Cloudflare) to my fetcher.
- "CheerpJ Core is distributed for free with the CheerpJ **Community License**." The free scope is "personal projects, FOSS projects, and technical evaluations", plus commercial apps by one-person companies.
- FOSS projects must "give appropriate credits" (undefined).
- The doc does not use the word "non-commercial" and does not mention the GPL. FreeCol is GPL, which is FOSS, so it qualifies under the "FOSS projects" clause. Confirming with Leaning Technologies by email is cheap and advisable.
- Paid licence needed for: any other business use, **self-hosting** ("If you wish to self-host CheerpJ, you will need a Commercial License"), redistribution and OEM. Pricing tiers exist for small business, enterprise, public sector and academic use, with no prices published in the docs.
- **Consequence:** FreeCol must load the runtime from Leaning Technologies' CDN rather than vendoring it into the repo. That is a runtime dependency on a third-party host. The runtime itself is closed source and not GPL, and it cannot be vendored without a paid licence.

## Alternatives
- **DoppioJVM** ([repo](https://github.com/plasma-umass/doppio)): MIT, last push 2022-12-06. The README names no Java version beyond the Java 8 build requirement. It is a research project and does not mention Swing/AWT. A Java 11 game with Swing is out of scope. **No.**
- **Webswing** ([site](https://webswing.org/)): a Java server runs the app and streams the UI to a browser ("Clients only need a browser"). It needs a server, which rules it out.
- **JWebAssembly** ([README](https://github.com/i-net-software/JWebAssembly)): Apache-2.0 and actively developed (pushed 2026-10-01). It is a bytecode-to-Wasm compiler that supports only a subset of the standard library. Its README says threads and reflection are not yet supported (planned for 3.0) and file access "will never work". It has no Swing/AWT. Porting would mean rewriting the whole UI layer. **No**, for the "run Swing unmodified" question.
- Not researched: TeaVM, TeaVM-based Swing shims, and other Java-in-Wasm projects. They would also require replacing Swing.

## Evidence of large apps
Leaning Technologies' own demos: SwingSet3, FlatLaf, Pixelitor (image editor), Minecraft 1.2.5, and an internal IntelliJ IDEA stress test (about 400MB of JARs, per the 4.0 post). These are vendor-reported. I found no independent report of a Swing game of FreeCol's size, so there is no third-party evidence.

## Risks to settle in a spike
1. Does FreeCol boot and render the map at an acceptable frame rate (Java2D, `ImageLibrary`, custom fonts, `Toolkit` calls)?
2. Total first-load size and time with FreeCol's jar and resources, and whether preloading helps.
3. Memory: the `-Xmx2G` launcher setting and CheerpJ's heap limits.
4. AI turn latency at the JIT's speed.
5. `javax.sound` and jorbis audio.
6. Save and load via `/files/`, plus export/import for save games.
7. Licence confirmation by email, and a plan if the CDN becomes unavailable or the terms change.
