// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { BUILD } from './build';
import { startOptions, type StartChoice, type StartOptions } from './start';
import fs from 'node:fs';
import { StartScreen } from './start-screen';
import { chooseOption } from './select-test';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const options: StartOptions = {
  rivals: [{ id: 'model.nation.inca', name: 'Inca', color: 'gold', native: true }],
  nationTypes: [
    { id: 'model.nationType.trade', name: 'Trade', description: 'Prices are more favorable' },
    { id: 'model.nationType.conquest', name: 'Conquest', description: 'Stronger soldiers' },
  ],
  bonus: (type, expert) => ({
    modifiers:
      type === 'model.nationType.trade'
        ? ['Your buying and selling in Europe moves prices there 50% less.']
        : type === 'model.nationType.cooperation'
          ? ['Native Alarm Bonus: -50%']
          : type === 'model.nationType.conquest'
            ? ['Native Convert Bonus: +200%']
            : [],
    units: [expert ? 'Veteran Soldier (Soldier)' : 'Free Colonist (Soldier)', 'Caravel'],
  }),
  rulesets: ['classic', 'freecol'],
  nations: [
    {
      id: 'model.nation.dutch',
      name: 'Dutch',
      typeId: 'model.nationType.trade',
      type: 'Trade',
      description: 'Prices are more favorable',
      color: 'orange',
    },
    {
      id: 'model.nation.french',
      name: 'French',
      typeId: 'model.nationType.cooperation',
      type: 'Cooperation',
      description: 'Friendlier natives',
      color: 'blue',
    },
  ],
  levels: [
    { id: 'model.difficulty.easy', name: 'Easy' },
    { id: 'model.difficulty.medium', name: 'Medium' },
  ],
  defaultLevel: 'model.difficulty.medium',
  groups: {
    level: (id) => ({
      id,
      kind: 'group',
      label: id,
      description: null,
      children: [
        {
          id: 'model.difficulty.natives',
          kind: 'group',
          label: 'Natives',
          description: null,
          children: [
            {
              id: 'model.option.landPriceFactor',
              kind: 'integer',
              label: 'Land price factor',
              description: null,
              value: id.endsWith('easy') ? 40 : 100,
              min: 0,
              max: 500,
            },
          ],
        },
      ],
    }),
    mapGenerator: () => ({
      id: 'mapGeneratorOptions',
      kind: 'group',
      label: 'Map generator',
      description: null,
      children: [
        {
          id: 'model.option.mapWidth',
          kind: 'integer',
          label: 'Map width',
          description: null,
          value: 40,
          min: 30,
          max: 200,
        },
        { id: 'model.option.importFile', kind: 'file', label: 'Import file', description: null, value: '' },
      ],
    }),
    game: () => ({
      id: 'gameOptions',
      kind: 'group',
      label: 'Game Options',
      description: null,
      children: [
        {
          id: 'gameOptions.map',
          kind: 'group',
          label: 'Map',
          description: null,
          children: [
            { id: 'model.option.fogOfWar', kind: 'boolean', label: 'Fog of war', description: null, value: true },
          ],
        },
      ],
    }),
  },
};

/** What a start with no change to the new choices sends. */
const plain = { advantages: 'SELECTABLE', colors: {}, unavailable: [] };

function screenWith() {
  const started: StartChoice[] = [];
  render(<StartScreen options={options} start={(c) => started.push(c)} />);
  return started;
}

test('it starts with the first nation and the default level', () => {
  const started = screenWith();
  fireEvent.click(screen.getByText('Start game'));
  expect(started).toEqual([
    { ...plain, nation: 'model.nation.dutch', difficulty: 'model.difficulty.medium', options: {} },
  ]);
});

test('the player picks a nation and a level and starts', async () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-nation="model.nation.french"]')!);
  await chooseOption(screen.getByLabelText('Difficulty'), 'Easy');
  expect(screen.getByText('Native Alarm Bonus: -50%')).toBeTruthy();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([
    { ...plain, nation: 'model.nation.french', difficulty: 'model.difficulty.easy', options: {} },
  ]);
});

