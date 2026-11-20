# BrowserCol forks FreeCol into this repo

Until now the Engine was built from an unforked FreeCol: a git-ignored clone at a pinned commit (`freecol.sha`), with our changes as whole-file copies in `engine/patches/` that replaced the upstream file at build time. The overlay aimed to stay re-pinnable: every changed line carried a marker, and a new pin meant merging upstream's changes into the copies. That aim has stopped paying. Upstream is slow to answer (our fix in FreeCol PR #181 has had no reply since 2026-11-06), and the square grid of #522 changes FreeCol's map model on purpose, in about a dozen files that no overlay of whole-file copies can carry.

So FreeCol's tree at commit 1c272e80 now lives in `freecol/` in this repo, and the Engine compiles `freecol/src` directly. `srcdata/` (890 MB of art sources) and `www.freecol.org/` (118 MB of website) are left out, about 250 MB instead of 1.26 GB. The 29 patched files were folded in as ordinary commits, and the `// online:` and `// browser:` markers are gone: git history is the record of why a line changed. The Swing client stays in the tree, unbuilt and unmaintained.

## Considered Options

- **A separate fork repository:** rejected. Every change that spans the Engine, the UI and FreeCol would be two pull requests and a pinned-sha bump between them.
- **Keep the overlay:** rejected. It doesn't scale past a handful of files, and the grid change touches more than that.

## Consequences

- This supersedes the re-pinnable patch set of `engine/patches/README.md` and the argument in ADR 0001 that forking FreeCol "for good" was a reason to reject a translation of Java to TypeScript. We do fork it now, for a different reason, and keep compiling the Java.
- The tree comes in by `git archive`, not `git subtree`, so `freecol/` has no upstream history. An upstream fix is taken as a patch: `git format-patch -1 <commit> --stdout | git am --directory=freecol`, or `git cherry-pick -Xsubtree=freecol` in a clone that has FreeCol's history. The README says how.
- `docs/upstream-fixes.md` stays as the list of real FreeCol bugs we fix, in case upstream wants them.
- When a Swing or JVM-only call has to go, take out only that call and keep the game behaviour next to it (`docs/teavm.md`).
- A worktree needs no separate FreeCol clone, and CI and `build.sh` have no clone step.
- FreeCol's own `.gitignore` and the root one hide a few installer and IDE files (`freecol/build/`, `freecol.iml`, `config/nbproject`), which are not in the repo.
