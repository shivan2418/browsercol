# Colonization (1994): how the Crown raises taxes, measured, and how FreeCol differs

Measured on 2026-11-21 by playing the GOG copy (DOS v2.0.0.5) in DOSBox and
reading the save files it writes. Nothing here comes from the game's code:
the harness (`tools/col1-blackbox`) only presses keys and reads screens and
saves, and the save fields were located by diffing our own saves. The public
record (manual, strategy guide, player reports) is in
[col1-tax-public-sources.md](col1-tax-public-sources.md).

## Setup

- One origin save: Discoverer, England, Jamestown founded in 1494, saved in
  Spring 1496. The human player then does nothing: every turn is ended at
  once, and every popup gets the default answer ("Kiss pinky ring" for a tax
  raise). Nothing is ever bought or sold.
- 44 games from that save (40 at DOSBox's GOG CPU setting, 4 at max speed).
  Repeated loads of one save play out differently, so each game is its own
  sample. 25 games passed turn 150 and 8 passed turn 250; the longest
  reached turn 371 (1731).
- The other three European nations (France, Spain, Dutch) are played by the
  computer in every game, with normal trade, war and growth. Every save
  holds all four nations' tax rates, so each game also gives three
  computer-played tax histories.

## Findings

### When the tax goes up: a fixed turn schedule

Raises fell on the same turns in every game. The turn counter starts at 0
in 1492; after 1600 there are two turns a year.

| | Before 1600 | 1600–1700 | After 1700 |
|---|---|---|---|
| England (human, Discoverer) | every 22 turns: 44, 66, 88 | every 19: 133, 152 … 304 | every 16: 320, 336, 352, 368 |
| France, Spain, Dutch (computer) | every 18 turns: 37, 55, 73, 91, 109 | every 15: 136, 151 … 301 | every 12: 313, 325 … 361 |

- The gap at each change fits neither interval (England 88 → 114,
  France 109 → 121). How the count carries over is not worked out.
- The schedule follows the turn counter, not the year. Setting the counter
  to 43 in a 1496 save brought the raise on the next turn, in 1497
  (3 games of 3).
- Trade does not set the timing: the computer nations trade and keep the
  same schedule as the human who never trades.
- Off-schedule raises are rare: 6 in all 44 games (Dutch at turn 65; France
  at 103, 139, 142, 143, 146). Something else triggers these; not
  investigated.
- The first year (1536 for the human on Discoverer, i.e. turn 44) and the 22
  interval match the unsourced wiki table in the public-sources note. The
  computer's 18 matches that table's Conquistador row, which suggests the
  computer nations play at another level; not checked.

### How big a raise is

1,470 raises across all nations. No raise was ever a decrease.

| Turns | Raises | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0–107 (before 1600) | 493 | 24% | 38% | 10% | 10% | 6% | 5% | 4% | 5% | |
| 108–307 (1600–1700) | 870 | 46% | 28% | 7% | 6% | 2% | 4% | 3% | 3% | |
| 308+ (after 1700) | 107 | 16% | 64% | 3% | 10% | 1% | 3% | | 2% | 1 raise |

The size does not grow with time. What sets it is open: three games with the
turn counter moved to 43 in 1496 got +3, +4, +4, larger than the usual
1536 raise of +1 or +2.

### Maximum and decreases

- The highest rate seen is 65%. No game ran long enough to test the 75% cap
  that player reports give.
- No decrease in 1,470 changes. The decreases that players report (after the
  War of the Spanish Succession, after the cap) need conditions these games
  did not reach.

## FreeCol, for comparison

From `freecol/src/net/sf/freecol/common/model/Monarch.java`
(`getActionChoices`, `raiseTax`, `lowerTax`) and the classic rules'
difficulty options (`data/rules/classic/specification.xml`).

| | Original (measured) | FreeCol |
|---|---|---|
| When | Fixed schedule: every 22/19/16 turns for the human on Discoverer, 18/15/12 for the computer | Random. Each turn after a grace period of (6 − dx) × 10 turns (dx = 1 + monarchMeddling), the monarch picks a weighted random action; two of them raise the tax, each weight 5 + dx against a do-nothing weight of max(200 − turn, 100) |
| Size | Mostly +1 or +2, up to +8 (one +10); does not grow over time | 1 + random(3 + turn / adjust), adjust = (6 − taxAdjustment) × 10, so the range widens as the game goes on |
| Maximum | 75 per player reports; 65 seen so far | maximumTax: 50, 60, 65, 70, 75 by level |
| Decreases | None seen in 1,470 changes | Yes: two lower-tax actions when the tax is above 30 |
| Computer players | Own schedule (18/15/12 on this game) | Same monarch rules as the human |

In short: FreeCol's taxes rise at random times with a size that widens over
the game, and can fall. The original's rise on a fixed clock, by mostly 1–2
points, and did not fall in these games.

## Not measured

- Other difficulty levels (needs an origin save per level).
- What sets the raise size, and how the interval carries over in 1600 and
  1700.
- The cap: an edited save near 75% just before a scheduled raise would test
  it in minutes.
- Refusing a raise (the "party" and boycott), and the off-schedule raises.

## Method notes

Save fields used (all found by diffing our own saves; details in
`tools/col1-blackbox/README.md`): year (u16 at 0x1A), turn counter (u16 at
0x1E), England's tax byte at 391 + 28 × u16(0x2C) + 202 × u16(0x2E), gold 41
bytes after it, and one 316-byte record per nation in the order England,
France, Spain, Dutch. France's record was checked against the side panel
after switching the human player with the cheat menu. Edited saves load
without complaint.
