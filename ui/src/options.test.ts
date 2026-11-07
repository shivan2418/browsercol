// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import { leaves, specificationGroup } from './options';

const spec = `<freecol-specification id="classic">
  <options>
    <optionGroup id="difficultyLevels" recursive="false">
      <optionGroup id="model.difficulty.easy" editable="false">
        <optionGroup id="model.difficulty.natives" editable="false">
          <integerOption id="model.option.landPriceFactor" value="40"/>
          <percentageOption id="model.option.badRumour" value="23"/>
          <stringOption id="model.option.buildOnNativeLand" value="model.option.buildOnNativeLand.always"/>
          <rangeOption id="model.option.settlementNumber" defaultValue="8" localizedLabels="true">
            <rangeValue label="verySmall" value="10"/>
            <rangeValue label="small" value="8"/>
          </rangeOption>
          <unitListOption id="model.option.immigrants">
            <unitOption id="model.option.immigrants.1">
              <unitType value="model.unit.masterCarpenter"/>
              <role value="model.role.default"/>
              <number value="2"/>
            </unitOption>
          </unitListOption>
        </optionGroup>
        <optionGroup id="model.difficulty.empty"><unitListOption id="model.option.refSize"/></optionGroup>
      </optionGroup>
      <optionGroup id="model.difficulty.custom">
        <optionGroup id="model.difficulty.natives">
          <stringOption id="model.option.buildOnNativeLand" value="model.option.buildOnNativeLand.never">
            <choice value="model.option.buildOnNativeLand.always"/>
            <choice value="model.option.buildOnNativeLand.never"/>
          </stringOption>
        </optionGroup>
      </optionGroup>
    </optionGroup>
    <optionGroup id="gameOptions">
      <optionGroup id="gameOptions.map">
        <integerOption id="model.option.turnsToSail" defaultValue="3" minimumValue="1" maximumValue="10"/>
        <booleanOption id="model.option.fogOfWar" defaultValue="true"/>
        <percentageOption id="model.option.giftProbability" defaultValue="5"/>
        <selectOption id="model.option.startingPositions" defaultValue="0" localizedLabels="true">
          <selectValue label="model.option.startingPositions.classic" value="0"/>
          <selectValue label="model.option.startingPositions.random" value="1"/>
        </selectOption>
        <textOption id="model.option.note" defaultValue="hi"/>
        <fileOption id="model.option.importFile" type="map"/>
      </optionGroup>
    </optionGroup>
  </options>
</freecol-specification>`;
const strings = `
model.difficulty.natives.name=Natives
model.option.landPriceFactor.name=Land price factor
model.option.landPriceFactor.shortDescription=How dear land is
model.option.buildOnNativeLand.always.name=Always
model.option.buildOnNativeLand.never.name=Never
model.option.startingPositions.name=Starting Positions
model.option.startingPositions.classic.name=Classic
model.option.startingPositions.random.name=Random
verySmall=Very Small
small=Small
`;
const data = ['data/rules/classic/specification.xml', spec, 'data/strings/FreeColMessages.properties', strings];
const easy = 'optionGroup[id="difficultyLevels"] > optionGroup[id="model.difficulty.easy"]';

test('a difficulty level is a group of its options, as the specification gives them', () => {
  const level = specificationGroup(data, 'classic', easy)!;
  expect(level.children[0]).toMatchObject({ kind: 'group', id: 'model.difficulty.natives', label: 'Natives' });
  const options = leaves(level);
  expect(options.get('model.option.landPriceFactor')).toMatchObject({
    kind: 'integer',
    label: 'Land price factor',
    description: 'How dear land is',
    value: 40,
  });
  // A list of units is shown, entry by entry, even an empty one.
  expect(options.get('model.option.immigrants')).toMatchObject({
    kind: 'units',
    value: [{ type: 'model.unit.masterCarpenter', role: 'model.role.default', number: 2 }],
  });
  expect(options.get('model.option.refSize')).toMatchObject({ kind: 'units', value: [] });
  expect(level.children.map((c) => c.id)).toEqual(['model.difficulty.natives', 'model.difficulty.empty']);
});

test('an option FreeCol has no short description for gets ours, for its tooltip', () => {
  const options = leaves(specificationGroup(data, 'classic', easy)!);
  expect(options.get('model.option.badRumour')?.description).toMatch(/Lost City Rumour turns out badly/);
  expect(options.get('model.option.immigrants')).toMatchObject({ description: null });
});

test('a range option has its labelled values, and a string option the choices the custom level lists', () => {
  const options = leaves(specificationGroup(data, 'classic', easy)!);
  expect(options.get('model.option.settlementNumber')).toMatchObject({
    kind: 'select',
    value: 8,
    choices: [
      { value: 10, label: 'Very Small' },
      { value: 8, label: 'Small' },
    ],
  });
  expect(options.get('model.option.buildOnNativeLand')).toMatchObject({
    kind: 'string',
    value: 'model.option.buildOnNativeLand.always',
    choices: [
      { value: 'model.option.buildOnNativeLand.always', label: 'Always' },
      { value: 'model.option.buildOnNativeLand.never', label: 'Never' },
    ],
  });
});

test('the game options have each option type', () => {
  const options = leaves(specificationGroup(data, 'classic', 'optionGroup[id="gameOptions"]')!);
  expect(options.get('model.option.turnsToSail')).toMatchObject({ kind: 'integer', value: 3, min: 1, max: 10 });
  expect(options.get('model.option.fogOfWar')).toMatchObject({ kind: 'boolean', value: true });
  expect(options.get('model.option.giftProbability')).toMatchObject({ kind: 'percentage', value: 5, min: 0, max: 100 });
  expect(options.get('model.option.startingPositions')).toMatchObject({
    kind: 'select',
    choices: [
      { value: 0, label: 'Classic' },
      { value: 1, label: 'Random' },
    ],
  });
  expect(options.get('model.option.note')).toMatchObject({ kind: 'text', value: 'hi' });
  expect(options.get('model.option.importFile')).toMatchObject({ kind: 'file', value: '' });
});

test('a group the specification lacks is null', () => {
  expect(specificationGroup(data, 'classic', 'optionGroup[id="nothing"]')).toBeNull();
  expect(specificationGroup(data, 'nethack', 'optionGroup[id="gameOptions"]')).toBeNull();
});
