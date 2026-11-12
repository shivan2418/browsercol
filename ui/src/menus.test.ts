import { describe, expect, it } from 'vite-plus/test';
import type { MenuItem } from './frame';
import type { Command } from './input';
import { debugMenu, gameMenu, ordersMenu, reportOptionsMenu, viewMenu, type MenuActions } from './menus';
import { NO_DISPLAY, type DebugDisplay, type DebugPlayer, type DebugRequest } from './debug';

const PLAYERS: DebugPlayer[] = [
  { id: 'player:1', nation: 'model.nation.dutch', name: 'Dutch', ai: false },
  { id: 'player:2', nation: 'model.nation.french', name: 'French', ai: true },
];

function actions(over: Partial<MenuActions> = {}) {
  const log: string[] = [];
  const a: MenuActions = {
    ready: true,
    orders: [],
    hasActiveUnit: false,
    canDeclare: true,
    hasEurope: true,
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
    feedback: () => log.push('feedback'),
    modes: { grid: false, borders: true, tileText: 0 },
    toggleMode: (m) => log.push(`mode ${m}`),
    setTileText: (t) => log.push(`tileText ${t}`),
    fog: false,
    toggleFog: () => log.push('fog'),
    fullScreen: false,
    toggleFullScreen: () => log.push('fullScreen'),
    sidePanel: true,
    toggleSidePanel: () => log.push('sidePanel'),
    mapControls: true,
    toggleMapControls: () => log.push('mapControls'),
    debug: false,
    toggleDebug: () => log.push('debug'),
    allowDebug: true,
    ...over,
  };
  return { a, log };
}
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const find = (items: MenuItem[], label: string) => items.find((i) => i.label === label)!;

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
      'Retire',
      'Save and Exit',
      'Quit',
      'Send feedback…',
    ]);
  });

  it('opens the feedback window from Send feedback…, whether or not a game is ready', () => {
    const { a, log } = actions({ ready: false });
    find(gameMenu(a), 'Send feedback…').run();
    expect(log).toEqual(['feedback']);
    expect(find(gameMenu(a), 'Send feedback…').disabled).toBeFalsy();
  });

  it('runs what the Browser UI can do, and disables what it cannot', () => {
    const { a, log } = actions();
    const items = gameMenu(a);
    for (const l of ['New', 'Open', 'Save', 'Preferences', 'End Turn', 'Retire']) find(items, l).run();
    expect(log).toEqual(['newGame', 'open', 'save', 'prefs', 'endTurn', 'retire']);
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual(['Reconnect']);
  });

  it('shows FreeCol’s accelerators as hints', () => {
    const items = gameMenu(actions().a);
    const hints = Object.fromEntries(items.filter((i) => i.hint).map((i) => [i.label, i.hint]));
    expect(hints).toEqual({
      New: 'Ctrl+N',
      Open: 'Ctrl+O',
      Save: 'Ctrl+S',
      Preferences: 'Ctrl+P',
      'Save and Exit': 'Ctrl+X',
      Quit: 'Ctrl+Q',
    });
    expect(find(viewMenu(actions().a), 'Full Screen').hint).toBe('Alt+Enter');
  });

  it('takes Quit to the title screen', () => {
    const { a, log } = actions();
    find(gameMenu(a), 'Quit').run();
    expect(log).toEqual(['returnToMain']);
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
      'Rename',
      'Plow',
      'Clear Forest',
      'Build Road',
      'Load',
      'Unload',
      'Go To',
      'Execute Go To Orders',
      'Assign Trade Route',
      'Disband Unit',
    ]);
    // A unit that cannot found a colony is not offered Build Colony.
    expect(items.filter((i) => !i.disabled).map((i) => i.label)).toEqual([
      'Fortify',
      'Clear Orders',
      'Go To',
      'Execute Go To Orders',
    ]);
    // Every order names its key, as FreeCol's menu shows each action's accelerator.
    expect(items.map((i) => i.hint)).toEqual([
      'B',
      'F',
      'S',
      'Space',
      'Z',
      'N',
      'P',
      'C',
      'R',
      'L',
      'U',
      'H',
      'O',
      'A',
      'D',
    ]);
    find(items, 'Fortify').run();
    find(items, 'Go To').run();
    expect(log).toEqual(['fortify', 'selectDestination']);
  });

  it('renames the active unit and runs the goto orders from their entries', () => {
    const none = ordersMenu(actions({ orders: [], hasActiveUnit: false }).a);
    // Rename needs the active unit's order; the goto orders need only the game.
    expect(find(none, 'Rename').disabled).toBe(true);
    expect(find(none, 'Execute Go To Orders').disabled).toBe(false);
    expect(find(ordersMenu(actions({ ready: false }).a), 'Execute Go To Orders').disabled).toBe(true);
    const { a, log } = actions({ orders: ['rename'], hasActiveUnit: true });
    const items = ordersMenu(a);
    expect(find(items, 'Rename').disabled).toBe(false);
    find(items, 'Rename').run();
    find(items, 'Execute Go To Orders').run();
    expect(log).toEqual(['renameUnit', 'executeGotoOrders']);
  });

  it('enables Assign Trade Route only for a carrier, and opens its route panel', () => {
    const plain = ordersMenu(actions({ orders: ['fortify', 'goto'], hasActiveUnit: true }).a);
    expect(find(plain, 'Assign Trade Route').disabled).toBe(true);
    const { a, log } = actions({ orders: ['goto', 'assignRoute'], hasActiveUnit: true });
    const routes = find(ordersMenu(a), 'Assign Trade Route');
    expect(routes.disabled).toBe(false);
    routes.run();
    expect(log).toEqual(['assignRoute']);
  });

  it('offers Build Colony when the Engine says the unit can found a colony', () => {
    const { a, log } = actions({ orders: ['buildColony'], hasActiveUnit: true });
    const build = find(ordersMenu(a), 'Build Colony');
    expect(build.disabled).toBe(false);
    build.run();
    expect(log).toEqual(['buildColony']);
  });

  it('disables every order when there is no active unit, but not the goto orders of all units', () => {
    const items = ordersMenu(actions().a);
    expect(items.filter((i) => !i.disabled).map((i) => i.label)).toEqual(['Execute Go To Orders']);
  });
});

