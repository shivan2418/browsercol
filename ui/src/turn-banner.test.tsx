// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  isIdle,
  type Mover,
  MoverHold,
  MOVER_MIN_MS,
  NEW_TURN_MS,
  TurnBanner,
  turnNotice,
  type TurnFacts,
} from './turn-banner';

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

const mover = (name: string, native = false, ours = false): Mover => ({
  name,
  native,
  rgb: 0x2040c0,
  fg: 0xffffff,
  ours,
});

describe('turnNotice with a named player', () => {
  it('names the European nation that is moving, in its colour', () => {
    expect(turnNotice(mine('3'), mine('3', false), mover('English'))).toEqual({
      kind: 'ai',
      text: 'The English are moving...',
      rgb: 0x2040c0,
    });
  });
  it('says one line for any native player, with no colour', () => {
    expect(turnNotice(mine('3'), mine('3', false), mover('Cherokee', true))).toEqual({
      kind: 'ai',
      text: 'The natives are moving...',
      rgb: undefined,
    });
  });
  it('says the others are moving while no player is named yet, or the named one is us', () => {
    expect(turnNotice(mine('3'), mine('3', false), null)?.text).toBe('Other players are moving...');
    expect(turnNotice(mine('3'), mine('3', false), mover('Netherlands', false, true))?.text).toBe(
      'Other players are moving...',
    );
  });
});

describe('MoverHold', () => {
  const setup = () => {
    vi.useFakeTimers();
    const shown: (string | null)[] = [];
    const hold = new MoverHold(
      (m) => shown.push(m && m.name),
      MOVER_MIN_MS,
      () => Date.now(),
    );
    return { shown, hold };
  };
  afterEach(() => vi.useRealTimers());
  it('shows the first player at once and holds each name for the minimum', () => {
    const { shown, hold } = setup();
    hold.push(mover('English'));
    hold.push(mover('French'));
    expect(shown).toEqual(['English']);
    vi.advanceTimersByTime(MOVER_MIN_MS);
    expect(shown).toEqual(['English', 'French']);
  });
  it('skips a player who is replaced before their turn to show comes', () => {
    const { shown, hold } = setup();
    hold.push(mover('English'));
    hold.push(mover('French'));
    hold.push(mover('Spanish'));
    vi.advanceTimersByTime(MOVER_MIN_MS);
    expect(shown).toEqual(['English', 'Spanish']);
  });
  it('shows a player at once when the held name has been up long enough', () => {
    const { shown, hold } = setup();
    hold.push(mover('English'));
    vi.advanceTimersByTime(MOVER_MIN_MS + 1);
    hold.push(mover('French'));
    expect(shown).toEqual(['English', 'French']);
  });
  it('takes the whole native stretch as one name', () => {
    const { shown, hold } = setup();
    hold.push(mover('Cherokee', true));
    hold.push(mover('Sioux', true));
    vi.advanceTimersByTime(MOVER_MIN_MS * 3);
    hold.push(mover('Aztec', true));
    expect(shown).toEqual(['Cherokee']);
  });
  it('clears at once when our turn comes, and drops a name that was waiting', () => {
    const { shown, hold } = setup();
    hold.push(mover('English'));
    hold.push(mover('French'));
    hold.push(mover('Netherlands', false, true));
    vi.advanceTimersByTime(MOVER_MIN_MS * 2);
    expect(shown).toEqual(['English', null]);
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
  it('shows the moving player with a swatch of their colour', () => {
    const { container } = render(
      <TurnBanner notice={{ kind: 'ai', text: 'The French are moving...', rgb: 0x2040c0 }} />,
    );
    expect(container.textContent).toBe('The French are moving...');
    expect(container.querySelector<HTMLElement>('.turn-banner-swatch')?.style.background).toBe('rgb(32, 64, 192)');
  });
});
