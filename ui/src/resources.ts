// Resource keys to art, resolved as FreeCol's ResourceManager does: each
// layer (data/base, the "default" TC, then each mod) is a resources.properties
// whose image paths are relative to the layer's directory, and later layers
// override earlier ones key by key. "resource:<key>" aliases another key of
// the same layer. An image named foo0.png has variations foo<1-2 digits>.png
// next to it (FreeColDataFile.findFilesWithVariationOrAlternativeSize), so
// the resolver needs the list of art files. Images, quoted strings
// (StringResource, e.g. chip texts) and urn:color: values (ColorResource)
// are kept.

/** One resources.properties and the directory its paths are relative to. */
export interface ArtLayer {
  dir: string;
  props: string;
}

/** An image key's file, then its variations in FreeCol's order. */
interface Image {
  file: string;
  variations: string[];
}

export interface Resources {
  has(key: string): boolean;
  /** FreeCol's getNumberOfVariations: the variations plus the named file. */
  variations(key: string): number;
  /**
   * The file for a key: the named file, or for a variation number the file
   * ImageResource.getVariation picks: variation n < count-1 is the n-th
   * sibling, anything else the named file. Null if the key has no image.
   */
  path(key: string, variation?: number): string | null;
  /** The variation FreeCol shows for a seed, e.g. variationSeedUsing(x, y). */
  forSeed(key: string, seed: number): string | null;
  /** A string resource, or "X" as ResourceManager.getString gives for a missing one. */
  string(key: string): string;
  /** A colour resource as 0xRRGGBB, or magenta as ResourceManager.getColor gives for a missing one. */
  color(key: string): number;
}

const IMAGE = /\.(png|jpe?g|gif)$/i;
const ALIAS = 'resource:';
/** StringResource.REPLACEMENT_STRING. */
const NO_STRING = 'X';
const COLOR = 'urn:color:';
/** ColorResource.REPLACEMENT_COLOR. */
const NO_COLOR = 0xff00ff;
/** The colour constants of java.awt.Color, which ColorResource looks up by field name. */
const JAVA_COLORS: Record<string, number> = {
  white: 0xffffff,
  WHITE: 0xffffff,
  lightGray: 0xc0c0c0,
  LIGHT_GRAY: 0xc0c0c0,
  gray: 0x808080,
  GRAY: 0x808080,
  darkGray: 0x404040,
  DARK_GRAY: 0x404040,
  black: 0x000000,
  BLACK: 0x000000,
  red: 0xff0000,
  RED: 0xff0000,
  pink: 0xffafaf,
  PINK: 0xffafaf,
  orange: 0xffc800,
  ORANGE: 0xffc800,
  yellow: 0xffff00,
  YELLOW: 0xffff00,
  green: 0x00ff00,
  GREEN: 0x00ff00,
  magenta: 0xff00ff,
  MAGENTA: 0xff00ff,
  cyan: 0x00ffff,
  CYAN: 0x00ffff,
  blue: 0x0000ff,
  BLUE: 0x0000ff,
};

/** ColorResource.createColor: 0x hex (an alpha byte is dropped) or a java.awt.Color field. */
const colorValue = (name: string) =>
  /^0[xX][0-9a-fA-F]+$/.test(name)
    ? parseInt(name.slice(2), 16) & 0xffffff
    : Object.hasOwn(JAVA_COLORS, name)
      ? JAVA_COLORS[name]
      : NO_COLOR;

/** A string resource's text: what follows the last quote but one, with Java's escapes undone. */
const stringValue = (value: string) =>
  value
    .slice(value.lastIndexOf('"', value.length - 2) + 1, -1)
    .replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex: string | undefined, c: string) =>
      hex ? String.fromCharCode(parseInt(hex, 16)) : c,
    );

