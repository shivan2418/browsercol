// Answers the page's WebGUI dialogs (ui/src/panels.tsx) as they open, by
// clicking their buttons, as a player would: confirmations are accepted but
// sailing to Europe, a choice takes its last enabled item ("All" when
// disembarking), an input keeps its suggestion, a select amount dialog the amount selected, an end turn dialog ends the turn, a negotiation is cancelled
// (sent, if it has no cancel) and a panel is closed. Each dialog is logged
// in window.__dialogs as "kind: first line", and in window.__dialogTexts as "kind: every text of it"
// (a messages dialog holds several messages, of which the first line is only the first).
// A dialog with images is answered only once they have loaded or failed to,
// and they are logged in window.__pictures as {kind, src, loaded}. With a
// shot function (answerDialogs(page, shot)), the first three dialogs of each
// kind that has images are shown to it first, as shot(kind, n), e.g. to take
// a screenshot. With window.__shotPlain set, the dialogs with no images are shown too.
// A kind named by window.__hold (or several, separated by commas) is logged and shot, but left open for the script
// to use. A window of the page's own, which has no kind, is named by its id (preferences, log, credits).
// Call before page.goto; read the log with dialogLog(page).
import type { Page } from 'playwright-core';

export async function answerDialogs(
  page: Page,
  shot: ((kind: string | undefined, n: number) => unknown) | null = null,
) {
  // The page gets nothing back: a screenshot's Buffer, which page.screenshot resolves to, is sent to the page as a
  // JSON array of its bytes, and Firefox's page spent minutes (its main thread busy allocating) taking that in, with
  // the Engine's updates and so the preset's setup waiting behind it (#353).
  if (shot)
    await page.exposeFunction('__shot', async (kind: string | undefined, n: number) => {
      await shot(kind, n);
    });
  await page.addInitScript(() => {
    window.__dialogs = [];
    window.__dialogTexts = [];
    window.__pictures = [];
    /** The units each dialog names by id (data-unit), e.g. the colony panel's workers. */
    window.__dialogUnits = [];
    const shots: Record<string, number> = {};
    const loadedImages = async (d: HTMLElement) => {
      // Not a hidden template's (the colony's boxes size a row from a dragoon's picture, #454): nothing shows it.
      const imgs = [...d.querySelectorAll('img')].filter((img) => !img.closest('[aria-hidden=true]'));
      // Firefox once left the Europe panel open for good on a late-game turn, as if an image never loaded nor
      // failed: wait for the images at most five seconds, and say in the console which were not done.
      const loaded = await Promise.race([
        Promise.all(
          // A complete image is true, not a promise: Promise.all takes it as is.
          // oxlint-disable-next-line typescript/await-thenable
          imgs.map(
            (img) =>
              img.complete ||
              new Promise((ok) => {
                img.addEventListener('load', ok);
                img.addEventListener('error', ok);
              }),
          ),
        ).then(() => true),
        new Promise<boolean>((ok) => setTimeout(() => ok(false), 5000)),
      ]);
      if (!loaded) {
        const waiting = imgs.filter((img) => !img.complete).map((img) => img.getAttribute('src'));
        console.warn(`dialog ${d.dataset.kind ?? d.id}: images not loaded after 5 s: ${waiting.join(' ')}`);
      }
      return imgs;
    };
    const answer = async (d: HTMLElement) => {
      const kind = d.dataset.kind ?? d.id;
      const text = d.querySelector('.text, h2')?.textContent ?? '';
      window.__dialogs.push(`${kind}: ${text.split('\n')[0]}`);
      window.__dialogTexts.push(
        `${kind}: ${[...d.querySelectorAll('.text, h2')].map((e) => e.textContent).join(' / ')}`,
      );
      window.__dialogUnits.push({
        kind,
        units: [...d.querySelectorAll<HTMLElement>('[data-unit]')].map((e) => e.dataset.unit),
      });
      const imgs = await loadedImages(d);
      for (const img of imgs) {
        window.__pictures.push({ kind, src: img.getAttribute('src'), loaded: img.naturalWidth > 0 });
      }
      const n = (shots[kind] ?? 0) + 1;
      // A script that sets window.__shotPlain wants the dialogs with no pictures too (combat reports, say).
      if ((imgs.length > 0 || window.__shotPlain) && window.__shot && n <= 3) {
        shots[kind] = n;
        await window.__shot(kind, n);
      }
      // A script that works in a panel sets window.__hold to its kind, and closes it itself.
      if (window.__hold?.split(',').includes(kind)) return;
      const pick = (selector: string) => d.querySelector<HTMLElement>(selector);
      const buttonFor: Record<string, () => HTMLElement | null | undefined> = {
        // The Declaration closes on a click.
        declaration: () => d,
        confirm: () =>
          (!/Europe/.test(d.textContent ?? '') && pick('[data-answer=ok]')) || pick('[data-answer=cancel]'),
        choice: () => [...d.querySelectorAll<HTMLElement>('[data-choice]:not(:disabled)')].pop(),
        input: () => pick('[data-answer=ok]'),
        amount: () => pick('[data-answer=ok]'),
        goods: () => pick('[data-answer=ok]'),
        father: () => pick('[data-answer=ok]'),
        endTurn: () => pick('[data-answer=ok]'),
        preCombat: () => pick('[data-answer=ok]'),
        negotiation: () => pick('[data-answer=cancel]') || pick('[data-answer=send]'),
      };
      (buttonFor[kind] ?? (() => pick('[data-answer=close]')))()?.click();
    };
    const seen = new WeakSet();
    new MutationObserver(() => {
      for (const d of document.querySelectorAll<HTMLElement>('[role=dialog]')) {
        if (seen.has(d)) continue;
        seen.add(d);
        // After React has finished rendering it.
        setTimeout(() => answer(d), 0);
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** The dialogs answered so far, the images they showed, and the WebGUI dialogs that had no Browser UI. */
export function dialogLog(page: Page) {
  return page.evaluate(() => ({
    dialogs: window.__dialogs ?? [],
    texts: window.__dialogTexts ?? [],
    pictures: window.__pictures ?? [],
    unasked: window.fcUnasked ?? [],
  }));
}
