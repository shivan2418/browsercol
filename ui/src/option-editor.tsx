// The option editor (#56): one React editor for FreeCol's option groups, the
// way DifficultyDialog and GameOptionsDialog show them. Used on the start
// screen, where the player may change options before the game starts, and by
// the in-game panel, where the same groups are read-only. Hooks for the browser
// scripts: [data-option] on a row, with the option's id, and the control
// inside it; [data-group] on a group's box. A percentage option is a slider,
// as FreeCol's PercentageOptionUI is.
import { useRef, useState, type ReactNode } from 'react';
import { Box } from './frame';
import type { OptionNode, OptionValue, UnitEntry } from './options';

interface Props {
  root: OptionNode;
  /** Whether the controls take input. */
  editable: boolean;
  /** The values the player changed, by option id: what shows instead of the group's own. */
  values?: Record<string, OptionValue>;
  /** The player changed an option. */
  onChange?: (id: string, value: OptionValue) => void;
  /** The player picked a file for a file option, or cleared it (null). Without it a file option only shows its name. */
  onFile?: (id: string, file: File | null) => void;
  /** The names of the files picked, by option id; a file option with none shows the name the group has. */
  fileNames?: Record<string, string>;
  /** Anything to show after an option's control, such as a mute button beside a volume, by option id. */
  after?: (id: string) => ReactNode;
}

/**
 * A file option's picker: the browser's own would show "Browse... No file selected" in the browser's
 * language, so the input stays hidden behind a game button and the row shows the picked name.
 */
function FilePicker({ label, onFile }: { label: string; onFile: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" data-file-choose onClick={() => input.current?.click()}>
        Choose
      </button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept=".fsm,.fsg"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </>
  );
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

/** A unit list option: its entries in order, each with a unit type, a role and a number, and Add. */
function UnitList({
  node,
  entries,
  disabled,
  label,
  onChange,
}: {
  node: Extract<OptionNode, { kind: 'units' }>;
  entries: UnitEntry[];
  disabled: boolean;
  label: string;
  onChange: (entries: UnitEntry[]) => void;
}) {
  const replace = (i: number, patch: Partial<UnitEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, by: number) => {
    const next = [...entries];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  return (
    <div className="units" aria-label={label}>
      {entries.map((e, i) => (
        <div className="unit" key={i} data-unit={i}>
          <NumberField
            value={e.number}
            min={1}
            max={999}
            disabled={disabled}
            label={`${label}: number ${i + 1}`}
            onChange={(number) => replace(i, { number })}
          />
          <select
            aria-label={`${label}: unit type ${i + 1}`}
            disabled={disabled}
            value={e.type}
            onChange={(ev) => replace(i, { type: ev.target.value })}
          >
            {node.unitTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`${label}: role ${i + 1}`}
            disabled={disabled}
            value={e.role}
            onChange={(ev) => replace(i, { role: ev.target.value })}
          >
            {node.roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={disabled || i === 0} title="Move up" onClick={() => move(i, -1)}>
            Up
          </button>
          <button
            type="button"
            disabled={disabled || i === entries.length - 1}
            title="Move down"
            onClick={() => move(i, 1)}
          >
            Down
          </button>
          <button
            type="button"
            data-unit-remove={i}
            disabled={disabled}
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        data-unit-add
        disabled={disabled || node.unitTypes.length === 0}
        onClick={() =>
          onChange([
            ...entries,
            { type: node.unitTypes[0].value, role: node.roles[0]?.value ?? 'model.role.default', number: 1 },
          ])
        }
      >
        Add
      </button>
    </div>
  );
}

function Row({
  node,
  editable,
  values,
  onChange,
  onFile,
  fileNames,
  after,
}: { node: Exclude<OptionNode, { kind: 'group' }> } & Omit<Props, 'root'>) {
  const set = (v: OptionValue) => onChange?.(node.id, v);
  const value = values?.[node.id] ?? node.value;
  const plain = Array.isArray(value) ? '' : value;
  const disabled = !editable;
  let control;
  switch (node.kind) {
    case 'units':
      control = (
        <UnitList
          node={node}
          entries={Array.isArray(value) ? value : node.value}
          disabled={disabled}
          label={node.label}
          onChange={set}
        />
      );
      break;
    case 'boolean':
      control = (
        <input
          type="checkbox"
          aria-label={node.label}
          disabled={disabled}
          checked={plain === true}
          onChange={(e) => set(e.target.checked)}
        />
      );
      break;
    case 'integer':
      control = (
        <NumberField
          value={Number(plain)}
          min={node.min}
          max={node.max}
          disabled={disabled}
          label={node.label}
          onChange={set}
        />
      );
      break;
    case 'percentage':
      control = (
        <span className="slider">
          <input
            type="range"
            aria-label={node.label}
            min={node.min}
            max={node.max}
            step={1}
            disabled={disabled}
            value={Number(plain)}
            onChange={(e) => set(Number(e.target.value))}
          />
          <output>{Number(plain)}%</output>
        </span>
      );
      break;
    case 'select':
      control = (
        <select
          aria-label={node.label}
          disabled={disabled}
          value={String(plain)}
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
    case 'file': {
      const name = fileNames?.[node.id] ?? node.value;
      control = (
        <span className="file">
          {editable && onFile && (
            <FilePicker
              label={node.label}
              // Picking the same file again after a clear still fires change.
              key={name}
              onFile={(file) => onFile(node.id, file)}
            />
          )}
          {name === '' ? <em data-file-none>None</em> : <output data-file-name>{name}</output>}
          {editable && onFile && name !== '' && (
            <button type="button" data-file-clear onClick={() => onFile(node.id, null)}>
              Clear
            </button>
          )}
        </span>
      );
      break;
    }
    case 'string':
    case 'text':
      control =
        node.kind === 'string' && node.choices ? (
          <select
            aria-label={node.label}
            disabled={disabled}
            value={String(plain)}
            onChange={(e) => set(e.target.value)}
          >
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
            value={String(plain)}
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
      {after?.(node.id)}
    </div>
  );
}

/** A group's options and subgroups, in order. */
function Children({ nodes, ...rest }: { nodes: OptionNode[] } & Omit<Props, 'root'>) {
  return nodes.map((c) =>
    c.kind === 'group' ? <Group key={c.id} node={c} {...rest} /> : <Row key={c.id} node={c} {...rest} />,
  );
}

function Group({ node, ...rest }: { node: Extract<OptionNode, { kind: 'group' }> } & Omit<Props, 'root'>) {
  return (
    <Box caption={node.label} data-group={node.id}>
      <Children nodes={node.children} {...rest} />
    </Box>
  );
}

/** An option group with its options and subgroups, each in a box with the group's name as its caption. */
export function OptionEditor({ root, ...rest }: Props) {
  return (
    <div className="options">
      <Children nodes={root.kind === 'group' ? root.children : [root]} {...rest} />
    </div>
  );
}
