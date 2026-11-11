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
  <goods-types><goods-type id="model.goods.grain"/></goods-types>
  <european-nation-types>
    <european-nation-type id="model.nationType.default">
      <unit id="pioneer" type="model.unit.freeColonist" role="model.role.pioneer"/>
      <unit id="soldier" type="model.unit.freeColonist" role="model.role.soldier"/>
      <unit id="soldier" type="model.unit.veteranSoldier" role="model.role.soldier" expert-starting-units="true"/>
      <unit id="ship" type="model.unit.caravel"/>
      <settlement id="model.settlement.colony"><modifier id="model.modifier.defence" type="percentage" value="50"/></settlement>
    </european-nation-type>
    <european-nation-type id="model.nationType.trade" extends="model.nationType.default">
      <unit id="ship" type="model.unit.merchantman"/>
      <modifier id="model.modifier.tradeBonus" type="percentage" value="-50"/>
    </european-nation-type>
    <european-nation-type id="model.nationType.naval" extends="model.nationType.default">
      <modifier id="model.modifier.movementBonus" type="additive" value="3"><scope ability-id="model.ability.navalUnit"/></modifier>
    </european-nation-type>
    <european-nation-type id="model.nationType.agriculture" extends="model.nationType.default">
      <unit id="pioneer" type="model.unit.expertFarmer" role="model.role.pioneer"/>
      <modifier id="model.goods.grain" type="additive" value="2"><scope ability-id="model.ability.person"/></modifier>
    </european-nation-type>
  </european-nation-types>
</freecol-specification>`;
const strings = `# names
model.nation.dutch.name={{tag:|country=The Netherlands|people=Dutch|default=Dutch}}
model.nation.english.name=English
model.nationType.trade.name=Trade
model.nationType.trade.shortDescription=Prices are more favorable
model.difficulty.veryEasy.name=Very Easy
model.difficulty.medium.name=Medium
model.modifier.tradeBonus.name=Trade Bonus
model.modifier.movementBonus.name=Movement Bonus
model.ability.navalUnit.name=Naval unit
model.goods.grain.name={{plural:%amount%|one=Grain|other=Grain|default=Grain}}
model.unit.freeColonist.name={{plural:%number%|one=Free Colonist|other=Free Colonists|default=Free Colonist}}
model.unit.veteranSoldier.name=Veteran Soldier
model.unit.caravel.name=Caravel
model.unit.merchantman.name=Merchantman
model.unit.expertFarmer.name=Expert Farmer
model.role.pioneer.name=Pioneer
model.role.soldier.name=Soldier
`;
const data = ['data/rules/classic/specification.xml', spec, 'data/strings/FreeColMessages.properties', strings];

test('the start screen offers the selectable nations, with names and types as FreeCol shows them', () => {
  const { nations } = startOptions(data, 'classic');
  expect(nations.map((n) => n.id)).toEqual(['model.nation.dutch', 'model.nation.english']);
  expect(nations[0]).toEqual({
    id: 'model.nation.dutch',
    name: 'Dutch',
    typeId: 'model.nationType.trade',
    type: 'Trade',
    description: 'Prices are more favorable',
    color: '#ff9d3c',
  });
  expect(nations[1].name).toBe('English');
});

test('a nation type gives its own modifiers and starting units, over the ones it extends', () => {
  const { bonus } = startOptions(data, 'classic');
  expect(bonus('model.nationType.trade', false)).toEqual({
    modifiers: ['Trade Bonus: -50%'],
    units: ['Free Colonist (Pioneer)', 'Free Colonist (Soldier)', 'Merchantman'],
  });
  // The settlement's defence is the colony's, not the nation's.
  expect(bonus('model.nationType.default', false).modifiers).toEqual([]);
  expect(bonus('model.nationType.naval', false).modifiers).toEqual(['Movement Bonus (Naval unit): +3']);
  // A goods type's bonus by the goods' name alone, as the Colopedia's goods button shows it.
  expect(bonus('model.nationType.agriculture', false)).toEqual({
    modifiers: ['Grain: +2'],
    units: ['Expert Farmer (Pioneer)', 'Free Colonist (Soldier)', 'Caravel'],
  });
});

test('at a difficulty with expert starting units, the expert ones replace the others', () => {
  expect(startOptions(data, 'classic').bonus('model.nationType.trade', true).units).toEqual([
    'Free Colonist (Pioneer)',
    'Veteran Soldier (Soldier)',
    'Merchantman',
  ]);
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
  expect(groups.mapGenerator()).toBeNull();
});

test('the nations, advantages and colours the player chose go to the Engine', () => {
  expect(
    JSON.parse(
      presetJson({
        nation: 'model.nation.dutch',
        difficulty: 'model.difficulty.medium',
        options: {},
        advantages: 'SELECTABLE',
        nationType: 'model.nationType.conquest',
        colors: { 'model.nation.dutch': '#336699' },
        unavailable: ['model.nation.inca'],
      }),
    ),
  ).toEqual({
    nation: 'model.nation.dutch',
    difficulty: 'model.difficulty.medium',
    nationType: 'model.nationType.conquest',
    colors: { 'model.nation.dutch': '0x336699' },
    unavailable: ['model.nation.inca'],
  });
  expect(
    JSON.parse(presetJson({ nation: null, difficulty: 'model.difficulty.medium', options: {}, advantages: 'NONE' })),
  ).toEqual({ difficulty: 'model.difficulty.medium', advantages: 'NONE' });
});
