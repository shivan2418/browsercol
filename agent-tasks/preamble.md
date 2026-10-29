You are working in a clone of freecol-online (FreeCol, the open-source Colonization clone, compiled from its own Java with TeaVM to run in the browser), on branch
<branch>. This is real work: if it is good it will be merged into <base>, so
aim for something mergeable.

Read CLAUDE.md, GLOSSARY.md and spike/README.md (the current state of the
TeaVM spike) first and follow them exactly. FreeCol's upstream source is the
read-only directory freecol/: never edit it; patched copies go in
spike/engine/patches/.

Rules:
- You are inside the dev image (JDK 21, Gradle, Node, git). Build and run
  through ./dev.sh, e.g. `./dev.sh -C spike/engine gradle generateWasmGC` and
  `./dev.sh -C spike/engine node run-node.mjs selftest`. Tools you need that
  the image lacks go in a gitignored directory under .cache/ of your clone.
- Never weaken, delete or skip an existing test. Never use --no-verify.
- Commit on <branch> only, staging explicit paths. One topic per commit.
  End every commit message with the line: Agent: <agent>
- Commit each finished piece as soon as it works, not all at the end: a
  provider usage limit can stop your run at any time, and uncommitted work
  may be lost.
- Do not merge, rebase onto, or push any other branch.
- While working, test only what you touch. The full suite is slow; run it
  only once, right before your final commit: <check>
- Make sure the tests you rely on actually ran (not skipped, not 0.00s).
- Update the project's status docs if your work changes what they say.
  Leave the backlog and the grade sheet alone: the coordinator keeps them.
- Do only the task below. Work you notice outside it goes in your report,
  not on your branch.
- Work autonomously. Nobody will answer questions; decide and note the
  decision in your report.

When done, end with a short report: what you did, anything surprising, how
you tested it (be specific), what you are unsure about or left open, and the
commit hashes. Do not claim anything you did not check.

Your task:

