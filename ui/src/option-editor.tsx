// The option editor (#56): one React editor for FreeCol's option groups, the
// way DifficultyDialog and GameOptionsDialog show them. Used on the start
// screen, where the player may change options before the game starts, and by
// the in-game panel, where the same groups are read-only. Hooks for the browser
// scripts: [data-option] on a row, with the option's id, and the control
// inside it; [data-group] on a group's box.
import { useState } from 'react';
import { Box } from './frame';
import type { OptionNode, OptionValue } from './options';

interface Props {
  root: OptionNode;
  /** Whether the controls take input. */
  editable: boolean;
  /** The values the player changed, by option id: what shows instead of the group's own. */
  values?: Record<string, OptionValue>;
  /** The player changed an option. */
  onChange?: (id: string, value: OptionValue) => void;
}

/** A whole number field: a value out of range or not a number is shown as invalid and not passed on. */
function NumberField({
  value,
  min,
  max,
  disabled,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  label: string;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const n = Number(shown);
  const bad = shown.trim() === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <input
      type="number"
      aria-label={label}
      aria-invalid={bad || undefined}
      min={min > -2147483648 ? min : undefined}
      max={max < 2147483647 ? max : undefined}
      disabled={disabled}
      value={shown}
      onChange={(e) => {
        const text = e.target.value;
        const m = Number(text);
        if (text.trim() !== '' && Number.isInteger(m) && m >= min && m <= max) {
          setDraft(null);
          onChange(m);
        } else {
          setDraft(text);
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function Row({
  node,
  editable,
  values,
  onChange,
}: { node: Exclude<OptionNode, { kind: 'group' }> } & Omit<Props, 'root'>) {
  const set = (v: OptionValue) => onChange?.(node.id, v);
  const value = values?.[node.id] ?? node.value;
  const disabled = !editable;
  let control;
  switch (node.kind) {
    case 'boolean':
      control = (
        <input
          type="checkbox"
          aria-label={node.label}
          disabled={disabled}
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
        />
      );
      break;
    case 'integer':
    case 'percentage':
      control = (
        <>
          <NumberField
            value={Number(value)}
            min={node.min}
            max={node.max}
            disabled={disabled}
            label={node.label}
            onChange={set}
          />
          {node.kind === 'percentage' && <span className="unit">%</span>}
        </>
      );
      break;
    case 'select':
      control = (
        <select
          aria-label={node.label}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => set(Number(e.target.value))}
        >
          {node.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'string':
      control = node.choices ? (
        <select aria-label={node.label} disabled={disabled} value={String(value)} onChange={(e) => set(e.target.value)}>
          {node.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          aria-label={node.label}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => set(e.target.value)}
        />
      );
      break;
    case 'text':
      control = (
        <input
          type="text"
          aria-label={node.label}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => set(e.target.value)}
        />
      );
      break;
  }
  return (
    <div
      className="option"
      data-option={node.id}
      data-changed={(values && node.id in values) || undefined}
      title={node.description ?? undefined}
    >
      <span className="name">{node.label}</span>
      {control}
    </div>
  );
}

function Group({ node, ...rest }: { node: Extract<OptionNode, { kind: 'group' }> } & Omit<Props, 'root'>) {
  return (
    <Box caption={node.label} data-group={node.id}>
      {node.children.map((c) =>
        c.kind === 'group' ? <Group key={c.id} node={c} {...rest} /> : <Row key={c.id} node={c} {...rest} />,
      )}
    </Box>
  );
}

/** An option group with its options and subgroups, each in a box with the group's name as its caption. */
export function OptionEditor({ root, ...rest }: Props) {
  return (
    <div className="options">
      {root.kind === 'group' ? (
        root.children.map((c) =>
          c.kind === 'group' ? <Group key={c.id} node={c} {...rest} /> : <Row key={c.id} node={c} {...rest} />,
        )
      ) : (
        <Row node={root} {...rest} />
      )}
    </div>
  );
}
