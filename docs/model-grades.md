# Model grade sheet

Every agent run on real work, graded by the reviewer (correctness 35,
faithfulness to the spec 20, process 20, code fit 15, report 10; a false
claim in the report fails the run). Update after each review. "Claude fix"
is how much the reviewer had to change before merging.

Grades: A, A-, B+, B, B-, C+, C, C-, D, F. Use "F (infra)" when the
provider failed (rate limit, endpoint down) and the model never got to
work, and "n/a" when a limit cut the run off before anything gradable; both
are left out of the GPA (`tools/grades_to_json.py`).

## By model

| model | tier | runs | merged | grades | verdict |
|---|---|---|---|---|---|
| flint-v1.0:free (OpenRouter) | free | 2 | 2 | B+, A- | Java/Gradle build work and measurement: reads unfamiliar build files well, verifies its own results (artifact hashes, jar contents), reverts its debugging, honest reports. Follows instructions literally, and sometimes mislabels details (called a merge commit "master"). 13-24 minute runs, no step-limit trouble on tasks this size. |
| MiniMax-M3.1-Flash (MiniMax plan) | subscription | 3 | 3 | A-, A-, A- | First runs here (also graded in smac1.5). Small Browser UI and Node-runner tasks in 14-21 minutes and 65-127 steps, all merged as they came. Checks its own claims with negative controls (reintroduced a warning, sent a ship to Europe on purpose, broke a colour name to see tests fail) and reports honestly. Tends to build a little more than asked (a --verbose flag, per-kind answer tables). |

## Runs

| date | task | model | cost | time | grade | merged | Claude fix | notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-30 | vp_check_warnings (#39, now #36) | MiniMax-M3.1-Flash (MiniMax plan) | plan, 3 jobs: 5h window 10% -> 22% of 5h, 3% of week | 16 min, 65 steps | A- | yes (d0cfc19, c41339c) | reworded subjects to #36 | Both warnings fixed by making the Dialogs store's members arrow properties (matches the implementation) and JSON.stringify in play.mjs; denyWarnings in vite.config.ts makes a warning fail vp check. Checked by reintroducing a warning (exit 1) and removing the option; reviewer confirmed. Report muddled "two warnings" vs three diagnostics. |
| 2026-10-30 | split_runner_gui (#43) | MiniMax-M3.1-Flash (MiniMax plan) | plan | 21 min, 127 steps | A- | yes (c88ccfa) | none | fcShow/fcAsk in run-split-node.mjs answering with each kind's default through ClientMain.answer, in a microtask; 10 rounds to "finished at 11". The 10-round run asks nothing, so it tested the question path itself: a real high-seas prompt (declined, ship stays; control with "true" sails to Europe) and synthetic questions of every kind. A bit more than asked (--verbose, FC_VERBOSE). |
| 2026-10-30 | tileset_tidy (#36, 3 items) | MiniMax-M3.1-Flash (MiniMax plan) | plan | 14 min, 124 steps | A- | yes (088f681, e5cc1f0, f8b3ff4) | none | One list of map keys (map-keys.ts, imported by tileset.ts and build-art.mjs) with a coverage test; JAVA_COLORS listed once, upper-case derived and pinned by a test; --manifest parsed anywhere. Showed the old regex and new predicate agree on all 1423 keys and build.sh's art is byte-identical (664 files). tileset.ts now builds keys from prefixes, so literal keys no longer grep. |
| 2026-10-29 | teavm_monitors | flint-v1.0:free | $0 | 24 min | A- | yes (73f300b, e445262) | README fixes (250b3ad) | Answered the question correctly (the PRs do not fix wait/notify in the Engine), with clean rebuilds and checks that the Wasm differed and the published jar held the fixes; -PteavmVersion/-PteavmRepo switch works and defaults to 0.16.0. Spent part of the run on TeaVM instrumentation that never landed in the build, then reverted it cleanly. Called the merged HEAD the "master commit". Did not find that wait works in small programs (not asked). |
| 2026-10-29 | teavm_build | flint-v1.0:free | $0 | 13 min | B+ | yes (c96ccb3, a0443c3) | small (bf008cb) | Script clones TeaVM, merges PRs 1300-1305, publishes 0.17.0-SNAPSHOT (38 artifacts) via the default staging repo after finding file: repos fail the plugin's credential check. Stopped on #1304's test-only ObjectTest conflict as told, then resolved it by hand, so the script could not finish alone; it also hardcoded /work paths and relied on a git identity it set by hand. Claude made it resolve test-only conflicts, set an identity, use repo-relative paths; verified a clean run (131 s). |
