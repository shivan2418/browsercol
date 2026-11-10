// Errors the player must see. A failure in either Engine, in the Worker or on the page used to show only in
// the console or the side panel's status, which may be hidden, and the game looked fine while it had stopped.
// The banner over the page lists them until the player dismisses it, each with its details to copy.
import { useState } from 'react';
import { ButtonRow } from './frame';

export interface GameError {
  /** What failed, for the player. */
  title: string;
  /** The stack trace or message, for a bug report. */
  detail: string;
  /** How many times it happened. */
  count: number;
}

/** The most errors kept: the first are the ones that matter, the rest repeat what broke. */
export const MAX_ERRORS = 20;

/** The errors with one more: the same error again counts once more; past MAX_ERRORS the oldest goes. */
export function addError(errors: readonly GameError[], title: string, detail: string): GameError[] {
  const i = errors.findIndex((e) => e.title === title && e.detail === detail);
  if (i >= 0) return errors.map((e, j) => (j === i ? { ...e, count: e.count + 1 } : e));
  return [...errors, { title, detail, count: 1 }].slice(-MAX_ERRORS);
}

/**
 * What an Engine event that reports a failure the game goes on after says, as an error; null for any other
 * event. A "failed" event, after which the game does not go on, the page shows itself.
 */
export function engineError(name: string, detail: string): { title: string; detail: string } | null {
  switch (name) {
    case 'error': {
      // "what failed\nstack trace" (Failures.report).
      const nl = detail.indexOf('\n');
      return nl < 0 ? { title: detail, detail: '' } : { title: detail.slice(0, nl), detail: detail.slice(nl + 1) };
    }
    case 'commandFailed': {
      // "command: stack trace" (ClientMain.command).
      const colon = detail.indexOf(':');
      if (colon < 0) return { title: 'A command failed', detail };
      return { title: `The ${detail.slice(0, colon)} command failed`, detail: detail.slice(colon + 1).trim() };
    }
    case 'saveFailed':
      return { title: 'The game could not be saved', detail };
  }
  return null;
}

/** The text of the errors, for a bug report. */
export const errorText = (errors: readonly GameError[]) =>
  errors.map((e) => `${e.title}${e.count > 1 ? ` (${e.count} times)` : ''}\n${e.detail}`).join('\n\n');

/** The banner over the page while there are errors; nothing when there are none. */
export function ErrorBanner({
  errors,
  dismiss,
  showLog,
}: {
  errors: readonly GameError[];
  dismiss: () => void;
  /** Open the Engines' log (FreeCol's error panel has "Show log file"). */
  showLog?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (errors.length === 0) return null;
  const copy = () => {
    void navigator.clipboard
      ?.writeText(errorText(errors))
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <div role="alert" className="error-banner">
      <h2>Something went wrong</h2>
      <p>The game may not work properly from here. Save if you can, then reload the page.</p>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>
            <b>{e.title}</b>
            {e.count > 1 && <span className="count"> ({e.count} times)</span>}
            {e.detail && (
              <details>
                <summary>Details</summary>
                <pre>{e.detail}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <ButtonRow space="flush">
        <button onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
        {showLog && <button onClick={showLog}>Show log</button>}
        <button onClick={() => location.reload()}>Reload</button>
        <button onClick={dismiss}>Dismiss</button>
      </ButtonRow>
    </div>
  );
}
