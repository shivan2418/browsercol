// Answers the page's WebGUI dialogs (ui/src/panels.tsx) as they open, by
// clicking their buttons, as a player would: confirmations are accepted but
// sailing to Europe, a choice takes its last enabled item ("All" when
// disembarking), an input keeps its suggestion, an end turn dialog ends the turn, a negotiation is cancelled
// (sent, if it has no cancel) and a panel is closed. Each dialog is logged
// in window.__dialogs as "kind: first line".
// A dialog with images is answered only once they have loaded or failed to,
// and they are logged in window.__pictures as {kind, src, loaded}. With a
// shot function (answerDialogs(page, shot)), the first three dialogs of each
// kind that has images are shown to it first, as shot(kind, n), e.g. to take
// a screenshot.
// Call before page.goto; read the log with dialogLog(page).

export async function answerDialogs(page, shot = null) {
  if (shot) await page.exposeFunction('__shot', shot);
  await page.addInitScript(() => {
    window.__dialogs = [];
    window.__pictures = [];
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
      const imgs = await loadedImages(d);
      for (const img of imgs) {
        window.__pictures.push({ kind: d.dataset.kind, src: img.getAttribute('src'), loaded: img.naturalWidth > 0 });
      }
      const n = (shots[d.dataset.kind] ?? 0) + 1;
      if (imgs.length > 0 && window.__shot && n <= 3) {
        shots[d.dataset.kind] = n;
        await window.__shot(d.dataset.kind, n);
      }
      const pick = (selector) => d.querySelector(selector);
      const buttonFor = {
        confirm: () =>
          (!/Europe/.test(d.textContent ?? '') && pick('[data-answer=ok]')) || pick('[data-answer=cancel]'),
        choice: () => [...d.querySelectorAll('[data-choice]:not(:disabled)')].pop(),
        input: () => pick('[data-answer=ok]'),
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
    pictures: window.__pictures ?? [],
    unasked: window.fcUnasked ?? [],
  }));
}
