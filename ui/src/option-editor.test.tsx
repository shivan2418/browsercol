// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vite-plus/test';
import { OptionEditor } from './option-editor';
import type { OptionGroup, OptionValue } from './options';

afterEach(cleanup);

const base = { description: null };
const group: OptionGroup = {
  ...base,
  id: 'g',
  label: 'Everything',
  kind: 'group',
  children: [
    {
      ...base,
      id: 'g.sub',
      label: 'Sub group',
      kind: 'group',
      children: [{ ...base, id: 'o.fog', label: 'Fog of war', kind: 'boolean', value: true }],
    },
    { ...base, id: 'o.turns', label: 'Turns to sail', kind: 'integer', value: 3, min: 1, max: 10 },
    { ...base, id: 'o.gift', label: 'Gift probability', kind: 'percentage', value: 5, min: 0, max: 100 },
    {
      ...base,
      id: 'o.start',
      label: 'Starting positions',
      kind: 'select',
      value: 0,
      choices: [
        { value: 0, label: 'Classic' },
        { value: 1, label: 'Random' },
      ],
    },
    {
      ...base,
      id: 'o.land',
      label: 'Build on native land',
      kind: 'string',
      value: 'always',
      choices: [
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' },
      ],
    },
    { ...base, id: 'o.tile', label: 'Tile production', kind: 'string', value: 'high' },
    { ...base, id: 'o.note', label: 'Note', kind: 'text', value: 'hello' },
  ],
};

function editor(editable = true, values: Record<string, OptionValue> = {}) {
  const changes: [string, OptionValue][] = [];
  render(<OptionEditor root={group} editable={editable} values={values} onChange={(id, v) => changes.push([id, v])} />);
  return changes;
}

test('every option type shows its label and value, and the groups are boxes with their names', () => {
  editor();
  expect(screen.getByText('Sub group')).toBeTruthy();
  expect((screen.getByLabelText('Fog of war') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Turns to sail') as HTMLInputElement).value).toBe('3');
  expect((screen.getByLabelText('Gift probability') as HTMLInputElement).value).toBe('5');
  expect((screen.getByLabelText('Starting positions') as HTMLSelectElement).selectedOptions[0].textContent).toBe(
    'Classic',
  );
  expect((screen.getByLabelText('Build on native land') as HTMLSelectElement).value).toBe('always');
  expect((screen.getByLabelText('Tile production') as HTMLInputElement).value).toBe('high');
  expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('hello');
});

test('each option type edits', () => {
  const changes = editor();
  fireEvent.click(screen.getByLabelText('Fog of war'));
  fireEvent.change(screen.getByLabelText('Turns to sail'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('Gift probability'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('Starting positions'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Build on native land'), { target: { value: 'never' } });
  fireEvent.change(screen.getByLabelText('Tile production'), { target: { value: 'low' } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'bye' } });
  expect(changes).toEqual([
    ['o.fog', false],
    ['o.turns', 7],
    ['o.gift', 40],
    ['o.start', 1],
    ['o.land', 'never'],
    ['o.tile', 'low'],
    ['o.note', 'bye'],
  ]);
});

test('a percentage is a slider with its value beside it', () => {
  editor(true, { 'o.gift': 30 });
  const gift = screen.getByLabelText<HTMLInputElement>('Gift probability');
  expect(gift.type).toBe('range');
  expect(document.querySelector('[data-option="o.gift"] output')?.textContent).toBe('30%');
});

test('a number out of range or not whole is marked invalid and not passed on', () => {
  const changes = editor();
  const turns = screen.getByLabelText('Turns to sail');
  fireEvent.change(turns, { target: { value: '11' } });
  expect(turns.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(turns, { target: { value: '2.5' } });
  fireEvent.change(turns, { target: { value: '' } });
  expect(changes).toEqual([]);
  fireEvent.change(turns, { target: { value: '9' } });
  expect(changes).toEqual([['o.turns', 9]]);
  expect(turns.getAttribute('aria-invalid')).toBeNull();
});

test('changed values show instead of the group’s own and are marked', () => {
  editor(true, { 'o.turns': 8, 'o.fog': false });
  expect((screen.getByLabelText('Turns to sail') as HTMLInputElement).value).toBe('8');
  expect((screen.getByLabelText('Fog of war') as HTMLInputElement).checked).toBe(false);
  expect(document.querySelector('[data-option="o.turns"]')?.hasAttribute('data-changed')).toBe(true);
  expect(document.querySelector('[data-option="o.gift"]')?.hasAttribute('data-changed')).toBe(false);
});

test('read-only, no control takes input', () => {
  editor(false);
  const controls = [
    ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-option] :is(input, select)'),
  ];
  expect(controls).toHaveLength(7);
  expect(controls.every((c) => c.disabled)).toBe(true);
});
