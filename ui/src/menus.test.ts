import { describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { gameMenu, ordersMenu, viewMenu, type MenuActions } from './menus';

function actions(over: Partial<MenuActions> = {}) {
  const log: string[] = [];
  const a: MenuActions = {
    ready: true,
    orders: [],
    hasActiveUnit: false,
    run: (c: Command) => log.push(c.k),
    newGame: () => log.push('newGame'),
    save: () => log.push('save'),
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
      'Show Game Options',
      'Show Difficulty Level',
      'End Turn',
      'Declare Independence',
      'Retire',
      'Quit',
    ]);
  });

  it('runs what the Browser UI can do, and disables what it cannot', () => {
    const { a, log } = actions();
    const items = gameMenu(a);
    for (const l of ['New', 'Open', 'Save', 'Preferences', 'Show Game Options', 'End Turn']) find(items, l).run();
    expect(log).toEqual(['newGame', 'open', 'save', 'prefs', 'showGameOptions', 'endTurn']);
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual(['Reconnect', 'Retire', 'Quit']);
  });

  it('disables the game’s commands until the client Engine has loaded', () => {
    const items = gameMenu(actions({ ready: false }).a);
    expect(find(items, 'End Turn').disabled).toBe(true);
    expect(find(items, 'Save').disabled).toBe(true);
    expect(find(items, 'New').disabled).toBeFalsy();
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
      'Go To',
      'Trade Routes',
      'Disband Unit',
    ]);
    expect(items.filter((i) => !i.disabled).map((i) => i.label)).toEqual([
      'Build Colony',
      'Fortify',
      'Go To',
      'Trade Routes',
    ]);
    find(items, 'Fortify').run();
    find(items, 'Go To').run();
    expect(log).toEqual(['fortify', 'selectDestination']);
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
      'Show Map Grid',
      'Show Borders',
      'Show Fog of War',
      'Show Tile Names',
      'Show Tile Owners',
      'Show Tile Regions',
      'Show Side Panel',
      'Full Screen',
    ]);
    find(items, 'Zoom In').run();
    find(items, 'Zoom Out').run();
    find(items, 'Center on Active Unit').run();
    find(items, 'Europe').run();
    for (const l of [
      'Show Map Grid',
      'Show Borders',
      'Show Fog of War',
      'Show Tile Names',
      'Show Tile Owners',
      'Show Tile Regions',
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
      'mode grid',
      'mode borders',
      'fog',
      'tileText 1',
      'tileText 2',
      'tileText 3',
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
