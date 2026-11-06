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
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Select } from './controls';
import { CreditsDialog, SourceLinks } from './credits';
import type { Art } from './frame';
import { OptionEditor } from './option-editor';
import { leaves, sameValue, type OptionGroup, type OptionValue } from './options';
import { ReportContext, ReportPanel, startColopediaAt, type ReportActions } from './reports';
import { SaveList } from './save-picker';
import type { SaveMeta } from './saves';
import { levelFile, loadDefaults, readLevelFile, saveDefaults } from './start-options';
import { ADVANTAGES, type Advantages, type StartChoice, type StartOptions } from './start';
import type { ReportView } from './webgui';

/** The map generator's import file option (MapGeneratorOptions.IMPORT_FILE). */
const IMPORT_FILE = 'model.option.importFile';

/** FreeCol's names for the National Advantages choices (advantages.* in FreeColMessages). */
const ADVANTAGE_NAMES: Record<Advantages, string> = { SELECTABLE: 'Selectable', FIXED: 'Fixed', NONE: 'None' };

/** The options of a group, editable, as the values the player changed from the group's own. */
function Customize({
  kind,
  summary,
  group,
  edits,
  setEdits,
  files,
  setFile,
  tools,
}: {
  kind: string;
  summary: string;
  group: OptionGroup;
  edits: Record<string, OptionValue>;
  setEdits: (edits: Record<string, OptionValue>) => void;
  /** The files picked for the group's file options, by option id (the map generator's import file). */
  files?: Record<string, File>;
  setFile?: (id: string, file: File | null) => void;
  /** Buttons under the options, such as Reset. */
  tools?: ReactNode;
}) {
  const base = useMemo(() => leaves(group), [group]);
  const count = Object.keys(edits).length + Object.keys(files ?? {}).length;
  return (
    <details className="customize" data-customize={kind}>
      <summary>{count > 0 ? `${summary} (${count} changed)` : summary}</summary>
      <OptionEditor
        root={group}
        editable
        values={edits}
        fileNames={Object.fromEntries(Object.entries(files ?? {}).map(([id, f]) => [id, f.name]))}
        onFile={setFile}
        onChange={(id, value) => {
          const next = { ...edits };
          if (sameValue(base.get(id)?.value, value)) delete next[id];
          else next[id] = value;
          setEdits(next);
        }}
      />
      {tools && <div className="tools">{tools}</div>}
    </details>
  );
}

