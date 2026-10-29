package online.freecol.shim.javax.swing;

import java.util.ArrayDeque;

/**
 * javax.swing.SwingUtilities for the client controllers. There is no Swing
 * event thread, but invokeLater keeps its promise of running tasks one at a
 * time in order: a thread of our own drains the queue while it is not empty.
 * invokeAndWait runs the task at once.
 */
public class TSwingUtilities {

    private static final ArrayDeque<Runnable> queue = new ArrayDeque<>();
    private static boolean draining = false;

    public static void invokeLater(Runnable task) {
        synchronized (queue) {
            queue.add(task);
            if (draining) return;
            draining = true;
        }
        new Thread(TSwingUtilities::drain, "invokeLater").start();
    }

    private static void drain() {
        for (;;) {
            Runnable task;
            synchronized (queue) {
                task = queue.poll();
                if (task == null) {
                    draining = false;
                    return;
                }
            }
            task.run();
        }
    }

    public static void invokeAndWait(Runnable task) {
        task.run();
    }

    public static boolean isEventDispatchThread() {
        return false;
    }
}
