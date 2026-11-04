package online.freecol.web;

import java.util.Locale;

import net.sf.freecol.common.i18n.Messages;


/**
 * The language FreeCol's text is in: FreeCol's language option, as the page
 * picked it (ui/src/language.ts) before the Engine started. The page adds
 * that translation's strings files to the data bundle.
 */
final class Language {

    private static Locale locale = Locale.US;

    private Language() {}

    /**
     * Set the language.
     *
     * @param id A translation's id, as FreeCol's strings files name it
     *     (de, pt_BR, be-tarask), or "en" or empty for English.
     */
    static void set(String id) {
        locale = (id == null || id.isEmpty() || "en".equals(id))
            ? Locale.US : Messages.getLocale(id);
    }

    /** The locale the message bundle is loaded for. */
    static Locale locale() {
        return locale;
    }
}
