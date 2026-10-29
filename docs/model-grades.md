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

## Runs

| date | task | model | cost | time | grade | merged | Claude fix | notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-29 | teavm_monitors | flint-v1.0:free | $0 | 24 min | A- | yes (73f300b, e445262) | README fixes (250b3ad) | Answered the question correctly (the PRs do not fix wait/notify in the Engine), with clean rebuilds and checks that the Wasm differed and the published jar held the fixes; -PteavmVersion/-PteavmRepo switch works and defaults to 0.16.0. Spent part of the run on TeaVM instrumentation that never landed in the build, then reverted it cleanly. Called the merged HEAD the "master commit". Did not find that wait works in small programs (not asked). |
| 2026-10-29 | teavm_build | flint-v1.0:free | $0 | 13 min | B+ | yes (c96ccb3, a0443c3) | small (bf008cb) | Script clones TeaVM, merges PRs 1300-1305, publishes 0.17.0-SNAPSHOT (38 artifacts) via the default staging repo after finding file: repos fail the plugin's credential check. Stopped on #1304's test-only ObjectTest conflict as told, then resolved it by hand, so the script could not finish alone; it also hardcoded /work paths and relied on a git identity it set by hand. Claude made it resolve test-only conflicts, set an identity, use repo-relative paths; verified a clean run (131 s). |
