Write `spike/teavm/build-teavm.sh`: a rerunnable script that builds TeaVM
from source, master plus four open pull requests, and publishes it into a
local Maven repository. A later task builds the spike against it to see if
the PRs fix `Object.wait`/`notify` under Wasm GC (spike/README.md, "What
broke along the way", item 6; tracker issue
https://github.com/shivan2418/freecol-online/issues/9). This task only
makes TeaVM build.

Source of truth: https://github.com/konsoletyper/teavm, branch master, plus
PRs #1300, #1302, #1304 and #1305, fetched as `pull/<n>/head` and merged in
that order. GitHub reports all four mergeable.

The script must:
- clone TeaVM into `.cache/teavm-src`, or fetch if it is already there;
- check out master, print the commit, and merge the four PR heads,
  printing each head commit; stop with a clear message if one conflicts;
- publish TeaVM (the Gradle plugin and every library the plugin pulls in
  for a Wasm GC build) into `.cache/teavm-repo`, without running TeaVM's
  test suite, and print the version string it published.

Done means:
- the script, committed, run once to completion in your clone;
- in your report: the master commit, the four PR heads, the published
  version, how long the build took, and `ls .cache/teavm-repo/org/teavm`.
- a short "Building TeaVM from source" paragraph at the end of
  spike/README.md saying how to run the script.

Traps:
- Read TeaVM's own build files to find the publish task (look for
  `publishToMavenLocal` or a `maven-publish` repository you can point at
  `.cache/teavm-repo`). Skip tests (`-x test`, or TeaVM's own switch).
- TeaVM may build JS runtime parts with Node/npm. Node is in the image;
  put any npm cache under `.cache/`.
- `.cache/` is gitignored: never commit TeaVM's source or the built repo.
- Do not change spike/engine in this task.
- Keep your command output short (pipe long builds through `tail`): your
  run has a limited number of steps.

If the task turns out bigger than this, commit the finished parts first and
say in the report what is left.
