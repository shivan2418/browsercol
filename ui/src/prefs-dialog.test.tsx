// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import type { OptionGroup } from './options';
import { categories, OWN_CATEGORY, PreferencesDialog, search } from './prefs-dialog';
import { DEFAULTS, type Prefs } from './prefs';
import { FONT_SETS } from './theme';
import { chooseOption, listed, openSelect, shown } from './select-test';

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

test("the categories are a tree, as in FreeCol, with BrowserCol's own first", () => {
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
    ['BrowserCol', 0, true],
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
  // BrowserCol's own show first.
  expect(screen.getByText('Blink speed')).toBeTruthy();
  expect(screen.queryByLabelText('Pre-combat analysis')).toBeNull();
  const messages = container.querySelector<HTMLElement>('[data-category="clientOptions.messages"]')!;
  expect(messages.getAttribute('aria-current')).toBeNull();
  fireEvent.click(messages);
  expect(messages.getAttribute('aria-current')).toBe('true');
  expect(screen.queryByText('Blink speed')).toBeNull();
  expect(shown(screen.getByLabelText('Response to Indian Demands'))).toBe('Reject');
  fireEvent.click(screen.getByLabelText('Pre-combat analysis'));
  expect(changes.at(-1)?.freecol).toEqual({
    'model.option.indianDemandResponse': 2,
    'model.option.guiShowPreCombat': false,
  });
});

test("before the data loads, only BrowserCol's own show", () => {
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={null} change={() => {}} close={() => {}} />,
  );
  expect([...container.querySelectorAll('[data-category]')].map((e) => e.textContent)).toEqual(['BrowserCol']);
  expect(screen.getByText('Blink speed')).toBeTruthy();
});

test("the colours and the fonts are among BrowserCol's own, and a pick changes them", async () => {
  const changed: Prefs[] = [];
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={null} change={(p) => changed.push(p)} close={() => {}} />,
  );
  const colours = container.querySelector<HTMLElement>('[data-pref="palette"] [role="combobox"]')!;
  await openSelect(colours);
  expect(listed()).toEqual(['Parchment', 'Dark']);
  await chooseOption(colours, 'Dark');
  expect(changed.at(-1)).toEqual({ ...DEFAULTS, palette: 'dark' });
  const fonts = container.querySelector<HTMLElement>('[data-pref="fonts"] [role="combobox"]')!;
  expect(shown(fonts)).toBe(FONT_SETS.find((f) => f.id === 'cinzel-noto')!.label);
});

test('the Tileset is picked among FreeCol and FreeCol+, and shows on reload', async () => {
  const changed: Prefs[] = [];
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={null} change={(p) => changed.push(p)} close={() => {}} />,
  );
  const row = container.querySelector('[data-pref="tileset"]')!;
  expect(row.textContent).toContain('Tileset (on reload)');
  const tileset = row.querySelector<HTMLElement>('[role="combobox"]')!;
  await openSelect(tileset);
  expect(listed()).toEqual(['FreeCol', 'FreeCol+']);
  await chooseOption(tileset, 'FreeCol+');
  expect(changed.at(-1)).toEqual({ ...DEFAULTS, tileset: 'freecol-plus' });
});

test("the language's category says the Browser UI's own labels stay English", () => {
  const personal: OptionGroup = {
    ...freecol,
    children: [
      {
        id: 'clientOptions.personal',
        label: 'Personal',
        description: null,
        kind: 'group',
        children: [
          {
            id: 'model.option.languageOption',
            label: 'Language (on reload)',
            description: null,
            kind: 'string',
            value: 'automatic',
            choices: [
              { value: 'automatic', label: 'Autodetect Language' },
              { value: 'de', label: 'Deutsch' },
            ],
          },
        ],
      },
      ...freecol.children,
    ],
  };
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={personal} change={() => {}} close={() => {}} />,
  );
  fireEvent.click(container.querySelector<HTMLElement>('[data-category="clientOptions.personal"]')!);
  expect(container.querySelector('[data-note="language"]')?.textContent).toMatch(
    /BrowserCol's own labels stay English/,
  );
  fireEvent.click(container.querySelector<HTMLElement>('[data-category="clientOptions.messages"]')!);
  expect(container.querySelector('[data-note="language"]')).toBeNull();
});

