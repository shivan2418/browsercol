// The player's preferences (the Game menu's Preferences): FreeCol Online's own,
// such as how fast units slide and the active unit blinks, and those of
// FreeCol's client options the browser follows. Kept in this browser's
// localStorage.
import { AUTOMATIC, LANGUAGE_OPTION } from './language';
import type { MinimapOptions } from './minimap';
import type { AutosaveOptions } from './saves';
import type { OptionGroup, OptionNode } from './options';
import { FONT_SETS, isFontSet, isPalette, PALETTES, type FontSet, type Palette } from './theme';
import type { TerrainAnimation, TileText, ViewModes } from './tileset';

/** A speed the player picks; each preference maps it to a duration. */
export type Speed = 'off' | 'slow' | 'normal' | 'fast';
export const SPEEDS: readonly Speed[] = ['off', 'slow', 'normal', 'fast'];

/**
 * How the active unit shows: FreeCol's own, a blinking cursor (the green chevron) over a steady unit, or
 * FreeCol Online's, the whole unit blinking, Civilization I style, with no chevron.
 */
export type ActiveStyle = 'freecol' | 'online';
export const ACTIVE_STYLES: readonly ActiveStyle[] = ['freecol', 'online'];

/** How strongly the window greys out while it lacks keyboard focus. */
export type Dim = 'off' | 'light' | 'normal' | 'heavy';
export const DIMS: readonly Dim[] = ['off', 'light', 'normal', 'heavy'];

export interface Prefs {
  /** What blinks for the active unit; the blink speed applies to either. */
  activeStyle: ActiveStyle;
  /** How fast a unit slides to its new tile. */
  animation: Speed;
  /** How fast the active unit blinks. */
  blink: Speed;
  /** How strong a grey wash covers the window while it lacks keyboard focus. */
  dimUnfocused: Dim;
  /** Whether the tutorial messages (hints such as how to build a colony) are shown. */
  tutorial: boolean;
  /** Whether the turn ends by itself once no unit is left to move. */
  autoEndTurn: boolean;
  /** The colours of menus, panels and windows (theme.css). */
  palette: Palette;
  /** The fonts of their text (fonts.css). */
  fonts: FontSet;
  /** Whether the music is muted, whatever its volume option says. */
  muteMusic: boolean;
  /** Whether the sound effects are muted, whatever their volume option says. */
  muteEffects: boolean;
  /** FreeCol's client options the player changed, by id (FREECOL_OPTIONS); the others keep FreeCol's default. */
  freecol: Record<string, FreeColValue>;
}

/** The value of one of FreeCol's boolean, integer, select or text client options. */
export type FreeColValue = boolean | number | string;

export const DEFAULTS: Prefs = {
  activeStyle: 'online',
  animation: 'normal',
  blink: 'normal',
  dimUnfocused: 'normal',
  tutorial: false,
  autoEndTurn: false,
  palette: PALETTES[0].id,
  fonts: FONT_SETS[0].id,
  muteMusic: false,
  muteEffects: false,
  freecol: {},
};

/** A slide's length in milliseconds; 0 moves the unit at once. */
const MOVE: Record<Speed, number> = { off: 0, slow: 600, normal: 300, fast: 150 };
/** A whole blink cycle in milliseconds; 0 never blinks. */
const BLINK: Record<Speed, number> = { off: 0, slow: 2400, normal: 1400, fast: 700 };

export const moveMs = (p: Prefs): number => MOVE[p.animation];
export const blinkMs = (p: Prefs): number => BLINK[p.blink];

/** The messages the player sees: tutorial ones are dropped when the tutorial option is off. */
export function visibleMessages<T extends { type: string }>(p: Prefs, messages: T[]): T[] {
  return p.tutorial ? messages : messages.filter((m) => m.type.toUpperCase() !== 'TUTORIAL');
}

