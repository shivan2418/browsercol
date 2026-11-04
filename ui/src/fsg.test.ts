import { describe, expect, it } from 'vite-plus/test';
import { zip } from './fsg-fixture';
import { NotASave, readFsg, turnYear } from './fsg';

const SAVE =
  '<?xml version="1.0" encoding="UTF-8"?><!--Configuration: x-->\n' +
  '<savedGame owner="Ana &amp; co" version="14">\n' +
  '<game id="0" turn="34" currentPlayer="player:19">\n' +
  '<player id="player:94" username="Louis XIV" nationId="model.nation.french" ai="true">\n' +
  '<player id="player:19" username="Ana &amp; co" nationId="model.nation.dutch" ai="false">\n' +
  '</game></savedGame>';

describe('readFsg', () => {
  it('reads the turn, year, nation and owner of a save', async () => {
    const info = await readFsg(await zip({ 'client-options.xml': '<x/>', 'savegame.xml': SAVE }));
    expect(info).toEqual({ turn: 34, year: 1525, nation: 'Dutch', owner: 'Ana & co' });
  });

  it('reads a zip whose local headers carry no sizes', async () => {
    expect((await readFsg(await zip({ 'savegame.xml': SAVE }, { descriptor: true }))).turn).toBe(34);
  });

  it('reads a stored entry', async () => {
    expect((await readFsg(await zip({ 'savegame.xml': SAVE }, { stored: true }))).nation).toBe('Dutch');
  });

  it('falls back to the owner as the human when no player says ai="false"', async () => {
    const xml = SAVE.replace(' ai="false"', '');
    expect((await readFsg(await zip({ 'savegame.xml': xml }))).nation).toBe('Dutch');
  });

  it('rejects what is not a FreeCol save, with the reason', async () => {
    const bad = [
      new TextEncoder().encode('just some text'),
      new Uint8Array(0),
      await zip({ 'other.txt': 'hi' }),
      await zip({ 'savegame.xml': '<html></html>' }),
      await zip({ 'savegame.xml': '<savedGame owner="a"><game id="0"></game></savedGame>' }),
      (await zip({ 'savegame.xml': SAVE })).subarray(0, 60),
    ];
    for (const bytes of bad) await expect(readFsg(bytes)).rejects.toBeInstanceOf(NotASave);
  });
});

describe('turnYear', () => {
  it('counts a year a turn to 1600, then two turns a year', () => {
    expect([1, 34, 108, 109, 110, 111].map(turnYear)).toEqual([1492, 1525, 1599, 1600, 1600, 1601]);
  });
});
