// FreeCol's animated signature font (FAFile.java) and the abbreviating of a name to fit the Declaration
// (DeclarationPanel.SignaturePanel): the handwriting is a list of points per letter, drawn in order.

export interface Point {
  x: number;
  y: number;
}

/** A parsed Font Animation File: the points of each letter, and of the few names it holds whole. */
export interface FAFont {
  /** The letters the font can write. */
  has(char: string): boolean;
  /** FAFile.onlyValidCharacters: the text without the letters the font lacks. */
  onlyValid(text: string): string;
  /** FAFile.getDimension: the size of the text as written. The text is not empty and only has valid letters. */
  dimension(text: string): { width: number; height: number };
  /** FAFile.getPoints: the points of the text in the order they are drawn. */
  points(text: string): Point[];
}

interface Letter {
  advance: number;
  points: Point[];
}

interface Name {
  width: number;
  height: number;
  points: Point[];
}

/** The numbers a FAF line holds, split at white space. */
const numbers = (line: string | undefined): number[] =>
  (line ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '')
    .map(Number);

const pointsOf = (xs: number[], ys: number[], n: number): Point[] =>
  Array.from({ length: n }, (_, i) => ({ x: xs[i], y: ys[i] }));

/** FAFile.load: a header line, the maximum height, the whole names, then [Chars] and the letters. */
export function parseFAF(text: string): FAFont {
  const lines = text.replace(/\r/g, '').split('\n');
  if (!lines[0]?.startsWith('FontAnimationFile')) throw new Error('Not a FAF');
  const maxHeight = numbers(lines[1])[0];
  if (!Number.isFinite(maxHeight)) throw new Error('Max height expected');
  const names = new Map<string, Name>();
  const letters = new Map<string, Letter>();
  let i = 2;
  while (i < lines.length && !lines[i].startsWith('[Chars]')) {
    const [width, height, n] = numbers(lines[i + 1]);
    names.set(lines[i], { width, height, points: pointsOf(numbers(lines[i + 2]), numbers(lines[i + 3]), n) });
    i += 4;
  }
  i++;
  // The first character of a letter's line is the letter, which may be a space.
  while (i < lines.length && lines[i] !== '') {
    const [advance, n] = numbers(lines[i].slice(1));
    letters.set(lines[i][0], { advance, points: pointsOf(numbers(lines[i + 1]), numbers(lines[i + 2]), n) });
    i += 3;
  }
  const letter = (c: string) => letters.get(c)!;
  return {
    has: (c) => letters.has(c),
    onlyValid: (t) =>
      t
        .split('')
        .filter((c) => letters.has(c))
        .join(''),
    dimension: (t) => {
      const whole = names.get(t);
      if (whole) return { width: whole.width, height: whole.height };
      const chars = t.split('');
      let width = chars.reduce((sum, c) => sum + letter(c).advance, 0);
      width += Math.min(...letter(chars[0]).points.map((p) => p.x));
      width += Math.max(0, ...letter(chars[chars.length - 1]).points.map((p) => p.x));
      return { width, height: maxHeight };
    },
    points: (t) => {
      const whole = names.get(t);
      if (whole) return whole.points;
      const out: Point[] = [];
      let x = 0;
      for (const c of t.split('')) {
        const l = letter(c);
        for (const p of l.points) out.push({ x: p.x + x, y: p.y });
        x += l.advance;
      }
      return out;
    },
  };
}

/**
 * DeclarationPanel.SignaturePanel.getAbbreviatedName: the name made small enough to fit `limit` pixels
 * across, by shortening the middle names to their initials, dropping them, then shortening the first or
 * the last name.
 */
export function abbreviate(font: FAFont, name: string, limit: number): string {
  const tooLarge = (s: string) => font.dimension(s).width > limit;
  if (!tooLarge(name)) return name;
  let parts = name.split(' ').filter((p) => p !== '');
  for (let i = 1; i < parts.length - 1 && tooLarge(parts.join(' ')); i++) parts[i] = `${parts[i][0]}.`;
  while (parts.length > 2 && tooLarge(parts.join(' '))) parts = [parts[0], ...parts.slice(2)];
  // A name of one word is as short as it goes.
  if (parts.length < 2) return parts.join(' ');
  const [first, second] = parts;
  let s = parts.join(' ');
  if (!tooLarge(s)) return s;
  s = `${first[0]}. ${second}`;
  if (!tooLarge(s)) return s;
  s = `${first} ${second[0]}.`;
  if (!tooLarge(s)) return s;
  return `${first[0]}. ${second[0]}.`;
}

/** The name as the signature writes it: its valid letters only, abbreviated to fit; empty when nothing is left. */
export function signatureName(font: FAFont, name: string, limit: number): string {
  const valid = font.onlyValid(name);
  return valid === '' ? '' : abbreviate(font, valid, limit);
}
