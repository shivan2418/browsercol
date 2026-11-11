package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import browsercol.shim.TaskFailures;
import browsercol.shim.javax.swing.TSwingUtilities;


/** A task that throws while the game starts reaches the page as a failure (#459). */
class StartupFailuresTest {

    private final List<String> fatal = new CopyOnWriteArrayList<>();

    @BeforeEach
    void listen() {
        StartupFailures.reset();
        Failures.reportFatalTo(fatal::add);
        TaskFailures.listen(StartupFailures::taskFailed);
    }

    @AfterEach
    void forget() {
        StartupFailures.reset();
        Failures.reportFatalTo(detail -> {});
        TaskFailures.listen(ex -> {});
    }

    private static void drained() throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        TSwingUtilities.invokeLater(done::countDown);
        assertTrue(done.await(5, TimeUnit.SECONDS));
    }

    @Test
    void aStartupTaskThatThrowsIsReportedAndLaterTasksStillRun() throws Exception {
        TSwingUtilities.invokeLater(() -> {
            throw new NullPointerException();
        });
        drained();
        assertEquals(1, fatal.size());
        assertTrue(fatal.get(0).contains("NullPointerException"), fatal.get(0));
    }

    @Test
    void aTaskThatThrowsDuringPlayIsOnlyLogged() throws Exception {
        StartupFailures.gameStarted();
        TSwingUtilities.invokeLater(() -> {
            throw new IllegalStateException("play");
        });
        drained();
        assertEquals(List.of(), fatal);
    }

    @Test
    void aBrokenListenerDoesNotStopLaterTasks() throws Exception {
        TaskFailures.listen(ex -> {
            throw new IllegalStateException("listener");
        });
        TSwingUtilities.invokeLater(() -> {
            throw new IllegalStateException("task");
        });
        drained();
    }
}
