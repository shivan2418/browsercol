// FreeCol's minimap (MiniMap.java): the whole map drawn small, a diamond per
// explored tile in its type's colour, centred on what the map view shows,
// with a box round that. The player's client options pick political colours
// with the owners over them or economic ones (miniMapToggleBorders), grey the
// tiles out of sight (miniMapToggleFogOfWar), the colour round the map
// (color.background) and the tile size (defaultZoomLevel).
import { PANEL_KEY_FAMILIES } from './map-keys';
import type { Resources } from './resources';
import type { MapView } from './tileset';
import { W } from './view';

export interface MinimapOptions {
  /** miniMapToggleBorders: political colours with the owners over them, rather than economic ones. */
  borders: boolean;
  /** miniMapToggleFogOfWar: the tiles out of sight greyed. */
  fog: boolean;
  /** color.background: an index into BACKGROUNDS. */
  background: number;
  /** defaultZoomLevel: 1 to 6, each 4 pixels of tile width. */
  zoom: number;
}

/**
 * The colours of the color.background option, in its order: black, very dark grey, dark grey, grey, light
 * grey, very light grey and light blue, as FreeCol's MiniMapChangeBackgroundAction.interpretIndex had them when
 * the option came in (FreeCol commit 7f937048f). Today's MiniMap no longer reads the option.
 */
export const BACKGROUNDS: readonly number[] = [0x000000, 0x303030, 0x606060, 0x808080, 0xb0b0b0, 0xe0e0e0, 0xc8c8ff];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/** A tile's width on the minimap: 4 pixels per zoom level, MiniMap's MIN_TILE_SIZE 4 to MAX_TILE_SIZE 24. */
export const tileSize = (zoom: number): number => 4 * Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));

/** The whole map's size on the minimap, as MiniMap.recreateBufferImage makes its image. */
export const imageSize = (m: { w: number; h: number }, size: number): [number, number] => [
  size * m.w + size / 2,
  (size * m.h) / 2 + size / 4,
];

/** What the minimap shows of an explored tile. */
export interface MiniTile {
  x: number;
  y: number;
  /** The tile type's colour. */
  fill: number;
  /** The owner's colour, washed over the tile; null for none, or with the borders off. */
  owner: number | null;
  /** A settlement, or else the unit in front, in its owner's colour. */
  marker: { kind: 'settlement' | 'unit'; rgb: number } | null;
  /** Out of sight, with the fog of war option on. */
  fogged: boolean;
}

/** The explored tiles as MiniMap.paintEntireMinimap paints them, row by row. */
export function minimapTiles(
  m: MapView,
  res: Pick<Resources, 'color'>,
  o: Pick<MinimapOptions, 'borders' | 'fog'>,
): MiniTile[] {
  const family = o.borders ? PANEL_KEY_FAMILIES.minimapPolitics : PANEL_KEY_FAMILIES.minimapEconomic;
  const fills = m.types.map((t) => res.color(family + t.id));
  const at = (x: number, y: number) => y * m.w + x;
  const settlements = new Map(m.settlements.map((s) => [at(s.x, s.y), s.rgb]));
  const units = new Map(m.units.map((u) => [at(u.x, u.y), u.rgb]));
  const out: MiniTile[] = [];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = at(x, y);
      const fill = fills[m.tiles.charCodeAt(i) - 65];
      if (fill === undefined) continue;
      const owner = o.borders ? (m.players[m.owners.charCodeAt(i) - 65]?.rgb ?? null) : null;
      const settlement = settlements.get(i);
      const unit = units.get(i);
      const marker =
        settlement !== undefined
          ? { kind: 'settlement' as const, rgb: settlement }
          : unit !== undefined
            ? { kind: 'unit' as const, rgb: unit }
            : null;
      out.push({ x, y, fill, owner, marker, fogged: o.fog && m.seen[i] !== '1' });
    }
  }
  return out;
}

/** What the minimap needs of the map view: where it is centred, its size and zoom. */
export interface ViewBox {
  centre: [number, number];
  viewport: [number, number];
  zoom: number;
}

/**
 * Where the whole map's image goes in a minimap box, so the map view's centre is the box's (MiniMap.paintMap),
 * and the box round what the map view shows: x, y, width and height.
 */
export function placement(v: ViewBox, box: [number, number], size: number) {
  const s = size / W;
  const image: [number, number] = [box[0] / 2 - v.centre[0] * s, box[1] / 2 - v.centre[1] * s];
  const [w, h] = [(v.viewport[0] / v.zoom) * s, (v.viewport[1] / v.zoom) * s];
  const visible: [number, number, number, number] = [box[0] / 2 - w / 2, box[1] / 2 - h / 2, w, h];
  return { image, visible };
}

/** The map point (at zoom 1) under a point of a minimap box: where a click there centres the view (MiniMap.setFocus). */
export const pointAt = (
  v: ViewBox,
  box: [number, number],
  size: number,
  [px, py]: [number, number],
): [number, number] => [v.centre[0] + ((px - box[0] / 2) * W) / size, v.centre[1] + ((py - box[1] / 2) * W) / size];

/** A 0xRRGGBB colour, and an alpha, as CSS. */
export const css = (rgb: number, alpha = 1) =>
  `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`;

/** Paint the whole map's image, as MiniMap.paintEntireMinimap: diamonds, markers and fog over the background. */
export function paintMinimap(
  g: CanvasRenderingContext2D,
  tiles: MiniTile[],
  size: number,
  [w, h]: [number, number],
  background: number,
) {
  g.fillStyle = css(background);
  g.fillRect(0, 0, w, h);
  const diamond = (ox: number, oy: number, scale: number) => {
    const [tw, th] = [size * scale, (size / 2) * scale];
    const [cx, cy] = [ox + size / 2, oy + size / 4];
    g.beginPath();
    g.moveTo(cx, cy - th / 2);
    g.lineTo(cx + tw / 2, cy);
    g.lineTo(cx, cy + th / 2);
    g.lineTo(cx - tw / 2, cy);
    g.closePath();
  };
  g.lineWidth = 1;
  for (const t of tiles) {
    const ox = t.x * size + (t.y & 1) * (size / 2);
    const oy = (t.y * size) / 4;
    diamond(ox, oy, 1);
    g.fillStyle = css(t.fill);
    g.fill();
    if (t.owner !== null) {
      g.fillStyle = css(t.owner, 100 / 255);
      g.fill();
    }
    if (t.marker) {
      diamond(ox, oy, t.marker.kind === 'settlement' ? 0.7 : 0.5);
      g.strokeStyle = '#000';
      g.stroke();
      g.fillStyle = css(t.marker.rgb);
      g.fill();
    }
    if (t.fogged) {
      diamond(ox, oy, 1);
      g.fillStyle = css(0, 100 / 255);
      g.fill();
    }
  }
}
