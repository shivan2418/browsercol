// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  FREECOL_MAP_SIZES,
  LEFT_OUT,
  MAPS,
  explainModifier,
  freecolMapName,
  presetJson,
  sized,
  startOptions,
} from './start';

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
    <european-nation-type id="model.nationType.bombard" extends="model.nationType.default">
      <modifier id="model.modifier.bombardBonus" type="percentage" value="50"/>
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
model.modifier.bombardBonus.name=Bombard Bonus
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
    modifiers: ['Your buying and selling in Europe moves prices there 50% less.'],
    units: ['Free Colonist (Pioneer)', 'Free Colonist (Soldier)', 'Merchantman'],
  });
  // The settlement's defence is the colony's, not the nation's.
  expect(bonus('model.nationType.default', false).modifiers).toEqual([]);
  expect(bonus('model.nationType.naval', false).modifiers).toEqual(['Your ships move 1 more tile a turn.']);
  // One it cannot put in words shows as the Colopedia shows it.
  expect(bonus('model.nationType.bombard', false).modifiers).toEqual(['Bombard Bonus: +50%']);
  // A goods type's bonus by the goods' name alone, as the Colopedia's goods button shows it.
  expect(bonus('model.nationType.agriculture', false)).toEqual({
    modifiers: ['Each colonist making Grain makes 2 more.'],
    units: ['Expert Farmer (Pioneer)', 'Free Colonist (Soldier)', 'Caravel'],
  });
});

test('each of the Classic nation types’ modifiers reads as what it does', () => {
  const say = (id: string, value: number, type: string, scopes: string[] = [], goods: string | null = null) =>
    explainModifier(id, value, type, scopes, goods);
  expect(say('model.modifier.tradeBonus', -50, 'percentage')).toBe(
    'Your buying and selling in Europe moves prices there 50% less.',
  );
  expect(say('model.modifier.religiousUnrestBonus', -33, 'percentage')).toBe(
    'Each new colonist from Europe takes 33% fewer crosses.',
  );
  expect(say('model.modifier.nativeAlarmModifier', -50, 'percentage')).toBe(
    'Natives grow alarmed at you 50% more slowly.',
  );
  expect(say('model.modifier.nativeConvertBonus', 200, 'percentage')).toBe(
    'Winning an attack on a native settlement that has your missionary is 200% more likely to win you a convert.',
  );
  expect(say('model.modifier.offenceAgainst', 50, 'percentage', ['scope.method.isIndian'])).toBe(
    'Your units attack natives with 50% more strength.',
  );
  expect(say('model.modifier.movementBonus', 3, 'additive', ['model.ability.navalUnit'])).toBe(
    'Your ships move 1 more tile a turn.',
  );
  expect(say('model.modifier.movementBonus', 2, 'additive', ['model.ability.navalUnit'])).toBe(
    'Your ships have 2 more movement points a turn.',
  );
  expect(say('model.goods.hammers', 2, 'additive', ['model.ability.person'], 'Hammers')).toBe(
    'Each colonist making Hammers makes 2 more.',
  );
  // A scope or a kind of value the sentence does not cover is left to the Colopedia's form.
  expect(say('model.modifier.offenceAgainst', 50, 'percentage', ['model.unit.artillery'])).toBeNull();
  expect(say('model.modifier.tradeBonus', 2, 'multiplicative')).toBeNull();
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

/** A file of a zip archive, by name, found through the archive's central directory. */
function unzipEntry(zip: Buffer, name: string): string {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${name} not found`);
}

test("the start screen lists every map FreeCol comes with, with its size from the map's file", () => {
  const dir = '../freecol/data/maps';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.fsm') && f !== LEFT_OUT);
  expect(Object.keys(FREECOL_MAP_SIZES).sort()).toEqual(files.sort());
  for (const f of files) {
    const props = unzipEntry(fs.readFileSync(`${dir}/${f}`), 'savegame.properties');
    const w = Number(/map\.width=(\d+)/.exec(props)?.[1]);
    const h = Number(/map\.height=(\d+)/.exec(props)?.[1]);
    expect([f, w, h]).toEqual([f, ...FREECOL_MAP_SIZES[f]!]);
    expect(MAPS.find((m) => m.id === f)?.name).toBe(sized(freecolMapName(f), [w, h]));
  }
  expect(MAPS[0]!.name).toBe('America (1492), 29×143');
});

test("a FreeCol map's name is its file name's place and author", () => {
  expect(freecolMapName('M_NorthAmerica2_Mazim.fsm')).toBe('North America 2 (Mazim)');
  expect(freecolMapName('L_America_JsTheDude.fsm')).toBe('America (JsTheDude)');
  expect(freecolMapName('L_TheOldWorld_Mazim.fsm')).toBe('The Old World (Mazim)');
  expect(freecolMapName('XXL_HugeWorld_Mazim.fsm')).toBe('Huge World (Mazim)');
});

test('Huge World, and only it, is marked heavy in the Map list, and Giga Earth is left out', () => {
  const heavy = MAPS.filter((m) => m.name.endsWith(' (heavy)')).map((m) => m.id);
  expect(heavy).toEqual(['XXL_HugeWorld_Mazim.fsm']);
  expect(MAPS.find((m) => m.id === 'XXL_HugeWorld_Mazim.fsm')?.name).toBe('Huge World (Mazim), 180×300 (heavy)');
  expect(MAPS.some((m) => m.id === LEFT_OUT)).toBe(false);
});
