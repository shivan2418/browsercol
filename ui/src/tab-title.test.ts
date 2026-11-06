import { describe, expect, it } from 'vite-plus/test';
import { tabTitle } from './tab-title';

const dutch = { turnLabel: 'Autumn 1612', nation: 'model.nation.dutch', ourTurn: true };

describe('tabTitle', () => {
  it('is the name on the title screen', () => {
    expect(tabTitle(null, false)).toBe('BrowserCol');
    expect(tabTitle(null, true)).toBe('BrowserCol');
  });

  it('shows the year, season and nation in a game', () => {
    expect(tabTitle(dutch, false)).toBe('1612 Autumn · Dutch · BrowserCol');
  });

  it('keeps to the same title while the AI moves, shown or hidden', () => {
    const ai = { ...dutch, ourTurn: false };
    expect(tabTitle(ai, false)).toBe('1612 Autumn · Dutch · BrowserCol');
    expect(tabTitle(ai, true)).toBe('1612 Autumn · Dutch · BrowserCol');
  });

  it("says it is the player's turn while the tab is hidden", () => {
    expect(tabTitle(dutch, true)).toBe('Your turn · 1612 Autumn · Dutch · BrowserCol');
  });

  it('leaves out a nation the map did not name', () => {
    expect(tabTitle({ ...dutch, nation: '' }, false)).toBe('1612 Autumn · BrowserCol');
  });
});
