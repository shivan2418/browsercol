// @vitest-environment jsdom
// The colony window keeps its size whatever moves in it (#342). jsdom has no layout, so this checks the CSS that
// gives the boxes their height, and that the boxes are the same ones however many units and goods they hold.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { ColonyPanel } from './colony-panel';
import { colonist, goods, jamestown } from './colony-fixture';
import { pageCss } from './page-css.testing';
import type { ColonyView } from './webgui';

afterEach(cleanup);

const style = pageCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list names the selector, in order, as one map (a later wins). */
function declared(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, selectors, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
    for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) out[name] = value.trim();
  }
  return out;
}

const ship = (id: string, units: number, stacks: number) => ({
  id,
  name: 'Galleon',
  keys: ['image.unit.model.unit.galleon'],
  cargo: {
    title: 'Cargo',
    units: Array.from({ length: units }, (_, i) => colonist(`unit:c${id}${i}`)),
    goods: ['lumber', 'food', 'grain', 'cotton', 'hammers'].slice(0, stacks).map((t) => goods(t, 100)),
  },
});

/** A colony with this many units outside, ships in port (the first chosen) with this cargo, and stacks of goods. */
function colony(outside: number, ships: number, cargo: number, stacks: number): ColonyView {
  return {
    ...jamestown,
    outside: { title: 'Outside Colony', units: Array.from({ length: outside }, (_, i) => colonist(`unit:o${i}`)) },
    warehouse: {
      ...jamestown.warehouse,
      goods: ['lumber', 'food', 'grain', 'cotton', 'hammers']
        .slice(0, stacks)
        .map((t) => ({ ...goods(t, 9), over: false })),
    },
    inPort: {
      title: 'In Port',
      units: Array.from({ length: ships }, (_, i) => ship(`unit:s${i}`, cargo, stacks)),
      selected: ships ? 'unit:s0' : null,
      cargo: 'Cargo',
    },
  };
}

describe('the colony window keeps one size', () => {
  for (const part of ['outside', 'cargo', 'port']) {
    it(`sizes the ${part} box by construction: no height of its own, one row from a hidden template, a list that scrolls`, () => {
      const css = declared(`.colony .${part}`);
      // The box takes its height from its content, never from a length measured for it.
      for (const name of ['height', 'min-height', 'max-height', 'overflow-y']) expect(css[name], name).toBeUndefined();
      expect(css['box-sizing']).toBe('border-box');
    });
  }

  it("gives the cell the template's height, and has the list fill it and scroll from the second row", () => {
    const fit = declared('.colony .row-fit');
    const template = declared('.colony .row-template');
    const list = declared('.colony .row-list');
    // The template is in flow, so the cell is one row high; hidden, so nothing shows of it.
    expect(fit.position).toBe('relative');
    expect(template.visibility).toBe('hidden');
    expect(template.display).toBe('flex');
    expect(template.position).toBeUndefined();
    expect(template.height).toBeUndefined();
    // The list is out of flow, filling the cell, so what it holds never grows it.
    expect(list.position).toBe('absolute');
    expect(list.inset).toBe('0');
    expect(list['overflow-y']).toBe('auto');
    expect(list['overflow-x']).toBe('hidden');
    expect(list.height).toBeUndefined();
  });

  it('measures nothing: no length for a row or a box frame is left', () => {
    expect(pageCss).not.toContain('--colony-row');
    expect(pageCss).not.toContain('--colony-box-frame');
  });

  it('gives the warehouse no height of its own, and the three boxes one template each', () => {
    const css = declared('.colony .warehouse');
    for (const name of ['height', 'min-height', 'max-height']) expect(css[name], name).toBeUndefined();
    const { container } = render(<ColonyPanel colony={colony(3, 2, 2, 2)} art={() => 'x.png'} />);
    for (const part of ['outside', 'cargo', 'port']) {
      const box = container.querySelector(`[data-part="${part}"]`)!;
      const template = box.querySelectorAll('.row-fit > .row-template');
      expect(template, part).toHaveLength(1);
      expect(template[0].getAttribute('aria-hidden'), part).toBe('true');
      // It is not a unit of the box: nothing counts or finds it as one, and nothing in it can be picked.
      expect(template[0].querySelector('[data-unit]'), part).toBeNull();
      expect(box.querySelectorAll('.row-list > *').length, part).toBeGreaterThan(0);
    }
  });

  it('gives the window its own width and no height of its own to grow from', () => {
    const css = declared(".dialog[data-kind='colony']");
    expect(css['width']).toMatch(/^\d+px$/);
    expect(css['height']).toBeUndefined();
    // Not capped by the screen, which would cut off the warehouse (#377): the whole window is scaled to fit instead.
    expect(css['max-height']).toBeUndefined();
    expect(declared('.modal > [data-fit]').zoom).toBe('var(--fit, var(--ui-zoom, 1))');
  });

  for (const [what, outside, ships, cargo, stacks] of [
    ['nothing', 0, 0, 0, 0],
    ['one of each', 1, 1, 1, 1],
    ['many of each', 40, 9, 12, 5],
  ] as const) {
    it(`draws every box whether the colony has ${what}`, () => {
      const { container } = render(<ColonyPanel colony={colony(outside, ships, cargo, stacks)} art={() => null} />);
      for (const part of ['outside', 'cargo', 'port', 'warehouse']) {
        const box = container.querySelector(`[data-part="${part}"]`);
        expect(box, part).not.toBeNull();
        // Nothing on the box sets a size of its own, whatever it holds: only the stylesheet does.
        expect(box!.getAttribute('style'), part).toBeNull();
      }
      expect(container.querySelectorAll('[data-part="outside"] [data-unit]')).toHaveLength(outside);
      expect(container.querySelectorAll('[data-part="port"] [data-unit]')).toHaveLength(ships);
    });
  }
});
