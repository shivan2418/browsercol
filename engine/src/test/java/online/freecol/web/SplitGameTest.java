package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;


/**
 * The server Engine and the client Engine, joined only by protocol XML
 * strings as the Worker and the main thread are, play a Classic game.
 */
class SplitGameTest {

    /** Each direction gets its own thread, as each side of postMessage does. */
    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    @Test
    @Timeout(120)
    void aClassicGameRunsAiRoundsBetweenTheEngines() throws Exception {
        final int rounds = 3;
        final List<Long> roundTimes = Collections.synchronizedList(new ArrayList<>());
        final AtomicReference<Game> started = new AtomicReference<>();
        final CountDownLatch finished = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];

        ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { started.set(game); }
                public void roundDone(int round, long millis) {
                    roundTimes.add(millis);
                }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {}
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });

        server.startGame("classic");
        assertTrue(client[0].startGame(rounds), "login");

        finished.await();

        assertNotNull(started.get(), "client saw the game start");
        assertEquals(rounds, roundTimes.size());
        Game game = client[0].getGame();
        assertEquals(rounds + 1, game.getTurn().getNumber());
        assertEquals(server.getGame().getMap().getWidth(), game.getMap().getWidth());
        assertTrue(game.getLiveEuropeanPlayerList().size() > 1, "AI players present");
    }
}
