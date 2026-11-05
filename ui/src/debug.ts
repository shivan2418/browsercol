// Debug mode: FreeCol's debug actions, as requests to the server Engine
// (DebugActions.java). Debug mode is the page's `?debug` parameter; the menu
// (debug-menu.tsx) is not drawn without it.

import { createContext } from 'react';

/** Whether the page is in debug mode: `?debug` (or `?debug=1`; `?debug=0` is off). */
export function debugMode(params: URLSearchParams): boolean {
  const v = params.get('debug');
  return v !== null && v !== '0' && v !== 'false';
}

/** What the menu can ask of the server Engine, as DebugActions.java reads it. */
export type DebugRequest =
  | { action: 'revealMap'; reveal: boolean }
  | { action: 'addGold'; amount: number }
  | { action: 'addUnit'; type: string; x: number; y: number }
  | { action: 'addGoods'; type: string; amount: number; x: number; y: number }
  | { action: 'aiView' }
  | { action: 'addImmigration'; amount: number }
  | { action: 'addLiberty'; amount: number }
  | { action: 'addFoundingFather'; father: string }
  | { action: 'addBuilding'; type: string; x: number; y: number }
  | { action: 'addColony'; x: number; y: number }
  | { action: 'addGoods'; type: string; amount: number; unit: string }
  | { action: 'traceWork'; colony: string }
  | { action: 'resetMoves'; x: number; y: number }
  | { action: 'dumpTile'; x: number; y: number }
  // The tile popup's other entries (TilePopup.addDebugItems). Those that need a choice are asked again
  // with it set, as the Engine's "choose" answer says ({@link chosenRequest}).
  | { action: 'addUnit'; x: number; y: number }
  | { action: 'changeOwner'; unit: string; owner?: string }
  | { action: 'changeOwner'; x: number; y: number; owner?: string }
  | { action: 'changeRole'; unit: string; role?: string }
  | { action: 'displayMission'; unit: string }
  | { action: 'colonyPlan'; x: number; y: number }
  | { action: 'applyDisaster'; x: number; y: number; disaster?: string }
  | { action: 'examineSettlement'; x: number; y: number }
  | { action: 'rumourType'; x: number; y: number; rumour?: string }
  | { action: 'idealColony'; x: number; y: number }
  | { action: 'monarch'; monarch: string }
  | { action: 'stepRNG' }
  | { action: 'players' }
  | { action: 'displayEurope' }
  | { action: 'statistics' }
  | { action: 'compareMaps'; client: unknown }
  | {
      action: 'overlay';
      coords: boolean;
      colonyValue: string | null;
      missions: 0 | 1 | 2;
      defence: string | null;
    };

/** The client Engine's own debug tools (DebugClientTools.java), which the page calls on it. */
export type DebugClientRequest = { action: 'displayUnits' | 'digest' | 'monarchPanel' | 'errorPanel' };

/** A European player the Debug menu can choose, as the Engine's `players` answer lists them. */
export interface DebugPlayer {
  id: string;
  nation: string;
  name: string;
  ai: boolean;
}

/** Monarch.MonarchAction's constants, FreeCol's Set the next Monarch action choices, in its order. */
export const MONARCH_ACTIONS = [
  'NO_ACTION',
  'RAISE_TAX_ACT',
  'RAISE_TAX_WAR',
  'FORCE_TAX',
  'LOWER_TAX_WAR',
  'LOWER_TAX_OTHER',
  'WAIVE_TAX',
  'ADD_TO_REF',
  'DECLARE_PEACE',
  'DECLARE_WAR',
  'SUPPORT_LAND',
  'SUPPORT_SEA',
  'MONARCH_MERCENARIES',
  'HESSIAN_MERCENARIES',
  'DISPLEASURE',
] as const;

/** What the Debug menu has the map show (FreeColDebugger's display switches). */
export interface DebugDisplay {
  /** Show Coordinates. */
  coords: boolean;
  /** Show Colony Values: a player's id, or none. */
  colonyValue: string | null;
  /** Display AI missions, and with the additional information. */
  missions: boolean;
  missionInfo: boolean;
  /** Show AI defence map: an AI player's id, or none. */
  defence: string | null;
}

export const NO_DISPLAY: DebugDisplay = {
  coords: false,
  colonyValue: null,
  missions: false,
  missionInfo: false,
  defence: null,
};

