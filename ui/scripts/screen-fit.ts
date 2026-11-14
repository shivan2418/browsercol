// The windows fit the screen (#503): every story tagged `screen-fit` (src/screen-fit.stories.tsx: the colony panel
// big and small and with its build queue open, Europe, the trade routes and the route editor, three reports,
// Preferences, a model message) is loaded from the built Storybook at each common screen size and each UI scale
// the Preferences offer (display scaling, the `uiZoom` global that sets --ui-zoom on the root as the game does), and
// once the window has settled (its pictures and fonts loaded, its box and scale unchanged for 400 ms) it is checked:
//   - its box, its title bar and the parts named below (the colony's warehouse, the build queue) lie inside the viewport;
//   - nothing in it clips its content where it should not scroll;
//   - the page raised no error.
// On the small screens (compact-sizes: 844x390, 915x412, 700x500) every window must also be a full-screen sheet.
// A failure names the size, scale, story and the box that overflowed. A screenshot of every case is kept in
// .cache/screen-fit/BROWSER/. Pages run side by side (--pages, 4), each case a fresh load of the story.
// Run in the web image after building the Storybook into .cache/storybook:
//   ./dev.sh -C ui pnpm exec storybook build -o ../.cache/storybook --quiet
//   DEV_VARIANT=web ./dev.sh node ui/scripts/screen-fit.ts [--browsers chromium,firefox] [--sizes 1280x800,...]
//     [--scales 75,100] [--stories colony-big,europe] [--pages 4]
// or `just screen-fit`.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, sheetProblems } from './common.ts';

/** The screen sizes of the issue: common laptop and desktop screens. */
const SIZES = (opt('sizes', '') || '1280x720,1366x768,1280x800,1440x900,1536x864,1920x1080,2560x1440')
  .split(',')
  .map((s) => s.split('x').map(Number) as [number, number]);
/**
 * The small screens (docs/adr/0012, #511): two phones held in landscape and a small desktop window, each under 600 CSS px
 * on its short side. There every window is a full-screen sheet: it must fill the safe area, with its top bar and a back
 * button of at least 44 px on the screen (sheetProblems in common.ts), and what its body holds scrolls inside it. A sheet
 * ignores the UI scale, so a small screen is checked at 100% only.
 */
const COMPACT_SIZES = (opt('compact-sizes', '') || '844x390,915x412,700x500')
  .split(',')
  .filter((s) => s)
  .map((s) => s.split('x').map(Number) as [number, number]);
/** The display scaling options of client-options.xml; its "automatic" is 100% (uiZoom in prefs.ts). */
const SCALES = (opt('scales', '') || '75,100,125,150,175,200').split(',').map(Number);
const only = opt('stories', '')
  .split(',')
  .filter((x) => x);
const PAGES = Number(opt('pages', '4'));
/** How far a box may be outside the viewport (rounding of zoomed layout). */
const SLACK = 1.5;

const root = path.resolve(import.meta.dirname, '../../.cache/storybook');
const outRoot = path.resolve(import.meta.dirname, '../../.cache/screen-fit');
if (!fs.existsSync(path.join(root, 'index.json'))) {
  throw new Error(`no built Storybook in ${root}: see the header of this script`);
}

/** What a story's check is about: its window, or for the menu bar's stories (menu-fit.stories.tsx) the open menu. */
const TARGET = (story: string) =>
  story.startsWith('screen-fit-menus--') ? '.menubar [role=menu]' : '[role=dialog].frame';

/** What a story waits for besides the window itself. */
const WAITS: Record<string, string> = {
  'colony-big-queue': '.queue-body',
  'colony-small-queue': '.queue-body',
  'route-editor': '[data-stop]',
  'route-editor-many': '[data-stop]',
};
/** The parts of a story's window that must be on screen too. */
const PARTS: Record<string, string[]> = {
  'colony-big': ['[data-part=warehouse]'],
  'colony-big-queue': ['[data-part=warehouse]', '.queue-body'],
  'colony-small': ['[data-part=warehouse]'],
  'colony-small-queue': ['[data-part=warehouse]', '.queue-body'],
};

const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')) as {
  entries: Record<string, { id: string; name: string; tags: string[]; type: string }>;
};
const stories = Object.values(index.entries)
  .filter((e) => e.type === 'story' && e.tags.includes('screen-fit'))
  .map((e) => ({ id: e.id, name: e.id.replace(/^screen-fit--/, '') }))
  .filter((s) => !only.length || only.includes(s.name));
if (!stories.length) throw new Error('no story to check');

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
  const file = path.join(root, path.normalize(name === '/' ? '/index.html' : name));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/**
 * Waits for the window to settle: its pictures and the fonts loaded, and its box and its scale (--fit) unchanged for
 * 400 ms, so what is measured is what stays on screen once its content has come, not the window as it opens.
 */
const settle = (page: Page, target: string) =>
  page.evaluate(
    (target) =>
      document.fonts.ready.then(
        () =>
          new Promise<void>((done) => {
            const state = () => {
              const d = document.querySelector<HTMLElement>(target)!;
              const loaded = [...d.querySelectorAll('img')]
                .filter((img) => !img.closest('[aria-hidden=true]'))
                .every((img) => img.complete);
              const r = d.getBoundingClientRect();
              return `${loaded}|${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}|${d.getAttribute('style')}|${d.querySelectorAll('*').length}`;
            };
            let last = '';
            const start = performance.now();
            let since = start;
            const timer = setInterval(() => {
              const now = performance.now();
              const s = state();
              if (s !== last) [last, since] = [s, now];
              if ((now - since >= 400 && s.startsWith('true')) || now - start > 15000) done(clearInterval(timer));
            }, 50);
          }),
      ),
    target,
  );

