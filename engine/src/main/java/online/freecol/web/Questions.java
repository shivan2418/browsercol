package online.freecol.web;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;


/**
 * The WebGUI's questions to the Browser UI. A question goes out with an id
 * and the asking thread waits until the answer to that id comes back.
 * FreeCol's modal dialogs have no timeout, so neither does a question; a
 * dialog the player closes answers null.
 *
 * The wait polls with {@code Thread.sleep}, as
 * {@link PostMessageConnection} does. It was written while TeaVM's Wasm GC
 * {@code Object.wait} never woke; {@code FiberSuspendFix} fixes that (#11),
 * but the polling has not been replaced yet.
 */
final class Questions {

    /** How a question reaches the Browser UI. Must not block. */
    interface Asker {
        void ask(int id, String kind, String json);
    }

    /** How long an asking thread sleeps between checks. */
    private static final long POLL_MS = 10;

    private static final class Pending {
        volatile boolean done = false;
        volatile String answer = null;
    }

    private final Asker asker;
    private final AtomicInteger nextId = new AtomicInteger(1);
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();


    Questions(Asker asker) {
        this.asker = asker;
    }

    /**
     * Ask the Browser UI and wait for the answer.
     *
     * @param kind The kind of question, e.g. "confirm".
     * @param json The question as a JSON object.
     * @return The answer, or null if the player closed the dialog.
     */
    String ask(String kind, String json) {
        final int id = this.nextId.getAndIncrement();
        final Pending p = new Pending();
        this.pending.put(id, p);
        this.asker.ask(id, kind, json);
        while (!p.done) {
            try {
                Thread.sleep(POLL_MS);
            } catch (InterruptedException ie) {}
        }
        return p.answer;
    }

    /**
     * Accept the Browser UI's answer. An id no one waits for is ignored.
     *
     * @param id The question's id.
     * @param answer The answer, or null for a closed dialog.
     */
    void answer(int id, String answer) {
        Pending p = this.pending.remove(id);
        if (p == null) return;
        p.answer = answer;
        p.done = true;
    }
}