/** The request that asks the Engine for the overlay the switches want, or null when nothing is on. */
export function overlayRequest(d: DebugDisplay): DebugRequest | null {
  if (!d.coords && d.colonyValue === null && !d.missions && d.defence === null) return null;
  return {
    action: 'overlay',
    coords: d.coords,
    colonyValue: d.colonyValue,
    missions: d.missions ? (d.missionInfo ? 2 : 1) : 0,
    defence: d.defence,
  };
}

/** What the Engine answers an overlay request: text at tiles and tints of tiles. */
export interface OverlayAnswer {
  action: 'overlay';
  labels: [number, number, string][];
  tints: [number, number, number][];
}

/** What the windows may ask for in debug mode (FreeCol's DebugMode.MENUS): whether it is on, and a way to ask. */
export interface DebugState {
  on: boolean;
  request: (r: DebugRequest) => void;
}
export const DebugContext = createContext<DebugState>({ on: false, request: () => {} });

/** The message for the Worker. */
export const debugMessage = (r: DebugRequest) => ({ k: 'debug' as const, request: JSON.stringify(r) });

/** FreeCol's unit and goods ids the menu offers; any id the rules have can be typed. */
export const UNIT_TYPES = [
  'freeColonist',
  'hardyPioneer',
  'expertFarmer',
  'seasonedScout',
  'veteranSoldier',
  'artillery',
  'jesuitMissionary',
  'wagonTrain',
  'caravel',
  'galleon',
].map((t) => `model.unit.${t}`);
export const GOODS_TYPES = ['food', 'lumber', 'tools', 'muskets', 'horses', 'tradeGoods', 'ore', 'silver'].map(
  (t) => `model.goods.${t}`,
);

/** The request a debug menu entry makes: its arg is a unit's id, or the tile's "x,y". */
export function debugEntryRequest(action: string, arg: string): DebugRequest | null {
  if (arg.includes(',')) {
    const [x, y] = arg.split(',').map(Number);
    return { action, x, y } as DebugRequest;
  }
  return { action, unit: arg } as DebugRequest;
}

/** The answers that are a block of text, shown as the AI's view is. */
const TEXT_ANSWERS = new Set(['aiView', 'dumpTile', 'displayMission', 'colonyPlan', 'examineSettlement']);

/**
 * What to do with an answer that asks for a choice (the Engine's {"action": "choose"}, as Swing's choice
 * dialogs ask): ask the player through `ask` (the prompt, with the choices numbered, and the first as the
 * default), and send `last`, the request that was asked, again with the choice set.
 *
 * @returns undefined if the answer is no question; null if the player cancelled or none of the choices
 *   was picked; otherwise the request to send.
 */
export function chosenRequest(
  detail: string,
  last: DebugRequest | null,
  ask: (prompt: string, first: string) => string | null,
): DebugRequest | null | undefined {
  const a = JSON.parse(detail) as {
    action: string;
    key?: string;
    prompt?: string;
    choices?: { id: string; label: string }[];
  };
  if (a.action !== 'choose') return undefined;
  const choices = a.choices ?? [];
  if (!last || !a.key || choices.length === 0) return null;
  const text = choices.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
  const reply = ask(`${a.prompt ?? 'Choose'}\n${text}`, '1');
  if (reply === null) return null;
  const n = Number(reply.trim());
  const picked =
    Number.isInteger(n) && n >= 1 && n <= choices.length ? choices[n - 1] : choices.find((c) => c.id === reply.trim());
  return picked ? ({ ...last, [a.key]: picked.id } as DebugRequest) : null;
}

/** What the page shows of an answer from the Engine: the AI's view is text, the rest a short line. */
export function describeAnswer(detail: string): string {
  const a = JSON.parse(detail) as {
    action: string;
    text?: string;
    reveal?: boolean;
    trace?: boolean;
    avoided?: boolean;
    monarch?: string;
  };
  if (TEXT_ANSWERS.has(a.action)) return a.text || 'No AI players';
  if (a.action === 'applyDisaster') return a.avoided ? 'Disaster avoided' : 'Disaster applied';
  if (a.action === 'traceWork') return a.trace ? 'Tracing work' : 'Not tracing work';
  if (a.action === 'revealMap') return a.reveal ? 'Map revealed' : 'Map hidden';
  if (a.action === 'monarch') return `The next monarch action is ${a.monarch}`;
  return `Done: ${a.action}`;
}
