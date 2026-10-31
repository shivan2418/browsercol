Issue #50: the WebGUI now answers FreeCol's select destination dialog
(see `SelectDestinationTest`), but nothing in the Browser UI opens it. In
FreeCol it comes from the Go To action (`GotoAction`, key H), which calls
`InGameController.selectDestination(unit)`. Add that order.

Where: follow exactly how #49 added the other unit orders (look at
`git log --grep '#49'`): `Commands.java`, `ClientMain.java`,
`ui/src/channel.ts`, `ui/src/input.ts`, `ui/src/side.tsx` and their
tests; `ui/scripts/play.mjs` if it has a unit-orders step to extend.

Do:
- A `goTo` order for the active unit (name it so it does not clash with
  the existing map-click `goTo(x, y)`; say what you chose), key H as
  Swing binds it, and a side-panel button enabled when GotoAction's
  `shouldBeEnabled` would be.
- Through the client controller only.

Done when:
- A Commands test: the order on a ship asks the destination question;
  answering Europe gives the ship Europe as its destination on the
  server, and the ship reaches Europe after ending turns (bounded loop).
- A UI test for the key and the button.
- Engine tests, `vp check`, `vp test` and `play.mjs` pass.
- One commit, e.g. `Commands: the Go To order, to send a ship to Europe (#50)`.

Traps:
- Check `input.ts` for an existing H binding.
- Engine builds take minutes; pipe long output through `tail -30`.
