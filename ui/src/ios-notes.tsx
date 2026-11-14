// The two notes for iPhone and iPad in a Safari tab (ios-home-screen.ts): the warning where saves are made and
// listed, and the Home Screen hint on the start screen.
import { useState } from 'react';
import './ios-home-screen.css';
import {
  dismissHint,
  HOME_SCREEN_HINT,
  HOME_SCREEN_STEPS,
  isIosBrowserTab,
  SAVES_WARNING,
  showsHomeScreenHint,
  type IosEnv,
} from './ios-home-screen';

/** Saves may be deleted after a week away; null off an iPhone or iPad in a Safari tab. `env` is for tests. */
export function IosSavesWarning({ env }: { env?: IosEnv }) {
  if (!isIosBrowserTab(env)) return null;
  return (
    <p className="quiet" role="note" data-ios-saves-warning>
      {SAVES_WARNING}
    </p>
  );
}

/** Add to Home Screen, in words, until put away on this device. */
export function HomeScreenHint({ env }: { env?: IosEnv }) {
  const [shown, setShown] = useState(() => showsHomeScreenHint(env));
  if (!shown) return null;
  return (
    <div className="home-screen-hint" role="note" data-home-screen-hint>
      <p>
        <strong>{HOME_SCREEN_HINT}.</strong> {HOME_SCREEN_STEPS}
      </p>
      <button
        type="button"
        data-home-screen-dismiss
        onClick={() => {
          dismissHint();
          setShown(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
