// Screenshot comparison of the key panels (#421, docs/adr/0008): in a game from a fixed preset (?preset=diplomacy,
// seed 1), the colony panel, Europe, a report, the Preferences window and a negotiation are opened, each is shot
// on its own and compared with its approved picture in ui/looks/ (PANEL-BROWSER.png). A panel that came out a
// different size, or with more changed pixels than the tolerance allows, fails the run; its shot and a picture of
// what changed (in red) are left in .cache/looks/ for a look.
//
// A change meant to show is approved deliberately, once its shots have been looked at: --approve writes the shots
// over the approved pictures, which are then committed with the change.
//
// With --theme NAME (a palette), --fonts NAME (a font set) or --css TEXT (rules added in the theme layer, as a
// theme's are), the panels are shot to see a theme rather than compared: into .cache/looks/LABEL/.
// With --styles, each panel's computed styles are written beside its shot too (PANEL-BROWSER.json), element by
// element, to compare a move of CSS rule by rule.
//
// The pictures are kept steady: one page size, the fonts loaded, the images loaded, no animation or caret, and the
// pointer away from the panels.
// Run in the web image, after `just build`:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/looks.ts [--browsers chromium,firefox] [--only colony,europe]
//     [--approve] [--tolerance 0.0005] [--theme dark] [--fonts NAME] [--css ':root { --frame-pad: 4px }'] [--styles]
// or `just browser looks [...]`, and `just looks-approve` to approve.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import { target } from './targets.ts';
import type { Locator, Page } from 'playwright-core';

const browsers = browserNames();
const only = opt('only', '')
  .split(',')
  .filter((x) => x);
const approve = process.argv.includes('--approve');
const styles = process.argv.includes('--styles');
const theme = opt('theme');
const fonts = opt('fonts');
const css = opt('css');
/** Shooting a theme to look at, not comparing. */
const trying = !!(theme || fonts || css);
const label = opt('label', [theme, fonts, css && 'css'].filter(Boolean).join('-'));
const approvedDir = path.resolve(import.meta.dirname, '../looks');
const outDir = path.resolve(import.meta.dirname, '../../.cache/looks', trying ? label : '');
fs.mkdirSync(outDir, { recursive: true });
/**
 * How far a shot may be from its approved picture: a pixel has changed when one of its channels is more than
 * `channel` apart (anti-aliasing stays under it), and the shot has changed when more than `ratio` of its pixels have.
 */
const TOLERANCE = { channel: 32, ratio: Number(opt('tolerance', '0.0005')) };
/** Big enough for the colony panel at 100%, so it is not scaled down to fit. */
const VIEWPORT = { width: 1600, height: 1000 };

/** No animation or transition, and no caret blinking in a field. */
const STEADY = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kindSel = (kind: string) => `[role=dialog][data-kind="${kind}"], [role=dialog]#${kind}`;
const hold = (page: Page, kind: string | null) => page.evaluate((k) => (window.__hold = k), kind);

/** A panel of the tour: how to open it, and the kind of window it is (its data-kind, or the id of the page's own). */
interface Panel {
  name: string;
  kind: string;
  open: (page: Page) => Promise<void>;
  /** Closes it once shot; Escape by default. */
  close?: (page: Page, panel: Locator) => Promise<void>;
}

