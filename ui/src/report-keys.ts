// The reports' hotkeys. FreeCol puts them on F keys (F1 religion, F2 labour, ...), which a browser keeps
// for itself (help, find, reload), so here each is Shift with the F key. FreeCol's own Shift+F reports
// would then meet the report on the plain key, so they take Ctrl+Shift+F. A key is written as the menu
// shows it: "Shift+F3", "Ctrl+Shift+F1".
import { REPORTS } from './reports';
import type { ReportName } from './webgui';

/** The text of a key press in the form REPORTS writes it, or null for a key that is not an F key. */
export function keyText(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): string | null {
  if (!/^F([1-9]|1[0-2])$/.test(e.code) || e.altKey || e.metaKey) return null;
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}

/** The report a key press opens, if it is one's hotkey. */
export function reportForKey(
  e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>,
): ReportName | null {
  const text = keyText(e);
  return (text && REPORTS.find((r) => r.key === text)?.name) || null;
}
