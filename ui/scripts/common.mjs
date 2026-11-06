// What the browser scripts (smoke, play, saves, tileset, debug, rounds) share:
// Playwright, the option parser and the page helpers.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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

/** Browser log lines worth showing: the process's own stderr and exit, and anything that says it crashed. */
const telling = (line) => /\[err\]|did exit|crash|abort|assert|fatal|memory|signal/i.test(line);

// The debug lines go to the log, not to stderr, unless the caller asked to see them.
const showDebug = !!process.env.FC_SHOW_PW_DEBUG;
const writeStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const other = [];
  for (const line of String(chunk).split('\n')) {
    if (!line.includes('pw:browser')) {
      other.push(line);
      continue;
    }
    const text = line.replace(/^.*?pw:browser\s*/, '');
    if (telling(text)) browserLog.push(text);
    while (browserLog.length > 60) browserLog.shift();
    if (showDebug) other.push(line);
  }
  const rest_ = other.join('\n');
  return rest_.trim() === '' ? true : writeStderr(rest_ + (String(chunk).endsWith('\n') ? '\n' : ''), ...rest);
};

/**
 * Firefox draws the map on the Canvas 2D fallback (?renderer=canvas2d): in CI
 * its content process died with SIGSEGV next to FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS
 * (#31), software GL in a container being the suspect. Chromium keeps covering
 * PixiJS. FC_FIREFOX_WEBGL=1 gives Firefox WebGL back.
 */
const canvas2d = (url) =>
  /[?&]renderer=/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'renderer=canvas2d';

/**
 * Launches a browser that remembers how it dies (#31, #40): Playwright's log
 * of the browser process is kept, and the browser's disconnect noted, for
 * diagnose(). Without this a closed browser shows only "Target page, context
 * or browser has been closed".
 */
export async function launchBrowser(name) {
  gone.length = 0;
  lastStep = '(nothing logged yet for ' + name + ')';
  browserLog.length = 0;
  const browser = await playwright[name].launch();
  browser.on('disconnected', () => closing.has(browser) || note(`${name} browser disconnected`));
  const close = browser.close.bind(browser);
  browser.close = (...args) => (closing.add(browser), close(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    watchWaits(page);
    if (name === 'firefox' && !process.env.FC_FIREFOX_WEBGL) {
      const goto = page.goto.bind(page);
      page.goto = (url, ...rest) => goto(canvas2d(url), ...rest);
    }
    return page;
  };
  return browser;
}

/** What the page logs for each error its banner shows (src/main.tsx, reportError). */
const BANNER = 'Error banner: ';

/**
 * Collects the page's uncaught errors, and the Engine's and the Worker's errors its banner showed the player,
 * as strings, into the returned array.
 */
export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const text = m.type() === 'error' ? m.text() : '';
    // The page's own uncaught errors are on the banner too, but pageerror has them already.
    if (text.startsWith(BANNER) && !text.startsWith(`${BANNER}The page hit an error`)) {
      errors.push(text.slice(BANNER.length));
    }
  });
  page.on('crash', () => note('page crashed'));
  page.on('close', () => closing.has(page.context().browser()) || note('page closed'));
  return errors;
}

/**
 * A failure as text. When the browser or page went away, what is known of
 * why: the page and browser events, and the browser process's last telling
 * log lines (its exit code and signal arrive a moment after the close).
 */
export async function diagnose(ex) {
  const text = String(ex);
  if (!/closed|crash|disconnected/i.test(text)) return text;
  await new Promise((done) => setTimeout(done, 1000));
  const lines = browserLog.slice(-15);
  return [text, ...gone.map((g) => `  ${g}`), ...lines.map((l) => `  | ${l}`)].join('\n');
}

/** Waits for the page's window.fcResult and returns it. */
export async function waitForResult(page, timeout) {
  await page.waitForFunction(() => window.fcResult, null, { timeout });
  return page.evaluate(() => window.fcResult);
}

// --- Timeouts that say what they were waiting for ---

/** The last line a script logged: the step a timed-out wait was in. */
let lastStep = '(nothing logged yet)';
const log = console.log.bind(console);
console.log = (...args) => {
  const line = args.map(String).join(' ').trim();
  if (line) lastStep = line.split('\n')[0];
  return log(...args);
};
/** Names the step the script is in, for waits that follow a step it does not log. */
export const setStep = (text) => {
  lastStep = text;
};

const squash = (text, max) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '...' : t;
};
/** Gives a promise a few seconds: a hung page must not hang the diagnosis. */
const within = (promise, ms = 5000) =>
  Promise.race([promise.catch(() => undefined), new Promise((done) => setTimeout(done, ms, undefined))]);

/** Where a timeout's screenshots go: .cache/*.png is what the CI workflow uploads. */
const shotDir = path.resolve(import.meta.dirname, '../../.cache');
const script = path.basename(process.argv[1] ?? 'script', '.mjs');
const consoleTails = new WeakMap();
let shots = 0;

/**
 * What a timed-out wait leaves: its step and condition in the error message,
 * with the page's last console lines and visible dialogs, and a screenshot in
 * .cache/ named in the message. Only the first eight timeouts of a run are shot.
 */
