// The Preferences window of the Game menu, laid out as FreeCol's ClientOptionsDialog (OptionGroupUI): a
// tree of categories on the left, and the options of the one picked on the right. BrowserCol's own
// preferences, such as the animation and blink speeds, are the first category; FreeCol's client options
// the browser follows come after it, in FreeCol's groups. Hooks for tests: [data-category] on a
// category's button, with its id; [data-mute] on a volume's mute button, with the preference it sets.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flag } from './flag';
import { Select, Tip } from './controls';
import { Box, ButtonRow, TEXT_ENTRY, WindowFrame } from './frame';
import { LANGUAGE_OPTION } from './language';
import { describe, offlineAudio } from './offline-audio';
import { OptionEditor } from './option-editor';
import type { OptionGroup, OptionNode } from './options';
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
import { useCoverage } from './coverage';
import './prefs-dialog.css';

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
  label: ReactNode;
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

/** BrowserCol's own preferences, in the order the category shows them; `description` is the tooltip a search also reads. */
export const OWN_OPTIONS = [
  { pref: 'animation', label: 'Unit move animation' },
  { pref: 'activeStyle', label: 'Active unit shown by' },
  { pref: 'blink', label: 'Blink speed' },
  { pref: 'autoEndTurn', label: 'End the turn automatically when no unit is left to move' },
  { pref: 'tutorial', label: 'Show tutorial messages' },
  { pref: 'dimUnfocused', label: 'Grey out the window when it is not focused' },
  { pref: 'palette', label: 'Colours' },
  { pref: 'fonts', label: 'Fonts' },
  { pref: 'tileset', label: 'Tileset (on reload)' },
  {
    pref: 'allowDebug',
    label: 'Allow debug mode',
    description: 'The Debug menu: reveal the map, add gold, units and goods. Off, Ctrl+Shift+D and ?debug do nothing.',
  },
] as const satisfies readonly { pref: keyof Prefs; label: string; description?: string }[];

type OwnPref = (typeof OWN_OPTIONS)[number]['pref'];

const ROW = { display: 'flex', gap: 12, justifyContent: 'space-between', margin: '6px 0' } as const;

/** One of BrowserCol's own preferences: its label, which a search marks, and its control. */
function OwnRow({
  pref,
  label,
  prefs,
  change,
}: {
  pref: OwnPref;
  label: ReactNode;
  prefs: Prefs;
  change: (p: Prefs) => void;
}) {
  switch (pref) {
    case 'animation':
      return (
        <SpeedRow
          name="animation"
          label={label}
          value={prefs.animation}
          onChange={(animation) => change({ ...prefs, animation })}
        />
      );
    case 'blink':
      return (
        <SpeedRow name="blink" label={label} value={prefs.blink} onChange={(blink) => change({ ...prefs, blink })} />
      );
    case 'activeStyle':
      return (
        <label data-pref="activeStyle" style={ROW}>
          {label}
          <Select
            value={prefs.activeStyle}
            onChange={(v) => change({ ...prefs, activeStyle: v as ActiveStyle })}
            choices={ACTIVE_STYLES.map((a) => ({ value: a, label: STYLE_LABEL[a] }))}
          />
        </label>
      );
    case 'autoEndTurn':
    case 'tutorial':
    case 'allowDebug':
      return (
        <label data-pref={pref} style={ROW}>
          {label}
          <input
            type="checkbox"
            checked={prefs[pref]}
            onChange={(e) => change({ ...prefs, [pref]: e.target.checked })}
          />
        </label>
      );
    case 'dimUnfocused':
      return (
        <label data-pref="dimUnfocused" style={ROW}>
          {label}
          <Select
            value={prefs.dimUnfocused}
            onChange={(v) => change({ ...prefs, dimUnfocused: v as Dim })}
            choices={DIMS.map((d) => ({ value: d, label: DIM_LABEL[d] }))}
          />
        </label>
      );
    case 'palette':
      return (
        <label data-pref="palette" style={ROW}>
          {label}
          <Select
            value={prefs.palette}
            onChange={(v) => change({ ...prefs, palette: v as Palette })}
            choices={PALETTES.map((p) => ({ value: p.id, label: p.label }))}
          />
        </label>
      );
    case 'fonts':
      return (
        <label data-pref="fonts" style={ROW}>
          {label}
          <Select
            value={prefs.fonts}
            onChange={(v) => change({ ...prefs, fonts: v as FontSet })}
            choices={FONT_SETS.map((f) => ({ value: f.id, label: f.label }))}
          />
        </label>
      );
    case 'tileset':
      return (
        <label data-pref="tileset" style={ROW}>
          {label}
          <Select
            value={prefs.tileset}
            onChange={(v) => change({ ...prefs, tileset: v as Tileset })}
            choices={TILESETS.map((t) => ({ value: t.id, label: t.label }))}
          />
        </label>
      );
  }
}

