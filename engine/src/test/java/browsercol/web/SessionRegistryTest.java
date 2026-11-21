package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import org.junit.jupiter.api.Test;

import net.sf.freecol.server.model.Session;


/**
 * FreeCol's session registry is static: a new game in the same JVM must not
 * meet the last game's open sessions (#538).
 */
class SessionRegistryTest {

    /** A session of nothing in particular. */
    private static final class OpenSession extends Session {
        OpenSession(String key) { super(key); }
    }

    @Test
    void aNewGameForgetsTheLastGamesOpenSessions() throws Exception {
        new ServerEngine(xml -> { }).startGame("classic", GamePreset.parse("{}"));
        new OpenSession("monarch-offer-1").register();

        new ServerEngine(xml -> { }).startGame("classic", GamePreset.parse("{}"));

        // Declaring independence opens a session with the same key.
        assertDoesNotThrow(() -> new OpenSession("monarch-offer-1"));
    }
}
