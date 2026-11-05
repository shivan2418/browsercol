// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isIdle, NEW_TURN_MS, TurnBanner, turnNotice, type TurnFacts } from './turn-banner';

const mine = (turn: string, ourTurn = true): TurnFacts => ({ turn, turnLabel: 'Spring 1493', ourTurn });

describe('turnNotice', () => {
  it('says nothing at the start of the game or within a turn', () => {
    expect(turnNotice(null, mine('3'))).toBeNull();
    expect(turnNotice(mine('3'), mine('3'))).toBeNull();
  });
  it('says the AI is moving while it is not our turn', () => {
    expect(turnNotice(mine('3'), mine('3', false))).toEqual({ kind: 'ai', text: 'Other players are moving...' });
    expect(turnNotice(null, mine('3', false))?.kind).toBe('ai');
  });
  it('announces the new turn when play comes back to us', () => {
    expect(turnNotice(mine('3', false), mine('4'))).toEqual({ kind: 'new', text: 'Turn 4, Spring 1493' });
    expect(turnNotice(mine('3'), mine('4'))?.kind).toBe('new');
  });
});

describe('isIdle', () => {
  it('is idle once no unit is left to move in our turn, heard in it or while the others moved', () => {
    expect(isIdle(mine('4'), mine('4'))).toBe(true);
    expect(isIdle(mine('3', false), mine('4'))).toBe(true);
    expect(isIdle(mine('4', false), mine('4'))).toBe(true);
    expect(isIdle(null, mine('1'))).toBe(true);
  });
  it('is not idle while a unit can move, for another turn, or while the others move', () => {
    expect(isIdle(undefined, mine('4'))).toBe(false);
    expect(isIdle(mine('4'), mine('5'))).toBe(false);
    expect(isIdle(mine('4'), mine('4', false))).toBe(false);
    expect(isIdle(mine('3', false), mine('4', false))).toBe(false);
  });
});

describe('TurnBanner', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('shows the AI notice until the map says otherwise, and the new turn notice for a moment', () => {
    vi.useFakeTimers();
    const ai = { kind: 'ai', text: 'Other players are moving...' } as const;
    const { container, rerender } = render(<TurnBanner notice={ai} />);
    expect(container.textContent).toBe('Other players are moving...');
    act(() => void vi.advanceTimersByTime(NEW_TURN_MS * 2));
    expect(container.textContent).toBe('Other players are moving...');
    rerender(<TurnBanner notice={{ kind: 'new', text: 'Turn 4, Spring 1493' }} />);
    expect(container.textContent).toBe('Turn 4, Spring 1493');
    act(() => void vi.advanceTimersByTime(NEW_TURN_MS));
    expect(container.textContent).toBe('');
  });
});
