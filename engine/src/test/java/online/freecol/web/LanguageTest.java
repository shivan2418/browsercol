package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Game;


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
    void theClientEngineSpeaksTheChosenLanguage() {
        Language.set("de");
        new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() {}
                public void post(String xml) {}
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) {}
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {}
                public void ask(int id, String kind, String json) {}
            });
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

    @Test
    void brebeufsDescriptionSaysWhatHeDoes() throws Exception {
        new ServerEngine(xml -> {}).startGame("classic");
        final String text = Messages.message("model.foundingFather.fatherJeanDeBrebeuf.description");
        assertTrue(text.contains("do not convert natives any faster"), text);
        Language.set("de");
        new ServerEngine(xml -> {}).startGame("classic");
        assertFalse(Messages.message("model.foundingFather.fatherJeanDeBrebeuf.description")
            .contains("convert natives"), "a translation keeps its own text");
    }
}
