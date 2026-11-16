// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import { TitleScreen } from './title-screen';

afterEach(cleanup);

const save = (id: number, name: string) => ({ id, name, date: 0, turn: 3, year: 1495, nation: 'Dutch', size: 1 });
const click = (hook: string) => fireEvent.click(document.querySelector(`[${hook}]`)!);

test('New Game goes on to the start screen', () => {
  let started = 0;
  render(<TitleScreen newGame={() => started++} />);
  click('data-new-game');
  expect(started).toBe(1);
});

test('the title screen offers to continue the newest save and to load another', () => {
  const opened: number[] = [];
  render(
    <TitleScreen newGame={() => {}} saves={[save(7, 'Newest'), save(2, 'Older')]} open={(id) => opened.push(id)} />,
  );
  click('data-continue');
  // The saves are in a window of their own, opened by Load Game.
  expect(document.querySelector('[data-save-picker]')).toBeNull();
  click('data-open-saves');
  fireEvent.doubleClick(document.querySelector('[data-open-save="2"]')!);
  expect(opened).toEqual([7, 2]);
  click('data-open-cancel');
  expect(document.querySelector('[data-save-picker]')).toBeNull();
});

test('Continue is the first choice, and focused, when there is a save; New Game is when there is none', () => {
  const { unmount } = render(<TitleScreen newGame={() => {}} saves={[save(7, 'a')]} open={() => {}} />);
  expect(document.querySelector('nav button')).toBe(document.querySelector('[data-continue]'));
  expect(document.activeElement).toBe(document.querySelector('[data-continue]'));
  unmount();
  render(<TitleScreen newGame={() => {}} saves={[]} open={() => {}} />);
  expect(document.querySelector('[data-continue]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('[data-new-game]'));
});

test('Continue says "Resume your last game" when the newest save is the background one', () => {
  const { unmount } = render(
    <TitleScreen newGame={() => {}} saves={[save(7, 'Background autosave')]} open={() => {}} />,
  );
  expect(document.querySelector('[data-continue]')!.textContent).toBe('Resume your last game');
  unmount();
  render(<TitleScreen newGame={() => {}} saves={[save(8, 'Mine'), save(7, 'Background autosave')]} open={() => {}} />);
  expect(document.querySelector('[data-continue]')!.textContent).toBe('Continue');
});

test('with no saves Load Game asks for a file, and the reason one would not open is shown', () => {
  let asked = 0;
  render(
    <TitleScreen
      newGame={() => {}}
      saves={[]}
      open={() => {}}
      openFile={() => asked++}
      openNote="Could not open the file: not a zip"
    />,
  );
  click('data-open-saves');
  expect(asked).toBe(1);
  expect(screen.getByText('Could not open the file: not a zip')).toBeTruthy();
});

test('Options opens the preferences, which close again', () => {
  render(<TitleScreen newGame={() => {}} preferences={(close) => <button data-prefs-close onClick={close} />} />);
  expect(document.querySelector('[data-prefs-close]')).toBeNull();
  click('data-title-options');
  click('data-prefs-close');
  expect(document.querySelector('[data-prefs-close]')).toBeNull();
});

test('Quit closes the tab, and says how when the browser keeps it open', () => {
  let asked = 0;
  render(<TitleScreen newGame={() => {}} quit={() => (asked++, false)} />);
  expect(screen.queryByRole('status')).toBeNull();
  click('data-quit');
  expect(asked).toBe(1);
  expect(screen.getByRole('status').textContent).toMatch(/close the tab/);
});

test('any menu choice but Quit is the click that starts the title music', () => {
  let chosen = 0;
  render(
    <TitleScreen
      newGame={() => {}}
      saves={[save(7, 'a')]}
      open={() => {}}
      preferences={() => null}
      chosen={() => chosen++}
      quit={() => false}
    />,
  );
  for (const hook of ['data-continue', 'data-new-game', 'data-open-saves', 'data-title-options']) click(hook);
  expect(chosen).toBe(4);
  click('data-quit');
  expect(chosen).toBe(4);
});
