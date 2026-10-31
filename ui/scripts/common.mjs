// What the browser scripts (smoke, play, saves, tileset, debug, rounds) share:
// Playwright, the option parser and the page helpers.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** Playwright, a global install found via NODE_PATH. */
export const playwright = require('playwright');

/** The value of --name on the command line, or dflt. */
export const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};

/** The browsers to run, from --browsers. */
export const browserNames = (dflt = 'chromium,firefox') => opt('browsers', dflt).split(',');

/** Collects the page's uncaught errors, as strings, into the returned array. */
export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Waits for the page's window.fcResult and returns it. */
export async function waitForResult(page, timeout) {
  await page.waitForFunction(() => window.fcResult, null, { timeout });
  return page.evaluate(() => window.fcResult);
}
