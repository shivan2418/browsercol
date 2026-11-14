// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { END_TURN, InfoPanel } from './info-panel';
import { MenuBar, type Menu } from './frame';
import { MinimapPanel } from './minimap-panel';
import type { ActiveUnit } from './tileset';
import type { MapView } from './tileset';

// The phone map screen's parts (docs/adr/0012, #511): the screen is small while matchMedia says so.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the menu bar on a small screen', () => {
  const ran: string[] = [];
  const menus: Menu[] = [
    {
      name: 'Game',
      items: [
        { label: 'Save', run: () => ran.push('save') },
        { label: 'More', run: () => {}, sub: [{ label: 'Deep', run: () => ran.push('deep') }] },
      ],
    },
    { name: 'Report', items: [{ label: 'Labour', run: () => ran.push('labour') }] },
    { name: 'Colopedia', items: [] },
  ];

  it('folds the menus into one button that opens them as a list with their entries under their names', () => {
    render(<MenuBar menus={menus} status="Score 5" />);
    expect(screen.queryByRole('menuitem', { name: 'Game' })).toBeNull();
    expect(screen.getByText('Score 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    // A menu with no entries is not listed; the others open on their name.
    expect(screen.queryByRole('menuitem', { name: /Colopedia/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Save' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Game/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /More/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deep' }));
    expect(ran).toEqual(['deep']);
    // A pick closes the list.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on a press elsewhere', () => {
    render(<MenuBar menus={menus} status="" />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the info panel on a small screen', () => {
  const unit = {
    id: 'unit:1',
    label: 'Dutch Soldier',
    moves: '1/1',
    status: 'Moves: 1/1',
    keys: [],
    units: [],
    goods: [],
    path: null,
  } as ActiveUnit;

  it('is a strip with the unit, and End Turn is a button of its own that ends the turn', () => {
    const end = vi.fn();
    render(<InfoPanel unit={unit} idle={false} art={() => null} centre={() => {}} endTurnNow={end} />);
    expect(document.querySelector('#info-panel.strip')).not.toBeNull();
    expect(screen.getByText('Dutch Soldier')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: END_TURN.button }));
    expect(end).toHaveBeenCalledOnce();
  });

  it('marks End Turn while no unit is left to move', () => {
    render(<InfoPanel unit={null} idle art={() => null} centre={() => {}} endTurnNow={() => {}} />);
    expect(screen.getByRole('button', { name: END_TURN.button }).hasAttribute('data-idle')).toBe(true);
  });
});

describe('the minimap on a small screen', () => {
  const map = { w: 40, h: 100, types: [], tiles: '', seen: '', owners: '', players: [], settlements: [], units: [] };
  const show = () =>
    render(
      <MinimapPanel
        map={map as unknown as MapView}
        res={null}
        view={{ centre: [0, 0], viewport: [640, 480], zoom: 1 }}
        options={{ borders: true, fog: true, background: 0, zoom: 2 }}
        centre={() => {}}
        setOption={() => {}}
      />,
    );

  it('is hidden until its toggle is pressed, and the choice is kept', () => {
    show();
    expect(document.getElementById('minimap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    expect(document.getElementById('minimap')).not.toBeNull();
    cleanup();
    show();
    expect(document.getElementById('minimap')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    expect(document.getElementById('minimap')).toBeNull();
  });

  it('still works when the browser has no storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    expect(document.getElementById('minimap')).not.toBeNull();
  });
});
