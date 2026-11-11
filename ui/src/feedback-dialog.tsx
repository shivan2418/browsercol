// The Send feedback window for beta testers (#369): a kind, a title, a description, a contact, the attachments
// each with its checkbox, what will be sent laid out to read, and then Send (to the relay, where the build has
// one) or Download report (a .zip, always). Opened from the Game menu, the error banner's Report this and the
// Beta tag (feedback-host.tsx). Hooks for the browser scripts: [data-feedback] on the window,
// [data-feedback-kind=bug|idea|other], [data-feedback-title], [data-feedback-description], [data-feedback-contact],
// [data-feedback-attach=errors|logs|version|browser|save], [data-feedback-preview], [data-feedback-send],
// [data-feedback-download], [data-feedback-reference] and [data-feedback-copy] once the report is received.
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText } from './error-details';
import {
  BETA_TAG,
  KINDS,
  KIND_LABELS,
  LIMITS,
  bodyBytes,
  buildReport,
  defaultTicks,
  isComplete,
  newReference,
  reportZip,
  zipName,
  type Facts,
  type Form,
  type Kind,
  type Report,
  type Sent,
  type Ticks,
} from './feedback';
import './feedback.css';
import { ButtonRow, WindowFrame } from './frame';
import { useCoverage } from './coverage';

export interface FeedbackDialogProps {
  /** The kind it opens as: a bug from the error banner, other from the menu. */
  kind: Kind;
  /** Gathers what can be attached when the window opens. */
  load: () => Promise<Facts>;
  /** POST the report to the relay; null in a build with no relay, which leaves the download alone. */
  send: ((report: Report) => Promise<Sent>) | null;
  /** Hand a file to the browser as a download. */
  download: (bytes: Uint8Array, fileName: string) => void;
  close: () => void;
}

type Phase =
  | { k: 'form' }
  | { k: 'sending' }
  | { k: 'sent'; reference: string }
  | { k: 'failed'; error: string }
  | { k: 'downloaded'; reference: string };

const ATTACHMENTS = ['errors', 'logs', 'version', 'browser', 'save'] as const;

/** A size for people: "312 KB". */
export const sizeText = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length);

