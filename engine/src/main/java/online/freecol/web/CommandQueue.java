package online.freecol.web;

import java.util.ArrayDeque;
import java.util.Deque;


/**
 * The player's commands, run one at a time in the order they came: a command
 * that comes while another runs waits for it, instead of being lost.
 *
 * The commands run on a thread of their own, so the page's input never waits
 * for a command to finish. The queue is busy while a command runs or waits.
 */
public final class CommandQueue {

    /** The commands waiting to run. */
    private final Deque<Runnable> waiting = new ArrayDeque<>();

    /** A thread is running the commands, or is about to. */
    private boolean running;

    /** What to do when the queue has run dry. */
    private final Runnable onIdle;

    /**
     * @param onIdle What to do when the queue has run dry: a refresh that came
     *     while a command ran may have asked for the map again.
     */
    public CommandQueue(Runnable onIdle) {
        this.onIdle = onIdle;
    }

    /**
     * Add a command: it runs after the ones already waiting.
     *
     * @param run What the command does.
     */
    public void add(Runnable run) {
        final boolean start;
        synchronized (this) {
            waiting.add(run);
            start = !running;
            running = true;
        }
        if (start) new Thread(this::drain, "web-commands").start();
    }

    /**
     * Whether a command is running or waiting: the map must not go out on its
     * own while one does.
     *
     * @return True if a command is running or waiting.
     */
    public synchronized boolean busy() {
        return running;
    }

    /**
     * Run the waiting commands, one at a time, until there are none left.
     */
    private void drain() {
        for (;;) {
            final Runnable run;
            synchronized (this) {
                run = waiting.poll();
                if (run == null) {
                    // Nothing is left: the queue is idle.
                    running = false;
                    break;
                }
            }
            try {
                run.run();
            } catch (Throwable ex) {
                // A command that fails must not stop the ones after it.
                ex.printStackTrace();
            }
        }
        try {
            onIdle.run();
        } catch (Throwable ex) {
            // The queue is idle either way: a failure here must not stop the
            // commands that come after it.
            ex.printStackTrace();
        }
    }
}
