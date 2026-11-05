package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;


class QuestionsTest {

    /** Answers on its own thread, as the Browser UI does after the ask returns. */
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        ui.shutdownNow();
    }

    @Test
    @Timeout(10)
    void askWaitsForTheAnswerToItsId() {
        final List<String> asked = Collections.synchronizedList(new ArrayList<>());
        final Questions[] q = new Questions[1];
        q[0] = new Questions((id, kind, json) -> {
                asked.add(id + " " + kind + " " + json);
                ui.execute(() -> {
                        q[0].answer(id + 100, "wrong id");
                        q[0].answer(id, "yes");
                    });
            });

        assertEquals("yes", q[0].ask("confirm", "{}"));
        assertEquals("yes", q[0].ask("confirm", "{\"n\":2}"));
        assertEquals(List.of("1 confirm {}", "2 confirm {\"n\":2}"), asked);
    }

    @Test
    @Timeout(10)
    void aClosedQuestionReturnsNull() {
        final Questions[] q = new Questions[1];
        q[0] = new Questions((id, kind, json) -> ui.execute(() -> q[0].answer(id, null)));

        assertNull(q[0].ask("input", "{}"));
    }
}
