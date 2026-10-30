// The map's view state, in one place: where the view is centred and at what
// zoom, the active unit, the selected tile and the tile under the pointer.
// reduce() takes the WebGUI's events (webgui.ts), the client Engine's map
// views and the player's pans, zooms and pointer moves, and follows the
// active unit as SwingGUI does. map.ts draws what it says.
import type { GuiEvents, Id } from './webgui';
import type { MapView } from './tileset';

/** FreeCol's tiles: 128x64 diamonds in staggered rows, odd rows half a tile to the right. */
export const W = 128;
export const H = 64;

export type Tile = [number, number];

/** Where a tile's 128x64 box starts on the whole map, at zoom 1. */
export const tileOrigin = (x: number, y: number): Tile => [x * W + (y % 2) * (W / 2), (y * H) / 2];
const tileCentre = ([x, y]: Tile): [number, number] => {
  const [ox, oy] = tileOrigin(x, y);
  return [ox + W / 2, oy + H / 2];
};

const sameTile = (a: Tile | null, b: Tile | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/** What the view uses of a map view. */
export type MapFacts = Pick<MapView, 'w' | 'h' | 'types' | 'tiles' | 'owners' | 'players' | 'active' | 'activeUnit'>;

export interface ViewState {
  map: MapFacts | null;
  /** The viewport's size in screen pixels. */
  viewport: [number, number];
  /** The map point at the viewport's centre, in map pixels at zoom 1. */
  centre: [number, number];
  zoom: number;
  active: { unit: Id; tile: Tile | null } | null;
  /** The selected tile, which comes along with the active unit. */
  selected: Tile | null;
  /** SwingGUI's view modes: moving units, or looking at a tile (terrain). */
  mode: 'units' | 'terrain';
  /** The tile under the pointer. */
  hover: Tile | null;
}

export type ViewEvent =
  | ({ k: 'activeUnit' } & GuiEvents['activeUnit'])
  | ({ k: 'selectedTile' } & GuiEvents['selectedTile'])
  | ({ k: 'focus' } & GuiEvents['focus'])
  | { k: 'map'; map: MapFacts }
  | { k: 'resize'; width: number; height: number }
  /** The player dragged the map, or scrolled at its edge, by screen pixels. */
  | { k: 'pan'; dx: number; dy: number }
  /** Zoom levels in (+) or out (-), keeping the map under a viewport point still. */
  | { k: 'zoom'; steps: number; at: [number, number] }
  /** The pointer is over a tile, or off the map. */
  | { k: 'hover'; at: Tile | null };

/** The zoom levels, as scales of FreeCol's 128x64 tiles. */
export const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2];

export const initialView: ViewState = {
  map: null,
  viewport: [0, 0],
  centre: [0, 0],
  zoom: 1,
  active: null,
  selected: null,
  mode: 'units',
  hover: null,
};

/** The whole map's size in pixels at zoom 1. */
export const mapSize = (m: { w: number; h: number }): [number, number] => [(m.w + 0.5) * W, ((m.h + 1) * H) / 2];

/** Keep the view on the map, once both sizes are known; a map smaller than the view sits in its middle. */
function clamp(v: ViewState): ViewState {
  if (!v.map || !v.viewport[0]) return v;
  const size = mapSize(v.map);
  const centre = v.centre.map((c, i) => {
    const half = v.viewport[i] / 2 / v.zoom;
    return half * 2 >= size[i] ? size[i] / 2 : Math.min(size[i] - half, Math.max(half, c));
  }) as [number, number];
  return centre[0] === v.centre[0] && centre[1] === v.centre[1] ? v : { ...v, centre };
}

/** Whether a tile's centre is in view. */
function onScreen(v: ViewState, at: Tile) {
  const c = tileCentre(at);
  return c.every((p, i) => Math.abs(p - v.centre[i]) <= v.viewport[i] / 2 / v.zoom);
}

/** Where MapViewer draws its cursor: image.tile.unitSelect on the active unit, tileSelect on a selected tile. */
export function cursor(v: ViewState): { at: Tile; kind: 'unit' | 'tile' } | null {
  if (v.mode === 'terrain') return v.selected && { at: v.selected, kind: 'tile' };
  return v.active?.tile ? { at: v.active.tile, kind: 'unit' } : null;
}

export interface Panel {
  /** The active unit, once a map view about it has come. */
  unit: { label: string; moves: string; cargo: string[] } | null;
  /** The hovered tile: its type's name (null if unexplored) and owner. */
  tile: { name: string | null; owner: { name: string; rgb: number } | null } | null;
}

/** What the info panel shows, as FreeCol's InfoPanel does for the unit and the tile. */
export function panel(v: ViewState): Panel {
  const m = v.map;
  const u = m?.activeUnit;
  const unit = u && u.id === v.active?.unit ? { label: u.label, moves: u.moves, cargo: u.cargo } : null;
  if (!m || !v.hover) return { unit, tile: null };
  const i = v.hover[1] * m.w + v.hover[0];
  const type = m.types[m.tiles.charCodeAt(i) - 65];
  const owner = m.players[m.owners.charCodeAt(i) - 65];
  return { unit, tile: { name: type?.name ?? null, owner: owner ?? null } };
}

export const reduce = (v: ViewState, e: ViewEvent): ViewState => clamp(apply(v, e));

function apply(v: ViewState, e: ViewEvent): ViewState {
  switch (e.k) {
    case 'activeUnit': {
      // SwingGUI.changeView(Unit): the selected tile comes along, in focus.
      const active = e.unit ? { unit: e.unit, tile: e.at } : null;
      const moved = { ...v, active, mode: 'units' as const, selected: e.at ?? v.selected };
      return e.at ? { ...moved, centre: tileCentre(e.at) } : moved;
    }
    case 'selectedTile': {
      // SwingGUI.changeView(Tile): refocus only if the tile is out of view.
      const selected = { ...v, mode: 'terrain' as const, selected: e.at };
      return e.at && !onScreen(v, e.at) ? { ...selected, centre: tileCentre(e.at) } : selected;
    }
    case 'focus':
      return e.at ? { ...v, centre: tileCentre(e.at) } : v;
    case 'map': {
      // The active unit moved: follow it, as its changeView would.
      const at = e.map.active;
      const moved = v.active && e.map.activeUnit?.id === v.active.unit && at && !sameTile(at, v.active.tile);
      return moved
        ? { ...v, map: e.map, active: { ...v.active!, tile: at }, selected: at, centre: tileCentre(at) }
        : { ...v, map: e.map };
    }
    case 'resize':
      return { ...v, viewport: [e.width, e.height] };
    case 'pan':
      return { ...v, centre: [v.centre[0] - e.dx / v.zoom, v.centre[1] - e.dy / v.zoom] };
    case 'hover':
      return { ...v, hover: e.at };
    case 'zoom': {
      const level = ZOOMS.indexOf(v.zoom) + e.steps;
      const zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, level))];
      const [ax, ay] = [e.at[0] - v.viewport[0] / 2, e.at[1] - v.viewport[1] / 2];
      const [mx, my] = [v.centre[0] + ax / v.zoom, v.centre[1] + ay / v.zoom];
      return { ...v, zoom, centre: [mx - ax / zoom, my - ay / zoom] };
    }
  }
}
