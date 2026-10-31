Issue #39: `./dev.sh -C ui npx vp check` passes but prints lint warnings on
every run, so a new warning is easy to miss.

Known warnings (run `vp check` first and fix every one it prints, these or
others):
- `typescript(unbound-method)` at `ui/src/panels.tsx` (~line 198):
  `useSyncExternalStore(dialogs.subscribe, dialogs.current)` passes both
  methods unbound. Either wrap them in arrows at the call, or make the
  `Dialogs` members arrow properties so the rule knows they don't use
  `this`. Pick the one that reads best with the surrounding code.
- `typescript(restrict-template-expressions)` at `ui/scripts/play.mjs`
  (~line 223): the resize error message puts `number[]` values in a template
  literal. Use the script's `label()` helper if it fits, else
  `JSON.stringify`.

Then: make warnings fail `vp check`, so none can come back. Find how
Vite+'s check/lint is configured (`ui/vite.config.ts`, package.json, any
oxlint config) and the documented way to deny warnings; if there is no
config switch, say so in the report instead of wrapping the command.

Done when:
- `vp check` prints no warnings, and fails if you temporarily reintroduce
  one (check this, then undo it; say in the report that you did).
- `vp test` passes.
- Commits: one for the fixes, one for failing on warnings, subjects like
  `vp check: clear the lint warnings it prints on every run (#39)`.

Traps:
- Do not silence a rule with a disable comment or by turning the rule off;
  fix the code.
- play.mjs needs a browser to run; you cannot run it here. Change only the
  message, nothing the script does.
