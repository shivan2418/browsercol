package online.freecol.web;

import java.io.PrintWriter;
import java.io.StringWriter;


/**
 * What a "failed" event says of an exception. {@code String.valueOf(ex)}
 * is only the class name for an exception with no message, such as an
 * EOFException (#31), so the event carries the stack trace and the causes
 * too, for the page's {@code window.fcResult} to show.
 */
final class Failures {

    private Failures() {}

    /**
     * @param ex What went wrong.
     * @return The exception, its stack trace and its causes, as text.
     */
    static String describe(Throwable ex) {
        StringWriter sw = new StringWriter();
        try (PrintWriter pw = new PrintWriter(sw)) {
            ex.printStackTrace(pw);
        }
        String text = sw.toString().trim();
        // Some runtimes print nothing for a trace they cannot make.
        return text.isEmpty() ? String.valueOf(ex) : text;
    }
}
