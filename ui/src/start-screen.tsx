// The start screen (#55): FreeCol's NewPanel and StartGamePanel for a single
// player, in the Browser UI's look (docs/adr/0004). The player picks a
// European nation and a difficulty level and starts the game. Rendered by
// main.tsx until the game starts. Hooks for the browser scripts: [data-nation]
// on each nation's radio button, [data-difficulty] on the level's select and
// [data-start] on the Start button.
import { useState } from 'react';
import type { StartChoice, StartOptions } from './start';

export function StartScreen({ options, start }: { options: StartOptions; start: (choice: StartChoice) => void }) {
  const [nation, setNation] = useState<string | null>(options.nations[0]?.id ?? null);
  const levels = options.levels;
  const [difficulty, setDifficulty] = useState(
    levels.some((l) => l.id === options.defaultLevel) ? options.defaultLevel : (levels[0]?.id ?? options.defaultLevel),
  );
  const chosen = options.nations.find((n) => n.id === nation);
  return (
    <div className="start" data-testid="start">
      <form
        className="start-window"
        onSubmit={(e) => {
          e.preventDefault();
          start({ nation, difficulty });
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
            onChange={(e) => setDifficulty(e.target.value)}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </fieldset>
        <div className="buttons">
          <button type="submit" className="default" data-start>
            Start game
          </button>
        </div>
      </form>
    </div>
  );
}
