import { describe, expect, it } from 'vite-plus/test';
import { javaRandomInt, resources } from './resources';

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
