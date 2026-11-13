// The music and sounds for offline play (#505): the page's side of the service worker's audio download
// (ui/sw.template.js). The worker keeps what has played; this asks it to keep every file, on the player's say, and
// shows how far it is. Preferences' "Download music and sounds for offline" is this; the choice is a preference
// (prefs.offlineAudio), so a new build's fresh cache is filled again without asking.

/** Where the download is. 'unavailable': no worker controls the page (a dev server, or a first visit still installing). */
export type AudioStatus = 'unavailable' | 'idle' | 'working' | 'done';

export interface AudioState {
  status: AudioStatus;
  /** Files in the cache, of `total`. */
  done: number;
  total: number;
  /** Their size, of `totalBytes`. */
  bytes: number;
  totalBytes: number;
  /** Files the last download could not fetch. */
  failed: number;
}

const UNAVAILABLE: AudioState = { status: 'unavailable', done: 0, total: 0, bytes: 0, totalBytes: 0, failed: 0 };

/** What the page needs of the browser's service worker side, so a test can stand in for it. */
export interface AudioLink {
  container: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'> | undefined;
  /** True in a built site, where there is a worker. */
  production: boolean;
  /** Ask the browser to keep the site's storage; resolves whether it will. */
  persist: () => Promise<boolean>;
}

/** The state a worker's progress message says, or undefined for any other message. */
export function stateFrom(data: unknown): AudioState | undefined {
  const m = data as Partial<AudioState> & { type?: string; state?: AudioStatus };
  if (!m || m.type !== 'audio-progress' || !m.state) return undefined;
  return {
    status: m.state,
    done: m.done ?? 0,
    total: m.total ?? 0,
    bytes: m.bytes ?? 0,
    totalBytes: m.totalBytes ?? 0,
    failed: m.failed ?? 0,
  };
}

/** Megabytes as the control shows them: "93 MB", "0.4 MB". */
export const megabytes = (bytes: number): string => {
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
};

/** The line the control shows beside its button for a state. */
export function describe(s: AudioState): string {
  switch (s.status) {
    case 'unavailable':
      return 'Only in the installed or built site, once its worker has taken over.';
    case 'working':
      return `Downloading: ${s.done} of ${s.total} files, ${megabytes(s.bytes)} of ${megabytes(s.totalBytes)}.`;
    case 'done':
      return `Saved for offline, ${megabytes(s.bytes)}.`;
    case 'idle':
      if (s.failed > 0) return `${s.failed} of ${s.total} files could not be downloaded. Try again.`;
      return s.done > 0 ? `${s.done} of ${s.total} files saved so far.` : '';
  }
}

export class OfflineAudio {
  state: AudioState = UNAVAILABLE;
  private link: AudioLink | undefined;
  private wanted = false;
  private listeners = new Set<() => void>();

  /** Follow the worker: its progress, and the page being taken over by one. Call once, with the browser's side. */
  attach(link: AudioLink) {
    this.link = link;
    const { container } = link;
    if (!link.production || !container) return;
    container.addEventListener('message', (e) => this.receive((e as MessageEvent).data));
    // A first visit's worker takes the page over after the shell is in; a new build's does the same.
    container.addEventListener('controllerchange', () => this.sync());
    this.sync();
  }

  /**
   * The preference as it is: on, the worker fills the cache (a new build's fresh one too); off after on, it drops
   * what it kept. `optedIn` is the player's own change, not the page loading: only that asks for persistent storage.
   */
  want(on: boolean, optedIn = false) {
    const was = this.wanted;
    this.wanted = on;
    if (on && optedIn && !was) void this.link?.persist().catch(() => {});
    this.sync(was && !on);
  }

  /** Take a message from the worker. */
  receive(data: unknown) {
    const next = stateFrom(data);
    if (next) this.set(next);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  snapshot = () => this.state;

  /** Ask the worker for what the preference says, or for where it is. */
  private sync(drop = false) {
    const worker = this.link?.container?.controller;
    if (!this.link?.production || !worker) {
      this.set(UNAVAILABLE);
      return;
    }
    if (this.state.status === 'unavailable') this.set({ ...UNAVAILABLE, status: 'idle' });
    worker.postMessage({ type: drop ? 'drop-audio' : this.wanted ? 'cache-audio' : 'audio-status' });
  }

  private set(s: AudioState) {
    if (s === this.state) return;
    this.state = s;
    for (const l of this.listeners) l();
  }
}

/** The page's one: main.tsx attaches it, and the Preferences window shows it. */
export const offlineAudio = new OfflineAudio();

/** The browser's side: this page's worker container, and its storage's persistence. */
export function audioLink(): AudioLink {
  return {
    production: import.meta.env.PROD,
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    persist: async () => (await navigator.storage?.persist?.()) ?? false,
  };
}
