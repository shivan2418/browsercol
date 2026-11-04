// @vitest-environment jsdom
import clientOptionsXml from '../../freecol/data/base/client-options.xml?raw';
import freecolMessages from '../../freecol/data/strings/FreeColMessages.properties?raw';
import { describe, expect, it } from 'vitest';
import {
  blinkMs,
  DEFAULTS,
  FREECOL_OPTIONS,
  fromEngine,
  modeValue,
  moveMs,
  PAGE_OPTIONS,
  pageOption,
  parsePrefs,
  shownClientOptions,
  startModes,
  visibleMessages,
} from './prefs';
import { blink } from './motion';
import { clientOptionsGroup, leaves } from './options';

/** The data bundle's files the Preferences window reads, from FreeCol's own data. */
const data = [
  'data/base/client-options.xml',
  clientOptionsXml,
  'data/strings/FreeColMessages.properties',
  freecolMessages,
];

describe('prefs', () => {
  it('falls back to the defaults on missing or odd text', () => {
    expect(parsePrefs(null)).toEqual(DEFAULTS);
    expect(parsePrefs('nonsense')).toEqual(DEFAULTS);
    expect(parsePrefs('{"animation":"warp","blink":"slow","activeStyle":"x"}')).toEqual({
      ...DEFAULTS,
      blink: 'slow',
    });
    expect(parsePrefs('{"activeStyle":"freecol"}').activeStyle).toBe('freecol');
  });

  it('reads the grey-out option, on unless stored off', () => {
    expect(parsePrefs(null).dimUnfocused).toBe(true);
    expect(parsePrefs('{"dimUnfocused":false}').dimUnfocused).toBe(false);
    expect(parsePrefs('{"dimUnfocused":"no"}').dimUnfocused).toBe(true);
  });

  it('drops tutorial messages unless the option is on', () => {
    const ms = [{ type: 'TUTORIAL' }, { type: 'WARNING' }];
    expect(visibleMessages(DEFAULTS, ms)).toHaveLength(2);
    expect(visibleMessages({ ...DEFAULTS, tutorial: false }, ms)).toEqual([{ type: 'WARNING' }]);
    expect(parsePrefs('{"tutorial":false}').tutorial).toBe(false);
  });

  it('keeps auto end turn off unless stored on', () => {
    expect(parsePrefs(null).autoEndTurn).toBe(false);
    expect(parsePrefs('{"autoEndTurn":true}').autoEndTurn).toBe(true);
  });

  it('maps speeds to durations, with off as 0', () => {
    expect(moveMs({ ...DEFAULTS, animation: 'off', blink: 'off' })).toBe(0);
    expect(moveMs({ ...DEFAULTS, animation: 'fast', blink: 'off' })).toBeLessThan(moveMs(DEFAULTS));
    expect(blinkMs({ ...DEFAULTS, animation: 'off', blink: 'slow' })).toBeGreaterThan(blinkMs(DEFAULTS));
  });

  it('never dims the unit when blinking is off', () => {
    expect(blink(1000, 0)).toBe(1);
  });

  it("keeps FreeCol's options the window shows, with boolean or whole number values", () => {
    const p = parsePrefs(
      JSON.stringify({
        freecol: {
          'model.option.guiShowPreCombat': false,
          'model.option.indianDemandResponse': 2,
          'model.option.autoSavePrefix': 'x',
          'model.option.colonyComparator': 1.5,
          'model.option.useOpenGL': false,
        },
      }),
    );
    expect(p.freecol).toEqual({ 'model.option.guiShowPreCombat': false, 'model.option.indianDemandResponse': 2 });
    expect(parsePrefs('{"freecol":7}').freecol).toEqual({});
  });

  it("reads the options the page follows, by FreeCol's defaults unless set", () => {
    expect(pageOption(DEFAULTS, 'model.option.autoScroll')).toBe(true);
    const p = { ...DEFAULTS, freecol: { 'model.option.autoScroll': false, 'model.option.displayTileText': 1 } };
    expect(pageOption(p, 'model.option.autoScroll')).toBe(false);
    expect(startModes(DEFAULTS)).toEqual({ grid: false, borders: false, names: false });
    expect(startModes({ ...p, freecol: { ...p.freecol, 'model.option.displayGrid': true } })).toEqual({
      grid: true,
      borders: false,
      names: true,
    });
    expect(modeValue('names', true)).toEqual(['model.option.displayTileText', 1]);
    expect(modeValue('borders', false)).toEqual(['model.option.displayBorders', false]);
  });

  it("shows FreeCol's options that the browser follows, in FreeCol's groups", () => {
    const all = clientOptionsGroup(data)!;
    const options = leaves(all);
    for (const id of FREECOL_OPTIONS) expect(options.has(id), id).toBe(true);
    for (const [id, v] of Object.entries(PAGE_OPTIONS)) expect(options.get(id)?.value, id).toBe(v);

    const shown = shownClientOptions(all)!;
    expect([...leaves(shown).keys()].sort()).toEqual([...FREECOL_OPTIONS].sort());
    expect(shown.children.map((g) => g.label)).toEqual(['Interface']);
    const groups = shown.children[0].kind === 'group' ? shown.children[0].children.map((g) => g.label) : [];
    expect(groups).toEqual(['Main map', 'Messages', 'Warehouse Settings', 'Other']);
    const tileText = leaves(shown).get('model.option.displayTileText');
    expect(tileText?.kind === 'select' && tileText.choices.map((c) => c.value)).toEqual([0, 1]);
  });

  it('keeps the options the client Engine changed, where they differ from the defaults', () => {
    const defaults = new Map<string, unknown>([
      ['model.option.guiMessagesGroupBy', 0],
      ['model.option.guiShowWarning', true],
    ]);
    const p = { ...DEFAULTS, freecol: { 'model.option.guiShowWarning': false } };
    expect(
      fromEngine(
        p,
        { 'model.option.guiMessagesGroupBy': 1, 'model.option.guiShowWarning': true, 'model.option.useOpenGL': false },
        defaults,
      ),
    ).toEqual({ 'model.option.guiMessagesGroupBy': 1 });
  });
});
