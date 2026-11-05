// The Game, Orders and View menus of the menu bar, with FreeCol's entries in its order (InGameMenuBar).
// An entry the Browser UI can't do yet is disabled, not left out, so the menus match FreeCol's layout.
import type { DebugRequest } from './debug';
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
}

const later = (label: string): Items[number] => ({ label, run: () => {}, disabled: true });

export function gameMenu(a: MenuActions): Items {
  const cmd = (label: string, c: Command): Items[number] => ({ label, run: () => a.run(c), disabled: !a.ready });
  return [
    { label: 'New', run: a.newGame },
    { label: 'Open', run: a.open },
    { label: 'Save', run: a.save, disabled: !a.ready || a.panelShowing },
    { label: 'Preferences', run: a.preferences },
    later('Reconnect'),
    cmd('End Turn', { k: 'endTurn' }),
    { ...cmd('Declare Independence', { k: 'declareIndependence' }), disabled: !a.ready || !a.canDeclare },
    { label: 'Return to Main', run: a.returnToMain },
    cmd('High Scores', { k: 'showHighScores' }),
    cmd('Retire', { k: 'retire' }),
    { label: 'Save and Exit', run: a.saveAndExit, disabled: !a.ready || a.panelShowing },
    later('Quit'),
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
    { label: 'Center on Active Unit', run: a.centreOnUnit, disabled: !a.hasActiveUnit },
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
    { label: 'Show Side Panel', run: a.toggleSidePanel, checked: a.sidePanel, hint: 'Shift+F11' },
    { label: 'Full Screen', run: a.toggleFullScreen, checked: a.fullScreen },
  ];
}

/** The Debug menu, shown in debug mode: FreeCol's cheats (DebugMenu) that the Engine can do. */
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
  const at = a.at;
  return [
    { label: 'Reveal Entire Map', run: () => a.request({ action: 'revealMap', reveal: true }), disabled: off },
    { label: 'Hide Map', run: () => a.request({ action: 'revealMap', reveal: false }), disabled: off },
    number('Add Gold', 'Gold to add', '1000', (amount) => a.request({ action: 'addGold', amount })),
    number('Add Immigration', 'Crosses to add', '100', (amount) => a.request({ action: 'addImmigration', amount })),
    number('Add Liberty', 'Liberty to add to each colony', '100', (amount) =>
      a.request({ action: 'addLiberty', amount }),
    ),
    {
      label: 'Add Founding Father',
      disabled: off,
      run: () =>
        a.ask('Founding father id (model.foundingFather.thomasJefferson)', 'model.foundingFather.', (father) =>
          a.request({ action: 'addFoundingFather', father }),
        ),
    },
    {
      label: 'Add Building to Colony at Selected Tile',
      disabled: off || !at,
      run: () =>
        at &&
        a.ask('Building type id (model.building.stockade)', 'model.building.', (type) =>
          a.request({ action: 'addBuilding', type, x: at[0], y: at[1] }),
        ),
    },
    number('Skip Turns', 'Turns to skip with the AI playing', '5', a.skipTurns),
    { label: 'AI View', run: () => a.request({ action: 'aiView' }), disabled: off },
    { label: 'Debug Mode', run: a.toggleDebug, checked: true, hint: 'Ctrl+Shift+D' },
  ];
}
