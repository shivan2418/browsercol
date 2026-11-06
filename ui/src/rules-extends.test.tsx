// @vitest-environment jsdom
// The FreeCol rules extend Classic (#337): their specification holds only the changes, and the start
// screen reads them on top of Classic's, as FreeCol's Specification does.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import { afterEach, expect, test } from 'vite-plus/test';
import { leaves } from './options';
import { startOptions, type StartChoice } from './start';
import { StartScreen } from './start-screen';

afterEach(cleanup);

const root = '../freecol/data';
/** The data bundle as the build makes it, for the files the start screen reads. */
const data = [
  'rules/classic/specification.xml',
  'rules/classic/FreeColMessages.properties',
  'rules/freecol/specification.xml',
  'rules/freecol/FreeColMessages.properties',
  'strings/FreeColMessages.properties',
].flatMap((p) => [`data/${p}`, fs.readFileSync(`${root}/${p}`, 'utf8')]);

const classic = startOptions(data, 'classic');
const freecol = startOptions(data, 'freecol');

test('the FreeCol rules offer the nations, rivals, advantages and levels Classic does', () => {
  expect(freecol.nations.length).toBeGreaterThan(0);
  expect(freecol.nations).toEqual(classic.nations);
  expect(freecol.rivals).toEqual(classic.rivals);
  expect(freecol.nationTypes).toEqual(classic.nationTypes);
  expect(freecol.levels).toEqual(classic.levels);
});

test('a level has every option, and takes FreeCol’s value where FreeCol changes it', () => {
  const level = 'model.difficulty.medium';
  const mine = leaves(freecol.groups.level(level)!);
  const theirs = leaves(classic.groups.level(level)!);
  expect([...mine.keys()]).toEqual([...theirs.keys()]);
  expect(mine.size).toBeGreaterThan(10);
  const crosses = (m: typeof mine) => m.get('model.option.crossesIncrement')?.value;
  expect(crosses(mine)).toBe(4);
  expect(crosses(theirs)).not.toBe(4);
});

test('the game options and the map generator options are all there', () => {
  expect([...leaves(freecol.groups.game()!).keys()]).toEqual([...leaves(classic.groups.game()!).keys()]);
  const map = leaves(freecol.groups.mapGenerator()!);
  expect(map.size).toBeGreaterThan(5);
  expect([...map.keys()]).toEqual([...leaves(classic.groups.mapGenerator()!).keys()]);
});

test('a changed option on the FreeCol rules is sent to the Engine in the preset', () => {
  const started: StartChoice[] = [];
  render(<StartScreen options={freecol} start={(c) => started.push(c)} rules="freecol" />);
  const fog = leaves(freecol.groups.game()!).get('model.option.fogOfWar')!;
  fireEvent.click(screen.getByLabelText(fog.label));
  fireEvent.click(document.querySelector('[data-start]')!);
  expect(started).toHaveLength(1);
  expect(started[0].options).toEqual({ 'model.option.fogOfWar': false });
});
