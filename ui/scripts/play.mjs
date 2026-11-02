// Plays the human's first turns in the built site, through the page's own
// input: arrow and numpad keys, map clicks, B, F, H and Enter. The ship sails
// by the shortest explored sea route to free land that can feed a colony,
// or toward the westmost explored sea while none is in sight, moves onto
// the land to put its units ashore, a unit founds a colony (whose panel
// opens and must show the founder), the ship fortifies and the turn ends;
// the colony must still be there when the AI hands play back. The Go To
// order then asks where the ship sails, which the page must ask the player.
// The colony panel's two quick drops, a unit and goods aboard the ship in
// one turn, must both land: the Engine runs the commands one at a time, and
// queues the one that comes while another runs.
// The page's dialogs are answered as scripts/dialogs.mjs says, and every
// question the controllers ask must reach one: a dialog with no Browser UI yet fails the run. Along the way
// the map's view must follow the active unit, its cursor and the info panel
// must match the client's active unit, the side panel's buttons must follow
// the Engine's orders, the map canvas must follow a window resize and fill
// what the side panel leaves of the window, and the wheel, a drag and the
// pointer at an edge must zoom and scroll it at its new size. Exits non-zero
// unless every browser gets there. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/play.mjs [--browsers chromium,firefox] [--query renderer=canvas2d|preset=dutch-small] [--scale 2]
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.mjs';
import { answerDialogs, dialogLog } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const browsers = browserNames();
/** Page parameters, e.g. renderer=canvas2d to play on the Canvas 2D fallback. */
const query = opt('query', '');
/** The device pixel ratio the browser reports: 2 to play as on a HiDPI screen. */
const scale = Number(opt('scale', '1'));
const MAX_TURNS = 15;

// FreeCol's Direction deltas on its staggered rows: [odd row, even row].
const DIRECTIONS = {
  N: [
    [0, -2],
    [0, -2],
  ],
  NE: [
    [1, -1],
    [0, -1],
  ],
  E: [
    [1, 0],
    [1, 0],
  ],
  SE: [
    [1, 1],
    [0, 1],
  ],
  S: [
    [0, 2],
    [0, 2],
  ],
  SW: [
    [0, 1],
    [-1, 1],
  ],
  W: [
    [-1, 0],
    [-1, 0],
  ],
  NW: [
    [0, -1],
    [-1, -1],
  ],
};
// The page's keys for each direction (ui/src/input.ts).
const KEYS = {
  N: 'ArrowUp',
  NE: 'Numpad9',
  E: 'ArrowRight',
  SE: 'Numpad3',
  S: 'ArrowDown',
  SW: 'Numpad1',
  W: 'ArrowLeft',
  NW: 'Numpad7',
};
const WATER = /ocean|highSeas|lake/i;
// Land whose colony centre yields less food than a colonist eats (classic
// rules), where a lone founder starves on the next turn, or that cannot be
// settled at all.
const BARREN = /arctic|desert|scrubForest|mountains/;
// FreeCol's grey for a fortified unit (MapJson draws it in that colour).
const FORTIFIED = 0x808080;

const neighbour = ([x, y], d) => {
  const [dx, dy] = DIRECTIONS[d][y % 2 ? 0 : 1];
  return [x + dx, y + dy];
};
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const label = (tile) => (tile ? tile.join(',') : 'none');
const at = (list, tile) => list.some(({ x, y }) => same([x, y], tile));

/** The tile type id at a tile of a map view, null if unexplored or off the map. */
function typeAt(m, [x, y]) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const i = m.tiles.charCodeAt(y * m.w + x) - 65;
  return i >= 0 ? m.types[i].id : null;
}

/**
 * Land to found on: explored, not water or barren, nobody's (so founding
 * needs no land claim), and with no settlement or unit on it.
 */
const isFreeLand = (m, t) => {
  const type = typeAt(m, t);
  return (
    type &&
    !WATER.test(type) &&
    !BARREN.test(type) &&
    m.owners[t[1] * m.w + t[0]] === '.' &&
    !at(m.settlements, t) &&
    !at(m.units, t)
  );
};

/**
 * The ship's next step: the direction of free land beside it, or the first
 * step of the shortest route over explored, empty sea to a tile beside free
 * land, or failing that to the westmost explored sea, where more of the
 * map comes into sight. Null if the ship can go nowhere.
 */
function nextStep(m, ship) {
  const dirs = Object.keys(DIRECTIONS);
  const shore = dirs.find((d) => isFreeLand(m, neighbour(ship, d)));
  if (shore) return { dir: shore, shore: neighbour(ship, shore) };
  const first = new Map([[label(ship), null]]);
  const queue = [ship];
  let west = null;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (i > 0 && dirs.some((d) => isFreeLand(m, neighbour(t, d)))) return { dir: first.get(label(t)) };
    if (i > 0 && (!west || t[0] < west[0])) west = t;
    for (const d of dirs) {
      const n = neighbour(t, d);
      if (first.has(label(n)) || !WATER.test(typeAt(m, n) ?? '') || at(m.units, n) || at(m.settlements, n)) continue;
      first.set(label(n), first.get(label(t)) ?? d);
      queue.push(n);
    }
  }
  return west && { dir: first.get(label(west)) };
}

/** How long each screenshot of a dialog took, for the report. */
const shotTimes = [];
/** What the Europe panel showed when it was shot, as it was asked for by the Europe button. */
const europeSeen = [];

