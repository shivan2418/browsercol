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
import { OptionEditor } from './option-editor';
import { leaves, type OptionGroup, type OptionValue } from './options';
import type { StartChoice, StartOptions } from './start';

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

export function StartScreen({ options, start }: { options: StartOptions; start: (choice: StartChoice) => void }) {
  const [nation, setNation] = useState<string | null>(options.nations[0]?.id ?? null);
  const levels = options.levels;
  const [difficulty, setDifficulty] = useState(
    levels.some((l) => l.id === options.defaultLevel) ? options.defaultLevel : (levels[0]?.id ?? options.defaultLevel),
  );
  const chosen = options.nations.find((n) => n.id === nation);
  const [levelEdits, setLevelEdits] = useState<Record<string, OptionValue>>({});
  const [gameEdits, setGameEdits] = useState<Record<string, OptionValue>>({});
  const levelGroup = useMemo(() => options.groups.level(difficulty), [options, difficulty]);
  const gameGroup = useMemo(() => options.groups.game(), [options]);
  const mapGroup = useMemo(() => options.groups.mapGenerator(), [options]);
  const [mapEdits, setMapEdits] = useState<Record<string, OptionValue>>({});
  return (
    <div className="start" data-testid="start">
      <form
        className="start-window"
        onSubmit={(e) => {
          e.preventDefault();
          start({ nation, difficulty, options: { ...mapEdits, ...gameEdits, ...levelEdits } });
        }}
      >
        <h1>FreeCol Online</h1>
        <h2>New game</h2>
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
                <span className="swatch" style={{ background: n.color }} />
                <span className="name">{n.name}</span>
                <span className="type">{n.type}</span>
              </label>
            ))}
          </div>
          {chosen?.description ? <p className="quiet">{chosen.description}</p> : null}
        </fieldset>
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
    </div>
  );
}