test('it shows what the nation type the player starts with gives, not a summary of it', async () => {
  screenWith();
  const bonus = () => document.querySelector('[data-nation-bonus]')!.textContent;
  expect(bonus()).toBe(
    'Your buying and selling in Europe moves prices there 50% less.Starting units: Free Colonist (Soldier), Caravel',
  );
  expect(bonus()).not.toContain('Prices are more favorable');
  await chooseOption(screen.getByLabelText('Advantage of your nation'), 'Conquest');
  expect(bonus()).toContain('Native Convert Bonus: +200%');
  await chooseOption(screen.getByLabelText('National Advantages'), 'None');
  expect(bonus()).toBe('No national advantages.Starting units: Free Colonist (Soldier), Caravel');
});

test('the level’s options and the game options are changed in the editor and sent as the preset’s options', () => {
  const started = screenWith();
  fireEvent.change(screen.getByLabelText('Land price factor'), { target: { value: '250' } });
  fireEvent.click(screen.getByLabelText('Fog of war'));
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([
    {
      ...plain,
      nation: 'model.nation.dutch',
      difficulty: 'model.difficulty.medium',
      options: { 'model.option.landPriceFactor': 250, 'model.option.fogOfWar': false },
    },
  ]);
});

test('an option put back to the level’s own value is not sent, and another level starts afresh', async () => {
  const started = screenWith();
  const price = () => screen.getByLabelText('Land price factor') as HTMLInputElement;
  fireEvent.change(price(), { target: { value: '250' } });
  expect(document.querySelector('[data-customize-tab=difficulty]')?.textContent).toContain('1 changed');
  fireEvent.change(price(), { target: { value: '100' } });
  expect(document.querySelector('[data-customize-tab=difficulty]')?.textContent).not.toContain('changed');
  fireEvent.change(price(), { target: { value: '250' } });
  await chooseOption(screen.getByLabelText('Difficulty'), 'Easy');
  expect(price().value).toBe('40');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].options).toEqual({});
});

test('the map generator options are changed in the editor and sent as the preset’s options', () => {
  const started = screenWith();
  const width = () => screen.getByLabelText('Map width') as HTMLInputElement;
  expect(width().value).toBe('40');
  fireEvent.change(width(), { target: { value: '120' } });
  expect(document.querySelector('[data-customize-tab=map]')?.textContent).toContain('1 changed');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].options).toEqual({ 'model.option.mapWidth': 120 });
});

test('a map file is picked for the import file option and sent with the choice, not as an option', () => {
  const started = screenWith();
  const pick = () => screen.getByLabelText('Import file') as HTMLInputElement;
  expect(document.querySelector('[data-option="model.option.importFile"] [data-file-none]')).not.toBeNull();
  const file = new File([new Uint8Array([1, 2, 3])], 'world.fsm');
  fireEvent.change(pick(), { target: { files: [file] } });
  expect(document.querySelector('[data-file-name]')?.textContent).toBe('world.fsm');
  expect(document.querySelector('[data-customize-tab=map]')?.textContent).toContain('1 changed');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].importMap).toBe(file);
  expect(started[0].options).toEqual({});
  // Not kept as a default for the next game.
  expect(localStorage.getItem('freecol.defaults.map')).toBeNull();
});

test('a picked map file is cleared again', () => {
  const started = screenWith();
  fireEvent.change(screen.getByLabelText('Import file'), { target: { files: [new File(['x'], 'world.fsm')] } });
  fireEvent.click(document.querySelector('[data-file-clear]')!);
  expect(document.querySelector('[data-file-name]')).toBeNull();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].importMap).toBeUndefined();
});

