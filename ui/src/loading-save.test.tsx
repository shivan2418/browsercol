// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { LoadingSaveDialog, SHOW_SAVEGAME_SETTINGS, showsLoadingSave } from './loading-save';
import type { SaveMeta } from './saves';

afterEach(cleanup);

describe('the save game dialog option', () => {
  it('shows the window always, or for multiplayer games when it says multiplayer only', () => {
    const { never, multiplayer, always } = SHOW_SAVEGAME_SETTINGS;
    expect(showsLoadingSave(never)).toBe(false);
    expect(showsLoadingSave(multiplayer)).toBe(false);
    expect(showsLoadingSave(always)).toBe(true);
    expect(showsLoadingSave(never, false)).toBe(false);
    expect(showsLoadingSave(multiplayer, false)).toBe(true);
  });
});

describe('the Loading Save game window', () => {
  const save: SaveMeta = { id: 4, name: 'Before the war', date: 0, turn: 12, year: 1503, nation: 'Dutch', size: 9 };

  it('names the save and offers single player, the multiplayer choices unavailable', () => {
    render(<LoadingSaveDialog save={save} load={() => {}} cancel={() => {}} />);
    expect(document.querySelector('[data-loading-save]')?.textContent).toContain(
      'Before the war: turn 12 (1503), Dutch',
    );
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(radios.map((r) => [r.parentElement?.textContent?.trim(), r.checked, r.disabled])).toEqual([
      ['Single player', true, false],
      ['Private multiplayer', false, true],
      ['Public multiplayer', false, true],
    ]);
    expect([...document.querySelectorAll<HTMLInputElement>('input:not([type=radio])')].every((i) => i.disabled)).toBe(
      true,
    );
  });

  it('loads on OK and goes back on Cancel', () => {
    const load = vi.fn();
    const cancel = vi.fn();
    render(<LoadingSaveDialog save={null} load={load} cancel={cancel} />);
    fireEvent.click(document.querySelector('[data-load-cancel]')!);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-load-ok]')!);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
