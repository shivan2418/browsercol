// What the browser scripts (smoke, play, saves, tileset, debug, rounds) share:
// Playwright, the option parser and the page helpers.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as Playwright from 'playwright-core';
import type { Browser, Locator, Page } from 'playwright-core';

const require = createRequire(import.meta.url);
// Playwright logs the browser process's stderr, exit code and signal under
// DEBUG=pw:browser. It reads the variable as it loads, and the lines are kept
// (see launchBrowser) rather than printed.
process.env.DEBUG = [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(',');

/** Playwright, a global install found via NODE_PATH. */
export const playwright: typeof Playwright = require('playwright');

/** A browser Playwright can launch. */
export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/** The value of --name on the command line, or dflt. */
export function opt(name: string): string | undefined;
export function opt(name: string, dflt: string): string;
export function opt(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
}

/** The browsers to run, from --browsers. */
export const browserNames = (dflt = 'chromium,firefox'): BrowserName[] =>
  opt('browsers', dflt).split(',') as BrowserName[];

/** What happened to the browsers and pages this run: crashes, closes and disconnects, with the time. */
const gone: string[] = [];
/** The tail of each browser process's own log (its stderr, its exit code and signal). */
const browserLog: string[] = [];
const started = Date.now();
const note = (what: string) => gone.push(`${((Date.now() - started) / 1000).toFixed(1)} s: ${what}`);
/** Browsers the script is closing itself: their pages and connection going away is no news. */
const closing = new WeakSet<Browser>();

/** Browser log lines worth showing: the process's own stderr and exit, and anything that says it crashed. */
const telling = (line: string) => /\[err\]|did exit|crash|abort|assert|fatal|memory|signal/i.test(line);

// The debug lines go to the log, not to stderr, unless the caller asked to see them.
const showDebug = !!process.env.FC_SHOW_PW_DEBUG;
const writeStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
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
  return rest_.trim() === '' ? true : writeStderr(rest_ + (String(chunk).endsWith('\n') ? '\n' : ''), ...(rest as []));
};

/**
 * Firefox draws the map on the Canvas 2D fallback (?renderer=canvas2d): in CI
 * its content process died with SIGSEGV next to FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS
 * (#31), software GL in a container being the suspect. Chromium keeps covering
 * PixiJS. FC_FIREFOX_WEBGL=1 gives Firefox WebGL back.
 */
const canvas2d = (url: string) =>
  /[?&]renderer=/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'renderer=canvas2d';

/** What launchBrowser's newPage adds to each page: the labelled waits, the dialog coverage and Firefox's canvas. */
async function wrapPage(name: BrowserName, page: Page): Promise<Page> {
  watchWaits(page);
  await trackCoverage(page);
  if (name === 'firefox' && !process.env.FC_FIREFOX_WEBGL) {
    const goto = page.goto.bind(page);
    page.goto = (url: string, ...rest: [Parameters<Page['goto']>[1]?]) => goto(canvas2d(url), ...rest);
  }
  return page;
}

/** The touch devices of the browser scripts, all held in landscape (what Playwright's own device list calls "landscape"). */
export const TOUCH_DEVICES = {
  /** An iPhone: WebKit, 844 x 390 at 3 device pixels to a CSS pixel. */
  iphone: { browser: 'webkit', width: 844, height: 390, deviceScaleFactor: 3 },
  /** A Pixel: Chromium, 915 x 412 at 2.6. */
  pixel: { browser: 'chromium', width: 915, height: 412, deviceScaleFactor: 2.6 },
  /** An iPad: WebKit, 1180 x 820 at 2. */
  ipad: { browser: 'webkit', width: 1180, height: 820, deviceScaleFactor: 2 },
} as const;
export type TouchDevice = keyof typeof TOUCH_DEVICES;

/**
 * A page with a touch screen (hasTouch, and isMobile where the browser has it: Firefox does not), of a browser
 * launchBrowser made, with what launchBrowser's own newPage adds. `portrait` turns the device on its side.
 */
export async function newTouchPage(browser: Browser, device: TouchDevice, portrait = false): Promise<Page> {
  const d = TOUCH_DEVICES[device];
  const name = browser.browserType().name() as BrowserName;
  const [width, height] = portrait ? [d.height, d.width] : [d.width, d.height];
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: d.deviceScaleFactor,
    hasTouch: true,
    isMobile: name !== 'firefox',
  });
  return wrapPage(name, await context.newPage());
}

/**
 * Launches a browser that remembers how it dies (#31, #40): Playwright's log
 * of the browser process is kept, and the browser's disconnect noted, for
 * diagnose(). Without this a closed browser shows only "Target page, context
 * or browser has been closed".
 */
