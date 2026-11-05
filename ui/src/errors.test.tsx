// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { ErrorBanner, MAX_ERRORS, addError, engineError, errorText } from './errors';

describe('addError', () => {
  it('counts the same error again rather than listing it twice', () => {
    const once = addError([], 'Ending turn 3', 'trace');
    expect(addError(once, 'Ending turn 3', 'trace')).toEqual([{ title: 'Ending turn 3', detail: 'trace', count: 2 }]);
    expect(addError(once, 'Ending turn 3', 'other')).toHaveLength(2);
  });
  it('keeps the newest errors past the most it keeps', () => {
    let errors = addError([], 'first', '');
    for (let i = 0; i < MAX_ERRORS; i++) errors = addError(errors, `e${i}`, '');
    expect(errors).toHaveLength(MAX_ERRORS);
    expect(errors[0].title).toBe('e0');
  });
});

describe('engineError', () => {
  it('reads what failed and its trace from an error event', () => {
    expect(engineError('error', 'client: handling update failed\njava.lang.NullPointerException\n\tat X')).toEqual({
      title: 'client: handling update failed',
      detail: 'java.lang.NullPointerException\n\tat X',
    });
  });
  it('names the command that failed', () => {
    expect(engineError('commandFailed', 'endTurn: java.lang.IllegalStateException: no')).toEqual({
      title: 'The endTurn command failed',
      detail: 'java.lang.IllegalStateException: no',
    });
  });
  it('reports a save that failed, and nothing for the other events', () => {
    expect(engineError('saveFailed', 'disk full')?.title).toBe('The game could not be saved');
    expect(engineError('map', '{}')).toBeNull();
    expect(engineError('saved', '{}')).toBeNull();
  });
});

describe('ErrorBanner', () => {
  afterEach(cleanup);
  it('shows nothing without errors', () => {
    const { container } = render(<ErrorBanner errors={[]} dismiss={() => {}} />);
    expect(container.textContent).toBe('');
  });
  it('lists the errors with their details until dismissed', () => {
    let dismissed = false;
    const errors = addError(addError([], 'Ending turn 3', 'trace'), 'Ending turn 3', 'trace');
    render(<ErrorBanner errors={errors} dismiss={() => (dismissed = true)} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Ending turn 3 (2 times)');
    expect(alert.querySelector('pre')?.textContent).toBe('trace');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissed).toBe(true);
  });
  it('opens the log from its button, when it can', () => {
    const errors = addError([], 'Ending turn 3', 'trace');
    const { rerender } = render(<ErrorBanner errors={errors} dismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Show log' })).toBeNull();
    let shown = 0;
    rerender(<ErrorBanner errors={errors} dismiss={() => {}} showLog={() => shown++} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show log' }));
    expect(shown).toBe(1);
  });
  it('gives the errors as text for a bug report', () => {
    expect(errorText(addError(addError([], 'a', 'x'), 'b', 'y'))).toBe('a\nx\n\nb\ny');
  });
});
