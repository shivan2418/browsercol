# What players complain about in FreeCol's and Colonization's trade routes

Research for #281, feeding #279 (our expanded trade routes). Scope: **FreeCol** and the **original Sid Meier's Colonization (1994, DOS v3.0, the version Steam and GOG sell)**. Civilization IV: Colonization and its mods are out of scope. They have a different route model (colony import/export plus automated transports), so their complaints don't carry over.

Sources are the FreeCol SourceForge bug and improvement trackers, the FreeCol forum, FreeCol GitHub issues, FreeCol's changelog and docs, the CivFanatics Colonization (Col1) threads, the GOG and Steam forums for the classic game, a 2000 fan FAQ, and a 2026 binary-patch project for Col1 v3.0. Every claim below links its source. Quotes are short and taken from the pages as fetched in November 2026.

## Summary: the top complaints

1. **The carrier sits idle or loads nothing, and the player can't see why.** In FreeCol the cause is almost always the colony's warehouse export level, a setting the route editor doesn't show. This is the single most common FreeCol report. *Partly covered by #279* (showing colony limits, amounts per stop). #279 should also say why a carrier is waiting.
2. **Carriers stop unloading and haul the same cargo forever.** In Col1 the cause is the boycott bug: a good boycotted in Europe is never delivered to your own colonies. FreeCol has had several regressions of the same kind. *Not covered by #279.*
3. **There are no amounts per stop: no "keep N here", no "deliver up to N".** FreeCol's maintainer accepted this request and called minimum stock especially important. *Covered by #279* (amounts per stop).
4. **Loads are all or nothing.** Goods that don't fit whole are skipped, and in Col1 a part-full hold blocks a later pick-up stop. *Covered by #279* (partial loads).
5. **Units drop off their route or stop following it.** Causes include routes to Europe, captured or disbanded colonies, unreachable stops, and plain bugs. *Partly covered by #279* (skip unreachable stops, check reach when assigning).
6. **The editor is hard to understand.** Players can't find where to set pick-up and drop-off, colony lists are unsorted, and the manual doesn't explain the rules. *Partly covered by the #279 editor prototype.*
7. **Unloading into a full colony wastes goods,** and FreeCol's overflow warnings have been wrong. *Partly covered* (showing colony limits). #279 should add "never unload past storage".
8. **There's no overview at scale.** Players can't tell route wagons from ordinary ones or see which unit runs which route. *Not covered by #279.*

## Ranked detail

Rank combines how many independent reports there are and how strongly they're worded. Developer replies saying "this trips people up" count as evidence of frequency.

### 1. "My wagon won't load / won't move" (hidden warehouse levels)

