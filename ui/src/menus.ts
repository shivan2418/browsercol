// The Game, Orders and View menus of the menu bar, with FreeCol's entries in its order (InGameMenuBar).
// An entry the Browser UI can't do yet is disabled, not left out, so the menus match FreeCol's layout.
import type { Menu } from './frame';
import type { Command } from './input';
import type { ViewModes } from './tileset';

type Items = Menu['items'];

/** What the menus' entries do, and what they may do now. */
export interface MenuActions {
  /** The client Engine has loaded, so game commands work. */
  ready: boolean;
  /** The orders the active unit can take now, as the Engine names them. */
  orders: string[];
  hasActiveUnit: boolean;
  run: (c: Command) => void;
  /** Back to the start screen. */
  newGame: () => void;
  /** Save the game under its default name. */
  save: () => void;
  /** Open the saved games list. */
  open: () => void;
  /** Zoom levels in (+) or out (-) about the map's centre. */
  zoom: (steps: number) => void;
  centreOnUnit: () => void;
  /** Open the Preferences window. */
  preferences: () => void;
  /** Which of the grid, borders and tile names are on. */
  modes: ViewModes;
  toggleMode: (mode: keyof ViewModes) => void;
  /** Whether the page is full screen, and a switch for it. */
  fullScreen: boolean;
  toggleFullScreen: () => void;
  /** Whether the side panel (the debug scaffold beside the map) is shown, and a switch for it. */
  sidePanel: boolean;
  toggleSidePanel: () => void;
}

const later = (label: string): Items[number] => ({ label, run: () => {}, disabled: true });

export function gameMenu(a: MenuActions): Items {
  const cmd = (label: string, c: Command): Items[number] => ({ label, run: () => a.run(c), disabled: !a.ready });
  return [
    { label: 'New', run: a.newGame },
    { label: 'Open', run: a.open },
    { label: 'Save', run: a.save, disabled: !a.ready },
    { label: 'Preferences', run: a.preferences },
    later('Reconnect'),
    cmd('Show Game Options', { k: 'showGameOptions' }),
    cmd('Show Difficulty Level', { k: 'showDifficulty' }),
    cmd('End Turn', { k: 'endTurn' }),
    cmd('Declare Independence', { k: 'declareIndependence' }),
    later('Retire'),
    later('Quit'),
  ];
}

export function ordersMenu(a: MenuActions): Items {
  /** An order of the active unit: enabled when the Engine lists it for the unit. */
  const order = (label: string, name: string, c: Command): Items[number] => ({
    label,
    run: () => a.run(c),
    disabled: !a.ready || !a.orders.includes(name),
  });
  return [
    // The Engine's order list has no colony entry; the Engine refuses a unit that can't found one.
    { label: 'Build Colony', run: () => a.run({ k: 'buildColony' }), disabled: !a.ready || !a.hasActiveUnit },
    order('Fortify', 'fortify', { k: 'fortify' }),
    order('Sentry', 'sentry', { k: 'sentry' }),
    order('Skip', 'skip', { k: 'skip' }),
    later('Clear Orders'),
    order('Plow', 'plow', { k: 'plow' }),
    order('Clear Forest', 'clearForest', { k: 'clearForest' }),
    order('Build Road', 'road', { k: 'road' }),
    order('Go To', 'goto', { k: 'selectDestination' }),
    { label: 'Trade Routes', run: () => a.run({ k: 'tradeRoutes' }), disabled: !a.ready },
    order('Disband Unit', 'disband', { k: 'disband' }),
  ];
}

export function viewMenu(a: MenuActions): Items {
  return [
    { label: 'Zoom In', run: () => a.zoom(1) },
    { label: 'Zoom Out', run: () => a.zoom(-1) },
    { label: 'Center on Active Unit', run: a.centreOnUnit, disabled: !a.hasActiveUnit },
    { label: 'Europe', run: () => a.run({ k: 'showEurope' }), disabled: !a.ready },
    { label: 'Show Map Grid', run: () => a.toggleMode('grid'), checked: a.modes.grid },
    { label: 'Show Borders', run: () => a.toggleMode('borders'), checked: a.modes.borders },
    { label: 'Show Tile Names', run: () => a.toggleMode('names'), checked: a.modes.names },
    { label: 'Show Side Panel', run: a.toggleSidePanel, checked: a.sidePanel, hint: 'Shift+F11' },
    { label: 'Full Screen', run: a.toggleFullScreen, checked: a.fullScreen },
  ];
}
