// A small note over the map while a preference that is read only as the page loads (the Tileset, or one of
// FreeCol's ON_RELOAD options) differs from what the page loaded with: the option's label says "(on reload)",
// but that is easy to miss once the Preferences window is closed. Setting it back takes the note away.
import { leaves, type OptionGroup } from './options';
import { ON_RELOAD, type Prefs } from './prefs';

/**
 * The names of the preferences changed since the page loaded that show only on reload, the Tileset first.
 * A FreeCol option never set counts as its default, so picking the default it already had is no change.
 */
export function reloadPending(atLoad: Prefs, now: Prefs, options: OptionGroup | null): string[] {
  const all = options ? leaves(options) : new Map();
  const value = (p: Prefs, id: string) => p.freecol[id] ?? all.get(id)?.value;
  const changed = ON_RELOAD.filter((id) => value(atLoad, id) !== value(now, id)).map((id) => all.get(id)?.label ?? id);
  return atLoad.tileset === now.tileset ? changed : ['Tileset', ...changed];
}

export function ReloadNotice({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div role="status" className="reload-notice">
      {names.join(', ')}: takes effect when you reload the page
    </div>
  );
}
