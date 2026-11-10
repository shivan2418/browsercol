import { randomInt } from 'node:crypto';

/**
 * The letters of a report's reference, `R-XXXXX`: digits and capitals without
 * the look-alikes 0/O and 1/I/L, so a tester can read one out or type it back.
 * The game's Send feedback dialog (#369) uses the same alphabet for the
 * references it makes itself.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_PATTERN = new RegExp(`^R-[${REFERENCE_ALPHABET}]{5}$`);

/** A new random reference; `pick(n)` gives an integer from 0 to n - 1. */
export function newReference(pick: (n: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)];
  return `R-${code}`;
}