const menu = async (page: Page, name: string, item: RegExp) => {
  await page.getByRole('menuitem', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const PANELS: Panel[] = [
  {
    name: 'colony',
    kind: 'colony',
    open: async (page) => {
      const m = await page.evaluate(() => window.__map);
      const ours = m.nation.split('.').pop()!;
      const mine = m.settlements.find((s) => s.population >= 0 && s.keys.some((k) => k.includes(ours)));
      if (!mine) throw new Error('the preset has no colony of ours');
      const box = (await page.locator('#map canvas').boundingBox())!;
      const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [mine.x, mine.y]);
      await page.mouse.click(box.x + px, box.y + py);
    },
  },
  { name: 'europe', kind: 'europe', open: (page) => page.keyboard.press('e') },
  { name: 'report', kind: 'report', open: (page) => menu(page, 'Report', /^Continental Congress report/) },
  { name: 'options', kind: 'preferences', open: (page) => menu(page, 'Game', /^Preferences/) },
  {
    // The scout meets the French colony beside it, and the player picks to negotiate (the diplomacy scenario's way).
    name: 'diplomacy',
    kind: 'negotiation',
    open: async (page) => {
      await hold(page, 'choice');
      for (let i = 0; ; i++) {
        if (i === 80) throw new Error('the scout never had the French colony beside it');
        await sleep(150);
        if ((await page.locator('[role=dialog]').count()) > 0) break;
        const m = await page.evaluate(() => window.__map);
        if (!m.ourTurn) continue;
        const t = m.activeUnit && /Scout/.test(m.activeUnit.label) ? target(m) : null;
        const before = await page.evaluate(() => window.__maps);
        await page.keyboard.press(t ? t.key : m.activeUnit ? ' ' : 'w');
        if (t) break;
        await page.waitForFunction((n: number) => window.__maps > n, before, { timeout: 5000 }).catch(() => {});
      }
      const choice = page.locator(kindSel('choice'));
      await choice.waitFor({ timeout: 120000, label: 'the scout is asked what to do' });
      await hold(page, 'negotiation');
      await choice.locator('button[data-choice]:not(:disabled):has-text("egotiat")').click();
    },
    close: async (_page, panel) => {
      await panel.locator('[data-answer=cancel], [data-answer=send]').first().click();
    },
  },
];

/** Waits until no map has come for `ms`: the page has worked through what the Engine sent. */
const quiet = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<void>((done) => {
        let last = window.__maps;
        let at = performance.now();
        const timer = setInterval(() => {
          if (window.__maps !== last) [last, at] = [window.__maps, performance.now()];
          else if (performance.now() - at >= ms) done(clearInterval(timer));
        }, 100);
      }),
    ms,
  );

/** Waits for the panel's pictures and the fonts, then two frames: what is shot is what stays on screen. */
async function steady(page: Page, panel: Locator) {
  await panel.evaluate(
    (d) =>
      Promise.all(
        [...d.querySelectorAll('img')].map(
          (img) =>
            new Promise((ok) => {
              if (img.complete) return ok(null);
              img.addEventListener('load', ok);
              img.addEventListener('error', ok);
            }),
        ),
      ),
    null,
  );
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  await sleep(300);
}

/** Every element of the panel with its computed style, by its path in the panel. */
const computedStyles = (panel: Locator) =>
  panel.evaluate((root) => {
    const out: Record<string, Record<string, string>> = {};
    const walk = (e: Element, at: string) => {
      const s = getComputedStyle(e);
      const props: Record<string, string> = {};
      for (let i = 0; i < s.length; i++) props[s[i]] = s.getPropertyValue(s[i]);
      out[at] = props;
      [...e.children].forEach((c, i) =>
        walk(
          c,
          `${at}/${i}:${c.tagName.toLowerCase()}${c.className ? '.' + String(c.className).replace(/\s+/g, '.') : ''}`,
        ),
      );
    };
    walk(root, 'panel');
    return out;
  });

/** How many pixels of two PNGs differ, and a picture of them in red; null for a size that differs. */
async function compare(page: Page, shot: Buffer, approved: Buffer) {
  return page.evaluate(
    async ([a, b, channel]) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((ok, fail) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = fail;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [x, y] = await Promise.all([load(a), load(b)]);
      const size = { shot: [x.width, x.height], approved: [y.width, y.height] };
      if (x.width !== y.width || x.height !== y.height) return { size, changed: -1, total: 0, diff: '' };
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        [c.width, c.height] = [img.width, img.height];
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const [p, q] = [pixels(x), pixels(y)];
      const out = new ImageData(p.width, p.height);
      let changed = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const off =
          Math.abs(p.data[i] - q.data[i]) > channel ||
          Math.abs(p.data[i + 1] - q.data[i + 1]) > channel ||
          Math.abs(p.data[i + 2] - q.data[i + 2]) > channel ||
          Math.abs(p.data[i + 3] - q.data[i + 3]) > channel;
        if (off) changed++;
        // The approved picture faded, with what changed in red over it.
        const grey = (q.data[i] + q.data[i + 1] + q.data[i + 2]) / 3;
        out.data.set(off ? [255, 0, 0, 255] : [grey, grey, grey, 70], i);
      }
      const c = document.createElement('canvas');
      [c.width, c.height] = [p.width, p.height];
      c.getContext('2d')!.putImageData(out, 0, 0);
      return { size, changed, total: p.width * p.height, diff: changed ? c.toDataURL('image/png').split(',')[1] : '' };
    },
    [shot.toString('base64'), approved.toString('base64'), TOLERANCE.channel] as const,
  );
}