test('the more options are tabs: none open at first, a click opens one, a second click closes it', () => {
  const started = screenWith();
  const panel = (kind: string) => document.querySelector<HTMLElement>(`[data-customize=${kind}]`)!;
  const tab = (kind: string) => document.querySelector<HTMLElement>(`[data-customize-tab=${kind}]`)!;
  expect(['difficulty', 'game', 'map'].map((k) => panel(k).hidden)).toEqual([true, true, true]);
  expect(tab('colours')).toBeNull();
  fireEvent.click(tab('game'));
  expect(panel('game').hidden).toBe(false);
  expect(tab('game').getAttribute('aria-selected')).toBe('true');
  fireEvent.click(tab('map'));
  expect([panel('game').hidden, panel('map').hidden]).toEqual([true, false]);
  fireEvent.click(tab('map'));
  expect(panel('map').hidden).toBe(true);
  // A tab is no submit button: the game starts only from Start.
  expect(started).toEqual([]);
});

test('links the source and opens the credits, which name the CC BY authors and the build', () => {
  render(<StartScreen options={options} start={() => {}} />);
  expect(document.querySelector('[data-build]')?.textContent).toBe(BUILD);
  expect(screen.getByRole('link', { name: 'Source code' }).getAttribute('href')).toBe(
    'https://github.com/shivan2418/browsercol',
  );
  expect(screen.queryByRole('dialog', { name: 'About BrowserCol' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Credits' }));
  const credits = screen.getByRole('dialog', { name: 'About BrowserCol' });
  expect(credits.textContent).toContain('Alexander Zhelanov');
  expect(credits.textContent).toContain('CC BY 4.0');
  expect(credits.querySelector('a[href$="OFL.txt"]')?.textContent).toBe('SIL OFL 1.1');
  expect(credits.textContent).toContain('Cinzel font');
  expect(credits.textContent).toContain(`Build: ${BUILD}`);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'About BrowserCol' })).toBeNull();
});

test('the player removes nations from the game, and the own nation cannot be removed', () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-rival="model.nation.inca"] input')!);
  fireEvent.click(document.querySelector('[data-rival="model.nation.french"] input')!);
  // The French are chosen as the player's own: they are no longer a rival to leave out.
  fireEvent.click(document.querySelector('[data-nation="model.nation.french"]')!);
  expect(document.querySelector('[data-rival="model.nation.french"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].unavailable).toEqual(['model.nation.inca']);
});

test('the player picks the advantages, the own nation’s type and a nation colour', async () => {
  const started = screenWith();
  await chooseOption(document.querySelector('[data-nation-type]')!, 'Conquest');
  expect(screen.getByText('Native Convert Bonus: +200%')).toBeTruthy();
  fireEvent.change(document.querySelector('[data-colour="model.nation.dutch"]')!, { target: { value: '#336699' } });
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0]).toMatchObject({
    advantages: 'SELECTABLE',
    nationType: 'model.nationType.conquest',
    colors: { 'model.nation.dutch': '#336699' },
  });
  // With fixed advantages the nation keeps its own type.
  cleanup();
  const again = screenWith();
  await chooseOption(document.querySelector('[data-advantages]')!, 'Fixed');
  expect((document.querySelector('[data-nation-type]') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(again[0].advantages).toBe('FIXED');
  expect(again[0].nationType).toBeUndefined();
});

test('another ruleset is a choice of the start screen', async () => {
  const rules: string[] = [];
  render(<StartScreen options={options} start={() => {}} rules="classic" changeRules={(r) => rules.push(r)} />);
  await chooseOption(document.querySelector('[data-rules]')!, 'FreeCol');
  expect(rules).toEqual(['freecol']);
});