/** BrowserCol's own preferences. */
function OwnOptions({ prefs, change }: { prefs: Prefs; change: (p: Prefs) => void }) {
  return (
    <>
      {OWN_OPTIONS.map((o) => (
        <OwnRow key={o.pref} pref={o.pref} label={o.label} prefs={prefs} change={change} />
      ))}
    </>
  );
}

const PLAY_HIDDEN = 'Keep playing sound while the tab is hidden';

/** The audio categories' switch for sound while the tab is hidden. */
function PlayHiddenRow({ label, prefs, change }: { label: ReactNode; prefs: Prefs; change: (p: Prefs) => void }) {
  return (
    <label data-pref="playHidden" style={ROW}>
      {label}
      <input
        type="checkbox"
        checked={prefs.playHidden}
        onChange={(e) => change({ ...prefs, playHidden: e.target.checked })}
      />
    </label>
  );
}

const OFFLINE_AUDIO = 'Download the music for offline';

/**
 * The audio categories' offline download (#505): a button that has the service worker keep every music file (the
 * sound effects are cached at install), with its progress, and Remove once it is done. The choice is the offlineAudio preference. Without a worker
 * (a dev server) the button is disabled, and the line says why.
 */
function OfflineAudioRow({ label, prefs, change }: { label: ReactNode; prefs: Prefs; change: (p: Prefs) => void }) {
  const state = useSyncExternalStore(offlineAudio.subscribe, offlineAudio.snapshot);
  const done = state.status === 'done';
  return (
    <div data-pref="offlineAudio" data-status={state.status} className="offline-audio">
      <button
        type="button"
        data-offline-audio-button={done ? 'remove' : 'download'}
        disabled={state.status === 'unavailable' || state.status === 'working'}
        onClick={() => change({ ...prefs, offlineAudio: !done })}
      >
        {done ? 'Remove' : label}
      </button>
      <span className="prefs-note" data-offline-audio-note>
        {describe(state)}
      </span>
    </div>
  );
}

/** A text as a search compares it: without case or accents. `at[i]` is where normalised character i starts in the text. */
function fold(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    for (const f of ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()) {
      folded += f;
      for (let k = 0; k < f.length; k++) at.push(i);
    }
    i += ch.length;
  }
  at.push(i);
  return { folded, at };
}

/** A found option: where it is in the tree, and what shows it. */
export interface Match {
  key: string;
  /** The category it is in (a pickable one, or BrowserCol's own). */
  categoryId: string;
  /** Every category id on the way down to it, for the tree's marks. */
  pathIds: string[];
  /** The group names on the way down, then the option's name. */
  path: string[];
  label: string;
  /** What shows its control: BrowserCol's own preference, the audio switch, or a FreeCol option. */
  what:
    | { own: OwnPref }
    | { playHidden: true }
    | { offlineAudio: true }
    | { option: Exclude<OptionNode, { kind: 'group' }> };
}