/**
 * FreeCol's client options (data/base/client-options.xml) the Preferences window shows, in FreeCol's
 * groups: those the browser follows. The client Engine follows most of them as FreeCol does; the page
 * follows PAGE_OPTIONS itself. Left out: those FreeCol Online's own preferences cover (move animation,
 * tutorial messages, auto end turn); those a browser cannot follow (the full screen display mode, Java's
 * pixmaps and XRender, confirm save overwrite, as saves never overwrite; and the audio mixer, a Java Sound
 * device: the browser plays on the system's default output, as choosing another, setSinkId, works only in
 * Chromium); and those waiting on a feature, each with its issue: the compact colony report (#152),
 * mods (#155), and the warehouse defaults (#158).
 */
export const FREECOL_OPTIONS: readonly string[] = [
  // Personal
  'model.option.playerName',
  LANGUAGE_OPTION,
  // Display
  'model.option.displayScaling',
  'model.option.manualMainFontSize',
  'model.option.mainFontSize',
  'model.option.useOpenGL',
  'model.option.graphicsQuality',
  'model.option.useTerrainAnimations',
  // Interface: main map
  'model.option.defaultZoomLevel',
  'model.option.alwaysCenter',
  'model.option.jumpToActiveUnit',
  'model.option.mapScrollOnDrag',
  'model.option.autoScroll',
  'model.option.displayGrid',
  'model.option.displayBorders',
  'model.option.displayTileText',
  'model.option.displayFogOfWar',
  'model.option.displayColonyLabels',
  'model.option.unitLastMoveDelay',
  'model.option.enemyMoveAnimationSpeed',
  'model.option.friendlyMoveAnimationSpeed',
  // Interface: map controls
  'model.option.displayCompassRose',
  'model.option.displayMapControls',
  'model.option.miniMapToggleFogOfWar',
  'model.option.miniMapToggleBorders',
  'model.option.color.background',
  // Interface: messages
  'model.option.guiMessagesGroupBy',
  'model.option.guiShowBuildingCompleted',
  'model.option.guiShowCombatResult',
  'model.option.guiShowDemands',
  'model.option.guiShowDisasters',
  'model.option.guiShowForeignDiplomacy',
  'model.option.guiShowGifts',
  'model.option.guiShowGoodsMovement',
  'model.option.guiShowGovernmentEfficiency',
  'model.option.guiShowMarketPrices',
  'model.option.guiShowMissingGoods',
  'model.option.guiShowSonsOfLiberty',
  'model.option.guiShowUnitAdded',
  'model.option.guiShowUnitArrived',
  'model.option.guiShowUnitDemoted',
  'model.option.guiShowUnitImproved',
  'model.option.guiShowUnitLost',
  'model.option.guiShowUnitRepaired',
  'model.option.guiShowWarehouseCapacity',
  'model.option.guiShowWarning',
  'model.option.guiShowColonyWarnings',
  'model.option.guiShowPreCombat',
  'model.option.guiShowRegionNaming',
  // Interface: warehouse
  'model.option.stockAccountsForProduction',
  // Interface: other
  'model.option.rememberPanelPositions',
  'model.option.disableGrayLayer',
  'model.option.autoloadEmigrants',
  'model.option.autoloadSentries',
  'model.option.showEndTurnDialog',
  'model.option.indianDemandResponse',
  'model.option.unloadOverflowResponse',
  'model.option.guiMinNumberToDisplayGoodsCount',
  'model.option.guiMaxNumberOfGoodsImages',
  'model.option.guiMinNumberToDisplayGoods',
  'model.option.colonyComparator',
  // Saved games
  'model.option.showSavegameSettings',
  'model.option.autosavePeriod',
  'model.option.autosaveValidity',
  'model.option.autosaveDelete',
  'model.option.autoSavePrefix',
  'model.option.lastTurnName',
  'model.option.beforeLastTurnName',
  // Audio
  'model.option.musicVolume',
  'model.option.soundEffectsVolume',
  'model.option.audioAlerts',
];

