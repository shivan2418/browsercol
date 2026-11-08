// The Game, Orders and View menus of the menu bar, with FreeCol's entries in its order (InGameMenuBar).
// An entry the Browser UI can't do yet is disabled, not left out, so the menus match FreeCol's layout.
import {
  MONARCH_ACTIONS,
  type DebugClientRequest,
  type DebugDisplay,
  type DebugPlayer,
  type DebugRequest,
} from './debug';
import type { Menu } from './frame';
import { orderOf, type Command } from './input';
import type { TileText, ViewModes } from './tileset';

type Items = Menu['items'];

/** What the menus' entries do, and what they may do now. */
export interface MenuActions {
  /** The client Engine has loaded, so game commands work. */
  ready: boolean;
  /** The orders the active unit can take now, as the Engine names them. */
  orders: string[];
  hasActiveUnit: boolean;
  /** DeclareIndependenceAction: the player is colonial and it is their turn. */
  canDeclare: boolean;
  /** EuropeAction: the player has a Europe, which independence takes away. */
  hasEurope: boolean;
  run: (c: Command) => void;
  /** Back to the start screen. */
  newGame: () => void;
  /** Ask for a name and save the game. */
  save: () => void;
  /** Ask for a name, save the game and go back to the start screen (FreeCol's Save and Exit). */
  saveAndExit: () => void;
  /** Back to the start screen, which is the main title (FreeCol's Return to Main). */
  returnToMain: () => void;
  /** A window is open over the map (FreeCol's isPanelShowing): saving waits for it to close. */
  panelShowing: boolean;
  /** Pick a saved game to open. */
  open: () => void;
  /** Zoom levels in (+) or out (-) about the map's centre. */
  zoom: (steps: number) => void;
  centreOnUnit: () => void;
  /** Open the Preferences window. */
  preferences: () => void;
  /** Which of the grid, borders and tile names are on. */
  modes: ViewModes;
  toggleMode: (mode: 'grid' | 'borders') => void;
  /** The tile text: nothing, names, owners or regions (FreeCol's Display tile text radio items). */
  setTileText: (text: TileText) => void;
  /** Whether the fog of war shows (FreeCol's Display Fog of War), and a switch for it. */
  fog: boolean;
  toggleFog: () => void;
  /** Whether the page is full screen, and a switch for it. */
  fullScreen: boolean;
  toggleFullScreen: () => void;
  /** Whether the side panel (the debug scaffold beside the map) is shown, and a switch for it. */
  sidePanel: boolean;
  toggleSidePanel: () => void;
  /** Whether FreeCol's map controls (the minimap and the info panel) show, and a switch for it (Ctrl+M). */
  mapControls: boolean;
  toggleMapControls: () => void;
  /** Whether debug mode is on (FreeCol's DebugMode.MENUS), and a switch for it (Ctrl+Shift+D). */
  debug: boolean;
  toggleDebug: () => void;
}

/** What the Debug menu does (FreeCol's DebugMenu): it asks a number or an id, then sends a request to the Engine. */
export interface DebugActions {
  ready: boolean;
  /** The tile the pointer selected, or null for none. */
  at: [number, number] | null;
  /** Ask for a value with a default, then run with it (nothing if the player cancels). */
  ask: (question: string, fallback: string, then: (answer: string) => void) => void;
  request: (r: DebugRequest) => void;
  skipTurns: (n: number) => void;
  toggleDebug: () => void;
  /** The European players, for the menus that choose one; empty until the Engine has said. */
  players: readonly DebugPlayer[];
  /** What the map shows for the Debug menu, and a way to change it. */
  display: DebugDisplay;
  setDisplay: (change: Partial<DebugDisplay>) => void;
  /** Whether the frame-rate meter (fps-meter.ts) shows, and a way to switch it. */
  fps: boolean;
  toggleFps: () => void;
  /** Step the Engine's random number generator, showing each number and asking whether to go on. */
  stepRNG: () => void;
  /** Compare the client Engine's map with the server Engine's. */
  compareMaps: () => void;
  /** One of the client Engine's own tools. */
  client: (action: DebugClientRequest['action']) => void;
  /** Show the resource keys of the images the game has. */
  showResourceKeys: () => void;
}

const later = (label: string): Items[number] => ({ label, run: () => {}, disabled: true });

