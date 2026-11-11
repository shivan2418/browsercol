// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { zipEntry } from './fsg';
import { REFERENCE_PATTERN, type Facts, type Report, type Sent } from './feedback';
import { FeedbackDialog, type FeedbackDialogProps } from './feedback-dialog';

afterEach(cleanup);

const facts: Facts = {
  errors: ['Ending turn 3\ntrace'],
  logs: 'Server Engine\nline one\nline two',
  version: 'build 12 · abc1234',
  browser: 'Firefox',
  save: new Uint8Array(2048),
};

/** The window with a relay (unless `send` is null) and a recorded download. */
function open(over: Partial<FeedbackDialogProps> & { facts?: Facts } = {}) {
  const sent: Report[] = [];
  const files: { bytes: Uint8Array; name: string }[] = [];
  const props: FeedbackDialogProps = {
    kind: 'bug',
    load: () => Promise.resolve(over.facts ?? facts),
    send: (report) => {
      sent.push(report);
      return Promise.resolve<Sent>({ ok: true, reference: 'R-ABCD2' });
    },
    download: (bytes, name) => files.push({ bytes, name }),
    close: () => {},
    ...over,
  };
  render(<FeedbackDialog {...props} />);
  return { sent, files };
}
const q = (selector: string) => document.querySelector(selector) as HTMLInputElement;
const type = (selector: string, value: string) => fireEvent.change(q(selector), { target: { value } });
const attach = (name: string) => q(`[data-feedback-attach="${name}"]`);
const ticked = () => ['errors', 'logs', 'version', 'browser', 'save'].filter((n) => attach(n).checked);
const loaded = () => waitFor(() => expect(attach('logs').disabled).toBe(false));
const fillIn = () => {
  type('[data-feedback-title]', 'The colony vanished');
  type('[data-feedback-description]', 'It was gone.');
};

describe('the Send feedback window', () => {
  it('opens as a bug with every attachment ticked, and says what it keeps private', async () => {
    open();
    await loaded();
    expect(q('[data-feedback-kind="bug"]').checked).toBe(true);
    expect(ticked()).toEqual(['errors', 'logs', 'version', 'browser', 'save']);
    expect(document.body.textContent).toContain(
      'Reports go privately to the developer; nothing is published without review.',
    );
    expect(document.body.textContent).toContain('Mention your reference to have your report deleted.');
  });

  it('opened as an idea, ticks only the version and the browser, and a kind picked later resets the ticks', async () => {
    open({ kind: 'idea' });
    await loaded();
    expect(ticked()).toEqual(['version', 'browser']);
    fireEvent.click(q('[data-feedback-kind="bug"]'));
    expect(ticked()).toEqual(['errors', 'logs', 'version', 'browser', 'save']);
    fireEvent.click(attach('logs'));
    fireEvent.click(q('[data-feedback-kind="other"]'));
    expect(ticked()).toEqual(['errors', 'version', 'browser', 'save']);
  });

  it('ticks for the kind picked before the log and the save arrived', async () => {
    let arrive: (f: Facts) => void = () => {};
    open({ load: () => new Promise((done) => (arrive = done)) });
    fireEvent.click(q('[data-feedback-kind="idea"]'));
    arrive(facts);
    await loaded();
    expect(ticked()).toEqual(['version', 'browser']);
  });

  it('shows what will be sent: the text, the log in a collapsible view, the save size', async () => {
    open();
    await loaded();
    fillIn();
    const preview = q('[data-feedback-preview]');
    expect(preview.textContent).toContain('The colony vanished');
    expect(preview.textContent).toContain('It was gone.');
    expect(preview.querySelector('details pre[data-feedback-logs]')?.textContent).toBe(facts.logs);
    expect(q('[data-feedback-save-size]').textContent).toBe('A save of 2 KB');
    fireEvent.click(attach('save'));
    expect(q('[data-feedback-save-size]').textContent).toBe('No save');
    fireEvent.click(attach('logs'));
    expect(preview.querySelector('[data-feedback-logs]')).toBeNull();
  });

  it('has no save to attach when no game is running, and no errors when none were listed', async () => {
    open({ facts: { ...facts, errors: [], save: null } });
    await loaded();
    expect(attach('save').disabled).toBe(true);
    expect(attach('errors').disabled).toBe(true);
    expect(ticked()).toEqual(['logs', 'version', 'browser']);
  });

  it('needs a title and a description before it sends or downloads', async () => {
    open();
    await loaded();
    expect(q('[data-feedback-send]').disabled).toBe(true);
    expect(q('[data-feedback-download]').disabled).toBe(true);
    type('[data-feedback-title]', 'A title');
    expect(q('[data-feedback-send]').disabled).toBe(true);
    type('[data-feedback-description]', 'Words');
    expect(q('[data-feedback-send]').disabled).toBe(false);
  });

  it('sends the report to the relay and shows the reference it answers with', async () => {
    const { sent } = open();
    await loaded();
    fillIn();
    type('[data-feedback-contact]', 'u/tester');
    fireEvent.click(attach('errors'));
    fireEvent.click(q('[data-feedback-send]'));
    await waitFor(() => expect(q('[data-feedback-reference]').textContent).toBe('R-ABCD2'));
    expect(document.body.textContent).toContain('Thanks, report R-ABCD2 received');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'bug',
      title: 'The colony vanished',
      description: 'It was gone.',
      contact: 'u/tester',
      version: 'build 12 · abc1234',
      browser: 'Firefox',
      logs: facts.logs,
    });
    expect(sent[0]).not.toHaveProperty('errors');
    expect(sent[0].save).toHaveLength(Math.ceil(2048 / 3) * 4);
    expect(q('[data-feedback-copy]')).toBeTruthy();
  });

  it('offers the download, with the reason, when the relay does not take the report', async () => {
    open({ send: () => Promise.resolve({ ok: false, error: 'the relay answered 503' }) });
    await loaded();
    fillIn();
    fireEvent.click(q('[data-feedback-send]'));
    await waitFor(() => expect(q('[data-feedback-failed]')).toBeTruthy());
    expect(q('[data-feedback-failed]').textContent).toContain('the relay answered 503');
    expect(q('[data-feedback-download]').disabled).toBe(false);
  });

  it('has only the download in a build with no relay', async () => {
    const { files } = open({ send: null });
    await loaded();
    expect(document.querySelector('[data-feedback-send]')).toBeNull();
    fillIn();
    fireEvent.click(q('[data-feedback-download]'));
    expect(files).toHaveLength(1);
    const reference = q('[data-feedback-reference]').textContent!;
    expect(reference).toMatch(REFERENCE_PATTERN);
    expect(files[0].name).toBe(`${reference}.zip`);
    const report = JSON.parse(new TextDecoder().decode((await zipEntry(files[0].bytes, 'report.json'))!));
    expect(report).toMatchObject({ reference, kind: 'bug', title: 'The colony vanished', logs: true, saveBytes: 2048 });
    expect(await zipEntry(files[0].bytes, 'save.fsg')).toEqual(facts.save);
    expect(new TextDecoder().decode((await zipEntry(files[0].bytes, 'logs.txt'))!)).toBe(facts.logs);
  });
});
