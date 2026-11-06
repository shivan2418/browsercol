// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { acceleratorFor, inTextField, type KeyLike } from './accelerators';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFor', () => {
  it.each([
    ['n', 'new'],
    ['o', 'open'],
    ['s', 'save'],
    ['x', 'saveAndExit'],
    ['q', 'quit'],
    ['p', 'preferences'],
    ['c', 'centre'],
  ])('Ctrl+%s is %s', (k, entry) => {
    expect(acceleratorFor(key(k, { ctrlKey: true }))).toBe(entry);
    expect(acceleratorFor(key(k.toUpperCase(), { ctrlKey: true }))).toBe(entry);
  });

  it('takes Alt+Enter and F11 for full screen', () => {
    expect(acceleratorFor(key('Enter', { altKey: true }))).toBe('fullScreen');
    expect(acceleratorFor(key('F11'))).toBe('fullScreen');
  });

  it('leaves Shift+F11 to the side panel, and Enter to End Turn', () => {
    expect(acceleratorFor(key('F11', { shiftKey: true }))).toBeNull();
    expect(acceleratorFor(key('Enter'))).toBeNull();
  });

  it('ignores a letter without Ctrl, or with another modifier', () => {
    expect(acceleratorFor(key('s'))).toBeNull();
    expect(acceleratorFor(key('s', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(acceleratorFor(key('d', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(acceleratorFor(key('m', { ctrlKey: true }))).toBeNull();
  });
});

describe('inTextField', () => {
  it('is true for an input and a textarea, false for the body', () => {
    expect(inTextField(document.createElement('input'))).toBe(true);
    expect(inTextField(document.createElement('textarea'))).toBe(true);
    expect(inTextField(document.body)).toBe(false);
    expect(inTextField(null)).toBe(false);
  });
});
