import { describe, expect, it } from 'vite-plus/test';
import { javaRandomInt, JAVA_COLORS, resources } from './resources';

// Layers as FreeCol loads them: data/base, then the "default" TC, then mods.
const base = {
  dir: 'base',
  props: `
## Masks
image.mask=resources/images/masks/mask-center.png
color.map.road=urn:color:0x804000
`,
};
const tc = {
  dir: 'default',
  props: `
# Terrain
image.tile.model.tile.ocean.center=resources/images/terrain/ocean/center0.png
image.tile.model.tile.lake.center=resource:image.tile.model.tile.ocean.center
image.tile.model.tile.plains.center = resources/images/terrain/plains/center0.png
image.tile.model.improvement.river.s0100=resources/images/river/river3.png
image.tile.model.tile.marsh.center.r0=resource:image.tile.model.tile.plains.center
`,
};
const files = [
  'base/resources/images/masks/mask-center.png',
  'default/resources/images/terrain/ocean/center0.png',
  'default/resources/images/terrain/ocean/center0.size9.png',
  'default/resources/images/terrain/ocean/center03.png',
  'default/resources/images/terrain/ocean/center02.png',
  'default/resources/images/terrain/plains/center0.png',
  'default/resources/images/river/river3.png',
  'default/resources/images/river/river31.png',
  'mods/flat/resources/plains.png',
];

describe('resources', () => {
  it('finds a key in its layer, and later layers win', () => {
    const r = resources([base, tc], files);
    expect(r.path('image.mask')).toBe('base/resources/images/masks/mask-center.png');
    expect(r.path('image.tile.model.tile.plains.center')).toBe('default/resources/images/terrain/plains/center0.png');
    expect(r.path('image.tile.model.tile.tundra.center')).toBeNull();
    expect(r.has('color.map.road')).toBe(false);

    const mod = { dir: 'mods/flat', props: 'image.tile.model.tile.plains.center=resources/plains.png' };
    expect(resources([base, tc, mod], files).path('image.tile.model.tile.plains.center')).toBe(
      'mods/flat/resources/plains.png',
    );
  });

  it('follows resource: aliases, dropping an old .r0 suffix', () => {
    const r = resources([base, tc], files);
    expect(r.path('image.tile.model.tile.lake.center')).toBe('default/resources/images/terrain/ocean/center0.png');
    expect(r.path('image.tile.model.tile.marsh.center')).toBe('default/resources/images/terrain/plains/center0.png');
  });

  it('numbers variations as FreeCol does: the sorted siblings first, the named file last', () => {
    const r = resources([base, tc], files);
    const ocean = 'image.tile.model.tile.ocean.center';
    expect(r.variations(ocean)).toBe(3);
    expect(r.path(ocean, 0)).toBe('default/resources/images/terrain/ocean/center02.png');
    expect(r.path(ocean, 1)).toBe('default/resources/images/terrain/ocean/center03.png');
    expect(r.path(ocean, 2)).toBe('default/resources/images/terrain/ocean/center0.png');
    // River styles never have variations.
    expect(r.variations('image.tile.model.improvement.river.s0100')).toBe(1);
  });

  it('picks the variation for a seed with java.util.Random', () => {
    const r = resources([base, tc], files);
    // new Random(60118).nextInt(3) == 1 on the JVM.
    expect(r.forSeed('image.tile.model.tile.ocean.center', 60118)).toBe(
      'default/resources/images/terrain/ocean/center03.png',
    );
  });

  it('reads string resources as StringResource does, with Java escapes, and X when missing', () => {
    const strings = { dir: 'default', props: 'indianSettlementChip.capital="*"\ncross="\\u271d"\n' };
    const mod = { dir: 'mods/m', props: 'indianSettlementChip.capital="C"\n' };
    const r = resources([base, strings, mod], files);
    expect(r.string('indianSettlementChip.capital')).toBe('C');
    expect(r.string('cross')).toBe('\u271d');
    expect(r.string('indianAlarmChip.scouted')).toBe('X');
    expect(r.has('cross')).toBe(false);
  });

  it('reads colours as ColorResource does: 0x hex or a java.awt.Color name, magenta when missing', () => {
    const colors = {
      dir: 'default',
      props: `
color.map.productionBonus.2=urn:color:blue
color.map.productionBonus.-1=urn:color:orange
color.map.productionBonus.0=urn:color:LIGHT_GRAY
color.map.productionBonus.1=urn:color:0X00aa00
color.map.productionBonus.-2=urn:color:0x80ff0000
color.map.bad=urn:color:chartreuse
color.map.alias=resource:color.map.productionBonus.2
`,
    };
    const mod = { dir: 'mods/m', props: 'color.map.road=urn:color:0x00ffff\n' };
    const r = resources([base, colors], files);
    expect(r.color('color.map.road')).toBe(0x804000);
    expect(r.color('color.map.productionBonus.2')).toBe(0x0000ff);
    expect(r.color('color.map.alias')).toBe(0x0000ff);
    expect(r.color('color.map.productionBonus.-1')).toBe(0xffc800);
    expect(r.color('color.map.productionBonus.0')).toBe(0xc0c0c0);
    expect(r.color('color.map.productionBonus.1')).toBe(0x00aa00);
    // An alpha byte is dropped: the map draws its colours opaque.
    expect(r.color('color.map.productionBonus.-2')).toBe(0xff0000);
    expect(r.color('color.map.bad')).toBe(0xff00ff);
    expect(r.color('color.map.missing')).toBe(0xff00ff);
    expect(r.has('color.map.road')).toBe(false);
    expect(resources([base, colors, mod], files).color('color.map.road')).toBe(0x00ffff);
  });

  it('gives the replacement for a missing colour, as ImageLibrary.getColor(key, replacement) does', () => {
    const r = resources([base, tc], files);
    expect(r.color('color.foreground.mission.normal', 0x808080)).toBe(0x808080);
    expect(r.color('color.map.road', 0x808080)).toBe(0x804000);
  });
});