/** Every option the window has, with its place in the tree. */
export function allOptions(freecol: OptionGroup | null): (Match & { description: string | null })[] {
  const out: (Match & { description: string | null })[] = OWN_OPTIONS.map((o) => ({
    key: `own.${o.pref}`,
    categoryId: OWN_CATEGORY,
    pathIds: [OWN_CATEGORY],
    path: ['BrowserCol', o.label],
    label: o.label,
    description: 'description' in o ? (o.description as string) : null,
    what: { own: o.pref } as Match['what'],
  }));
  const walk = (group: OptionGroup, ids: string[], names: string[]) => {
    for (const c of group.children) {
      if (c.kind !== 'group') continue;
      const here = [...ids, c.id];
      const named = [...names, c.label];
      for (const o of c.children) {
        if (o.kind === 'group') continue;
        out.push({
          key: o.id,
          categoryId: c.id,
          pathIds: here,
          path: [...named, o.label],
          label: o.label,
          description: o.description,
          what: { option: o },
        });
      }
      if (c.children.some((o) => o.id in MUTES))
        out.push({
          key: 'playHidden',
          categoryId: c.id,
          pathIds: here,
          path: [...named, PLAY_HIDDEN],
          label: PLAY_HIDDEN,
          description: null,
          what: { playHidden: true },
        });
      if (c.children.some((o) => o.id in MUTES))
        out.push({
          key: 'offlineAudio',
          categoryId: c.id,
          pathIds: here,
          path: [...named, OFFLINE_AUDIO],
          label: OFFLINE_AUDIO,
          description: null,
          what: { offlineAudio: true },
        });
      walk(c, here, named);
    }
  };
  if (freecol) walk(freecol, [], []);
  return out;
}

/** The options whose name or tooltip has the text, ignoring case and accents; none for an empty search. */
export function search(freecol: OptionGroup | null, query: string): Match[] {
  const q = fold(query.trim()).folded;
  if (!q) return [];
  return allOptions(freecol).filter(
    (o) => fold(o.label).folded.includes(q) || (o.description !== null && fold(o.description).folded.includes(q)),
  );
}

/** A text with every place the search matches in it marked. */
function marked(text: string, query: string): ReactNode {
  const q = fold(query.trim()).folded;
  if (!q) return text;
  const { folded, at } = fold(text);
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = folded.indexOf(q); i >= 0; i = folded.indexOf(q, i + q.length)) {
    parts.push(text.slice(from, at[i]), <mark key={i}>{text.slice(at[i], at[i + q.length])}</mark>);
    from = at[i + q.length];
  }
  parts.push(text.slice(from));
  // One element, so a flex row keeps the label together.
  return <span>{parts}</span>;
}

