package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import net.sf.freecol.FreeCol;


/**
 * TeaVM narrows a Timer's or a wait's milliseconds to an int, so the
 * timeout FreeCol gives a native demand or a diplomacy session must fit one.
 * FreeCol's single-player default of 3.6 billion ms did not.
 */
class TimeoutTest {

    @Test
    void theSinglePlayerTimeoutInMillisecondsFitsAnInt() {
        new ServerEngine(xml -> {});
        long ms = FreeCol.getTimeout(true) * 1000;
        assertTrue(ms > 0 && ms <= Integer.MAX_VALUE, "timeout is " + ms + " ms");
    }
}
