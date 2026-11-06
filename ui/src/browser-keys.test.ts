// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { blockBrowserKeys, isLeftoverKey, steppedScale, zoomKey } from './browser-keys';

const page = document.createElement('div');
page.innerHTML =
  '<div id="map"><canvas></canvas></div><button>Ok</button><span>label</span><input><textarea></textarea><select></select><div contenteditable="true"></div>';
document.body.append(page);
const map = page.querySelector('#map')!;
const scale = vi.fn();
blockBrowserKeys(document, map, scale);

const key = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
const span = page.querySelector('span')!;

describe('the keys the browser would act on', () => {
  it("keeps space, the arrows, Backspace, / and ' from doing anything on the page", () => {
    for (const k of [
      ' ',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageDown',
      'End',
      'Backspace',
      '/',
      "'",
    ]) {
      expect(key(span, k), k).toBe(true);
      expect(key(document.body, k), k).toBe(true);
    }
  });

  it('keeps Alt+Left and Alt+Right from going back and forward', () => {
    expect(key(span, 'ArrowLeft', { altKey: true })).toBe(true);
    expect(key(span, 'ArrowRight', { altKey: true })).toBe(true);
  });

  it('leaves every key to the text fields', () => {
    for (const sel of ['input', 'textarea', 'select', '[contenteditable]']) {
      for (const k of [' ', 'ArrowLeft', 'Backspace', '/', "'"]) {
        expect(key(page.querySelector(sel)!, k), sel + k).toBe(false);
      }
    }
  });

  it('leaves Space to a button it presses', () => {
    expect(key(page.querySelector('button')!, ' ')).toBe(false);
    expect(key(page.querySelector('button')!, 'ArrowDown')).toBe(true);
  });

  it('leaves the other keys and the modified ones alone', () => {
    expect(isLeftoverKey({ key: 'a', ctrlKey: false, altKey: false, metaKey: false, target: span })).toBe(false);
    expect(key(span, 'Enter')).toBe(false);
    expect(key(span, 'ArrowLeft', { ctrlKey: true })).toBe(false);
    expect(key(span, '/', { ctrlKey: true })).toBe(false);
  });
});

describe('the page zoom', () => {
  it('reads Ctrl+plus, Ctrl+minus and Ctrl+0', () => {
    const k = (key: string, ctrlKey = true) => zoomKey({ key, ctrlKey, altKey: false, metaKey: false });
    expect([k('+'), k('='), k('-'), k('_'), k('0'), k('+', false), k('a')]).toEqual([1, 1, -1, -1, 0, null, null]);
  });

  it('steps the UI scale in its place, not the browser zoom', () => {
    scale.mockClear();
    expect(key(span, '+', { ctrlKey: true })).toBe(true);
    expect(key(span, '-', { ctrlKey: true })).toBe(true);
    expect(key(span, '0', { ctrlKey: true })).toBe(true);
    expect(scale.mock.calls).toEqual([[1], [-1], [0]]);
  });

  it('stays within what Preferences allows, and resets to 100', () => {
    expect(steppedScale(100, 1)).toBe(110);
    expect(steppedScale(100, -1)).toBe(90);
    expect(steppedScale(200, 1)).toBe(200);
    expect(steppedScale(50, -1)).toBe(50);
    expect(steppedScale(140, 0)).toBe(100);
  });

  const wheel = (target: Element, init: { ctrlKey?: boolean; deltaY: number }) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...init });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it('steps the UI scale for Ctrl+wheel outside the map, and leaves the map its own zoom', () => {
    scale.mockClear();
    expect(wheel(span, { ctrlKey: true, deltaY: -100 })).toBe(true);
    expect(scale.mock.calls).toEqual([[1]]);
    expect(wheel(map.querySelector('canvas')!, { ctrlKey: true, deltaY: -100 })).toBe(true);
    expect(scale.mock.calls).toEqual([[1]]);
  });

  it('does not touch a wheel without Ctrl', () => {
    expect(wheel(span, { deltaY: -100 })).toBe(false);
  });
});
