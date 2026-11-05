import { describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { debugMenu, gameMenu, ordersMenu, reportOptionsMenu, viewMenu, type MenuActions } from './menus';
import type { DebugRequest } from './debug';

function actions(over: Partial<MenuActions> = {}) {
  const log: string[] = [];
  const a: MenuActions = {
    ready: true,
    orders: [],
    hasActiveUnit: false,
    run: (c: Command) => log.push(c.k),
    newGame: () => log.push('newGame'),
    save: () => log.push('save'),
    saveAndExit: () => log.push('saveAndExit'),
    returnToMain: () => log.push('returnToMain'),
    panelShowing: false,
    open: () => log.push('open'),
    zoom: (n) => log.push(`zoom ${n}`),
    centreOnUnit: () => log.push('centre'),
    preferences: () => log.push('prefs'),
    modes: { grid: false, borders: true, tileText: 0 },
    toggleMode: (m) => log.push(`mode ${m}`),
    setTileText: (t) => log.push(`tileText ${t}`),
    fog: false,
    toggleFog: () => log.push('fog'),
    fullScreen: false,
    toggleFullScreen: () => log.push('fullScreen'),
    sidePanel: true,
    toggleSidePanel: () => log.push('sidePanel'),
    debug: false,
    toggleDebug: () => log.push('debug'),
    ...over,
  };
  return { a, log };
}
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const find = (items: { label: string; run: () => void; disabled?: boolean; checked?: boolean }[], label: string) =>
  items.find((i) => i.label === label)!;

describe('the Game menu', () => {
  it('has FreeCol’s entries in its order', () => {
    expect(labels(gameMenu(actions().a))).toEqual([
      'New',
      'Open',
      'Save',
      'Preferences',
      'Reconnect',
      'End Turn',
      'Declare Independence',
      'Return to Main',
      'High Scores',
      'Retire',
      'Save and Exit',
      'Quit',
    ]);
  });

  it('runs what the Browser UI can do, and disables what it cannot', () => {
    const { a, log } = actions();
    const items = gameMenu(a);
    for (const l of ['New', 'Open', 'Save', 'Preferences', 'End Turn', 'High Scores', 'Retire']) find(items, l).run();
    expect(log).toEqual(['newGame', 'open', 'save', 'prefs', 'endTurn', 'showHighScores', 'retire']);
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual(['Reconnect', 'Quit']);
  });

  it('disables the game’s commands until the client Engine has loaded', () => {
    const items = gameMenu(actions({ ready: false }).a);
    expect(find(items, 'End Turn').disabled).toBe(true);
    expect(find(items, 'Save').disabled).toBe(true);
    expect(find(items, 'New').disabled).toBeFalsy();
  });

  it('returns to the main title, and saves and exits', () => {
    const { a, log } = actions();
    const items = gameMenu(a);
    find(items, 'Return to Main').run();
    find(items, 'Save and Exit').run();
    expect(log).toEqual(['returnToMain', 'saveAndExit']);
  });

  it('disables Save and Save and Exit while a window is open, as FreeCol does for a panel', () => {
    const items = gameMenu(actions({ panelShowing: true }).a);
    expect(find(items, 'Save').disabled).toBe(true);
    expect(find(items, 'Save and Exit').disabled).toBe(true);
    expect(find(items, 'Return to Main').disabled).toBeFalsy();
  });
});

describe('the Report menu', () => {
  it('shows the game options, the map generator options and the difficulty level read-only', () => {
    const { a, log } = actions();
    const items = reportOptionsMenu(a);
    expect(labels(items)).toEqual(['Show Game Options', 'Show Map Generator Options', 'Show Difficulty Level']);
    for (const i of items) i.run();
    expect(log).toEqual(['showGameOptions', 'showMapGeneratorOptions', 'showDifficulty']);
    expect(reportOptionsMenu(actions({ ready: false }).a).every((i) => i.disabled)).toBe(true);
  });
});

describe('the Orders menu', () => {
  it('enables the orders the active unit can take', () => {
    const { a, log } = actions({ orders: ['fortify', 'goto'], hasActiveUnit: true });
    const items = ordersMenu(a);
    expect(labels(items)).toEqual([
      'Build Colony',
      'Fortify',
      'Sentry',
      'Skip',
      'Clear Orders',
      'Plow',
      'Clear Forest',
      'Build Road',
      'Unload',
      'Go To',
      'Trade Routes',
      'Disband Unit',
    ]);
    // A unit that cannot found a colony is not offered Build Colony.
    expect(items.filter((i) => !i.disabled).map((i) => i.label)).toEqual([
      'Fortify',
      'Clear Orders',
      'Go To',
      'Trade Routes',
    ]);
    find(items, 'Fortify').run();
    find(items, 'Go To').run();
    expect(log).toEqual(['fortify', 'selectDestination']);
  });

  it('offers Build Colony when the Engine says the unit can found a colony', () => {
    const { a, log } = actions({ orders: ['buildColony'], hasActiveUnit: true });
    const build = find(ordersMenu(a), 'Build Colony');
    expect(build.disabled).toBe(false);
    build.run();
    expect(log).toEqual(['buildColony']);
  });

  it('disables every order when there is no active unit', () => {
    const items = ordersMenu(actions().a);
    expect(items.filter((i) => !i.disabled).map((i) => i.label)).toEqual(['Trade Routes']);
  });
});

describe('the View menu', () => {
  it('zooms, centres, opens Europe and switches the display modes', () => {
    const { a, log } = actions({ hasActiveUnit: true });
    const items = viewMenu(a);
    expect(labels(items)).toEqual([
      'Zoom In',
      'Zoom Out',
      'Center on Active Unit',
      'Europe',
      'Find Settlement',
      'Show Map Grid',
      'Show Borders',
      'Show Fog of War',
      'Show Tile Names',
      'Show Tile Owners',
      'Show Tile Regions',
      'Debug Mode',
      'Show Side Panel',
      'Full Screen',
    ]);
    find(items, 'Zoom In').run();
    find(items, 'Zoom Out').run();
    find(items, 'Center on Active Unit').run();
    find(items, 'Europe').run();
    find(items, 'Find Settlement').run();
    for (const l of [
      'Show Map Grid',
      'Show Borders',
      'Show Fog of War',
      'Show Tile Names',
      'Show Tile Owners',
      'Show Tile Regions',
      'Debug Mode',
      'Show Side Panel',
      'Full Screen',
    ]) {
      find(items, l).run();
    }
    expect(log).toEqual([
      'zoom 1',
      'zoom -1',
      'centre',
      'showEurope',
      'findSettlement',
      'mode grid',
      'mode borders',
      'fog',
      'tileText 1',
      'tileText 2',
      'tileText 3',
      'debug',
      'sidePanel',
      'fullScreen',
    ]);
    expect(items.filter((i) => i.disabled)).toEqual([]);
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Show Borders', 'Show Side Panel']);
  });

  it('shows one tile text at a time, and a second pick of it turns it off', () => {
    const { a, log } = actions({ modes: { grid: false, borders: false, tileText: 2 } });
    const items = viewMenu(a);
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Show Tile Owners', 'Show Side Panel']);
    find(items, 'Show Tile Owners').run();
    find(items, 'Show Tile Regions').run();
    expect(log).toEqual(['tileText 0', 'tileText 3']);
  });

  it('disables centring without an active unit', () => {
    expect(find(viewMenu(actions().a), 'Center on Active Unit').disabled).toBe(true);
  });
});

describe('the Debug menu', () => {
  function debugActions(over: Partial<Parameters<typeof debugMenu>[0]> = {}) {
    const asked: DebugRequest[] = [];
    const answers: string[] = [];
    const items = debugMenu({
      ready: true,
      at: [3, 4],
      ask: (_q, _fallback, then) => then(answers.shift() ?? ''),
      request: (r) => asked.push(r),
      skipTurns: (n) => asked.push({ action: 'addGold', amount: -n }),
      toggleDebug: () => asked.push({ action: 'aiView' }),
      ...over,
    });
    return { items, asked, answers };
  }

  it('asks for a value and sends the cheat', () => {
    const { items, asked, answers } = debugActions();
    answers.push('250', '7', '30', 'model.foundingFather.thomasJefferson', 'model.building.stockade');
    for (const l of [
      'Add Gold',
      'Add Immigration',
      'Add Liberty',
      'Add Founding Father',
      'Add Building to Colony at Selected Tile',
    ]) {
      find(items, l).run();
    }
    expect(asked).toEqual([
      { action: 'addGold', amount: 250 },
      { action: 'addImmigration', amount: 7 },
      { action: 'addLiberty', amount: 30 },
      { action: 'addFoundingFather', father: 'model.foundingFather.thomasJefferson' },
      { action: 'addBuilding', type: 'model.building.stockade', x: 3, y: 4 },
    ]);
  });

  it('sends nothing for a cancelled or non-numeric answer, and needs a tile for a building', () => {
    const { items, asked, answers } = debugActions({ at: null });
    answers.push('', 'lots');
    find(items, 'Add Gold').run();
    find(items, 'Add Immigration').run();
    expect(asked).toEqual([]);
    expect(find(items, 'Add Building to Colony at Selected Tile').disabled).toBe(true);
  });
});
