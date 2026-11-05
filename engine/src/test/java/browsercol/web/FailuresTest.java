package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.EOFException;
import java.io.IOException;

import org.junit.jupiter.api.Test;


/** A failure's description says where it came from, not just its class (#31). */
class FailuresTest {

    private static void readPastTheEnd() throws IOException {
        throw new EOFException();
    }

    @Test
    void anExceptionWithNoMessageShowsItsStack() {
        String text;
        try {
            readPastTheEnd();
            throw new AssertionError("no exception");
        } catch (IOException ex) {
            text = Failures.describe(new RuntimeException("loading", ex));
        }
        assertTrue(text.startsWith("java.lang.RuntimeException: loading"), text);
        assertTrue(text.contains("readPastTheEnd"), text);
        assertTrue(text.contains("Caused by: java.io.EOFException"), text);
    }
}
