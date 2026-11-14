// FreeCol's minimap in its corner of the map (CornerMapControls): the map
// drawn small (minimap.ts), with the buttons beside it that switch its
// borders and fog of war and zoom it. Pressing on it, or dragging, centres
// the map view there. Each button keeps its client option, as FreeCol's do. Once the art has them, FreeCol's
// skin goes over it all, a desk with a globe whose legs frame the minimap, and the buttons are FreeCol's
// pictures on the left leg, where image.skin.MiniMap.properties puts them.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useCompact } from './compact';
import { Tip } from './controls';
import { cssUrl, type Art } from './frame';
import {
  BACKGROUNDS,
  css,
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
import { PANEL_KEY_FAMILIES, PANEL_KEYS } from './map-keys';
import type { Resources } from './resources';
import type { MapView } from './tileset';
import './minimap-panel.css';

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
  /** The image for resource keys, for the skin and the buttons' pictures; none draws plain buttons. */
  art?: Art;
}

/** ImageLibrary.getButtonImages: a button's picture per state, as CSS custom properties; null without the art. */
function buttonPictures(art: Art, name: string): CSSProperties | null {
  const states = ['normal', 'highlighted', 'pressed', 'disabled'] as const;
  const srcs = states.map((state) => art([`${PANEL_KEY_FAMILIES.button}${state}.${name}`]));
  if (srcs.some((src) => !src)) return null;
  return Object.fromEntries(states.map((state, i) => [`--${state}`, cssUrl(srcs[i] as string)])) as CSSProperties;
}

const SHOWN_KEY = 'browsercol.minimap-shown';

/** Whether a small screen shows the minimap (docs/adr/0012): off until the player turns it on, kept in this browser. */
export function useMinimapShown(): [boolean, (shown: boolean) => void] {
  const [shown, set] = useState(() => {
    try {
      return localStorage.getItem(SHOWN_KEY) === '1';
    } catch {
      return false;
    }
  });
  return [
    shown,
    (next) => {
      set(next);
      try {
        localStorage.setItem(SHOWN_KEY, next ? '1' : '0');
      } catch {
        // No storage: it is for this visit only.
      }
    },
  ];
}

export function MinimapPanel({ map, res, view, options, centre, setOption, art = () => null }: MinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const compact = useCompact();
  const [shown, show] = useMinimapShown();
  const size = tileSize(options.zoom);
  const background = BACKGROUNDS[options.background] ?? BACKGROUNDS[0];
  const { borders, fog } = options;
  // The whole map drawn once per map view and options (MiniMap's prerendered image); the view only moves it.
  const image = useMemo(() => {
    if (!map || !res) return null;
    const [w, h] = imageSize(map, size);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    paintMinimap(g, minimapTiles(map, res, { borders, fog }), size, [w, h], background);
    return c;
  }, [map, res, borders, fog, size, background]);

  // The page passes a new view for every change, the hovered tile's too: the minimap is drawn again only when what
  // it shows of the view moved.
  const [cx, cy] = view.centre;
  const [vw, vh] = view.viewport;
  const { zoom } = view;
  useEffect(() => {
    const view = { centre: [cx, cy] as [number, number], viewport: [vw, vh] as [number, number], zoom };
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const ratio = window.devicePixelRatio || 1;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = css(background);
    g.fillRect(0, 0, ...BOX);
    if (!image) return;
    const { image: at, visible } = placement(view, BOX, size);
    g.drawImage(image, Math.round(at[0]), Math.round(at[1]));
    g.strokeStyle = css(res?.color(PANEL_KEYS.minimapBorder, 0xffffff) ?? 0xffffff);
    g.lineWidth = 1;
    g.strokeRect(
      Math.round(visible[0]) + 0.5,
      Math.round(visible[1]) + 0.5,
      Math.round(visible[2]),
      Math.round(visible[3]),
    );
  }, [image, cx, cy, vw, vh, zoom, size, background, res]);

  if (!map) return null;
  const focus = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    centre(pointAt(view, BOX, size, [e.clientX - r.left, e.clientY - r.top]));
  };
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const skin = art([PANEL_KEYS.minimapSkin]);
  // The pictures FreeCol's minimap actions show: the borders' and the fog's follow their option.
  const pictures = {
    borders: buttonPictures(art, options.borders ? 'toggle_view_politics' : 'toggle_view_economic'),
    fog: buttonPictures(art, options.fog ? 'toggle_fog_of_war' : 'toggle_fog_of_war_no'),
    zoomIn: buttonPictures(art, 'zoom_in'),
    zoomOut: buttonPictures(art, 'zoom_out'),
  };
  const pictured = !compact && skin !== null && Object.values(pictures).every(Boolean);
  const look = (picture: CSSProperties | null) => (pictured ? { className: 'pictured', style: picture! } : {});
  const box = (
    <div
      id="minimap"
      className={pictured ? 'skinned' : undefined}
      style={pictured ? ({ '--skin': cssUrl(skin) } as CSSProperties) : undefined}
    >
      <div className="minimap-buttons">
        <Tip
          as="button"
          tip="Toggle the view between political and economic"
          aria-label="Toggle the view between political and economic"
          aria-pressed={options.borders}
          onClick={() => setOption('model.option.miniMapToggleBorders', !options.borders)}
          {...look(pictures.borders)}
        >
          {!pictured && '⚑'}
        </Tip>
        <Tip
          as="button"
          tip="Toggle fog of war"
          aria-label="Toggle fog of war"
          aria-pressed={options.fog}
          onClick={() => setOption('model.option.miniMapToggleFogOfWar', !options.fog)}
          {...look(pictures.fog)}
        >
          {!pictured && '◐'}
        </Tip>
        <Tip
          as="button"
          tip="Zoom in"
          aria-label="Zoom in"
          disabled={options.zoom >= MAX_ZOOM}
          onClick={() => setOption('model.option.defaultZoomLevel', options.zoom + 1)}
          {...look(pictures.zoomIn)}
        >
          {!pictured && '+'}
        </Tip>
        <Tip
          as="button"
          tip="Zoom out"
          aria-label="Zoom out"
          disabled={options.zoom <= MIN_ZOOM}
          onClick={() => setOption('model.option.defaultZoomLevel', options.zoom - 1)}
          {...look(pictures.zoomOut)}
        >
          {!pictured && '−'}
        </Tip>
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
      {pictured && <div className="minimap-skin" aria-hidden="true" />}
    </div>
  );
  if (!compact) return box;
  return (
    <>
      {shown && box}
      <button
        type="button"
        id="minimap-toggle"
        aria-label="Minimap"
        aria-pressed={shown}
        aria-controls="minimap"
        onClick={() => show(!shown)}
      >
        Map
      </button>
    </>
  );
}
