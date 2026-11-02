// The Preferences window of the Game menu: the animation and blink speeds.
import { Box, WindowFrame } from './frame';
import { SPEEDS, type Prefs, type Speed } from './prefs';

const LABEL: Record<Speed, string> = { off: 'Off', slow: 'Slow', normal: 'Normal', fast: 'Fast' };

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
    <WindowFrame title="Preferences" close={close} id="preferences">
      <Box caption="Display">
        <SpeedRow
          name="animation"
          label="Unit move animation"
          value={prefs.animation}
          onChange={(animation) => change({ ...prefs, animation })}
        />
        <SpeedRow
          name="blink"
          label="Active unit blink"
          value={prefs.blink}
          onChange={(blink) => change({ ...prefs, blink })}
        />
      </Box>
    </WindowFrame>
  );
}
