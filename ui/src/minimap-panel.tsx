// FreeCol's minimap in its corner of the map (CornerMapControls): the map
// drawn small (minimap.ts), with the buttons beside it that switch its
// borders and fog of war and zoom it. Pressing on it, or dragging, centres
// the map view there. Each button keeps its client option, as FreeCol's do.
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BACKGROUNDS,
  imageSize,
  MAX_ZOOM,
  MIN_ZOOM,
  minimapTiles,
  paintMinimap,
  placement,
  pointAt,
  tileSize,
  type MinimapOptions,
  type ViewBox,
} from './minimap';
import type { Resources } from './resources';
import type { MapView } from './tileset';

/** The minimap's size, as image.skin.MiniMap.properties gives it. */
const BOX: [number, number] = [224, 160];

export interface MinimapProps {
  /** The last map view; null before the game starts, when no minimap shows. */
  map: MapView | null;
  /** The Tileset's resources, for the colours; null until they have loaded. */
  res: Resources | null;
  view: ViewBox;
  options: MinimapOptions;
  /** Centre the map view on a map point, at zoom 1. */
  centre: (at: [number, number]) => void;
  /** Keep a client option the buttons change. */
  setOption: (id: string, value: boolean | number) => void;
}

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

export function MinimapPanel({ map, res, view, options, centre, setOption }: MinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = tileSize(options.zoom);
  const background = BACKGROUNDS[options.background] ?? BACKGROUNDS[0];
  const { borders, fog, zoom } = options;
  // The whole map drawn once per map view and options (MiniMap's prerendered image); the view only moves it.
  const image = useMemo(() => {
    if (!map || !res) return null;
    const [w, h] = imageSize(map, size);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    paintMinimap(g, minimapTiles(map, res, { borders, fog, zoom, background: 0 }), size, [w, h], background);
    return c;
  }, [map, res, borders, fog, zoom, size, background]);

  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const ratio = window.devicePixelRatio || 1;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = hex(background);
    g.fillRect(0, 0, ...BOX);
    if (!image) return;
    const { image: at, visible } = placement(view, BOX, size);
    g.drawImage(image, Math.round(at[0]), Math.round(at[1]));
    g.strokeStyle = hex(res?.color('color.border.MiniMap', 0xffffff) ?? 0xffffff);
    g.lineWidth = 1;
    g.strokeRect(
      Math.round(visible[0]) + 0.5,
      Math.round(visible[1]) + 0.5,
      Math.round(visible[2]),
      Math.round(visible[3]),
    );
  }, [image, view, size, background, res]);

  if (!map) return null;
  const focus = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    centre(pointAt(view, BOX, size, [e.clientX - r.left, e.clientY - r.top]));
  };
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return (
    <div id="minimap" className="minimap">
      <div className="minimap-buttons">
        <button
          title="Toggle the view between political and economic"
          aria-label="Toggle the view between political and economic"
          aria-pressed={options.borders}
          onClick={() => setOption('model.option.miniMapToggleBorders', !options.borders)}
        >
          ⚑
        </button>
        <button
          title="Toggle fog of war"
          aria-label="Toggle fog of war"
          aria-pressed={options.fog}
          onClick={() => setOption('model.option.miniMapToggleFogOfWar', !options.fog)}
        >
          ◐
        </button>
        <button
          title="Zoom in"
          aria-label="Zoom in"
          disabled={options.zoom >= MAX_ZOOM}
          onClick={() => setOption('model.option.defaultZoomLevel', options.zoom + 1)}
        >
          +
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          disabled={options.zoom <= MIN_ZOOM}
          onClick={() => setOption('model.option.defaultZoomLevel', options.zoom - 1)}
        >
          −
        </button>
      </div>
      <canvas
        ref={canvas}
        width={BOX[0] * ratio}
        height={BOX[1] * ratio}
        style={{ width: BOX[0], height: BOX[1], touchAction: 'none' }}
        aria-label="Minimap"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          focus(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) focus(e);
        }}
      />
    </div>
  );
}
