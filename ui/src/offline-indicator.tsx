// The word on the offline copy (#296): "Saving for offline 45%", then "Ready offline", with a tooltip saying what it
// is; in the menu bar in a game, and in the start screen's corner under the Beta tag, as the copy is mostly saved
// while the player is there. Nothing shows without a worker (a dev server) or when the player turned it off.
import { useSyncExternalStore } from 'react';
import { Tip } from './controls';
import { describeOffline, offlineStatus } from './offline-status';
import './offline-indicator.css';

export function OfflineIndicator({ corner = false }: { corner?: boolean }) {
  const progress = useSyncExternalStore(offlineStatus.subscribe, offlineStatus.snapshot);
  const shown = describeOffline(progress);
  if (!shown) return null;
  return (
    <Tip
      as="span"
      className={corner ? 'offline-status corner' : 'offline-status'}
      data-offline={progress.state}
      tip={shown.tip}
    >
      {shown.label}
    </Tip>
  );
}