/** A search's matches, each with its place in the tree and its control, so it changes right there. */
function Results({
  matches,
  query,
  prefs,
  change,
}: {
  matches: Match[];
  query: string;
  prefs: Prefs;
  change: (p: Prefs) => void;
}) {
  if (matches.length === 0)
    return (
      <p data-search-none className="prefs-note">
        No option matches "{query.trim()}".
      </p>
    );
  const mark = (t: string) => marked(t, query);
  return (
    <div className="prefs-results">
      {matches.map((m) => (
        <div key={m.key} className="result" data-result={m.key}>
          <div className="path">{m.path.slice(0, -1).join(' › ')}</div>
          {'own' in m.what ? (
            <OwnRow pref={m.what.own} label={mark(m.label)} prefs={prefs} change={change} />
          ) : 'playHidden' in m.what ? (
            <PlayHiddenRow label={mark(m.label)} prefs={prefs} change={change} />
          ) : 'offlineAudio' in m.what ? (
            <OfflineAudioRow label={mark(m.label)} prefs={prefs} change={change} />
          ) : (
            <OptionEditor
              root={{ id: m.key, label: m.label, description: null, kind: 'group', children: [m.what.option] }}
              editable
              values={prefs.freecol}
              mark={mark}
              onChange={(id, v) => {
                if (Array.isArray(v)) return;
                change({ ...prefs, freecol: { ...prefs.freecol, [id]: v } });
              }}
              after={(id) => <MuteButton id={id} prefs={prefs} change={change} />}
            />
          )}
        </div>
      ))}
    </div>
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
  useCoverage('showClientOptionsDialog');
  const tree = categories(freecol);
  // The preferences as the window opened with them: Reset and Cancel go back to these.
  const opened = useRef(prefs);
  const [picked, pick] = useState(OWN_CATEGORY);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const current = tree.find((c) => c.id === picked && c.pickable) ?? tree[0];
  const searching = query.trim() !== '';
  const matches = search(freecol, query);
  const hit = new Set(matches.flatMap((m) => m.pathIds));
  // Ctrl+F and `/` go to the search field, instead of the browser's find and quick find.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const find = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f';
      const slash =
        e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as Element | null)?.matches?.(TEXT_ENTRY);
      if (!find && !slash) return;
      // The game's own Ctrl+F (Find Settlement) must not see it.
      e.preventDefault();
      e.stopPropagation();
      field.current?.focus();
      field.current?.select();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);
  return (
    <div className="modal">
      <WindowFrame
        title="Preferences"
        close={close}
        id="preferences"
        onEscape={() => {
          // Escape in the search field clears it, and only then closes the window.
          if (document.activeElement !== field.current || query === '') return false;
          setQuery('');
          return true;
        }}
      >
        <div className="prefs-body">
          <div className="prefs-side">
            <input
              ref={field}
              type="search"
              className="prefs-search"
              data-prefs-search
              aria-label="Search options"
              placeholder="Search options"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Typing is the field's: the game's own keys (S for sentry, ...) must not see it.
                e.stopPropagation();
                // Down or Enter go to the first result's control.
                if (e.key !== 'ArrowDown' && e.key !== 'Enter') return;
                const first = detail.current?.querySelector<HTMLElement>('input, [role="combobox"], button, select');
                if (!first) return;
                e.preventDefault();
                first.focus();
              }}
            />
            <nav className="prefs-tree" aria-label="Categories">
              {tree.map((c) => {
                const dim = searching && !hit.has(c.id);
                const pick_ = () => {
                  pick(c.id);
                  setQuery('');
                };
                return c.pickable ? (
                  <button
                    key={c.id}
                    type="button"
                    data-flat=""
                    data-category={c.id}
                    data-match={flag(searching && !dim)}
                    data-dim={flag(dim)}
                    aria-current={(!searching && c.id === current.id) || undefined}
                    style={{ paddingLeft: 6 + 14 * c.depth }}
                    onClick={pick_}
                  >
                    {c.label}
                  </button>
                ) : (
                  <div key={c.id} className="heading" data-dim={flag(dim)} style={{ paddingLeft: 6 + 14 * c.depth }}>
                    {c.label}
                  </div>
                );
              })}
            </nav>
          </div>
          <div className="prefs-detail" ref={detail}>
            {searching ? (
              <Box caption={`Search: ${matches.length} found`} data-shown="search">
                <Results matches={matches} query={query} prefs={prefs} change={change} />
              </Box>
            ) : (
              <Box caption={current.label} data-shown={current.id}>
                {current.options ? (
                  <>
                    <OptionEditor
                      root={current.options}
                      editable
                      roomy
                      values={prefs.freecol}
                      onChange={(id, v) => {
                        if (Array.isArray(v)) return;
                        change({ ...prefs, freecol: { ...prefs.freecol, [id]: v } });
                      }}
                      after={(id) => <MuteButton id={id} prefs={prefs} change={change} />}
                    />
                    {current.options.children.some((o) => o.id in MUTES) && (
                      <PlayHiddenRow label={PLAY_HIDDEN} prefs={prefs} change={change} />
                    )}
                    {current.options.children.some((o) => o.id in MUTES) && (
                      <OfflineAudioRow label={OFFLINE_AUDIO} prefs={prefs} change={change} />
                    )}
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
            )}
          </div>
        </div>
        <ButtonRow space="tight">
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
        </ButtonRow>
      </WindowFrame>
    </div>
  );
}
