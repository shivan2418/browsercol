// The start screen (#55): FreeCol's NewPanel and StartGamePanel for a single
// player, in the Browser UI's look (docs/adr/0004). The player picks a
// European nation and a difficulty level and starts the game. Rendered by
// main.tsx until the game starts. Hooks for the browser scripts: [data-nation]
// on each nation's radio button, [data-difficulty] on the level's select and
// [data-start] on the Start button. The level's options and the game options
// open in the option editor (#56) under [data-customize=difficulty] and
// [data-customize=game]; the map generator's options (#57) under
// [data-customize=map]; what the player changes goes to the Engine in the
// preset's options.
import { useMemo, useState } from 'react';
import { CreditsDialog, SourceLinks } from './credits';
import { OptionEditor } from './option-editor';
import { leaves, type OptionGroup, type OptionValue } from './options';
import { SaveList } from './save-picker';
import type { SaveMeta } from './saves';
import { ADVANTAGES, type Advantages, type StartChoice, type StartOptions } from './start';

/** FreeCol's names for the National Advantages choices (advantages.* in FreeColMessages). */
const ADVANTAGE_NAMES: Record<Advantages, string> = { SELECTABLE: 'Selectable', FIXED: 'Fixed', NONE: 'None' };

/** The options of a group, editable, as the values the player changed from the group's own. */
function Customize({
  kind,
  summary,
  group,
  edits,
  setEdits,
}: {
  kind: string;
  summary: string;
  group: OptionGroup;
  edits: Record<string, OptionValue>;
  setEdits: (edits: Record<string, OptionValue>) => void;
}) {
  const base = useMemo(() => leaves(group), [group]);
  const count = Object.keys(edits).length;
  return (
    <details className="customize" data-customize={kind}>
      <summary>{count > 0 ? `${summary} (${count} changed)` : summary}</summary>
      <OptionEditor
        root={group}
        editable
        values={edits}
        onChange={(id, value) => {
          const next = { ...edits };
          if (base.get(id)?.value === value) delete next[id];
          else next[id] = value;
          setEdits(next);
        }}
      />
    </details>
  );
}

