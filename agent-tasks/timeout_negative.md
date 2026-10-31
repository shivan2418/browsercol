Issue #45: the Engine's Node run prints a Node `TimeoutNegativeWarning`
(-694967296 ms): some sleep or timer longer than 2^31 ms wraps around and
Node fires it after 1 ms. The source is unknown. Find it and fix it.

Reproduce: `./dev.sh ./build.sh`, then the Node runs in `engine/`
(`run-node.mjs` and `run-split-node.mjs`; see their headers and
spike/README.md for which module each needs and how to build it). Use
`node --trace-warnings` to get a stack.

Hints: -694967296 is 3600000000 - 2^32, i.e. a delay of 3.6e9 ms (1000
hours) or a `Long` delay squeezed into an int. Look at where Java timers
and sleeps become JS `setTimeout` (TeaVM's runtime and our shims in
`engine/src`, the patches in `engine/patches/`), and at FreeCol code that
schedules a timer with a large or "forever" delay. FreeCol upstream source
is in `freecol/` (read only).

Fix: at the place we own (a shim, patch or the runtime glue), clamp the
delay to Node's maximum (2^31-1 ms) or treat "forever" correctly, so the
warning goes away and no timer fires early. Explain in a code comment why.
If the only fix is inside TeaVM itself, do not patch TeaVM: write up where
it is and stop.

Done when:
- Both Node runs complete with no TimeoutNegativeWarning (report the
  commands and the last lines), and `./dev.sh -C engine gradle test` passes.
- The report names the timer (class, method, delay) and why it was that big.
- One commit, subject like
  `Engine: clamp the timer behind Node's TimeoutNegativeWarning (#45)`.

Traps:
- Building the modules takes minutes; pipe builds through `tail -20`.
- run-split-node.mjs may hang at game start because of #43 (fcShow/fcAsk
  undefined; another job fixes that): if it does, reproduce with
  run-node.mjs, or stub the two globals locally without committing that.
- Do not touch `engine/run-split-node.mjs` in your commits.
