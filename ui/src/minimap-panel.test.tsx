// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
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
});
