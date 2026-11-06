// @vitest-environment jsdom
// The colony window keeps its size whatever moves in it (#342). jsdom has no layout, so this checks the CSS that
// gives the boxes their height, and that the boxes are the same ones however many units and goods they hold.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import html from '../index.html?raw';
import { ColonyPanel } from './colony-panel';
import { colonist, goods, jamestown } from './colony-fixture';
import type { ColonyView } from './webgui';

afterEach(cleanup);

const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

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
  for (const part of ['outside', 'cargo', 'port', 'warehouse']) {
    it(`gives the ${part} box a height of its own, and scrolls what does not fit`, () => {
      const css = declared(`.colony .${part}`);
      // The box's height, not the content's: a fixed length or a token holding one, and no min-height to grow from.
      expect(css.height, 'height').toMatch(/^(\d+px|var\(--colony-[\w-]+\))$/);
      expect(css['min-height']).toBeUndefined();
      expect(css['max-height']).toBeUndefined();
      expect(css['box-sizing']).toBe('border-box');
      expect(css['overflow-y']).toBe('auto');
    });
  }

  it('sets the heights the boxes take from as lengths', () => {
    const css = declared('.colony .cbody');
    expect(css['--colony-row']).toMatch(/^\d+px$/);
    expect(css['--colony-warehouse']).toMatch(/^\d+px$/);
  });

  it('keeps the outside and cargo boxes in one row, so they have the one height', () => {
    expect(declared('.colony .outside').height).toBe(declared('.colony .cargo').height);
  });

  it('gives the window no height of its own to grow from', () => {
    const css = declared(".dialog[data-kind='colony']");
    expect(css['width']).toBeDefined();
    expect(css['max-height']).toBe('94vh');
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
