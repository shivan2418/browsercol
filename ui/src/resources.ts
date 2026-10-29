// Resource keys to art, resolved as FreeCol's ResourceManager does: each
// layer (data/base, the "default" TC, then each mod) is a resources.properties
// whose image paths are relative to the layer's directory, and later layers
// override earlier ones key by key. "resource:<key>" aliases another key of
// the same layer. An image named foo0.png has variations foo<1-2 digits>.png
// next to it (FreeColDataFile.findFilesWithVariationOrAlternativeSize), so
// the resolver needs the list of art files. Only images are kept.

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
}

const IMAGE = /\.(png|jpe?g|gif)$/i;
const ALIAS = 'resource:';

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
  for (const { dir, props } of layers) {
    const layer = new Map<string, Image>();
    const aliases: [string, string][] = [];
    for (const [key, value] of parseProperties(props)) {
      if (value.startsWith(ALIAS)) {
        aliases.push([key.replace(/\.r0$/, ''), value.slice(ALIAS.length)]);
      } else if (IMAGE.test(value)) {
        const file = `${dir}/${value}`;
        // Rivers need new keys in order to support variations (FreeColDataFile).
        layer.set(key, { file, variations: key.includes('.improvement.river.') ? [] : variationsOf(file) });
      }
    }
    // Aliases may chain, so resolve until no more progress.
    for (let progress = true; progress && aliases.length > 0;) {
      progress = false;
      for (let i = aliases.length - 1; i >= 0; i--) {
        const target = layer.get(aliases[i][1]);
        if (!target) continue;
        layer.set(aliases[i][0], target);
        aliases.splice(i, 1);
        progress = true;
      }
    }
    for (const [key, image] of layer) merged.set(key, image);
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