describe('java.awt.Color', () => {
  // The colour constants of the class: the name of its field, the
  // upper-case name it also has, and the colour's rgb.
  const fields: [string, string, number][] = [
    ['white', 'WHITE', 0xffffff],
    ['lightGray', 'LIGHT_GRAY', 0xc0c0c0],
    ['gray', 'GRAY', 0x808080],
    ['darkGray', 'DARK_GRAY', 0x404040],
    ['black', 'BLACK', 0x000000],
    ['red', 'RED', 0xff0000],
    ['pink', 'PINK', 0xffafaf],
    ['orange', 'ORANGE', 0xffc800],
    ['yellow', 'YELLOW', 0xffff00],
    ['green', 'GREEN', 0x00ff00],
    ['magenta', 'MAGENTA', 0xff00ff],
    ['cyan', 'CYAN', 0x00ffff],
    ['blue', 'BLUE', 0x0000ff],
  ];

  it('knows every colour of the class, by both of the names of its field', () => {
    expect(Object.keys(JAVA_COLORS).sort()).toEqual(fields.flatMap(([name, upper]) => [name, upper]).sort());
    for (const [name, upper, value] of fields) {
      expect(JAVA_COLORS[name]).toBe(value);
      expect(JAVA_COLORS[upper]).toBe(value);
    }
  });

  it('resolves a colour resource by either name of the field', () => {
    const props = fields
      .flatMap(([name, upper]) => [`color.map.${name}=urn:color:${name}`, `color.map.${upper}=urn:color:${upper}`])
      .join('\n');
    const r = resources([{ dir: 'default', props }], []);
    for (const [name, upper, value] of fields) {
      expect(r.color(`color.map.${name}`)).toBe(value);
      expect(r.color(`color.map.${upper}`)).toBe(value);
    }
  });

  it('knows no colour the class does not have', () => {
    const props = 'color.map.lightgray=urn:color:lightgray\ncolor.map.chartreuse=urn:color:chartreuse\n';
    const r = resources([{ dir: 'default', props }], []);
    expect(r.color('color.map.lightgray')).toBe(0xff00ff);
    expect(r.color('color.map.chartreuse')).toBe(0xff00ff);
  });
});

describe('javaRandomInt', () => {
  it('matches new Random(seed).nextInt(bound) on the JVM', () => {
    expect(javaRandomInt(60118, 3)).toBe(1);
    expect(javaRandomInt(0, 10)).toBe(0);
    expect(javaRandomInt(42, 7)).toBe(1);
    expect(javaRandomInt(-5, 21)).toBe(12);
    expect(javaRandomInt(7, 4)).toBe(2);
    expect(javaRandomInt(123456789, 2)).toBe(1);
  });
});
