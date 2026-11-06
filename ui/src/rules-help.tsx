// What the Rules choice on the start screen changes (#326): a summary of how FreeCol's Classic and FreeCol
// rule sets differ, shown beside the choice. Every row names the option as the Game options tab labels it,
// and was checked against the two specification.xml files at freecol.sha (the FreeCol one only overrides
// Classic) and against the Java that reads the option, not the option's description: the file and line that
// decide each row are listed in the pull request of #326. Only what differs is here. The wording is ours:
// FreeCol has no strings for it.

interface Row {
  /** What changes, with the option's name in the Game options as FreeCol labels it. */
  what: string;
  /** What it does for the player under each rule set's default. */
  classic: string;
  freecol: string;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Liberty and immigration',
    rows: [
      {
        what: 'Bells at 100% rebels (Bell accumulation capped)',
        classic: 'Liberty stops at 100%: extra bells are lost, so one more colonist drops you below 100%.',
        freecol: 'Extra bells keep building up, a buffer against new colonists.',
      },
      {
        what: 'Immigration (Crosses increment)',
        classic: 'Each immigrant raises the crosses needed for the next one by 2, on every level.',
        freecol: 'By 2 on Very Easy, 3 Easy, 4 Medium, 6 Hard and 10 Very Hard.',
      },
      {
        what: 'Surplus production (Save production overflow)',
        classic: 'Hammers, bells and crosses beyond the cost of a building, founding father or immigrant carry over.',
        freecol: 'The surplus is lost.',
      },
    ],
  },
  {
    title: 'Colonies',
    rows: [
      {
        what: 'Stockade, Fort and Fortress (Minimum Colony Size)',
        classic: 'A colony with one cannot be reduced below 3 colonists.',
        freecol: 'No such limit.',
      },
      {
        what: 'New colonies (Claim all tiles)',
        classic: 'Claim every tile they can around them at once.',
        freecol: 'Claim only the tile they stand on.',
      },
      {
        what: 'Students (Allow student selection)',
        classic: 'Students are matched to teachers automatically, the least skilled first.',
        freecol: 'You choose each student’s teacher.',
      },
    ],
  },
  {
    title: 'Ships, trade and units',
    rows: [
      {
        what: 'Amphibious moves',
        classic: 'Units cannot attack or enter a native settlement straight from a ship: they must land first.',
        freecol: 'They can, straight from the ship.',
      },
      {
        what: 'Empty trade units',
        classic: 'A trader with no goods cannot enter a native settlement.',
        freecol: 'An empty one can, to buy goods.',
      },
      {
        what: 'Disembark in Colony',
        classic: 'A ship’s units all disembark when it arrives in a colony, and it has no moves left.',
        freecol: 'Units stay aboard until you unload them.',
      },
      {
        what: 'Customs house ignores boycott',
        classic: 'The custom house sells boycotted goods all the same.',
        freecol: 'Boycotted goods are not sold (Jan de Witt aside).',
      },
      {
        what: 'Capture units under repair',
        classic: 'When a colony falls, its ships are damaged or sunk, even those under repair.',
        freecol: 'Ships under repair are captured with the colony.',
      },
      {
        what: 'Enhanced missionaries',
        classic:
          'A missionary sees only the tiles next to its settlement, and the settlement teaches its skill to one unit, then no more (a capital keeps teaching).',
        freecol:
          'A missionary sees the whole area around its settlement and improves your trade prices there, and while it is there the settlement keeps teaching its skill.',
      },
      {
        what: 'Exploration points',
        classic: 'Off. Discoveries only show a message and give no score.',
        freecol: 'On. Each discovery adds to your score.',
      },
    ],
  },
  {
    title: 'Founding fathers',
    rows: [
      {
        what: 'Francisco de Coronado',
        classic: 'Reveals the land around every colony once; they show as size 1.',
        freecol: 'Reveals the land around every colony, and from then on you see every colony in full.',
      },
      {
        what: 'Pocahontas',
        classic: 'Natives you have met forgive you and make peace, and their future anger is halved.',
        freecol: 'The same, and bans on your missions are lifted.',
      },
    ],
  },
  {
    title: 'War of Independence',
    rows: [
      {
        what: 'The Royal Expeditionary Force (Teleport REF)',
        classic: 'The royal fleet appears at once beside its first target colony.',
        freecol: 'The fleet starts out at sea and arrives a turn later.',
      },
      {
        what: 'Found colonies during rebellion',
        classic: 'Once you have declared independence you cannot found colonies.',
        freecol: 'You can.',
      },
    ],
  },
];

/** The summary, for a popover beside the Rules choice. */
export function RulesHelp() {
  return (
    <div className="rules-help" data-rules-help>
      <p>
        <b>Classic</b> is the rules of Sid Meier’s Colonization (MicroProse, 1994), the game FreeCol remakes, kept as
        close to the original as FreeCol gets. Pick it for that game as it was.
      </p>
      <p>
        <b>FreeCol</b> is Classic with the FreeCol team’s changes on top: some conveniences and some new rules.
        Everything not listed here is the same as Classic.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col">Classic</th>
            <th scope="col">FreeCol</th>
          </tr>
        </thead>
        {SECTIONS.map((s) => (
          <tbody key={s.title}>
            <tr className="rules-help-theme">
              <th colSpan={3} scope="colgroup">
                {s.title}
              </th>
            </tr>
            {s.rows.map((r) => (
              <tr key={r.what}>
                <th scope="row" className="rules-help-what">
                  {r.what}
                </th>
                <td>{r.classic}</td>
                <td>{r.freecol}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="quiet">
        Every game option can still be changed for a game under Game options, so these are only starting points.
      </p>
    </div>
  );
}
