// What the Rules choice on the start screen changes (#326): a summary of how FreeCol's Classic and FreeCol
// rule sets differ, shown beside the choice. Each line was checked against the two specification.xml files
// at freecol.sha (the FreeCol one only overrides Classic, so what is not here is the same in both) and
// names the option as the Game options tab shows it. The wording is ours: FreeCol has no strings for it.

interface Row {
  /** What changes, with the option's name in the Game options as FreeCol labels it. */
  what: string;
  classic: string;
  freecol: string;
  /** Said once across both columns where the rule sets agree; then `classic` and `freecol` are empty. */
  same?: string;
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
  {
    title: 'The same in both',
    rows: [
      {
        what: 'Starting nations (Other nations)',
        classic: '',
        freecol: '',
        same: 'England, France, Spain and the Netherlands start in the game; the other four can be ticked.',
      },
      {
        what: 'Building on native land (Build on native land)',
        classic: '',
        freecol: '',
        same: 'Set by the difficulty level.',
      },
      { what: 'Sailing time to Europe (Turns to sail)', classic: '', freecol: '', same: '3 turns.' },
      { what: 'Fog of war', classic: '', freecol: '', same: 'On.' },
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
                {r.same === undefined ? (
                  <>
                    <td>{r.classic}</td>
                    <td>{r.freecol}</td>
                  </>
                ) : (
                  <td colSpan={2}>{r.same}</td>
                )}
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
