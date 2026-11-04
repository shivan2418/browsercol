package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.common.i18n.Messages;


/** The language option: the Engines load FreeCol's translation the page names. */
class LanguageTest {

    @AfterEach
    void english() {
        Language.set("en");
        Messages.loadMessageBundle(Locale.US);
    }

    @Test
    void theServerEngineSpeaksTheChosenLanguage() throws Exception {
        Language.set("de");
        new ServerEngine(xml -> {}).startGame("classic");
        assertEquals("Sprache", Messages.message("model.option.languageOption.name"));
    }

    @Test
    void aTranslationByCountryLoadsItsOwnFile() throws Exception {
        Language.set("pt_BR");
        new ServerEngine(xml -> {}).startGame("classic");
        assertEquals("Idioma", Messages.message("model.option.languageOption.name"));
    }

    @Test
    void englishIsTheDefault() throws Exception {
        new ServerEngine(xml -> {}).startGame("classic");
        assertEquals("Language", Messages.message("model.option.languageOption.name"));
    }
}