export function StartScreen({
  options,
  start,
  rules,
  changeRules,
  saves = [],
  open,
}: {
  options: StartOptions;
  start: (choice: StartChoice) => void;
  /** The ruleset the options are of, and a way to another one (a new page: its options differ). */
  rules?: string;
  changeRules?: (rules: string) => void;
  /** The saved games, newest first: the first is the one Continue plays. */
  saves?: SaveMeta[];
  /** Play a saved game. */
  open?: (id: number) => void;
}) {
  const [advantages, setAdvantages] = useState<Advantages>('SELECTABLE');
  const [nationType, setNationType] = useState<string>('');
  const [colors, setColors] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [nation, setNation] = useState<string | null>(options.nations[0]?.id ?? null);
  const levels = options.levels;
  const [difficulty, setDifficulty] = useState(
    levels.some((l) => l.id === options.defaultLevel) ? options.defaultLevel : (levels[0]?.id ?? options.defaultLevel),
  );
  const chosen = options.nations.find((n) => n.id === nation);
  // Every nation but the player's own may be left out: the other Europeans, then the natives.
  const others = [
    ...options.nations.filter((n) => n.id !== nation).map((n) => ({ ...n, native: false })),
    ...options.rivals,
  ];
  const ownType = advantages === 'SELECTABLE' ? options.nationTypes.find((t) => t.id === nationType) : undefined;
  const [levelEdits, setLevelEdits] = useState<Record<string, OptionValue>>({});
  const [gameEdits, setGameEdits] = useState<Record<string, OptionValue>>({});
  const levelGroup = useMemo(() => options.groups.level(difficulty), [options, difficulty]);
  const gameGroup = useMemo(() => options.groups.game(), [options]);
  const mapGroup = useMemo(() => options.groups.mapGenerator(), [options]);
  const [mapEdits, setMapEdits] = useState<Record<string, OptionValue>>({});
  const [credits, setCredits] = useState(false);
  return (
    <div className="start" data-testid="start">
      <form
        className="start-window"
        onSubmit={(e) => {
          e.preventDefault();
          start({
            nation,
            difficulty,
            options: { ...mapEdits, ...gameEdits, ...levelEdits },
            advantages,
            nationType: advantages === 'SELECTABLE' && nationType ? nationType : undefined,
            colors,
            unavailable: removed.filter((id) => id !== nation),
          });
        }}
      >
        <h1>FreeCol Online</h1>
        {open && saves.length > 0 && (
          <fieldset className="saved-games">
            <legend>Saved games</legend>
            <button type="button" className="default" data-continue onClick={() => open(saves[0].id)}>
              Continue Playing
            </button>
            <details data-open>
              <summary>Open a saved game</summary>
              <SaveList saves={saves} open={open} />
            </details>
          </fieldset>
        )}
        <h2>New game</h2>
        {rules !== undefined && changeRules && options.rulesets.length > 1 && (
          <fieldset>
            <legend>Rules</legend>
            <select data-rules aria-label="Rules" value={rules} onChange={(e) => changeRules(e.target.value)}>
              {options.rulesets.map((r) => (
                <option key={r} value={r}>
                  {r === 'classic' ? 'Classic' : r === 'freecol' ? 'FreeCol' : r}
                </option>
              ))}
            </select>
          </fieldset>
        )}
        <fieldset>
          <legend>Nation</legend>
          <div className="nations">
            {options.nations.map((n) => (
              <label key={n.id} className="nation" data-selected={n.id === nation || undefined}>
                <input
                  type="radio"
                  name="nation"
                  value={n.id}
                  data-nation={n.id}
                  checked={n.id === nation}
                  onChange={() => setNation(n.id)}
                />
                <span className="swatch" style={{ background: colors[n.id] ?? n.color }} />
                <span className="name">{n.name}</span>
                <span className="type">{n.id === nation && ownType ? ownType.name : n.type}</span>
              </label>
            ))}
          </div>
          {chosen?.description || ownType?.description ? (
            <p className="quiet">{ownType?.description ?? chosen?.description}</p>
          ) : null}
          {options.nationTypes.length > 0 && (
            <label>
              Advantage of your nation:{' '}
              <select
                data-nation-type
                value={advantages === 'SELECTABLE' ? nationType : ''}
                disabled={advantages !== 'SELECTABLE'}
                onChange={(e) => setNationType(e.target.value)}
              >
                <option value="">{chosen?.type ? `${chosen.type} (the nation's own)` : "The nation's own"}</option>
                {options.nationTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <details className="colours">
            <summary>
              Nation colours{Object.keys(colors).length > 0 ? ` (${Object.keys(colors).length} changed)` : ''}
            </summary>
            {options.nations.map((n) => (
              <label key={n.id}>
                <input
                  type="color"
                  data-colour={n.id}
                  aria-label={`${n.name} colour`}
                  value={colors[n.id] ?? n.color}
                  onChange={(e) => setColors({ ...colors, [n.id]: e.target.value })}
                />{' '}
                {n.name}
              </label>
            ))}
          </details>
        </fieldset>
        <fieldset>
          <legend>National Advantages</legend>
          <select
            data-advantages
            aria-label="National Advantages"
            value={advantages}
            onChange={(e) => setAdvantages(e.target.value as Advantages)}
          >
            {ADVANTAGES.map((a) => (
              <option key={a} value={a}>
                {ADVANTAGE_NAMES[a]}
              </option>
            ))}
          </select>
        </fieldset>
        {others.length > 0 && (
          <fieldset>
            <legend>Other nations</legend>
            <p className="quiet">The nations taking part, as computer players. Uncheck one to leave it out.</p>
            <div className="rivals">
              {others.map((r) => (
                <label key={r.id} data-rival={r.id}>
                  <input
                    type="checkbox"
                    checked={!removed.includes(r.id)}
                    onChange={(e) =>
                      setRemoved(e.target.checked ? removed.filter((id) => id !== r.id) : [...removed, r.id])
                    }
                  />
                  <span className="swatch" style={{ background: r.color }} /> {r.name}
                  {r.native ? ' (native)' : ''}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>Difficulty</legend>
          <select
            data-difficulty
            aria-label="Difficulty"
            value={difficulty}
            onChange={(e) => {
              setDifficulty(e.target.value);
              // Another level has other values: what was changed in the one before does not carry over.
              setLevelEdits({});
            }}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {levelGroup && (
            <Customize
              key={levelGroup.id}
              kind="difficulty"
              summary="Customize this level"
              group={levelGroup}
              edits={levelEdits}
              setEdits={setLevelEdits}
            />
          )}
        </fieldset>
        {gameGroup && (
          <fieldset>
            <legend>Game options</legend>
            <Customize
              kind="game"
              summary="Show game options"
              group={gameGroup}
              edits={gameEdits}
              setEdits={setGameEdits}
            />
          </fieldset>
        )}
        {mapGroup && (
          <fieldset>
            <legend>Map</legend>
            <Customize kind="map" summary="Show map options" group={mapGroup} edits={mapEdits} setEdits={setMapEdits} />
          </fieldset>
        )}
        <div className="buttons">
          <button type="submit" className="default" data-start>
            Start game
          </button>
        </div>
      </form>
      <SourceLinks credits={() => setCredits(true)} />
      {credits && <CreditsDialog close={() => setCredits(false)} />}
    </div>
  );
}