export function gameMenu(a: MenuActions): Items {
  const cmd = (label: string, c: Command): Items[number] => ({ label, run: () => a.run(c), disabled: !a.ready });
  return [
    { label: 'New', run: a.newGame, hint: 'Ctrl+N' },
    { label: 'Open', run: a.open, hint: 'Ctrl+O' },
    { label: 'Save', run: a.save, disabled: !a.ready || a.panelShowing, hint: 'Ctrl+S' },
    { label: 'Preferences', run: a.preferences, hint: 'Ctrl+P' },
    later('Reconnect'),
    cmd('End Turn', { k: 'endTurn' }),
    { ...cmd('Declare Independence', { k: 'declareIndependence' }), disabled: !a.ready || !a.canDeclare },
    { label: 'Return to Main', run: a.returnToMain },
    cmd('High Scores', { k: 'showHighScores' }),
    cmd('Retire', { k: 'retire' }),
    { label: 'Save and Exit', run: a.saveAndExit, disabled: !a.ready || a.panelShowing, hint: 'Ctrl+X' },
    // FreeCol's Quit leaves the program; the page has none, so it goes to the title screen, as Return to Main does.
    { label: 'Quit', run: a.returnToMain, hint: 'Ctrl+Q' },
  ];
}

export function ordersMenu(a: MenuActions): Items {
  /** An order of the active unit: enabled when the Engine lists it for the unit. */
  const order = (label: string, c: Command): Items[number] => ({
    label,
    run: () => a.run(c),
    disabled: !a.ready || !a.orders.includes(orderOf(c) ?? ''),
  });
  return [
    order('Build Colony', { k: 'buildColony' }),
    order('Fortify', { k: 'fortify' }),
    order('Sentry', { k: 'sentry' }),
    order('Skip', { k: 'skip' }),
    { label: 'Clear Orders', run: () => a.run({ k: 'clearOrders' }), disabled: !a.ready || !a.hasActiveUnit },
    order('Rename', { k: 'renameUnit' }),
    order('Plow', { k: 'plow' }),
    order('Clear Forest', { k: 'clearForest' }),
    order('Build Road', { k: 'road' }),
    order('Unload', { k: 'unload' }),
    order('Go To', { k: 'selectDestination' }),
    // MapboardAction: needs no unit, only the game (and our turn, which the Engine checks).
    { label: 'Execute Go To Orders', run: () => a.run({ k: 'executeGotoOrders' }), disabled: !a.ready },
    // Only a carrier can be given a route, so Trade Routes opens the panel for the active carrier
    // (AssignTradeRouteAction) and is enabled only when the Engine lists assignRoute for the unit.
    order('Trade Routes', { k: 'assignRoute' }),
    order('Disband Unit', { k: 'disband' }),
  ];
}

/** The Report menu's entries after the reports (InGameMenuBar): the game's options, read-only. */
export function reportOptionsMenu(a: MenuActions): Items {
  const cmd = (label: string, c: Command): Items[number] => ({ label, run: () => a.run(c), disabled: !a.ready });
  return [
    cmd('Show Game Options', { k: 'showGameOptions' }),
    cmd('Show Map Generator Options', { k: 'showMapGeneratorOptions' }),
    cmd('Show Difficulty Level', { k: 'showDifficulty' }),
  ];
}

export function viewMenu(a: MenuActions): Items {
  return [
    { label: 'Zoom In', run: () => a.zoom(1) },
    { label: 'Zoom Out', run: () => a.zoom(-1) },
    { label: 'Center on Active Unit', run: a.centreOnUnit, disabled: !a.hasActiveUnit, hint: 'Ctrl+C' },
    { label: 'Europe', run: () => a.run({ k: 'showEurope' }), disabled: !a.ready || !a.hasEurope },
    { label: 'Find Settlement', run: () => a.run({ k: 'findSettlement' }), disabled: !a.ready, hint: 'Ctrl+F' },
    { label: 'Show Map Grid', run: () => a.toggleMode('grid'), checked: a.modes.grid },
    { label: 'Show Borders', run: () => a.toggleMode('borders'), checked: a.modes.borders },
    { label: 'Show Fog of War', run: a.toggleFog, checked: a.fog },
    {
      label: 'Show Tile Names',
      run: () => a.setTileText(a.modes.tileText === 1 ? 0 : 1),
      checked: a.modes.tileText === 1,
    },
    {
      label: 'Show Tile Owners',
      run: () => a.setTileText(a.modes.tileText === 2 ? 0 : 2),
      checked: a.modes.tileText === 2,
    },
    {
      label: 'Show Tile Regions',
      run: () => a.setTileText(a.modes.tileText === 3 ? 0 : 3),
      checked: a.modes.tileText === 3,
    },
    { label: 'Debug Mode', run: a.toggleDebug, checked: a.debug, hint: 'Ctrl+Shift+D' },
    { label: 'Map Controls', run: a.toggleMapControls, checked: a.mapControls, hint: 'Ctrl+M' },
    { label: 'Show Side Panel', run: a.toggleSidePanel, checked: a.sidePanel, hint: 'Shift+F11' },
    { label: 'Full Screen', run: a.toggleFullScreen, checked: a.fullScreen, hint: 'Alt+Enter' },
  ];
}

