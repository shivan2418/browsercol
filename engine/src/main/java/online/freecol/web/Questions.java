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
 * Each question has a monitor of its own, so {@code answer} wakes only the
 * thread that asked it, however many wait at once. {@code answer} is called
 * from a JavaScript callback, outside any Java thread.
 */
final class Questions {

    /** How a question reaches the Browser UI. Must not block. */
    interface Asker {
        void ask(int id, String kind, String json);
    }

    private static final class Pending {
        boolean done = false;
        String answer = null;
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
        synchronized (p) {
            while (!p.done) {
                try {
                    p.wait();
                } catch (InterruptedException ie) {}
            }
            return p.answer;
        }
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
        synchronized (p) {
            p.answer = answer;
            p.done = true;
            p.notifyAll();
        }
    }
}
