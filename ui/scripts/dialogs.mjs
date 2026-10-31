// Answers the page's WebGUI dialogs (ui/src/panels.tsx) as they open, by
// clicking their buttons, as a player would: confirmations are accepted but
// sailing to Europe, a choice takes its last enabled item ("All" when
// disembarking), an input keeps its suggestion, an end turn dialog ends the turn, a negotiation is cancelled
// (sent, if it has no cancel) and a panel is closed. Each dialog is logged
// in window.__dialogs as "kind: first line".
// Call before page.goto; read the log with dialogLog(page).

export async function answerDialogs(page) {
  await page.addInitScript(() => {
    window.__dialogs = [];
    const answer = (d) => {
      const text = d.querySelector('.text, h2')?.textContent ?? '';
      window.__dialogs.push(`${d.dataset.kind}: ${text.split('\n')[0]}`);
      const pick = (selector) => d.querySelector(selector);
      const buttonFor = {
        confirm: () =>
          (!/Europe/.test(d.textContent ?? '') && pick('[data-answer=ok]')) || pick('[data-answer=cancel]'),
        choice: () => [...d.querySelectorAll('[data-choice]:not(:disabled)')].pop(),
        input: () => pick('[data-answer=ok]'),
        goods: () => pick('[data-answer=ok]'),
        endTurn: () => pick('[data-answer=ok]'),
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

/** The dialogs answered so far, and the WebGUI dialogs that had no Browser UI. */
export function dialogLog(page) {
  return page.evaluate(() => ({ dialogs: window.__dialogs ?? [], unasked: window.fcUnasked ?? [] }));
}
