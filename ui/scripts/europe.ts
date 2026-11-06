// Browser check of trading in the Europe panel, on the built site: with ?debug
// the side panel has the debug menu, so the player can be given gold, and
// Europe sells ships, so the player has one in port to trade with. The player
// buys goods of the market onto that ship, through the select amount dialog,
// and sells them again: the cargo and the gold follow.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/europe.ts [--browsers chromium,firefox]
import { browserNames, collectPageErrors, diagnose, launchBrowser } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import type { Locator, Page } from 'playwright-core';

const browsers = browserNames('chromium');
const server = await serveDist();
const base = `${server.url}?preset=dutch-small`;
const timeout = 600_000;

let failed = false;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  failed ||= !ok;
};

/** The gold the top bar's status line shows. */
const gold = (page: Page) => page.$eval('#statusLine', (e) => Number(/Gold: (\d+)/.exec(e.textContent!)?.[1]));

/** The gold once it is no longer the given amount: the map after a trade brings the status line up to date. */
const goldAfter = async (page: Page, from: number) => {
  await page
    .waitForFunction(
      (g: unknown) => /Gold: (\d+)/.exec(document.querySelector('#statusLine')!.textContent!)?.[1] != g,
      from,
      {
        timeout: 60_000,
      },
    )
    .catch(() => {});
  return gold(page);
};

/** The ships of the Classic rules, which Europe sells (data/rules/classic). */
const SHIPS = [
  'model.unit.caravel',
  'model.unit.frigate',
  'model.unit.galleon',
  'model.unit.merchantman',
  'model.unit.privateer',
];

for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  try {
    await page.goto(`${base}&debug&autoplay=0`);
    await page.waitForFunction(() => window.fcResult?.status === 'finished', null, { timeout });

    // A purse for the shopping, from the debug menu.
    const purse = await gold(page);
    await page.fill('input[aria-label="Gold"]', '5000');
    await page.click('button[data-debug="gold"]');
    await page.waitForFunction(
      (g: unknown) => /Gold: (\d+)/.exec(document.querySelector('#statusLine')!.textContent!)?.[1] == g,
      purse + 5000,
      { timeout: 60_000 },
    );

    // The Europe panel is kept open, so that the script can trade in it.
    await page.evaluate(() => (window.__hold = 'europe'));
    await page.click('button[data-command=showEurope]');
    const panel = page.locator('[role=dialog][data-kind=europe]');
    await panel.waitFor({ timeout: 10_000 });

    // Europe sells ships: one of them is bought, so that the player has a
    // ship in port to trade with.
    await panel.locator('button[data-europe=purchase]').click();
    const offers = panel.locator('[data-shop=purchase] [data-offer]');
    const count = await offers.count();
    let ship: Locator | null = null;
    for (let i = 0; i < count; i++) {
      const offer = offers.nth(i);
      if (SHIPS.includes((await offer.getAttribute('data-offer'))!)) {
        ship = offer;
        break;
      }
    }
    if (ship === null) throw new Error('Europe sells no ship to buy');
    const shipName = await ship.locator('.name').textContent();
    const beforeShip = await gold(page);
    await ship.click();
    await panel
      .locator('[data-list=inPort] [data-unit]')
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => {
        throw new Error(`buying the ${shipName} did not put a ship in port`);
      });

    // As in Swing, the Purchase window stays open while a unit is still affordable (with this
    // purse one is), so the script closes it with its close button.
    const shop = panel.locator('[data-shop]');
    if ((await shop.count()) > 0) await shop.locator('button.close').click();
    await shop.waitFor({ state: 'detached', timeout: 10_000 });

    // Buy a goods of the market onto that ship: the amount dialog asks how
    // much, and the answerer keeps the amount it suggests.
    const before = await goldAfter(page, beforeShip);
    const good = panel.locator('[data-list=market] [data-goods]').first();
    const goodName = await good.getAttribute('data-goods');
    await good.click();
    await panel
      .locator('[data-list=cargo] [data-cargo=goods]')
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => {
        throw new Error(`buying ${goodName} did not put it aboard the ship`);
      });
    const afterBuy = await goldAfter(page, before);
    check(`${name}: buying ${goodName} spends the gold`, afterBuy < before, `${before} -> ${afterBuy}`);

    // And sell it again: the cargo is empty and the gold is back.
    await panel.locator('[data-list=cargo] [data-cargo=goods]').first().click();
    await panel
      .locator('[data-list=cargo] [data-cargo=goods]')
      .first()
      .waitFor({ state: 'detached', timeout: 60_000 })
      .catch(() => {
        throw new Error(`selling ${goodName} did not take it off the ship`);
      });
    const afterSell = await goldAfter(page, afterBuy);
    check(`${name}: selling ${goodName} pays the gold`, afterSell > afterBuy, `${afterBuy} -> ${afterSell}`);

    // Drag the ship onto the ships sailing to America: it sets sail.
    await panel.locator('[data-list=inPort] [data-unit]').first().dragTo(panel.locator('[data-list=toAmerica]'));
    const sailing = await panel
      .locator('[data-list=toAmerica] [data-unit]')
      .first()
      .waitFor({ timeout: 60_000 })
      .then(
        () => true,
        () => false,
      );
    check(`${name}: dragging the ship to America sends it sailing`, sailing);

    check(`${name}: no page errors`, errors.length === 0, errors.join('; '));
  } catch (ex) {
    check(`${name}: trading in Europe`, false, await diagnose(ex));
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