async function play(page, url) {
  // Keep every map view the client Engine sends (ui/src/channel.ts calls
  // fcClientEvent for each), and count them.
  await page.addInitScript(() => {
    let inner;
    window.__maps = 0;
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f) => {
        inner = (name, detail) => {
          if (name === 'map' || name === 'gameStarted') {
            window.__map = JSON.parse(detail);
            window.__maps++;
          }
          return f(name, detail);
        };
      },
    });
  });
  /** The Europe panel, as the page draws it: its headings, its lists, its goods and its gold. */
  const europePanel = () =>
    page.evaluate(async () => {
      const d = document.querySelector('[role=dialog][data-kind=europe]');
      if (!d) return null;
      // The panel's lists are opened by its buttons, and are counted in the dialog the script is shooting:
      // the script closes it once shot.
      const shop = async (kind, what) => {
        d.querySelector(`button[data-europe=${kind}]`)?.click();
        await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 50)));
        return [...d.querySelectorAll(`[data-shop=${kind}] ${what}`)];
      };
      const recruits = (await shop('recruit', '[data-recruit]')).length;
      const trains = (await shop('train', '[data-offer]')).length;
      const buys = (await shop('purchase', '[data-offer] .price')).map((p) => p.textContent);
      d.querySelector('button[data-europe=purchase]')?.click();
      await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 50)));
      return (
        d && {
          recruits,
          trains,
          buys,
          sailDisabled: d.querySelector('button[data-europe=sail]')?.disabled === true,
          headings: [...d.querySelectorAll('h2, h3')].map((h) => h.textContent),
          lists: [...d.querySelectorAll('[data-list]')].map((l) => l.dataset.list),
          goods: d.querySelectorAll('[data-goods]').length,
          prices: [...d.querySelectorAll('.price')].map((p) => p.textContent),
          gold: Number(d.querySelector('[data-gold]')?.textContent),
        }
      );
    });
  // A dialog with images is shot once its images have loaded: the first three of each kind.
  const browserName = page.context().browser().browserType().name();
  // The dialog stays open while it is shot, which Firefox can take long over (on CI, longer than the 10 s
  // noDialog waits for a dialog to close), so noDialog waits for the shot to be done first.
  let shooting = 0;
  shotTimes.length = 0;
  await answerDialogs(page, async (kind, n) => {
    const t = Date.now();
    shooting++;
    try {
      if (kind === 'europe') europeSeen.push(await europePanel());
      await page.screenshot({ path: path.join(dist, `../.cache/play-${browserName}-${kind}-${n}.png`) });
      shotTimes.push(`${kind} ${n}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
    } catch (ex) {
      shotTimes.push(`${kind} ${n}: failed ${String(ex).split('\n')[0]}`);
    } finally {
      shooting--;
    }
  });

  const view = () => page.evaluate(() => window.__map);
  /**
   * Wait until no dialog is open, since an open one takes the keys and clicks. The 10 s count only the
   * time no shot is being taken.
   */
  const noDialog = async (what = 'a step') => {
    const open = () => page.evaluate(() => document.querySelector('[role=dialog]')?.dataset.kind ?? null);
    let idle = Date.now();
    for (let kind = await open(); kind; kind = await open()) {
      if (shooting > 0) idle = Date.now();
      if (Date.now() - idle > 10000) {
        const detail = await page.evaluate(
          () =>
            `${document.querySelector('[role=dialog]')?.textContent.slice(0, 80)}; answered: ${window.__dialogs.slice(-3).join(' | ')}`,
        );
        throw new Error(
          `a ${kind} dialog stayed open for 10 s before ${what}: ${detail}; screenshots ${shooting > 0 ? 'still being taken' : 'done'}: ${shotTimes.join(' | ')}`,
        );
      }
      await new Promise((ok) => setTimeout(ok, 50));
    }
  };
  /** Do something that ends with a new map view, and return that view. */
  const act = async (doIt) => {
    await noDialog('a command');
    const n = await page.evaluate(() => window.__maps);
    await doIt();
    await page.waitForFunction((n) => window.__maps > n, n, { timeout: 60000 });
    return view();
  };
  const endTurn = async () => {
    const turn = (await view()).turn;
    await noDialog('ending the turn');
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 120000 });
    return view();
  };
  /**
   * Pick a thing up in the colony panel: the panel is shown afresh as each change reaches the client, so a
   * click can land as it is redrawn; a pick is clicked again until it shows picked.
   */
  const pickUp = async (thing, what) => {
    for (let i = 0; i < 5; i++) {
      await thing.click();
      if ((await thing.getAttribute('data-picked')) === 'true') return;
      await page.waitForTimeout(300);
    }
    throw new Error(`a click did not pick ${what}`);
  };
  /**
   * Wait for a dialog in the log, which grows as the page answers the dialogs: the entries after the
   * count are the ones that came since. Throws with them when the dialog does not come. The dialog is
   * named by the start of its entry, e.g. "amount: ", for a page function cannot be given a function
   * to match with.
   */
  const waitForDialog = async (logged, prefix, what, timeout = 10000) => {
    const got = await page
      .waitForFunction(([n, p]) => (window.__dialogs ?? []).slice(n).some((d) => d.startsWith(p)), [logged, prefix], {
        timeout,
      })
      .then(() => true)
      .catch((ex) => {
        // Only a timeout means the dialog did not come; anything else is a fault in the page.
        if (ex instanceof Error && /timeout/i.test(ex.message)) return false;
        throw ex;
      });
    if (got) return;
    const seen = await page.evaluate((n) => (window.__dialogs ?? []).slice(n), logged);
    throw new Error(`${what}: ${JSON.stringify(seen)}`);
  };
  /**
   * Open the colony's panel and move colonists in it as a player would: the founder is dragged to a building,
   * clicked back to its tile, given other work, and a colonist outside is put to work and out again, and a building is queued. After each
   * move the panel must show the colonist in its new place, and the net production must have changed.
   */
  const moveColonists = async (m, land, founder) => {
    await noDialog('opening the colony panel');
    await page.evaluate(() => (window.__hold = 'colony'));
    await act(() => click(m, land));
    const panel = page.locator('[role=dialog][data-kind=colony]');
    await panel.waitFor({ timeout: 10000 });
    const net = () => panel.locator('[data-part=net]').innerText();
    const unit = (id) => panel.locator(`[data-unit="${id}"]`).first();
    const within = (place, id, timeout = 20000) => place.locator(`[data-unit="${id}"]`).waitFor({ timeout });
    const changed = async (than, what) => {
      await page
        .waitForFunction((old) => document.querySelector('[data-part=net]')?.innerText !== old, than, {
          timeout: 20000,
        })
        .catch(() => {
          throw new Error(`the net production did not change after ${what}`);
        });
      return net();
    };
    const tileId = await unit(founder).evaluate((e) => e.closest('[data-tile]')?.dataset.tile ?? null);
    if (!tileId) throw new Error(`the founder ${founder} does not start on a tile of the colony panel`);
    const tile = panel.locator(`[data-tile="${tileId}"]`);
    const hall = panel.locator('[data-building]').first();
    const onTile = await net();

    // A right-click on the founder opens its quick action menu, with places to work; Escape closes the menu
    // and leaves the colony panel open.
    await unit(founder).click({ button: 'right' });
    const popup = page.locator('.popup[role=menu]');
    await popup.waitFor({ timeout: 10000 });
    if ((await popup.locator('[data-entry^="work:"]').count()) === 0) {
      throw new Error(`the founder's quick action menu has no place to work: ${await popup.innerText()}`);
    }
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'detached', timeout: 5000 });
    if ((await panel.count()) !== 1) throw new Error('Escape closed the colony panel with the menu');

    // Drag the founder from its tile into a building.
    await unit(founder).dragTo(hall);
    await within(hall, founder);
    const inHall = await changed(onTile, 'the founder was dragged into a building');
    if ((await tile.locator(`[data-unit="${founder}"]`).count()) > 0) {
      throw new Error('the founder is on its tile and in the building');
    }

    // Click it, then its tile: back to work there.
    await unit(founder).click();
    if ((await unit(founder).getAttribute('data-picked')) !== 'true')
      throw new Error('a click did not pick the founder');
    await tile.locator('.hit').click();
    await within(tile, founder);
    await changed(inHall, 'the founder was clicked back to its tile');

    // Change what it makes, when the tile offers another.
    await unit(founder).click();
    const others = panel.locator('[data-part=work] button[aria-pressed=false]');
    if ((await others.count()) > 0) {
      const goods = await others.first().getAttribute('data-goods');
      await others.first().click();
      await panel
        .locator(`[data-part=work] button[data-goods="${goods}"][aria-pressed=true]`)
        .waitFor({ timeout: 20000 });
      // The tile makes it now. (The net production would do, but it moves twice when a colonist returns to work.)
      await tile
        .locator(`[data-goods="${goods}"]`)
        .waitFor({ timeout: 20000 })
        .catch(() => {
          throw new Error(`the tile did not show ${goods} after the founder was set to make it`);
        });
    }
    await unit(founder).click();

    // A colonist outside the colony goes to work, and out again.
    const outside = panel.locator('[data-part=outside]');
    const waiting = await outside.locator('[data-unit]').evaluateAll((es) => es.map((e) => e.dataset.unit));
    const before = await net();
    // Not every unit left on the colony's tile can work in a building (a soldier cannot): the first that can does.
    let other = null;
    for (const id of waiting) {
      // The units outside are at the foot of a panel taller than the window, so this goes by clicks, not a drag.
      await unit(id).click();
      await hall.click();
      if (
        await within(hall, id, 8000).then(
          () => true,
          () => false,
        )
      ) {
        other = id;
        break;
      }
    }
    if (other === null) throw new Error(`no colonist outside could be put to work in a building: ${waiting}`);
    await changed(before, 'a colonist outside was put to work in a building');
    await unit(other).click();
    await outside.click();
    await within(outside, other);

    // A colonist cannot work on a tile another colonist works: the Engine explains it, and the
    // explanation shows over the colony panel, as Swing's does, with the colony panel on screen again
    // once it is closed. A panel queued behind the colony panel would show only after the player closed
    // it, so the log must have the explanation while the panel is still open.
    const logged = await page.evaluate(() => window.__dialogs.length);
    await pickUp(unit(other), other);
    await tile.locator('.hit').click();
    await waitForDialog(logged, 'information: ', 'the refusal was not explained over the colony panel');
    await panel.waitFor({ timeout: 10000 });
    await unit(other).click();

    // Queue a building the colony can build, from the build queue; the panel must list it as queued. (What
    // the server's colony does with the queue, and paying for it, are CommandsTest's to check.)
    await panel.locator('[data-part=queue] button.toggle').click();
    const addable = panel.locator('[data-part=buildings] [data-buildable] button:not([disabled])');
    if ((await addable.count()) > 0) {
      const type = await addable.first().evaluate((e) => e.closest('[data-buildable]').dataset.buildable);
      await addable.first().click();
      await panel
        .locator(`[data-part=queued] [data-queued="${type}"]`)
        .waitFor({ timeout: 20000 })
        .catch(() => {
          throw new Error(`the build queue did not show ${type} after it was added`);
        });
    }
    await page.evaluate(() => (window.__hold = null));
    await panel.locator('[data-answer=close]').click();
    await noDialog('closing the colony panel');
    console.log(`  colony panel: moved ${founder} and ${other}`);
  };
  /**
   * Sail the ship from the sea into the colony and load it in the colony panel as a player would: a unit
   * beside the colony boards it and goes ashore again, and goods of the warehouse, picked with shift so the
   * select amount dialog asks how much (the answerer keeps the amount it suggests), go aboard and come back.
   * Next turn the ship sails back out to sea. What the server does with the cargo is CommandsTest's to check.
   */
  const loadShip = async (m, land, sea) => {
    m = await act(() => click(m, sea));
    if (!same(m.active, sea)) throw new Error(`clicking ${label(sea)} selected ${label(m.active)}`);
    const shipId = m.activeUnit.id;
    const dirs = Object.keys(DIRECTIONS);
    const into = dirs.find((d) => same(neighbour(sea, d), land));
    const out = dirs.find((d) => same(neighbour(land, d), sea));
    m = await act(() => page.keyboard.press(KEYS[into]));
    // The map names the unit in front on a tile only, so the ship is found gone from the sea.
    if (m.units.some((u) => u.id === shipId)) {
      throw new Error(`the ship ${shipId} did not sail into the colony at ${label(land)}`);
    }

    await noDialog('opening the colony panel to load the ship');
    await page.evaluate(() => (window.__hold = 'colony'));
    await act(() => click(m, land));
    const panel = page.locator('[role=dialog][data-kind=colony]');
    await panel.waitFor({ timeout: 10000 });
    const cargo = panel.locator(`[data-part=cargo][data-ship="${shipId}"]`);
    await cargo.waitFor({ timeout: 10000 }).catch(() => {
      throw new Error(`the colony panel does not show the cargo of the ship ${shipId}`);
    });
    const outside = panel.locator('[data-part=outside]');
    const warehouse = panel.locator('[data-part=warehouse]');

    // The Engine runs the commands one at a time, so a put waits for its command's closing map before
    // the next one goes.
    const putOn = async (place, what) => {
      const n = await page.evaluate(() => window.__maps);
      for (let i = 0; i < 5; i++) {
        await place.click();
        if ((await panel.locator('[data-picked=true]').count()) === 0) {
          await page.waitForFunction((n) => window.__maps > n, n, { timeout: 60000 });
          return;
        }
        await page.waitForTimeout(300);
      }
      throw new Error(`a click did not put ${what} down`);
    };
    /**
     * Drag a unit and goods of the warehouse onto the ship's cargo in one turn, as a player in a hurry
     * does: the second command comes while the first runs, so the Engine must queue it rather than lose
     * it (#98). The drags are dispatched together, so that both commands reach the Engine before either
     * of them has run.
     */
    const dropBoth = async (unitId, goodsType, shipId) => {
      await page.evaluate(
        ([unit, goods, ship]) => {
          // The panel reads the shift key as the thing is pressed, and shift as it is dragged.
          const press = (el, shift) =>
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: shift }));
          const drag = (el, shift) =>
            el.dispatchEvent(
              new DragEvent('dragstart', {
                bubbles: true,
                cancelable: true,
                shiftKey: shift,
                dataTransfer: new DataTransfer(),
              }),
            );
          const drop = (el) =>
            el.dispatchEvent(
              new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }),
            );
          const one = document.querySelector(`[data-part=outside] [data-unit="${unit}"]`);
          const two = document.querySelector(`[data-part=warehouse] [data-goods="${goods}"]`);
          const place = document.querySelector(`[data-part=cargo][data-ship="${ship}"]`);
          if (!one || !two || !place) throw new Error('the colony panel does not show what to drop');
          press(one, false);
          drag(one, false);
          drop(place);
          press(two, true);
          drag(two, true);
          drop(place);
        },
        [unitId, goodsType, shipId],
      );
    };

    // A unit beside the colony and goods of the warehouse go aboard in one turn, and both must land: the
    // second command comes while the first runs. The goods are shift-picked, so the amount is asked.
    // The warehouse lists goods from the display threshold up, which can be none at all.
    const passenger = await outside.locator('[data-unit]').first().getAttribute('data-unit');
    if (!passenger) throw new Error('no unit beside the colony to board the ship');
    const goods = await warehouse
      .locator('[data-goods]')
      .evaluateAll((es) => es.find((e) => Number(e.querySelector('.amount')?.textContent) > 0)?.dataset.goods ?? null);
    if (!goods) throw new Error('the colony has no goods in its warehouse to load');
    const before = await page.evaluate(() => window.__dialogs.length);
    await dropBoth(passenger, goods, shipId);
    await cargo
      .locator(`[data-unit="${passenger}"]`)
      .waitFor({ timeout: 20000 })
      .catch(() => {
        throw new Error(`the unit ${passenger} did not board the ship`);
      });
    await cargo
      .locator(`[data-goods="${goods}"]`)
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {
        throw new Error(`the ship did not take ${goods} aboard`);
      });
    await waitForDialog(before, 'amount: ', 'loading with shift did not ask the amount');
    // The passenger goes ashore again.
    await pickUp(cargo.locator(`[data-unit="${passenger}"]`), passenger);
    await putOn(outside, passenger);
    await outside
      .locator(`[data-unit="${passenger}"]`)
      .waitFor({ timeout: 20000 })
      .catch(() => {
        throw new Error(`the unit ${passenger} did not leave the ship`);
      });
    // The goods come ashore again.
    await pickUp(cargo.locator(`[data-goods="${goods}"]`).first(), goods);
    await putOn(warehouse, goods);
    await page
      .waitForFunction(
        ([ship]) => !document.querySelector(`[data-part=cargo][data-ship="${ship}"] [data-goods]`),
        [shipId],
        { timeout: 20000 },
      )
      .catch(() => {
        throw new Error(`the ship did not unload ${goods}`);
      });
    // The warehouse button opens the warehouse dialog: an export level set there is there when it is reopened.
    const warehouseDialog = page.locator('[role=dialog][data-kind=warehouse]');
    const exportLevel = warehouseDialog.locator('fieldset input[aria-label$=" export"]').first();
    for (const level of ['37', '38']) {
      await warehouse.locator('button.settings').click();
      await warehouseDialog.waitFor({ timeout: 10000 });
      if (level === '38' && (await exportLevel.inputValue()) !== '37') {
        throw new Error('the warehouse dialog did not keep the export level set before');
      }
      await exportLevel.fill(level);
      await warehouseDialog.locator('[data-answer=ok]').click();
      await warehouseDialog.waitFor({ state: 'detached', timeout: 10000 });
    }
    console.log('  colony panel: the warehouse dialog sets an export level');
    await page.evaluate(() => (window.__hold = null));
    await panel.locator('[data-answer=close]').click();
    await noDialog('closing the colony panel after loading the ship');

    // Back to sea, next turn: the panel's commands leave no unit active, and a new turn chooses one, from
    // which the ship is reached as the next unit with moves left.
    m = await endTurn();
    for (let i = 0; i < 8 && m.activeUnit?.id !== shipId; i++) m = await act(() => page.keyboard.press('w'));
    if (m.activeUnit?.id !== shipId) {
      throw new Error(
        `the ship ${shipId} could not be selected in the colony: active ${m.activeUnit?.id} at ${label(m.active)}`,
      );
    }
    m = await act(() => page.keyboard.press(KEYS[out]));
    if (!same(m.active, sea)) throw new Error(`the ship did not sail back to ${label(sea)}: at ${label(m.active)}`);
    console.log(`  colony panel: ${passenger} boarded the ship and left it, ${goods} loaded and unloaded`);
    return m;
  };
  const viewState = () => page.evaluate(() => window.fcView());
  /** The view is on the client's active unit: the cursor on its tile, in view, and the panel naming it. */
  const following = async (m, what) => {
    const v = await viewState();
    if (!m.activeUnit || v.active?.unit !== m.activeUnit.id || !same(v.cursor?.at, m.active)) {
      throw new Error(
        `${what}: the view's active unit ${JSON.stringify(v.active)} is not the client's ${m.activeUnit?.id} at ${label(m.active)}`,
      );
    }
    // The view's own geometry (tileOnScreen in ui/src/view.ts, unit-tested
    // there) places the cursor; clicks through fcReveal rely on the same maths.
    const [px, py] = v.cursorOnScreen;
    if (px < 0 || py < 0 || px > v.viewport[0] || py > v.viewport[1]) {
      throw new Error(`${what}: the active unit at ${label(m.active)} is out of view`);
    }
    // React renders the panel a moment after the view changes.
    const shows = (label) => document.querySelector('#info')?.textContent.startsWith(label);
    if (!(await page.waitForFunction(shows, m.activeUnit.label, { timeout: 5000 }).catch(() => false))) {
      const info = await page.locator('#info').textContent();
      throw new Error(`${what}: the panel shows ${JSON.stringify(info)}`);
    }
  };
  /**
   * The menu bar must span the top of the map, and the map canvas fill the window below it up to the side
   * panel, which must reach the window's right edge.
   */
  const laidOut = async (what) => {
    // These run in the page, so neither can call the other.
    const boxes = () => {
      const c = document.querySelector('#map canvas').getBoundingClientRect();
      const s = document.querySelector('#side').getBoundingClientRect();
      const m = document.querySelector('.menubar').getBoundingClientRect();
      return {
        menubar: [m.left, m.right, m.top, m.bottom],
        canvas: [c.left, c.right, c.top, c.bottom],
        side: [s.left, s.right],
        window: [innerWidth, innerHeight],
      };
    };
    const fills = () => {
      const c = document.querySelector('#map canvas').getBoundingClientRect();
      const s = document.querySelector('#side').getBoundingClientRect();
      const m = document.querySelector('.menubar').getBoundingClientRect();
      const bar = m.top === 0 && m.height > 0 && m.left === 0 && m.right === c.right;
      return (
        bar &&
        c.left === 0 &&
        c.right <= s.left &&
        s.right === innerWidth &&
        c.top === m.bottom &&
        c.bottom === innerHeight
      );
    };
    if (!(await page.waitForFunction(fills, null, { timeout: 5000 }).catch(() => false))) {
      const got = await page.evaluate(boxes);
      throw new Error(`${what}: the map and the side panel do not fill the window: ${JSON.stringify(got)}`);
    }
  };
  /** Widen the side panel: the map must make room for it, and fill the window again once it narrows. */
  const widenSide = async () => {
    const style = await page.addStyleTag({ content: '#side { width: 600px; }' });
    await laidOut('with a wider side panel');
    await style.evaluate((s) => s.remove());
    await laidOut('with the side panel back');
  };
  /** Shrink the window: the map canvas and the view's viewport must shrink with it. */
  const resize = async () => {
    await laidOut('before a resize');
    const before = (await viewState()).viewport;
    const [dw, dh] = [300, 200];
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width - dw, height: size.height - dh });
    const want = [before[0] - dw, before[1] - dh];
    // These run in the page, so neither can call the other.
    const canvasSize = () => {
      const c = document.querySelector('#map canvas');
      return [c?.width, c?.height];
    };
    // The canvas's CSS box is the viewport's size, in CSS pixels, and its
    // backing store is that many device pixels: the map is drawn at the
    // screen's pixel ratio.
    const fits = ([w, h]) => {
      const c = document.querySelector('#map canvas');
      const [vw, vh] = window.fcView().viewport;
      const r = window.devicePixelRatio || 1;
      const box = c?.getBoundingClientRect();
      return (
        box?.width === w &&
        box.height === h &&
        c.width === Math.round(w * r) &&
        c.height === Math.round(h * r) &&
        vw === w &&
        vh === h
      );
    };
    if (!(await page.waitForFunction(fits, want, { timeout: 5000 }).catch(() => false))) {
      const got = await page.evaluate(canvasSize);
      const view = (await viewState()).viewport;
      throw new Error(
        `after a resize the canvas is ${JSON.stringify(got)}, the view ${JSON.stringify(view)}, not ${JSON.stringify(want)}`,
      );
    }
    await laidOut('after a resize');
  };
  /** Zoom with the wheel, drag the map and rest the pointer at its right edge; each must move the view. */
  const zoomAndScroll = async () => {
    await noDialog('zooming');
    const box = await page.locator('#map canvas').boundingBox();
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const before = await viewState();
    await page.mouse.move(cx, cy);
    // mouse.wheel does not wait for the page to handle the event (Firefox
    // may be late), so wait for the zoom to change.
    await page.mouse.wheel(0, -100);
    await page.waitForFunction((z) => window.fcView().zoom > z, before.zoom, { timeout: 5000 }).catch(() => {});
    const zoomed = await viewState();
    if (zoomed.zoom <= before.zoom) throw new Error(`the wheel did not zoom in: ${before.zoom} -> ${zoomed.zoom}`);
    // Drag the map right, so it has room to scroll back at the right edge.
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 100, { steps: 5 });
    await page.mouse.up();
    const dragged = await viewState();
    if (same(dragged.centre, zoomed.centre)) throw new Error('a drag did not scroll the map');
    // The right edge, which only the current viewport's width finds after a resize.
    await page.mouse.move(box.x + box.width - 4, cy);
    await page.waitForTimeout(800);
    await page.mouse.move(cx, cy);
    if (same((await viewState()).centre, dragged.centre)) {
      throw new Error('resting the pointer at the right edge did not scroll the map');
    }
    await page.mouse.wheel(0, 100);
  };
  const click = async (m, [x, y]) => {
    const box = await page.locator('#map canvas').boundingBox();
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py);
  };

  /** A right-click on our colony's tile opens the tile popup with the colony in it; a click elsewhere closes it. */
  const tilePopup = async (m, [x, y]) => {
    const box = await page.locator('#map canvas').boundingBox();
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py, { button: 'right' });
    const popup = page.locator('.popup[role=menu]');
    await popup.waitFor({ timeout: 10000 });
    if ((await popup.locator('[data-entry^="colony:"]').count()) === 0) {
      throw new Error(`the tile popup of the colony has no colony entry: ${await popup.innerText()}`);
    }
    await page.mouse.click(box.x + 5, box.y + box.height - 5);
    await popup.waitFor({ state: 'detached', timeout: 5000 });
    console.log('  tile popup: right-click opens the colony tile menu, a click elsewhere closes it');
  };

  await page.goto(url);
  await waitForResult(page, 120000);
  let m = await view();
  if (!m.ourTurn) throw new Error('not our turn at the start');
  await following(m, 'at the start');
  await resize();
  await widenSide();
  await zoomAndScroll();

  // Sail toward land until it is beside the ship, then move onto it to land.
  let land = null;
  for (let turns = 0; !land;) {
    const step = m.active && nextStep(m, m.active);
    if (!step) {
      if (++turns > MAX_TURNS) throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(m.active)}`);
      m = await endTurn();
      continue;
    }
    const ship = m.active;
    m = await act(() => page.keyboard.press(KEYS[step.dir]));
    if (m.activeUnit) await following(m, 'after a move');
    if (step.shore && at(m.units, step.shore)) land = step.shore;
    else if (same(m.active, ship)) {
      // The ship could not move: out of moves or blocked.
      if (++turns > MAX_TURNS) throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(ship)}`);
      m = await endTurn();
    }
  }

  // The ship is the active unit while it sails: remember where it is, to
  // select it and fortify it later.
  const shipTile = m.active;

  // The landed units have no moves left: next turn, select one and build.
  m = await endTurn();
  m = await act(() => click(m, land));
  if (!same(m.active, land)) throw new Error(`clicking ${label(land)} selected ${label(m.active)}`);
  await following(m, 'after selecting a unit');
  const founder = m.activeUnit.id;
  m = await act(() => page.keyboard.press('b'));
  if (!at(m.settlements, land)) throw new Error(`no colony at ${label(land)}`);
  // The controller opens the colony panel after founding, with the founder working in the colony.
  const panelShowsFounder = await page
    .waitForFunction(
      (id) => (window.__dialogUnits ?? []).some((d) => d.kind === 'colony' && d.units.includes(id)),
      founder,
      { timeout: 10000 },
    )
    .catch(() => false);
  if (!panelShowsFounder) {
    const seen = await page.evaluate(() => window.__dialogUnits);
    throw new Error(`the colony panel did not show the founder ${founder}: ${JSON.stringify(seen)}`);
  }
  await moveColonists(m, land, founder);
  await tilePopup(m, land);
  m = await endTurn();
  if (!at(m.settlements, land)) throw new Error(`the colony at ${label(land)} is gone after the AI turn`);

  // The Trade routes button asks the Engine for the panel, which the page shows (the dialog answerer
  // closes it). Making, changing and deleting routes is CommandsTest's and panels.test.tsx's to check.
  m = await act(() => page.click('button[data-command=tradeRoutes]'));
  const routesShown = await page
    .waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('tradeRoutes: ')), null, {
      timeout: 10000,
    })
    .catch(() => false);
  if (!routesShown) {
    throw new Error(
      `the trade routes panel did not open: ${JSON.stringify(await page.evaluate(() => window.__dialogs))}`,
    );
  }

  // The Report menu opens each report, as a player would: its window is the dialog the answerer then
  // closes. The colony report shows the colonists of our colony. Their figures are ReportsTest's to check.
  for (const [item, title] of [
    ['Colony report', 'Colony Advisor'],
    ['Labour report', 'Labor Advisor'],
    ['Compact labour report', 'Labor Advisor'],
    ['Military report', 'Military Advisor'],
    ['Naval report', 'Naval Advisor'],
    ['Cargo report', 'Cargo Report'],
    ['Education report', 'Education Report'],
    ['Exploration report', 'Exploration Report'],
    ['History report', 'History Report'],
    ['Production report', 'Production Report'],
    ['Religion report', 'Religious Advisor'],
    ['Requirements report', 'Requirements'],
    ['Trade report', 'Trade Advisor'],
  ]) {
    await noDialog(`opening the ${item}`);
    const logged = await page.evaluate(() => window.__dialogs.length);
    await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await waitForDialog(logged, `report: ${title}`, `the ${item} did not open`);
    if (item === 'Colony report') {
      const named = await page.evaluate(
        (id) => window.__dialogUnits.some((d) => d.kind === 'report' && d.units.includes(id)),
        founder,
      );
      if (!named) throw new Error(`the colony report does not show the founder ${founder}`);
    }
  }

  m = await loadShip(m, land, shipTile);

  // The ship is at sea again: select it and fortify it, as a player would.
  // The side panel's Fortify button follows the Engine's orders, and the
  // ship is drawn in grey once its turn has ended.
  m = await act(() => click(m, shipTile));
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship');
  const fortify = page.locator('button[data-command=fortify]');
  if (await fortify.isDisabled()) throw new Error('the ship cannot be fortified');
  m = await act(() => page.keyboard.press('f'));
  m = await endTurn();
  const ship = m.units.find((u) => u.x === shipTile[0] && u.y === shipTile[1]);
  if (!ship || ship.fg !== FORTIFIED) {
    throw new Error(`the ship at ${label(shipTile)} is not fortified: ${JSON.stringify(ship)}`);
  }

  // The Go To order, as GotoAction binds it: the player must be asked
  // where the ship sails. Where it goes is CommandsTest's to check. The ship
  // is the active unit again, as it was when it was fortified.
  m = await act(() => click(m, shipTile));
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship for the Go To order');
  await act(() => page.keyboard.press('h'));
  const asked = await page
    .waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('choice: Select destination')), null, {
      timeout: 10000,
    })
    .catch(() => false);
  if (!asked) {
    const dialogs = await page.evaluate(() => window.__dialogs);
    throw new Error(`the Go To order did not ask for a destination: ${JSON.stringify(dialogs)}`);
  }

  // The Europe button opens FreeCol's Europe panel: its headings and lists, and the market's goods with
  // each one's sell/buy price. The panel is read while it is shot, before the script closes it.
  await noDialog('pressing the Europe button');
  await page.locator('button[data-command=showEurope]').click();
  await page.waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('europe: ')), null, {
    timeout: 10000,
  });
  for (let i = 0; i < 200 && europeSeen.length === 0; i++) await new Promise((ok) => setTimeout(ok, 50));
  const europe = europeSeen[0];
  if (!europe) throw new Error('the Europe button showed no Europe panel with images to shoot');
  const lists = ['toAmerica', 'toEurope', 'inPort', 'docks', 'cargo', 'market'];
  if (!europe.headings[0] || europe.headings.length < 6 || !lists.every((l) => europe.lists.includes(l))) {
    throw new Error(`the Europe panel lacks FreeCol's headings or lists: ${JSON.stringify(europe)}`);
  }
  // The gold is not compared with the status line: a first contact's gift can come after its last map.
  // WebGUITest and SelectDestinationTest compare it with the model.
  if (europe.goods < 10 || !europe.prices.every((p) => /^\d+\/\d+$/.test(p)) || !(europe.gold >= 0)) {
    throw new Error(`the Europe panel's market or gold is wrong: ${JSON.stringify(europe)}`);
  }

  // The Recruit, Train and Purchase buttons list what Europe sells, with prices; the Set sail button needs
  // a ship in port, which this game does not have yet. SelectDestinationTest does the buying and sailing.
  if (
    europe.recruits !== 3 ||
    europe.trains < 1 ||
    europe.buys.length < 1 ||
    !europe.buys.every((p) => /\d/.test(p)) ||
    !europe.sailDisabled
  ) {
    throw new Error(`Europe's recruit, train or purchase list or its sail button is wrong: ${JSON.stringify(europe)}`);
  }

  // The Game menu's entries show the game's difficulty level and game options in the option editor, read-only.
  for (const [entry, kind] of [
    ['Show Difficulty Level', 'difficulty'],
    ['Show Game Options', 'game'],
  ]) {
    await noDialog(`the ${kind} options entry`);
    await page.evaluate(() => (window.__hold = 'options'));
    await page.getByRole('menuitem', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: entry }).click();
    await page.waitForSelector('[role=dialog][data-kind=options] [data-option]', { timeout: 10000 });
    const editor = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll('[role=dialog][data-kind=options] [data-option] :is(input, select)'),
      ];
      return { options: controls.length, editable: controls.filter((c) => !c.disabled).length };
    });
    if (editor.options < 10 || editor.editable > 0) {
      throw new Error(
        `the ${kind} options panel is not a read-only editor of the game's options: ${JSON.stringify(editor)}`,
      );
    }
    await page.evaluate(() => (window.__hold = null));
    await page.click('[role=dialog][data-kind=options] [data-answer=close]');
  }

  // The art the dialogs show, from events as the client Engine sends them (the page's fcShow): the
  // event panel's two flavour images, and a turn report with the image of each kind of object, and
  // its group by option and buttons. The real game gives few of these in its first turns.
  const show = async (kind, event) => {
    await noDialog(`showing the ${kind} event`);
    const before = await page.evaluate(() => window.__pictures.length);
    await page.evaluate(([k, json]) => window.fcShow(k, json), [kind, JSON.stringify(event)]);
    await page
      .waitForFunction((n) => window.__pictures.length > n, before, { timeout: 10000 })
      .catch(async () => {
        throw new Error(
          `no dialog with images came for the ${kind} event within 10 s; the page shows ${await page.evaluate(
            () => document.querySelector('[role=dialog]')?.outerHTML.slice(0, 300) ?? 'no dialog',
          )}`,
        );
      });
    await noDialog(`the ${kind} event was answered`);
  };
  const ok = 'OK';
  await show('eventPanel', { header: 'Landfall', image: 'image.flavor.event.firstLanding', footer: null, ok });
  await show('eventPanel', { header: 'The Pacific', image: 'image.flavor.event.discoverPacific', footer: null, ok });
  const message = (text, type, images, more = {}) => ({
    text,
    type,
    source: null,
    tile: null,
    at: null,
    heading: null,
    images,
    filter: null,
    filterTip: null,
    ignored: false,
    ignoreTip: null,
    ...more,
  });
  const warehouse = {
    filter: true,
    filterTip: 'Do not display this type of message',
    ignoreTip: 'Ignore this message',
  };
  await show('messages', {
    title: 'Turn Report',
    ok,
    groupBy: {
      label: 'Group messages by',
      value: 0,
      choices: [
        { value: 0, text: 'Nothing' },
        { value: 1, text: 'Type' },
        { value: 2, text: 'Source' },
      ],
    },
    messages: [
      message('A free colonist is a unit.', 'DEFAULT', ['image.unit.model.unit.freeColonist']),
      message('The Dutch are a nation.', 'DEFAULT', ['image.miscicon.model.nation.dutch']),
      message('Food is goods.', 'WAREHOUSE_CAPACITY', ['image.icon.model.goods.food'], warehouse),
      message('A town hall is a building.', 'DEFAULT', ['image.buildingicon.model.building.townHall']),
      message('Plains are terrain.', 'DEFAULT', ['image.tile.model.tile.plains.center']),
      message('A colony is a settlement.', 'DEFAULT', [
        'image.tileitem.model.settlement.colony.small.dutch',
        'image.tileitem.model.settlement.colony.small',
      ]),
      message('Nothing to show.', 'DEFAULT', []),
    ],
  });
  return { land, turn: m.turn };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: scale });
  const errors = collectPageErrors(page);
  const t = Date.now();
  let result;
  try {
    result = await play(page, `${server.url}?skipstart${query ? `&${query}` : ''}`);
    await page.evaluate(([x, y]) => window.fcReveal(x, y), result.land);
    await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  } catch (ex) {
    result = { error: await diagnose(ex) };
  }
  await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  const log = await dialogLog(page).catch(() => ({ dialogs: [], texts: [], pictures: [], unasked: [] }));
  const { dialogs, pictures } = log;
  // The art of the dialogs must have loaded, and the first landing's event panel must have had its image.
  const broken = pictures.filter((p) => !p.loaded);
  if (!result.error && broken.length > 0) result = { error: `dialog images did not load: ${JSON.stringify(broken)}` };
  if (!result.error && !pictures.some((p) => p.kind === 'eventPanel' && /landing/.test(p.src))) {
    result = { error: `the first landing's event panel showed no image: ${JSON.stringify(pictures)}` };
  }
  // The panel above is the one the script injects (kind eventPanel). The game's own is asked by the Engine
  // (kind event) when the new land is named, and closing it adds the build colony tutorial message.
  if (!result.error && !pictures.some((p) => p.kind === 'event' && /landing/.test(p.src))) {
    result = { error: `the Engine did not ask the first landing's event panel: ${dialogs.join(' | ')}` };
  }
  // The tutorial is a model message, shown by nextModelMessage with any others that are queued, so it may
  // be one of several in a messages dialog, not the first.
  const landing = log.texts.findIndex((d) => d.startsWith('event: '));
  if (!result.error && !log.texts.slice(landing + 1).some((d) => /^messages: .*Try building a Colony/.test(d))) {
    result = { error: `the build colony tutorial did not follow the first landing: ${log.texts.join(' | ')}` };
  }
  const { unasked } = log;
  await browser.close();
  failed ||= Boolean(result.error) || errors.length > 0 || unasked.length > 0;
  console.log(
    `${name} ${browser.version()}: ` +
      (result.error ? `failed: ${result.error}` : `colony at ${label(result.land)}, play back on turn ${result.turn}`) +
      `, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      `\n  dialogs: ${dialogs.join(' | ')}` +
      (shotTimes.length ? `\n  screenshots: ${shotTimes.join(' | ')}` : '') +
      `\n  images: ${pictures.map((p) => `${p.kind} ${p.src}`).join(' | ')}` +
      (unasked.length ? `\n  no dialog yet for: ${unasked.join(', ')}` : '') +
      (errors.length ? `\n  page errors: ${errors.join('; ')}` : ''),
  );
}
server.close();
process.exit(failed ? 1 : 0);
