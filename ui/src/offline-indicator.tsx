// The word on the offline copy (#296): "Saving for offline 45%", then "Ready offline", with a tooltip saying what it
// is; in the menu bar in a game, and in the start screen's corner under the Beta tag, as the copy is mostly saved
// while the player is there. The title screen draws it as a ring in its map's compass instead (OfflineRing). Nothing shows without a worker (a dev server) or when the player turned it off.
import { useSyncExternalStore } from 'react';
import { Tip } from './controls';
import { describeOffline, offlineStatus, type OfflineProgress } from './offline-status';
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

/** How much of the offline copy is saved, 0 to 1: all of it once ready, none of it when it failed. */
export function offlineFraction(p: OfflineProgress): number {
  if (p.state === 'ready') return 1;
  if (p.state !== 'saving' && p.state !== 'updating') return 0;
  return Math.min(1, p.bytes / Math.max(p.totalBytes, 1));
}

/** What the ring's mark says, first in its tooltip: the player sees a tick or a ring, not words. */
export function ringMeaning(state: OfflineProgress['state'], percent: number): string {
  switch (state) {
    case 'ready':
      return 'The tick: the game is ready to play offline.';
    case 'failed':
      return 'The cross: the offline copy could not be saved.';
    case 'updating':
      return `The ring: saving the new version for offline play, ${percent}% done.`;
    default:
      return `The ring: saving the game for offline play, ${percent}% done.`;
  }
}

/**
 * The offline copy on the title screen: a ring drawn in ink round the centre of the map's compass, filling as the
 * copy is saved with the percent inside it, then a tick once it is ready and a cross if it failed. The words are its
 * tooltip and its label.
 */
export function OfflineRing() {
  const progress = useSyncExternalStore(offlineStatus.subscribe, offlineStatus.snapshot);
  const shown = describeOffline(progress);
  if (!shown) return null;
  const percent = Math.round(100 * offlineFraction(progress));
  return (
    <Tip
      as="span"
      className="offline-ring"
      data-offline={progress.state}
      role="progressbar"
      aria-label={shown.label}
      aria-valuenow={percent}
      tip={`${ringMeaning(progress.state, percent)}\n${shown.tip}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="track" cx="50" cy="50" r="42" />
        <circle className="arc" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${percent} 100`} />
        {(progress.state === 'saving' || progress.state === 'updating') && (
          <text className="percent" x="50" y="50">
            {percent}%
          </text>
        )}
        {progress.state === 'ready' && <path className="mark" d="M33 51 L45 63 L68 38" />}
        {progress.state === 'failed' && <path className="mark" d="M36 36 L64 64 M64 36 L36 64" />}
      </svg>
    </Tip>
  );
}
