/**
 * What FreeColProgressBar draws of a bar: the value, then the step (what the next turn adds) after it, each as a
 * percentage of the bar. Never past the maximum, whatever the numbers say: a value over the maximum fills the bar and
 * leaves no room for the step, a loss draws no step, and a maximum of 0 or less is full once the value reaches it
 * (and no step). The text beside the bar keeps the real numbers.
 */
export function barSegments(value: number, step: number, max: number): { now: number; next: number } {
  if (!Number.isFinite(value) || !Number.isFinite(step) || !Number.isFinite(max) || max <= 0) {
    return { now: Number.isFinite(value) && Number.isFinite(max) && value >= max ? 100 : 0, next: 0 };
  }
  const part = (n: number) => Math.min(100, Math.max(0, (100 * n) / max));
  const now = part(value);
  return { now, next: Math.min(100 - now, part(step)) };
}
