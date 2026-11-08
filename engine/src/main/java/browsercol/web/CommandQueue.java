package browsercol.web;

import java.util.ArrayDeque;
import java.util.Deque;


/**
 * The player's commands, run one at a time in the order they came: a command
 * that comes while another runs waits for it, instead of being lost.
 *
 * The commands run on a thread of their own, so the page's input never waits
 * for a command to finish. It is the Engine's own thread, not the Worker's:
 * the Engine still runs on the page's main thread, as ADR-0002 has it.
 * The queue is busy while a command runs or waits.
 */
public final class CommandQueue {

    /** The commands waiting to run. */
    private final Deque<Runnable> waiting = new ArrayDeque<>();

    /** A thread is running the commands, or is about to. */
    private boolean running;

    /** A command is running now. */
    private boolean executing;

    /** Commands wait to run until released (a native trade is open, #393). */
    private boolean held;

    /** The thread running the commands, while one does. */
    private Thread drainer;

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
     * Wait for the command that is running, if any, to finish, and start no
     * more until {@link #release}: as Swing's modal dialog, shown after the
     * action that is running, keeps the player from acting until it closes.
     * Called from the commands' own thread, it waits for nothing.
     */
    public synchronized void hold() {
        while (executing && Thread.currentThread() != drainer) {
            try {
                wait();
            } catch (InterruptedException ie) {}
        }
        held = true;
    }

    /** Run the commands again, those that came while they were held first. */
    public synchronized void release() {
        held = false;
        notifyAll();
    }

    /**
     * Run the waiting commands, one at a time, until there are none left.
     */
    private void drain() {
        synchronized (this) {
            drainer = Thread.currentThread();
        }
        for (;;) {
            final Runnable run;
            synchronized (this) {
                // Held, a waiting command waits for the release; with none, the queue goes idle.
                while (held && !waiting.isEmpty()) {
                    try {
                        wait();
                    } catch (InterruptedException ie) {}
                }
                run = waiting.poll();
                if (run == null) {
                    // Nothing is left: the queue is idle, and the owner is
                    // told, so that it can send the map a refresh asked for.
                    // The lock keeps a command from starting until that is
                    // done, and so keeps the map out of the middle of one.
                    running = false;
                    drainer = null;
                    onIdle.run();
                    return;
                }
                executing = true;
            }
            try {
                run.run();
            } catch (Throwable ex) {
                // A command that fails must not stop the ones after it.
                ex.printStackTrace();
            } finally {
                synchronized (this) {
                    executing = false;
                    notifyAll();
                }
            }
        }
    }
}
