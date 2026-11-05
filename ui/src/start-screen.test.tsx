// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import type { StartChoice, StartOptions } from './start';
import { StartScreen } from './start-screen';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const options: StartOptions = {
  rivals: [{ id: 'model.nation.inca', name: 'Inca', color: 'gold', native: true }],
  nationTypes: [
    { id: 'model.nationType.trade', name: 'Trade', description: 'Prices are more favorable' },
    { id: 'model.nationType.conquest', name: 'Conquest', description: 'Stronger soldiers' },
  ],
  rulesets: ['classic', 'freecol'],
  nations: [
    {
      id: 'model.nation.dutch',
      name: 'Dutch',
      type: 'Trade',
      description: 'Prices are more favorable',
      color: 'orange',
    },
    {
      id: 'model.nation.french',
      name: 'French',
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

test('the player picks a nation and a level and starts', () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-nation="model.nation.french"]')!);
  fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'model.difficulty.easy' } });
  expect(screen.getByText('Friendlier natives')).toBeTruthy();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([
    { ...plain, nation: 'model.nation.french', difficulty: 'model.difficulty.easy', options: {} },
  ]);
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

test('an option put back to the level’s own value is not sent, and another level starts afresh', () => {
  const started = screenWith();
  const price = () => screen.getByLabelText('Land price factor') as HTMLInputElement;
  fireEvent.change(price(), { target: { value: '250' } });
  expect(document.querySelector('[data-customize=difficulty] summary')?.textContent).toContain('1 changed');
  fireEvent.change(price(), { target: { value: '100' } });
  expect(document.querySelector('[data-customize=difficulty] summary')?.textContent).not.toContain('changed');
  fireEvent.change(price(), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'model.difficulty.easy' } });
  expect(price().value).toBe('40');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].options).toEqual({});
});

test('the map generator options are changed in the editor and sent as the preset’s options', () => {
  const started = screenWith();
  const width = () => screen.getByLabelText('Map width') as HTMLInputElement;
  expect(width().value).toBe('40');
  fireEvent.change(width(), { target: { value: '120' } });
  expect(document.querySelector('[data-customize=map] summary')?.textContent).toContain('1 changed');
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
  expect(document.querySelector('[data-customize=map] summary')?.textContent).toContain('1 changed');
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

test('links the source and opens the credits, which name the CC BY authors', () => {
  render(<StartScreen options={options} start={() => {}} />);
  expect(screen.getByRole('link', { name: 'Source code' }).getAttribute('href')).toBe(
    'https://github.com/shivan2418/freecol-online',
  );
  expect(screen.queryByRole('dialog', { name: 'About FreeCol Online' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Credits' }));
  const credits = screen.getByRole('dialog', { name: 'About FreeCol Online' });
  expect(credits.textContent).toContain('Alexander Zhelanov');
  expect(credits.textContent).toContain('CC BY 4.0');
  expect(credits.querySelector('a[href$="OFL.txt"]')?.textContent).toBe('SIL OFL 1.1');
  expect(credits.textContent).toContain('Cinzel font');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'About FreeCol Online' })).toBeNull();
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

test('the player picks the advantages, the own nation’s type and a nation colour', () => {
  const started = screenWith();
  fireEvent.change(document.querySelector('[data-nation-type]')!, { target: { value: 'model.nationType.conquest' } });
  expect(screen.getByText('Stronger soldiers')).toBeTruthy();
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
  fireEvent.change(document.querySelector('[data-advantages]')!, { target: { value: 'FIXED' } });
  expect((document.querySelector('[data-nation-type]') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(again[0].advantages).toBe('FIXED');
  expect(again[0].nationType).toBeUndefined();
});

test('another ruleset is a choice of the start screen', () => {
  const rules: string[] = [];
  render(<StartScreen options={options} start={() => {}} rules="classic" changeRules={(r) => rules.push(r)} />);
  fireEvent.change(document.querySelector('[data-rules]')!, { target: { value: 'freecol' } });
  expect(rules).toEqual(['freecol']);
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
  fireEvent.click(document.querySelector('[data-open-save="2"]')!);
  expect(opened).toEqual([7, 2]);
});

test('with no saves there is nothing to continue', () => {
  render(<StartScreen options={options} start={() => {}} saves={[]} open={() => {}} />);
  expect(document.querySelector('[data-continue]')).toBeNull();
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
  fireEvent.click(reset);
  expect(price().value).toBe('100');
});

test('a level loads from a file, and a file that is no level says so', async () => {
  const started = screenWith();
  const input = document.querySelector<HTMLInputElement>('[data-level-file]')!;
  const load = (text: string) => fireEvent.change(input, { target: { files: [new File([text], 'level.json')] } });
  load('nonsense');
  expect((await screen.findByRole('alert')).textContent).toContain('not a difficulty level');
  load(JSON.stringify({ difficulty: 'model.difficulty.medium', options: { 'model.option.landPriceFactor': 300 } }));
  await screen.findByDisplayValue('300');
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started[0].options).toEqual({ 'model.option.landPriceFactor': 300 });
});
