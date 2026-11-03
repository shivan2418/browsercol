// What the panels move, and where it may go: the model of a thing on its
// way somewhere, the rule that says what a place takes, and the machinery
// that carries it there.
//
// The rule is in one place, so that the colony panel's tiles, buildings,
// port, warehouse and outside, and the Europe panel's cargo and market, all
// take the same things: a unit, the warehouse's goods, a ship's cargo and
// the market's goods.
import { type DragEvent } from 'react';

/** Where goods come from: the warehouse, a ship's cargo, or the market. */
export type GoodsFrom = 'warehouse' | 'cargo' | 'market';

/**
 * What is being moved: a unit, or goods of a type from somewhere. A cargo's
 * goods carry the stack they came from, as the market's goods do not.
 */
export type Item =
  | { kind: 'unit'; id: string }
  | { kind: 'goods'; from: GoodsFrom; type: string; index?: number; amount?: number; ask?: boolean };

/** The places a thing can be dropped on. */
export type Place = 'tile' | 'building' | 'outside' | 'cargo' | 'warehouse' | 'market' | 'sailing' | 'docks';

/** What each place takes: a unit, and the goods it takes and where they come from. */
const takes: Record<Place, { unit: boolean; from: readonly GoodsFrom[] }> = {
  tile: { unit: true, from: [] },
  building: { unit: true, from: [] },
  outside: { unit: true, from: [] },
  // A ship's cargo takes the warehouse's goods (loaded) and the market's (bought).
  cargo: { unit: true, from: ['warehouse', 'market'] },
  // A warehouse takes a ship's cargo (unloaded), and the market sells it.
  warehouse: { unit: false, from: ['cargo'] },
  market: { unit: false, from: ['cargo'] },
  // The ships sailing to America take a ship of the port (the panel checks that it is one).
  sailing: { unit: true, from: [] },
  // Europe's docks take a unit off a ship's cargo (the panel checks that it is aboard).
  docks: { unit: true, from: [] },
};

/**
 * Whether a place takes what is picked up: the rule of every panel, in one
 * place, so that a market's goods are a kind like any other.
 *
 * @param place The place the thing is dropped on.
 * @param item The thing picked up.
 * @return True if the place takes it.
 */
export function accepts(place: Place, item: Item): boolean {
  const t = takes[place];
  if (item.kind === 'unit') return t.unit;
  return t.from.includes(item.from);
}

/** The same thing, wherever it was picked up and however. */
export const same = (a: Item, b: Item) => {
  if (a.kind === 'unit' || b.kind === 'unit') {
    return a.kind === 'unit' && b.kind === 'unit' && a.id === b.id;
  }
  if (a.from !== b.from || a.type !== b.type) return false;
  return a.from === 'warehouse' || b.from === 'warehouse' || a.index === b.index;
};

/** What is being dragged: a drag's data cannot be read until it drops, and only by the page's own drag. */
let dragging: Item | null = null;

/** The class of the place a thing is dragged over. */
export const OVER = 'over-target';

/**
 * The props that make an element carry a thing when it is dragged.
 *
 * @param item The thing it carries.
 * @param at What it carries at the start of the drag, for a thing that depends
 *     on how it was picked up (the colony panel's shift-drag).
 * @return The props.
 */
export function draggableProps(item: Item, at?: (e: DragEvent) => Item) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragging = at ? at(e) : item;
      e.dataTransfer.setData('text/plain', item.kind === 'unit' ? item.id : item.type);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => (dragging = null),
  };
}

/**
 * The props that make an element a place a thing can be dropped on. What
 * happens there is the panel's business; whether the thing may go there at
 * all is the rule's.
 *
 * @param place The place it is.
 * @param drop What a drop there does.
 * @return The props.
 */
export function dropTargetProps(place: Place, drop: (item: Item) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      if (dragging === null || !accepts(place, dragging)) return;
      e.preventDefault();
      e.currentTarget.classList.add(OVER);
    },
    onDragLeave: (e: DragEvent) => e.currentTarget.classList.remove(OVER),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.currentTarget.classList.remove(OVER);
      const item = dragging;
      dragging = null;
      if (item !== null && accepts(place, item)) drop(item);
    },
  };
}
