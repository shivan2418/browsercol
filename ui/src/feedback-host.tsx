// Where the Send feedback window lives (#369): its own root, so the error banner, the Game menu, the start
// screen and the Beta tag can all open it, before a game exists or after a crash has taken the page's other
// roots down. main.tsx says where the errors, the log and the save come from (setFeedbackSources).
import { OfflineIndicator } from './offline-indicator';
import { createRoot, type Root } from 'react-dom/client';
import { BUILD } from './build';
import { currentSave } from './current-save';
import { errorEntry, FEEDBACK_URL, sendReport, type Facts, type Kind } from './feedback';
import { BetaTag, FeedbackDialog } from './feedback-dialog';
import type { GameError } from './errors';
import { download } from './save-files';

/** What the page can attach, from the page: the errors the banner lists and the Engines' log. */
export interface FeedbackSources {
  errors: () => readonly GameError[];
  /** Both Engines' log tails, as the Log window shows them. */
  logs: () => Promise<string>;
}

let sources: FeedbackSources = { errors: () => [], logs: () => Promise.resolve('') };
let root: Root | null = null;
/** The dialog's kind while it is open, and a count that makes each opening a fresh window. */
let open: { kind: Kind; n: number } | null = null;
let opened = 0;

/** Where the errors and the log come from. */
export function setFeedbackSources(next: FeedbackSources): void {
  sources = next;
}

/** Whether the window is open: keys typed in it are not the game's. */
export const feedbackOpen = () => open !== null;

/** What the window attaches, gathered as it opens: no game, no save. */
async function collect(): Promise<Facts> {
  const [logs, save] = await Promise.all([sources.logs(), currentSave().catch(() => null)]);
  return { errors: sources.errors().map(errorEntry), logs, version: BUILD, browser: navigator.userAgent, save };
}

function render() {
  if (!root) {
    const host = document.createElement('div');
    host.id = 'feedback-host';
    document.body.append(host);
    root = createRoot(host);
  }
  root.render(
    <>
      {!open && <BetaTag open={() => openFeedback('bug')} />}
      {!open && <OfflineIndicator corner />}
      {open && (
        <FeedbackDialog
          key={open.n}
          kind={open.kind}
          load={collect}
          send={FEEDBACK_URL ? (report) => sendReport(FEEDBACK_URL, report) : null}
          download={download}
          close={() => {
            open = null;
            render();
          }}
        />
      )}
    </>,
  );
}

/** Open the window as `kind`: a bug unless the tester says otherwise, and a bug starts with everything attached. */
export function openFeedback(kind: Kind): void {
  open = { kind, n: ++opened };
  render();
}

/** Show the Beta tag, and make the window ready to open. Once, as the page loads. */
export function startFeedback(): void {
  render();
}
