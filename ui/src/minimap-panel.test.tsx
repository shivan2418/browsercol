// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Art } from './frame';
import type { MinimapOptions } from './minimap';
import { MinimapPanel, type MinimapProps } from './minimap-panel';
import type { MapView } from './tileset';

// jsdom has no 2D canvas: the panel then draws nothing, which is all these tests need.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const map = { w: 40, h: 100, types: [], tiles: '', seen: '', owners: '', players: [], settlements: [], units: [] };
const OPTIONS: MinimapOptions = { borders: true, fog: true, background: 0, zoom: 2 };

function panel(more: Partial<MinimapProps> = {}) {
  const set: [string, boolean | number][] = [];
  const centred: [number, number][] = [];
  render(
    <MinimapPanel
      map={map as unknown as MapView}
      res={null}
      view={{ centre: [1344, 672], viewport: [640, 480], zoom: 1 }}
      options={OPTIONS}
      centre={(at) => centred.push(at)}
      setOption={(id, v) => set.push([id, v])}
      {...more}
    />,
  );
  return { set, centred };
}
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('the minimap panel', () => {
  it('switches the borders and the fog of war, keeping each as its option', () => {
    const { set } = panel();
    fireEvent.click(button(/political and economic/));
    fireEvent.click(button(/fog of war/));
    expect(set).toEqual([
      ['model.option.miniMapToggleBorders', false],
      ['model.option.miniMapToggleFogOfWar', false],
    ]);
  });

  it('zooms by a level, kept as the default zoom level option, but no further than FreeCol does', () => {
    const { set } = panel();
    fireEvent.click(button(/Zoom in/));
    fireEvent.click(button(/Zoom out/));
    expect(set).toEqual([
      ['model.option.defaultZoomLevel', 3],
      ['model.option.defaultZoomLevel', 1],
    ]);
    cleanup();
    panel({ options: { ...OPTIONS, zoom: 6 } });
    expect(button(/Zoom in/).disabled).toBe(true);
    cleanup();
    panel({ options: { ...OPTIONS, zoom: 1 } });
    expect(button(/Zoom out/).disabled).toBe(true);
  });

  it('centres the map where the player presses on it', () => {
    const { centred } = panel();
    const canvas = document.querySelector('#minimap canvas')!;
    // The canvas is 224x160: its centre is the map view's.
    fireEvent.pointerDown(canvas, { clientX: 122, clientY: 70, button: 0 });
    expect(centred).toEqual([[1344 + 160, 672 - 160]]);
  });

  it('shows nothing before there is a map', () => {
    panel({ map: null });
    expect(document.querySelector('#minimap')).toBeNull();
  });

  it("puts FreeCol's skin over it, with its pictures on the buttons, once the art has them", () => {
    const art: Art = (keys) => (keys[0].startsWith('image.') ? `art/${keys[0]}.png` : null);
    panel({ art, options: { ...OPTIONS, borders: false, zoom: 4 } });
    expect(document.getElementById('minimap')?.classList.contains('skinned')).toBe(true);
    const borders = button(/political and economic/);
    expect(borders.textContent).toBe('');
    expect(borders.style.getPropertyValue('--normal')).toBe(
      `url("${new URL('art/image.miscicon.button.normal.toggle_view_economic.png', document.baseURI).href}")`,
    );
    expect(button(/fog of war/).style.getPropertyValue('--disabled')).toBe(
      `url("${new URL('art/image.miscicon.button.disabled.toggle_fog_of_war.png', document.baseURI).href}")`,
    );
  });

  it('keeps its plain buttons while the art lacks a picture', () => {
    const art: Art = (keys) => (keys[0].includes('zoom_out') ? null : `art/${keys[0]}.png`);
    panel({ art });
    expect(document.getElementById('minimap')?.classList.contains('skinned')).toBe(false);
    expect(button(/Zoom out/).textContent).toBe('−');
  });
});
