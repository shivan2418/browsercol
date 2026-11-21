# Colonization (1994): how the Crown changes the tax rate, from public sources

Researched 2026-11-21 for a clean-room reimplementation. The sources here are the
manual, the official strategy guide, magazine articles, player FAQs, wikis and
forum posts. Anything based on disassembly, decompiling, patched executables or
savegame layouts is listed in section 5 and none of its claims are used.

Main sources, with short tags used in the tables:

| Tag | Source | Type |
|---|---|---|
| MAN | *Sid Meier's Colonization* manual (MicroProse, 1994), OCR text at <https://archive.org/details/Sid_Meiers_Colonization_manual>. Page numbers are the printed ones where the OCR shows them. | manual |
| OSG | Bruce Shelley, *Sid Meier's Colonization: The Official Strategy Guide* (Prima, 1995), taxes on pp. 107-110 (page numbers marked "~" are estimated from sparse OCR page markers), OCR at <https://archive.org/details/sid-meier-s-colonization-official-strategy-guide>. Shelley worked at MicroProse, and the book has "Design Notes" on how development builds behaved. | guide |
| CGW-R | *Computer Gaming World* #125 (Dec 1994), review of Colonization, <https://archive.org/details/Computer_Gaming_World_Issue_125> | magazine |
| CGW-S | Michael Rysmaszewski, "Of Noble Savages And Savage Europeans", *Computer Gaming World* #126 (Jan 1995), p. 80, <https://archive.org/details/Computer_Gaming_World_Issue_126> | magazine (strategy article, player report) |
| FAQ2 | Jim Cox and Dar Steckelberg (eds.), *Frequently Asked Questions for "Colonization"* v2.0 (Usenet era, about 1995), GameFAQs 1516, archived at <http://web.archive.org/web/20110625014203/http://www.gamefaqs.com:80/pc/562685-sid-meiers-colonization/faqs/1516> | player FAQ |
| JEZ | Jeremy Morton (jez9999), *Sid Meier's Colonization - guide, strategy and tips* v1.0, GameFAQs 68691, archived at <http://web.archive.org/web/20150415071243/http://www.gamefaqs.com:80/pc/562685-sid-meiers-colonization/faqs/68691> | player guide |
| WIN | *Winning at Colonization, or Economic Warfare for Fun and Profit*, GameFAQs 1517, archived at <http://web.archive.org/web/20100515215910/http://www.gamefaqs.com:80/pc/562685-sid-meiers-colonization/faqs/1517> | player guide |
| CHEAT | Dan Simpson, *Your Guide to Cheating at Colonization* v1.61 (2005), GameFAQs 2077, archived at <http://web.archive.org/web/20110218071124/http://www.gamefaqs.com:80/pc/562685-sid-meiers-colonization/faqs/2077>. It covers the game's built-in cheat mode only. | player guide |
| SW | StrategyWiki, "Sid Meier's Colonization/Overseas relations", Taxes section, archived 2023-01-27 at <http://web.archive.org/web/20230127120503/https://strategywiki.org/wiki/Sid_Meier%27s_Colonization/Overseas_relations> | wiki (player-written) |
| FW-TAX | Civilization Wiki (Fandom), "Tax rate (Col)", <https://civilization.fandom.com/wiki/Tax_rate_(Col)>. The page was created 2026-01-16. The difficulty table and the "75%" line were added 2026-05-09 by user Tristanzz with no citation. | wiki |
| FW-BOY | Civilization Wiki (Fandom), "Boycott (Col)", <https://civilization.fandom.com/wiki/Boycott_(Col)> | wiki |
| FW-FAQ | Civilization Wiki (Fandom), "FAQ on tactics (Col)", <https://civilization.fandom.com/wiki/FAQ_on_tactics_(Col)>, mostly written 2016 by Robin Patterson | wiki (player-written) |
| LIL | Lilura1, "Sid Meier's Colonization Guide & Review", <https://lilura1.blogspot.com/p/sid-meiers-colonization.html>, the author's own play and speed-run notes | player report |
| STEAM | Steam, Sid Meier's Colonization (Classic) discussions, "Boycotts - just pay the fine - 0% tax?" (2024-25), <https://steamcommunity.com/app/327400/discussions/0/4199112089437143365/> | player reports |
| CF-TR | CivFanatics, "[Col] Trade route bug (boycot)" (2012), <https://forums.civfanatics.com/threads/trade-route-bug-boycot.480337/> | player reports |
| CF-LOVE | CivFanatics, "Love the original, but this game has issues" (2012), <https://forums.civfanatics.com/threads/love-the-original-but-this-game-has-issues.458412/> | player reports (Col1 comparisons in a Civ4Col thread) |
| CF-BOY | CivFanatics, "Is there any way to cancel a trade boycott on a resource?" (2008), <https://forums.civfanatics.com/threads/is-there-any-way-to-cancel-a-trade-boycott-on-a-resource.293707/> | player reports (Col1 recollections in a Civ4Col thread) |

