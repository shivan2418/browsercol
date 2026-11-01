// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import { presetJson, startOptions } from './start';

const spec = `<freecol-specification id="classic">
  <nations>
    <nation id="model.nation.unknownEnemy" color="0x000000" nation-type="model.nationType.default" selectable="false"/>
    <nation id="model.nation.dutch" color="0xff9d3c" nation-type="model.nationType.trade" selectable="true"/>
    <nation id="model.nation.english" color="0xff0000" nation-type="model.nationType.immigration" selectable="true"/>
    <nation id="model.nation.inca" color="0xf4f0c4" nation-type="model.nationType.inca"/>
  </nations>
  <options>
    <optionGroup id="difficultyLevels" recursive="false">
      <optionGroup id="model.difficulty.veryEasy" editable="false">
        <optionGroup id="model.difficulty.immigration" editable="false"/>
      </optionGroup>
      <optionGroup id="model.difficulty.medium" editable="false"/>
      <optionGroup id="model.difficulty.custom"/>
    </optionGroup>
    <optionGroup id="model.difficulty.other"/>
  </options>
</freecol-specification>`;
const strings = `# names
model.nation.dutch.name={{tag:|country=The Netherlands|people=Dutch|default=Dutch}}
model.nation.english.name=English
model.nationType.trade.name=Trade
model.nationType.trade.shortDescription=Prices are more favorable
model.difficulty.veryEasy.name=Very Easy
model.difficulty.medium.name=Medium
`;
const data = ['data/rules/classic/specification.xml', spec, 'data/strings/FreeColMessages.properties', strings];

test('the start screen offers the selectable nations, with names and types as FreeCol shows them', () => {
  const { nations } = startOptions(data, 'classic');
  expect(nations.map((n) => n.id)).toEqual(['model.nation.dutch', 'model.nation.english']);
  expect(nations[0]).toEqual({
    id: 'model.nation.dutch',
    name: 'Dutch',
    type: 'Trade',
    description: 'Prices are more favorable',
    color: '#ff9d3c',
  });
  expect(nations[1].name).toBe('English');
});

test('it offers the difficulty levels but not Custom or the groups inside a level', () => {
  const { levels, defaultLevel } = startOptions(data, 'classic');
  expect(levels).toEqual([
    { id: 'model.difficulty.veryEasy', name: 'Very Easy' },
    { id: 'model.difficulty.medium', name: 'Medium' },
  ]);
  expect(defaultLevel).toBe('model.difficulty.medium');
});

test('a ruleset the bundle lacks offers nothing', () => {
  expect(startOptions(data, 'nethack')).toMatchObject({ nations: [], levels: [] });
});

test('the choice goes to the Engine as a preset', () => {
  expect(
    JSON.parse(presetJson({ nation: 'model.nation.french', difficulty: 'model.difficulty.hard', options: {} })),
  ).toEqual({
    nation: 'model.nation.french',
    difficulty: 'model.difficulty.hard',
  });
  expect(JSON.parse(presetJson({ nation: null, difficulty: 'model.difficulty.easy', options: {} }))).toEqual({
    difficulty: 'model.difficulty.easy',
  });
});

test('the changed options go to the Engine in the preset’s options', () => {
  expect(
    JSON.parse(
      presetJson({
        nation: null,
        difficulty: 'model.difficulty.easy',
        options: { 'model.option.landPriceFactor': 250, 'model.option.fogOfWar': false },
      }),
    ),
  ).toEqual({
    difficulty: 'model.difficulty.easy',
    options: { 'model.option.landPriceFactor': 250, 'model.option.fogOfWar': false },
  });
});

test('a group with no option to change in the specification is not offered', () => {
  const { groups } = startOptions(data, 'classic');
  expect(groups.level('model.difficulty.veryEasy')).toBeNull(); // nothing in it to change in this small specification
  expect(groups.game()).toBeNull();
});
