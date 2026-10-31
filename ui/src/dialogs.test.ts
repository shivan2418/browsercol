import { describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';

const confirm = { text: 'Disband?', ok: 'Yes', cancel: 'No', defaultOk: false, tile: null, object: null, header: null };
const error = { text: 'Oops', ok: 'OK' };

describe('dialogs', () => {
  it('shows one dialog at a time, in the order they came', async () => {
    const d = dialogs();
    let changes = 0;
    d.subscribe(() => changes++);

    const answer = d.ask('confirm', confirm);
    d.show('error', error);
    const first = d.current()!;
    expect(first.kind).toBe('confirm');
    if (first.kind !== 'confirm') return;
    expect(first.ask).toEqual(confirm);

    first.done(true);
    expect(await answer).toBe(true);
    const second = d.current()!;
    expect(second.kind).toBe('error');
    if (second.kind !== 'error') return;
    expect(second.event).toEqual(error);

    second.done();
    expect(d.current()).toBeNull();
    expect(changes, 'two added, two closed').toBe(4);
  });

  it('replaces a panel with another of its kind, in its place', () => {
    const d = dialogs();
    const messages = (title: string | null) => ({ title, messages: [], ok: 'OK' });
    void d.ask('confirm', confirm);
    d.show('messages', messages('Report'));
    d.show('messages', messages(null));
    const open = d.current()!;

    d.replace('messages', { ...messages('Report'), regrouped: true }, (was) => was.title === 'Report');
    expect(d.current(), 'the open dialog stays the open one').toBe(open);
    if (open.kind !== 'confirm') throw new Error(open.kind);
    open.done(true);
    const next = d.current()!;
    expect(next.id, 'a new dialog, so that its panel starts afresh').not.toBe(open.id + 1);
    if (next.kind !== 'messages') throw new Error(next.kind);
    expect(next.event.regrouped, 'the report, regrouped, came where the report was').toBe(true);
    next.done();
    const last = d.current()!;
    if (last.kind !== 'messages') throw new Error(last.kind);
    expect(last.event.title, 'the other messages are still there').toBeNull();

    d.replace('messages', messages('Later'), (was) => was.title === 'Report');
    last.done();
    expect(d.current(), 'with nothing to replace, it is queued').not.toBeNull();
  });

  it('takes only the first answer to a dialog', async () => {
    const d = dialogs();
    const answer = d.ask('choice', { text: 'Pick', cancel: null, tile: null, object: null, choices: [] });
    const open = d.current()!;
    d.show('error', error);
    if (open.kind !== 'choice') throw new Error(open.kind);
    open.done(0);
    open.done(1);
    expect(await answer).toBe(0);
    expect(d.current()?.kind, 'the second answer does not close the next dialog').toBe('error');
  });

  it('stops telling an unsubscribed listener', () => {
    const d = dialogs();
    let changes = 0;
    const off = d.subscribe(() => changes++);
    off();
    d.show('error', error);
    expect(changes).toBe(0);
  });
});