test('the open options tab stays open across a ruleset switch, so the window does not jump', async () => {
  const switched: [string, string | null][] = [];
  const { rerender } = render(
    <StartScreen
      key="classic"
      options={options}
      start={() => {}}
      rules="classic"
      changeRules={(r, tab) => switched.push([r, tab])}
    />,
  );
  fireEvent.click(document.querySelector('[data-customize-tab="game"]')!);
  await chooseOption(document.querySelector('[data-rules]')!, 'FreeCol');
  expect(switched).toEqual([['freecol', 'game']]);
  // main.tsx draws the new ruleset's screen afresh (a new key), opened on the tab handed back.
  rerender(<StartScreen key="freecol" options={options} start={() => {}} rules="freecol" tab="game" />);
  expect(document.querySelector('[data-customize-tab="game"]')!.getAttribute('aria-selected')).toBe('true');
});

test('the start screen offers to continue the newest save and to open another', () => {
  const opened: number[] = [];
  const save = (id: number, name: string) => ({ id, name, date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 });
  render(
    <StartScreen
      options={options}
      start={() => {}}
      saves={[save(7, 'Newest'), save(2, 'Older')]}
      open={(id) => opened.push(id)}
    />,
  );
  fireEvent.click(document.querySelector('[data-continue]')!);
  // The saves are in a window of their own, not on the start window (no foldout to shift its layout).
  expect(document.querySelector('[data-save-picker]')).toBeNull();
  fireEvent.click(document.querySelector('[data-open-saves]')!);
  fireEvent.doubleClick(document.querySelector('[data-open-save="2"]')!);
  expect(opened).toEqual([7, 2]);
  fireEvent.click(document.querySelector('[data-open-cancel]')!);
  expect(document.querySelector('[data-save-picker]')).toBeNull();
});

test('with no saves there is nothing to continue', () => {
  render(<StartScreen options={options} start={() => {}} saves={[]} open={() => {}} />);
  expect(document.querySelector('[data-continue]')).toBeNull();
});

test('with no saves a save file can still be opened, and the reason one will not open is shown', () => {
  let asked = 0;
  render(
    <StartScreen
      options={options}
      start={() => {}}
      saves={[]}
      open={() => {}}
      openFile={() => asked++}
      openNote="Could not open the file: not a zip"
    />,
  );
  fireEvent.click(document.querySelector('[data-open-file]')!);
  expect(asked).toBe(1);
  expect(screen.getByText('Could not open the file: not a zip')).toBeTruthy();
});

test('the game options the player started with are the defaults of the next game, the level’s are not', () => {
  const first = screenWith();
  fireEvent.click(screen.getByLabelText('Fog of war'));
  fireEvent.change(screen.getByLabelText('Land price factor'), { target: { value: '250' } });
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(first[0].options).toEqual({ 'model.option.fogOfWar': false, 'model.option.landPriceFactor': 250 });
  cleanup();
  const second = screenWith();
  expect((screen.getByLabelText('Fog of war') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Land price factor') as HTMLInputElement).value).toBe('100');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(second[0].options).toEqual({ 'model.option.fogOfWar': false });
});

test('Reset undoes the edits of the level', () => {
  screenWith();
  const price = () => screen.getByLabelText('Land price factor') as HTMLInputElement;
  const reset = document.querySelector<HTMLButtonElement>('[data-level-reset]')!;
  expect(reset.disabled).toBe(true);
  fireEvent.change(price(), { target: { value: '250' } });
  expect(reset.disabled).toBe(false);
  // Pressing Reset takes the focus out of the field, which shows what it holds again.
  fireEvent.blur(price());
  fireEvent.click(reset);
  expect(price().value).toBe('100');
});

test('a level loads from a file, and a file that is no level says so', async () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-customize-tab=difficulty]')!);
  const input = document.querySelector<HTMLInputElement>('[data-level-file]')!;
  const load = (text: string) => fireEvent.change(input, { target: { files: [new File([text], 'level.json')] } });
  load('nonsense');
  expect((await screen.findByRole('alert')).textContent).toContain('not a difficulty level');
  load(JSON.stringify({ difficulty: 'model.difficulty.medium', options: { 'model.option.landPriceFactor': 300 } }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Land price factor').value).toBe('300'));
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].options).toEqual({ 'model.option.landPriceFactor': 300 });
});

