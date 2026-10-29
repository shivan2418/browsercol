# Do Java-to-X source transpilers save work or tokens over compiling?

Ticket: shivan2418/freecol-online#5. Researched 2026-10-24.

## Verdict

Source transpiling does not save work or tokens for FreeCol, except for one narrow slice. Compiling the Java (bytecode to JS/Wasm; see the sibling tickets on TeaVM/CheerpJ) beats it on almost every axis.

- No transpiler can take FreeCol's 72K-line Swing GUI. That layer must be rewritten whatever route we pick.
- The two serious Java-to-TS/JS tools are poor fits. JSweet is effectively unmaintained, and J2CL has no reflection and needs Bazel.
- AI translation of the rest produces a permanent fork. It costs roughly 6-12M tokens for the logic layers (my estimate, not measured), and every upstream change then has to be hand-ported.
- Transpiling or LLM translation pays off only if the goal is to abandon Java for good. That means a hand-maintained TypeScript game, ideally with the Java kept as a test oracle.
- A hybrid is the most sensible use of LLM tokens. Compile the headless engine (common + server + AI, about 160K lines) as-is, and spend LLM tokens only on a new browser UI replacing the Swing client.

## Facts about FreeCol that drive the answer

Measured on /home/emil/freecol-online/freecol:

- **Size**: 248,702 lines and 8.5 MB of `.java` under `src`.
- **Java level**: `java.target.version` is 11 (build.xml line 12). The language is plain Java 11, with no records or sealed types.
- **Imports**: about 972 `javax.swing` and 939 `java.awt` imports. About 270 files use `javax.xml.stream` (StAX), because FreeCol's save and network format is XML. About 76 files touch threads or `java.util.concurrent`. 8 files use reflection. There are 91 MigLayout imports and 16 `javax.sound` imports.

Consequences:

- Swing, AWT, MigLayout and sound are unsupported by every tool below. For the 72K-line GUI, only a rewrite works.
- StAX needs a replacement under JSweet and J2CL (J2CL leaves out `java.net` and `String.format`).
- Reflection is small (8 files) but must be hand-patched on J2CL.

## Tools

### JSweet (Java to TypeScript to JS)

- **Status**:
  - Repo cincheo/jsweet: last push 2023-12-16, last GitHub release 3.1.0 (2021-04-22), 157 open issues.
  - The maintainers' own `JSweet4.md` says they "don't have enough time to seriously maintain JSweet" and are looking for a new maintainer. I found no sign one arrived.
  - The language spec calls its Java 8 default-method support "experimental" and says Java 8 streams are "not supported yet".
- **Java version**:
  - A maintainer says (issue 751) JSweet 3 added Java 11 support, but it was not tested on later JDKs.
  - Newer JDKs fail with `InaccessibleObjectException` on `jdk.compiler` internals. JSweet 4 plans to address this, but it is a plan, not a release.
  - FreeCol's Java 11 matches the baseline, but we would be pinned to an old JDK toolchain.
- **Generics**: Mapped to TS generics, which are erased as in Java. I did not verify edge cases.
- **Reflection and threads**: Reflection is limited to basic operations. Threads are not covered, and JS is single-threaded anyway, so the 76 files with concurrency need manual redesign.
- **Semantics**:
  - `int`, `short`, `byte` and `double` all become JS numbers. `char` becomes string.
  - Overloads that differ only in numeric type are ambiguous at runtime.
  - Extending JDK classes is generally not possible.
  - These are silent-bug risks for game logic: integer overflow, `long` handling, hashing, combat and RNG arithmetic.
- **JRE**: Uses J4TS, a fork of GWT's JRE emulation. It covers most of `java.util`, but not Swing/AWT or StAX.
- **Readability**: Output is TypeScript close to the source structure, so it is readable, but it carries overload-dispatch noise.
- **Hand-fixing**: Mechanical conversion, then per-file fixes for unsupported APIs. For 160K non-GUI lines I expect heavy manual work (assumption), with the toolchain itself a risk (custom Artifactory repo, old tsc).
- **Upstream changes**: Re-running works only if the generated TS is never edited, which is unrealistic because fixes are required. In practice it is manual re-porting.

### java2typescript and other Java-to-TS tools

- **npm `java2typescript`**: ANTLR-based. Its README says the grammar covers Java 17, but only language features up to Java 11 are supported. It is syntax-level, with no JRE emulation and no type resolution, so it is a first-draft generator.
- **marekgregor/java2typescript (DataThings J2TS)**: Last pushed 2022-06; requires JDK 8 or below; described as legacy (superseded by GreyCat).
- **terrestris/java2typescript**: Scala/sbt, last push 2025-03-06, a small niche project.
- Net: none handles FreeCol's JRE use. Each yields a first draft that still needs most of the manual or LLM work.

### J2CL (Google, as source-to-source)

- **Status**:
  - google/j2cl was pushed on the date of this research, so it is actively maintained.
  - The README still labels it "alpha", though it is used in production at Google.
  - It targets Closure-style JS, with an experimental Wasm GC backend (Chrome 119+).
- **Build**: It needs Bazel and works best with the Closure Compiler. The output is Closure-annotated JS meant to be optimised away, not editable source. It is a compiler, not a translation path.
- **Limits**, from `docs/limitations.md`:
  - No `java.lang.reflect` at all, including `Class.getEnumConstants` and `Enum.valueOf`.
  - No array bounds checks.
  - `float` is emulated as 64-bit.
  - `java.net` is left out of the JRE emulation, and `String.format` is not supported.
