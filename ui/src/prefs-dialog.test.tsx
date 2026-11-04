// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import type { OptionGroup } from './options';
import { categories, OWN_CATEGORY, PreferencesDialog } from './prefs-dialog';
import { DEFAULTS, type Prefs } from './prefs';

afterEach(cleanup);

const freecol: OptionGroup = {
  id: 'clientOptions',
  label: 'Client options',
  description: null,
  kind: 'group',
  children: [
    {
      id: 'clientOptions.messages',
      label: 'Messages',
      description: null,
      kind: 'group',
      children: [
        {
          id: 'model.option.guiShowPreCombat',
          label: 'Pre-combat analysis',
          description: null,
          kind: 'boolean',
          value: true,
        },
        {
          id: 'model.option.indianDemandResponse',
          label: 'Response to Indian Demands',
          description: null,
          kind: 'select',
          value: 0,
          choices: [
            { value: 0, label: 'Ask' },
            { value: 2, label: 'Reject' },
          ],
        },
      ],
    },
  ],
};

test("the categories are a tree, as in FreeCol, with FreeCol Online's own first", () => {
  const nested: OptionGroup = {
    ...freecol,
    children: [
      {
        id: 'clientOptions.interface',
        label: 'Interface',
        description: null,
        kind: 'group',
        children: freecol.children,
      },
    ],
  };
  expect(categories(nested).map((c) => [c.label, c.depth, c.pickable])).toEqual([
    ['FreeCol Online', 0, true],
    ['Interface', 0, false],
    ['Messages', 1, true],
  ]);
  expect(categories(null).map((c) => c.id)).toEqual([OWN_CATEGORY]);
});

test("a category's options show once it is picked, and a change keeps them by id", () => {
  const changes: Prefs[] = [];
  const prefs = { ...DEFAULTS, freecol: { 'model.option.indianDemandResponse': 2 } };
  const { container } = render(
    <PreferencesDialog prefs={prefs} freecol={freecol} change={(p) => changes.push(p)} close={() => {}} />,
  );
  // FreeCol Online's own show first.
  expect(screen.getByText('Blink speed')).toBeTruthy();
  expect(screen.queryByLabelText('Pre-combat analysis')).toBeNull();
  const messages = container.querySelector<HTMLElement>('[data-category="clientOptions.messages"]')!;
  expect(messages.getAttribute('aria-current')).toBeNull();
  fireEvent.click(messages);
  expect(messages.getAttribute('aria-current')).toBe('true');
  expect(screen.queryByText('Blink speed')).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>('Response to Indian Demands').value).toBe('2');
  fireEvent.click(screen.getByLabelText('Pre-combat analysis'));
  expect(changes.at(-1)?.freecol).toEqual({
    'model.option.indianDemandResponse': 2,
    'model.option.guiShowPreCombat': false,
  });
});

test("before the data loads, only FreeCol Online's own show", () => {
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={null} change={() => {}} close={() => {}} />,
  );
  expect([...container.querySelectorAll('[data-category]')].map((e) => e.textContent)).toEqual(['FreeCol Online']);
  expect(screen.getByText('Blink speed')).toBeTruthy();
});