describe('the View menu', () => {
  it('opens the trade routes with no unit, as TradeRouteAction does', () => {
    const { a, log } = actions({ hasActiveUnit: false });
    const routes = find(viewMenu(a), 'Trade Routes');
    expect(routes.disabled).toBe(false);
    expect(routes.hint).toBe('T');
    routes.run();
    expect(log).toEqual(['tradeRoutes']);
    expect(find(viewMenu(actions({ ready: false }).a), 'Trade Routes').disabled).toBe(true);
  });

  it('zooms, centres, opens Europe and switches the display modes', () => {
    const { a, log } = actions({ hasActiveUnit: true });
    const items = viewMenu(a);
    expect(labels(items)).toEqual([
      'Zoom In',
      'Zoom Out',
      'Center on Active Unit',
      'Europe',
      'Trade Routes',
      'Find Settlement',
      'Show Map Grid',
      'Show Borders',
      'Show Fog of War',
      'Show Tile Names',
      'Show Tile Owners',
      'Show Tile Regions',
      'Debug Mode',
      'Map Controls',
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
      'Map Controls',
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
      'mapControls',
      'sidePanel',
      'fullScreen',
    ]);
    expect(items.filter((i) => i.disabled)).toEqual([]);
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual([
      'Show Borders',
      'Map Controls',
      'Show Side Panel',
    ]);
  });

  it('leaves Debug Mode out when the player does not allow debug mode', () => {
    const items = viewMenu(actions({ allowDebug: false }).a);
    expect(labels(items)).not.toContain('Debug Mode');
    expect(labels(items)).toContain('Map Controls');
  });

  it('shows one tile text at a time, and a second pick of it turns it off', () => {
    const { a, log } = actions({ modes: { grid: false, borders: false, tileText: 2 } });
    const items = viewMenu(a);
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual([
      'Show Tile Owners',
      'Map Controls',
      'Show Side Panel',
    ]);
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
    const changes: Partial<DebugDisplay>[] = [];
    const clientCalls: string[] = [];
    const items = debugMenu({
      ready: true,
      at: [3, 4],
      ask: (_q, _fallback, then) => then(answers.shift() ?? ''),
      request: (r) => asked.push(r),
      skipTurns: (n) => asked.push({ action: 'addGold', amount: -n }),
      toggleDebug: () => asked.push({ action: 'aiView' }),
      players: PLAYERS,
      display: NO_DISPLAY,
      setDisplay: (change) => changes.push(change),
      fps: false,
      toggleFps: () => clientCalls.push('fps'),
      stepRNG: () => asked.push({ action: 'stepRNG' }),
      compareMaps: () => asked.push({ action: 'compareMaps', client: {} }),
      client: (action) => clientCalls.push(action),
      showResourceKeys: () => clientCalls.push('keys'),
      ...over,
    });
    return { items, asked, answers, changes, clientCalls };
  }

  it('Show Frame Rate switches the meter and is ticked while it shows', () => {
    const { items, clientCalls } = debugActions();
    expect(find(items, 'Show Frame Rate').checked).toBe(false);
    find(items, 'Show Frame Rate').run();
    expect(clientCalls).toEqual(['fps']);
    expect(find(debugActions({ fps: true }).items, 'Show Frame Rate').checked).toBe(true);
  });

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

  it('has FreeCol’s inspection entries', () => {
    const { items } = debugActions();
    expect(labels(items)).toEqual(
      expect.arrayContaining([
        'Show Coordinates',
        'Show Colony Values',
        'Set the next Monarch action',
        'Step Random number generator',
        'Display units',
        'Display panels',
        'Display Europe status',
        'Display AI missions',
        'Display additional AI mission information',
        'Show AI defence map',
        'Check for Map Desynchronization',
        'Show Resource Keys',
        'Statistics',
      ]),
    );
  });

  it('forces a monarch action by name', () => {
    const { items, asked } = debugActions();
    const sub = find(items, 'Set the next Monarch action').sub!;
    expect(sub).toHaveLength(15);
    find(sub, 'RAISE_TAX_WAR').run();
    expect(asked).toEqual([{ action: 'monarch', monarch: 'RAISE_TAX_WAR' }]);
  });

  it('steps the generator, dumps Europe, asks for statistics and compares the maps', () => {
    const { items, asked } = debugActions();
    for (const l of [
      'Step Random number generator',
      'Display Europe status',
      'Statistics',
      'Check for Map Desynchronization',
    ])
      find(items, l).run();
    expect(asked.map((r) => r.action)).toEqual(['stepRNG', 'displayEurope', 'statistics', 'compareMaps']);
  });

  it('runs the client Engine’s tools and the page’s resource keys', () => {
    const { items, clientCalls } = debugActions();
    find(items, 'Display units').run();
    const panels = find(items, 'Display panels').sub!;
    find(panels, 'Display Monarch panel').run();
    find(panels, 'Display error message').run();
    find(items, 'Show Resource Keys').run();
    expect(clientCalls).toEqual(['displayUnits', 'monarchPanel', 'errorPanel', 'keys']);
  });

  it('switches the overlays, with a choice of player for the colony value and the defence map', () => {
    const { items, changes } = debugActions();
    find(items, 'Show Coordinates').run();
    const values = find(items, 'Show Colony Values').sub!;
    expect(labels(values)).toEqual(['None', 'Dutch', 'French']);
    expect(find(values, 'None').checked).toBe(true);
    find(values, 'French').run();
    // The defence map is for the AI's players only.
    const defence = find(items, 'Show AI defence map').sub!;
    expect(labels(defence)).toEqual(['None', 'French']);
    find(defence, 'French').run();
    find(items, 'Display AI missions').run();
    expect(changes).toEqual([
      { coords: true },
      { colonyValue: 'player:2' },
      { defence: 'player:2' },
      { missions: true },
    ]);
  });

  it('shows the extra mission information only while missions show', () => {
    expect(find(debugActions().items, 'Display additional AI mission information').disabled).toBe(true);
    const on = debugActions({ display: { ...NO_DISPLAY, missions: true, missionInfo: true } }).items;
    const info = find(on, 'Display additional AI mission information');
    expect(info.disabled).toBeFalsy();
    expect(info.checked).toBe(true);
  });
});

describe('independence', () => {
  it('greys out Europe once the player has none', () => {
    expect(find(viewMenu(actions({ hasEurope: false }).a), 'Europe').disabled).toBe(true);
    expect(find(viewMenu(actions().a), 'Europe').disabled).toBeFalsy();
  });

  it('greys out Declare Independence for a rebel, a retired player or outside our turn', () => {
    expect(find(gameMenu(actions({ canDeclare: false }).a), 'Declare Independence').disabled).toBe(true);
    expect(find(gameMenu(actions().a), 'Declare Independence').disabled).toBeFalsy();
  });
});
