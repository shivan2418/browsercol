package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;


/**
 * The modal gate on its own (#401): a dialog's flow asks its questions in
 * turn, and what other threads ask or defer meanwhile waits for the flow.
 */
class ModalGateTest {

    /** The holds on the player's commands not yet released. */
    private final AtomicInteger holds = new AtomicInteger();
    private final ModalGate gate = new ModalGate(new ModalGate.Hold() {
            public void hold() { holds.incrementAndGet(); }
            public void holdNext() { holds.incrementAndGet(); }
            public void release() { holds.decrementAndGet(); }
        });
    /** What happened, in order. */
    private final List<String> log = new CopyOnWriteArrayList<>();
    /** The questions asked and not yet answered, by id. */
    private final java.util.Map<Integer, String> open = new java.util.concurrent.ConcurrentHashMap<>();
    private final Questions questions = new Questions((id, kind, json) -> {
            open.put(id, json);
            log.add("ask " + json);
        }, gate);

    /** Answer the open question that asked this. */
    private void answer(String json) {
        for (java.util.Map.Entry<Integer, String> e : open.entrySet()) {
            if (e.getValue().equals(json)) {
                open.remove(e.getKey());
                log.add("answer " + json);
                questions.answer(e.getKey(), "ok");
                return;
            }
        }
        throw new AssertionError(json + " is not open: " + log);
    }

    private void eventually(java.util.function.BooleanSupplier ok, String what) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(10);
        assertTrue(ok.getAsBoolean(), what + ": " + log);
    }

    private Thread start(String name, Runnable run) {
        final Thread t = new Thread(run, name);
        t.start();
        return t;
    }

    @Test
    @Timeout(30)
    void aFlowAsksInTurnAndTheRestWaitsForIt() throws Exception {
        final Thread command = start("command", () -> gate.job(() -> {
                    questions.ask("choice", "a");
                    questions.ask("amount", "a2");
                    log.add("command done");
                }));
        eventually(() -> open.containsValue("a"), "the command asks");
        assertEquals(1, holds.get(), "no other command starts");

        // Another unit's question, and another thread's deferred work.
        final Thread other = start("other", () -> gate.job(() -> questions.ask("confirm", "b")));
        start("handler", () -> gate.invoke(() -> log.add("deferred")));
        Thread.sleep(300);
        assertEquals(List.of("ask a"), log, "nothing else while the question is open");

        answer("a");
        // The command's own follow-up goes through; the others still wait.
        eventually(() -> open.containsValue("a2"), "the follow-up is asked");
        Thread.sleep(300);
        assertEquals(List.of("ask a", "answer a", "ask a2"), log);

        answer("a2");
        eventually(() -> open.containsValue("b"), "the other question is asked after the command");
        assertEquals(List.of("ask a", "answer a", "ask a2", "answer a2", "command done",
                             "deferred", "ask b"), log,
            "the deferred work ran after the command, before the other question");
        command.join(5000);
        answer("b");
        other.join(5000);
        assertEquals(0, holds.get(), "the commands run again");
        assertTrue(!gate.isOpen(), "the gate is free");
    }

    @Test
    @Timeout(30)
    void deferredWorkThatAsksRunsAfterTheFlowWithoutWaitingForIt() throws Exception {
        start("command", () -> gate.job(() -> questions.ask("confirm", "a")));
        eventually(() -> open.containsValue("a"), "the command asks");
        // A handler's deferred work (a goto reaching a rumour) asks a question.
        final CountDownLatch returned = new CountDownLatch(1);
        start("handler", () -> gate.job(() -> {
                    gate.invoke(() -> questions.ask("confirm", "goto"));
                    gate.invoke(() -> log.add("after the goto"));
                    returned.countDown();
                }));
        assertTrue(returned.await(5, TimeUnit.SECONDS), "the handler does not wait for the open dialog");
        answer("a");
        eventually(() -> open.containsValue("goto"), "the queued work asks its question");
        answer("goto");
        eventually(() -> log.contains("after the goto"), "the queued work runs in order");
        eventually(() -> !gate.isOpen(), "the gate is free");
    }

    @Test
    @Timeout(30)
    void aThreadWithNoJobHoldsTheGateUntilItsQuestionIsAnswered() throws Exception {
        final Thread lone = start("lone", () -> {
                questions.ask("confirm", "a");
                log.add("lone answered");
            });
        eventually(() -> open.containsValue("a"), "the thread asks");
        gate.invoke(() -> log.add("deferred"));
        assertEquals(List.of("ask a"), log);
        answer("a");
        lone.join(5000);
        assertEquals(List.of("ask a", "answer a", "deferred", "lone answered"), log,
            "the work held runs once the question is answered");
        assertEquals(0, holds.get());
    }

    /**
     * A dialog that defers is non-modal in Swing: the player may act beside
     * it (the end turn dialog's pick of a waiting unit), so it holds no
     * commands, while other questions still wait for it.
     */
    @Test
    @Timeout(30)
    void aDialogThatDefersHoldsNoCommands() throws Exception {
        final Thread dialog = start("WebGUI-showEndTurnDialog",
            () -> gate.deferred(() -> questions.ask("endTurn", "a")));
        eventually(() -> open.containsValue("a"), "the dialog asks");
        assertEquals(0, holds.get(), "the commands run");
        final Thread other = start("other", () -> gate.job(() -> questions.ask("confirm", "b")));
        Thread.sleep(300);
        assertEquals(List.of("ask a"), log, "another question waits for it");
        answer("a");
        eventually(() -> open.containsValue("b"), "the other question is asked after it");
        assertEquals(1, holds.get(), "a command's question holds the commands after it");
        answer("b");
        dialog.join(5000);
        other.join(5000);
        assertEquals(0, holds.get());
    }

    @Test
    @Timeout(30)
    void aJobThatAsksNothingHoldsNothing() throws Exception {
        gate.job(() -> gate.invoke(() -> log.add("at once")));
        assertEquals(List.of("at once"), log);
        assertEquals(0, holds.get());
        assertTrue(!gate.isOpen());
    }
}