/** The Debug menu, shown in debug mode: FreeCol’s DebugMenu, less what is for a JVM (the resources, debug rendering,
 * the search trace, the garbage collector, the other debug modes). */
export function debugMenu(a: DebugActions): Items {
  const off = !a.ready;
  const number = (label: string, question: string, fallback: string, go: (n: number) => void): Items[number] => ({
    label,
    disabled: off,
    run: () =>
      a.ask(question, fallback, (s) => {
        const n = s.trim() === '' ? NaN : Math.trunc(Number(s));
        if (Number.isFinite(n)) go(n);
      }),
  });
  /** Swing's radio items: None, then each player; the one chosen is ticked. */
  const pick = (
    label: string,
    chosen: string | null,
    players: readonly DebugPlayer[],
    choose: (id: string | null) => void,
  ): Items[number] => ({
    label,
    disabled: off,
    run: () => {},
    sub: [
      { label: 'None', run: () => choose(null), checked: chosen === null },
      ...players.map((p) => ({ label: p.name, run: () => choose(p.id), checked: chosen === p.id })),
    ],
  });
  const at = a.at;
  const d = a.display;
  return [
    { label: 'Show Coordinates', run: () => a.setDisplay({ coords: !d.coords }), checked: d.coords },
    { label: 'Show Frame Rate', run: a.toggleFps, checked: a.fps },
    { label: 'Reveal Entire Map', run: () => a.request({ action: 'revealMap', reveal: true }), disabled: off },
    { label: 'Hide Map', run: () => a.request({ action: 'revealMap', reveal: false }), disabled: off },
    pick('Show Colony Values', d.colonyValue, a.players, (colonyValue) => a.setDisplay({ colonyValue })),
    number('Skip Turns', 'Turns to skip with the AI playing', '5', a.skipTurns),
    {
      label: 'Add Building to Colony at Selected Tile',
      disabled: off || !at,
      run: () =>
        at &&
        a.ask('Building type id (model.building.stockade)', 'model.building.', (type) =>
          a.request({ action: 'addBuilding', type, x: at[0], y: at[1] }),
        ),
    },
    {
      label: 'Add Founding Father',
      disabled: off,
      run: () =>
        a.ask('Founding father id (model.foundingFather.thomasJefferson)', 'model.foundingFather.', (father) =>
          a.request({ action: 'addFoundingFather', father }),
        ),
    },
    {
      label: 'Set the next Monarch action',
      disabled: off,
      run: () => {},
      sub: MONARCH_ACTIONS.map((monarch) => ({ label: monarch, run: () => a.request({ action: 'monarch', monarch }) })),
    },
    number('Add Gold', 'Gold to add', '1000', (amount) => a.request({ action: 'addGold', amount })),
    number('Add Immigration', 'Crosses to add', '100', (amount) => a.request({ action: 'addImmigration', amount })),
    number('Add Liberty', 'Liberty to add to each colony', '100', (amount) =>
      a.request({ action: 'addLiberty', amount }),
    ),
    { label: 'Step Random number generator', run: a.stepRNG, disabled: off },
    { label: 'Display units', run: () => a.client('displayUnits'), disabled: off },
    {
      label: 'Display panels',
      disabled: off,
      run: () => {},
      sub: [
        { label: 'Display Monarch panel', run: () => a.client('monarchPanel') },
        { label: 'Display error message', run: () => a.client('errorPanel') },
      ],
    },
    { label: 'Display Europe status', run: () => a.request({ action: 'displayEurope' }), disabled: off },
    { label: 'Display AI missions', run: () => a.setDisplay({ missions: !d.missions }), checked: d.missions },
    {
      label: 'Display additional AI mission information',
      run: () => a.setDisplay({ missionInfo: !d.missionInfo }),
      checked: d.missionInfo,
      disabled: !d.missions,
    },
    pick(
      'Show AI defence map',
      d.defence,
      a.players.filter((p) => p.ai),
      (defence) => a.setDisplay({ defence }),
    ),
    { label: 'Check for Map Desynchronization', run: a.compareMaps, disabled: off, hint: 'Ctrl+Alt+C' },
    { label: 'Show Resource Keys', run: a.showResourceKeys },
    { label: 'Statistics', run: () => a.request({ action: 'statistics' }), disabled: off },
    { label: 'AI View', run: () => a.request({ action: 'aiView' }), disabled: off },
    { label: 'Debug Mode', run: a.toggleDebug, checked: true, hint: 'Ctrl+Shift+D' },
  ];
}
