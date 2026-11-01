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
// a screenshot.
// A kind named by window.__hold is logged and shot, but left open for the script to use.
// Call before page.goto; read the log with dialogLog(page).

export async function answerDialogs(page, shot = null) {
  if (shot) await page.exposeFunction('__shot', shot);
  await page.addInitScript(() => {
    window.__dialogs = [];
    window.__dialogTexts = [];
    window.__pictures = [];
    /** The units each dialog names by id (data-unit), e.g. the colony panel's workers. */
    window.__dialogUnits = [];
    const shots = {};
    const loadedImages = async (d) => {
      const imgs = [...d.querySelectorAll('img')];
      await Promise.all(
        imgs.map(
          (img) =>
            img.complete ||
            new Promise((ok) => {
              img.addEventListener('load', ok);
              img.addEventListener('error', ok);
            }),
        ),
      );
      return imgs;
    };
    const answer = async (d) => {
      const text = d.querySelector('.text, h2')?.textContent ?? '';
      window.__dialogs.push(`${d.dataset.kind}: ${text.split('\n')[0]}`);
      window.__dialogTexts.push(
        `${d.dataset.kind}: ${[...d.querySelectorAll('.text, h2')].map((e) => e.textContent).join(' / ')}`,
      );
      window.__dialogUnits.push({
        kind: d.dataset.kind,
        units: [...d.querySelectorAll('[data-unit]')].map((e) => e.dataset.unit),
      });
      const imgs = await loadedImages(d);
      for (const img of imgs) {
        window.__pictures.push({ kind: d.dataset.kind, src: img.getAttribute('src'), loaded: img.naturalWidth > 0 });
      }
      const n = (shots[d.dataset.kind] ?? 0) + 1;
      if (imgs.length > 0 && window.__shot && n <= 3) {
        shots[d.dataset.kind] = n;
        await window.__shot(d.dataset.kind, n);
      }
      // A script that works in a panel sets window.__hold to its kind, and closes it itself.
      if (window.__hold === d.dataset.kind) return;
      const pick = (selector) => d.querySelector(selector);
      const buttonFor = {
        confirm: () =>
          (!/Europe/.test(d.textContent ?? '') && pick('[data-answer=ok]')) || pick('[data-answer=cancel]'),
        choice: () => [...d.querySelectorAll('[data-choice]:not(:disabled)')].pop(),
        input: () => pick('[data-answer=ok]'),
        amount: () => pick('[data-answer=ok]'),
        goods: () => pick('[data-answer=ok]'),
        endTurn: () => pick('[data-answer=ok]'),
        preCombat: () => pick('[data-answer=ok]'),
        negotiation: () => pick('[data-answer=cancel]') || pick('[data-answer=send]'),
      };
      (buttonFor[d.dataset.kind] ?? (() => pick('[data-answer=close]')))()?.click();
    };
    const seen = new WeakSet();
    new MutationObserver(() => {
      for (const d of document.querySelectorAll('[role=dialog]')) {
        if (seen.has(d)) continue;
        seen.add(d);
        // After React has finished rendering it.
        setTimeout(() => answer(d), 0);
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** The dialogs answered so far, the images they showed, and the WebGUI dialogs that had no Browser UI. */
export function dialogLog(page) {
  return page.evaluate(() => ({
    dialogs: window.__dialogs ?? [],
    texts: window.__dialogTexts ?? [],
    pictures: window.__pictures ?? [],
    unasked: window.fcUnasked ?? [],
  }));
}
