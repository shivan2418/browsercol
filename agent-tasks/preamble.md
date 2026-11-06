You are working in a clone of browsercol (FreeCol, the open-source Colonization clone, compiled from its own Java with TeaVM to run in the browser), on branch
<branch>. This is real work: if it is good it will be merged into <base>, so
aim for something mergeable.

Read CLAUDE.md, GLOSSARY.md and README.md (layout and commands) first and
follow them exactly; spike/README.md is the record of how the Engine got
here, read it when your task touches the Engine's TeaVM build. FreeCol's upstream source is the
read-only directory freecol/: never edit it; patched copies go in
engine/patches/.

Rules:
- You are inside the dev image (JDK 21, Gradle, Node, git). Build and run
  through ./dev.sh, as README.md's "Commands" shows: `./dev.sh ./build.sh`
  builds both Engine modules and dist/, `./dev.sh -C engine gradle test`,
  and for the Browser UI `./dev.sh -C ui npm ci` once, then
  `./dev.sh -C ui pnpm exec vp test` and `./dev.sh -C ui npx vp check`. Tools
  you need that the image lacks go in a gitignored directory under .cache/
  of your clone.
- The image has Chromium and Firefox, so run the browser scripts as
  README.md shows them, without `DEV_VARIANT=web` (inside the sandbox
  ./dev.sh runs commands directly): build dist/ first with
  `./dev.sh ./build.sh`, then `./dev.sh node ui/scripts/smoke.ts`,
  `play.ts` or `tileset.ts`. Each takes minutes; pipe through
  `tail -30`. Run the ones your change could affect, once, before your
  final commit, and say in your report which you ran and their result.
- Commit subjects as CLAUDE.md says: a plain sentence-case sentence, an
  `area:` prefix where it reads better, the issue in brackets, no trailing
  period, e.g. `Tileset: keep a colour resource's alpha (#35)`.
- Never weaken, delete or skip an existing test. Never use --no-verify.
- Commit on <branch> only, staging explicit paths. One topic per commit.
  End every commit message with the line: Agent: <agent>
- Commit each finished piece as soon as it works, not all at the end: a
  provider usage limit can stop your run at any time, and uncommitted work
  may be lost.
- Do not merge, rebase onto, or push any other branch.
- While working, test only what you touch. Before your final commit run,
  once, the checks for the side you changed: Engine `./dev.sh -C engine
  gradle test`; Browser UI `./dev.sh -C ui pnpm exec vp check` and
  `./dev.sh -C ui pnpm exec vp test`. The commit hook runs <check>.
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

