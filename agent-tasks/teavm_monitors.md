Find out whether a TeaVM built from source, master plus four open pull
requests, makes `Object.wait`/`notify` work in the Engine's Wasm GC build.
TeaVM 0.16.0 does not: a waiting thread keeps the monitor and never wakes
(spike/README.md, "What broke along the way", item 6). FreeCol's client
needs it, so this decides whether we can stay on TeaVM. This is tracker
issue https://github.com/shivan2418/freecol-online/issues/9.

Source of truth: TeaVM at https://github.com/konsoletyper/teavm, branch
master, plus PRs #1300, #1302, #1304 and #1305 (fetch them as
`pull/<n>/head`). They all come from one author and GitHub reports them
mergeable; merge them in that order. The self-test is `SpikeMain`'s
`monitorSelfTest` (cases A, B, C). On the JVM (`./dev.sh -C spike/engine
gradle run --args=selftest`) all three print "woke"; under TeaVM 0.16.0 none
do.

`spike/teavm/build-teavm.sh` (already on your branch) builds TeaVM
master plus the four PRs into `.cache/teavm-repo` and prints the version.
Run it first.

Done means:
- `spike/engine` builds against that TeaVM when run with
  `-PteavmVersion=<version> -PteavmRepo=<path>` (plugin and libraries both;
  the plugin needs a `pluginManagement` block in settings.gradle). Without
  those properties it still uses 0.16.0 from Maven Central, unchanged.
- With the built TeaVM: the results of `node run-node.mjs selftest` (each of
  A, B, C: woke or not, and after how many ms) and of `node run-node.mjs 30`
  (the "game ready" time, mean AI round time, whether all 30 rounds
  finish). Also say whether anything in spike/engine had to change to
  build. Run the same two commands with 0.16.0 for comparison.
- A new section "TeaVM master with the monitor PRs" at the end of
  spike/README.md with those results, the TeaVM commit and PR heads used,
  and how to reproduce.

Traps:
- Keep your command output short (send long logs to a file under build/
  and grep it): your run has a limited number of steps.
- Do not change FreeCol code or the shims to make the self-test pass. This
  task only measures TeaVM.
- If a PR does not merge cleanly, say which, and test with the ones that do.

If the task turns out bigger than this, commit the finished parts first and
say in the report what is left.
