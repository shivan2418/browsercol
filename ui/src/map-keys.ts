// The resource keys the map draws, in one list: the Browser UI reads them
// (tileset.ts) and build-art.mjs copies only the art they name, so a key
// the map draws is never missing from the site.
//
// A family is a set of keys that share a prefix, e.g. "image.tile." for a
// tile's terrain, its beach and its rivers. A key that stands alone, e.g.
// "cross", the cross on a mission chip, is listed by itself.
//
// The panels' art is a second, smaller list below: the images a message's
// display object, an event panel and the colony panel show. The art build
// ships both, and nothing else.

/** The resource key families the map draws, by name: the prefix each family's keys start with. */
export const MAP_KEY_FAMILIES = {
  /** A tile's terrain, its beach and its rivers: image.tile.<type>.center */
  tile: 'image.tile.',
  /** A tile's overlay: image.tileoverlay.<type> */
  tileOverlay: 'image.tileoverlay.',
  /** A tile's forest: image.tileforest.<type> */
  tileForest: 'image.tileforest.',
  /** A tile's items and its settlements: image.tileitem.<id> */
  tileItem: 'image.tileitem.',
  /** What is drawn over a tile: image.abovetile.<type> */
  aboveTile: 'image.abovetile.',
  /** A unit: image.unit.<id> */
  unit: 'image.unit.',
  /** A mask, of a tile, a transition, a beach or a river: image.mask.<what> */
  mask: 'image.mask.',
  /** A colony's production bonus: color.map.productionBonus.<n> */
  productionBonus: 'color.map.productionBonus.',
  /** A mission chip's colour: color.foreground.mission.<kind> */
  mission: 'color.foreground.mission.',
  /** The native settlement chip's text: indianSettlementChip.<kind> */
  settlementChip: 'indianSettlementChip.',
  /** The native alarm chip's text: indianAlarmChip.<kind> */
  alarmChip: 'indianAlarmChip.',
} as const;

/** The resource keys the map draws that stand alone. */
export const MAP_KEYS = {
  /** The tile's own mask: image.mask */
  tileMask: 'image.mask',
  /** The road's colour: color.map.road */
  road: 'color.map.road',
  /** The cross on a mission chip: cross */
  cross: 'cross',
} as const;

/** Whether the map draws the resource with this key. */
export const isMapKey = (key: string) =>
  Object.values(MAP_KEYS).some((k) => k === key) ||
  Object.values(MAP_KEY_FAMILIES).some((prefix) => key.startsWith(prefix));

/**
 * The resource key families a message shows, besides those of the map: the image of the object
 * it is about (ImageLibrary.getObjectImage), by what the object is. A unit, a settlement, a
 * resource, a lost city rumour and a tile's type have images the map draws already.
 */
export const PANEL_KEY_FAMILIES = {
  /** A goods type: image.icon.model.goods.<id> */
  goods: 'image.icon.model.goods.',
  /** A building type: image.buildingicon.<id> */
  building: 'image.buildingicon.',
  /** A nation, which is what a player shows: image.miscicon.model.nation.<id> */
  nation: 'image.miscicon.model.nation.',
  /**
   * A founding father's portrait, which the choose founding father dialog and the Continental Congress
   * report show: image.flavor.model.foundingFather.<id>. Not the picture of a kind of father (FATHER_KINDS).
   */
  father: 'image.flavor.model.foundingFather.',
  /** A tile type's colour on the minimap with its borders off: color.economic.MiniMap.<type> */
  minimapEconomic: 'color.economic.MiniMap.',
  /** A tile type's colour on the minimap with its borders on: color.politics.MiniMap.<type> */
  minimapPolitics: 'color.politics.MiniMap.',
} as const;

/** The kinds of founding father, whose pictures share the portraits' family but no panel shows. */
const FATHER_KINDS = ['trade', 'exploration', 'military', 'political', 'religious'].map(
  (kind) => PANEL_KEY_FAMILIES.father + kind,
);

/** The resource keys that stand alone that a panel shows. */
export const PANEL_KEYS = {
  /** The coin of a building's upkeep in the colony panel (ImageLibrary.ICON_COIN). */
  coin: 'image.icon.coin',
  /** The compass rose over the map (ImageLibrary.getCompassRose), when the display compass rose option is on. */
  compass: 'image.skin.compass',
  /** The box round what the map shows, on the minimap (ImageLibrary.getMinimapBorderColor). */
  minimapBorder: 'color.border.MiniMap',
} as const;

/**
 * The resource keys the event panel shows, which are the ones InGameController asks it for: the
 * first landing and the discovery of the Pacific.
 */
export const EVENT_KEYS = ['image.flavor.event.firstLanding', 'image.flavor.event.discoverPacific'] as const;

/** Whether a panel shows the resource with this key. */
export const isPanelKey = (key: string) =>
  (!FATHER_KINDS.includes(key) && Object.values(PANEL_KEY_FAMILIES).some((prefix) => key.startsWith(prefix))) ||
  (EVENT_KEYS as readonly string[]).includes(key) ||
  Object.values(PANEL_KEYS).some((k) => k === key);

/** Whether the art build ships the resource with this key. */
export const isArtKey = (key: string) => isMapKey(key) || isPanelKey(key);