/** The problems with a settled window at the viewport: boxes outside it, parts cut off. */
const problems = (page: Page, target: string, parts: string[]) =>
  page.evaluate(
    ([target, parts, slack]) => {
      const d = document.querySelector<HTMLElement>(target as string)!;
      const out: string[] = [];
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const f = (r: DOMRect) =>
        `x ${r.left.toFixed(1)}..${r.right.toFixed(1)}, y ${r.top.toFixed(1)}..${r.bottom.toFixed(1)}`;
      const inside = (what: string, r: DOMRect) => {
        if (r.left < -slack || r.top < -slack || r.right > vw + slack || r.bottom > vh + slack)
          out.push(`${what} box ${f(r)} is outside the viewport 0..${vw} x 0..${vh}`);
      };
      inside('window', d.getBoundingClientRect());
      const title = d.querySelector('.title');
      if (title) inside('title bar', title.getBoundingClientRect());
      // A sheet scrolls: a part of it is there to be scrolled to, not on the screen as it opens.
      const sheet = d.hasAttribute('data-sheet');
      for (const sel of parts as string[]) {
        const el = d.querySelector(sel);
        if (!el) out.push(`${sel} is missing`);
        else if (!sheet) inside(sel, el.getBoundingClientRect());
      }
      // Scrolled while there is room: the window's own body scrolls its content though the window is well short of the
      // screen's height, so it could have grown instead (the route editor stopped at 80% of the screen and hid its OK
      // button below a scroll bar). A list or a part that scrolls inside a window is its own business.
      const body = d.querySelector<HTMLElement>(':scope > .body');
      const room = vh * 0.9 - d.getBoundingClientRect().height;
      if (body && body.scrollHeight > body.clientHeight + 2 && room > 24)
        out.push(
          `its body scrolls ${body.scrollHeight - body.clientHeight}px of content while the window could grow ${Math.round(room)}px more: ${f(d.getBoundingClientRect())}`,
        );
      // Cut off where it should not scroll: a part that clips its content on the vertical axis.
      for (const el of d.querySelectorAll<HTMLElement>('*')) {
        if (el.scrollHeight <= el.clientHeight + 2 || el.clientHeight === 0) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || el.closest('[aria-hidden=true]')) continue;
        if (!/hidden|clip/.test(s.overflowY)) continue;
        if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') continue;
        const name =
          el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '');
        out.push(
          `${name} clips its content: ${el.scrollHeight}px of content in ${el.clientHeight}px, ${f(el.getBoundingClientRect())}`,
        );
      }
      return out;
    },
    [target, parts, SLACK] as const,
  );

interface Case {
  size: [number, number];
  scale: number;
  story: { id: string; name: string };
  /** A small screen: the window must be a sheet. */
  sheet?: boolean;
}
const cases: Case[] = [
  ...SIZES.flatMap((size) => SCALES.flatMap((scale) => stories.map((story) => ({ size, scale, story })))),
  // The menus' stories are the menu bar's, which the phone screen folds (not a window): not checked as sheets.
  ...COMPACT_SIZES.flatMap((size) =>
    stories
      .filter((story) => !story.name.startsWith('screen-fit-menus--'))
      .map((story) => ({ size, scale: 100, story, sheet: true })),
  ),
];

const failures: string[] = [];
let done = 0;
for (const name of browserNames()) {
  const started = Date.now();
  const outDir = path.join(outRoot, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser(name);
  const queue = [...cases];
  const mine: string[] = [];
  const worker = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = collectPageErrors(page);
    for (let c = queue.shift(); c; c = queue.shift()) {
      const [w, h] = c.size;
      const label = `${w}x${h} scale ${c.scale} ${c.story.name}`;
      const bad: string[] = [];
      errors.length = 0;
      try {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${base}/iframe.html?id=${c.story.id}&viewMode=story&globals=uiZoom:${c.scale}`);
        const target = TARGET(c.story.name);
        await page.waitForSelector(target, { timeout: 30000 });
        if (WAITS[c.story.name]) await page.waitForSelector(WAITS[c.story.name], { timeout: 10000 });
        await settle(page, target);
        bad.push(...(await problems(page, target, PARTS[c.story.name] ?? [])));
        if (c.sheet) bad.push(...(await page.evaluate(sheetProblems, target)));
      } catch (ex) {
        bad.push(`could not be checked: ${String(ex).split('\n')[0]}`);
      }
      if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`);
      await page
        .screenshot({
          path: path.join(outDir, `${w}x${h}-${c.scale}-${c.story.name}.jpg`),
          type: 'jpeg',
          quality: 55,
        })
        .catch(() => {});
      done++;
      if (bad.length) {
        mine.push(`${name} ${label}: ${bad.join('; ')}`);
        console.log(`FAIL ${label}: ${bad.join('; ')}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: PAGES }, worker));
  } catch (ex) {
    mine.push(`${name}: ${await diagnose(ex)}`);
  } finally {
    await browser.close();
  }
  console.log(
    `${name}: ${cases.length} cases in ${((Date.now() - started) / 1000).toFixed(0)} s, ${mine.length} failing`,
  );
  failures.push(...mine);
}
server.close();
if (failures.length) {
  console.log(`\nFAIL (${failures.length})\n${failures.sort().join('\n')}\nscreenshots in ${outRoot}`);
  process.exit(1);
}
console.log(`every window fits at every size and scale (${done} cases)`);