- **Java version**: I could not confirm the supported language level from the docs I read.
- **Verdict as a source tool**: Not a source-translation path. As a compile path it is credible for the headless engine, but it forces Bazel and replacements for StAX and `String.format`. Upstream changes just recompile.

### AI-assisted translation (LLM, file by file, tests as oracle)

- **Evidence**:
  - Google's migration paper ("Migrating Code At Scale With LLMs At Google", formerly "How is Google using AI for internal code migrations?"): 74.45% of code changes and 69.46% of edits were LLM-generated across 39 migrations. Developers estimated about a 50% reduction in total migration time.
  - Those were same-language, well-tested, narrow migrations (ID type widening, JUnit3 to JUnit4), not cross-language rewrites of a stateful app.
  - RepoTransBench (arXiv 2412.17744): at repository level the best method reaches only 32.8% success in v2 (7.33% in v1). Per the abstract, translation from dynamic to static languages is below 10%, versus 45-63% for the reverse. It is a general benchmark, not Java-to-TS specific, so it is only a rough indication.
  - TransRepo-Bench (EMNLP 2025 Findings) benchmarks Java-to-C# at repo level using skeleton-first translation. I did not find a headline success rate.
- **Generics, reflection, threads**: The LLM can redesign them idiomatically (async instead of threads, no reflection). That is its main advantage over mechanical transpilers.
- **Readability**: Best of all options, since it is human-style TypeScript.
- **Oracle**: The real oracle would be a headless Java harness. Run the same seeds and scripted games on Java and TS, and diff XML or state snapshots. That is feasible because FreeCol saves are XML.
- **Token cost** (estimate, assumptions stated):
  - Assumptions: about 3.5 chars per token, so 8.5 MB is about 2.4M tokens for the full tree, scaled proportionally for subsets. Output is roughly as long as input.
  - **~160K lines** (common + server + AI + non-Swing client, about 5.5 MB): about 1.6M tokens in and about 1.4M out for a first pass.
  - **~250K lines** (everything, including the Swing layer redesigned as DOM/canvas UI, which is a redesign, not a translation): about 2.4M in and 2.0M out for a first pass.
  - With 2-3 fix/test/repair rounds, context re-reads and cross-file stubs (assumption), the total is about 6-12M tokens for 160K lines and 10-20M for 250K lines.
  - Human review time is likely the larger cost.
  - Prompt caching and a cheap drafter model could cut this, but I have no measured numbers.
- **Upstream changes**: Manual. The output is a fork. Porting each upstream diff with an LLM is cheap per diff, but you carry permanent divergence-tracking cost. FreeCol upstream is slow-moving, which helps.

## Comparison with compiling the Java as-is

| | Compile (bytecode to JS/Wasm: TeaVM, CheerpJ, etc.) | Transpile/LLM to TS |
|---|---|---|
| Up-front work | Fix toolchain, stub or port Swing | Rewrite everything; 6-20M tokens plus review |
| Swing GUI (72K lines) | Needs a port or a Swing-capable runtime | Needs a rewrite in all cases |
| Behavior fidelity | Same semantics as Java | Risk of silent numeric/overload bugs |
| Readability/editability | Output not meant for editing | Best (LLM) to medium (JSweet) |
| Upstream merges | Rebuild | Manual port |
| Long-term ownership | Java stays source of truth | A TS fork |

This is qualitative; I did not benchmark any compile path. Details belong to the sibling tickets.

## Conditions under which transpiling wins

1. We decide to leave Java entirely and own a TS codebase, accepting a fork.
2. Bundle size or startup of the compiled-JVM runtime proves unacceptable.
3. The UI is rewritten anyway and a native TS engine is wanted (even then, the bytecode route for the engine is cheaper to start).

## Sources

- JSweet repo and metadata: https://github.com/cincheo/jsweet (GitHub API: pushed 2023-12-16; latest release 3.1.0, 2021-04-22)
- JSweet4.md maintenance statement: https://github.com/cincheo/jsweet/blob/develop/JSweet4.md
- JSweet language specification: https://github.com/cincheo/jsweet/blob/develop/doc/jsweet-language-specifications.md
- JSweet Java 11 / JDK compatibility (maintainer comment, issue 751, via mirror): https://git.tdem.in/cincheo/jsweet/issues/751
- J2CL repo: https://github.com/google/j2cl ; limitations: https://github.com/google/j2cl/blob/master/docs/limitations.md ; Wasm: https://github.com/google/j2cl/blob/master/docs/getting-started-j2wasm.md
- java2typescript: https://www.npmjs.org/package/java2typescript ; https://github.com/marekgregor/java2typescript ; https://github.com/terrestris/java2typescript
- Google migrations paper (as reported): https://getdx.com/research/migrating-code-at-scale-with-llms-at-google/
- RepoTransBench: https://arxiv.org/abs/2412.17744
- FreeCol numbers: measured locally with grep/wc on the clone.

## Caveats

- I read abstracts and secondary summaries, not full papers, for the LLM-translation benchmarks.
- Token estimates are my own arithmetic from stated assumptions, not measurements.
- That no transpiler supports Swing comes from absence in the docs I read, not an exhaustive check.