async function describeTimeout(page, kind, what, label, ex) {
  const browserName = page.context().browser()?.browserType().name() ?? 'browser';
  const lines = [
    `${ex.message.split('\n')[0]}`,
    `  script: ${script} (${browserName})`,
    `  step: ${lastStep}`,
    `  waiting for${label ? ` "${label}"` : ''}: ${what}`,
    `  kind: ${kind}`,
  ];
  const dialogs = await within(
    page.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].map(
        (d) =>
          `${d.getAttribute('data-kind') ?? ''}: ${(d.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}`,
      ),
    ),
    3000,
  );
  lines.push(
    `  visible dialogs: ${dialogs?.length ? dialogs.join(' | ') : dialogs ? 'none' : '(page did not answer)'}`,
  );
  const tail = consoleTails.get(page) ?? [];
  if (tail.length) lines.push('  console, last lines:', ...tail.map((l) => `    ${l}`));
  // One file for each label, so a wait the script catches and goes on from cannot overwrite the one that failed it.
  const slug = (label || what)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  if (shots < 8) {
    shots++;
    const file = path.join(shotDir, `timeout-${script}-${browserName}-${slug || shots}.png`);
    fs.mkdirSync(shotDir, { recursive: true });
    const done = await within(
      page.screenshot({ path: file }).then(() => true),
      10000,
    );
    lines.push(done ? `  screenshot: ${file}` : '  screenshot: failed or timed out');
  }
  ex.message = lines.join('\n');
  return ex;
}

/** Runs a wait; a timeout is rethrown with what it waited for (see describeTimeout). */
async function watched(page, kind, what, label, run) {
  try {
    return await run();
  } catch (ex) {
    if (ex?.name !== 'TimeoutError') throw ex;
    throw await describeTimeout(page, kind, what, label, ex);
  }
}

/** Takes a label out of an options bag: { label } names what the wait is for, Playwright never sees it. */
const unlabel = (options) => {
  if (!options || typeof options !== 'object' || !('label' in options)) return [options, undefined];
  const { label, ...rest } = options;
  return [rest, label];
};

const patched = new WeakSet();
/**
 * Makes every waitForFunction, waitForSelector, waitForEvent, locator waitFor and locator action (click, fill, ...) of the page
 * (and of its locators) fail with the step and condition on a timeout (#233).
 * Each takes an optional `label` in its options bag naming the condition.
 */
function watchWaits(page) {
  const tail = [];
  consoleTails.set(page, tail);
  page.on('console', (m) => {
    tail.push(`${m.type()}: ${squash(m.text(), 300)}`);
    while (tail.length > 15) tail.shift();
  });
  page.on('pageerror', (e) => tail.push(`pageerror: ${squash(e, 300)}`));
  const pageProto = Object.getPrototypeOf(page);
  const locatorProto = Object.getPrototypeOf(page.locator('body'));
  if (patched.has(pageProto)) return;
  patched.add(pageProto);

  const waitForFunction = pageProto.waitForFunction;
  pageProto.waitForFunction = function (fn, arg, options) {
    const [rest, label] = unlabel(options);
    const arg_ = arg === undefined || arg === null ? '' : ` with ${squash(JSON.stringify(arg), 200)}`;
    return watched(this, 'page.waitForFunction', `${squash(fn, 400)}${arg_}`, label, () =>
      waitForFunction.call(this, fn, arg, rest),
    );
  };
  const waitForSelector = pageProto.waitForSelector;
  pageProto.waitForSelector = function (selector, options) {
    const [rest, label] = unlabel(options);
    const state = rest?.state ? ` (state ${rest.state})` : '';
    return watched(this, 'page.waitForSelector', `${selector}${state}`, label, () =>
      waitForSelector.call(this, selector, rest),
    );
  };
  const waitForEvent = pageProto.waitForEvent;
  pageProto.waitForEvent = function (event, options) {
    const [rest, label] = unlabel(options);
    return watched(this, 'page.waitForEvent', `the event "${event}"`, label, () =>
      waitForEvent.call(this, event, rest),
    );
  };
  const waitFor = locatorProto.waitFor;
  locatorProto.waitFor = function (options) {
    const [rest, label] = unlabel(options);
    const state = rest?.state ? ` (state ${rest.state})` : '';
    return watched(this.page(), 'locator.waitFor', `${this}${state}`, label, () => waitFor.call(this, rest));
  };
  // An action waits for its element too (Playwright's actionability checks), and its timeout says no more than a wait's does.
  for (const name of [
    'click',
    'dblclick',
    'hover',
    'fill',
    'press',
    'dragTo',
    'innerText',
    'textContent',
    'inputValue',
  ]) {
    const original = locatorProto[name];
    locatorProto[name] = function (...args) {
      return watched(this.page(), `locator.${name}`, `${this} to be actionable`, undefined, () =>
        original.apply(this, args),
      );
    };
  }
  for (const name of ['click', 'fill', 'press', 'goto']) {
    const original = pageProto[name];
    pageProto[name] = function (...args) {
      return watched(this, `page.${name}`, `${name} ${squash(args[0], 200)}`, undefined, () =>
        original.apply(this, args),
      );
    };
  }
}
