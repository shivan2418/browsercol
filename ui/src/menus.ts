// The Game, Orders and View menus of the menu bar, with FreeCol's entries in its order (InGameMenuBar).
// An entry the Browser UI can't do yet is disabled, not left out, so the menus match FreeCol's layout.
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
    later('Clear Orders'),
    order('Plow', { k: 'plow' }),
    order('Clear Forest', { k: 'clearForest' }),
    order('Build Road', { k: 'road' }),
    order('Go To', { k: 'selectDestination' }),
    { label: 'Trade Routes', run: () => a.run({ k: 'tradeRoutes' }), disabled: !a.ready },
    order('Disband Unit', { k: 'disband' }),
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
    { label: 'Show Side Panel', run: a.toggleSidePanel, checked: a.sidePanel, hint: 'Shift+F11' },
    { label: 'Full Screen', run: a.toggleFullScreen, checked: a.fullScreen },
  ];
}
