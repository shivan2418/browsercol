package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;


/**
 * The player's commands run one at a time, in the order they came: a command
 * that comes while another runs waits for it, instead of being lost.
 */
class CommandQueueTest {

    /** How long a test waits for the commands to run. */
    private static final long TIMEOUT = 20;

    @Test
    @Timeout(30)
    void commandsRunInTheOrderTheyCame() throws Exception {
        final List<String> log = Collections.synchronizedList(new ArrayList<>());
        final CountDownLatch done = new CountDownLatch(1);
        final CommandQueue queue = new CommandQueue(() -> {});
        queue.add(() -> log.add("first"));
        queue.add(() -> log.add("second"));
        queue.add(() -> {
            log.add("third");
            done.countDown();
        });
        assertTrue(done.await(TIMEOUT, TimeUnit.SECONDS), "the commands did not run");
        assertEquals(List.of("first", "second", "third"), log);
    }

    @Test
    @Timeout(30)
    void aCommandThatComesWhileAnotherRunsWaitsForIt() throws Exception {
        final List<String> log = Collections.synchronizedList(new ArrayList<>());
        final CountDownLatch running = new CountDownLatch(1);
        final CountDownLatch done = new CountDownLatch(1);
        final CommandQueue queue = new CommandQueue(() -> {});
        queue.add(() -> {
            log.add("first");
            running.countDown();
            sleep(500);
            log.add("first done");
        });
        assertTrue(running.await(TIMEOUT, TimeUnit.SECONDS), "the first command did not run");
        // The second command comes while the first runs: it must wait its turn,
        // not be lost.
        queue.add(() -> {
            log.add("second");
            done.countDown();
        });
        assertTrue(done.await(TIMEOUT, TimeUnit.SECONDS), "the second command was lost");
        assertEquals(List.of("first", "first done", "second"), log);
    }

    @Test
    @Timeout(30)
    void commandsDoNotRunAtTheSameTime() throws Exception {
        final AtomicInteger running = new AtomicInteger();
        final AtomicInteger most = new AtomicInteger();
        final CountDownLatch done = new CountDownLatch(3);
        final CommandQueue queue = new CommandQueue(() -> {});
        for (int i = 0; i < 3; i++) {
            queue.add(() -> {
                final int n = running.incrementAndGet();
                most.updateAndGet(m -> Math.max(m, n));
                sleep(100);
                running.decrementAndGet();
                done.countDown();
            });
        }
        assertTrue(done.await(TIMEOUT, TimeUnit.SECONDS), "the commands did not run");
        assertEquals(1, most.get(), "two commands ran at the same time");
    }

    @Test
    @Timeout(30)
    void theQueueIsIdleWhenItsCommandsAreDone() throws Exception {
        final CountDownLatch idle = new CountDownLatch(1);
        final CommandQueue queue = new CommandQueue(idle::countDown);
        assertFalse(queue.busy(), "the queue is busy before any command");
        queue.add(() -> {});
        assertTrue(idle.await(TIMEOUT, TimeUnit.SECONDS), "the queue did not run its command");
        assertFalse(queue.busy(), "the queue is busy after its command");
    }

    @Test
    @Timeout(30)
    void aCommandThatFailsDoesNotStopTheOnesAfterIt() throws Exception {
        final List<String> log = Collections.synchronizedList(new ArrayList<>());
        final CountDownLatch done = new CountDownLatch(1);
        final CommandQueue queue = new CommandQueue(() -> {});
        queue.add(() -> {
            throw new IllegalStateException("the command failed");
        });
        queue.add(() -> {
            log.add("after");
            done.countDown();
        });
        assertTrue(done.await(TIMEOUT, TimeUnit.SECONDS), "the command after the failed one was lost");
        assertEquals(List.of("after"), log);
    }

    /** Sleep, so that a command can run while another comes. */
    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }
}
