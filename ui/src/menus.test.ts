import { describe, expect, it } from 'vitest';
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
    ...over,
  };
  return { a, log };
}
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const find = (items: { label: string; run: () => void; disabled?: boolean }[], label: string) =>
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
    for (const l of ['New', 'Open', 'Save', 'Show Game Options', 'End Turn']) find(items, l).run();
    expect(log).toEqual(['newGame', 'open', 'save', 'showGameOptions', 'endTurn']);
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual(['Preferences', 'Reconnect', 'Retire', 'Quit']);
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
  it('zooms, centres and opens Europe; the display modes wait', () => {
    const { a, log } = actions({ hasActiveUnit: true });
    const items = viewMenu(a);
    expect(labels(items)).toEqual([
      'Zoom In',
      'Zoom Out',
      'Center on Active Unit',
      'Europe',
      'Show Map Grid',
      'Show Borders',
      'Show Tile Names',
      'Full Screen',
    ]);
    find(items, 'Zoom In').run();
    find(items, 'Zoom Out').run();
    find(items, 'Center on Active Unit').run();
    find(items, 'Europe').run();
    expect(log).toEqual(['zoom 1', 'zoom -1', 'centre', 'showEurope']);
    expect(items.filter((i) => i.disabled).map((i) => i.label)).toEqual([
      'Show Map Grid',
      'Show Borders',
      'Show Tile Names',
      'Full Screen',
    ]);
  });

  it('disables centring without an active unit', () => {
    expect(find(viewMenu(actions().a), 'Center on Active Unit').disabled).toBe(true);
  });
});
