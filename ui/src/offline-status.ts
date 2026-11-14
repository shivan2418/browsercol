// The offline copy's progress (#296), as the menu bar shows it: the service worker saves the game in the browser at
// install, and tells the page how far it is (sw.template.js, 'offline-progress'). Without it a player could not tell
// when it is safe to go offline: the loading screen counts only what the game needs to start, not the copy.

/** 'off': the player turned it off. 'unavailable': no worker (a dev server, or not yet registered). */
export type OfflineState = 'off' | 'unavailable' | 'saving' | 'updating' | 'ready' | 'failed';

export interface OfflineProgress {
  state: OfflineState;
  bytes: number;
  totalBytes: number;
}

const UNAVAILABLE: OfflineProgress = { state: 'unavailable', bytes: 0, totalBytes: 0 };

/** What the status needs of the browser's worker container, so a test can stand in for it. */
export type OfflineContainer = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>;

export class OfflineStatus {
  progress: OfflineProgress = UNAVAILABLE;
  private listeners = new Set<() => void>();
  private attached = false;

  /** Follow the worker's messages. A page a worker already runs has the copy, as a worker takes over only then. */
  attach(container: OfflineContainer) {
    if (!this.attached) {
      this.attached = true;
      container.addEventListener('message', (e) => this.receive((e as MessageEvent).data, !!container.controller));
    }
    this.set(container.controller ? { ...this.progress, state: 'ready' } : { ...this.progress, state: 'unavailable' });
  }

  /** The player turned the offline copy off: it is gone, and nothing is saved. */
  off() {
    this.set({ state: 'off', bytes: 0, totalBytes: 0 });
  }

  /** Take a message from a worker; `controlled` is whether a worker already runs the page (a new build saving). */
  receive(data: unknown, controlled: boolean) {
    const m = data as { type?: string; state?: string; bytes?: number; totalBytes?: number };
    if (!m || m.type !== 'offline-progress' || this.progress.state === 'off') return;
    const bytes = m.bytes ?? 0;
    const totalBytes = m.totalBytes ?? 0;
    const state: OfflineState =
      m.state === 'saved'
        ? 'ready'
        : m.state === 'failed'
          ? controlled
            ? 'ready'
            : 'failed'
          : controlled
            ? 'updating'
            : 'saving';
    this.set({ state, bytes, totalBytes });
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  snapshot = () => this.progress;

  private set(p: OfflineProgress) {
    if (p.state === this.progress.state && p.bytes === this.progress.bytes && p.totalBytes === this.progress.totalBytes)
      return;
    this.progress = p;
    for (const l of this.listeners) l();
  }
}

/** The page's one: main.tsx attaches it, and the menu bar shows it. */
export const offlineStatus = new OfflineStatus();

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/** The menu bar's words for a state and its tooltip, or null when it shows nothing. */
export function describeOffline(p: OfflineProgress): { label: string; tip: string } | null {
  const percent = Math.floor((100 * p.bytes) / Math.max(p.totalBytes, 1));
  const size = p.totalBytes > 0 ? ` (${mb(p.totalBytes)})` : '';
  const off = 'Preferences > BrowserCol > Keep the game for offline play turns this off.';
  switch (p.state) {
    case 'saving':
      return {
        label: `Saving for offline ${percent}%`,
        tip: `Saving a copy of the game${size} in this browser, so it starts with no network. Stay online until it says Ready offline. ${off}`,
      };
    case 'updating':
      return {
        label: `Saving the new version ${percent}%`,
        tip: `A new version of the game is being saved for offline play${size}. Until it is in, the copy saved before still starts offline.`,
      };
    case 'ready':
      return {
        label: 'Ready offline',
        tip: `A copy of the game is saved in this browser: it starts with no network, installed or in a tab. ${off}`,
      };
    case 'failed':
      return {
        label: 'Offline copy failed',
        tip: 'A file of the game could not be downloaded for the offline copy. It is tried again the next time the game is opened online.',
      };
    default:
      return null;
  }
}
