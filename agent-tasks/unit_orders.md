Issue #49: the player can give the active unit FreeCol's standing
orders from the Browser UI: fortify, sentry, skip (done for this turn),
disband, clear forest, plow and build road.

Where:
- Engine: `engine/src/main/java/online/freecol/web/Commands.java`
  (entry points), `ClientMain.java` (the `@JSExport`s the Browser UI
  calls), and whatever sends the active unit to the Browser UI
  (`WebGUI.java`'s activeUnit event) for which orders are valid.
- Tests: `engine/src/test/java/online/freecol/web/CommandsTest.java`.
- Browser UI: `ui/src/channel.ts`, `ui/src/input.ts` (keys),
  `ui/src/side.tsx` (buttons), with their tests.
- `ui/scripts/play.mjs`: add a fortify or sentry step.

Source of truth: the Swing client's actions in
`freecol/src/net/sf/freecol/client/gui/action/` (FortifyAction,
SentryAction, SkipUnitAction or WaitAction, DisbandUnitAction,
ClearOrderAction, BuildRoadAction, PlowAction / ImprovementAction and
how they decide `shouldBeEnabled`), their keys, and the
`InGameController` methods they call (`changeState`,
`disbandActiveUnit`, `changeWorkImprovementType`, ...).

Do:
- One Commands entry point per order, calling the same client controller
  method the Swing action calls. Never build protocol messages by hand.
- The Engine tells the Browser UI which orders the active unit can take
  now (e.g. a list of order names in the active-unit event), worked out
  with the same checks the Swing actions' `shouldBeEnabled` use. Do not
  repeat FreeCol's rules in TypeScript.
- Keys as the Swing client binds them (F, S, Space, D, P, R; check the
  actions' accelerators and use what they say); check `input.ts` for
  clashes with keys already bound and say in your report how you
  resolved any.
- A side-panel button per order, disabled when the order is not valid.
- Disband asks for confirmation as Swing does, through the existing
  confirm question.

Done when:
- CommandsTest: in a started Classic game, each order through the same
  entry points the Browser UI calls, checking the SERVER's game: fortify
  and sentry change the unit's state; skip leaves the unit for this
  turn; disband removes it; a pioneer that plows or builds a road leaves
  the improvement on its tile after enough ended turns (bounded loop).
- A UI test: buttons follow the valid-orders list (e.g. plow disabled
  for a soldier).
- `play.mjs` fortifies or sentries a unit and passes in both browsers.
- `./dev.sh -C engine gradle test`, `vp check` and `vp test` pass.
- Commits: Engine, then Browser UI, e.g.
  `Commands: fortify, sentry, skip and disband the active unit (#49)` and
  `Commands: plow, clear forest and build road (#49)`.

Traps:
- The starting units may not include a pioneer: give the test unit tools
  or create a hardy pioneer the way the existing tests set up units, or
  use the server's model directly in setup only.
- Fortify takes a turn to complete (FORTIFYING then FORTIFIED).
- Engine builds take minutes; pipe long output through `tail -30`.
- `vp check` fails on any lint warning.
