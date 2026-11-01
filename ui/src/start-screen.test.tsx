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
      color: '#ff9d3c',
    },
    {
      id: 'model.nation.french',
      name: 'French',
      type: 'Cooperation',
      description: 'Friendlier natives',
      color: '#0000ff',
    },
  ],
  levels: [
    { id: 'model.difficulty.easy', name: 'Easy' },
    { id: 'model.difficulty.medium', name: 'Medium' },
  ],
  defaultLevel: 'model.difficulty.medium',
};

function screenWith() {
  const started: StartChoice[] = [];
  render(<StartScreen options={options} start={(c) => started.push(c)} />);
  return started;
}

test('it starts with the first nation and the default level', () => {
  const started = screenWith();
  fireEvent.click(screen.getByText('Start game'));
  expect(started).toEqual([{ nation: 'model.nation.dutch', difficulty: 'model.difficulty.medium' }]);
});

test('the player picks a nation and a level and starts', () => {
  const started = screenWith();
  fireEvent.click(document.querySelector('[data-nation="model.nation.french"]')!);
  fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'model.difficulty.easy' } });
  expect(screen.getByText('Friendlier natives')).toBeTruthy();
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toEqual([{ nation: 'model.nation.french', difficulty: 'model.difficulty.easy' }]);
});