/** Key/value pairs of a Java .properties text (comments, continuations, ':' or '='). */
export function parseProperties(text: string): [string, string][] {
  const out: [string, string][] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimStart();
    if (line === '' || line[0] === '#' || line[0] === '!') continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].trimStart();
    }
    const m = /^((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*(.*)$/.exec(line);
    if (m) out.push([m[1].replace(/\\(.)/g, '$1'), m[2].trim()]);
    else out.push([line.replace(/\\(.)/g, '$1'), '']);
  }
  return out;
}

export function resources(layers: ArtLayer[], files: string[]): Resources {
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = f.slice(0, f.lastIndexOf('/') + 1);
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  for (const list of byDir.values()) list.sort();

  const variationsOf = (file: string): string[] => {
    const dir = file.slice(0, file.lastIndexOf('/') + 1);
    const name = file.slice(dir.length);
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return [];
    const prefix = name.slice(0, dot).replace(/[0-9]*$/, '');
    const suffix = name.slice(dot);
    return (byDir.get(dir) ?? []).filter((f) => {
      const n = f.slice(dir.length);
      if (f === file || !n.startsWith(prefix) || !n.endsWith(suffix)) return false;
      return /^[0-9][0-9]?$/.test(n.slice(prefix.length, n.length - suffix.length));
    });
  };

  const merged = new Map<string, Image>();
  const strings = new Map<string, string>();
  const colors = new Map<string, number>();
  for (const { dir, props } of layers) {
    const layer = new Map<string, Image>();
    const layerColors = new Map<string, number>();
    const aliases: [string, string][] = [];
    for (const [key, value] of parseProperties(props)) {
      if (value.startsWith(ALIAS)) {
        aliases.push([key.replace(/\.r0$/, ''), value.slice(ALIAS.length)]);
      } else if (IMAGE.test(value)) {
        const file = `${dir}/${value}`;
        // Rivers need new keys in order to support variations (FreeColDataFile).
        layer.set(key, { file, variations: key.includes('.improvement.river.') ? [] : variationsOf(file) });
      } else if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
        strings.set(key, stringValue(value));
      } else if (value.startsWith(COLOR)) {
        layerColors.set(key, colorValue(value.slice(COLOR.length)));
      }
    }
    // Aliases may chain, so resolve until no more progress.
    for (let progress = true; progress && aliases.length > 0;) {
      progress = false;
      for (let i = aliases.length - 1; i >= 0; i--) {
        const [key, to] = aliases[i];
        const image = layer.get(to);
        const color = layerColors.get(to);
        if (image) layer.set(key, image);
        else if (color !== undefined) layerColors.set(key, color);
        else continue;
        aliases.splice(i, 1);
        progress = true;
      }
    }
    for (const [key, image] of layer) merged.set(key, image);
    for (const [key, color] of layerColors) colors.set(key, color);
  }

  const path = (key: string, variation?: number) => {
    const image = merged.get(key);
    if (!image) return null;
    return variation !== undefined && variation < image.variations.length ? image.variations[variation] : image.file;
  };
  const count = (key: string) => (merged.get(key)?.variations.length ?? 0) + 1;
  return {
    has: (key) => merged.has(key),
    variations: count,
    path,
    forSeed: (key, seed) => path(key, javaRandomInt(seed, count(key))),
    string: (key) => strings.get(key) ?? NO_STRING,
    color: (key) => colors.get(key) ?? NO_COLOR,
  };
}

const MULTIPLIER = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;

/** new java.util.Random(seed).nextInt(bound), for a fresh generator. */
export function javaRandomInt(seed: number, bound: number): number {
  let state = (BigInt(seed) ^ MULTIPLIER) & MASK;
  const next31 = () => {
    state = (state * MULTIPLIER + 0xbn) & MASK;
    return Number(state >> 17n);
  };
  if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(next31())) >> 31n);
  for (;;) {
    const bits = next31();
    const val = bits % bound;
    if (bits - val + (bound - 1) < 2 ** 31) return val;
  }
}