/** The FreeCol options the page follows, with FreeCol's defaults; the client Engine is told them too. */
export const PAGE_OPTIONS = {
  /** The size of the menus, side panel and windows, as a percentage; 0 is automatic, 100%. The map has its own zoom. */
  'model.option.displayScaling': 0,
  /** Whether mainFontSize sets the text size, rather than the display scaling. */
  'model.option.manualMainFontSize': false,
  /** The main text size, FreeCol's 12 being FreeCol Online's own. */
  'model.option.mainFontSize': 12,
  /** Draw the map with WebGL (PixiJS), rather than the Canvas 2D fallback. Read as the page loads. */
  'model.option.useOpenGL': true,
  /** 0 lowest: no antialiasing, one pixel per CSS pixel; 10 low: no antialiasing; 20 and up as now. Read as the page loads. */
  'model.option.graphicsQuality': 20,
  /** The ocean and its beaches animate; with the rivers and deltas too from graphics quality normal up, none below low. */
  'model.option.useTerrainAnimations': true,
  /** SwingGUI.changeView(Tile): a selected tile is always centred, not only when out of view. */
  'model.option.alwaysCenter': false,
  /** A newly active unit is centred, not only when out of view (FreeCol never reads it; the browser does). */
  'model.option.jumpToActiveUnit': true,
  /** The map scrolls at its edge while the Go To order is held, as FreeCol's does while a unit is dragged. */
  'model.option.mapScrollOnDrag': true,
  /** A pointer resting at the map's edge scrolls it. */
  'model.option.autoScroll': true,
  /** The map controls are shown: the side panel and the minimap (the View menu's Show Side Panel). */
  'model.option.displayMapControls': true,
  /** A window dragged somewhere opens there again. */
  'model.option.rememberPanelPositions': false,
  /** No "Other players are moving" banner over the map while the AI plays: FreeCol's grey end turn layer. */
  'model.option.disableGrayLayer': false,
  /** The amount of goods from which a ProductionLabel shows the number as well as the icons. */
  'model.option.guiMinNumberToDisplayGoodsCount': 7,
  /** The most goods icons a ProductionLabel draws. */
  'model.option.guiMaxNumberOfGoodsImages': 7,
  /** The View menu's Show Map Grid, as the game starts. */
  'model.option.displayGrid': false,
  /** The View menu's Show Borders, as the game starts. */
  'model.option.displayBorders': false,
  /** The View menu's tile text, as the game starts: 0 nothing, 1 names, 2 owners, 3 regions. */
  'model.option.displayTileText': 0,
  /** The View menu's Show Fog of War: the tiles out of sight greyed, if the game has fog of war. The Engine's map says. */
  'model.option.displayFogOfWar': false,
  /** How settlements are labelled: 0 none, 1 classic, 2 modern. */
  'model.option.displayColonyLabels': 1,
  /** The language of FreeCol's own text, a translation's id (language.ts); automatic follows the browser. Read as the page loads. */
  [LANGUAGE_OPTION]: AUTOMATIC as string,
  /** The compass rose at the map's top right; a click on it moves the active unit that way. */
  'model.option.displayCompassRose': false,
  /** The music's volume, as a percentage (sound.ts plays it). */
  'model.option.musicVolume': 100,
  /** The sound effects' volume, as a percentage. */
  'model.option.soundEffectsVolume': 100,
  /** The minimap's tile size, 4 pixels a level; its zoom buttons change it, as MiniMap.setZoomOption does. */
  'model.option.defaultZoomLevel': 2,
  /** The minimap greys the tiles out of sight. */
  'model.option.miniMapToggleFogOfWar': true,
  /** The minimap shows political colours with the owners over them, rather than economic ones. */
  'model.option.miniMapToggleBorders': true,
  /** The colour round the map on the minimap: 0 black, 1 to 5 greys from dark to light, 6 light blue. */
  'model.option.color.background': 0,
  /** The Loading Save game window as a save loads: 0 never, 1 for multiplayer games only, 2 always (loading-save.tsx). */
  'model.option.showSavegameSettings': 1,
  /** A turn autosave every this many turns, as the player's turn begins; 0 makes none. */
  'model.option.autosavePeriod': 1,
  /** Days a turn autosave is kept, counted from when it was made; 0 keeps them. Read as the page loads. */
  'model.option.autosaveValidity': 30,
  /** Delete the turn autosaves when a new game starts. */
  'model.option.autosaveDelete': false,
  /** What the turn autosaves' names start with, before a dash. */
  'model.option.autoSavePrefix': 'Autosave',
  /** The name, after the prefix, of the save made as each of the player's turns begins. */
  'model.option.lastTurnName': 'last-turn',
  /** The name, after the prefix, the last turn's save takes when the next one replaces it. */
  'model.option.beforeLastTurnName': 'before-last-turn',
};

