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

    /** An exception thrown on the AWT event thread is reported (#227). */
    @Test
    void anExceptionOnTheEventThreadIsReported() throws Exception {
        FirstTurn.threads(); // loads FirstTurn, which watches the event thread
        java.awt.EventQueue.invokeLater(() -> {
            throw new IllegalStateException("edt boom");
        });
        // Runs after the throwing task, on the same thread.
        java.awt.EventQueue.invokeAndWait(() -> {});
        String all = String.join("\n", FirstTurn.reported());
        assertTrue(all.contains("the AWT event thread"), all);
        assertTrue(all.contains("edt boom"), all);
    }
}
