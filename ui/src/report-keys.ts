// The reports' hotkeys are FreeCol's own: the plain F key (F1 religion, F2 labour, ... F11 turn report,
// F12 requirements) and Shift+F1..F5 for cargo, exploration, history, production and education. A browser
// has its own use for most of these (F5 reload, F3 find, F1 help), so while a game runs the page takes
// them: a bound key always has its default prevented, whether or not the report can open then. A key is
// written as the menu shows it: "F3", "Shift+F1".
import { REPORTS, TURN_REPORT_KEY } from './reports';
import type { ReportName } from './webgui';

type KeyParts = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>;

/** The text of a key press in the form REPORTS writes it, or null for a key that is not an F key, or has Ctrl, Alt or Meta. */
export function keyText(e: KeyParts): string | null {
  if (!/^F([1-9]|1[0-2])$/.test(e.code) || e.ctrlKey || e.altKey || e.metaKey) return null;
  return `${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}

/** Whether a key press is the Turn Report's hotkey (ReportTurnAction). */
export const isTurnReportKey = (e: KeyParts): boolean => keyText(e) === TURN_REPORT_KEY;

/** The report a key press opens, if it is one's hotkey. */
export function reportForKey(e: KeyParts): ReportName | null {
  const text = keyText(e);
  return (text && REPORTS.find((r) => r.key === text)?.name) || null;
}

/**
 * Handle a key press for the report hotkeys while a game runs. A bound key always has its default
 * prevented (so F5 never reloads and F1 never opens help), even when a dialog or a text field means no
 * report opens. `canOpen` says whether a report may open now (no dialog but a report is up, and the key
 * is not typed into a text field); a held key (`repeat`) is swallowed and opens nothing.
 * Returns true when the key was a report key.
 */
export function handleReportKey(
  e: KeyParts & Pick<KeyboardEvent, 'repeat' | 'preventDefault'>,
  canOpen: boolean,
  open: (report: ReportName) => void,
  turn: () => void,
): boolean {
  const report = reportForKey(e);
  const isTurn = isTurnReportKey(e);
  if (!report && !isTurn) return false;
  e.preventDefault();
  if (!canOpen || e.repeat) return true;
  if (report) open(report);
  else turn();
  return true;
}