**Games:** FreeCol mainly. Col1 has no per-colony export level on routes; a FreeCol bug thread notes "Col1 lacks this feature" ([BR #3211](https://sourceforge.net/p/freecol/bugs/3211/)).

**The complaint:** A FreeCol route loads only what is above the source colony's export level (default 50). Nothing in the route editor shows that level. Carriers sit at a stop with their "T" marker, wait for stock that never comes, or leave with nothing, and players file the result as a bug.

- 2009: "Wagon trains from Ft Orange seemed to wait for about 50 units of each good." The developer's answer: "the wagon trains respect the export level settings of your warehouse" ([forum, Issue with trade routes](https://sourceforge.net/p/freecol/discussion/141201/thread/e82430af/)).
- 2014: a player's routes "picked up no goods" until he found the export setting, "which the online manual didn't explain". Mike Pope (maintainer): "this trips people up reasonably often" ([forum, Can't get Trade Routes to work](https://sourceforge.net/p/freecol/discussion/141201/thread/1cd5e16c/)).
- 2020: [BR #3211](https://sourceforge.net/p/freecol/bugs/3211/) "Wagon Train not following trade route". The colony had 28 wood against an export level of 50, so the ticket was closed invalid. A commenter proposed either ignoring export limits or a hint when routes are made; Pope: "Trade routes are hairy enough ATM".
- 2023: [BR #3321](https://sourceforge.net/p/freecol/bugs/3321/) "Traderoutes don't work", still open. The reporter wants the wagon to "always pick up everything that is specified".
- Older help threads show the same confusion: carriers "just sit in a port with the T for trade route, not moving" ([forum, How to create Trade route?](https://sourceforge.net/p/freecol/discussion/141201/thread/cbf7cefd/), 2007–2010).
- A 2009 request to show these levels in the route editor was accepted at priority 8 in 2015 and is still open ([IR #73](https://sourceforge.net/p/freecol/improvement-requests/73/)).

**#279:** "Show each colony's limits in the editor" answers IR #73 directly. "Amounts per stop" gives players a rule they set on the route itself instead of a hidden one. **Add:** when a carrier waits or leaves empty, say why in its status and turn report (for example "waiting at Jamestown: 28 lumber, keeps 50"). Pope's proposed "Goods Movement" messages ([forum thread](https://sourceforge.net/p/freecol/discussion/141201/thread/e82430af/)) were a start, but the 2020–2023 tickets show players still don't find the reason.

### 2. Carriers stop unloading and haul cargo forever

**Games:** Col1 (the long-standing boycott bug) and FreeCol (regressions).

**The complaint:** The carrier loads correctly and arrives, then never drops off. It shuttles the cargo with no message, and players fall back to unloading by hand for the rest of the game.

- Col1, 2003: "the wagon train forgets to unload", "the wagons just cycle through their colonies with cargo building up". The cause found in the same thread was "automated trade routes will never unload that goods" once a good is boycotted ([CivFanatics, Trade routes](https://forums.civfanatics.com/threads/trade-routes.52188)).
- Col1, 2000 fan FAQ, known bugs: "Wagon train on a trade route won't unload cargo… The only way around it is to unload the wagon train by hand" ([FAQ text](https://discmaster.textfiles.com/view/11517/Igromania_02.iso/train/coloniz.exe/colonization_a.txt)).
- Col1, GOG: "a bug that was present in the original game and that never was fixed" ([GOG, trade route boycott bug](https://gog.com/forum/colonization_sid_meiers/trade_route_boycott_bug)). On CivFanatics: "the trade route bug in the original which meant I had to move every wagon train manually for the whole game", and "This is clearly a bug" ([CivFanatics, Calling Col-oners, p.2](https://forums.civfanatics.com/threads/calling-col-oners.294439/page-2)). Also "a very annoying bug", where one player calls the extra management "a deal breaker" ([CivFanatics, Trade route bug (boycot)](https://forums.civfanatics.com/threads/trade-route-bug-boycot.480337/)).
- Col1 on Steam: "wagons occasionally glitch out and never unload", possibly after two wagons swap cargo in a colony ([Steam discussion](https://steamcommunity.com/app/327400/discussions/0/1473096694445666195)).
- Col1 root cause (2026): the route's drop-off loop checks the boycott flag of whichever nation was selected last. That is correct only at a Europe stop, so colony deliveries are refused silently. MicroProse's v3.0 patch fixed the manual "U" key and missed this path ([fcmircea/colonization-3.0-fixes](https://github.com/fcmircea/colonization-3.0-fixes); [CivFanatics thread](https://forums.civfanatics.com/threads/trade-routes-wont-deliver-boycotted-goods-root-cause-and-a-two-byte-fix.704173/)). The re:Colonization remake still carries the bug: "VERY ANNOYING when you have to load/unload the wagons manually for the rest of the game" ([CivFanatics, re:Colonization](https://forums.civfanatics.com/threads/re-colonization-sid-meiers-colonization-but-with-qol-updates-and-bugfixes.700134/)).
- FreeCol: [BR #2987](https://sourceforge.net/p/freecol/bugs/2987/) "wagon train on traderoute no longer unloads" (2016 regression); [BR #3352](https://sourceforge.net/p/freecol/bugs/3352/) "Wagon trains not offloading goods" with room to spare (fixed in 1.2.0); [BR #2819](https://sourceforge.net/p/freecol/bugs/2819/) "trade route unloads and directly reloads". The 1.2.0 changelog: "Allows automated trade routes to unload goods in colonies with more than 100 goods" (`freecol/CHANGELOG.md`).

**#279:** Not covered. **Add:** (a) A boycott (or any Europe-only rule) must never block a colony-to-colony delivery. Only a Europe stop should refuse to sell boycotted goods, and that refusal should be reported. (b) An Engine test that a route delivers a boycotted good between colonies. (c) Any cargo a carrier could not unload where the route says to should produce a message, never silence.

### 3. No amounts: "keep N here", "deliver at most N"

**Games:** FreeCol (requested for years, partly answered by the Enhanced trade routes option). Col1 routes have no amounts either.

- 2011, [IR #114](https://sourceforge.net/p/freecol/improvement-requests/114/) "Trade routes configurability": the reporter wants "to keep a minimum amount of a resource in the source city" and send the rest on. In 2015 Pope accepted it, raised it to priority 7 ("Trade route improvements are imminent"), and singled out minimum stock as especially important. It is still open.
- 2009, [IR #92](https://sourceforge.net/p/freecol/improvement-requests/92/) "TR unloads goods which it should load": a galleon dumped 163 cloth because the stop listed one hold of 100. The developer: "The routes follow the quantities set to the letter". The player proposed per-stop load options; the developer said they "would complicate matters too much". Still open.
- 2012: "it is imposible to set the level for unload the goods on wagon trains when they are on a trade route" ([forum, Visually identifying Route Wagons](https://sourceforge.net/p/freecol/discussion/719665/thread/60b17ca6/)).
- FreeCol's answer was the *Enhanced trade routes* option (2015, still labelled "EXPERIMENTAL!" in `FreeColMessages.properties`). It adds an import level so routes "will never unload more than this amount", and it sorts cargo "to maximize the amount transferred". Pope warned of "trade route strangeness" ([freecol-developers, 2015-10-27](https://sourceforge.net/p/freecol/mailman/message/34572003/)). It still fails in some cases: [BR #3363](https://sourceforge.net/p/freecol/bugs/3363/) (2024, open), furs not loading on an enhanced route.

**#279:** "Amounts per stop" ("load N", "unload N", "keep N here") covers this. It also replaces a colony-wide level with a per-route one, which is what IR #114 asked for.

### 4. All-or-nothing loading

**Games:** FreeCol and Col1.

- FreeCol: IR #114's 2011 list includes "goods cannot be partially loaded" ([IR #114](https://sourceforge.net/p/freecol/improvement-requests/114/)). As #279 records from the code, loading stops at the first type that doesn't fit whole, and a 3-hold load on a 2-hold wagon loads nothing.
- FreeCol, 2009: "Wait here until the wagon train is full", because a colony without a warehouse could only send 100 at a time ([IR #54](https://sourceforge.net/p/freecol/improvement-requests/54/), closed out of date in 2015).
- Col1: on a route with two pick-up stops, "the second stop loads nothing if the first stop put something in every hold, even if a hold is only part full". The example is a caravel with 124 sugar that skips a colony with 100 more ([colonization-3.0-fixes, Patch 3](https://github.com/fcmircea/colonization-3.0-fixes)).

**#279:** "Partial loads" covers this. **Add:** topping up part-full holds at a later stop, so the Col1 case doesn't recur in ours.

### 5. Units drop their route or stop following it

**Games:** FreeCol (many reports, mostly fixed one by one) and Col1.

- FreeCol 0.6–0.7 (2007): wagons "seem to 'lose' their assignment to the trade route", and "I have to set the orders, to go for that route again" ([forum, Trading routes](https://sourceforge.net/p/freecol/discussion/141200/thread/bd3036d1/)). The developer's rule: carriers should move on "whether or not they can load goods".
- FreeCol 0.10.5 (2012): "European trade routes are confirmed broken". The ship stops on the high seas or rests in London instead of returning ([BR #2438](https://sourceforge.net/p/freecol/bugs/2438/)).
- FreeCol: a colony captured by an enemy left a dead stop that blocked the game ([BR #2797](https://sourceforge.net/p/freecol/bugs/2797/); fixed by dropping the stop as invalid). "This trade route contains a invalid stop" appears in [the forum](https://sourceforge.net/p/freecol/discussion/141201/thread/3f1467e1/) and [IR #161](https://sourceforge.net/p/freecol/improvement-requests/161/).
- FreeCol 1.1.0 changelog: fixed "a bug that sometimes stopped trade routes / goto orders from working", for example "if there was a lost city rumor in the search area of a wagon train on a trade route".
- Col1: "Problems when city disbanded which is on a trade route" ([2000 FAQ](https://discmaster.textfiles.com/view/11517/Igromania_02.iso/train/coloniz.exe/colonization_a.txt)), and "sometimes the wagon trains make strange detours" ([CivFanatics, Calling Col-oners](https://forums.civfanatics.com/threads/calling-col-oners.294439/page-2)).

**#279:** "Skip a stop the carrier can't reach, with a message" and the reach checks at assign time cover the unreachable-stop part. #279's own finding, that a wagon given a Europe stop retries it every turn, belongs to this class. **Add:** treat a captured, abandoned or post-independence stop (Europe after the Declaration) the same way: skip it, keep the route, tell the player.

### 6. The editor and the rules are hard to understand

**Games:** FreeCol mainly. Col1 players remember its simple create/edit/delete menu with some fondness ([Calling Col-oners](https://forums.civfanatics.com/threads/calling-col-oners.294439/page-2): "I like the very simple mechanism in Col I").

- 2007: "The interface isn't intuitive". The same thread suggested splitting cargo into separate Load and Unload sections ([forum, Trading routes](https://sourceforge.net/p/freecol/discussion/141200/thread/bd3036d1/)). Also "I did not find the options to 'pick up' a cargo and to 'drop' a cargo" ([forum, How to create Trade route?](https://sourceforge.net/p/freecol/discussion/141201/thread/cbf7cefd/)).
- 2023, on IR #114: the interface is non-intuitive, "all destinations are empty", and drag and drop didn't work ([IR #114](https://sourceforge.net/p/freecol/improvement-requests/114/)).
- Editor bugs: a good added at one stop vanished from the palette at the others ([BR #3259](https://sourceforge.net/p/freecol/bugs/3259/)); unit hotkeys fired while typing in the editor ([BR #3209](https://sourceforge.net/p/freecol/bugs/3209/)).
- 2026: "Creating trade routes becomes a mess when you have multiple colonies". The stop list is in creation order. The reporter patched it to sort by name and suggests a searchable field ([FreeCol GitHub #168](https://github.com/FreeCol/freecol/issues/168)).
- The "everything not on the list is unloaded" rule surprises players. Hand-loaded wood "vanished" from a route wagon, and the ticket was closed invalid with "Trade routes _only_ transport what you have told them to" ([BR #3213](https://sourceforge.net/p/freecol/bugs/3213/)).
- Route naming is a chore; one player asked for auto names like "colony-to-colony" ([forum thread](https://sourceforge.net/p/freecol/discussion/719665/thread/60b17ca6/)).

**#279:** The Voyage (B1) prototype shows what each leg carries, which answers the load/unload confusion. **Add:** a sorted or searchable stop picker; a default route name built from its stops; a warning, or a "keep" option, when a unit with cargo not on its route is assigned to that route.

### 7. Unloading into a full colony wastes goods

**Games:** Col1 and FreeCol.

- Col1: "A trade route unloads everything it carries, even into a full colony; the excess spoils at the end of the turn". The game checks capacity only in the colony screen ([colonization-3.0-fixes, Patch 4](https://github.com/fcmircea/colonization-3.0-fixes)).
- FreeCol: warnings of waste were wrong because the capacity check ignored warehouse expansions ([BR #3336](https://sourceforge.net/p/freecol/bugs/3336/), fixed 1.2.0; earlier [BR #2972](https://sourceforge.net/p/freecol/bugs/2972/) "warehouse capacity calculated wrong"). IR #92 began as "63 cloth would be wasted" ([IR #92](https://sourceforge.net/p/freecol/improvement-requests/92/)). Preventing overflow was half the point of Enhanced trade routes ([mailing list](https://sourceforge.net/p/freecol/mailman/message/34572003/)).

**#279:** Showing colony limits and "unload up to N" help. **Add:** by default, a route never unloads past storage (food excepted, as FreeCol 1.2.0 does), and the rest stays aboard.

### 8. No overview of routes and route units

**Games:** FreeCol.

- "Glancing at it, I cannot tell whether it is a 'route wagon', or just one of my ordinary wagons" ([forum thread](https://sourceforge.net/p/freecol/discussion/719665/thread/60b17ca6/)). A developer called the missing "T" marker a bug.
- Assign routes from the Cargo Report, sorted by route ([IR #212](https://sourceforge.net/p/freecol/improvement-requests/212/)). Show a route's name and current destination when a transport is clicked ([IR #54](https://sourceforge.net/p/freecol/improvement-requests/54/)).
- With about 30 colonies, a turn took "3 hours". The player asks to see where wagons are and what each colony lacks ([IR #234](https://sourceforge.net/p/freecol/improvement-requests/234/)). A similar ask: map glyphs for what each town craves or overproduces, and suggestions of nearby trade partners ([FreeCol GitHub #163](https://github.com/FreeCol/freecol/issues/163)).

**#279:** Not covered. **Add (later):** a route list showing its units and each unit's next stop, plus a clear route marker on the map.

### Less frequent, still worth noting

- **Stop never ends / waits forever.** One player wants a wagon to stay "only one turn" at a stop whether or not goods are ready, and IR #114's list asks for a maximum wait per stop ([IR #114](https://sourceforge.net/p/freecol/improvement-requests/114/)). *Not covered by #279; a "wait at most N turns" setting per stop is cheap once stops have settings.*
- **No native or foreign stops.** IR #114 item 7 asks for Indian settlements as stops, with automatic or manual selling; developer Michael Vehrs: "I agree with item #7". Col1 doesn't allow it either ([Steam](https://steamcommunity.com/app/327400/discussions/0/1473096694445666195): "you can't set up trade routes with natives or other european factions"). *Not covered; out of #279's scope.*
- **Wagon to ship hand-off.** IR #114: wagons cannot transfer goods to ships ([IR #114](https://sourceforge.net/p/freecol/improvement-requests/114/)). *Not covered.*
- **Hard limits in Col1.** "you cannot create more than 11 trade routes. The 12th will break the game", and wagons are capped at the number of colonies ([GOG, a few cautions](https://gog.com/forum/colonization_sid_meiers/a_few_cautions_on_game_play); [2000 FAQ](https://discmaster.textfiles.com/view/11517/Igromania_02.iso/train/coloniz.exe/colonization_a.txt) "Editing a trade route when 12 trade routes are defined"). FreeCol keeps the wagon cap, with its own bug where a captured wagon still counts ([BR #3364](https://sourceforge.net/p/freecol/bugs/3364/), open). *Not a route-model issue; don't add a route limit.*
- **Europe as a stop.** Col1's editor doesn't list Europe as the first stop ([2000 FAQ](https://discmaster.textfiles.com/view/11517/Igromania_02.iso/train/coloniz.exe/colonization_a.txt) "your European port is not listed as a possible destination"). FreeCol had a run of Europe-route bugs (#2438 above).

## What #279 already covers, and what it should add

| Complaint | #279 today | Suggested addition |
|---|---|---|
| 1. Idle carrier, hidden export level | Show colony limits; amounts per stop | Say why a carrier waits or left empty |
| 2. Cargo never unloaded | — | Boycott never blocks colony deliveries; message on any failed unload; Engine test |
| 3. No amounts | Amounts per stop | — |
| 4. All-or-nothing loads | Partial loads | Top up part-full holds at later stops |
| 5. Units drop the route | Skip unreachable stops; reach checks at assign | Same handling for captured/abandoned colonies and Europe after independence |
| 6. Confusing editor | Voyage prototype | Sorted/searchable stops; default route names; warn about cargo not on the route |
| 7. Overflow waste | Colony limits shown | Never unload past storage by default (food excepted) |
| 8. No overview | — | Route list with units and next stops; map marker (later) |
| Waits forever | — | Optional "wait at most N turns" per stop |

## Sources

FreeCol trackers and forum (SourceForge):
- Bugs: [#2438](https://sourceforge.net/p/freecol/bugs/2438/), [#2797](https://sourceforge.net/p/freecol/bugs/2797/), [#2819](https://sourceforge.net/p/freecol/bugs/2819/), [#2972](https://sourceforge.net/p/freecol/bugs/2972/), [#2987](https://sourceforge.net/p/freecol/bugs/2987/), [#3209](https://sourceforge.net/p/freecol/bugs/3209/), [#3211](https://sourceforge.net/p/freecol/bugs/3211/), [#3213](https://sourceforge.net/p/freecol/bugs/3213/), [#3259](https://sourceforge.net/p/freecol/bugs/3259/), [#3321](https://sourceforge.net/p/freecol/bugs/3321/), [#3336](https://sourceforge.net/p/freecol/bugs/3336/), [#3352](https://sourceforge.net/p/freecol/bugs/3352/), [#3363](https://sourceforge.net/p/freecol/bugs/3363/), [#3364](https://sourceforge.net/p/freecol/bugs/3364/)
- Improvement requests: [#54](https://sourceforge.net/p/freecol/improvement-requests/54/), [#73](https://sourceforge.net/p/freecol/improvement-requests/73/), [#92](https://sourceforge.net/p/freecol/improvement-requests/92/), [#114](https://sourceforge.net/p/freecol/improvement-requests/114/), [#161](https://sourceforge.net/p/freecol/improvement-requests/161/), [#212](https://sourceforge.net/p/freecol/improvement-requests/212/), [#234](https://sourceforge.net/p/freecol/improvement-requests/234/)
- Forum: [Trading routes (2007)](https://sourceforge.net/p/freecol/discussion/141200/thread/bd3036d1/), [How to create Trade route? (2007–10)](https://sourceforge.net/p/freecol/discussion/141201/thread/cbf7cefd/), [Issue with trade routes (2009–11)](https://sourceforge.net/p/freecol/discussion/141201/thread/e82430af/), [Visually identifying Route Wagons (2012)](https://sourceforge.net/p/freecol/discussion/719665/thread/60b17ca6/), [Invalid Stop Trade Routes (2012)](https://sourceforge.net/p/freecol/discussion/141201/thread/3f1467e1/), [Can't get Trade Routes to work (2014)](https://sourceforge.net/p/freecol/discussion/141201/thread/1cd5e16c/)
- Developer mailing list: [Enhanced trade routes, 2015-10-27](https://sourceforge.net/p/freecol/mailman/message/34572003/)
- Docs: [Trade Routes](https://www.freecol.org/docs/node34.html); `freecol/CHANGELOG.md` (1.1.0, 1.2.0) and `freecol/data/strings/FreeColMessages.properties` in our pinned clone

FreeCol GitHub: [#163](https://github.com/FreeCol/freecol/issues/163), [#168](https://github.com/FreeCol/freecol/issues/168)

Colonization (1994):
- CivFanatics: [Trade routes (2003)](https://forums.civfanatics.com/threads/trade-routes.52188), [Calling Col-oners, p.2](https://forums.civfanatics.com/threads/calling-col-oners.294439/page-2), [Trade route bug (boycot)](https://forums.civfanatics.com/threads/trade-route-bug-boycot.480337/), [root cause and a two-byte fix (2026)](https://forums.civfanatics.com/threads/trade-routes-wont-deliver-boycotted-goods-root-cause-and-a-two-byte-fix.704173/), [re:Colonization](https://forums.civfanatics.com/threads/re-colonization-sid-meiers-colonization-but-with-qol-updates-and-bugfixes.700134/)
- GOG: [trade route boycott bug](https://gog.com/forum/colonization_sid_meiers/trade_route_boycott_bug), [a few cautions on game play](https://gog.com/forum/colonization_sid_meiers/a_few_cautions_on_game_play)
- Steam: [Colonization (Classic) discussion](https://steamcommunity.com/app/327400/discussions/0/1473096694445666195)
- Fan FAQ (2000): [colonization_a.txt](https://discmaster.textfiles.com/view/11517/Igromania_02.iso/train/coloniz.exe/colonization_a.txt)
- Binary fixes with root-cause analysis: [fcmircea/colonization-3.0-fixes](https://github.com/fcmircea/colonization-3.0-fixes)

## Limits of this research

- No Reddit threads about FreeCol or Col1 trade routes turned up in search. Steam has no reviews of the classic game that discuss routes, only the one discussion thread cited.
- The Civilization Wiki "Bugs (Col)" page returned HTTP 402 and couldn't be read.
- The GameFAQs Col1 FAQ mirror timed out.
- The forum and tracker pages were read through a summarising fetcher. Quotes are as it returned them and were spot-checked for consistency but not character by character.
- Civ4: Colonization and its mods were left out on purpose (see the top of this page).