test('each volume is a slider with a mute button beside it, and muting leaves the volume as it was', () => {
  const audio: OptionGroup = {
    ...freecol,
    children: [
      {
        id: 'clientOptions.audio',
        label: 'Audio',
        description: null,
        kind: 'group',
        children: [
          {
            id: 'model.option.musicVolume',
            label: 'Music volume',
            description: null,
            kind: 'percentage',
            value: 100,
            min: 0,
            max: 100,
          },
          {
            id: 'model.option.soundEffectsVolume',
            label: 'Sound effects volume',
            description: null,
            kind: 'percentage',
            value: 100,
            min: 0,
            max: 100,
          },
          { id: 'model.option.audioAlerts', label: 'Audio alerts', description: null, kind: 'boolean', value: true },
        ],
      },
    ],
  };
  const changes: Prefs[] = [];
  const prefs = { ...DEFAULTS, muteMusic: false, muteEffects: true, freecol: { 'model.option.musicVolume': 60 } };
  const { container } = render(
    <PreferencesDialog prefs={prefs} freecol={audio} change={(p) => changes.push(p)} close={() => {}} />,
  );
  fireEvent.click(container.querySelector<HTMLElement>('[data-category="clientOptions.audio"]')!);
  expect(screen.getByLabelText<HTMLInputElement>('Music volume').type).toBe('range');
  expect(container.querySelectorAll('[data-mute]')).toHaveLength(2);
  const music = container.querySelector<HTMLElement>('[data-mute="muteMusic"]')!;
  const effects = container.querySelector<HTMLElement>('[data-mute="muteEffects"]')!;
  expect(music.getAttribute('aria-pressed')).toBe('false');
  expect(effects.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(music);
  expect(changes.at(-1)).toMatchObject({
    muteMusic: true,
    muteEffects: true,
    freecol: { 'model.option.musicVolume': 60 },
  });
  fireEvent.click(effects);
  expect(changes.at(-1)).toMatchObject({ muteMusic: false, muteEffects: false });
  fireEvent.change(screen.getByLabelText('Sound effects volume'), { target: { value: '25' } });
  expect(changes.at(-1)?.freecol).toEqual({ 'model.option.musicVolume': 60, 'model.option.soundEffectsVolume': 25 });
});

test('the audio category has a switch for playing sound while the tab is hidden, off by default', () => {
  const changes: Prefs[] = [];
  const audio: OptionGroup = {
    ...freecol,
    children: [
      {
        id: 'clientOptions.audio',
        label: 'Audio',
        description: null,
        kind: 'group',
        children: [
          {
            id: 'model.option.musicVolume',
            label: 'Music volume',
            description: null,
            kind: 'percentage',
            value: 100,
            min: 0,
            max: 100,
          },
        ],
      },
    ],
  };
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={audio} change={(p) => changes.push(p)} close={() => {}} />,
  );
  fireEvent.click(container.querySelector<HTMLElement>('[data-category="clientOptions.audio"]')!);
  const box = container.querySelector<HTMLInputElement>('[data-pref="playHidden"] input')!;
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  expect(changes.at(-1)).toMatchObject({ playHidden: true });
});

test('Reset and Cancel go back to the preferences the window opened with, Revert to Defaults to the defaults', () => {
  const changes: Prefs[] = [];
  let closed = 0;
  const opened = { ...DEFAULTS, blink: 'fast' as const };
  const { container } = render(
    <PreferencesDialog prefs={opened} freecol={null} change={(p) => changes.push(p)} close={() => closed++} />,
  );
  fireEvent.click(container.querySelector('[data-prefs-defaults]')!);
  expect(changes.at(-1)).toEqual(DEFAULTS);
  fireEvent.click(container.querySelector('[data-prefs-reset]')!);
  expect(changes.at(-1)).toEqual(opened);
  expect(closed).toBe(0);
  fireEvent.click(container.querySelector('[data-prefs-cancel]')!);
  expect(changes.at(-1)).toEqual(opened);
  expect(closed).toBe(1);
  fireEvent.click(container.querySelector('[data-prefs-ok]')!);
  expect(closed).toBe(2);
  expect(changes).toHaveLength(3);
});

test('the Preferences window opens with OK focused, so the focus ring marks the default', () => {
  render(<PreferencesDialog prefs={DEFAULTS} freecol={null} change={() => {}} close={() => {}} />);
  expect(document.activeElement).toBe(document.querySelector('[data-prefs-ok]'));
});

const searchable: OptionGroup = {
  ...freecol,
  children: [
    {
      id: 'clientOptions.interface',
      label: 'Interface',
      description: null,
      kind: 'group',
      children: [
        {
          id: 'clientOptions.display',
          label: 'Display',
          description: null,
          kind: 'group',
          children: [
            {
              id: 'model.option.displayScale',
              label: 'Display scaling',
              description: 'Makes the café menus bigger or smaller',
              kind: 'percentage',
              value: 100,
              min: 50,
              max: 200,
            },
          ],
        },
      ],
    },
    ...freecol.children,
  ],
};

