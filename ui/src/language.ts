// FreeCol's language option (#151): the translations of FreeCol's own text, data/strings/
// FreeColMessages_<id>.properties. The data bundle carries English and the list of the others
// (LANGUAGES); the page fetches the chosen one's files before the Engines start and adds them to the
// bundle, so both Engines, and the page's own reading of FreeCol's strings, use it. The Browser UI's
// own labels stay English. "Automatic", FreeCol's default, follows the system's language there and
// the browser's here.

/** The language option's id. */
export const LANGUAGE_OPTION = 'model.option.languageOption';
/** The language option's value that follows the browser's languages. */
export const AUTOMATIC = 'automatic';
/** The data bundle's list of FreeCol's translations, by id, written by build-data.mjs. */
export const LANGUAGES = 'strings/languages.json';

/** The English strings file, which every language starts from. */
const BASE = 'strings/FreeColMessages.properties';
const stringsFile = (id: string) => `strings/FreeColMessages_${id}.properties`;

/** The language ids of the data bundle: English, then the translations it lists. */
export function languages(data: string[]): string[] {
  const i = data.indexOf(`data/${LANGUAGES}`);
  try {
    return ['en', ...(i < 0 ? [] : (JSON.parse(data[i + 1]) as string[]))];
  } catch {
    return ['en'];
  }
}

/** FreeCol's id, such as pt_BR or be-tarask, as a BCP 47 tag. */
const tag = (id: string) => id.replace(/_/g, '-').toLowerCase();

/** Browser tags whose own match FreeCol lacks, and the translation they read best in. */
const ALIASES: Record<string, string> = {
  'zh-tw': 'zh-hant',
  'zh-hk': 'zh-hant',
  'zh-mo': 'zh-hant',
  'sr-cyrl': 'sr-ec',
  no: 'nb_NO',
};

/**
 * The language to load: the player's pick or, for automatic, the first of the browser's languages
 * FreeCol has a translation for, by its whole tag and then by its language alone. By language alone,
 * a plain or country translation (zh_CN) comes before a script's or dialect's (zh-hant). English otherwise.
 *
 * @param chosen The option's value: a language id or AUTOMATIC.
 * @param available The ids there are strings for (languages()).
 * @param browser The browser's languages, most wanted first (navigator.languages).
 */
export function pickLanguage(chosen: string, available: readonly string[], browser: readonly string[]): string {
  if (chosen !== AUTOMATIC) return available.includes(chosen) ? chosen : 'en';
  for (const wanted of browser) {
    const t = tag(wanted);
    const alias = ALIASES[t];
    if (alias && available.includes(alias)) return alias;
    const whole = available.find((id) => tag(id) === t);
    if (whole) return whole;
    const primary = t.split('-')[0];
    const same = available.filter((id) => tag(id).split('-')[0] === primary);
    // FreeCol writes a country after '_' and a script or dialect after '-'.
    const best = same.find((id) => !id.includes('-')) ?? same[0];
    if (best) return best;
  }
  return 'en';
}

/**
 * The strings files to fetch for a language, in the order FreeCol loads them over the English ones
 * (FreeColDirectories.getLocaleFileNames): the language's own, then its country's.
 */
export function translationFiles(id: string, available: readonly string[]): string[] {
  if (id === 'en') return [];
  const language = id.split('_')[0];
  // 'en' is the English file itself, not a translation.
  const own = language !== id && language !== 'en' && available.includes(language);
  return [...(own ? [language] : []), id].map(stringsFile);
}

/**
 * The strings files of the data bundle, English first and then any translation the page added, shortest
 * name first: a language's own file (pt) before its country's (pt_BR), as translationFiles orders them.
 */
export function messageFiles(data: string[]): string[] {
  const translations = data
    .filter((p, i) => i % 2 === 0 && p.startsWith('data/strings/FreeColMessages_'))
    .map((p) => p.slice('data/'.length))
    .sort((a, b) => a.length - b.length);
  return [BASE, ...translations];
}

/** Names Intl gets wrong or lacks, as FreeCol's LanguageOption names them. */
const NAMES: Record<string, string> = {
  'sr-ec': 'Српски (ћирилица)',
  arz: 'مصرى',
  hsb: 'Serbšćina',
  nds: 'Plattdüütsch',
  pms: 'Piemontèis',
};

/** A language's name in the language itself, capitalised, as FreeCol's language list shows it. */
export function languageName(id: string): string {
  if (NAMES[id]) return NAMES[id];
  let name = id;
  try {
    name = new Intl.DisplayNames([tag(id)], { type: 'language' }).of(tag(id)) ?? id;
  } catch {
    // Not a tag Intl knows: the id it is.
  }
  return name.charAt(0).toLocaleUpperCase(tag(id)) + name.slice(1);
}