const pedia = (select: string | null) => ({
  report: 'colopedia' as const,
  title: 'Colopedia',
  ok: 'OK',
  back: null,
  select,
  sections: [
    {
      id: 'nations',
      name: 'Nations',
      entries: [
        { id: 'model.nation.dutch', name: 'Dutch', group: null, keys: [], text: 'Orange.', facts: [] },
        { id: 'model.nation.french', name: 'French', group: null, keys: [], text: 'Blue.', facts: [] },
      ],
    },
    {
      id: 'nationTypes',
      name: 'National Advantages',
      entries: [{ id: 'model.nationType.trade', name: 'Trade', group: null, keys: [], text: 'Prices.', facts: [] }],
    },
  ],
});

test('the Nation and Advantage buttons open the Colopedia on the nations and the nation types, before any game', async () => {
  const colopedia = vi.fn((select: string | null) => Promise.resolve(pedia(select)));
  render(<StartScreen options={options} start={() => {}} colopedia={colopedia} />);
  fireEvent.click(document.querySelector('[data-colopedia="nations"]')!);
  const tree = await screen.findByRole('tree');
  expect(tree.querySelector('[data-section="nations"]')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('.colopedia .detail h3')?.textContent).toBe('Dutch');
  fireEvent.click(screen.getByText('OK'));
  expect(screen.queryByRole('tree')).toBeNull();
  fireEvent.click(document.querySelector('[data-colopedia="nationTypes"]')!);
  await screen.findByRole('tree');
  expect(document.querySelector('[data-section="nationTypes"]')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('.colopedia .detail h3')?.textContent).toBe('Trade');
  expect(colopedia).toHaveBeenCalledTimes(2);
});

test('without a Colopedia there are no buttons for it, and one that fails says so', async () => {
  const { unmount } = render(<StartScreen options={options} start={() => {}} />);
  expect(document.querySelector('[data-colopedia]')).toBeNull();
  unmount();
  render(<StartScreen options={options} start={() => {}} colopedia={() => Promise.reject(new Error('no rules'))} />);
  fireEvent.click(document.querySelector('[data-colopedia="nations"]')!);
  expect((await screen.findByRole('alert')).textContent).toContain('no rules');
});

test('the sound toggles show music and sound effects on or off, and change them', () => {
  const calls: string[] = [];
  const sound = {
    music: false,
    effects: true,
    setMusic: (on: boolean) => calls.push(`music ${on}`),
    setEffects: (on: boolean) => calls.push(`effects ${on}`),
  };
  const { container } = render(<StartScreen options={options} start={() => {}} sound={sound} />);
  const music = container.querySelector<HTMLElement>('[data-music]')!;
  const effects = container.querySelector<HTMLElement>('[data-effects]')!;
  expect(music.getAttribute('aria-pressed')).toBe('false');
  expect(effects.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(music);
  fireEvent.click(effects);
  expect(calls).toEqual(['music true', 'effects false']);
});

test('Start game and Continue Playing are the choices that start the title music', () => {
  let chosen = 0;
  const { unmount } = render(<StartScreen options={options} start={() => {}} chosen={() => chosen++} />);
  expect(chosen).toBe(0);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(chosen).toBe(1);
  unmount();
  const saves = [{ id: 7, name: 'a', date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 }];
  render(<StartScreen options={options} start={() => {}} saves={saves} open={() => {}} chosen={() => chosen++} />);
  fireEvent.click(document.querySelector('[data-continue]')!);
  expect(chosen).toBe(2);
});

test('the start screen opens with Start focused, so the focus ring marks the default', () => {
  screenWith();
  expect(document.activeElement).toBe(document.querySelector('[data-start]'));
});

/** The real Classic and FreeCol specifications, as the data bundle has them. */
const realData = [
  'rules/classic/specification.xml',
  'rules/classic/FreeColMessages.properties',
  'rules/freecol/specification.xml',
  'rules/freecol/FreeColMessages.properties',
  'strings/FreeColMessages.properties',
].flatMap((p) => [`data/${p}`, fs.readFileSync(`../freecol/data/${p}`, 'utf8')]);
const EXTRAS = ['portuguese', 'swedish', 'danish', 'russian'].map((n) => `model.nation.${n}`);
const ticked = (id: string) => document.querySelector<HTMLInputElement>(`[data-rival="${id}"] input`)!.checked;

test('under Classic only the four classic European nations take part at first, and an extra can be ticked', () => {
  const started: StartChoice[] = [];
  render(<StartScreen options={startOptions(realData, 'classic')} start={(c) => started.push(c)} />);
  expect(EXTRAS.map(ticked)).toEqual([false, false, false, false]);
  expect(['french', 'english', 'spanish'].map((n) => ticked(`model.nation.${n}`))).toEqual([true, true, true]);
  fireEvent.click(document.querySelector('[data-rival="model.nation.swedish"] input')!);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].nation).toBe('model.nation.dutch');
  expect(started[0].unavailable).toEqual(EXTRAS.filter((id) => id !== 'model.nation.swedish'));
});

