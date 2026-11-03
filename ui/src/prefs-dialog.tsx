// The Preferences window of the Game menu: the animation and blink speeds.
import { Box, WindowFrame } from './frame';
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

export function PreferencesDialog({
  prefs,
  change,
  close,
}: {
  prefs: Prefs;
  change: (p: Prefs) => void;
  close: () => void;
}) {
  return (
    <div className="modal">
      <WindowFrame title="Preferences" close={close} id="preferences">
        <Box caption="Display">
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
        </Box>
      </WindowFrame>
    </div>
  );
}
