import { describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';

const confirm = { text: 'Disband?', ok: 'Yes', cancel: 'No', defaultOk: false, tile: null, object: null };
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