test('under Classic an extra picked as the player’s own nation takes part', () => {
  const started: StartChoice[] = [];
  render(<StartScreen options={startOptions(realData, 'classic')} start={(c) => started.push(c)} />);
  fireEvent.click(document.querySelector('[data-nation="model.nation.russian"]')!);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].nation).toBe('model.nation.russian');
  expect(started[0].unavailable).toEqual(EXTRAS.filter((id) => id !== 'model.nation.russian'));
});

test('under FreeCol too only the first four European nations take part at first', () => {
  const started: StartChoice[] = [];
  render(<StartScreen options={startOptions(realData, 'freecol')} start={(c) => started.push(c)} rules="freecol" />);
  expect(EXTRAS.map(ticked)).toEqual([false, false, false, false]);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].unavailable).toEqual(EXTRAS);
});

test('a ? beside Rules opens a summary of what the rule sets change, and closes on Escape, a click outside or a second click', async () => {
  render(<StartScreen options={options} start={() => {}} rules="classic" changeRules={() => {}} />);
  const button = () => screen.getByLabelText('What the rule sets change');
  const summary = () => document.querySelector('[data-rules-help]');
  expect(button().getAttribute('aria-expanded')).toBe('false');
  expect(summary()).toBeNull();
  fireEvent.click(button());
  await waitFor(() => expect(summary()).not.toBeNull());
  expect(button().getAttribute('aria-expanded')).toBe('true');
  expect([...summary()!.querySelectorAll('th[scope=col]')].map((h) => h.textContent)).toEqual([
    'Topic',
    'Classic',
    'FreeCol',
  ]);
  expect(summary()!.textContent).toContain('Game options');
  // Escape.
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(summary()).toBeNull());
  expect(button().getAttribute('aria-expanded')).toBe('false');
  // A second click on the button.
  fireEvent.click(button());
  await waitFor(() => expect(summary()).not.toBeNull());
  fireEvent.click(button());
  await waitFor(() => expect(summary()).toBeNull());
  // A click outside.
  fireEvent.click(button());
  await waitFor(() => expect(summary()).not.toBeNull());
  fireEvent.pointerDown(document.body);
  fireEvent.mouseDown(document.body);
  fireEvent.click(document.body);
  await waitFor(() => expect(summary()).toBeNull());
});

test('the ? shows only where there is a choice of rule sets', () => {
  render(
    <StartScreen
      options={{ ...options, rulesets: ['classic'] }}
      start={() => {}}
      rules="classic"
      changeRules={() => {}}
    />,
  );
  expect(screen.queryByLabelText('What the rule sets change')).toBeNull();
});
