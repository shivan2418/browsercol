// The error dialog's log (FreeCol's ErrorPanel "Show log file"): what both Engines logged, in a window.
import { createContext } from 'react';
import { WindowFrame } from './frame';

/** Open the log: the error panel's "Show log file" button asks for it. */
export const ShowLogContext = createContext<() => void>(() => {});

/** The log as the dialog shows it: what the server Engine logged, then what the client Engine logged. */
export const joinLogs = (server: string, client: string) =>
  `Server Engine (Worker)\n${server || '(nothing logged)'}\n\nClient Engine (page)\n${client || '(nothing logged)'}`;

/** The window of the log, scrolled to its end, where the latest lines are. */
export function LogDialog({ text, close }: { text: string; close: () => void }) {
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
        <div className="buttons">
          <button data-answer="close" onClick={close}>
            OK
          </button>
        </div>
      </WindowFrame>
    </div>
  );
}
