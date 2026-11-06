// The Preferences window of the Game menu, laid out as FreeCol's ClientOptionsDialog (OptionGroupUI): a
// tree of categories on the left, and the options of the one picked on the right. BrowserCol's own
// preferences, such as the animation and blink speeds, are the first category; FreeCol's client options
// the browser follows come after it, in FreeCol's groups. Hooks for tests: [data-category] on a
// category's button, with its id; [data-mute] on a volume's mute button, with the preference it sets.
import { useRef, useState } from 'react';
import { Select, Tip } from './controls';
import { Box, WindowFrame } from './frame';
import { LANGUAGE_OPTION } from './language';
import { OptionEditor } from './option-editor';
import type { OptionGroup } from './options';
import {
  ACTIVE_STYLES,
  DEFAULTS,
  DIMS,
  MUTES,
  SPEEDS,
  TILESETS,
  type ActiveStyle,
  type Dim,
  type Prefs,
  type Speed,
  type Tileset,
} from './prefs';
import { FONT_SETS, PALETTES, type FontSet, type Palette } from './theme';

const LABEL: Record<Speed, string> = { off: 'Off', slow: 'Slow', normal: 'Normal', fast: 'Fast' };

const DIM_LABEL: Record<Dim, string> = { off: 'Off', light: 'Light', normal: 'Normal', heavy: 'Heavy' };

const STYLE_LABEL: Record<ActiveStyle, string> = {
  freecol: 'FreeCol: blinking chevron',
  online: 'BrowserCol: blinking unit',
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
      <Select
        value={value}
        onChange={(v) => onChange(v as Speed)}
        choices={SPEEDS.map((s) => ({ value: s, label: LABEL[s] }))}
      />
    </label>
  );
}

/** The category of BrowserCol's own preferences. */
export const OWN_CATEGORY = 'browsercol';

/** A row of the category tree: a group with options of its own can be picked; one with only subgroups is a heading. */
export interface Category {
  id: string;
  label: string;
  /** How deep in the tree, 0 at the top. */
  depth: number;
  /** The group's own options, or null for a heading (and for BrowserCol's own category). */
  options: OptionGroup | null;
  pickable: boolean;
}

/** The category tree, as OptionGroupUI.buildTree builds it, fully expanded: BrowserCol's own first. */
export function categories(freecol: OptionGroup | null): Category[] {
  const out: Category[] = [{ id: OWN_CATEGORY, label: 'BrowserCol', depth: 0, options: null, pickable: true }];
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

/** The mute button beside a volume option's slider; muting keeps the volume for when it is unmuted. */
function MuteButton({ id, prefs, change }: { id: string; prefs: Prefs; change: (p: Prefs) => void }) {
  if (!(id in MUTES)) return null;
  const key = MUTES[id as keyof typeof MUTES];
  const muted = prefs[key];
  return (
    <Tip
      as="button"
      type="button"
      className="mute"
      data-mute={key}
      aria-pressed={muted}
      tip={muted ? 'Unmute' : 'Mute'}
      onClick={() => change({ ...prefs, [key]: !muted })}
    >
      {muted ? 'Muted' : 'Mute'}
    </Tip>
  );
}

/** BrowserCol's own preferences. */
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
        <Select
          value={prefs.activeStyle}
          onChange={(v) => change({ ...prefs, activeStyle: v as ActiveStyle })}
          choices={ACTIVE_STYLES.map((a) => ({ value: a, label: STYLE_LABEL[a] }))}
        />
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
        <Select
          value={prefs.dimUnfocused}
          onChange={(v) => change({ ...prefs, dimUnfocused: v as Dim })}
          choices={DIMS.map((d) => ({ value: d, label: DIM_LABEL[d] }))}
        />
      </label>
      <label data-pref="palette" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}>
        Colours
        <Select
          value={prefs.palette}
          onChange={(v) => change({ ...prefs, palette: v as Palette })}
          choices={PALETTES.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <label data-pref="fonts" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}>
        Fonts
        <Select
          value={prefs.fonts}
          onChange={(v) => change({ ...prefs, fonts: v as FontSet })}
          choices={FONT_SETS.map((f) => ({ value: f.id, label: f.label }))}
        />
      </label>
      <label data-pref="tileset" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' }}>
        Tileset (on reload)
        <Select
          value={prefs.tileset}
          onChange={(v) => change({ ...prefs, tileset: v as Tileset })}
          choices={TILESETS.map((t) => ({ value: t.id, label: t.label }))}
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
  // The preferences as the window opened with them: Reset and Cancel go back to these.
  const opened = useRef(prefs);
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
                <>
                  <OptionEditor
                    root={current.options}
                    editable
                    values={prefs.freecol}
                    onChange={(id, v) => {
                      if (Array.isArray(v)) return;
                      change({ ...prefs, freecol: { ...prefs.freecol, [id]: v } });
                    }}
                    after={(id) => <MuteButton id={id} prefs={prefs} change={change} />}
                  />
                  {current.options.children.some((o) => o.id === LANGUAGE_OPTION) && (
                    <p data-note="language" className="prefs-note">
                      The language is that of FreeCol's own text: messages, reports, names and the Colopedia.
                      BrowserCol's own labels stay English. Autodetect follows the browser's language.
                    </p>
                  )}
                </>
              ) : (
                <OwnOptions prefs={prefs} change={change} />
              )}
            </Box>
          </div>
        </div>
        <div className="buttons">
          <button type="button" data-prefs-reset onClick={() => change(opened.current)}>
            Reset
          </button>
          <button type="button" data-prefs-defaults onClick={() => change(DEFAULTS)}>
            Revert to Defaults
          </button>
          <button
            type="button"
            data-prefs-cancel
            onClick={() => {
              change(opened.current);
              close();
            }}
          >
            Cancel
          </button>
          <button type="button" autoFocus data-prefs-ok onClick={close}>
            OK
          </button>
        </div>
      </WindowFrame>
    </div>
  );
}