export function FeedbackDialog({ kind: firstKind, load, send, download, close }: FeedbackDialogProps) {
  useCoverage('showFeedbackDialog');
  const [form, setForm] = useState<Form>({ kind: firstKind, title: '', description: '', contact: '' });
  const [facts, setFacts] = useState<Facts | null>(null);
  const [ticks, setTicks] = useState<Ticks | null>(null);
  /** Whether the tester has ticked or unticked something: a kind picked after that leaves the ticks alone. */
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: 'form' });
  const [copied, setCopied] = useState(false);
  /** The kind now picked, for the ticks the log and the save arrive to: the tester may pick before they do. */
  const kindNow = useRef(firstKind);

  useEffect(() => {
    let live = true;
    void load().then((loaded) => {
      if (!live) return;
      setFacts(loaded);
      setTicks(defaultTicks(kindNow.current, loaded));
    });
    return () => {
      live = false;
    };
    // The window gathers once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickKind = (kind: Kind) => {
    kindNow.current = kind;
    setForm({ ...form, kind });
    if (facts && !touched) setTicks(defaultTicks(kind, facts));
  };
  const tick = (name: keyof Ticks, on: boolean) => {
    if (!ticks) return;
    setTouched(true);
    setTicks({ ...ticks, [name]: on });
  };

  // What is shown is the report without the save, which is only its size; the save joins when it is sent.
  const preview = useMemo(
    () => (facts && ticks ? buildReport(form, { ...ticks, save: false }, facts) : null),
    [form, facts, ticks],
  );
  const ready = facts !== null && ticks !== null && isComplete(form);
  const busy = phase.k === 'sending';

  const fullReport = (): Report => buildReport(form, ticks!, facts!);

  const sendNow = async () => {
    if (!send || !ready) return;
    setPhase({ k: 'sending' });
    const report = fullReport();
    if (bodyBytes(report) > LIMITS.body) {
      return setPhase({ k: 'failed', error: 'the report is too large for the relay; untick the game or the log' });
    }
    const sent = await send(report);
    setPhase(sent.ok ? { k: 'sent', reference: sent.reference } : { k: 'failed', error: sent.error });
  };

  const downloadNow = () => {
    if (!ready) return;
    const reference = newReference();
    download(reportZip(fullReport(), ticks!.save ? facts!.save : null, reference, new Date()), zipName(reference));
    setPhase({ k: 'downloaded', reference });
  };

  const copy = (reference: string) =>
    void copyText(reference).then((ok) => {
      if (ok) setCopied(true);
    });

  if (phase.k === 'sent' || phase.k === 'downloaded') {
    const { reference } = phase;
    return (
      <div className="modal">
        <WindowFrame title="Send feedback" close={close} id="feedback" className="dialog" data-feedback="">
          <div className="feedback-thanks">
            {phase.k === 'sent' ? (
              <p>
                Thanks, report{' '}
                <b className="feedback-reference" data-feedback-reference>
                  {reference}
                </b>{' '}
                received.
              </p>
            ) : (
              <p>
                The report is saved as <b data-feedback-file>{zipName(reference)}</b>, reference{' '}
                <b className="feedback-reference" data-feedback-reference>
                  {reference}
                </b>
                . Send that file to whoever asked for your feedback, and mention the reference.
              </p>
            )}
          </div>
          <ButtonRow>
            <button type="button" data-feedback-copy onClick={() => copy(reference)}>
              {copied ? 'Copied' : 'Copy reference'}
            </button>
            <button type="button" data-feedback-close autoFocus onClick={close}>
              Close
            </button>
          </ButtonRow>
        </WindowFrame>
      </div>
    );
  }

  const attachment = (name: (typeof ATTACHMENTS)[number], label: string, note: string, off?: boolean) => (
    <label className="feedback-attach" key={name}>
      <input
        type="checkbox"
        data-feedback-attach={name}
        checked={!!ticks?.[name] && !off}
        disabled={!ticks || off || busy}
        onChange={(e) => tick(name, e.target.checked)}
      />
      <span>
        {label}
        <span className="quiet feedback-note"> {note}</span>
      </span>
    </label>
  );

  return (
    <div className="modal">
      <WindowFrame title="Send feedback" close={close} id="feedback" className="dialog" data-feedback="">
        <form
          className="feedback-form"
          onSubmit={(e) => {
            e.preventDefault();
            void sendNow();
          }}
        >
          {/* The fields scroll where the screen is short; the buttons stay in sight under them. */}
          <div className="feedback-scroll">
            <div className="feedback-inputs">
              <fieldset className="feedback-kind" aria-label="Kind" disabled={busy}>
                {KINDS.map((k) => (
                  <label key={k}>
                    <input
                      type="radio"
                      name="feedback-kind"
                      value={k}
                      data-feedback-kind={k}
                      checked={form.kind === k}
                      onChange={() => pickKind(k)}
                    />
                    {KIND_LABELS[k]}
                  </label>
                ))}
              </fieldset>
              <label className="feedback-field">
                Title
                <input
                  data-feedback-title
                  value={form.title}
                  maxLength={LIMITS.title}
                  required
                  autoFocus
                  autoComplete="off"
                  disabled={busy}
                  placeholder={form.kind === 'idea' ? 'What would you like to see?' : 'In one line'}
                  onChange={(e) => setForm({ ...form, title: e.target.value.replace(/[\r\n]+/g, ' ') })}
                />
              </label>
              <label className="feedback-field">
                Description
                <textarea
                  data-feedback-description
                  value={form.description}
                  maxLength={LIMITS.description}
                  required
                  rows={3}
                  disabled={busy}
                  placeholder={
                    form.kind === 'bug'
                      ? 'What happened, and what did you expect? How can it be made to happen again?'
                      : ''
                  }
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label className="feedback-field">
                Contact (optional)
                <input
                  data-feedback-contact
                  value={form.contact}
                  maxLength={LIMITS.contact}
                  autoComplete="off"
                  disabled={busy}
                  placeholder="Reddit username or email, if we may ask you follow-up questions"
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                />
              </label>

              <fieldset className="feedback-attachments">
                <legend>Send along</legend>
                {attachment(
                  'errors',
                  'The errors the game listed',
                  facts ? `(${facts.errors.length})` : '',
                  !!facts && facts.errors.length === 0,
                )}
                {attachment('logs', 'The log of both Engines', facts ? `(${lineCount(facts.logs)} lines)` : '')}
                {attachment('version', 'The version', facts ? `(${facts.version})` : '')}
                {attachment('browser', 'Your browser', '')}
                {attachment(
                  'save',
                  'The game you are playing',
                  !facts ? '' : facts.save ? `(${sizeText(facts.save.length)})` : '(no game is running)',
                  !!facts && facts.save === null,
                )}
              </fieldset>
            </div>
            <section className="feedback-preview" aria-label="What will be sent" data-feedback-preview>
              <h3>What will be sent</h3>
              {!preview || !facts || !ticks ? (
                <p className="quiet">Collecting the log and the game…</p>
              ) : (
                <dl>
                  <dt>Kind</dt>
                  <dd>{KIND_LABELS[preview.kind]}</dd>
                  <dt>Title</dt>
                  <dd>{preview.title || <span className="quiet">(none yet)</span>}</dd>
                  <dt>Description</dt>
                  <dd className="feedback-text">{preview.description || <span className="quiet">(none yet)</span>}</dd>
                  {preview.contact !== undefined && (
                    <>
                      <dt>Contact</dt>
                      <dd>{preview.contact}</dd>
                    </>
                  )}
                  {preview.version !== undefined && (
                    <>
                      <dt>Version</dt>
                      <dd>{preview.version}</dd>
                    </>
                  )}
                  {preview.browser !== undefined && (
                    <>
                      <dt>Browser</dt>
                      <dd>{preview.browser}</dd>
                    </>
                  )}
                  {preview.errors !== undefined && (
                    <>
                      <dt>Errors</dt>
                      <dd>
                        <details>
                          <summary>
                            {preview.errors.length} {preview.errors.length === 1 ? 'error' : 'errors'}
                          </summary>
                          <pre>{preview.errors.join('\n\n')}</pre>
                        </details>
                      </dd>
                    </>
                  )}
                  {preview.logs !== undefined && (
                    <>
                      <dt>Log</dt>
                      <dd>
                        <details>
                          <summary>{lineCount(preview.logs)} lines</summary>
                          <pre data-feedback-logs>{preview.logs}</pre>
                        </details>
                      </dd>
                    </>
                  )}
                  <dt>Game</dt>
                  <dd data-feedback-save-size>
                    {ticks.save && facts.save ? `A save of ${sizeText(facts.save.length)}` : 'No save'}
                  </dd>
                </dl>
              )}
            </section>
          </div>
          <p className="quiet feedback-privacy">
            Reports go privately to the developer; nothing is published without review.
          </p>
          {phase.k === 'failed' && (
            <p role="alert" className="feedback-failed" data-feedback-failed>
              The report could not be sent: {phase.error}. Download it instead and send the file on.
            </p>
          )}
          <ButtonRow>
            <button type="button" data-feedback-cancel onClick={close}>
              Cancel
            </button>
            <button type="button" data-feedback-download disabled={!ready || busy} onClick={downloadNow}>
              Download report
            </button>
            {send && (
              <button type="submit" data-feedback-send disabled={!ready || busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            )}
          </ButtonRow>
        </form>
      </WindowFrame>
    </div>
  );
}

/** The small "Beta · Send feedback" tag in a corner of the start screen and the game view. */
export function BetaTag({ open }: { open: () => void }) {
  if (!BETA_TAG) return null;
  return (
    <button type="button" className="beta-tag" data-beta-tag data-flat="" onClick={open}>
      <b>Beta</b> · Send feedback
    </button>
  );
}
