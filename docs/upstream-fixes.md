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
| Thomas Paine's bells bonus stays 0 on the server from the turn he joins until the tax next changes or the game is reloaded; the client shows it at once. `Player.addFather` never calls `recalculateBellsBonus`. | `common/model/Player.java` (`addFather`) | #169 | [#2187](https://sourceforge.net/p/freecol/bugs/2187/) (2011, the same symptom, closed as fixed in 0.10.1) | Still in FreeCol's code at our pin and on its newer branches. Not yet reported again. |
| A trade route's "silent" flag is lost when the server copies the route in (`TradeRoute.copyIn` skips it). | `common/model/TradeRoute.java` (`copyIn`) | #70 (348b3b0) | None found | Not reported. |
| Open sessions (a monarch's offer, a trade) outlive their game: `Session`'s registry is static and FreeCol clears it only when it loads a saved game, so a new game in the same JVM that reaches the same session (same player ids) fails with "Duplicate session". Declaring independence opens one, the mercenary offer. | Not a patch: `ServerEngine.startGame` calls `Session.clearAll()` | Found while testing the War of Independence | None found | Not reported. |
| Declaring independence the turn a monarch question (a tax raise) was answered stops half done with "Duplicate session": the answered session stays registered until the next turn, and the declaration's mercenary offer makes one with the same key. | `server/model/Session.java` (the constructor drops a completed session with the same key) | #173 | None found | Not reported. |

## Known, not fixed

| Bug | Where | Notes |
| --- | --- | --- |
| The REF never lands beside a colony in the map's north-east corner (38,1 on the dutch-small map): its ships reach the coast and sail back to Europe. On an open coast it lands at once. | `REFAIPlayer` / `TransportMission` | #172; `IndependenceTest.theREFLandsBesideAColonyInTheMapsCorner` is disabled for it. |
| Paine's bells modifier is meant to be a template copied per player (the spec says so), but every player who has Paine shares the one modifier, so its value is the tax of whichever player's tax was set last. | `Player.recalculateBellsBonus` | Found while fixing #169; only matters when two players both have Paine. A first attempt at a per-player copy changed the bells count (9 instead of 8 at 20% tax) for a reason not yet understood, so it was left out. |

## Text we reword

Not bugs in the code, but FreeCol's English text promises something its
rules do not do. The replacements are in `Messages.CLARIFIED`
(`common/i18n/Messages.java`); translations keep their own text.

| Text | What it said | What the rules do |
| --- | --- | --- |
| Father Jean de Brebeuf's description | "All missionaries function as experts." | Missionaries get the expert missionary ability (doubled calming of the natives, better at denouncing), but conversion goes by the missionary's unit type, so they convert no faster. |
