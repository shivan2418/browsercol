// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Art } from './frame';
import { END_TURN, InfoPanel } from './info-panel';
import type { ActiveUnit } from './tileset';

afterEach(cleanup);

const art: Art = (keys) =>
  keys[0]?.startsWith('image.') && !keys[0].startsWith('image.skin.') ? `art/${keys[0]}.png` : null;

const soldier: ActiveUnit = {
  id: 'unit:1',
  label: 'Dutch Soldier (Free Colonist/50 Muskets)',
  moves: '1/1',
  status: 'Moves: 1/1',
  keys: ['image.unit.model.unit.freeColonist.soldier'],
  units: [],
  goods: [],
  path: null,
};

const caravel: ActiveUnit = {
  ...soldier,
  id: 'unit:2',
  label: 'Caravel',
  status: 'Moves: 4/4',
  keys: ['image.unit.model.unit.caravel'],
  units: [{ name: 'Dutch Free Colonist', keys: ['image.unit.model.unit.freeColonist'] }],
  goods: [{ name: '100 Food', amount: 100, keys: ['image.icon.model.goods.food'] }],
};

function shown(props: Partial<Parameters<typeof InfoPanel>[0]>) {
  const calls = { centre: 0, end: 0 };
  render(
    <InfoPanel
      unit={null}
      idle={false}
      art={art}
      centre={() => calls.centre++}
      endTurnNow={() => calls.end++}
      {...props}
    />,
  );
  return { calls, panel: screen.getByRole('region', { name: 'Information' }) };
}

describe('the info panel', () => {
  it('shows the active unit: its picture, description and moves', () => {
    const { panel } = shown({ unit: soldier });
    expect(panel.querySelector('.info-picture img')?.getAttribute('src')).toBe(
      'art/image.unit.model.unit.freeColonist.soldier.png',
    );
    expect(panel.textContent).toContain('Dutch Soldier (Free Colonist/50 Muskets)');
    expect(panel.textContent).toContain('Moves: 1/1');
    expect(within(panel).queryByRole('list')).toBeNull();
  });

  it("shows a carrier's units and goods aboard", () => {
    const { panel } = shown({ unit: caravel });
    const units = within(panel).getByRole('list', { name: 'Units aboard' });
    expect(within(units).getByRole('img', { name: 'Dutch Free Colonist' })).toBeTruthy();
    const goods = within(panel).getByRole('list', { name: 'Goods aboard' });
    expect(within(goods).getByRole('img', { name: '100 Food' })).toBeTruthy();
    expect(goods.textContent).toBe('100');
  });

  it('centres the map on the unit when pressed', () => {
    const { panel, calls } = shown({ unit: soldier });
    fireEvent.pointerDown(panel);
    expect(calls.centre).toBe(1);
  });

  it('says to end the turn, with a button, once no unit is left to move', () => {
    const { panel, calls } = shown({ idle: true, endTurn: { text: 'Press enter to end.', button: 'End Turn' } });
    expect(panel.textContent).toContain('Press enter to end.');
    fireEvent.click(within(panel).getByRole('button', { name: 'End Turn' }));
    expect(calls.end).toBe(1);
  });

  it("has FreeCol's skin behind it once the art has it", () => {
    const skinArt: Art = (keys) => (keys[0] === 'image.skin.InfoPanel' ? 'art/infopanel-skin.png' : art(keys));
    const { panel } = shown({ unit: soldier, art: skinArt });
    expect(panel.classList.contains('skinned')).toBe(true);
    expect(panel.style.getPropertyValue('--skin')).toBe('url("art/infopanel-skin.png")');
    cleanup();
    expect(shown({ idle: true }).panel.classList.contains('skinned')).toBe(false);
  });

  it("falls back to FreeCol's English, and is empty while there is neither a unit nor the end of the turn", () => {
    shown({ idle: true });
    expect(screen.getByRole('region').textContent).toContain(END_TURN.text);
    cleanup();
    const { panel } = shown({});
    expect(panel.textContent).toBe('');
  });
});