type PageOption = keyof typeof PAGE_OPTIONS;

/** The page options that take effect only when the page loads again, as FreeCol's need a restart. */
export const ON_RELOAD: readonly string[] = [
  'model.option.useOpenGL',
  'model.option.graphicsQuality',
  LANGUAGE_OPTION,
  'model.option.autosaveValidity',
];

/**
 * Which of the terrain animates, as ClientOptions.isTerrainAnimationsEnabled and isRiverAnimationEnabled have it:
 * the terrain animations option, and the graphics quality at low or more for the water, normal or more for the rivers.
 */
export function terrainAnimation(p: Prefs): TerrainAnimation {
  if (!pageOption(p, 'model.option.useTerrainAnimations')) return 'off';
  const quality = pageOption(p, 'model.option.graphicsQuality');
  return quality >= 20 ? 'all' : quality >= 10 ? 'water' : 'off';
}

/** How big the menus, panels and windows are drawn: the display scaling, 1 for automatic. */
export const uiZoom = (p: Prefs): number => (pageOption(p, 'model.option.displayScaling') || 100) / 100;

/** How much bigger than FreeCol Online's own the text is: the manual font size over FreeCol's 12. */
export const fontScale = (p: Prefs): number =>
  pageOption(p, 'model.option.manualMainFontSize') ? pageOption(p, 'model.option.mainFontSize') / 12 : 1;

/** A FreeCol option the page follows, as the player set it or by FreeCol's default. */
export function pageOption<K extends PageOption>(p: Prefs, id: K): (typeof PAGE_OPTIONS)[K] {
  const v = p.freecol[id];
  return (typeof v === typeof PAGE_OPTIONS[id] ? v : PAGE_OPTIONS[id]) as (typeof PAGE_OPTIONS)[K];
}

/** The mute preference that silences each volume option, shown as a button beside its slider. */
export const MUTES = {
  'model.option.musicVolume': 'muteMusic',
  'model.option.soundEffectsVolume': 'muteEffects',
} as const;

/** The music and sound effects volumes, as percentages: the volume options, or 0 when muted. */
export const volumes = (p: Prefs): { music: number; effects: number } => ({
  music: p.muteMusic ? 0 : pageOption(p, 'model.option.musicVolume'),
  effects: p.muteEffects ? 0 : pageOption(p, 'model.option.soundEffectsVolume'),
});

/** The autosave options (saves.ts). */
export const autosaveOptions = (p: Prefs): AutosaveOptions => ({
  period: pageOption(p, 'model.option.autosavePeriod'),
  validity: pageOption(p, 'model.option.autosaveValidity'),
  deleteOnNewGame: pageOption(p, 'model.option.autosaveDelete'),
  prefix: pageOption(p, 'model.option.autoSavePrefix'),
  lastTurn: pageOption(p, 'model.option.lastTurnName'),
  beforeLastTurn: pageOption(p, 'model.option.beforeLastTurnName'),
});

/** The View menu's map modes, as the options say. */
export const startModes = (p: Prefs): ViewModes => ({
  grid: pageOption(p, 'model.option.displayGrid'),
  borders: pageOption(p, 'model.option.displayBorders'),
  tileText: Math.max(0, Math.min(3, pageOption(p, 'model.option.displayTileText'))) as TileText,
});

/** The minimap's options. */
export const minimapOptions = (p: Prefs): MinimapOptions => ({
  borders: pageOption(p, 'model.option.miniMapToggleBorders'),
  fog: pageOption(p, 'model.option.miniMapToggleFogOfWar'),
  background: pageOption(p, 'model.option.color.background'),
  zoom: pageOption(p, 'model.option.defaultZoomLevel'),
});

