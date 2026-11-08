// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vite-plus/test';
import type { OptionGroup } from './options';
import { DEFAULTS, type Prefs } from './prefs';
import { ReloadNotice, reloadPending } from './reload-notice';

const options: OptionGroup = {
  kind: 'group',
  id: 'clientOptions',
  label: 'Client options',
  children: [
    { kind: 'boolean', id: 'model.option.useOpenGL', label: 'Enable OpenGL', value: true },
    { kind: 'boolean', id: 'model.option.autoScroll', label: 'Auto scroll', value: true },
  ],
} as OptionGroup;

const withFreecol = (freecol: Prefs['freecol']): Prefs => ({ ...DEFAULTS, freecol });

test('a changed Tileset is pending until the page reloads; setting it back clears it', () => {
  const other = { ...DEFAULTS, tileset: 'freecol-plus' } as Prefs;
  expect(reloadPending(DEFAULTS, other, options)).toEqual(['Tileset']);
  expect(reloadPending(DEFAULTS, DEFAULTS, options)).toEqual([]);
});

test("FreeCol's on-reload options count, by label; others and an unchanged default do not", () => {
  expect(reloadPending(DEFAULTS, withFreecol({ 'model.option.useOpenGL': false }), options)).toEqual(['Enable OpenGL']);
  expect(reloadPending(DEFAULTS, withFreecol({ 'model.option.useOpenGL': true }), options)).toEqual([]);
  expect(reloadPending(DEFAULTS, withFreecol({ 'model.option.autoScroll': false }), options)).toEqual([]);
});

test('the notice names what waits for a reload, and is gone when nothing does', () => {
  const { rerender } = render(<ReloadNotice names={['Tileset']} />);
  expect(screen.getByRole('status').textContent).toBe('Tileset: takes effect when you reload the page');
  rerender(<ReloadNotice names={[]} />);
  expect(screen.queryByRole('status')).toBeNull();
});
