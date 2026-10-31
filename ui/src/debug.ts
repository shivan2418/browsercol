// Debug mode: FreeCol's debug actions, as requests to the server Engine
// (DebugActions.java). Debug mode is the page's `?debug` parameter; the menu
// (debug-menu.tsx) is not drawn without it.

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
  | { action: 'aiView' };

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

/** What the page shows of an answer from the Engine: the AI's view is text, the rest a short line. */
export function describeAnswer(detail: string): string {
  const a = JSON.parse(detail) as { action: string; text?: string; reveal?: boolean };
  if (a.action === 'aiView') return a.text || 'No AI players';
  if (a.action === 'revealMap') return a.reveal ? 'Map revealed' : 'Map hidden';
  return `Done: ${a.action}`;
}
