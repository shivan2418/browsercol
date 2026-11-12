// A notice for phones (#319): the game's panels, map and keyboard orders are made for a desktop browser, and
// it does not work on a touch screen yet. The notice says so once; a click on Continue puts it away for the tab.
//
// How a phone is told: the primary pointer is coarse (a finger), no pointer at all is fine (that would be a
// laptop with a touch screen, or a tablet with a mouse), and the shorter side of the page is under a tablet's.
// Neither check alone is robust: the width alone would catch a narrow desktop window, and `pointer: coarse`
// alone would catch a tablet or a touch laptop. The user-agent string is not read; it is easy to get wrong.

import './mobile-notice.css';

/** The shorter side of the page, in CSS pixels, from which a screen is a tablet's, not a phone's. */
export const PHONE_MAX_SHORT_SIDE = 600;

const KEY = 'browsercol.mobileNoticeDismissed';

export interface Env {
  matchMedia: (query: string) => { matches: boolean };
  innerWidth: number;
  innerHeight: number;
}

/** True on a touch-only screen too small for the game: a phone, in either orientation. */
export function isPhone(env: Env = window): boolean {
  const media = (q: string) => env.matchMedia(q).matches;
  return (
    media('(pointer: coarse)') &&
    !media('(any-pointer: fine)') &&
    Math.min(env.innerWidth, env.innerHeight) <= PHONE_MAX_SHORT_SIDE
  );
}

/** Show the notice over `doc` when `env` is a phone and the player has not put it away; returns it, or null. */
export function mobileNotice(
  doc: Document = document,
  env: Env = window,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(),
): HTMLElement | null {
  if (!isPhone(env) || read(storage)) return null;
  const root = doc.createElement('div');
  root.id = 'mobile-notice';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-labelledby', 'mobile-notice-title');
  root.setAttribute('aria-describedby', 'mobile-notice-text');
  const title = doc.createElement('h2');
  title.id = 'mobile-notice-title';
  title.textContent = 'Not made for phones yet';
  const text = doc.createElement('p');
  text.id = 'mobile-notice-text';
  text.textContent =
    'BrowserCol is not mobile-compatible yet: it needs a mouse and a keyboard, and a bigger screen. ' +
    'Please open it on a computer. You can carry on here, but it may not work.';
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.dismiss = '';
  button.textContent = 'Continue anyway';
  button.addEventListener('click', () => {
    root.remove();
    try {
      storage?.setItem(KEY, '1');
    } catch {
      // Storage may be blocked; the notice then comes back on the next load.
    }
  });
  root.append(title, text, button);
  doc.body.append(root);
  return root;
}

function read(storage: Pick<Storage, 'getItem'> | null) {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function safeSession() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
