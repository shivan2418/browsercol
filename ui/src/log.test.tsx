// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { LogDialog, joinLogs } from './log';
import { captureConsole } from './log-buffer';

afterEach(cleanup);

/** A console that keeps what it is given, for the buffer to pass on to. */
function fakeConsole() {
  const out: string[] = [];
  const method =
    (level: string) =>
    (...args: unknown[]) =>
      void out.push(`${level} ${args.join(' ')}`);
  return {
    out,
    console: {
      debug: method('debug'),
      log: method('log'),
      info: method('info'),
      warn: method('warn'),
      error: method('error'),
    },
  };
}

describe('captureConsole', () => {
  it('keeps what is logged with its level, and still passes it on', () => {
    const { out, console } = fakeConsole();
    const log = captureConsole(console);
    console.log('started');
    console.warn('careful', 3);
    console.error(new Error('boom'));
    const lines = log.text().split('\n');
    expect(lines[0]).toBe('started');
    expect(lines[1]).toBe('[warn] careful 3');
    expect(lines[2]).toMatch(/^\[error\] Error: boom/);
    expect(out.slice(0, 2)).toEqual(['log started', 'warn careful 3']);
  });

  it('counts each line of a message, and keeps the last ones', () => {
    const { console } = fakeConsole();
    const log = captureConsole(console, 3);
    console.log('a\nb');
    console.log('c\nd');
    expect(log.text()).toBe('b\nc\nd');
  });

  it('shows an object as JSON', () => {
    const { console } = fakeConsole();
    const log = captureConsole(console);
    console.info({ turn: 3 });
    expect(log.text()).toBe('[info] {"turn":3}');
  });
});

describe('the log window', () => {
  it('names the two Engines and says when one logged nothing', () => {
    expect(joinLogs('server line', '')).toBe(
      'Server Engine (Worker)\nserver line\n\nClient Engine (page)\n(nothing logged)',
    );
  });

  it('shows the text and closes', () => {
    let closed = false;
    render(<LogDialog text={joinLogs('a', 'b')} close={() => (closed = true)} />);
    expect(screen.getByRole('dialog').textContent).toContain('Client Engine (page)');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(closed).toBe(true);
  });
});
