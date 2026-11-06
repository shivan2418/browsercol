// The error panel's "Copy details": a text for a bug report with what the player saw, what the server said, the
// request that was refused, where the game was, and the end of the Engines' log.
import type { GuiEvents } from './webgui';

/** The lines of each Engine's log that go in the details. */
export const LOG_LINES = 50;

/** What the page knows about itself, as the details list it. */
export interface PageFacts {
  build: string;
  userAgent: string;
  /** The Engines' log, as joinLogs makes it: the server Engine's, then the client Engine's. */
  log: { server: string; client: string };
}

/** The last `n` lines of a log. */
export const lastLines = (text: string, n = LOG_LINES) => text.split('\n').slice(-n).join('\n');

/** The text to copy for an error panel's event. */
export function errorDetails(e: GuiEvents['error'], page: PageFacts): string {
  const lines = [`Message: ${e.text}`];
  if (e.detail) lines.push(`Server detail: ${e.detail}`);
  if (e.request) lines.push(`Last request sent to the server: ${e.request}`);
  if (e.turn) lines.push(`Turn: ${e.turn}`);
  if (e.player) lines.push(`Player: ${e.player}`);
  lines.push(`Build: ${page.build}`, `Browser: ${page.userAgent}`);
  lines.push(
    '',
    `Server Engine log (last ${LOG_LINES} lines)`,
    lastLines(page.log.server) || '(nothing logged)',
    '',
    `Client Engine log (last ${LOG_LINES} lines)`,
    lastLines(page.log.client) || '(nothing logged)',
  );
  return lines.join('\n');
}

/**
 * Put text on the clipboard: the async API when the page has it, else a selected textarea.
 * Resolves true if it was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, or the page is not focused: try the old way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
