// The Preferences window of the Game menu, laid out as FreeCol's ClientOptionsDialog (OptionGroupUI): a
// tree of categories on the left, and the options of the one picked on the right. FreeCol Online's own
// preferences, such as the animation and blink speeds, are the first category; FreeCol's client options
// the browser follows come after it, in FreeCol's groups. Hooks for tests: [data-category] on a
// category's button, with its id.
import { useState } from 'react';
import { Box, WindowFrame } from './frame';
import { OptionEditor } from './option-editor';
import type { OptionGroup } from './options';
import { ACTIVE_STYLES, SPEEDS, type ActiveStyle, type Prefs, type Speed } from './prefs';

const LABEL: Record<Speed, string> = { off: 'Off', slow: 'Slow', normal: 'Normal', fast: 'Fast' };

const STYLE_LABEL: Record<ActiveStyle, string> = {
  freecol: 'FreeCol: blinking chevron',
  online: 'FreeCol Online: blinking unit',
};

function SpeedRow({
  name,
  label,
  value,
  onChange,
}: {
  name: keyof Prefs;
  label: string;
  value: Speed;
  onChange: (s: Speed) => void;
}) {
  return (
    <label data-pref={name} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Speed)}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The category of FreeCol Online's own preferences. */
export const OWN_CATEGORY = 'freecolOnline';

/** A row of the category tree: a group with options of its own can be picked; one with only subgroups is a heading. */
export interface Category {
  id: string;
  label: string;
  /** How deep in the tree, 0 at the top. */
  depth: number;
  /** The group's own options, or null for a heading (and for FreeCol Online's own category). */
  options: OptionGroup | null;
  pickable: boolean;
}

/** The category tree, as OptionGroupUI.buildTree builds it, fully expanded: FreeCol Online's own first. */
export function categories(freecol: OptionGroup | null): Category[] {
  const out: Category[] = [{ id: OWN_CATEGORY, label: 'FreeCol Online', depth: 0, options: null, pickable: true }];
  const walk = (group: OptionGroup, depth: number) => {
    for (const c of group.children) {
      if (c.kind !== 'group') continue;
      const own = c.children.filter((o) => o.kind !== 'group');
      out.push({
        id: c.id,
        label: c.label,
        depth,
        options: own.length > 0 ? { ...c, children: own } : null,
        pickable: own.length > 0,
      });
      walk(c, depth + 1);
    }
  };
  if (freecol) walk(freecol, 0);
  return out;
}

/** FreeCol Online's own preferences. */
function OwnOptions({ prefs, change }: { prefs: Prefs; change: (p: Prefs) => void }) {
  return (
    <>
      <SpeedRow
        name="animation"
        label="Unit move animation"
        value={prefs.animation}
        onChange={(animation) => change({ ...prefs, animation })}
      />
      <label
        data-pref="activeStyle"
        style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}
      >
        Active unit shown by
        <select
          value={prefs.activeStyle}
          onChange={(e) => change({ ...prefs, activeStyle: e.target.value as ActiveStyle })}
        >
          {ACTIVE_STYLES.map((a) => (
            <option key={a} value={a}>
              {STYLE_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <SpeedRow
        name="blink"
        label="Blink speed"
        value={prefs.blink}
        onChange={(blink) => change({ ...prefs, blink })}
      />
      <label
        data-pref="autoEndTurn"
        style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}
      >
        End the turn automatically when no unit is left to move
        <input
          type="checkbox"
          checked={prefs.autoEndTurn}
          onChange={(e) => change({ ...prefs, autoEndTurn: e.target.checked })}
        />
      </label>
      <label
        data-pref="tutorial"
        style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}
      >
        Show tutorial messages
        <input
          type="checkbox"
          checked={prefs.tutorial}
          onChange={(e) => change({ ...prefs, tutorial: e.target.checked })}
        />
      </label>
      <label
        data-pref="dimUnfocused"
        style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}
      >
        Grey out the window when it is not focused
        <input
          type="checkbox"
          checked={prefs.dimUnfocused}
          onChange={(e) => change({ ...prefs, dimUnfocused: e.target.checked })}
        />
      </label>
    </>
  );
}

export function PreferencesDialog({
  prefs,
  freecol,
  change,
  close,
}: {
  prefs: Prefs;
  /** FreeCol's client options as the window shows them (prefs.ts, shownClientOptions), or null before the data loads. */
  freecol: OptionGroup | null;
  change: (p: Prefs) => void;
  close: () => void;
}) {
  const tree = categories(freecol);
  const [picked, pick] = useState(OWN_CATEGORY);
  const current = tree.find((c) => c.id === picked && c.pickable) ?? tree[0];
  return (
    <div className="modal">
      <WindowFrame title="Preferences" close={close} id="preferences">
        <div className="prefs-body">
          <nav className="prefs-tree" aria-label="Categories">
            {tree.map((c) =>
              c.pickable ? (
                <button
                  key={c.id}
                  type="button"
                  data-category={c.id}
                  aria-current={c.id === current.id || undefined}
                  style={{ paddingLeft: 6 + 14 * c.depth }}
                  onClick={() => pick(c.id)}
                >
                  {c.label}
                </button>
              ) : (
                <div key={c.id} className="heading" style={{ paddingLeft: 6 + 14 * c.depth }}>
                  {c.label}
                </div>
              ),
            )}
          </nav>
          <div className="prefs-detail">
            <Box caption={current.label} data-shown={current.id}>
              {current.options ? (
                <OptionEditor
                  root={current.options}
                  editable
                  values={prefs.freecol}
                  onChange={(id, v) => {
                    if (typeof v === 'boolean' || typeof v === 'number')
                      change({ ...prefs, freecol: { ...prefs.freecol, [id]: v } });
                  }}
                />
              ) : (
                <OwnOptions prefs={prefs} change={change} />
              )}
            </Box>
          </div>
        </div>
      </WindowFrame>
    </div>
  );
}