/** The option a View menu switch is kept as, as FreeCol's display actions keep them. */
export const MODE_OPTIONS = {
  grid: 'model.option.displayGrid',
  borders: 'model.option.displayBorders',
  tileText: 'model.option.displayTileText',
  fog: 'model.option.displayFogOfWar',
} as const;

/**
 * FreeCol's client option groups cut to FREECOL_OPTIONS, and empty groups dropped, as the Preferences
 * window shows them. Null if nothing is left.
 */
export function shownClientOptions(group: OptionNode): OptionGroup | null {
  const cut = (n: OptionNode): OptionNode | null => {
    if (n.kind === 'group') {
      const children = n.children.flatMap((c) => cut(c) ?? []);
      return children.length > 0 ? { ...n, children } : null;
    }
    if (!FREECOL_OPTIONS.includes(n.id)) return null;
    if (ON_RELOAD.includes(n.id)) return { ...n, label: `${n.label} (on reload)` };
    return n;
  };
  const out = cut(group);
  return out?.kind === 'group' ? out : null;
}

/** The stored FreeCol options: shown ones with a boolean, whole number or text value. */
function freecolValues(v: unknown): Record<string, FreeColValue> {
  const out: Record<string, FreeColValue> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [id, x] of Object.entries(v)) {
    if (FREECOL_OPTIONS.includes(id) && (typeof x === 'boolean' || typeof x === 'string' || Number.isInteger(x)))
      out[id] = x as FreeColValue;
  }
  return out;
}

/**
 * The FreeCol options as the client Engine has them now (the turn report's buttons change some), kept
 * where they differ from FreeCol's defaults.
 *
 * @param engine The Engine's values by id (ClientExports.clientOptionValues).
 * @param defaults FreeCol's defaults by id.
 */
export function fromEngine(
  p: Prefs,
  engine: Record<string, unknown>,
  defaults: Map<string, unknown>,
): Record<string, FreeColValue> {
  const out = { ...p.freecol };
  for (const id of FREECOL_OPTIONS) {
    const v = engine[id];
    if (typeof v !== 'boolean' && typeof v !== 'number' && typeof v !== 'string') continue;
    if (defaults.get(id) === v) delete out[id];
    else out[id] = v;
  }
  return out;
}

const KEY = 'freecol.prefs';

const speed = (v: unknown, fallback: Speed): Speed => (SPEEDS.includes(v as Speed) ? (v as Speed) : fallback);

/** The grey-out strength; the old on/off switch reads as normal or off. */
const dim = (v: unknown): Dim => (DIMS.includes(v as Dim) ? (v as Dim) : v === false ? 'off' : DEFAULTS.dimUnfocused);

/** Parse stored text; anything missing or odd falls back to the defaults. */
export function parsePrefs(text: string | null): Prefs {
  try {
    const o = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    return {
      activeStyle: ACTIVE_STYLES.includes(o.activeStyle as ActiveStyle)
        ? (o.activeStyle as ActiveStyle)
        : DEFAULTS.activeStyle,
      animation: speed(o.animation, DEFAULTS.animation),
      blink: speed(o.blink, DEFAULTS.blink),
      dimUnfocused: dim(o.dimUnfocused),
      tutorial: typeof o.tutorial === 'boolean' ? o.tutorial : DEFAULTS.tutorial,
      autoEndTurn: typeof o.autoEndTurn === 'boolean' ? o.autoEndTurn : DEFAULTS.autoEndTurn,
      palette: isPalette(o.palette) ? o.palette : DEFAULTS.palette,
      fonts: isFontSet(o.fonts) ? o.fonts : DEFAULTS.fonts,
      muteMusic: typeof o.muteMusic === 'boolean' ? o.muteMusic : DEFAULTS.muteMusic,
      muteEffects: typeof o.muteEffects === 'boolean' ? o.muteEffects : DEFAULTS.muteEffects,
      freecol: freecolValues(o.freecol),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage may be blocked; the preferences then last until the page closes.
  }
}
