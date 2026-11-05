// What an Engine logged, kept for the error dialog's log (log.tsx). FreeCol writes its log to a file; in the
// browser each Engine logs to its own console (the server Engine in the Worker, the client Engine on the page),
// so each side keeps the last lines its console was given.

/** The most lines kept: the log is for the last things that happened before an error. */
export const MAX_LOG_LINES = 1000;

/** The console methods that carry a log: what FreeCol logs, and what the Engines print. */
const METHODS = ['debug', 'log', 'info', 'warn', 'error'] as const;

export interface LogBuffer {
  /** The kept lines, oldest first, one per line. */
  text(): string;
}

/** `value` as a console shows it: a string as it is, an error with its stack, anything else as JSON or text. */
function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Keep the last `max` lines that go to a console's methods, still passing them on. A message of several lines
 * counts as several, so a stack trace does not push out its neighbours as one entry.
 */
export function captureConsole(target: Pick<Console, (typeof METHODS)[number]>, max = MAX_LOG_LINES): LogBuffer {
  const lines: string[] = [];
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      const level = method === 'log' ? '' : `[${method}] `;
      for (const line of args.map(show).join(' ').split('\n')) lines.push(level + line);
      if (lines.length > max) lines.splice(0, lines.length - max);
      original(...args);
    };
  }
  return { text: () => lines.join('\n') };
}
