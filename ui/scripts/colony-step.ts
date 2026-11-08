// Steps between colonies in the colony panel with the Right key and records what the page does (#379): whether the
// colony window is the same element after the step or a new one, how long no colony window was on screen, and
// where the window sits. A shot sequence goes to .cache/dialog-shots/colony-step-BROWSER-N.png. Run against dist/:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/colony-step.ts [--browsers chromium,firefox] [--tag before|after]
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const tag = opt('tag', 'after');
const dir = path.resolve(import.meta.dirname, '../../.cache/dialog-shots');
fs.mkdirSync(dir, { recursive: true });
const server = await serveDist();
let failed = false;
for (const browserName of browserNames()) {
  const browser = await launchBrowser(browserName);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  await page.addInitScript(() => {
    window.__hold = 'colony';
    // What the page does to the colony windows: each one added or removed, and when.
    const log: string[] = [];
    (window as unknown as { __winlog: string[] }).__winlog = log;
    const tagged = new WeakMap<Element, number>();
    let next = 1;
    const name = (e: Element) => {
      if (!tagged.has(e)) tagged.set(e, next++);
      return `window#${tagged.get(e)} (${e.querySelector('h2')?.textContent})`;
    };
    new MutationObserver((records) => {
      for (const r of records) {
        for (const [what, nodes] of [
          ['added', r.addedNodes],
          ['removed', r.removedNodes],
        ] as const)
          for (const n of nodes)
            if (n instanceof Element)
              for (const w of n.matches('.dialog[data-kind=colony]')
                ? [n]
                : n.querySelectorAll('.dialog[data-kind=colony]'))
                log.push(`${Math.round(performance.now())} ms: ${what} ${name(w)}`);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  try {
    await page.goto(`${server.url}?skipstart&debug&preset=colony-step`);
    const r = await waitForResult(page, 300000);
    if (r.status !== 'finished') throw new Error(`no game: ${JSON.stringify(r)}`);
    await page.waitForFunction(
      () => window.__map?.ourTurn && window.__map.settlements.filter((s) => s.population >= 0).length >= 3,
      null,
      {
        timeout: 300000,
        polling: 500,
      },
    );
    await new Promise((ok) => setTimeout(ok, 3000));
    const m = await page.evaluate(() => window.__map);
    const mine = m.settlements.filter((s) => s.population >= 0);
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [mine[0]!.x, mine[0]!.y]);
    await page.mouse.click(box.x + px, box.y + py);
    const win = page.locator('[role=dialog][data-kind=colony]');
    await win.waitFor({ timeout: 20000 });
    await new Promise((ok) => setTimeout(ok, 1500));
    // The player drags the window by its title bar.
    const bar = (await win.locator('.title').boundingBox())!;
    await page.mouse.move(bar.x + 60, bar.y + 10);
    await page.mouse.down();
    await page.mouse.move(bar.x + 160, bar.y + 70, { steps: 5 });
    await page.mouse.up();
    const where = () =>
      win.evaluate((e) => ({ title: e.querySelector('h2')?.textContent, ...e.getBoundingClientRect().toJSON() }));
    const was = await where();
    const shot = (n: number) => page.screenshot({ path: path.join(dir, `colony-step-${tag}-${browserName}-${n}.png`) });
    await shot(0);
    await page.evaluate(() => ((window as unknown as { __winlog: string[] }).__winlog.length = 0));
    await page.keyboard.press('ArrowRight');
    // A sequence of shots as fast as the browser takes them, then the settled window.
    const frames: string[] = [];
    for (let i = 1; i <= 4; i++) {
      await shot(i);
      frames.push(`shot ${i}: ${await page.locator('[role=dialog][data-kind=colony]').count()} colony window(s)`);
    }
    await new Promise((ok) => setTimeout(ok, 1500));
    await shot(5);
    const now = await where();
    const log = await page.evaluate(() => (window as unknown as { __winlog: string[] }).__winlog);
    console.log(`[${tag} / ${browserName}] before: ${JSON.stringify(was)}`);
    console.log(`[${tag} / ${browserName}] after:  ${JSON.stringify(now)}`);
    console.log(
      `[${tag} / ${browserName}] DOM log of the step:\n    ${log.join('\n    ') || '(no colony window added or removed)'}`,
    );
    console.log(`[${tag} / ${browserName}] ${frames.join('; ')}`);
    if (now.title === was.title) throw new Error('the window shows the same colony after the step');
    if (tag === 'after' && (log.length > 0 || now.x !== was.x || now.y !== was.y))
      throw new Error('the window was replaced or moved');
  } catch (ex) {
    failed = true;
    console.error(`${browserName}: ${ex instanceof Error ? ex.message : ex}`);
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
