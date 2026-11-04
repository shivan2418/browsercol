// @vitest-environment jsdom
import clientOptionsXml from '../../freecol/data/base/client-options.xml?raw';
import freecolMessages from '../../freecol/data/strings/FreeColMessages.properties?raw';
import germanMessages from '../../freecol/data/strings/FreeColMessages_de.properties?raw';
import { describe, expect, it } from 'vite-plus/test';
import {
  blinkMs,
  DEFAULTS,
  FREECOL_OPTIONS,
  fontScale,
  fromEngine,
  minimapOptions,
  moveMs,
  PAGE_OPTIONS,
  pageOption,
  parsePrefs,
  shownClientOptions,
  startModes,
  uiZoom,
  visibleMessages,
  volumes,
} from './prefs';
import { blink } from './motion';
import { LANGUAGE_OPTION } from './language';
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

  it('mutes the music and the sound effects apart, keeping their volumes', () => {
    const p = { ...DEFAULTS, freecol: { 'model.option.musicVolume': 40, 'model.option.soundEffectsVolume': 70 } };
    expect(volumes(p)).toEqual({ music: 40, effects: 70 });
    expect(volumes({ ...p, muteMusic: true })).toEqual({ music: 0, effects: 70 });
    expect(volumes({ ...p, muteEffects: true })).toEqual({ music: 40, effects: 0 });
    expect(parsePrefs('{"muteMusic":true,"muteEffects":"x"}')).toMatchObject({ muteMusic: true, muteEffects: false });
  });

  it('reads the grey-out strength, normal unless stored otherwise', () => {
    expect(parsePrefs(null).dimUnfocused).toBe('normal');
    expect(parsePrefs('{"dimUnfocused":"heavy"}').dimUnfocused).toBe('heavy');
    expect(parsePrefs('{"dimUnfocused":"off"}').dimUnfocused).toBe('off');
    expect(parsePrefs('{"dimUnfocused":"no"}').dimUnfocused).toBe('normal');
    // The old on/off switch.
    expect(parsePrefs('{"dimUnfocused":false}').dimUnfocused).toBe('off');
    expect(parsePrefs('{"dimUnfocused":true}').dimUnfocused).toBe('normal');
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
          'model.option.playerName': 'Peter Stuyvesant',
          'model.option.colonyComparator': 1.5,
          'model.option.usePixmaps': false,
        },
      }),
    );
    expect(p.freecol).toEqual({
      'model.option.guiShowPreCombat': false,
      'model.option.indianDemandResponse': 2,
      'model.option.playerName': 'Peter Stuyvesant',
    });
    expect(parsePrefs('{"freecol":7}').freecol).toEqual({});
  });

  it("reads the options the page follows, by FreeCol's defaults unless set", () => {
    expect(pageOption(DEFAULTS, 'model.option.autoScroll')).toBe(true);
    const p = { ...DEFAULTS, freecol: { 'model.option.autoScroll': false, 'model.option.displayTileText': 1 } };
    expect(pageOption(p, 'model.option.autoScroll')).toBe(false);
    expect(startModes(DEFAULTS)).toEqual({ grid: false, borders: false, tileText: 0 });
    expect(startModes({ ...p, freecol: { ...p.freecol, 'model.option.displayGrid': true } })).toEqual({
      grid: true,
      borders: false,
      tileText: 1,
    });
  });

  it("sizes the UI by FreeCol's display scaling, and the text by its manual font size", () => {
    const at = (freecol: Record<string, boolean | number>) => ({ ...DEFAULTS, freecol });
    expect(uiZoom(DEFAULTS)).toBe(1);
    expect(uiZoom(at({ 'model.option.displayScaling': 150 }))).toBe(1.5);
    expect(fontScale(at({ 'model.option.mainFontSize': 18 }))).toBe(1);
    expect(fontScale(at({ 'model.option.mainFontSize': 18, 'model.option.manualMainFontSize': true }))).toBe(1.5);
  });

  it("shows FreeCol's options that the browser follows, in FreeCol's groups", () => {
    const all = clientOptionsGroup(data)!;
    const options = leaves(all);
    for (const id of FREECOL_OPTIONS) expect(options.has(id), id).toBe(true);
    for (const [id, v] of Object.entries(PAGE_OPTIONS)) expect(options.get(id)?.value, id).toBe(v);

    const shown = shownClientOptions(all)!;
    expect([...leaves(shown).keys()].sort()).toEqual([...FREECOL_OPTIONS].sort());
    expect(shown.children.map((g) => g.label)).toEqual(['Personal', 'Display', 'Interface', 'Audio']);
    // Sound (#157): the volumes and the alert, but not the Java Sound mixer.
    expect(shown.children[3].kind === 'group' && shown.children[3].children.map((o) => o.id)).toEqual([
      'model.option.musicVolume',
      'model.option.soundEffectsVolume',
      'model.option.audioAlerts',
    ]);
    const groups = shown.children[2].kind === 'group' ? shown.children[2].children.map((g) => g.label) : [];
    expect(groups).toEqual(['Main map', 'Map Controls', 'Messages', 'Warehouse Settings', 'Other']);
    const tileText = leaves(shown).get('model.option.displayTileText');
    expect(tileText?.kind === 'select' && tileText.choices.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    // An option read only as the page loads says so.
    expect(leaves(shown).get('model.option.useOpenGL')?.label).toMatch(/\(on reload\)$/);
    expect(leaves(shown).get('model.option.autoScroll')?.label).not.toMatch(/reload/);
  });

  it("reads the minimap's options, by FreeCol's defaults unless set, and shows them", () => {
    expect(minimapOptions(DEFAULTS)).toEqual({ borders: true, fog: true, background: 0, zoom: 2 });
    const p = {
      ...DEFAULTS,
      freecol: {
        'model.option.miniMapToggleBorders': false,
        'model.option.miniMapToggleFogOfWar': false,
        'model.option.color.background': 6,
        'model.option.defaultZoomLevel': 5,
      },
    };
    expect(minimapOptions(p)).toEqual({ borders: false, fog: false, background: 6, zoom: 5 });
    const shown = leaves(shownClientOptions(clientOptionsGroup(data)!)!);
    for (const id of Object.keys(p.freecol)) expect(shown.has(id), id).toBe(true);
  });

  it("offers FreeCol's translations as the language, read on reload, in the bundle's language", () => {
    const withLanguages = [...data, 'data/strings/languages.json', '["de","pt_BR"]'];
    const language = leaves(shownClientOptions(clientOptionsGroup(withLanguages)!)!).get(LANGUAGE_OPTION);
    expect(language).toMatchObject({
      kind: 'string',
      label: 'Language (on reload)',
      value: 'automatic',
      choices: [
        { value: 'automatic', label: 'Autodetect Language' },
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' },
        { value: 'pt_BR', label: 'Português (Brasil)' },
      ],
    });

    const german = [...withLanguages, 'data/strings/FreeColMessages_de.properties', germanMessages];
    const shown = shownClientOptions(clientOptionsGroup(german)!)!;
    expect(shown.children[0].label).toBe('Persönlich');
    expect(leaves(shown).get(LANGUAGE_OPTION)?.label).toBe('Sprache (on reload)');
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
        { 'model.option.guiMessagesGroupBy': 1, 'model.option.guiShowWarning': true, 'model.option.usePixmaps': false },
        defaults,
      ),
    ).toEqual({ 'model.option.guiMessagesGroupBy': 1 });
  });
});
