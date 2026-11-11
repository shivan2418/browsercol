// The Send feedback window (#369) in the built site: with no relay in the build, the Beta tag on the start screen
// opens it and the only way to send is the downloaded .zip, which is read back (report.json, logs.txt, no save
// before a game); with a fake relay (the page's ?feedback=URL, which only a build that is not a release takes, and
// Playwright's page.route answering for it, so nothing reaches the real relay), a game's Game > Send feedback...
// sends a bug with its save and shows the reference the relay answered with, the error banner's Report this opens
// a bug with the error listed, and a relay that fails leaves the download. Exits non-zero unless every browser
// gets there. The page's dialogs are answered as scripts/dialogs.ts says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/feedback.ts [--browsers chromium,firefox] [--shots DIR]
// --shots saves screenshots of the window and the Beta tag to DIR, per browser.
import fs from 'node:fs';
import path from 'node:path';
import { readFsg, zipEntry } from '../src/fsg.ts';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import type { Download, Page, Route } from 'playwright-core';

const browsers = browserNames();
const shotsDir = opt('shots', '');
const RELAY = 'https://relay.test/';
const REFERENCE = /^R-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

/** The downloaded zip's bytes. */
async function bytesOf(download: Download): Promise<Uint8Array> {
  const file = await download.path();
  return new Uint8Array(fs.readFileSync(file));
}

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(what);
}