const server = await serveDist();
const failures: string[] = [];
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: VIEWPORT });
  await answerDialogs(page);
  // The latest map the Engine sent, and how many came, as scenarios.ts keeps them.
  await page.addInitScript(() => {
    let inner: ((name: string, detail: string) => unknown) | undefined;
    window.__maps = 0;
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f: (name: string, detail: string) => unknown) => {
        inner = (n: string, detail: string) => {
          if (n === 'map' || n === 'gameStarted') {
            window.__map = JSON.parse(detail);
            window.__maps++;
          }
          return f(n, detail);
        };
      },
    });
  });
  const errors = collectPageErrors(page);
  try {
    setStep(`${name}: the preset game starts`);
    await page.goto(`${server.url}?skipstart&debug&preset=diplomacy`);
    const r = await waitForResult(page, 900000);
    if (r.status !== 'finished') throw new Error(`the page did not start a game: ${JSON.stringify(r)}`);
    await page.waitForFunction(
      () =>
        window.__map?.ourTurn &&
        window.__map.units.reduce((n, u) => n + u.stack, 0) >= 8 &&
        window.__map.settlements.length >= 2,
      null,
      { timeout: 300000, polling: 500, label: 'the preset has put its units round the French colony' },
    );
    await quiet(page, 2000);
    await page.addStyleTag({ content: STEADY });
    if (theme) await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    if (fonts) await page.evaluate((f) => (document.documentElement.dataset.fonts = f), fonts);
    if (css) await page.addStyleTag({ content: `@layer theme {\n${css}\n}` });
    const compareOn = await browser.newPage();
    for (const p of PANELS.filter((p) => !only.length || only.includes(p.name))) {
      setStep(`${name}: the ${p.name} panel`);
      await hold(page, p.kind);
      await p.open(page);
      const panel = page.locator(kindSel(p.kind)).last();
      await panel.waitFor({ timeout: 120000, label: `the ${p.name} panel opens` });
      // The pointer goes where it points at nothing of the panel's, and shows no hint.
      await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
      await steady(page, panel);
      const file = `${p.name}-${name}.png`;
      const shot = await panel.screenshot({ path: path.join(outDir, file) });
      if (styles)
        fs.writeFileSync(
          path.join(outDir, `${p.name}-${name}.json`),
          JSON.stringify(await computedStyles(panel), null, 1),
        );
      if (approve) {
        fs.mkdirSync(approvedDir, { recursive: true });
        fs.writeFileSync(path.join(approvedDir, file), shot);
        console.log(`approved ${file}`);
      } else if (!trying) {
        const approvedFile = path.join(approvedDir, file);
        if (!fs.existsSync(approvedFile)) {
          failures.push(`${file}: no approved picture (run with --approve to make one, and look at it)`);
        } else {
          const d = await compare(compareOn, shot, fs.readFileSync(approvedFile));
          const share = d.total ? d.changed / d.total : 1;
          const ok = d.changed >= 0 && share <= TOLERANCE.ratio;
          const what =
            d.changed < 0
              ? `its size is ${d.size.shot.join('x')}, the approved one's ${d.size.approved.join('x')}`
              : `${d.changed} of ${d.total} pixels changed (${(share * 100).toFixed(3)}%)`;
          console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${what}`);
          if (d.diff) fs.writeFileSync(path.join(outDir, `${p.name}-${name}-diff.png`), Buffer.from(d.diff, 'base64'));
          if (!ok) failures.push(`${file}: ${what}; see .cache/looks/`);
        }
      }
      if (p.close) await p.close(page, panel);
      else await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached', timeout: 30000, label: `the ${p.name} panel closes` });
      await hold(page, null);
    }
    await compareOn.close();
    if (errors.length) failures.push(`${name}: page errors: ${errors.join(' | ')}`);
  } catch (ex) {
    failures.push(`${name}: ${await diagnose(ex)}`);
  } finally {
    await browser.close();
  }
}
server.close();
if (trying || approve) console.log(`shots in ${outDir}`);
if (failures.length) {
  console.log(`\nFAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(trying || approve ? 'done' : 'every panel looks as approved');