export async function launchBrowser(name: BrowserName, args: string[] = []): Promise<Browser> {
  gone.length = 0;
  lastStep = '(nothing logged yet for ' + name + ')';
  browserLog.length = 0;
  const browser = await playwright[name].launch({ args });
  browser.on('disconnected', () => closing.has(browser) || note(`${name} browser disconnected`));
  const close = browser.close.bind(browser);
  browser.close = (...args: Parameters<Browser['close']>) => (closing.add(browser), close(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser['newPage']>) => wrapPage(name, await newPage(...args));
  return browser;
}

// --- Dialog coverage (docs/parity/dialog-coverage.md, tools/dialog-coverage.mjs) ---

/** How often each dialog was reached, by browser: what trackCoverage collects and the script's exit writes. */
const reached: Record<string, Record<string, number>> = {};
const coverageFile = path.resolve(
  import.meta.dirname,
  '../../.cache/coverage',
  `${path.basename(process.argv[1] ?? 'script', '.ts')}.json`,
);

/**
 * Counts the dialogs the page reaches: installs the window.fcCoverageHit hook (src/coverage.ts), which the page
 * only counts into when it finds it, so a player's page never counts. launchBrowser does it for each page it
 * makes; call it before page.goto for a page of a browser the script launched itself.
 */
export async function trackCoverage(page: Page): Promise<void> {
  const name = page.context().browser()?.browserType().name() ?? 'browser';
  const counts = (reached[name] ??= {});
  await page.exposeFunction('fcCoverageHit', (dialog: string) => {
    counts[dialog] = (counts[dialog] ?? 0) + 1;
  });
}

/** The script's counts go to .cache/coverage/<script>.json when it ends; a browser it did not run this time keeps its earlier counts. */
process.on('exit', () => {
  if (!Object.keys(reached).length) return;
  let merged: Record<string, Record<string, number>> = {};
  try {
    merged = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
  } catch {
    // none yet
  }
  fs.mkdirSync(path.dirname(coverageFile), { recursive: true });
  fs.writeFileSync(coverageFile, JSON.stringify({ ...merged, ...reached }, null, 1) + '\n');
});

/** What the page logs for each error its banner shows (src/main.tsx, reportError). */
const BANNER = 'Error banner: ';

/**
 * Collects the page's uncaught errors, the Engine's and the Worker's errors its banner showed the player, and
 * any file of the site's own that failed to load, as strings, into the returned array.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A file of the site that is not there: an image a style asks for fails with no error on the page, and the
  // window just draws without it (the advisor's paper, resolved against assets/). Other origins (a faked relay
  // that answers 503 on purpose) are the script's own business.
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const url = new URL(r.url());
    const at = page.url();
    if (!at.startsWith('http') || url.origin !== new URL(at).origin) return;
    errors.push(`${r.status()} for ${url.pathname}`);
  });
  page.on('console', (m) => {
    const text = m.type() === 'error' ? m.text() : '';
    // The page's own uncaught errors are on the banner too, but pageerror has them already.
    if (text.startsWith(BANNER) && !text.startsWith(`${BANNER}The page hit an error`)) {
      errors.push(text.slice(BANNER.length));
    }
  });
  page.on('crash', () => note('page crashed'));
  page.on('close', () => closing.has(page.context().browser()!) || note('page closed'));
  return errors;
}

/**
 * A failure as text. When the browser or page went away, what is known of
 * why: the page and browser events, and the browser process's last telling
 * log lines (its exit code and signal arrive a moment after the close).
 */
export async function diagnose(ex: unknown): Promise<string> {
  const text = String(ex);
  if (!/closed|crash|disconnected/i.test(text)) return text;
  await new Promise((done) => setTimeout(done, 1000));
  const lines = browserLog.slice(-15);
  return [text, ...gone.map((g) => `  ${g}`), ...lines.map((l) => `  | ${l}`)].join('\n');
}

/** window.fcResult, as src/main.tsx's show() sets it: the page's status once it is no longer running. */
export interface FcResult {
  status: string;
  error?: string;
  renderer?: string;
  /** The AI rounds played, each as "round,milliseconds"; absent from a result the script made up for a failure. */
  rounds?: string[];
  turn?: string;
  /** The player's nation, and what the start screen sent, as JSON. */
  nation?: string | null;
  choice?: string | null;
  mapSize?: number[];
  [key: string]: unknown;
}

/**
 * Waits for the page's window.fcResult and returns it, once the loading screen (index.html, #265) has faded
 * out or stayed up to show a failed start: it never takes a click, but a screenshot taken while it fades has it in.
 */
export async function waitForResult(page: Page, timeout?: number): Promise<FcResult> {
  await page.waitForFunction(() => window.fcResult, null, { timeout });
  await page.waitForFunction(
    () => {
      const state = document.getElementById('loading')?.dataset.state;
      return state === undefined || state === 'done' || state === 'failed';
    },
    null,
    { timeout: 10000 },
  );
  return page.evaluate(() => window.fcResult as FcResult);
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
export const setStep = (text: string) => {
  lastStep = text;
};

const squash = (text: unknown, max: number) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '...' : t;
};
/** Gives a promise a few seconds: a hung page must not hang the diagnosis. */
const within = <T>(promise: Promise<T>, ms = 5000): Promise<T | undefined> =>
  Promise.race([promise.catch(() => undefined), new Promise<undefined>((done) => setTimeout(done, ms, undefined))]);

/** Where a timeout's screenshots go: .cache/*.png is what the CI workflow uploads. */
const shotDir = path.resolve(import.meta.dirname, '../../.cache');
const script = path.basename(process.argv[1] ?? 'script', '.ts');
const consoleTails = new WeakMap<Page, string[]>();
let shots = 0;

/**
 * What a timed-out wait leaves: its step and condition in the error message,
 * with the page's last console lines and visible dialogs, and a screenshot in
 * .cache/ named in the message. Only the first eight timeouts of a run are shot.
 */
async function describeTimeout(page: Page, kind: string, what: string, label: string | undefined, ex: Error) {
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
async function watched<T>(page: Page, kind: string, what: string, label: string | undefined, run: () => Promise<T>) {
  try {
    return await run();
  } catch (ex) {
    if ((ex as Error | undefined)?.name !== 'TimeoutError') throw ex;
    throw await describeTimeout(page, kind, what, label, ex as Error);
  }
}

/** Takes a label out of an options bag: { label } names what the wait is for, Playwright never sees it. */
const unlabel = (options: unknown): [any, string | undefined] => {
  if (!options || typeof options !== 'object' || !('label' in options)) return [options, undefined];
  const { label, ...rest } = options as { label?: string };
  return [rest, label];
};

const patched = new WeakSet<object>();
/**
 * Makes every waitForFunction, waitForSelector, waitForEvent, locator waitFor and locator action (click, fill, ...) of the page
 * (and of its locators) fail with the step and condition on a timeout (#233).
 * Each takes an optional `label` in its options bag naming the condition.
 */
function watchWaits(page: Page) {
  const tail: string[] = [];
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
  pageProto.waitForFunction = function (this: Page, fn: unknown, arg: unknown, options: unknown) {
    const [rest, label] = unlabel(options);
    const arg_ = arg === undefined || arg === null ? '' : ` with ${squash(JSON.stringify(arg), 200)}`;
    return watched(this, 'page.waitForFunction', `${squash(fn, 400)}${arg_}`, label, () =>
      waitForFunction.call(this, fn, arg, rest),
    );
  };
  const waitForSelector = pageProto.waitForSelector;
  pageProto.waitForSelector = function (this: Page, selector: string, options: unknown) {
    const [rest, label] = unlabel(options);
    const state = rest?.state ? ` (state ${rest.state})` : '';
    return watched(this, 'page.waitForSelector', `${selector}${state}`, label, () =>
      waitForSelector.call(this, selector, rest),
    );
  };
  const waitForEvent = pageProto.waitForEvent;
  pageProto.waitForEvent = function (this: Page, event: string, options: unknown) {
    const [rest, label] = unlabel(options);
    return watched(this, 'page.waitForEvent', `the event "${event}"`, label, () =>
      waitForEvent.call(this, event, rest),
    );
  };
  const waitFor = locatorProto.waitFor;
  locatorProto.waitFor = function (this: Locator, options: unknown) {
    const [rest, label] = unlabel(options);
    const state = rest?.state ? ` (state ${rest.state})` : '';
    return watched(this.page(), 'locator.waitFor', `${String(this)}${state}`, label, () => waitFor.call(this, rest));
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
    locatorProto[name] = function (this: Locator, ...args: unknown[]) {
      return watched(this.page(), `locator.${name}`, `${String(this)} to be actionable`, undefined, () =>
        original.apply(this, args),
      );
    };
  }
  for (const name of ['click', 'fill', 'press', 'goto']) {
    const original = pageProto[name];
    pageProto[name] = function (this: Page, ...args: unknown[]) {
      return watched(this, `page.${name}`, `${name} ${squash(args[0], 200)}`, undefined, () =>
        original.apply(this, args),
      );
    };
  }
}
