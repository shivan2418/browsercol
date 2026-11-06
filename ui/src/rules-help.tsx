// What the Rules choice on the start screen changes (#326): a summary of how FreeCol's Classic and FreeCol
// rule sets differ, shown beside the choice. Each line was checked against the two specification.xml files
// at freecol.sha (the FreeCol one only overrides Classic, so what is not here is the same in both) and
// names the option as the Game options tab shows it. The wording is ours: FreeCol has no strings for it.

interface Row {
  /** What changes, with the option's name in the Game options as FreeCol labels it. */
  what: string;
  classic: string;
  freecol: string;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Liberty and immigration',
    rows: [
      {
        what: 'Bells at 100% rebels (Bell accumulation capped)',
        classic: 'Extra bells are lost, so one more colonist can drop you below 100%.',
        freecol: 'Extra bells are kept as a buffer.',
      },
      {
        what: 'Immigration (Crosses increment)',
        classic: 'Each immigrant raises the crosses needed by 2, on every level.',
        freecol: 'By 2 on Very Easy, 3 Easy, 4 Medium, 6 Hard and 10 Very Hard.',
      },
      {
        what: 'Extra hammers and crosses (Save production overflow)',
        classic: 'Kept for the next turn.',
        freecol: 'Lost.',
      },
    ],
  },
  {
    title: 'Colonies',
    rows: [
      {
        what: 'Stockade, Fort, Fortress',
        classic: 'A colony with one cannot shrink below 3 colonists.',
        freecol: 'No minimum.',
      },
      { what: 'Horses', classic: 'Eat any food, fish too.', freecol: 'Eat grain only.' },
      {
        what: 'New colonies (Claim all tiles)',
        classic: 'Claim all the tiles next to them.',
        freecol: 'Do not.',
      },
      {
        what: 'Students (Allow student selection)',
        classic: 'The game picks who is taught.',
        freecol: 'You choose who is taught.',
      },
    ],
  },
  {
    title: 'Ships, trade and units',
    rows: [
      {
        what: 'Amphibious moves',
        classic: 'A ship cannot unload straight into a settlement.',
        freecol: 'It can.',
      },
      {
        what: 'Empty trade units',
        classic: 'Only a unit carrying goods can trade with natives.',
        freecol: 'An empty one can trade too.',
      },
      {
        what: 'Disembark in Colony',
        classic: 'All units leave the ship as it reaches a colony.',
        freecol: 'You choose who leaves.',
      },
      {
        what: 'Customs house ignores boycott',
        classic: 'The custom house sells boycotted goods.',
        freecol: 'It does not.',
      },
      {
        what: 'Capture units under repair',
        classic: 'Not captured with a conquered colony.',
        freecol: 'Captured with it.',
      },
      {
        what: 'Enhanced missionaries',
        classic: 'No extra effects.',
        freecol: 'Also improve trade and skills taught, and show the area around the settlement.',
      },
      { what: 'Exploration points', classic: 'None awarded.', freecol: 'Awarded for all discoveries.' },
    ],
  },
  {
    title: 'Founding fathers',
    rows: [
      {
        what: 'Francisco de Coronado',
        classic: 'Shows the colonies once.',
        freecol: 'Shows all colonies for good.',
      },
      { what: 'Pocahontas', classic: 'Calms the natives.', freecol: 'Also lifts the bans on your missions.' },
    ],
  },
  {
    title: 'War of Independence',
    rows: [
      {
        what: 'The Royal Expeditionary Force (Teleport REF)',
        classic: 'Appears at its landing site.',
        freecol: 'Sails over, a turn faster than normal.',
      },
      {
        what: 'Founding colonies during the war (Found colonies during rebellion)',
        classic: 'Not allowed.',
        freecol: 'Allowed.',
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
        <b>FreeCol</b> is Classic with the FreeCol team’s changes on top: some conveniences and some new rules. Whatever
        is not listed here is the same in both.
      </p>
      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          <dl>
            {s.rows.map((r) => (
              <div key={r.what} className="rules-help-row">
                <dt>{r.what}</dt>
                <dd>
                  <span className="quiet">Classic:</span> {r.classic}
                </dd>
                <dd>
                  <span className="quiet">FreeCol:</span> {r.freecol}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="quiet">
        The same in both: England, France, Spain and the Netherlands start in the game, and the other four European
        nations can be ticked under Other nations; building on native land (a difficulty option); the sailing time to
        Europe (Turns to sail); and fog of war.
      </p>
      <p className="quiet">
        Every game option can still be changed for a game under Game options, so these are only starting points.
      </p>
    </div>
  );
}
