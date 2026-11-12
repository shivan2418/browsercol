// The error dialog's log (FreeCol's ErrorPanel "Show log file"): what both Engines logged, in a window.
import { createContext } from 'react';
import { ButtonRow, WindowFrame } from './frame';
import type { GuiEvents } from './webgui';
import { useCoverage } from './coverage';
import './log.css';

/** Open the log: the error panel's "Show log file" button asks for it. */
export const ShowLogContext = createContext<() => void>(() => {});

/** Copy an error panel's details to the clipboard (error-details.ts): resolves true if it was copied. */
export const CopyDetailsContext = createContext<(e: GuiEvents['error']) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

/** The log as the dialog shows it: what the server Engine logged, then what the client Engine logged. */
export const joinLogs = (server: string, client: string) =>
  `Server Engine (Worker)\n${server || '(nothing logged)'}\n\nClient Engine (page)\n${client || '(nothing logged)'}`;

/** The window of the log, scrolled to its end, where the latest lines are. */
export function LogDialog({ text, close }: { text: string; close: () => void }) {
  useCoverage('showLogFilePanel');
  return (
    <div className="modal">
      <WindowFrame title="Log" close={close} id="log" className="dialog">
        <pre
          className="log-text"
          ref={(el) => {
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          {text}
        </pre>
        <ButtonRow>
          <button data-answer="close" onClick={close}>
            OK
          </button>
        </ButtonRow>
      </WindowFrame>
    </div>
  );
}
