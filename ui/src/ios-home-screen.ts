// Saves on iPhone and iPad (#511). Safari can delete a site's storage, where the saves live (saves.ts), after
// seven days without a visit, unless the site was added to the Home Screen. `navigator.storage.persist()` does not
// reliably stop it, so a page in a Safari tab says so, and offers the Home Screen hint on the start screen.

const HINT_KEY = 'browsercol.homeScreenHintDismissed';

export interface IosEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Safari's own flag for a site opened from the Home Screen. */
  standalone?: boolean;
  matchMedia?: (query: string) => { matches: boolean };
}

/** The page's environment, for isIosBrowserTab. */
export function currentEnv(): IosEnv {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as { standalone?: boolean }).standalone,
    matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
  };
}

/** iPhone, iPod or iPad WebKit; iPadOS reports as a Mac, which has no touch screen, so Mac with touch points is an iPad. */
export function isIos(env: IosEnv): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

/** True when the page was opened from the Home Screen. */
export function isStandalone(env: IosEnv): boolean {
  return env.standalone === true || (env.matchMedia?.('(display-mode: standalone)').matches ?? false);
}

/** True on an iPhone or iPad in a Safari tab, where the browser may clear the saves; false on desktop, Android and an installed app. */
export function isIosBrowserTab(env: IosEnv = currentEnv()): boolean {
  return isIos(env) && !isStandalone(env);
}

export const SAVES_WARNING =
  'On this device the browser may delete saves after a week away, unless the game is added to the Home Screen. ' +
  'Save to a file to keep a game safe.';

export const HOME_SCREEN_HINT = 'Add to Home Screen to play full screen and keep your saves';

export const HOME_SCREEN_STEPS = 'Tap the Share button in Safari, then Add to Home Screen, then Add.';

type Storage_ = Pick<Storage, 'getItem' | 'setItem'> | null;

function localStore(): Storage_ {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the player has put the Home Screen hint away on this device. */
export function hintDismissed(storage: Storage_ = localStore()): boolean {
  try {
    return storage?.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the hint is put away; storage may be blocked, and the hint then comes back next visit. */
export function dismissHint(storage: Storage_ = localStore()): void {
  try {
    storage?.setItem(HINT_KEY, '1');
  } catch {
    // Blocked storage: the hint shows again next time.
  }
}

/** Whether the start screen shows the Home Screen hint. */
export function showsHomeScreenHint(env: IosEnv = currentEnv(), storage: Storage_ = localStore()): boolean {
  return isIosBrowserTab(env) && !hintDismissed(storage);
}
