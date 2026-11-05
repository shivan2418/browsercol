// The map's view state, in one place: where the view is centred and at what
// zoom, the active unit, the selected tile and the tile under the pointer.
// reduce() takes the WebGUI's events (webgui.ts), the client Engine's map
// views and the player's pans, zooms and pointer moves, and follows the
// active unit as SwingGUI does. map.ts draws what it says.
import type { GuiEvents, Id } from './webgui';
import {
  NO_MODES,
  NO_OVERLAY,
  type ActiveUnit,
  type DebugOverlay,
  type MapView,
  type PathStep,
  type TileText,
  type ViewModes,
} from './tileset';

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
  /** The View menu's switches: the map grid, the borders and the tiles' names. */
  modes: ViewModes;
  /** The Debug menu's text and tints over the map (debug mode only). */
  overlay: DebugOverlay;
  /** The tile under the pointer. */
  hover: Tile | null;
  /** The path the active unit would take to the tile the player holds the pointer on, drawn until release. */
  preview: PathStep[] | null;
}

export type ViewEvent =
  // jump: FreeCol's jump to active unit option; off, the view moves only for a unit out of it.
  | ({ k: 'activeUnit'; jump?: boolean } & GuiEvents['activeUnit'])
  // always: FreeCol's always center option, a selected tile centred even when in view.
  | ({ k: 'selectedTile'; always?: boolean } & GuiEvents['selectedTile'])
  | ({ k: 'focus' } & GuiEvents['focus'])
  | { k: 'map'; map: MapFacts }
  | { k: 'resize'; width: number; height: number }
  /** The player dragged the map, or scrolled at its edge, by screen pixels. */
  | { k: 'pan'; dx: number; dy: number }
  /** Centre on a map point at zoom 1: the player clicked or dragged on the minimap. */
  | { k: 'centre'; at: [number, number] }
  /** Zoom levels in (+) or out (-), keeping the map under a viewport point still. */
  | { k: 'zoom'; steps: number; at: [number, number] }
  /** The player switched the grid, the borders or the tile names on or off. */
  | { k: 'toggle'; mode: 'grid' | 'borders' }
  | { k: 'tileText'; text: TileText }
  /** The Debug menu's overlay changed. */
  | { k: 'overlay'; overlay: DebugOverlay }
  /** The pointer is over a tile, or off the map. */
  | { k: 'hover'; at: Tile | null }
  /** The goto path under the held pointer, or none once it is released. */
  | { k: 'preview'; path: PathStep[] | null };

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
  modes: NO_MODES,
  overlay: NO_OVERLAY,
  hover: null,
  preview: null,
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

/** A viewport pixel's map point, at zoom 1. */
export const toMap = (v: ViewState, [px, py]: [number, number]): [number, number] => [
  v.centre[0] + (px - v.viewport[0] / 2) / v.zoom,
  v.centre[1] + (py - v.viewport[1] / 2) / v.zoom,
];

/** Where a map point shows in the viewport. */
export const toScreen = (v: ViewState, [mx, my]: [number, number]): [number, number] => [
  (mx - v.centre[0]) * v.zoom + v.viewport[0] / 2,
  (my - v.centre[1]) * v.zoom + v.viewport[1] / 2,
];

/** Where a tile's centre shows in the viewport. */
export const tileOnScreen = (v: ViewState, at: Tile) => toScreen(v, tileCentre(at));

const sameTile = (a: Tile, b: Tile | null) => !!b && a[0] === b[0] && a[1] === b[1];

/** Whether a tile's centre is in view. */
function onScreen(v: ViewState, at: Tile) {
  const c = tileCentre(at);
  return c.every((p, i) => Math.abs(p - v.centre[i]) <= v.viewport[i] / 2 / v.zoom);
}

/** How near, in pixels, the pointer must be to the viewport's edge to scroll the map. */
const EDGE = 24;

/** Which way the pointer at a viewport pixel scrolls the map: +1, -1 or 0 on each axis. */
export const edgeScroll = ([px, py]: [number, number], [w, h]: [number, number]): [number, number] => [
  px < EDGE ? 1 : px > w - EDGE ? -1 : 0,
  py < EDGE ? 1 : py > h - EDGE ? -1 : 0,
];