test('a search finds options by name or tooltip, in nested groups and in BrowserCol, ignoring case and accents', () => {
  const ids = (q: string) => search(searchable, q).map((m) => m.key);
  expect(ids('SCALING')).toEqual(['model.option.displayScale']);
  expect(ids('CAFE')).toEqual(['model.option.displayScale']);
  expect(search(searchable, 'scaling')[0].path).toEqual(['Interface', 'Display', 'Display scaling']);
  expect(ids('blink')).toEqual(['own.blink']);
  expect(search(searchable, 'blink')[0].path).toEqual(['BrowserCol', 'Blink speed']);
  expect(ids('pre-combat')).toEqual(['model.option.guiShowPreCombat']);
  expect(ids('  ')).toEqual([]);
  expect(ids('zzz')).toEqual([]);
});

test('typing in the search shows the matches with their paths, marks the tree, and says when nothing matches', () => {
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={() => {}} close={() => {}} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  fireEvent.change(field, { target: { value: 'scal' } });
  const result = container.querySelector('[data-result="model.option.displayScale"]')!;
  expect(result.textContent).toContain('Interface › Display');
  expect(result.querySelector('mark')?.textContent).toBe('scal');
  expect(container.querySelector('[data-category="clientOptions.display"]')!.hasAttribute('data-dim')).toBe(false);
  expect(container.querySelector('[data-category="clientOptions.messages"]')!.hasAttribute('data-dim')).toBe(true);
  expect(container.querySelector('[data-category="browsercol"]')!.hasAttribute('data-dim')).toBe(true);
  fireEvent.change(field, { target: { value: 'nothing like it' } });
  expect(container.querySelector('[data-search-none]')).toBeTruthy();
  fireEvent.change(field, { target: { value: '' } });
  expect(screen.getByText('Blink speed')).toBeTruthy();
});

test('an option changed in the results saves as it does in its category', () => {
  const changes: Prefs[] = [];
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={(p) => changes.push(p)} close={() => {}} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  fireEvent.change(field, { target: { value: 'pre-combat' } });
  fireEvent.click(screen.getByLabelText('Pre-combat analysis'));
  const viaSearch = changes.at(-1);
  expect(viaSearch?.freecol).toEqual({ 'model.option.guiShowPreCombat': false });
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.click(container.querySelector<HTMLElement>('[data-category="clientOptions.messages"]')!);
  fireEvent.click(screen.getByLabelText('Pre-combat analysis'));
  expect(changes.at(-1)).toEqual(viaSearch);
  // BrowserCol's own preference too.
  fireEvent.change(field, { target: { value: 'tutorial' } });
  fireEvent.click(container.querySelector('[data-pref="tutorial"] input')!);
  expect(changes.at(-1)).toEqual({ ...DEFAULTS, tutorial: !DEFAULTS.tutorial });
});

test('Escape in the search field clears it and keeps the window; a second Escape closes it', () => {
  let closed = 0;
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={() => {}} close={() => closed++} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  field.focus();
  fireEvent.change(field, { target: { value: 'blink' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(field.value).toBe('');
  expect(closed).toBe(0);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(closed).toBe(1);
});

test('Ctrl+F and / put the focus in the search field, and / typed in a field stays text', () => {
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={() => {}} close={() => {}} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  expect(document.activeElement).not.toBe(field);
  const ctrlF = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ctrlF);
  expect(ctrlF.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(field);
  (document.activeElement as HTMLElement).blur();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(field);
  const typed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  field.dispatchEvent(typed);
  expect(typed.defaultPrevented).toBe(false);
});

test('Arrow down in the search field moves to the first result', () => {
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={() => {}} close={() => {}} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  fireEvent.change(field, { target: { value: 'scal' } });
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByLabelText('Display scaling'));
});

test("keys typed in the search field, and Ctrl+F, do not reach the game's own key handler", () => {
  const seen: string[] = [];
  const spy = (e: Event) => seen.push((e as KeyboardEvent).key);
  addEventListener('keydown', spy);
  const { container } = render(
    <PreferencesDialog prefs={DEFAULTS} freecol={searchable} change={() => {}} close={() => {}} />,
  );
  const field = container.querySelector<HTMLInputElement>('[data-prefs-search]')!;
  fireEvent.keyDown(field, { key: 's' });
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  removeEventListener('keydown', spy);
  expect(seen).toEqual([]);
});
