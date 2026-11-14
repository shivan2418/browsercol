// The start screen (#55): FreeCol's NewPanel and StartGamePanel for a single
// player, in the Browser UI's look (docs/adr/0004). The player picks a
// European nation and a difficulty level and starts the game. Rendered by
// main.tsx until the game starts. Hooks for the browser scripts: [data-nation]
// on each nation's radio button, [data-difficulty] on the level's select and
// [data-start] on the Start button. The level's options and the game options
// open in the option editor (#56) under [data-customize=difficulty] and
// [data-customize=game]; the map generator's options (#57) under
// [data-customize=map], each a tab panel opened by its tab
// [data-customize-tab=difficulty|game|map]; what the player changes
// goes to the Engine in the preset's options. A European nation's swatch is
// its colour picker, [data-colour] in the player's nation list.
//
// The layout (#311) is one wide window that shows what most players change without scrolling: their nation,
// the advantages and the other nations, and the game's rules and difficulty beside Start. The rarely changed
// settings (the level's and the game's options, the map's) are tabs under them.
import { Tabs } from '@base-ui/react/tabs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flag } from './flag';
import { HelpButton, Select, Tip } from './controls';
import { RulesHelp } from './rules-help';
import { CreditsDialog, SourceLinks } from './credits';
import type { Art } from './frame';
import { OptionEditor } from './option-editor';
import { leaves, sameValue, type OptionGroup, type OptionValue } from './options';
import { ReportContext, ReportPanel, startColopediaAt, type ReportActions } from './reports';
import { OpenDialog, OpenFile } from './save-picker';
import type { SaveMeta } from './saves';
import { levelFile, loadDefaults, readLevelFile, saveDefaults } from './start-options';
import { ADVANTAGES, MAPS, type Advantages, type StartChoice, type StartOptions } from './start';
import type { ReportView } from './webgui';
import { coverageHitMethod, useCoverage } from './coverage';
import './start-window.css';

/** The map generator's import file option (MapGeneratorOptions.IMPORT_FILE). */
const IMPORT_FILE = 'model.option.importFile';

/** The difficulty option that gives expert starting units (GameOptions.EXPERT_STARTING_UNITS). */
const EXPERT_UNITS = 'model.option.expertStartingUnits';

/**
 * A nation's colour as a swatch that opens the browser's colour picker. While the player drags in the picker, only
 * the swatch follows: the input fires on every move, and the whole start screen (its option editor's rows and their
 * tooltips) took 20 ms to draw again for each, 85 ms at the low-end target's speed. The colour is picked once, when
 * the picker closes (the input's native change event).
 */