## 1. Claims

"Sureness" is how the source itself sounds, not how far I trust it.

### 1a. When and why the rate goes up

| # | Claim | Source | Type | Sureness |
|---|---|---|---|---|
| 1 | At the start the King supports the colonies "free of charge". As time goes on he wants a larger cut, mainly through taxes. | MAN p. 84, "Taxation and Boycott" | manual | firm |
| 2 | "From time to time, he increases your tax rate." | MAN, "Taxation" (intro chapter) | manual | firm, but vague on timing |
| 3 | "He may also increase taxes whenever his government intervenes upon your behalf." | MAN, "Taxation" (intro chapter) | manual | firm, hedged with "may" |
| 4 | Tax-rate changes are processed among the "European Issues" at the start of each player's turn, before colony events. | MAN, turn sequence ("European Issues") | manual | firm |
| 5 | The King announces every increase and gives a reason for each new tax. | MAN p. 84 | manual | firm |
| 6 | The Crown is "continually raising taxes (for what appear to be whimsical purposes)". | MAN, "Increasing Tensions" | manual | firm, flavour text |
| 7 | Early on the King "does not intrude"; he "soon" starts taxing exports to Europe. | OSG p. 108 | guide | firm |
| 8 | "The King will be more inclined to raise taxes early and often at the higher levels" of difficulty. | OSG p. ~230, difficulty list | guide | firm |
| 9 | "Depending on the difficulty level, your King will gradually or rapidly increase taxes." | CGW-R | magazine | firm |
| 10 | The first tax year and the interval between increases are fixed (not random) and set by difficulty: Discoverer 1536 / 22 turns, Explorer 1532 / 20, Conquistador 1528 / 18, Governor 1524 / 16, Viceroy 1534 / 14. | FW-TAX | wiki | firm. **Provenance unclear**: no citation, added in 2026. The Viceroy year breaks the otherwise regular pattern. |
| 11 | During development, buying ships or artillery or hiring experts in Europe was always followed by a tax rise. That link "was eliminated" before release. | OSG p. 109, Design Note | guide (developer-side) | firm |
| 12 | Accepting help from the mother country "will be followed by a hefty tax-hike" (said of mercenaries and help in a war). | FAQ2 Q6, attributed to Mark Willoughby | player report | firm, second-hand |
| 13 | If you have no warships and a privateer attacks your ship, the home country offers you a frigate. Accepting it raises the tax rate by a lot, "7 or 8 percent". | FW-FAQ, Boycotts section | player report | firm |
| 14 | The King "will soon be levying taxes to support his war efforts and marriage celebrations" (the stated reasons for taxes). | FAQ2, introduction | player report | firm, flavour |
| 15 | "The King's War": while you are at peace, the King may declare war on another power and send you gold and three Veteran Soldiers. The guide does **not** link this to a tax rise. | OSG p. ~156, "The King's War" | guide | firm |
| 16 | Without a coastal colony (next to an ocean tile) the King never places a tax on any specific good. | STEAM, VagrantHere, 2024-10-26 | player report | firm in wording, but the same post works from memory |

### 1b. Size of an increase and limits

