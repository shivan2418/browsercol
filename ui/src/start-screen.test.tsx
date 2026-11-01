// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import type { StartChoice, StartOptions } from './start';
import { StartScreen } from './start-screen';

afterEach(cleanup);

const options: StartOptions = {
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

function screenWith() {
  const started: StartChoice[] = [];
  render(<StartScreen options={options} start={(c) => started.push(c)} />);
  return started;
}

test('it starts with the first nation and the default level', () => {
  const started = screenWith();
  fireEvent.click(screen.getByText('Start game'));
  expect(started).toEqual([{ nation: 'model.nation.dutch', difficulty: 'model.difficulty.medium', options: {} }]);
});

test('the player picks a nation and a level and starts', () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-nation="model.nation.french"]')!);
  fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'model.difficulty.easy' } });
  expect(screen.getByText('Friendlier natives')).toBeTruthy();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([{ nation: 'model.nation.french', difficulty: 'model.difficulty.easy', options: {} }]);
});

test('the level’s options and the game options are changed in the editor and sent as the preset’s options', () => {
  const started = screenWith();
  fireEvent.change(screen.getByLabelText('Land price factor'), { target: { value: '250' } });
  fireEvent.click(screen.getByLabelText('Fog of war'));
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([
    {
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
