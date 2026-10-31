// What the browser scripts (smoke, play, saves, tileset, debug, rounds) share:
// Playwright, the option parser and the page helpers.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Playwright logs the browser process's stderr, exit code and signal under
// DEBUG=pw:browser. It reads the variable as it loads, and the lines are kept
// (see launchBrowser) rather than printed.
process.env.DEBUG = [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(',');

/** Playwright, a global install found via NODE_PATH. */
export const playwright = require('playwright');

/** The value of --name on the command line, or dflt. */
export const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};

/** The browsers to run, from --browsers. */
export const browserNames = (dflt = 'chromium,firefox') => opt('browsers', dflt).split(',');

/** What happened to the browsers and pages this run: crashes, closes and disconnects, with the time. */
const gone = [];
/** The tail of each browser process's own log (its stderr, its exit code and signal). */
const browserLog = [];
const started = Date.now();
const note = (what) => gone.push(`${((Date.now() - started) / 1000).toFixed(1)} s: ${what}`);
/** Browsers the script is closing itself: their pages and connection going away is no news. */
const closing = new WeakSet();

// The debug lines go to the log, not to stderr, unless the caller asked to see them.
const showDebug = !!process.env.FC_SHOW_PW_DEBUG;
const writeStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const text = String(chunk);
  if (!text.includes('pw:browser')) return writeStderr(chunk, ...rest);
  for (const line of text.split('\n')) if (line) browserLog.push(line.replace(/^.*?pw:browser\s*/, ''));
  while (browserLog.length > 60) browserLog.shift();
  return showDebug ? writeStderr(chunk, ...rest) : true;
};

/**
 * Launches a browser that remembers how it dies (#31, #40): Playwright's log
 * of the browser process is kept, and the browser's disconnect noted, for
 * diagnose(). Without this a closed browser shows only "Target page, context
 * or browser has been closed".
 */
export async function launchBrowser(name) {
  gone.length = 0;
  browserLog.length = 0;
  const browser = await playwright[name].launch();
  browser.on('disconnected', () => closing.has(browser) || note(`${name} browser disconnected`));
  const close = browser.close.bind(browser);
  browser.close = (...args) => (closing.add(browser), close(...args));
  return browser;
}

/** Collects the page's uncaught errors, as strings, into the returned array. */
export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => note('page crashed'));
  page.on('close', () => closing.has(page.context().browser()) || note('page closed'));
  return errors;
}

/** Browser log lines worth showing: the process's own stderr and exit, and anything that says it crashed. */
const telling = (line) => /\[err\]|did exit|crash|abort|assert|fatal|memory|signal/i.test(line);

/**
 * A failure as text. When the browser or page went away, what is known of
 * why: the page and browser events, and the browser process's last telling
 * log lines (its exit code and signal arrive a moment after the close).
 */
export async function diagnose(ex) {
  const text = String(ex);
  if (!/closed|crash|disconnected/i.test(text)) return text;
  await new Promise((done) => setTimeout(done, 1000));
  const lines = browserLog.filter(telling).slice(-15);
  return [text, ...gone.map((g) => `  ${g}`), ...lines.map((l) => `  | ${l}`)].join('\n');
}

/** Waits for the page's window.fcResult and returns it. */
export async function waitForResult(page, timeout) {
  await page.waitForFunction(() => window.fcResult, null, { timeout });
  return page.evaluate(() => window.fcResult);
}