function ColourSwatch({
  hook,
  name,
  value,
  pick,
}: {
  hook?: string;
  name: string;
  value: string;
  pick: (colour: string) => void;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const input = useRef<HTMLInputElement>(null);
  const picked = useRef(pick);
  picked.current = pick;
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => picked.current(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  return (
    <Tip
      as="input"
      ref={input}
      type="color"
      className="swatch"
      data-colour={hook}
      aria-label={`${name} colour`}
      tip={`${name} colour`}
      value={shown}
      onChange={(e) => setShown(e.target.value)}
    />
  );
}

/** FreeCol's names for the National Advantages choices (advantages.* in FreeColMessages). */
const ADVANTAGE_NAMES: Record<Advantages, string> = { SELECTABLE: 'Selectable', FIXED: 'Fixed', NONE: 'None' };

/** What each National Advantages choice means for the player's own advantage. */
const ADVANTAGE_NOTES: Record<Advantages, string> = {
  SELECTABLE: 'Selectable: you pick the advantage of your nation.',
  FIXED: 'Fixed: every nation keeps its own advantage.',
  NONE: 'None: no nation has an advantage.',
};

/** The options of a group, editable, as the values the player changed from the group's own. */
function Customize({
  group,
  edits,
  setEdits,
  files,
  setFile,
  tools,
}: {
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
  return (
    <>
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
    </>
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

/**
 * Music and sound effects on or off, a small row under Start in the start screen's Game column (#318, #272). The music
 * is off until the player turns it on; the click that turns it on is also the gesture the browser wants before
 * it plays sound. The volumes are in Preferences.
 */
function SoundToggles({
  sound,
}: {
  sound: { music: boolean; effects: boolean; setMusic: (on: boolean) => void; setEffects: (on: boolean) => void };
}) {
  const toggle = (label: string, on: boolean, set: (on: boolean) => void, hook: string) => (
    <Tip
      as="button"
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      tip={`${label} ${on ? 'on' : 'off'}`}
      {...{ [hook]: '' }}
      onClick={() => set(!on)}
    >
      {on ? '\u{1F50A}' : '\u{1F507}'} {label}: {on ? 'on' : 'off'}
    </Tip>
  );
  return (
    <div className="sound-toggles" role="group" aria-label="Sound">
      <span className="sound-label">Sound</span>
      {toggle('Music', sound.music, sound.setMusic, 'data-music')}
      {toggle('Sound effects', sound.effects, sound.setEffects, 'data-effects')}
    </div>
  );
}

/**
 * The setup the player has made on the start screen, handed across a ruleset switch so the new ruleset's screen
 * opens with it: what the new ruleset lacks (a nation, a level, an option) falls back to its default there.
 */
export interface StartSetup {
  /** The More options tab open, so the window keeps its size. */
  tab: string | null;
  nation: string | null;
  advantages: Advantages;
  nationType: string;
  colors: Record<string, string>;
  removed: string[];
  /** The nations the screen offered to leave out: one the new ruleset adds starts as its default has it. */
  offered: string[];
  difficulty: string;
  levelEdits: Record<string, OptionValue>;
  gameEdits: Record<string, OptionValue>;
  mapEdits: Record<string, OptionValue>;
  mapFiles: Record<string, File>;
  /** The map chosen: a MAPS id, or 'generated'. */
  map: string;
}

/** The edits a group still has an option for, other than the ones now at the group's own value. */
function keptEdits(group: OptionGroup | null, edits: Record<string, OptionValue>): Record<string, OptionValue> {
  const base = group ? leaves(group) : new Map();
  return Object.fromEntries(
    Object.entries(edits).filter(([id, v]) => base.has(id) && !sameValue(base.get(id)?.value, v)),
  );
}

export function StartScreen({
  options,
  start,
  rules,
  changeRules,
  setup,
  saves = [],
  open: openGame,
  openFile,
  exportSave,
  openNote,
  colopedia,
  art = () => null,
  sound,
  chosen: gameChosen,
}: {
  options: StartOptions;
  start: (choice: StartChoice) => void;
  /**
   * The ruleset the options are of, and a way to another one (the screen is drawn afresh: its options differ). The
   * switch hands back the setup made so far, for the new screen to open with.
   */
  rules?: string;
  changeRules?: (rules: string, setup: StartSetup) => void;
  /** The setup carried over from another ruleset's screen; the ruleset's defaults without it. */
  setup?: StartSetup;
  /** The saved games, newest first: the first is the one Continue plays. */
  saves?: SaveMeta[];
  /** Play a saved game. */
  open?: (id: number) => void;
  /** The player's New Game or Continue click, called inside it: the browser lets the title music start then (#272). */
  chosen?: () => void;
  /** Ask for a .fsg file and play it, as MainPanel's Open does with its file chooser. */
  openFile?: () => void;
  /** Download a save as a .fsg file. */
  exportSave?: (id: number) => void;
  /** Why the last file would not open, or what became of an export; empty for none. */
  openNote?: string;
  /**
   * The Colopedia, as the report the Engine builds from the rules alone, opened on an entry or none. Swing's
   * player table opens it on the nations and the nation types (PlayersTable); no button shows without it.
   */
  colopedia?: (select: string | null) => Promise<ReportView & { report: 'colopedia' }>;
  /** The art of a Colopedia entry, once the Tileset has loaded. */
  art?: Art;
  /** Music and sound effects on or off; no control shows without it. */
  sound?: { music: boolean; effects: boolean; setMusic: (on: boolean) => void; setEffects: (on: boolean) => void };
}) {
  useCoverage('showNewPanel');
  const open =
    openGame &&
    ((id: number) => {
      gameChosen?.();
      openGame(id);
    });
  const nationIds = [...options.nations, ...options.rivals].map((n) => n.id);
  const [advantages, setAdvantages] = useState<Advantages>(setup?.advantages ?? 'SELECTABLE');
  const [nationType, setNationType] = useState<string>(() =>
    setup && options.nationTypes.some((t) => t.id === setup.nationType) ? setup.nationType : '',
  );
  const [colors, setColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(setup?.colors ?? {}).filter(([id]) => nationIds.includes(id))),
  );
  const [removed, setRemoved] = useState<string[]>(() => {
    const byDefault = options.defaultUnavailable ?? [];
    if (!setup) return byDefault;
    // A nation both rulesets have keeps the player's tick; one only this ruleset has starts as its default.
    return nationIds.filter((id) => (setup.offered.includes(id) ? setup.removed.includes(id) : byDefault.includes(id)));
  });
  const [nation, setNation] = useState<string | null>(() =>
    setup?.nation && options.nations.some((n) => n.id === setup.nation)
      ? setup.nation
      : (options.nations[0]?.id ?? null),
  );
  const levels = options.levels;
  const [difficulty, setDifficulty] = useState(() =>
    setup && levels.some((l) => l.id === setup.difficulty)
      ? setup.difficulty
      : levels.some((l) => l.id === options.defaultLevel)
        ? options.defaultLevel
        : (levels[0]?.id ?? options.defaultLevel),
  );
  const chosen = options.nations.find((n) => n.id === nation);
  // Every nation but the player's own may be left out: the other Europeans, then the natives.
  const others = [
    ...options.nations.filter((n) => n.id !== nation).map((n) => ({ ...n, native: false })),
    ...options.rivals,
  ];
  const ownType = advantages === 'SELECTABLE' ? options.nationTypes.find((t) => t.id === nationType) : undefined;
  const levelGroup = useMemo(() => options.groups.level(difficulty), [options, difficulty]);
  // An option the new ruleset has keeps the value the player gave it under the other.
  const [levelEdits, setLevelEdits] = useState<Record<string, OptionValue>>(() =>
    setup && setup.difficulty === difficulty ? keptEdits(levelGroup, setup.levelEdits) : {},
  );
  const gameGroup = useMemo(() => options.groups.game(), [options]);
  const mapGroup = useMemo(() => options.groups.mapGenerator(), [options]);
  // The game and map options the player OK'd for an earlier game are the defaults of this one.
  const [gameEdits, setGameEdits] = useState(() =>
    setup ? keptEdits(gameGroup, setup.gameEdits) : loadDefaults('game', gameGroup),
  );
  const [mapEdits, setMapEdits] = useState(() =>
    setup ? keptEdits(mapGroup, setup.mapEdits) : loadDefaults('map', mapGroup),
  );
  // The files picked for the map generator's file options (the import file): a file is not an option value,
  // so it is not kept as a default.
  const [mapFiles, setMapFiles] = useState<Record<string, File>>(() => {
    const base = mapGroup ? leaves(mapGroup) : new Map();
    return Object.fromEntries(Object.entries(setup?.mapFiles ?? {}).filter(([id]) => base.has(id)));
  });
  // A map the game comes with (MAPS), or 'generated' for none.
  const [builtInMap, setBuiltInMap] = useState(setup?.map ?? 'generated');
  // The nation type the player starts with, as the server gives it (NationOptions): the one picked, the nation's own,
  // or none at all; and its starting units at this difficulty (expertStartingUnits, as edited).
  const playedType =
    advantages === 'NONE' ? 'model.nationType.default' : (ownType?.id ?? chosen?.typeId ?? 'model.nationType.default');
  const expertLeaf = levelGroup ? leaves(levelGroup).get(EXPERT_UNITS) : undefined;
  const expert = (levelEdits[EXPERT_UNITS] ?? expertLeaf?.value) === true;
  const bonus = chosen ? options.bonus(playedType, expert) : null;
  const [credits, setCredits] = useState(false);
  const [pedia, setPedia] = useState<ReportView | null>(null);
  const [opening, setOpening] = useState(false);
  // The saves open in a window of their own, as Game > Open's, not a foldout that pushes the start window about.
  const [savesShown, setSavesShown] = useState(false);
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
        // Opened here, not by WebGUI.showColopediaPanel, which the in-game Colopedia is.
        coverageHitMethod('showColopediaPanel');
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
  /** A small link to the Colopedia, beside what it explains; none without a Colopedia. */
  const pediaLink = (section: string, label: string) =>
    colopedia && (
      <button
        type="button"
        className="linkish pedia"
        data-flat=""
        data-colopedia={section}
        disabled={opening}
        onClick={() => openPedia(section)}
      >
        {label}
      </button>
    );
  /**
   * A European nation's swatch, which opens the browser's colour picker: the nation's colour in the game, as
   * Swing's player table edits it (ColorCellEditor). Inside the nation's label, a click on it picks the colour and
   * not the nation.
   */
  const colourPicker = (n: { id: string; name: string; color: string }, hook = false) => (
    <ColourSwatch
      hook={hook ? n.id : undefined}
      name={n.name}
      value={colors[n.id] ?? n.color}
      pick={(colour) => setColors((c) => ({ ...c, [n.id]: colour }))}
    />
  );
  const changed = (n: number) => (n > 0 ? ` (${n} changed)` : '');
  /** The nations that may be left out, under a heading that counts those taking part. */
  const rivalList = (heading: string, list: typeof others) =>
    list.length > 0 && (
      <div className="rival-group">
        <h3>
          {heading}{' '}
          <span className="quiet">
            {list.filter((r) => !removed.includes(r.id)).length} of {list.length}
          </span>
        </h3>
        <div className="rivals">
          {list.map((r) => (
            <label key={r.id} data-rival={r.id}>
              <input
                type="checkbox"
                checked={!removed.includes(r.id)}
                onChange={(e) =>
                  setRemoved(e.target.checked ? removed.filter((id) => id !== r.id) : [...removed, r.id])
                }
              />
              {r.native ? <span className="swatch" style={{ background: r.color }} /> : colourPicker(r)} {r.name}
            </label>
          ))}
        </div>
      </div>
    );
  const [tab, setTab] = useState<string | null>(setup?.tab ?? null);
  const count = (o: object) => Object.keys(o).length;
  /** The tabs under the columns: the options of the level, the game and the map. */
  const moreTabs: { kind: string; label: string; count: number; body: ReactNode }[] = [
    ...(levelGroup
      ? [
          {
            kind: 'difficulty',
            label: 'Level options',
            count: count(levelEdits),
            body: (
              <Customize
                key={levelGroup.id}
                group={levelGroup}
                edits={levelEdits}
                setEdits={setLevelEdits}
                tools={<LevelTools group={levelGroup} edits={levelEdits} setEdits={setLevelEdits} />}
              />
            ),
          },
        ]
      : []),
    ...(gameGroup
      ? [
          {
            kind: 'game',
            label: 'Game options',
            count: count(gameEdits),
            body: <Customize group={gameGroup} edits={gameEdits} setEdits={setGameEdits} />,
          },
        ]
      : []),
    ...(mapGroup
      ? [
          {
            kind: 'map',
            label: 'Map options',
            count: count(mapEdits) + count(mapFiles),
            body: (
              <Customize
                group={mapGroup}
                edits={mapEdits}
                setEdits={setMapEdits}
                files={mapFiles}
                setFile={(id, file) => {
                  const { [id]: _, ...rest } = mapFiles;
                  setMapFiles(file ? { ...rest, [id]: file } : rest);
                }}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="start" data-testid="start">
      <form
        className="start-window new-game"
        onSubmit={(e) => {
          e.preventDefault();
          gameChosen?.();
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
            builtInMap: MAPS.find((m) => m.id === builtInMap)?.url,
          });
        }}
      >
        <h1>BrowserCol</h1>
        {/* What most players change, side by side: their nation, the other nations, then the game and Start. */}
        <div className="start-cols">
          <fieldset className="col-nation">
            <legend>Your nation</legend>
            <div className="nations">
              {options.nations.map((n) => (
                <label key={n.id} className="nation" data-selected={flag(n.id === nation)}>
                  <input
                    type="radio"
                    name="nation"
                    value={n.id}
                    data-nation={n.id}
                    checked={n.id === nation}
                    onChange={() => setNation(n.id)}
                  />
                  {colourPicker(n, true)}
                  <span className="name">{n.name}</span>
                  <span className="type">{n.id === nation && ownType ? ownType.name : n.type}</span>
                </label>
              ))}
            </div>
            {bonus && (
              <div className="quiet nation-bonus" data-nation-bonus>
                {bonus.modifiers.length > 0 ? (
                  <ul>
                    {bonus.modifiers.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No national advantages.</p>
                )}
                {bonus.units.length > 0 && <p>Starting units: {bonus.units.join(', ')}</p>}
              </div>
            )}
            {pediaLink('nations', 'The nations in the Colopedia')}
          </fieldset>
          <div className="col-others">
            <fieldset className="advantages">
              <legend>Advantages</legend>
              <div className="field-grid">
                <span>National advantages</span>
                <Select
                  data-advantages
                  aria-label="National Advantages"
                  value={advantages}
                  onChange={(v) => setAdvantages(v as Advantages)}
                  choices={ADVANTAGES.map((a) => ({ value: a, label: ADVANTAGE_NAMES[a] }))}
                />
                {options.nationTypes.length > 0 && (
                  <>
                    <span>Your advantage</span>
                    <Select
                      data-nation-type
                      aria-label="Advantage of your nation"
                      value={advantages === 'SELECTABLE' ? nationType : ''}
                      disabled={advantages !== 'SELECTABLE'}
                      onChange={setNationType}
                      choices={[
                        {
                          value: '',
                          label: chosen?.type ? `${chosen.type} (the nation's own)` : "The nation's own",
                        },
                        ...options.nationTypes.map((t) => ({ value: t.id, label: t.name })),
                      ]}
                    />
                  </>
                )}
              </div>
              <p className="quiet">
                {ADVANTAGE_NOTES[advantages]} {pediaLink('nationTypes', 'The advantages in the Colopedia')}
              </p>
            </fieldset>
            {others.length > 0 && (
              <fieldset className="others">
                <legend>Other nations</legend>
                <div className="rival-groups">
                  {rivalList(
                    'European',
                    others.filter((r) => !r.native),
                  )}
                  {rivalList(
                    'Native',
                    others.filter((r) => r.native),
                  )}
                </div>
                <p className="quiet">The computer players. Untick a nation to leave it out of the game.</p>
              </fieldset>
            )}
          </div>
          <div className="col-game">
            <fieldset>
              <legend>Game</legend>
              <div className="field-grid">
                {rules !== undefined && changeRules && options.rulesets.length > 1 && (
                  <>
                    <span>Rules</span>
                    <span className="with-help">
                      <Select
                        data-rules
                        aria-label="Rules"
                        value={rules}
                        onChange={(r) =>
                          changeRules(r, {
                            tab,
                            nation,
                            advantages,
                            nationType,
                            colors,
                            removed,
                            offered: nationIds,
                            difficulty,
                            levelEdits,
                            gameEdits,
                            mapEdits,
                            mapFiles,
                            map: builtInMap,
                          })
                        }
                        choices={options.rulesets.map((r) => ({
                          value: r,
                          label: r === 'classic' ? 'Classic' : r === 'freecol' ? 'FreeCol' : r,
                        }))}
                      />
                      <HelpButton label="What the rule sets change" data-rules-help-button>
                        <RulesHelp />
                      </HelpButton>
                    </span>
                  </>
                )}
                <span>Difficulty</span>
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
                <span>Map</span>
                <Select
                  data-map
                  aria-label="Map"
                  value={builtInMap}
                  onChange={setBuiltInMap}
                  choices={[
                    { value: 'generated', label: 'Generated' },
                    ...MAPS.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
            </fieldset>
            <button type="submit" className="start-button" autoFocus data-start>
              Start game
            </button>
            {open && (saves.length > 0 || openFile) && (
              <div className="saved-games">
                {saves.length > 0 && (
                  <>
                    <button type="button" data-continue onClick={() => open(saves[0].id)}>
                      Continue Playing
                    </button>
                    <button type="button" data-open-saves onClick={() => setSavesShown(true)}>
                      Open a saved game...
                    </button>
                  </>
                )}
                {saves.length === 0 && (openFile || openNote) && <OpenFile openFile={openFile} note={openNote} />}
              </div>
            )}
            {open && savesShown && saves.length > 0 && (
              <OpenDialog
                saves={saves}
                open={open}
                openFile={openFile}
                exportSave={exportSave}
                note={openNote}
                close={() => setSavesShown(false)}
              />
            )}
            {sound && <SoundToggles sound={sound} />}
          </div>
        </div>
        {/*
         * The rarely changed settings, one tab each. No tab is open at first, so the window fits without a
         * scroll, and a second click on the open tab closes it. The panels stay mounted, and so do their edits.
         */}
        <Tabs.Root className="more-options" value={tab} onValueChange={(v) => setTab(v as string)}>
          <Tabs.List className="tabs" aria-label="More options">
            {moreTabs.map((t) => (
              <Tabs.Tab
                key={t.kind}
                value={t.kind}
                data-customize-tab={t.kind}
                onClick={() => {
                  if (tab === t.kind) setTab(null);
                }}
              >
                {t.label}
                {changed(t.count)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {moreTabs.map((t) => (
            <Tabs.Panel key={t.kind} value={t.kind} keepMounted className="customize" data-customize={t.kind}>
              {t.body}
            </Tabs.Panel>
          ))}
        </Tabs.Root>
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