| # | Claim | Source | Type | Sureness |
|---|---|---|---|---|
| 17 | The first tax is "like 2%". "In time he will tax you 100%." | STEAM, VagrantHere | player report | "If I remember correctly" |
| 18 | On the hardest difficulty, increases come as "1-2%" ones and "higher demands". Accepting the small ones and refusing the big ones gets you to independence at "around 10% tax". | STEAM, Kiesel, 2025-02-18 | player report | firm (advice from play) |
| 19 | Small raises are 1-2%. A raise of 5% or more counts as "huge". Accepted raises are "irreversible". | SW | wiki (player) | firm |
| 20 | The frigate offer brings a 7-8% rise. | FW-FAQ (see #13) | player report | firm |
| 21 | "Highest tax rate imposed by the Crown: 75%", and "tax can actually decrease by a few percent post-max". | LIL | player report | firm |
| 22 | "The maximum tax rate is 75%." | FW-TAX | wiki | firm. **Provenance unclear** (no citation). The same number appears in an excluded source (section 5), so this may not be independent of it. |
| 23 | "Outrageous tariffs (up to 75%)." | LIL | player report | firm |
| 24 | Rates players report reaching: always 0% (CF-TR, AnorakTel, 2012). Always about 40% because they wouldn't boycott ore, tools and food/lumber (CF-TR, Flixton, 2012). A whole game at zero tax "by manipulating boycotts" (CF-LOVE, dalgo, 2012). 0% by relying on custom houses (STEAM, kharille, 2024). 4% and 7% in quoted sale messages (JEZ). | as listed | player reports | firm |

### 1c. Can the rate go down?

| # | Claim | Source | Type | Sureness |
|---|---|---|---|---|
| 25 | "My copy of COLONIZATION repeatedly reduced the tax rate to zero starting from the War of the Spanish Succession, when one of the colonial powers drops out. It didn't happen in every game I played." | CGW-S p. 80 | magazine / player report | firm about his own games, framed as possibly specific to "my copy" |
| 26 | The tax can decrease by a few percent after reaching the maximum. | LIL | player report | firm |
| 27 | "Sometimes if you load a saved game, the tax rate is reset to zero. Doesn't always happen." Listed as a bug. | FAQ2, bugs section "d." | player report | firm, says it's intermittent |
| 28 | The built-in cheat mode has keys on the Europe screen to lower ("[") and raise ("]") the tax rate by 1%. | CHEAT | player guide | firm |
| 29 | The manual and the official guide describe no way to lower the rate apart from refusing a new increase. | MAN, OSG (absence) | manual / guide | (absence) |

### 1d. What the tax applies to

| # | Claim | Source | Type | Sureness |
|---|---|---|---|---|
| 30 | "Each transaction is taxed at this rate and the yield goes into the King's treasury." (Europe screen transaction monitor.) | MAN p. ~63, "Transaction Monitor" | manual | firm |
| 31 | The tax is taken from *sales* in Europe. "There is no tax on commodities purchased in Europe." Example: at 10%, a 1,000-gold sale nets 900. | OSG p. 108 | guide | firm |
| 32 | The King takes "a percentage of every transaction". | CGW-R | magazine | firm (paraphrase) |
| 33 | Treasure brought home on your own galleon is reduced by the current tax rate. | OSG, treasure section; WIN ("less the tax rate") | guide / player report | firm |
| 34 | No tax on trade with natives or with rival colonies (rival colonies need Jan de Witt). | OSG "Native Trade" and "Colonial Trade" (pp. ~105-108) | guide | firm |
| 35 | Custom house sales before independence pay the normal tax. A quoted message: "Fort Orange sells 56 Tobacco for 224. 4% Tax: 8. Net: 216". | JEZ; FAQ2 ("minus tax, of course") | player reports | firm, with a quoted in-game message |
| 36 | After independence no tax goes to the Crown. Custom house trade continues at 50% of normal income. | MAN, "Trade During the Rebellion"; OSG p. 110 | manual / guide | firm |
| 37 | After independence custom-house trade may carry "hefty taxes" as smuggling. | JEZ | player report | loose; probably the same 50% cut as #36 |
| 38 | Tax revenue paid in Europe adds to the Royal Expeditionary Force, but only a little. Development builds tied the REF size closely to taxes, and that was toned down. | OSG p. 108 (Design Note), p. 169, p. ~194 | guide | firm |

### 1e. Refusing: the "party" and the boycott

| # | Claim | Source | Type | Sureness |
|---|---|---|---|---|
| 39 | When the King raises the rate, "some of your people *may* rise up". You choose to submit or to demonstrate. | MAN p. 84 | manual | firm; "may" suggests the option isn't always offered |
| 40 | "You're always given the option" of a tea party. | JEZ | player report | firm |
| 41 | To hold a party you need at least one unit of a non-boycotted good in a coastal colony. Once every good you hold is boycotted, no party is possible. | JEZ | player report | firm |
| 42 | Demonstrating throws cargo into the sea, refuses the new tax and **raises rebel sentiment**. That good can't be bought or sold in Europe until all back taxes are paid. | MAN p. 84 | manual | firm |
| 43 | A tax revolt "nullifies" the increase just announced. | OSG p. 109 | guide | firm |
| 44 | The colony named "gets rid of a lot of those goods - possibly all that the city has in stock (not sure)". The tax rise doesn't happen. | FAQ2 Q17 (Stuart Lamble) | player report | partly "not sure" |
| 45 | The good chosen for the party is "the item that you could sell for the most in your stock (total amount of stock in city * rate you can sell good in Europe)". | SW | wiki (player) | "the king likes to" (a tendency) |
| 46 | The good chosen is "generally either a good in a ship which is just about to arrive in Europe or the most valuable cargo you have in a colony". To avoid a tools boycott, never stockpile tools. | FW-FAQ | player report | "generally" |
| 47 | The good chosen "tends to be whatever goods you have the most of on hand". | FW-BOY | wiki | "tends to" |
| 48 | The rate does not rise "this time". Trading the boycotted good in Europe then needs a large gold payment. | FW-BOY | wiki | firm |
| 49 | Paying the back taxes costs "as much as if you bought 500 tons of the boycotted good", i.e. 500 times the asking price (cotton at 5/7 gives 3,500). | SW; FW-TAX repeats it, citing SW | wiki (player) | firm, with a worked example |
| 50 | "The fine is based on the price of the good in Europe ... At playing level 3 it is like 500 per European cost." | STEAM, rjonescss, 2024-08-14 | player report | "like" |
| 51 | Back taxes are "usually around 3000 to 6000 gold". | FAQ2 Q17 | player report | "usually" |
| 52 | Reported fine sizes: "only 1000 gold" (kharille, second-easiest difficulty). "Lowest I've had is 2,400...maybe?" (moslow1974). | STEAM | player reports | the second one is unsure |
| 53 | You pay back taxes by clicking the boycotted good on the Europe screen. | MAN p. 85; CF-BOY (Pep, "as far as I remember") | manual / player report | firm |
| 54 | Jakob Fugger clears all current boycotts with no back taxes. Later boycotts can still happen. | MAN p. 92; OSG p. ~165 | manual / guide | firm |
| 55 | The custom house sells goods "even if they are currently under parliamentary boycott". So with custom houses you can refuse every increase. | JEZ; FW-TAX (custom house "bypasses any boycotts") | player report / wiki | firm |
| 56 | Pressing "U" to unload in Europe sells a boycotted good anyway, called a bug. | FAQ2, bugs "c." and Fugger note | player report | firm |
| 57 | After independence all boycotts are lifted and the rate is fixed. | Search-result summaries of Civ4Col threads only; no Col1 source found | — | not usable for Col1 |
| 58 | Thomas Paine raises liberty bell production in all colonies by the current tax rate (in percent). | MAN p. 91; OSG p. ~165 | manual / guide | firm |
| 59 | Because of Paine, a high tax rate is worth something. Don't take Paine until the rate has had time to rise. | OSG p. 110; FAQ2 | guide / player report | advice |

## 2. Black-box experiments found

**I found no published black-box experiment on the 1994 game's tax rate.** Nobody
logged a set of games and counted when increases happened, how big they were, or
what triggered them. The closest material:

- **SW, back-tax cost.** One worked example (cotton, price 5/7, back taxes
  3,500) behind the "500 × asking price" rule. There's no sample count, and it
  isn't clear whether the author checked more than one good or difficulty.
- **JEZ, one quoted message.** One custom-house sale message showing the tax
  taken at the current rate (56 tobacco × 4 = 224; 4% = 8, rounded down from
  8.96). One sample, but it shows the rounding.
- **CGW-S, rate falling to zero.** One player's "many" games (not counted). The
  rate fell to zero after the War of the Spanish Succession event in some games
  and not others.
- **OSG, REF growth.** One Governor game played to 1697. The REF grew from
  39/20/20/11 to 64/22/20/11, which the guide partly credits to tax revenue.
  This is about the REF, not the tax rate.
- **LIL, speed run.** One documented speed run (Iron Man, Discoverer). It
  reports the 75% maximum and decreases after the maximum, but publishes no
  per-turn log.

Every number on timing (FW-TAX's schedule) comes without a method, so it can't
be counted as an experiment.

## 3. Disagreements and gaps

### Disagreements

1. **Are purchases taxed?** The manual (#30) says "each transaction is taxed",
   and CGW-R (#32) repeats "every transaction". The official guide (#31) says
   only sales are taxed and purchases are not. The manual's line sits in a
   section about the sale monitor, so it may just be loose wording.
2. **Is timing fixed or random?** FW-TAX (#10) gives a fixed per-difficulty
   schedule. The manual (#2, #6) and player guides say "from time to time",
   "every now and then", "whimsical". OSG (#8) says only that higher levels
   raise taxes "early and often". No source connects timing to how much you
   trade in the 1994 game; that idea appears only in Civ4Col sources (section 5).
3. **What triggers an increase besides time?** The manual (#3) says the King
   "may" raise taxes when his government intervenes for you, and FAQ2 (#12) and
   FW-FAQ (#13) back that up with mercenary or frigate help. OSG (#11) says the
   link between European *purchases* and tax rises was removed before release.
   OSG (#15) describes the King's War gift of gold and Veteran Soldiers without
   any tax effect. Nobody says whether *refusing* help changes anything.
4. **Maximum rate.** 75% (LIL #21, FW-TAX #22) against "100%" (STEAM #17, from
   memory). Only LIL is a first-hand report of reaching the cap.
5. **Can the rate fall?** The manual and OSG describe no decrease (#29). CGW-S
   (#25) saw it drop to zero after a particular war or withdrawal event. LIL
   (#26) saw small drops after the cap. FAQ2 (#27) blames a zero rate on a
   save/load bug. These may be one behaviour, several, or bugs in particular
   versions (the game had patches up to 3.0, see CHEAT).
6. **Which good gets thrown overboard.** "Most stock × Europe price" (SW #45).
   "A ship about to arrive, or the most valuable colony cargo" (FW-FAQ #46).
   "Whatever you have most of" (FW-BOY #47). All three are tendencies, not
   rules.
7. **Is the party always offered?** The manual says people "may" rise up (#39).
   JEZ says you are "always" given the option (#40), but also says it needs a
   suitable coastal stock (#41). STEAM (#16) says inland-only empires never get
   a goods-specific tax.
8. **How much back taxes cost.** 500 × asking price (SW #49, STEAM #50). 3,000
   to 6,000 (FAQ2 #51). 1,000 and 2,400 (STEAM #52). These could all fit the
   500× rule at different prices, but the manual calls it "all back taxes
   accumulated during the boycott", which suggests the sum grows over time. No
   source tests whether it does.
9. **Custom houses and boycotts.** JEZ and FW-TAX say custom houses sell
   boycotted goods (#55). FreeCol's documentation calls this a bug in the
   original (see the FreeCol note). The manual doesn't say.
10. **JEZ mixes up founding fathers.** In one place it says Fugger allows custom
    houses, then correctly credits Stuyvesant. Take its Fugger/Stuyvesant
    advice with care.
11. **The King's cut for carrying treasure** (a separate fee from the tax): about
    90% (OSG), "half-share" (LIL), 70% on Viceroy (LIL). This may depend on
    difficulty or on Cortes.

### Gaps (nothing found)

- How big an increase is: no distribution, no dependence on turn, difficulty or
  current rate, no per-step maximum.
- Whether trade volume, treasury size, colony count, rebel %, the King's mood or
  earlier refusals change how often increases come or how big they are.
- Whether a refused increase is offered again soon, and whether the timer resets
  after a refusal.
- How much a party raises rebel sentiment (#42), and how much of the good is
  destroyed (#44 is unsure).
- Whether increases continue once every possible party good is boycotted, and
  whether they are then forced through.
- Whether difficulty changes the maximum rate.
- Whether AI nations are taxed the same way.
- Which events produce a decrease (#25) and how big it is.
- Whether the King's reason text maps to different mechanics (war, wedding and
  so on), as FreeCol's "act" and "war" increases do.

## 4. Testable hypotheses

Each one can be checked with a scripted run of the game: log the tax rate and
messages every turn, take a controlled action, and compare. "N games" means
repeat across seeds. The cheat mode (#28) can set the starting rate. Read the
rate only from the game's own screens or messages (Europe screen, sale messages,
Continental Congress report), not from save files, to stay clean-room.

| H | Hypothesis | From claims |
|---|---|---|
| H1 | With no Europe trade at all, the turn of the first increase (or of each increase) is the same across seeds at a given difficulty. | #10 against #2, #6 |
| H2 | The first increase falls in 1536 / 1532 / 1528 / 1524 / 1534 for Discoverer…Viceroy, and later increases follow at 22 / 20 / 18 / 16 / 14-turn intervals. | #10 |
| H3 | Mean turns between increases fall as difficulty rises. | #8, #9 |
| H4 | Holding difficulty and seed fixed, selling a lot in Europe (by tons or by gold) does not change when increases happen. Run against a no-trade control. | gap; #10 |
| H5 | Buying ships, artillery or experts in Europe is not followed by an increase in the next 1-2 turns any more often than in a control. | #11 |
| H6 | Accepting the frigate offered after a privateer attack is followed within 1 turn by an increase of 7-8 points. Refusing it is not. | #3, #12, #13 |
| H7 | Hiring mercenaries offered by a foreign power is followed by an increase. Run against a control that declines. | #3, #12 |
| H8 | The King's War gift (gold plus three Veteran Soldiers) is not followed by an increase. | #3, #15 |
| H9 | At least some increases are 1-2 points. Increases of 5 or more happen but are rarer. Log the full distribution by difficulty and by game year. | #17, #18, #19 |
| H10 | The rate never goes above 75 at any difficulty. Use cheat "]" to start near 75 and watch. | #21, #22 vs #17 |
| H11 | After the rate reaches 75, a later message lowers it by a few points. | #21, #26 |
| H12 | After the War of the Spanish Succession event (a rival withdrawing from the New World), the rate drops, possibly to 0, in some seeds. | #25 |
| H13 | Saving and reloading never changes the rate (a check for the #27 bug; record the game version). | #27 |
| H14 | Refusing an increase (holding a party) leaves the rate unchanged, boycotts exactly the named good, and raises rebel % in the named colony (or everywhere). Measure both. | #42, #43, #44, #48 |
| H15 | The amount destroyed in a party is all of that colony's stock of the good. Run against "part of it". | #44 |
| H16 | The good named for a party is the one with the largest (colony stock × Europe sell price) across coastal colonies. Run against "largest stock" and "cargo on a ship nearing Europe". | #45, #46, #47 |
| H17 | With no coastal colony, or with every stocked good already boycotted, increases still happen but no party option appears. | #16, #39, #40, #41 |
| H18 | Back taxes for a boycotted good equal 500 × its asking price when you pay, and don't grow with the length of the boycott. Run against "grows with turns or with sales missed". | #49, #50, #51, vs MAN "accumulated" |
| H19 | Back taxes differ by difficulty only through the price (the multiplier stays 500). | #50 |
| H20 | Taking Fugger clears all boycotts at no cost, and later refusals boycott goods again. | #54 |
| H21 | A custom house sells a boycotted good, and its sale message takes tax at the current rate, rounded down. | #35, #55 |
| H22 | Buying goods in Europe at rate t costs the plain price with no tax added. Selling nets floor(gross × (100 − t) / 100). | #30, #31 |
| H23 | Selling to natives or rival colonies takes no tax. | #34 |
| H24 | Treasure carried on your own galleon nets value × (100 − t)/100. | #33 |
| H25 | After independence the rate stops changing. Custom house income is 50% of the price with no further tax. | #36, #37 |
| H26 | With Thomas Paine, a colony's bell output rises by exactly t% (compare output at two rates set with the cheat keys). | #58 |
| H27 | Refusing an increase does not shorten the wait until the next one. Compare intervals after accepting and after refusing. | gap |
| H28 | AI nations' rates (if any report shows them) follow the same schedule as the player's. | gap |

## 5. Excluded sources, with reasons

**Excluded: reverse engineering or savegame-format work.** None of their claims
are used above.

- <https://github.com/RedSerge/ColonizationTools>: its TAXPATCH tool patches a
  routine inside VICEROY.EXE (binary patching). The search-result summary
  repeated its cap figure, and that figure is not used as evidence here. Where
  the same number appears in player sources (#21-23), the player source is the
  one cited.
- <https://github.com/colonization-re/sav-editor>: savegame editor; says its
  format work comes from decompiling the game binary.
- <https://github.com/pavelbel/smcol_saves_utility>: savegame-format decoder and
  encoder (the layout comes from the Viceroy project).
- <https://forums.civfanatics.com/threads/colonization-1994-sav-files-decoder-and-encoder.681919/>:
  savegame-format decoder thread.
- <https://github.com/NilioDev/Viceroy>: reimplementation that decodes the
  original save files byte for byte (savegame format).
- <https://forums.civfanatics.com/threads/trade-routes-wont-deliver-boycotted-goods-root-cause-and-a-two-byte-fix.704173/>:
  root cause found in the executable and fixed with a binary patch. Not read
  beyond its title.
- <https://forums.civfanatics.com/threads/re-colonization-sid-meiers-colonization-but-with-qol-updates-and-bugfixes.700134/>:
  a patched-executable project; not read.
- <https://forums.civfanatics.com/threads/30-years-colonization.692439/>: names
  code locations in Viceroy.exe (ship prices). It has no tax claims, and none
  were taken.

**Out of scope: about Civilization IV: Colonization (2008), not the 1994 game.**
They often come up in searches and are easy to mistake for Col1 evidence. Their
trade-volume trigger ("201 tons", `TAX_TRADE_THRESHOLD`, `TAX_INCREASE_CHANCE`,
King's attitude) describes Civ4Col's XML rules.

- <https://forums.civfanatics.com/threads/colonization-hints.347728/>
- <https://forums.civfanatics.com/threads/refusing-the-king.292663/>
- <https://forums.civfanatics.com/threads/making-the-king-angry.523945/>
- <https://forums.civfanatics.com/threads/no-taxes-no-king-invasion.306823/>
- <https://gamefaqs.gamespot.com/boards/946846-sid-meiers-civilization-iv-colonization/45702027>
- <https://apolyton.net/forum/civilization-iv/civilization-iv-colonization/232127-how-to-reduce-the-king-s-demands-spoiler>
- <https://apolyton.net/forum/civilization-iv/civilization-iv-colonization/227771-taxation-frequency-is-tied-to-sons-of-liberty>

**Not used: copies of the manual.** <https://apolyton.net/articles/civilization-news/col/info-af/9313110-colonization-independence-tensions-and-winning>
reprints the manual's "Taxation and Boycott" text word for word, so it adds
nothing beyond MAN.

## FreeCol, for comparison only (not evidence about the original)

From the FreeCol checkout in this repo (`freecol/`, GPL) and FreeCol's user
docs (<https://www.freecol.org/docs/node50.html>):

- Tax changes are random "monarch actions" chosen each turn from a weighted list
  (`Monarch.getActionChoices`). Nothing happens before a grace period of 10-50
  turns that depends on the "monarch meddling" option. There are separate
  RAISE_TAX_ACT and RAISE_TAX_WAR actions, and LOWER_TAX_WAR / LOWER_TAX_OTHER
  actions. So FreeCol has tax *reductions*, which the 1994 manual doesn't
  mention but CGW-S and LIL report seeing.
- Increase size: `1 + random(3 + turn / adjust)`, where adjust is 20-60 from
  the "tax adjustment" option. Increases get bigger later in the game.
  Reductions are 1 to about 10, and never go below 20% (MINIMUM_TAX_RATE + 10
  gating).
- The maximum rate is a per-difficulty option (`model.option.maximumTax`: 50,
  60, 65, 70… in the classic rules).
- FreeCol's docs say "the original Colonization game contained a bug which made
  the Custom House ignore all Boycotts", and offer that as a rule variant. This
  matches JEZ and FW-TAX (#55).
- FreeCol skips a raise when there are no goods to boycott. In Col1 this is
  unknown (H17).