/** MapViewer's cursor: on the active unit, or on a selected tile in terrain mode. */
export interface Cursor {
  at: Tile;
  kind: 'unit' | 'tile';
}

/** Where MapViewer draws its cursor: image.tile.unitSelect on the active unit, tileSelect on a selected tile. */
export function cursor(v: ViewState): Cursor | null {
  if (v.mode === 'terrain') return v.selected && { at: v.selected, kind: 'tile' };
  return v.active?.tile ? { at: v.active.tile, kind: 'unit' } : null;
}

export interface Panel {
  /** The active unit, once a map view about it has come. */
  unit: ActiveUnit | null;
  /** The hovered tile: its type's name (null if unexplored) and owner. */
  tile: { name: string | null; owner: { name: string; rgb: number } | null } | null;
}

/** The map view's facts about the active unit, or null if the map view is about another unit or none. */
export function activeUnitFacts(v: ViewState): ActiveUnit | null {
  const u = v.map?.activeUnit;
  return u && u.id === v.active?.unit ? u : null;
}

/** What the info panel shows, as FreeCol's InfoPanel does for the unit and the tile. */
export function panel(v: ViewState): Panel {
  const m = v.map;
  const unit = activeUnitFacts(v);
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
      // SwingGUI.changeView(Unit, force): unforced, the selected tile comes
      // along, in focus; forced, the view moves only for a unit out of it.
      // changeView() ends the turn with neither unit nor selection.
      // A new active unit clears the path Show search drew (SwingGUI.changeView sets the unit path to null).
      if (!e.unit) return { ...v, active: null, mode: 'units', selected: null, preview: null };
      const active = { ...v, active: { unit: e.unit, tile: e.at }, mode: 'units' as const, preview: null };
      if (!e.at) return active;
      if (e.force) return onScreen(v, e.at) ? active : { ...active, centre: tileCentre(e.at) };
      if (e.jump === false)
        return { ...active, selected: e.at, ...(onScreen(v, e.at) ? {} : { centre: tileCentre(e.at) }) };
      return { ...active, selected: e.at, centre: tileCentre(e.at) };
    }
    case 'selectedTile': {
      // SwingGUI.changeView(Tile): refocus only if the tile is out of view, unless always centring.
      const selected = { ...v, mode: 'terrain' as const, selected: e.at };
      return e.at && (e.always || !onScreen(v, e.at)) ? { ...selected, centre: tileCentre(e.at) } : selected;
    }
    case 'focus':
      return e.at ? { ...v, centre: tileCentre(e.at) } : v;
    case 'map': {
      // The camera follows the active unit: when its map view puts it on a new tile, it moves there,
      // and the view moves with it once it is out of view.
      const at = e.map.active;
      const moved = at && v.active && e.map.activeUnit?.id === v.active.unit && !sameTile(at, v.active.tile);
      if (!moved) return { ...v, map: e.map };
      const next = { ...v, map: e.map, active: { ...v.active!, tile: at } };
      return onScreen(v, at) ? next : { ...next, centre: tileCentre(at) };
    }
    case 'resize':
      return { ...v, viewport: [e.width, e.height] };
    case 'pan':
      return { ...v, centre: [v.centre[0] - e.dx / v.zoom, v.centre[1] - e.dy / v.zoom] };
    case 'centre':
      return { ...v, centre: e.at };
    case 'toggle':
      return { ...v, modes: { ...v.modes, [e.mode]: !v.modes[e.mode] } };
    case 'tileText':
      return { ...v, modes: { ...v.modes, tileText: e.text } };
    case 'overlay':
      return { ...v, overlay: e.overlay };
    case 'hover':
      return { ...v, hover: e.at };
    case 'preview':
      return { ...v, preview: e.path };
    case 'zoom': {
      const level = ZOOMS.indexOf(v.zoom) + e.steps;
      const zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, level))];
      const [mx, my] = toMap(v, e.at);
      const [ax, ay] = [e.at[0] - v.viewport[0] / 2, e.at[1] - v.viewport[1] / 2];
      return { ...v, zoom, centre: [mx - ax / zoom, my - ay / zoom] };
    }
  }
}
