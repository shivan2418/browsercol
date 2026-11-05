// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { copyText, errorDetails, lastLines } from './error-details';

const page = {
  build: 'abc1234',
  userAgent: 'TestBrowser/1',
  log: { server: 's1\ns2', client: '' },
};

describe('errorDetails', () => {
  it('lists the message, what the server said, the request, the game and the log', () => {
    const text = errorDetails(
      {
        text: 'The server can not do that.',
        ok: 'OK',
        detail: 'Unit 5626 is not ours',
        request: '<move unit="unit:5626"/>',
        turn: '12 (Spring 1495)',
        player: 'Ana (player:19)',
      },
      page,
    );
    expect(text).toContain('Message: The server can not do that.');
    expect(text).toContain('Server detail: Unit 5626 is not ours');
    expect(text).toContain('Last request sent to the server: <move unit="unit:5626"/>');
    expect(text).toContain('Turn: 12 (Spring 1495)');
    expect(text).toContain('Player: Ana (player:19)');
    expect(text).toContain('Build: abc1234');
    expect(text).toContain('Browser: TestBrowser/1');
    expect(text).toContain('Server Engine log (last 50 lines)\ns1\ns2');
    expect(text).toContain('Client Engine log (last 50 lines)\n(nothing logged)');
  });
  it('leaves out what the Engine did not send', () => {
    const text = errorDetails({ text: 'Oops', ok: 'OK' }, page);
    expect(text).not.toContain('Server detail');
    expect(text).not.toContain('Last request');
    expect(text).not.toContain('Turn:');
  });
});

describe('lastLines', () => {
  it('keeps the end', () => {
    expect(lastLines('a\nb\nc\nd', 2)).toBe('c\nd');
  });
});

describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hi')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hi');
  });
  it('falls back to a selected textarea when there is no clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    expect(await copyText('hi')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
