# FreeCol bugs we fix

Bugs in FreeCol itself (the code we clone from GitHub, `FreeCol/freecol`, at
`freecol.sha`) that this repo fixes in `engine/patches`. Each fix is marked
`// online:` in the patched file (see `engine/patches/README.md`). Add a row
when you add such a fix, and keep it when FreeCol fixes the bug too, noting
the FreeCol commit, so the patch can be dropped at the next pin.

FreeCol's own bug tracker is on SourceForge
(https://sourceforge.net/p/freecol/bugs/); its commits cite those numbers.

| Bug | Fixed in | Our issue / commit | FreeCol report | Upstream status |
| --- | --- | --- | --- | --- |
| Thomas Paine's bells bonus stays 0 on the server from the turn he joins until the tax next changes or the game is reloaded; the client shows it at once. `Player.addFather` never calls `recalculateBellsBonus`. | `common/model/Player.java` (`addFather`) | #169 | [#2187](https://sourceforge.net/p/freecol/bugs/2187/) (2011, the same symptom, closed as fixed in 0.10.1) | Still in FreeCol's code at our pin and on its newer branches. Fix sent as [FreeCol PR #181](https://github.com/FreeCol/freecol/pull/181) (2026-11-06). |
| A trade route's "silent" flag is lost when the server copies the route in (`TradeRoute.copyIn` skips it). | `common/model/TradeRoute.java` (`copyIn`) | #70 (348b3b0) | None found | Not reported. |
| Open sessions (a monarch's offer, a trade) outlive their game: `Session`'s registry is static and FreeCol clears it only when it loads a saved game, so a new game in the same JVM that reaches the same session (same player ids) fails with "Duplicate session". Declaring independence opens one, the mercenary offer. | Not a patch: `ServerEngine.startGame` calls `Session.clearAll()` | Found while testing the War of Independence | None found | Not reported. |
| Declaring independence the turn a monarch question (a tax raise) was answered stops half done with "Duplicate session": the answered session stays registered until the next turn, and the declaration's mercenary offer makes one with the same key. | `server/model/Session.java` (the constructor drops a completed session with the same key) | #173 | None found | Not reported. |
| Land and water share contiguity numbers: `Map.resetContiguity` numbers water regions from 0, then land regions from 0 again, because `floodFill` takes the counter by value (a 2016 refactor, dd25491e1). The first land region (the northern polar strip) shares 0 with the main ocean, so `findMapPath` takes a land unit's walking path from a ship on that ocean to that land. The path does not use the carrier, so `shouldTakeTransportTo` says the unit needs no transport, its transport mission finds no destination for it, and the ship carries it back to Europe: the REF never lands beside a colony on the polar strip. | `common/model/Map.java` (`resetContiguity`, `floodFill`) | #172 | None found | Still in FreeCol's master (85f3eb9a2, 2026-10-29). Report drafted on #172, not yet filed. |
| The intervention force crashes the turn when the rebels have no port left: once liberty reaches `interventionBells` after the REF has taken their last connected port, `ServerPlayer.csNewTurn` picks a random member of the empty `getConnectedPortList()` and dereferences null, killing the thread that ends the turn. The patch holds the intervention (bells kept, nothing announced) until a connected port exists. | `server/model/ServerPlayer.java` (`csNewTurn`) | #224 | None found | Not reported. |
| Building a colony with a unit that can't names the unit as "null" ("Your null can not build a colony."): `buildColony.badUnit` takes `Unit.getName()`, which is null for every unit never renamed. Desktop FreeCol never shows the message, because its Build Colony action is disabled for such a unit. Our patch also adds the reason, which is a change of our own, not part of the bug fix. | `client/control/InGameController.java` (`buildColony`, marked `// browser:`) | #19 | None found | Not reported. Latent upstream: Swing doesn't reach it. |

## Other changes to what FreeCol does

Not bug fixes FreeCol would take as they are, but each one makes our Engine
behave a little differently from desktop FreeCol. The pure platform changes
(Swing, sound, files, TeaVM) that leave the game the same are listed in
`engine/patches/README.md`, not here.

| Change | Where | Why | Effect on the game |
| --- | --- | --- | --- |
| Saving reseeds the game's random generator from itself and saves that seed. | `common/util/Utils.java` (`// browser:`) | TeaVM has no Java serialization, and a `Random`'s seed can't be read. | After a save, the game draws different numbers than an unsaved game would. It draws the same numbers as a game loaded from that save, so save and load agree. |
| The message bundle is a volatile reference to a concurrent map. A reload fills a new map and swaps it in. | `common/i18n/Messages.java` (`// online:`) | #228: a game still reading text while the bundle reloads (a second Engine, a test's tail) saw it empty. | None for the player. Possibly a latent FreeCol race, but desktop FreeCol reloads only at startup. |
| After a native trade, the client updates the GUI once more, so a unit the trade left without moves is replaced as the active unit. | `client/control/InGameController.java` (`nativeTradeHandler`, `// browser:`) | #299: the WebGUI runs deferred work at once, so the move's own update ran before the trade used the moves. | None in rules. Matches what desktop FreeCol shows. |
| Building a colony with a unit that can't also says why. | `client/control/InGameController.java` (`buildColony`, `// browser:`) | Desktop FreeCol disables the action instead and never shows the message. | Text only. |
| A new game clears the registry of open sessions (`Session.clearAll()`). | `browsercol.web.ServerEngine.startGame`, not a patch | FreeCol clears it only on loading a save; several games run in one Engine. | None. Listed above as a bug too. |

## Known, not fixed

| Bug | Where | Notes |
| --- | --- | --- |
| Paine's bells modifier is meant to be a template copied per player (the spec says so), but every player who has Paine shares the one modifier, so its value is the tax of whichever player's tax was set last. | `Player.recalculateBellsBonus` | #313. Found while fixing #169; only matters when two players both have Paine, which includes an AI rival. A first attempt at a per-player copy changed the bells count (9 instead of 8 at 20% tax) for a reason not yet understood, so it was left out. |

## Text we reword

Not bugs in the code, but FreeCol's English text promises something its
rules do not do. The replacements are in `Messages.CLARIFIED`
(`common/i18n/Messages.java`); translations keep their own text.

| Text | What it said | What the rules do |
| --- | --- | --- |
| Father Jean de Brebeuf's description | "All missionaries function as experts." | Missionaries get the expert missionary ability (doubled calming of the natives, better at denouncing), but conversion goes by the missionary's unit type, so they convert no faster. |
