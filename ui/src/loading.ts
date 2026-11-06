// The loading screen (#265): the markup and styles are in index.html, so it is up from the first paint,
// before any script has run. This file moves its bar and takes it down.
//
// The bar follows the parts a page load waits for. A part with a known size (a fetch with a
// Content-Length) fills the bar as its bytes come; any other part is one step, done when it ends.

/** A part of the page load: its label while it loads, and its share of the bar. */
export interface Part {
  label: string;
  weight: number;
}

/** What the bar counts, by the name each part is told by. */
export const PARTS = {
  data: { label: 'Loading the game data', weight: 1 },
  start: { label: 'Preparing the start screen', weight: 1 },
  engine: { label: 'Loading the game engine', weight: 6 },
  art: { label: 'Loading the art', weight: 1 },
  map: { label: 'Drawing the map', weight: 2 },
} as const satisfies Record<string, Part>;

export type PartName = keyof typeof PARTS;

/** How far each part has come, from 0 to 1, by name. */
export type Done = Partial<Record<PartName, number>>;

/** The share of the bar `parts` fill, from 0 to 1, given how far each has come. */
export function fraction(parts: readonly PartName[], done: Done): number {
  const total = parts.reduce((sum, p) => sum + PARTS[p].weight, 0);
  if (total === 0) return 1;
  return parts.reduce((sum, p) => sum + PARTS[p].weight * Math.min(1, Math.max(0, done[p] ?? 0)), 0) / total;
}

/** The label of the first of `parts` that is not done, or null when all are. */
export function pending(parts: readonly PartName[], done: Done): string | null {
  const p = parts.find((name) => (done[name] ?? 0) < 1);
  return p ? PARTS[p].label : null;
}

/** How long the screen takes to fade out; index.html's transition is as long. */
export const FADE_MS = 250;

export interface Loading {
  /** The page waits for `parts` now: show the screen, with the parts already done counted. */
  begin(parts: readonly PartName[]): void;
  /** `part` has loaded `loaded` of `total` bytes, or `total` is unknown (null) and it is one step. */
  progress(part: PartName, loaded: number, total: number | null): void;
  /** `part` has loaded. When the last part of the screen has, the screen fades out. */
  finish(part: PartName): void;
  /** The page waits for the player now (a window over the page): fade the screen out; begin() brings it back. */
  pause(): void;
  /** The page could not start: the screen stays and says so; `note` is a line of what went wrong. */
  fail(note: string): void;
}

/** The loading screen of `root` (#loading in index.html); every call is a no-op when the page has none. */
export function loading(root: HTMLElement | null = document.getElementById('loading')): Loading {
  const bar = root?.querySelector<HTMLElement>('[data-loading-bar]') ?? null;
  const label = root?.querySelector<HTMLElement>('[data-loading-label]') ?? null;
  const done: Done = {};
  let parts: readonly PartName[] = [];
  let failed = false;
  let hide: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    if (!root) return;
    const f = fraction(parts, done);
    bar?.style.setProperty('--loaded', `${Math.round(f * 100)}%`);
    root.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    if (label && !failed) label.textContent = pending(parts, done) ?? 'Ready';
  };
  /** Fade first, then hide: a hidden screen is out of the way of the page's clicks and of the scripts' waits. */
  const leave = () => {
    if (!root) return;
    root.dataset.state = 'leaving';
    hide = setTimeout(() => {
      root.dataset.state = 'done';
    }, FADE_MS);
  };
  const settle = () => {
    paint();
    // A part that finishes while the screen is not waiting for it (the engine, loaded early for the Colopedia) is not a reason to show it.
    if (!root || root.dataset.state !== 'loading' || parts.length === 0 || parts.some((p) => (done[p] ?? 0) < 1))
      return;
    leave();
  };

  return {
    begin(next) {
      clearTimeout(hide);
      parts = next;
      failed = false;
      if (root) root.dataset.state = 'loading';
      settle();
    },
    progress(part, loaded, total) {
      done[part] = total ? Math.min(0.99, loaded / total) : 0;
      paint();
    },
    finish(part) {
      done[part] = 1;
      settle();
    },
    pause() {
      if (root?.dataset.state === 'loading') leave();
    },
    fail(note) {
      if (!root || root.dataset.state === 'done') return;
      clearTimeout(hide);
      failed = true;
      root.dataset.state = 'failed';
      if (label) label.textContent = note;
    },
  };
}