/** Reset, Save and Load for a difficulty level, as DifficultyDialog has them; a level goes to a file and back as JSON. */
function LevelTools({
  group,
  edits,
  setEdits,
}: {
  group: OptionGroup;
  edits: Record<string, OptionValue>;
  setEdits: (edits: Record<string, OptionValue>) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const save = () => {
    const url = URL.createObjectURL(new Blob([levelFile(group, edits)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${group.id.replace(/^model\.difficulty\./, '')}.difficulty.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const load = async (file: File | undefined) => {
    if (!file) return;
    const read = readLevelFile(group, await file.text());
    if ('error' in read) {
      setNote(read.error);
      return;
    }
    setEdits(read.edits);
    setNote(null);
  };
  return (
    <>
      <button type="button" data-level-reset disabled={Object.keys(edits).length === 0} onClick={() => setEdits({})}>
        Reset
      </button>
      <button type="button" data-level-save onClick={save}>
        Save level
      </button>
      <button type="button" data-level-load onClick={() => picker.current?.click()}>
        Load level
      </button>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        hidden
        data-level-file
        onChange={(e) => {
          void load(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {note && <span role="alert">{note}</span>}
    </>
  );
}

export function StartScreen({
  options,
  start,
  rules,
  changeRules,
  saves = [],
  open,
  colopedia,
  art = () => null,
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
  /**
   * The Colopedia, as the report the Engine builds from the rules alone, opened on an entry or none. Swing's
   * player table opens it on the nations and the nation types (PlayersTable); no button shows without it.
   */
  colopedia?: (select: string | null) => Promise<ReportView & { report: 'colopedia' }>;
  /** The art of a Colopedia entry, once the Tileset has loaded. */
  art?: Art;
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
  const gameGroup = useMemo(() => options.groups.game(), [options]);
  const mapGroup = useMemo(() => options.groups.mapGenerator(), [options]);
  // The game and map options the player OK'd for an earlier game are the defaults of this one.
  const [gameEdits, setGameEdits] = useState(() => loadDefaults('game', gameGroup));
  const [mapEdits, setMapEdits] = useState(() => loadDefaults('map', mapGroup));
  // The files picked for the map generator's file options (the import file): a file is not an option value,
  // so it is not kept as a default.
  const [mapFiles, setMapFiles] = useState<Record<string, File>>({});
  const levelGroup = useMemo(() => options.groups.level(difficulty), [options, difficulty]);
  const [credits, setCredits] = useState(false);
  const [pedia, setPedia] = useState<ReportView | null>(null);
  const [opening, setOpening] = useState(false);
  const [pediaError, setPediaError] = useState<string | null>(null);
  /** Open the Colopedia on a section or entry; a link in it goes on in the same window. */
  const openPedia = (section: string | null, select: string | null = null) => {
    if (!colopedia || opening) return;
    setOpening(true);
    startColopediaAt(section);
    colopedia(select).then(
      (view) => {
        setOpening(false);
        setPediaError(null);
        setPedia(view);
      },
      (ex: unknown) => {
        setOpening(false);
        startColopediaAt(null);
        setPediaError(`The Colopedia could not be opened: ${String(ex)}`);
      },
    );
  };
  // Nothing in a game to open: only the Colopedia's own links, which the window handles itself.
  const pediaActions: ReportActions = {
    open: () => {},
    detail: () => {},
    colony: () => {},
    europe: () => {},
    colopedia: (id) => openPedia(null, id),
    difficulty: () => {},
    goTo: () => {},
  };
  const pediaButton = (section: string, label: string) =>
    colopedia && (
      <button type="button" data-colopedia={section} disabled={opening} onClick={() => openPedia(section)}>
        {label}
      </button>
    );
  return (
    <div className="start" data-testid="start">
      <form
        className="start-window"
        onSubmit={(e) => {
          e.preventDefault();
          saveDefaults('game', gameEdits);
          saveDefaults('map', mapEdits);
          start({
            nation,
            difficulty,
            options: { ...mapEdits, ...gameEdits, ...levelEdits },
            advantages,
            nationType: advantages === 'SELECTABLE' && nationType ? nationType : undefined,
            colors,
            unavailable: removed.filter((id) => id !== nation),
            importMap: mapFiles[IMPORT_FILE],
          });
        }}
      >
        <h1>BrowserCol</h1>
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
            <Select
              data-rules
              aria-label="Rules"
              value={rules}
              onChange={changeRules}
              choices={options.rulesets.map((r) => ({
                value: r,
                label: r === 'classic' ? 'Classic' : r === 'freecol' ? 'FreeCol' : r,
              }))}
            />
          </fieldset>
        )}
        <fieldset>
          <legend>Nation</legend>
          {pediaButton('nations', 'Nations (Colopedia)')}
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
              <Select
                data-nation-type
                value={advantages === 'SELECTABLE' ? nationType : ''}
                disabled={advantages !== 'SELECTABLE'}
                onChange={setNationType}
                choices={[
                  { value: '', label: chosen?.type ? `${chosen.type} (the nation's own)` : "The nation's own" },
                  ...options.nationTypes.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
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
          {pediaButton('nationTypes', 'Advantages (Colopedia)')}
          <Select
            data-advantages
            aria-label="National Advantages"
            value={advantages}
            onChange={(v) => setAdvantages(v as Advantages)}
            choices={ADVANTAGES.map((a) => ({ value: a, label: ADVANTAGE_NAMES[a] }))}
          />
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
          <Select
            data-difficulty
            aria-label="Difficulty"
            value={difficulty}
            onChange={(id) => {
              setDifficulty(id);
              // Another level has other values: what was changed in the one before does not carry over.
              setLevelEdits({});
            }}
            choices={levels.map((l) => ({ value: l.id, label: l.name }))}
          />
          {levelGroup && (
            <Customize
              key={levelGroup.id}
              kind="difficulty"
              summary="Customize this level"
              group={levelGroup}
              edits={levelEdits}
              setEdits={setLevelEdits}
              tools={<LevelTools group={levelGroup} edits={levelEdits} setEdits={setLevelEdits} />}
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
            <Customize
              kind="map"
              summary="Show map options"
              group={mapGroup}
              edits={mapEdits}
              setEdits={setMapEdits}
              files={mapFiles}
              setFile={(id, file) => {
                const { [id]: _, ...rest } = mapFiles;
                setMapFiles(file ? { ...rest, [id]: file } : rest);
              }}
            />
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
      {pediaError && <p role="alert">{pediaError}</p>}
      {pedia && (
        <ReportContext.Provider value={pediaActions}>
          <div className="modal">
            <ReportPanel d={{ kind: 'report', event: pedia, done: () => setPedia(null), id: 0 }} e={pedia} art={art} />
          </div>
        </ReportContext.Provider>
      )}
    </div>
  );
}