async function run(page: Page, url: string, browserName: string) {
  const shot = async (name: string) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${browserName}-${name}.png`) });
  };
  const dialog = page.locator('[data-feedback]');
  /** Open the window from the Beta tag: the start screen's corner tag, or in a game the menu bar's. */
  const open = async (tag = '[data-beta-tag]') => {
    await page.click(tag);
    await dialog.waitFor({ timeout: 10000 });
  };
  const fill = async (title: string) => {
    await page.fill('[data-feedback-title]', title);
    await page.fill('[data-feedback-description]', 'The colony vanished after I ended the turn.');
  };
  const ticked = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('[data-feedback-attach]')]
        .filter((i) => i.checked)
        .map((i) => i.dataset.feedbackAttach),
    );
  await answerDialogs(page);

  // --- No relay in the build: the start screen, and the download alone. ---
  await page.goto(url);
  await page.waitForSelector('[data-start]', { timeout: 120000 });
  check(/beta/i.test(await page.locator('[data-beta-tag]').innerText()), 'the start screen has the Beta tag');
  await shot('start-tag');
  await open();
  check(await page.locator('[data-feedback-kind=bug]').isChecked(), 'the window opens as a bug');
  await page.locator('[data-feedback-attach=logs]:not(:disabled)').waitFor({ timeout: 10000 });
  check(
    (await ticked()).join() === 'logs,version,browser',
    `a bug before a game has ${(await ticked()).join()} ticked`,
  );
  check(await page.locator('[data-feedback-attach=save]').isDisabled(), 'there is no save to attach before a game');
  check((await page.locator('[data-feedback-send]').count()) === 0, 'a build with no relay has no Send button');
  await page.click('[data-feedback-kind=idea]');
  check((await ticked()).join() === 'version,browser', 'an idea ticks only the version and the browser');
  await fill('Let me rename a colony');
  await shot('idea');
  await page.click('[data-feedback-kind=bug]');
  await fill('The colony vanished');
  check(
    (await page.locator('[data-feedback-preview]').innerText()).includes('The colony vanished after'),
    'the window shows what will be sent',
  );
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-feedback-download]')]);
  const zip = await bytesOf(download);
  const reference = await page.locator('[data-feedback-reference]').innerText();
  check(REFERENCE.test(reference), `the reference ${reference} is R- and five letters`);
  check(download.suggestedFilename() === `${reference}.zip`, `the zip is named ${download.suggestedFilename()}`);
  const noRelay = JSON.parse(text(await zipEntry(zip, 'report.json'))!);
  check(
    noRelay.reference === reference && noRelay.kind === 'bug' && noRelay.logs === true && noRelay.saveBytes === null,
    `report.json is ${JSON.stringify(noRelay)}`,
  );
  check(text(await zipEntry(zip, 'logs.txt'))!.includes('Client Engine (page)'), 'logs.txt holds both Engines');
  check((await zipEntry(zip, 'save.fsg')) === null, 'a report from the start screen has no save');
  await page.click('[data-feedback-close]');

  // --- A game, and a fake relay. ---
  const posted: { origin: string | undefined; type: string | undefined; body: Record<string, unknown> }[] = [];
  let answer: { status: number; body: unknown } = { status: 201, body: { reference: 'R-K7M4P' } };
  await page.route(`${RELAY}**`, (route: Route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    posted.push({
      origin: request.headers()['origin'],
      type: request.headers()['content-type'],
      body: JSON.parse(request.postData() ?? '{}'),
    });
    return route.fulfill({
      status: answer.status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(answer.body),
    });
  });
  await page.goto(`${url}?skipstart&feedback=${encodeURIComponent(RELAY)}`);
  const result = await waitForResult(page, 300000);
  check(result.status === 'finished', `the page did not start a game: ${JSON.stringify(result)}`);
  await page.waitForSelector('#menubar [role=menuitem]', { timeout: 60000 });
  // A release build hides the side panel at first; the shots show the game as a tester sees it.
  await page.keyboard.press('Shift+F11');
  await shot('game-tag');
  // In a game the Beta tag is in the menu bar, not in a corner over the map.
  check(await page.locator('#menubar [data-beta-menu]').isVisible(), 'the menu bar has the Beta tag in a game');
  check(!(await page.locator('[data-beta-tag]').isVisible()), 'the corner tag is hidden in a game');

  // Game > Send feedback... opens it, as a bug with the game's save ready to attach.
  await page.click('#menubar [role=menuitem]:text-is("Game")');
  await page.click('[role=menu] [role=menuitem]:has-text("Send feedback")');
  await dialog.waitFor({ timeout: 10000 });
  await page.locator('[data-feedback-attach=save]:not(:disabled)').waitFor({ timeout: 60000 });
  check(
    (await ticked()).join() === 'logs,version,browser,save',
    `a bug in a game has ${(await ticked()).join()} ticked`,
  );
  await fill('The colony vanished');
  await page.fill('[data-feedback-contact]', 'u/tester');
  await page.locator('[data-feedback-preview] [data-feedback-save-size]').waitFor();
  await shot('bug');
  await page.click('[data-feedback-send]');
  await page.waitForSelector('[data-feedback-reference]', { timeout: 20000 });
  check((await page.locator('[data-feedback-reference]').innerText()) === 'R-K7M4P', 'the relay reference shows');
  check((await page.locator('[data-feedback-copy]').count()) === 1, 'the reference has a Copy button');
  await shot('thanks');
  check(posted.length === 1, `${posted.length} reports were posted`);
  const sent = posted[0];
  check(sent.type === 'application/json', `the report was posted as ${sent.type}`);
  const body = sent.body;
  check(
    body.kind === 'bug' && body.title === 'The colony vanished' && body.contact === 'u/tester',
    `the report is ${JSON.stringify(body).slice(0, 200)}`,
  );
  check(
    typeof body.version === 'string' && typeof body.browser === 'string',
    'the report names the version and the browser',
  );
  check(
    typeof body.logs === 'string' && (body.logs as string).includes('Server Engine (Worker)'),
    'the report has the log',
  );
  const save = Uint8Array.from(Buffer.from(body.save as string, 'base64'));
  const info = await readFsg(save);
  check(info.turn >= 1, 'the report holds the game as an .fsg');
  check(!('errors' in body), 'no errors were listed, so none were sent');
  await page.click('[data-feedback-close]');

  // An idea sends only the version and the browser.
  posted.length = 0;
  await open('[data-beta-menu]');
  await page.click('[data-feedback-kind=idea]');
  await fill('Let me rename a colony');
  await page.click('[data-feedback-send]');
  await page.waitForSelector('[data-feedback-reference]', { timeout: 20000 });
  check(
    posted.length === 1 &&
      !('save' in posted[0].body) &&
      !('logs' in posted[0].body) &&
      posted[0].body.kind === 'idea' &&
      typeof posted[0].body.version === 'string',
    `${posted.length} reports; an idea was sent as ${JSON.stringify(posted[0]?.body, (k, v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) : v))}`,
  );
  await shot('idea-thanks');
  await page.click('[data-feedback-close]');

  // A relay that fails leaves the download.
  answer = { status: 503, body: { error: 'no free reference, try again' } };
  await open('[data-beta-menu]');
  await fill('The relay is down');
  await page.click('[data-feedback-send]');
  await page.waitForSelector('[data-feedback-failed]', { timeout: 20000 });
  check(
    (await page.locator('[data-feedback-failed]').innerText()).includes('no free reference'),
    'the relay reason shows',
  );
  await shot('failed');
  const [fallback] = await Promise.all([page.waitForEvent('download'), page.click('[data-feedback-download]')]);
  check(
    /^R-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}\.zip$/.test(fallback.suggestedFilename()),
    `the fallback is named ${fallback.suggestedFilename()}`,
  );
  check((await zipEntry(await bytesOf(fallback), 'report.json')) !== null, 'the fallback zip holds report.json');
  await page.click('[data-feedback-close]');

  // The error banner's Report this: a bug with the errors filled in.
  answer = { status: 201, body: { reference: 'R-QQ2X8' } };
  posted.length = 0;
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('feedback script error');
    });
  });
  await page.click('[data-report-this]');
  await dialog.waitFor({ timeout: 10000 });
  await page.locator('[data-feedback-attach=errors]:not(:disabled)').waitFor({ timeout: 60000 });
  check((await ticked()).includes('errors'), 'Report this ticks the errors');
  check(await page.locator('[data-feedback-kind=bug]').isChecked(), 'Report this opens a bug');
  await fill('The page threw');
  await shot('report-this');
  await page.click('[data-feedback-send]');
  await page.waitForSelector('[data-feedback-reference]', { timeout: 20000 });
  const errors = posted[0]?.body.errors as string[] | undefined;
  check(
    !!errors && errors.some((e) => e.startsWith('The page hit an error')),
    `the errors sent were ${String(errors)}`,
  );
  return `no relay: ${reference}.zip with its log; relay: sent a bug with a ${(save.length / 1024).toFixed(0)} KB save, an idea, a failure that left the download, and an error report`;
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = collectPageErrors(page);
  const t = Date.now();
  let line: string;
  try {
    line = `ok: ${await run(page, server.url, name)}`;
  } catch (ex) {
    failed = true;
    line = `failed: ${await diagnose(ex)}`;
  }
  // The error the script throws on purpose is the page's, and expected.
  const unexpected = errors.filter((e) => !e.includes('feedback script error'));
  failed ||= unexpected.length > 0;
  await browser.close();
  console.log(
    `${name} ${browser.version()}: ${line}, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      `${unexpected.length ? ', page errors: ' + unexpected.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
